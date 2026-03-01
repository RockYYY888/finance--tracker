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
SEARCHABLE_QUOTE_TYPES = {"EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY"}
US_EXCHANGES = {"NMS", "NGM", "NYQ", "ASE", "PCX", "BTS", "NCM", "NSQ", "OOTC", "PNK"}
CRYPTO_EXCHANGES = {"CCC", "CCY", "CRY", "COIN"}
EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8"
BITGET_EXCHANGE = "BITGET"
BITGET_SOURCE_LABEL = "Bitget"
BITGET_STABLE_QUOTES = {"USDT", "USDC"}


class QuoteLookupError(RuntimeError):
	"""Raised when the market data providers cannot return a usable value."""


def build_fx_symbol(from_currency: str, to_currency: str) -> str:
	"""Translate a currency pair into a Yahoo Finance symbol."""
	return f"{from_currency.upper()}{to_currency.upper()}=X"


def _normalize_hk_code(raw_code: str) -> str:
	"""Normalize HK numeric codes to a canonical 4+ digit form without extra leading zeroes."""
	return str(int(raw_code)).zfill(4)


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
		return f"{_normalize_hk_code(match.group(1))}.HK"

	if re.fullmatch(r"^\d{6}\.(SS|SZ)$", candidate):
		return candidate

	if re.fullmatch(r"^\d{1,5}\.HK$", candidate):
		code, _, _ = candidate.partition(".")
		return f"{_normalize_hk_code(code)}.HK"

	if re.fullmatch(r"^\d{6}$", candidate):
		suffix = "SS" if candidate[0] in {"5", "6", "9"} else "SZ"
		return f"{candidate}.{suffix}"

	if re.fullmatch(r"^\d{1,5}$", candidate):
		return f"{_normalize_hk_code(candidate)}.HK"

	if re.fullmatch(r"^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$", candidate):
		return candidate

	raise ValueError(INVALID_SYMBOL_MESSAGE)


def build_eastmoney_secid(symbol: str) -> str:
	"""Map normalized CN/HK symbols into Eastmoney's secid format."""
	normalized_symbol = normalize_symbol(symbol)

	if normalized_symbol.endswith(".SS"):
		return f"1.{normalized_symbol.removesuffix('.SS')}"
	if normalized_symbol.endswith(".SZ"):
		return f"0.{normalized_symbol.removesuffix('.SZ')}"
	if normalized_symbol.endswith(".HK"):
		code = normalized_symbol.removesuffix(".HK")
		return f"116.{code.zfill(5)}"

	raise ValueError(f"Eastmoney quote does not support symbol {normalized_symbol}.")


def build_bitget_symbol(symbol: str) -> str:
	"""Map app-level crypto symbols into Bitget's spot symbol format."""
	normalized_symbol = normalize_symbol_for_market(symbol, "CRYPTO")
	base, _, _quote = normalized_symbol.partition("-")
	quote_currency = "USDT" if "USDT" in BITGET_STABLE_QUOTES else sorted(BITGET_STABLE_QUOTES)[0]
	return f"{base}{quote_currency}"


def _parse_epoch_millis(value: str | int | float | None) -> datetime | None:
	if value in (None, ""):
		return None

	try:
		numeric_value = int(float(value))
	except (TypeError, ValueError):
		return None

	if numeric_value <= 0:
		return None

	if numeric_value > 10_000_000_000:
		return datetime.fromtimestamp(numeric_value / 1000, tz=timezone.utc)

	return datetime.fromtimestamp(numeric_value, tz=timezone.utc)


@dataclass(slots=True)
class Quote:
	symbol: str
	name: str
	price: float
	currency: str
	market_time: datetime | None


@dataclass(slots=True)
class SecuritySearchResult:
	symbol: str
	name: str
	market: str
	currency: str
	exchange: str | None
	source: str | None = None


