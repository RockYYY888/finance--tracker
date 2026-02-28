from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re

import httpx

from app.services.cache import TTLCache

INVALID_SYMBOL_MESSAGE = (
	"Invalid symbol format. Use A-share (600519, 600519.SS, SH600519), "
	"HK (00700, 00700.HK, HK00700), or US (AAPL, BRK-B)."
)


class QuoteLookupError(RuntimeError):
	"""Raised when the market data providers cannot return a usable value."""


def build_fx_symbol(from_currency: str, to_currency: str) -> str:
	"""Translate a currency pair into a Yahoo Finance symbol."""
	return f"{from_currency.upper()}{to_currency.upper()}=X"


def normalize_symbol(symbol: str) -> str:
	"""Normalize common CN/HK/US ticker formats into Yahoo-compatible symbols."""
	candidate = symbol.strip().upper()
	if not candidate:
		raise ValueError("Symbol cannot be empty.")

	if re.fullmatch(r"^[A-Z]{6}=X$", candidate):
		return candidate

	if match := re.fullmatch(r"^(SH|SZ)(\d{6})$", candidate):
		suffix = "SS" if match.group(1) == "SH" else "SZ"
		return f"{match.group(2)}.{suffix}"

	if match := re.fullmatch(r"^HK(\d{1,5})$", candidate):
		return f"{match.group(1).zfill(4)}.HK"

	if re.fullmatch(r"^\d{6}\.(SS|SZ)$", candidate):
		return candidate

	if re.fullmatch(r"^\d{1,5}\.HK$", candidate):
		code, _, _ = candidate.partition(".")
		return f"{code.zfill(4)}.HK"

	if re.fullmatch(r"^\d{6}$", candidate):
		suffix = "SS" if candidate[0] in {"5", "6", "9"} else "SZ"
		return f"{candidate}.{suffix}"

	if re.fullmatch(r"^\d{1,5}$", candidate):
		return f"{candidate.zfill(4)}.HK"

	if re.fullmatch(r"^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$", candidate):
		return candidate

	raise ValueError(INVALID_SYMBOL_MESSAGE)


@dataclass(slots=True)
class Quote:
	symbol: str
	name: str
	price: float
	currency: str
	market_time: datetime | None


class YahooQuoteProvider:
	YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"

	def __init__(self, timeout: float = 10.0) -> None:
		self.timeout = timeout

	async def fetch_quote(self, symbol: str) -> Quote:
		"""Fetch the latest quote from Yahoo's public quote endpoint."""
		try:
			async with httpx.AsyncClient(timeout=self.timeout) as client:
				response = await client.get(
					self.YAHOO_QUOTE_URL,
					params={"symbols": symbol},
					headers={"User-Agent": "Mozilla/5.0"},
				)
				response.raise_for_status()
				payload = response.json()
		except httpx.HTTPError as exc:
			raise QuoteLookupError(f"Quote provider request failed for {symbol}.") from exc

		results = payload.get("quoteResponse", {}).get("result", [])
		if not results:
			raise QuoteLookupError(f"No quote data returned for {symbol}.")

		result = results[0]
		price = result.get("regularMarketPrice")
		currency = result.get("currency") or result.get("financialCurrency")
		if price in (None, 0) or not currency:
			raise QuoteLookupError(f"Incomplete quote data returned for {symbol}.")

		timestamp = result.get("regularMarketTime")
		market_time = (
			datetime.fromtimestamp(timestamp, tz=timezone.utc) if isinstance(timestamp, int) else None
		)

		return Quote(
			symbol=result.get("symbol", symbol),
			name=result.get("shortName") or result.get("longName") or symbol,
			price=float(price),
			currency=str(currency).upper(),
			market_time=market_time,
		)


