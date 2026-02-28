from app.services.market_data import build_fx_symbol


def test_build_fx_symbol_uses_yahoo_pair_format() -> None:
	assert build_fx_symbol("hkd", "cny") == "HKDCNY=X"