LOCAL_SEARCH_CATALOG = (
	(
		("腾讯", "腾讯控股", "tencent"),
		SecuritySearchResult(
			symbol="0700.HK",
			name="腾讯控股",
			market="HK",
			currency="HKD",
			exchange="HKG",
			source="本地映射",
		),
	),
	(
		("阿里", "阿里巴巴", "alibaba"),
		SecuritySearchResult(
			symbol="9988.HK",
			name="阿里巴巴-SW",
			market="HK",
			currency="HKD",
			exchange="HKG",
			source="本地映射",
		),
	),
	(
		("苹果", "apple", "aapl"),
		SecuritySearchResult(
			symbol="AAPL",
			name="Apple Inc.",
			market="US",
			currency="USD",
			exchange="NMS",
			source="本地映射",
		),
	),
	(
		("英伟达", "nvidia", "nvda"),
		SecuritySearchResult(
			symbol="NVDA",
			name="NVIDIA Corporation",
			market="US",
			currency="USD",
			exchange="NMS",
			source="本地映射",
		),
	),
	(
		("特斯拉", "tesla", "tsla"),
		SecuritySearchResult(
			symbol="TSLA",
			name="Tesla, Inc.",
			market="US",
			currency="USD",
			exchange="NMS",
			source="本地映射",
		),
	),
	(
		("小米", "xiaomi"),
		SecuritySearchResult(
			symbol="1810.HK",
			name="小米集团-W",
			market="HK",
			currency="HKD",
			exchange="HKG",
			source="本地映射",
		),
	),
	(
		("茅台", "贵州茅台", "kweichow moutai"),
		SecuritySearchResult(
			symbol="600519.SS",
			name="贵州茅台",
			market="CN",
			currency="CNY",
			exchange="SHH",
			source="本地映射",
		),
	),
	(
		("理想", "理想汽车", "li auto", "li"),
		SecuritySearchResult(
			symbol="2015.HK",
			name="理想汽车-W",
			market="HK",
			currency="HKD",
			exchange="HKG",
			source="本地映射",
		),
	),
	(
		("寒武纪", "cambricon"),
		SecuritySearchResult(
			symbol="688256.SS",
			name="寒武纪-U",
			market="CN",
			currency="CNY",
			exchange="SHH",
			source="本地映射",
		),
	),
	(
		("比特币", "btc", "bitcoin"),
		SecuritySearchResult(
			symbol="BTC-USD",
			name="Bitcoin",
			market="CRYPTO",
			currency="USD",
			exchange=BITGET_EXCHANGE,
			source=BITGET_SOURCE_LABEL,
		),
	),
	(
		("以太坊", "eth", "ethereum"),
		SecuritySearchResult(
			symbol="ETH-USD",
			name="Ethereum",
			market="CRYPTO",
			currency="USD",
			exchange=BITGET_EXCHANGE,
			source=BITGET_SOURCE_LABEL,
		),
	),
	(
		("usdt", "泰达币", "tether"),
		SecuritySearchResult(
			symbol="USDT-USD",
			name="Tether USDt",
			market="CRYPTO",
			currency="USD",
			exchange=BITGET_EXCHANGE,
			source=BITGET_SOURCE_LABEL,
		),
	),
	(
		("usdc", "usd coin"),
		SecuritySearchResult(
			symbol="USDC-USD",
			name="USD Coin",
			market="CRYPTO",
			currency="USD",
			exchange=BITGET_EXCHANGE,
			source=BITGET_SOURCE_LABEL,
		),
	),
)


def _default_currency_for_market(market: str) -> str:
	if market == "CRYPTO":
		return "USD"
	if market == "HK":
		return "HKD"
	if market == "US":
		return "USD"
	return "CNY"


def normalize_symbol_for_market(symbol: str, market: str | None = None) -> str:
	"""Normalize symbols with market-specific handling for crypto pairs."""
	normalized_market = (market or "").strip().upper()
	candidate = symbol.strip().upper()

	if normalized_market == "CRYPTO":
		if re.fullmatch(r"^[A-Z0-9]{2,15}$", candidate):
			return f"{candidate}-USD"

		if re.fullmatch(r"^[A-Z0-9]{2,15}[-/](USD|USDT|USDC)$", candidate):
			base = re.split(r"[-/]", candidate, maxsplit=1)[0]
			return f"{base}-USD"

	return normalize_symbol(candidate)


def infer_security_market(
	symbol: str,
	exchange: str | None = None,
	quote_type: str | None = None,
) -> str:
	"""Infer a frontend-friendly market code from quote metadata."""
	normalized_symbol = symbol.strip().upper()
	normalized_exchange = (exchange or "").strip().upper()
	normalized_quote_type = (quote_type or "").strip().upper()

	if normalized_quote_type == "CRYPTOCURRENCY" or normalized_exchange in CRYPTO_EXCHANGES:
		return "CRYPTO"
	if re.fullmatch(r"^[A-Z0-9]{2,15}-(USD|USDT|USDC)$", normalized_symbol):
		return "CRYPTO"

	if normalized_symbol.endswith(".HK") or normalized_exchange.startswith("HKG"):
		return "HK"
	if normalized_symbol.endswith(".SS") or normalized_symbol.endswith(".SZ"):
		return "CN"
	if normalized_exchange in {
		"SHH",
		"SHZ",
		"SHANGHAI",
		"SHENZHEN",
		"SHA",
		"SHE",
	}:
		return "CN"
	if normalized_exchange in US_EXCHANGES:
		return "US"
	if not normalized_exchange and re.fullmatch(r"^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$", normalized_symbol):
		return "US"
	return "OTHER"