class FrankfurterRateProvider:
	FRANKFURTER_URL = "https://api.frankfurter.app/latest"

	def __init__(self, timeout: float = 10.0) -> None:
		self.timeout = timeout

	async def fetch_rate(self, from_currency: str, to_currency: str) -> float:
		"""Fetch a conversion rate using Frankfurter's ECB-backed feed."""
		try:
			async with httpx.AsyncClient(timeout=self.timeout) as client:
				response = await client.get(
					self.FRANKFURTER_URL,
					params={"from": from_currency, "to": to_currency},
				)
				response.raise_for_status()
				payload = response.json()
		except httpx.HTTPError as exc:
			raise QuoteLookupError(
				f"FX provider request failed for {from_currency}/{to_currency}.",
			) from exc

		rate = payload.get("rates", {}).get(to_currency)
		if rate in (None, 0):
			raise QuoteLookupError(f"No FX rate returned for {from_currency}/{to_currency}.")

		return float(rate)


class MarketDataClient:
	def __init__(
		self,
		quote_provider: YahooQuoteProvider | None = None,
		fx_provider: FrankfurterRateProvider | None = None,
		quote_cache: TTLCache[Quote] | None = None,
		fx_cache: TTLCache[float] | None = None,
		quote_ttl_seconds: int = 60,
		fx_ttl_seconds: int = 600,
	) -> None:
		self.quote_provider = quote_provider or YahooQuoteProvider()
		self.fx_provider = fx_provider or FrankfurterRateProvider()
		self.quote_cache = quote_cache or TTLCache[Quote]()
		self.fx_cache = fx_cache or TTLCache[float]()
		self.quote_ttl_seconds = quote_ttl_seconds
		self.fx_ttl_seconds = fx_ttl_seconds

	async def fetch_quote(self, symbol: str) -> tuple[Quote, list[str]]:
		"""Fetch a quote, preferring a fresh cache hit and falling back to stale data."""
		normalized_symbol = normalize_symbol(symbol)
		cached_quote = self.quote_cache.get(normalized_symbol)
		if cached_quote is not None:
			return cached_quote, []

		try:
			quote = await self.quote_provider.fetch_quote(normalized_symbol)
		except QuoteLookupError as exc:
			stale_quote = self.quote_cache.get_stale(normalized_symbol)
			if stale_quote is not None:
				return stale_quote, [
					f"{normalized_symbol} 行情源不可用，已回退到最近缓存值: {exc}",
				]
			raise

		self.quote_cache.set(normalized_symbol, quote, ttl_seconds=self.quote_ttl_seconds)
		return quote, []

	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		"""Fetch an FX rate, preferring intraday Yahoo data and a stale cache on provider failure."""
		from_code = from_currency.strip().upper()
		to_code = to_currency.strip().upper()
		if from_code == to_code:
			return 1.0, []

		cache_key = f"{from_code}:{to_code}"
		cached_rate = self.fx_cache.get(cache_key)
		if cached_rate is not None:
			return cached_rate, []

		quote_error_message = ""
		try:
			quote, quote_warnings = await self.fetch_quote(build_fx_symbol(from_code, to_code))
		except (QuoteLookupError, ValueError) as exc:
			quote_warnings = []
			quote_error_message = str(exc)
		else:
			if quote.price > 0:
				if not quote_warnings:
					self.fx_cache.set(cache_key, float(quote.price), ttl_seconds=self.fx_ttl_seconds)
				return float(quote.price), quote_warnings
			quote_error_message = f"No FX rate returned for {from_code}/{to_code}."

		try:
			rate = await self.fx_provider.fetch_rate(from_code, to_code)
		except QuoteLookupError as exc:
			stale_rate = self.fx_cache.get_stale(cache_key)
			combined_error = "; ".join(
				part for part in (quote_error_message, str(exc)) if part
			)
			if stale_rate is not None:
				return stale_rate, [
					f"{from_code}/{to_code} 汇率源不可用，已回退到最近缓存值: {combined_error}",
				]
			raise QuoteLookupError(
				combined_error or f"No FX rate returned for {from_code}/{to_code}.",
			) from exc

		self.fx_cache.set(cache_key, rate, ttl_seconds=self.fx_ttl_seconds)
		return rate, []
