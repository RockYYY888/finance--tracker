import asyncio
from datetime import datetime, timezone

import pytest

import app.main as main
from app.models import SecurityHolding
from app.services.cache import TTLCache
from app.services.market_data import (
	BitgetQuoteProvider,
	EastMoneySecuritySearchProvider,
	MarketDataClient,
	Quote,
	QuoteLookupError,
	SecuritySearchResult,
	build_eastmoney_secid,
	build_local_search_results,
	build_fx_symbol,
	infer_security_market,
	normalize_symbol_for_market,
	normalize_symbol,
	parse_eastmoney_search_item,
)


def _make_quote(
	symbol: str = "AAPL",
	price: float = 100.0,
	currency: str = "USD",
) -> Quote:
	return Quote(
		symbol=symbol,
		name=symbol,
		price=price,
		currency=currency,
		market_time=datetime(2026, 2, 28, tzinfo=timezone.utc),
	)


class SequenceQuoteProvider:
	def __init__(self, outcomes: list[object]) -> None:
		self._outcomes = outcomes
		self.calls = 0
		self.symbols: list[str] = []

	async def fetch_quote(self, symbol: str) -> Quote:
		self.calls += 1
		self.symbols.append(symbol)
		outcome = self._outcomes[min(self.calls - 1, len(self._outcomes) - 1)]
		if isinstance(outcome, Exception):
			raise outcome
		return outcome


class SequenceRateProvider:
	def __init__(self, outcomes: list[object]) -> None:
		self._outcomes = outcomes
		self.calls = 0
		self.pairs: list[tuple[str, str]] = []

	async def fetch_rate(self, from_currency: str, to_currency: str) -> float:
		self.calls += 1
		self.pairs.append((from_currency, to_currency))
		outcome = self._outcomes[min(self.calls - 1, len(self._outcomes) - 1)]
		if isinstance(outcome, Exception):
			raise outcome
		return outcome


class SequenceSearchProvider:
	def __init__(self, outcomes: list[object]) -> None:
		self._outcomes = outcomes
		self.calls = 0
		self.queries: list[str] = []

	async def search(self, query: str) -> list[SecuritySearchResult]:
		self.calls += 1
		self.queries.append(query)
		outcome = self._outcomes[min(self.calls - 1, len(self._outcomes) - 1)]
		if isinstance(outcome, Exception):
			raise outcome
		return outcome


def test_build_fx_symbol_uses_yahoo_pair_format() -> None:
	assert build_fx_symbol("hkd", "cny") == "HKDCNY=X"


def test_coerce_utc_datetime_treats_naive_values_as_utc() -> None:
	naive_timestamp = datetime(2026, 3, 1, 8, 0, 0)
	normalized_timestamp = main._coerce_utc_datetime(naive_timestamp)

	assert normalized_timestamp.tzinfo == timezone.utc
	assert normalized_timestamp.hour == 8


@pytest.mark.parametrize(
	("raw_symbol", "expected"),
	[
		("sh600519", "600519.SS"),
		("700", "0700.HK"),
		("02015.HK", "2015.HK"),
		("09988", "9988.HK"),
		("brk-b", "BRK-B"),
	],
)
def test_normalize_symbol_supports_common_market_formats(
	raw_symbol: str,
	expected: str,
) -> None:
	assert normalize_symbol(raw_symbol) == expected


def test_normalize_symbol_rejects_obviously_invalid_values() -> None:
	with pytest.raises(ValueError, match="Invalid symbol format"):
		normalize_symbol("bad symbol!")


def test_infer_security_market_uses_symbol_and_exchange_hints() -> None:
	assert infer_security_market("0700.HK") == "HK"
	assert infer_security_market("600519.SS") == "CN"
	assert infer_security_market("AAPL", "NMS") == "US"
	assert infer_security_market("BTC-USD") == "CRYPTO"