def parse_eastmoney_search_item(item: dict[str, str]) -> SecuritySearchResult | None:
	"""Convert Eastmoney's search payload into the app's normalized search result."""
	code = str(item.get("Code") or "").strip().upper()
	name = str(item.get("Name") or "").strip()
	if not code or not name:
		return None

	quote_id = str(item.get("QuoteID") or "").strip()
	classify = str(item.get("Classify") or "").strip().upper()
	jys = str(item.get("JYS") or "").strip().upper()
	exchange_name = jys or None

	if classify == "NEEQ":
		return None

	if quote_id.startswith("1."):
		return SecuritySearchResult(
			symbol=f"{code}.SS",
			name=name,
			market="CN",
			currency="CNY",
			exchange=exchange_name or "SHH",
			source="东方财富",
		)

	if quote_id.startswith("0."):
		return SecuritySearchResult(
			symbol=f"{code}.SZ",
			name=name,
			market="CN",
			currency="CNY",
			exchange=exchange_name or "SHE",
			source="东方财富",
		)

	if classify == "HK" or jys == "HK" or quote_id.startswith("116."):
		return SecuritySearchResult(
			symbol=normalize_symbol(f"{code}.HK"),
			name=name,
			market="HK",
			currency="HKD",
			exchange=exchange_name or "HKG",
			source="东方财富",
		)

	if classify == "USSTOCK" or jys in US_EXCHANGES or quote_id.startswith("105."):
		return SecuritySearchResult(
			symbol=normalize_symbol(code),
			name=name,
			market="US",
			currency="USD",
			exchange=exchange_name,
			source="东方财富",
		)

	return None


def _merge_search_results(
	primary_results: list[SecuritySearchResult],
	secondary_results: list[SecuritySearchResult],
) -> list[SecuritySearchResult]:
	merged_results: list[SecuritySearchResult] = []
	seen_symbols: set[str] = set()

	for result in [*primary_results, *secondary_results]:
		dedupe_key = (
			f"{result.symbol}::{result.source or ''}"
			if result.market == "CRYPTO"
			else result.symbol
		)
		if dedupe_key in seen_symbols:
			continue
		merged_results.append(result)
		seen_symbols.add(dedupe_key)

	return merged_results


def _contains_cjk_characters(value: str) -> bool:
	return any("\u4e00" <= character <= "\u9fff" for character in value)


def build_local_search_results(query: str) -> list[SecuritySearchResult]:
	"""Fallback suggestions for symbol-like input and common names."""
	normalized_query = query.strip().casefold()
	if not normalized_query:
		return []

	results: list[SecuritySearchResult] = []
	for keywords, result in LOCAL_SEARCH_CATALOG:
		if any(normalized_query in keyword or keyword in normalized_query for keyword in keywords):
			results.append(result)

	if not any(result.market == "CRYPTO" for result in results):
		try:
			symbol = normalize_symbol(query)
		except ValueError:
			pass
		else:
			market = infer_security_market(symbol)
			if market != "OTHER":
				results.append(
					SecuritySearchResult(
						symbol=symbol,
						name=symbol,
						market=market,
						currency=_default_currency_for_market(market),
						exchange=BITGET_EXCHANGE if market == "CRYPTO" else None,
						source=BITGET_SOURCE_LABEL if market == "CRYPTO" else None,
					),
				)

	return _merge_search_results(results, [])


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


