from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx


class QuoteLookupError(RuntimeError):
	"""Raised when the remote quote provider cannot value a symbol."""


def build_fx_symbol(from_currency: str, to_currency: str) -> str:
	"""Translate a currency pair into a Yahoo Finance symbol."""
	return f"{from_currency.upper()}{to_currency.upper()}=X"


@dataclass(slots=True)
class Quote:
	symbol: str
	name: str
	price: float
	currency: str
	market_time: datetime | None


class MarketDataClient:
	YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
	FRANKFURTER_URL = "https://api.frankfurter.app/latest"

	async def fetch_quote(self, symbol: str) -> Quote:
		"""Fetch the latest quote from Yahoo's public quote endpoint."""
		async with httpx.AsyncClient(timeout=10) as client:
			response = await client.get(
				self.YAHOO_QUOTE_URL,
				params={"symbols": symbol},
				headers={"User-Agent": "Mozilla/5.0"},
			)
			response.raise_for_status()
			payload = response.json()

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

	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> float:
		"""Fetch a conversion rate to CNY, preferring intraday Yahoo data and falling back to ECB data."""
		from_code = from_currency.upper()
		to_code = to_currency.upper()
		if from_code == to_code:
			return 1.0

		try:
			quote = await self.fetch_quote(build_fx_symbol(from_code, to_code))
			if quote.price > 0:
				return float(quote.price)
		except (QuoteLookupError, httpx.HTTPError):
			pass

		async with httpx.AsyncClient(timeout=10) as client:
			response = await client.get(
				self.FRANKFURTER_URL,
				params={"from": from_code, "to": to_code},
			)
			response.raise_for_status()
			payload = response.json()

		rate = payload.get("rates", {}).get(to_code)
		if rate in (None, 0):
			raise QuoteLookupError(f"No FX rate returned for {from_code}/{to_code}.")

		return float(rate)