def test_normalize_symbol_for_market_maps_crypto_aliases_to_usd_pairs() -> None:
	assert normalize_symbol_for_market("btc", "CRYPTO") == "BTC-USD"
	assert normalize_symbol_for_market("eth/usdt", "CRYPTO") == "ETH-USD"


def test_build_eastmoney_secid_maps_cn_and_hk_symbols() -> None:
	assert build_eastmoney_secid("0700.HK") == "116.00700"
	assert build_eastmoney_secid("600519.SS") == "1.600519"
	assert build_eastmoney_secid("300750.SZ") == "0.300750"


def test_fetch_quote_uses_fresh_cache_before_calling_provider() -> None:
	provider = SequenceQuoteProvider([_make_quote()])
	client = MarketDataClient(
		quote_provider=provider,
		quote_ttl_seconds=60,
	)

	first_quote, first_warnings = asyncio.run(client.fetch_quote("aapl"))
	second_quote, second_warnings = asyncio.run(client.fetch_quote("AAPL"))

	assert first_quote.price == 100.0
	assert second_quote.price == 100.0
	assert first_warnings == []
	assert second_warnings == []
	assert provider.calls == 1
	assert provider.symbols == ["AAPL"]


def test_fetch_quote_refreshes_after_cache_expiry() -> None:
	clock = [0.0]
	provider = SequenceQuoteProvider([
		_make_quote(price=100.0),
		_make_quote(price=101.5),
	])
	client = MarketDataClient(
		quote_provider=provider,
		quote_cache=TTLCache[Quote](now=lambda: clock[0]),
		quote_ttl_seconds=30,
	)

	first_quote, _ = asyncio.run(client.fetch_quote("AAPL"))
	clock[0] = 31.0
	second_quote, _ = asyncio.run(client.fetch_quote("AAPL"))

	assert first_quote.price == 100.0
	assert second_quote.price == 101.5
	assert provider.calls == 2


def test_fetch_quote_returns_stale_cache_when_provider_fails() -> None:
	clock = [0.0]
	provider = SequenceQuoteProvider([
		_make_quote(price=88.8),
		QuoteLookupError("provider down"),
	])
	client = MarketDataClient(
		quote_provider=provider,
		quote_cache=TTLCache[Quote](now=lambda: clock[0]),
		quote_ttl_seconds=30,
	)

	cached_quote, _ = asyncio.run(client.fetch_quote("AAPL"))
	clock[0] = 31.0
	fallback_quote, warnings = asyncio.run(client.fetch_quote("AAPL"))

	assert cached_quote.price == 88.8
	assert fallback_quote.price == 88.8
	assert warnings == ["AAPL 行情源不可用，已回退到最近缓存值: provider down"]
	assert provider.calls == 2


def test_fetch_quote_prefers_china_provider_for_hk_symbols() -> None:
	primary_provider = SequenceQuoteProvider([QuoteLookupError("rate limited")])
	fallback_provider = SequenceQuoteProvider([
		_make_quote(symbol="0700.HK", price=518.0, currency="HKD"),
	])
	client = MarketDataClient(
		quote_provider=primary_provider,
		fallback_quote_provider=fallback_provider,
	)

	quote, warnings = asyncio.run(client.fetch_quote("0700.HK"))

	assert quote.symbol == "0700.HK"
	assert quote.price == 518.0
	assert quote.currency == "HKD"
	assert warnings == []
	assert primary_provider.calls == 0
	assert fallback_provider.calls == 1


def test_fetch_quote_retries_china_provider_once_before_failing() -> None:
	fallback_provider = SequenceQuoteProvider([
		QuoteLookupError("temporary timeout"),
		_make_quote(symbol="2015.HK", price=68.75, currency="HKD"),
	])
	client = MarketDataClient(
		fallback_quote_provider=fallback_provider,
	)

	quote, warnings = asyncio.run(client.fetch_quote("2015.HK"))

	assert quote.symbol == "2015.HK"
	assert quote.price == 68.75
	assert quote.currency == "HKD"
	assert warnings == []
	assert fallback_provider.calls == 2