class EastMoneyQuoteProvider:
	EASTMONEY_QUOTE_URL = "https://push2.eastmoney.com/api/qt/stock/get"

	def __init__(self, timeout: float = 10.0) -> None:
		self.timeout = timeout

	async def fetch_quote(self, symbol: str) -> Quote:
		"""Fetch CN/HK quotes from Eastmoney when the primary source is unavailable."""
		try:
			secid = build_eastmoney_secid(symbol)
		except ValueError as exc:
			raise QuoteLookupError(str(exc)) from exc

		normalized_symbol = normalize_symbol(symbol)

		try:
			async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
				response = await client.get(
					self.EASTMONEY_QUOTE_URL,
					params={"secid": secid, "fields": "f43,f57,f58"},
					headers={
						"User-Agent": "Mozilla/5.0",
						"Referer": "https://quote.eastmoney.com/",
					},
				)
				response.raise_for_status()
				payload = response.json()
		except httpx.HTTPError as exc:
			raise QuoteLookupError(
				f"Eastmoney quote request failed for {normalized_symbol}.",
			) from exc

		data = payload.get("data") or {}
		raw_price = data.get("f43")
		raw_name = data.get("f58")
		if raw_price in (None, 0):
			raise QuoteLookupError(f"No Eastmoney quote data returned for {normalized_symbol}.")

		scale = 1000 if normalized_symbol.endswith(".HK") else 100
		price = float(raw_price) / scale
		if price <= 0:
			raise QuoteLookupError(f"Incomplete Eastmoney quote data returned for {normalized_symbol}.")

		return Quote(
			symbol=normalized_symbol,
			name=str(raw_name or normalized_symbol).strip() or normalized_symbol,
			price=price,
			currency="HKD" if normalized_symbol.endswith(".HK") else "CNY",
			market_time=datetime.now(timezone.utc),
		)


class BitgetQuoteProvider:
	BITGET_TICKER_URL = "https://api.bitget.com/api/v2/spot/market/tickers"

	def __init__(self, timeout: float = 10.0) -> None:
		self.timeout = timeout

	async def fetch_quote(self, symbol: str) -> Quote:
		"""Fetch spot crypto quotes from Bitget's public market endpoint."""
		normalized_symbol = normalize_symbol_for_market(symbol, "CRYPTO")
		base, _, _quote = normalized_symbol.partition("-")
		if base in BITGET_STABLE_QUOTES:
			return Quote(
				symbol=normalized_symbol,
				name="Tether USDt" if base == "USDT" else "USD Coin",
				price=1.0,
				currency="USD",
				market_time=datetime.now(timezone.utc),
			)

		bitget_symbol = build_bitget_symbol(normalized_symbol)

		try:
			async with httpx.AsyncClient(timeout=self.timeout) as client:
				response = await client.get(
					self.BITGET_TICKER_URL,
					params={"symbol": bitget_symbol},
					headers={"User-Agent": "Mozilla/5.0"},
				)
				response.raise_for_status()
				payload = response.json()
		except httpx.HTTPError as exc:
			raise QuoteLookupError(f"Bitget quote request failed for {normalized_symbol}.") from exc

		if str(payload.get("code") or "").strip() not in {"", "00000"}:
			raise QuoteLookupError(f"Bitget quote request failed for {normalized_symbol}.")

		data = payload.get("data") or {}
		if isinstance(data, list):
			data = data[0] if data else {}

		raw_price = data.get("close") or data.get("lastPr") or data.get("last")
		if raw_price in (None, "", 0, "0"):
			raise QuoteLookupError(f"No Bitget quote data returned for {normalized_symbol}.")

		try:
			price = float(raw_price)
		except (TypeError, ValueError) as exc:
			raise QuoteLookupError(
				f"Incomplete Bitget quote data returned for {normalized_symbol}.",
			) from exc

		if price <= 0:
			raise QuoteLookupError(f"Incomplete Bitget quote data returned for {normalized_symbol}.")

		return Quote(
			symbol=normalized_symbol,
			name=base,
			price=price,
			currency="USD",
			market_time=_parse_epoch_millis(
				data.get("ts") or data.get("timestamp") or payload.get("requestTime"),
			),
		)


class YahooSecuritySearchProvider:
	YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"

	def __init__(self, timeout: float = 10.0) -> None:
		self.timeout = timeout

	async def search(self, query: str) -> list[SecuritySearchResult]:
		"""Search Yahoo's public security lookup feed."""
		if not query.strip():
			return []

		try:
			async with httpx.AsyncClient(timeout=self.timeout) as client:
				response = await client.get(
					self.YAHOO_SEARCH_URL,
					params={
						"q": query,
						"quotesCount": 8,
						"newsCount": 0,
						"enableFuzzyQuery": False,
					},
					headers={"User-Agent": "Mozilla/5.0"},
				)
				response.raise_for_status()
				payload = response.json()
		except httpx.HTTPError as exc:
			raise QuoteLookupError(f"Security search request failed for {query}.") from exc

		results: list[SecuritySearchResult] = []
		seen_symbols: set[str] = set()

		for item in payload.get("quotes", []):
			raw_symbol = str(item.get("symbol") or "").strip()
			quote_type = str(item.get("quoteType") or "").strip().upper()
			if not raw_symbol or (quote_type and quote_type not in SEARCHABLE_QUOTE_TYPES):
				continue

			try:
				symbol = normalize_symbol_for_market(raw_symbol, "CRYPTO" if quote_type == "CRYPTOCURRENCY" else None)
			except ValueError:
				continue

			if symbol in seen_symbols:
				continue

			name = str(item.get("shortname") or item.get("longname") or symbol).strip()
			exchange = str(item.get("exchange") or "").strip() or None
			market = infer_security_market(symbol, exchange, quote_type)
			if market == "OTHER":
				continue
			currency = str(item.get("currency") or "").strip().upper() or _default_currency_for_market(
				market,
			)
			results.append(
				SecuritySearchResult(
					symbol=symbol,
					name=name,
					market=market,
					currency=currency,
					exchange=exchange,
					source="Yahoo Finance",
				),
			)
			seen_symbols.add(symbol)

		return results