def test_clear_runtime_caches_clears_quote_and_fx_but_keeps_search_by_default() -> None:
	client = MarketDataClient()
	client.quote_cache.set("AAPL", _make_quote(), ttl_seconds=60)
	client.fx_cache.set("USD:CNY", 7.2, ttl_seconds=60)
	client.search_cache.set("aapl", [], ttl_seconds=60)

	client.clear_runtime_caches()

	assert client.quote_cache.get("AAPL") is None
	assert client.quote_cache.get_stale("AAPL") is not None
	assert client.fx_cache.get("USD:CNY") is None
	assert client.fx_cache.get_stale("USD:CNY") == 7.2
	assert client.search_cache.get("aapl") == []


def test_clear_runtime_caches_keeps_search_stale_when_requested() -> None:
	client = MarketDataClient()
	client.search_cache.set("aapl", [], ttl_seconds=60)

	client.clear_runtime_caches(clear_search=True)

	assert client.search_cache.get("aapl") is None
	assert client.search_cache.get_stale("aapl") == []


def test_fetch_quote_prefers_crypto_provider_for_crypto_symbols() -> None:
	primary_provider = SequenceQuoteProvider([QuoteLookupError("rate limited")])
	crypto_provider = SequenceQuoteProvider([
		_make_quote(symbol="BTC-USD", price=84500.0, currency="USD"),
	])
	client = MarketDataClient(
		quote_provider=primary_provider,
		crypto_quote_provider=crypto_provider,
	)

	quote, warnings = asyncio.run(client.fetch_quote("BTC-USD"))

	assert quote.symbol == "BTC-USD"
	assert quote.price == 84500.0
	assert quote.currency == "USD"
	assert warnings == []
	assert primary_provider.calls == 0
	assert crypto_provider.calls == 1


def test_search_securities_uses_cache_before_calling_provider() -> None:
	results = [
		SecuritySearchResult(
			symbol="0700.HK",
			name="Tencent Holdings",
			market="HK",
			currency="HKD",
			exchange="HKG",
		),
	]
	provider = SequenceSearchProvider([results])
	client = MarketDataClient(
		china_search_provider=SequenceSearchProvider([[]]),
		search_provider=provider,
	)

	first_results = asyncio.run(client.search_securities("bad symbol!"))
	second_results = asyncio.run(client.search_securities("Bad Symbol!"))

	assert first_results == results
	assert second_results == results
	assert provider.calls == 1
	assert provider.queries == ["bad symbol!"]


def test_search_securities_returns_local_alias_when_provider_fails() -> None:
	client = MarketDataClient(
		china_search_provider=SequenceSearchProvider([[]]),
		search_provider=SequenceSearchProvider([QuoteLookupError("rate limited")]),
	)

	results = asyncio.run(client.search_securities("腾讯"))

	assert results[0].symbol == "0700.HK"
	assert results[0].name == "腾讯控股"


def test_search_securities_returns_empty_list_when_provider_fails_without_local_match() -> None:
	client = MarketDataClient(
		china_search_provider=SequenceSearchProvider([QuoteLookupError("rate limited")]),
		search_provider=SequenceSearchProvider([QuoteLookupError("rate limited")]),
	)

	results = asyncio.run(client.search_securities("unmatched query"))

	assert results == []


def test_build_local_search_results_supports_symbol_fallback() -> None:
	results = build_local_search_results("700")

	assert results[0].symbol == "0700.HK"


def test_build_local_search_results_supports_crypto_aliases() -> None:
	results = build_local_search_results("比特币")

	assert results[0].symbol == "BTC-USD"
	assert results[0].source == "Bitget"


def test_search_securities_skips_global_provider_when_local_matches_exist() -> None:
	local_query = "btc"
	global_provider = SequenceSearchProvider([[
		SecuritySearchResult(
			symbol="BTC-USD",
			name="Bitcoin",
			market="CRYPTO",
			currency="USD",
			exchange="CCC",
			source="Yahoo Finance",
		),
	]])
	client = MarketDataClient(
		china_search_provider=SequenceSearchProvider([[]]),
		search_provider=global_provider,
	)

	results = asyncio.run(client.search_securities(local_query))

	assert len(results) == 1
	assert results[0].source == "Bitget"
	assert global_provider.calls == 0