class EastMoneySecuritySearchProvider:
	EASTMONEY_SEARCH_URL = "https://searchapi.eastmoney.com/api/suggest/get"

	def __init__(self, timeout: float = 10.0) -> None:
		self.timeout = timeout

	async def search(self, query: str) -> list[SecuritySearchResult]:
		"""Search A-share/HK/US symbols via Eastmoney's public suggestion endpoint."""
		if not query.strip():
			return []

		try:
			async with httpx.AsyncClient(timeout=self.timeout) as client:
				response = await client.get(
					self.EASTMONEY_SEARCH_URL,
					params={
						"input": query,
						"type": "14",
						"count": "10",
						"token": EASTMONEY_SEARCH_TOKEN,
					},
					headers={
						"User-Agent": "Mozilla/5.0",
						"Referer": "https://quote.eastmoney.com/",
					},
				)
				response.raise_for_status()
				payload = response.json()
		except httpx.HTTPError as exc:
			raise QuoteLookupError(f"Eastmoney search request failed for {query}.") from exc

		results: list[SecuritySearchResult] = []
		seen_symbols: set[str] = set()

		for item in payload.get("QuotationCodeTable", {}).get("Data", []):
			parsed_result = parse_eastmoney_search_item(item)
			if parsed_result is None or parsed_result.symbol in seen_symbols:
				continue
			results.append(parsed_result)
			seen_symbols.add(parsed_result.symbol)

		return results


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
		fallback_quote_provider: EastMoneyQuoteProvider | None = None,
		crypto_quote_provider: BitgetQuoteProvider | None = None,
		china_search_provider: EastMoneySecuritySearchProvider | None = None,
		search_provider: YahooSecuritySearchProvider | None = None,
		fx_provider: FrankfurterRateProvider | None = None,
		quote_cache: TTLCache[Quote] | None = None,
		search_cache: TTLCache[list[SecuritySearchResult]] | None = None,
		fx_cache: TTLCache[float] | None = None,
		quote_ttl_seconds: int = 60,
		search_ttl_seconds: int = 300,
		fx_ttl_seconds: int = 600,
	) -> None:
		self.quote_provider = quote_provider or YahooQuoteProvider()
		self.fallback_quote_provider = fallback_quote_provider or EastMoneyQuoteProvider()
		self.crypto_quote_provider = crypto_quote_provider or BitgetQuoteProvider()
		self.china_search_provider = china_search_provider or EastMoneySecuritySearchProvider()
		self.search_provider = search_provider or YahooSecuritySearchProvider()
		self.fx_provider = fx_provider or FrankfurterRateProvider()
		self.quote_cache = quote_cache or TTLCache[Quote]()
		self.search_cache = search_cache or TTLCache[list[SecuritySearchResult]]()
		self.fx_cache = fx_cache or TTLCache[float]()
		self.quote_ttl_seconds = quote_ttl_seconds
		self.search_ttl_seconds = search_ttl_seconds
		self.fx_ttl_seconds = fx_ttl_seconds

	def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
		"""Clear short-lived runtime caches so a manual refresh can force new provider fetches."""
		self.quote_cache.clear()
		self.fx_cache.clear()
		if clear_search:
			self.search_cache.clear()

	async def fetch_quote(
		self,
		symbol: str,
		market: str | None = None,
	) -> tuple[Quote, list[str]]:
		"""Fetch a quote, preferring a fresh cache hit and falling back to stale data."""
		normalized_market = (market or "").strip().upper() or None
		normalized_symbol = normalize_symbol_for_market(symbol, normalized_market)
		resolved_market = normalized_market or infer_security_market(normalized_symbol)
		cached_quote = self.quote_cache.get(normalized_symbol)
		if cached_quote is not None:
			return cached_quote, []

		primary_provider = self.quote_provider
		secondary_provider = None
		if resolved_market in {"HK", "CN"}:
			primary_provider = self.fallback_quote_provider
		elif resolved_market == "CRYPTO":
			primary_provider = self.crypto_quote_provider
		else:
			if resolved_market in {"HK", "CN"}:
				secondary_provider = self.fallback_quote_provider
			elif resolved_market == "CRYPTO":
				secondary_provider = self.crypto_quote_provider

		try:
			quote = await primary_provider.fetch_quote(normalized_symbol)
		except QuoteLookupError as exc:
			if secondary_provider is self.fallback_quote_provider:
				try:
					quote = await self.fallback_quote_provider.fetch_quote(normalized_symbol)
				except QuoteLookupError as fallback_exc:
					combined_error = "; ".join((str(exc), str(fallback_exc)))
					stale_quote = self.quote_cache.get_stale(normalized_symbol)
					if stale_quote is not None:
						return stale_quote, [
							f"{normalized_symbol} 行情源不可用，已回退到最近缓存值: {combined_error}",
						]
					raise QuoteLookupError(combined_error) from fallback_exc
			elif secondary_provider is self.crypto_quote_provider:
				try:
					quote = await self.crypto_quote_provider.fetch_quote(normalized_symbol)
				except QuoteLookupError as crypto_exc:
					combined_error = "; ".join((str(exc), str(crypto_exc)))
					stale_quote = self.quote_cache.get_stale(normalized_symbol)
					if stale_quote is not None:
						return stale_quote, [
							f"{normalized_symbol} 行情源不可用，已回退到最近缓存值: {combined_error}",
						]
					raise QuoteLookupError(combined_error) from crypto_exc
			else:
				stale_quote = self.quote_cache.get_stale(normalized_symbol)
				if stale_quote is not None:
					return stale_quote, [
						f"{normalized_symbol} 行情源不可用，已回退到最近缓存值: {exc}",
					]
				raise
		else:
			self.quote_cache.set(normalized_symbol, quote, ttl_seconds=self.quote_ttl_seconds)
			return quote, []

		self.quote_cache.set(normalized_symbol, quote, ttl_seconds=self.quote_ttl_seconds)
		return quote, []

	async def search_securities(self, query: str) -> list[SecuritySearchResult]:
		"""Search securities by name or code with a short-lived cache."""
		normalized_query = query.strip()
		if not normalized_query:
			return []

		cache_key = normalized_query.casefold()
		cached_results = self.search_cache.get(cache_key)
		if cached_results is not None:
			return cached_results

		local_results = build_local_search_results(normalized_query)
		china_results: list[SecuritySearchResult] = []
		global_results: list[SecuritySearchResult] = []
		should_query_global_provider = not local_results and not _contains_cjk_characters(
			normalized_query,
		)

		try:
			china_results = await self.china_search_provider.search(normalized_query)
		except QuoteLookupError:
			china_results = []

		if should_query_global_provider:
			try:
				global_results = await self.search_provider.search(normalized_query)
			except QuoteLookupError:
				global_results = []

		results = _merge_search_results(local_results, _merge_search_results(china_results, global_results))
		self.search_cache.set(cache_key, results, ttl_seconds=self.search_ttl_seconds)
		return results

	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		"""Fetch an FX rate from the dedicated FX provider and fall back to stale cache."""
		from_code = from_currency.strip().upper()
		to_code = to_currency.strip().upper()
		if from_code == to_code:
			return 1.0, []

		cache_key = f"{from_code}:{to_code}"
		cached_rate = self.fx_cache.get(cache_key)
		if cached_rate is not None:
			return cached_rate, []

		try:
			rate = await self.fx_provider.fetch_rate(from_code, to_code)
		except (QuoteLookupError, ValueError) as exc:
			stale_rate = self.fx_cache.get_stale(cache_key)
			if stale_rate is not None:
				return stale_rate, [
					f"{from_code}/{to_code} 汇率源不可用，已回退到最近缓存值: {exc}",
				]
			raise

		self.fx_cache.set(cache_key, rate, ttl_seconds=self.fx_ttl_seconds)
		return rate, []