def test_build_local_search_results_supports_usdt_alias() -> None:
	results = build_local_search_results("usdt")

	assert results[0].symbol == "USDT-USD"
	assert results[0].market == "CRYPTO"
	assert results[0].source == "Bitget"


def test_fetch_quote_uses_crypto_market_hint_for_stablecoin_symbol() -> None:
	client = MarketDataClient(
		quote_provider=SequenceQuoteProvider([QuoteLookupError("rate limited")]),
		crypto_quote_provider=BitgetQuoteProvider(),
	)

	quote, warnings = asyncio.run(client.fetch_quote("USDT", "CRYPTO"))

	assert quote.symbol == "USDT-USD"
	assert quote.price == 1.0
	assert quote.currency == "USD"
	assert warnings == []


def test_parse_eastmoney_search_item_maps_a_share_codes() -> None:
	result = parse_eastmoney_search_item({
		"Code": "688256",
		"Name": "寒武纪-U",
		"QuoteID": "1.688256",
		"JYS": "23",
	})

	assert result is not None
	assert result.symbol == "688256.SS"
	assert result.market == "CN"


def test_parse_eastmoney_search_item_maps_hk_codes() -> None:
	result = parse_eastmoney_search_item({
		"Code": "02015",
		"Name": "理想汽车-W",
		"QuoteID": "116.02015",
		"JYS": "HK",
		"Classify": "HK",
	})

	assert result is not None
	assert result.symbol == "2015.HK"
	assert result.market == "HK"


def test_fetch_fx_rate_returns_stale_cache_when_providers_fail() -> None:
	clock = [0.0]
	client = MarketDataClient(
		quote_provider=SequenceQuoteProvider([QuoteLookupError("quote down")]),
		fx_provider=SequenceRateProvider([QuoteLookupError("fx down")]),
		quote_cache=TTLCache[Quote](now=lambda: clock[0]),
		fx_cache=TTLCache[float](now=lambda: clock[0]),
		fx_ttl_seconds=300,
	)
	client.fx_cache.set("USD:CNY", 7.2, ttl_seconds=300)

	clock[0] = 301.0
	rate, warnings = asyncio.run(client.fetch_fx_rate("usd", "cny"))

	assert rate == 7.2
	assert warnings == [
		"USD/CNY 汇率源不可用，已回退到最近缓存值: fx down",
	]


def test_fetch_fx_rate_raises_when_no_cache_and_providers_fail() -> None:
	client = MarketDataClient(
		quote_provider=SequenceQuoteProvider([QuoteLookupError("quote down")]),
		fx_provider=SequenceRateProvider([QuoteLookupError("fx down")]),
	)

	with pytest.raises(QuoteLookupError, match="fx down"):
		asyncio.run(client.fetch_fx_rate("USD", "CNY"))


class FailingMarketDataClient:
	async def fetch_quote(
		self,
		symbol: str,
		market: str | None = None,
	) -> tuple[Quote, list[str]]:
		raise QuoteLookupError("provider down")

	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		raise AssertionError("FX lookup should not run when quote lookup fails.")


def test_value_holdings_turns_provider_failure_into_warning(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	holding = SecurityHolding(
		user_id="tester",
		symbol="AAPL",
		name="Apple",
		quantity=2,
		fallback_currency="USD",
	)
	monkeypatch.setattr(main, "market_data_client", FailingMarketDataClient())

	items, total, warnings = asyncio.run(main._value_holdings([holding]))

	assert total == 0.0
	assert items[0].price == 0.0
	assert items[0].fx_to_cny == 0.0
	assert items[0].price_currency == "USD"
	assert warnings == ["持仓 AAPL 行情更新中"]
