import asyncio
from collections.abc import Iterator
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import SQLModel, Session, create_engine, select

import app.main as main
from app.main import (
	create_fixed_asset,
	_persist_hour_snapshot,
	_persist_holdings_return_snapshot,
	_summarize_holdings_return_state,
	create_liability,
	create_other_asset,
	create_account,
	create_holding,
	delete_account,
	delete_holding,
	update_account,
	update_holding,
)
from app.models import (
	CashAccount,
	FixedAsset,
	HoldingPerformanceSnapshot,
	LiabilityEntry,
	OtherAsset,
	PortfolioSnapshot,
	SecurityHolding,
	UserAccount,
)
from app.schemas import (
	CashAccountCreate,
	CashAccountUpdate,
	DashboardResponse,
	FixedAssetCreate,
	LiabilityEntryCreate,
	OtherAssetCreate,
	SecurityHoldingCreate,
	SecurityHoldingUpdate,
)
from app.services.market_data import Quote


class StaticMarketDataClient:
	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		if from_currency.upper() == to_currency.upper():
			return 1.0, []
		return 7.0, []

	async def fetch_quote(
		self,
		symbol: str,
		market: str | None = None,
	) -> tuple[Quote, list[str]]:
		return (
			Quote(
				symbol=symbol,
				name="Apple",
				price=100.0,
				currency="USD",
				market_time=datetime(2026, 3, 1, tzinfo=timezone.utc),
			),
			[],
		)

	def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
		return None


@pytest.fixture
def session(tmp_path: Path) -> Iterator[Session]:
	engine = create_engine(
		f"sqlite:///{tmp_path / 'asset-crud-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)

	with Session(engine) as db_session:
		yield db_session


def make_user(session: Session, username: str = "tester") -> UserAccount:
	user = UserAccount(
		username=username,
		password_digest="scrypt$16384$8$1$bc13ea73dad1a1d781e1bf06e769ccda$"
		"de4af04355be41e4ec61f7dc8b3c19fcc4fc940ba47784324063d4169d57e80a"
		"14cc1588be5fea70338075226ff4b32aafe37ab0a114d05b70e0a2364a0d2bf7",
	)
	session.add(user)
	session.commit()
	return user


def test_create_account_persists_account_type_and_note(session: Session) -> None:
	current_user = make_user(session)
	account = create_account(
		CashAccountCreate(
			name="Emergency Fund",
			platform="Alipay",
			currency="cny",
			balance=1280.5,
			account_type="alipay",
			started_on=date(2026, 3, 1),
			note="  spare cash  ",
		),
		current_user,
		session,
	)

	assert account.id is not None
	assert account.currency == "CNY"
	assert account.account_type == "ALIPAY"
	assert account.started_on == date(2026, 3, 1)
	assert account.note == "spare cash"

	stored_account = session.get(CashAccount, account.id)
	assert stored_account is not None
	assert stored_account.user_id == current_user.username
	assert stored_account.started_on == date(2026, 3, 1)
	assert stored_account.account_type == "ALIPAY"
	assert stored_account.note == "spare cash"


def test_update_account_keeps_new_fields_when_omitted_from_payload(session: Session) -> None:
	current_user = make_user(session)
	account = create_account(
		CashAccountCreate(
			name="Wallet",
			platform="Cash",
			currency="cny",
			balance=50,
			account_type="cash",
			note="Daily spending",
		),
		current_user,
		session,
	)

	updated_account = update_account(
		account.id or 0,
		CashAccountUpdate(
			name="Pocket Wallet",
			platform="Cash",
			currency="usd",
			balance=66.5,
		),
		current_user,
		session,
	)

	assert updated_account.name == "Pocket Wallet"
	assert updated_account.currency == "USD"
	assert updated_account.balance == 66.5
	assert updated_account.account_type == "CASH"
	assert updated_account.note == "Daily spending"


def test_delete_account_removes_record(session: Session) -> None:
	current_user = make_user(session)
	account = create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="cny",
			balance=800,
			account_type="bank",
		),
		current_user,
		session,
	)

	response = delete_account(account.id or 0, current_user, session)

	assert response.status_code == 204
	assert session.exec(select(CashAccount)).all() == []


def test_delete_account_returns_404_when_missing(session: Session) -> None:
	current_user = make_user(session)
	with pytest.raises(HTTPException) as error:
		delete_account(9999, current_user, session)

	assert error.value.status_code == 404
	assert error.value.detail == "Account not found."


def test_persist_hour_snapshot_compacts_rows_within_the_same_hour(session: Session) -> None:
	session.add(
		PortfolioSnapshot(
			user_id="tester",
			total_value_cny=1000,
			created_at=datetime(2026, 3, 1, 3, 12, tzinfo=timezone.utc),
		),
	)
	session.add(
		PortfolioSnapshot(
			user_id="tester",
			total_value_cny=1200,
			created_at=datetime(2026, 3, 1, 3, 41, tzinfo=timezone.utc),
		),
	)
	session.commit()

	_persist_hour_snapshot(
		session,
		"tester",
		datetime(2026, 3, 1, 3, 0, tzinfo=timezone.utc),
		1500,
	)

	snapshots = session.exec(
		select(PortfolioSnapshot).order_by(PortfolioSnapshot.created_at.asc()),
	).all()

	assert len(snapshots) == 1
	assert snapshots[0].total_value_cny == 1500
	assert main._coerce_utc_datetime(snapshots[0].created_at) == datetime(
		2026,
		3,
		1,
		3,
		0,
		tzinfo=timezone.utc,
	)


def test_persist_holdings_return_snapshot_compacts_rows_within_the_same_hour(
	session: Session,
) -> None:
	session.add(
		HoldingPerformanceSnapshot(
			user_id="tester",
			scope="TOTAL",
			symbol=None,
			name="非现金资产",
			return_pct=1.5,
			created_at=datetime(2026, 3, 1, 3, 12, tzinfo=timezone.utc),
		),
	)
	session.add(
		HoldingPerformanceSnapshot(
			user_id="tester",
			scope="HOLDING",
			symbol="0700.HK",
			name="腾讯控股",
			return_pct=2.2,
			created_at=datetime(2026, 3, 1, 3, 16, tzinfo=timezone.utc),
		),
	)
	session.commit()

	_persist_holdings_return_snapshot(
		session,
		"tester",
		datetime(2026, 3, 1, 3, 0, tzinfo=timezone.utc),
		3.5,
		(main.LiveHoldingReturnPoint(symbol="0700.HK", name="腾讯控股", return_pct=4.25),),
	)

	snapshots = session.exec(
		select(HoldingPerformanceSnapshot).order_by(HoldingPerformanceSnapshot.scope.asc()),
	).all()

	assert len(snapshots) == 2
	assert snapshots[0].scope == "HOLDING"
	assert snapshots[0].return_pct == 4.25
	assert snapshots[1].scope == "TOTAL"
	assert snapshots[1].return_pct == 3.5


def test_summarize_holdings_return_state_returns_weighted_aggregate() -> None:
	aggregate_return_pct, holding_points = _summarize_holdings_return_state(
		[
			main.ValuedHolding(
				id=1,
				symbol="0700.HK",
				name="腾讯控股",
				quantity=100,
				fallback_currency="HKD",
				cost_basis_price=500,
				market="HK",
				price=550,
				price_currency="HKD",
				fx_to_cny=0.8,
				value_cny=44000,
				return_pct=10.0,
			),
			main.ValuedHolding(
				id=2,
				symbol="9988.HK",
				name="阿里巴巴-W",
				quantity=200,
				fallback_currency="HKD",
				cost_basis_price=100,
				market="HK",
				price=90,
				price_currency="HKD",
				fx_to_cny=0.8,
				value_cny=14400,
				return_pct=-10.0,
			),
		],
	)

	assert aggregate_return_pct == 4.29
	assert [point.symbol for point in holding_points] == ["0700.HK", "9988.HK"]


def test_list_accounts_returns_valued_balances(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="usd",
			balance=100,
			account_type="bank",
		),
		current_user,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	accounts = asyncio.run(main.list_accounts(current_user, session))

	assert len(accounts) == 1
	assert accounts[0].fx_to_cny == 7.0
	assert accounts[0].value_cny == 700.0


def test_list_accounts_scopes_results_to_current_user(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	first_user = make_user(session, "first_user")
	second_user = make_user(session, "second_user")
	create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="cny",
			balance=50,
			account_type="bank",
		),
		first_user,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	accounts = asyncio.run(main.list_accounts(second_user, session))

	assert accounts == []


def test_cash_account_schema_rejects_invalid_account_type() -> None:
	with pytest.raises(ValidationError):
		CashAccountCreate(
			name="Wallet",
			platform="Cash",
			currency="CNY",
			balance=10,
			account_type="BROKERAGE",
		)


def test_create_holding_persists_market_broker_and_note(session: Session) -> None:
	current_user = make_user(session)
	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=3,
			fallback_currency="usd",
			cost_basis_price=92.5,
			market="us",
			broker="  IBKR  ",
			started_on=date(2026, 2, 14),
			note="  long term  ",
		),
		current_user,
		session,
	)

	assert holding.id is not None
	assert holding.symbol == "AAPL"
	assert holding.fallback_currency == "USD"
	assert holding.cost_basis_price == 92.5
	assert holding.market == "US"
	assert holding.broker == "IBKR"
	assert holding.started_on == date(2026, 2, 14)
	assert holding.note == "long term"

	stored_holding = session.get(SecurityHolding, holding.id)
	assert stored_holding is not None
	assert stored_holding.user_id == current_user.username
	assert stored_holding.started_on == date(2026, 2, 14)
	assert stored_holding.cost_basis_price == 92.5
	assert stored_holding.market == "US"
	assert stored_holding.broker == "IBKR"
	assert stored_holding.note == "long term"


def test_update_holding_updates_new_fields(session: Session) -> None:
	current_user = make_user(session)
	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=2,
			fallback_currency="usd",
		),
		current_user,
		session,
	)

	updated_holding = update_holding(
		holding.id or 0,
		SecurityHoldingUpdate(
			symbol="0700.hk",
			name="Tencent",
			quantity=4,
			fallback_currency="hkd",
			cost_basis_price=450,
			market="hk",
			broker="  Futu  ",
			note="  core position  ",
		),
		current_user,
		session,
	)

	assert updated_holding.symbol == "0700.HK"
	assert updated_holding.name == "Tencent"
	assert updated_holding.quantity == 4
	assert updated_holding.fallback_currency == "HKD"
	assert updated_holding.cost_basis_price == 450
	assert updated_holding.market == "HK"
	assert updated_holding.broker == "Futu"
	assert updated_holding.note == "core position"


def test_delete_holding_removes_record(session: Session) -> None:
	current_user = make_user(session)
	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=1,
			fallback_currency="usd",
			market="us",
		),
		current_user,
		session,
	)

	response = delete_holding(holding.id or 0, current_user, session)

	assert response.status_code == 204
	assert session.exec(select(SecurityHolding)).all() == []


def test_delete_holding_returns_404_when_missing(session: Session) -> None:
	current_user = make_user(session)
	with pytest.raises(HTTPException) as error:
		delete_holding(9999, current_user, session)

	assert error.value.status_code == 404
	assert error.value.detail == "Holding not found."


def test_list_holdings_returns_enriched_quote_fields(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=2,
			fallback_currency="usd",
			cost_basis_price=80,
			market="us",
		),
		current_user,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	holdings = asyncio.run(main.list_holdings(current_user, session))

	assert len(holdings) == 1
	assert holdings[0].price == 100.0
	assert holdings[0].price_currency == "USD"
	assert holdings[0].value_cny == 1400.0
	assert holdings[0].cost_basis_price == 80
	assert holdings[0].return_pct == 25.0


def test_create_holding_returns_enriched_quote_fields_immediately(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=2,
			fallback_currency="usd",
			cost_basis_price=80,
			market="us",
		),
		current_user,
		session,
	)

	assert holding.price == 100.0
	assert holding.price_currency == "USD"
	assert holding.value_cny == 1400.0
	assert holding.return_pct == 25.0


def test_holding_schema_rejects_invalid_market() -> None:
	with pytest.raises(ValidationError):
		SecurityHoldingCreate(
			symbol="AAPL",
			name="Apple",
			quantity=1,
			fallback_currency="USD",
			market="JP",
		)


def test_holding_schema_rejects_fractional_stock_quantity() -> None:
	with pytest.raises(ValidationError):
		SecurityHoldingCreate(
			symbol="AAPL",
			name="Apple",
			quantity=1.5,
			fallback_currency="USD",
			market="US",
		)


def test_holding_schema_allows_fractional_fund_units() -> None:
	holding = SecurityHoldingCreate(
		symbol="159915.SZ",
		name="创业板 ETF",
		quantity=1.5,
		fallback_currency="CNY",
		market="FUND",
	)

	assert holding.quantity == 1.5


def test_holding_schema_allows_fractional_crypto_units() -> None:
	holding = SecurityHoldingCreate(
		symbol="BTC-USD",
		name="Bitcoin",
		quantity=0.25,
		fallback_currency="USD",
		market="CRYPTO",
	)

	assert holding.quantity == 0.25


def test_create_new_asset_categories_persists_records(session: Session) -> None:
	current_user = make_user(session)

	fixed_asset = create_fixed_asset(
		FixedAssetCreate(
			name="Primary Home",
			category="real_estate",
			current_value_cny=2_000_000,
			purchase_value_cny=1_800_000,
			started_on=date(2024, 1, 1),
			note="  family use  ",
		),
		current_user,
		session,
	)
	liability = create_liability(
		LiabilityEntryCreate(
			name="Mortgage",
			category="mortgage",
			currency="cny",
			balance=500_000,
			started_on=date(2024, 1, 2),
			note="  monthly repayment  ",
		),
		current_user,
		session,
	)
	other_asset = create_other_asset(
		OtherAssetCreate(
			name="Friend Loan",
			category="receivable",
			current_value_cny=20_000,
			original_value_cny=18_000,
			started_on=date(2025, 5, 6),
			note="  due next quarter  ",
		),
		current_user,
		session,
	)

	assert fixed_asset.category == "REAL_ESTATE"
	assert fixed_asset.return_pct == 11.11
	assert fixed_asset.started_on == date(2024, 1, 1)
	assert liability.category == "MORTGAGE"
	assert liability.started_on == date(2024, 1, 2)
	assert other_asset.category == "RECEIVABLE"
	assert other_asset.started_on == date(2025, 5, 6)
	assert other_asset.return_pct == 11.11

	assert session.exec(select(FixedAsset)).one().user_id == current_user.username
	assert session.exec(select(LiabilityEntry)).one().user_id == current_user.username
	assert session.exec(select(OtherAsset)).one().user_id == current_user.username


def test_liability_schema_restricts_currency_to_cny_or_usd() -> None:
	with pytest.raises(ValidationError, match="currency must be one of: CNY, USD."):
		LiabilityEntryCreate(
			name="Mortgage",
			category="mortgage",
			currency="hkd",
			balance=500_000,
		)


def test_build_dashboard_subtracts_liabilities_from_total(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="cny",
			balance=1000,
			account_type="bank",
		),
		current_user,
		session,
	)
	create_fixed_asset(
		FixedAssetCreate(
			name="Primary Home",
			category="real_estate",
			current_value_cny=500_000,
		),
		current_user,
		session,
	)
	create_other_asset(
		OtherAssetCreate(
			name="Receivable",
			category="receivable",
			current_value_cny=20_000,
		),
		current_user,
		session,
	)
	create_liability(
		LiabilityEntryCreate(
			name="Mortgage",
			category="mortgage",
			currency="cny",
			balance=120_000,
		),
		current_user,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	dashboard = asyncio.run(main._build_dashboard(session, current_user))

	assert dashboard.cash_value_cny == 1000.0
	assert dashboard.fixed_assets_value_cny == 500_000.0
	assert dashboard.other_assets_value_cny == 20_000.0
	assert dashboard.liabilities_value_cny == 120_000.0
	assert dashboard.total_value_cny == 401_000.0
	assert [slice.label for slice in dashboard.allocation] == ["现金", "固定资产", "其他"]


def test_build_dashboard_converts_usd_liabilities_to_cny(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="cny",
			balance=1_000,
			account_type="bank",
		),
		current_user,
		session,
	)
	create_liability(
		LiabilityEntryCreate(
			name="USD Credit",
			category="credit_card",
			currency="usd",
			balance=100,
		),
		current_user,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	dashboard = asyncio.run(main._build_dashboard(session, current_user))

	assert dashboard.usd_cny_rate == 7.0
	assert dashboard.hkd_cny_rate == 7.0
	assert dashboard.cash_value_cny == 1_000.0
	assert dashboard.liabilities_value_cny == 700.0
	assert dashboard.total_value_cny == 300.0


def test_get_dashboard_refresh_clears_runtime_cache_and_forces_rebuild(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	refresh_calls = {"cache_clear": 0}
	captured_args: dict[str, bool] = {}

	class RefreshAwareClient(StaticMarketDataClient):
		def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
			refresh_calls["cache_clear"] += 1

	async def fake_get_cached_dashboard(
		db_session: Session,
		user: UserAccount,
		force_refresh: bool = False,
	) -> DashboardResponse:
		captured_args["force_refresh"] = force_refresh
		assert user.username == current_user.username
		assert db_session is session
		return DashboardResponse(
			total_value_cny=0,
			cash_value_cny=0,
			holdings_value_cny=0,
			fixed_assets_value_cny=0,
			liabilities_value_cny=0,
			other_assets_value_cny=0,
			usd_cny_rate=None,
			hkd_cny_rate=None,
			cash_accounts=[],
			holdings=[],
			fixed_assets=[],
			liabilities=[],
			other_assets=[],
			allocation=[],
			hour_series=[],
			day_series=[],
			month_series=[],
			year_series=[],
			holdings_return_hour_series=[],
			holdings_return_day_series=[],
			holdings_return_month_series=[],
			holdings_return_year_series=[],
			holding_return_series=[],
			warnings=[],
		)

	monkeypatch.setattr(main, "market_data_client", RefreshAwareClient())
	monkeypatch.setattr(main, "_get_cached_dashboard", fake_get_cached_dashboard)

	asyncio.run(main.get_dashboard(current_user, session, True))

	assert refresh_calls["cache_clear"] == 1
	assert captured_args["force_refresh"] is True


def test_refresh_user_dashboards_clears_market_data_once_per_cycle(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	refresh_calls = {"cache_clear": 0, "dashboard_rebuild": 0}

	class RefreshAwareClient(StaticMarketDataClient):
		def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
			refresh_calls["cache_clear"] += 1

	async def fake_get_cached_dashboard(
		db_session: Session,
		user: UserAccount,
		force_refresh: bool = False,
	) -> DashboardResponse:
		assert db_session is session
		assert user.username == current_user.username
		assert force_refresh is True
		refresh_calls["dashboard_rebuild"] += 1
		return DashboardResponse(
			total_value_cny=0,
			cash_value_cny=0,
			holdings_value_cny=0,
			fixed_assets_value_cny=0,
			liabilities_value_cny=0,
			other_assets_value_cny=0,
			usd_cny_rate=None,
			hkd_cny_rate=None,
			cash_accounts=[],
			holdings=[],
			fixed_assets=[],
			liabilities=[],
			other_assets=[],
			allocation=[],
			hour_series=[],
			day_series=[],
			month_series=[],
			year_series=[],
			holdings_return_hour_series=[],
			holdings_return_day_series=[],
			holdings_return_month_series=[],
			holdings_return_year_series=[],
			holding_return_series=[],
			warnings=[],
		)

	monkeypatch.setattr(main, "market_data_client", RefreshAwareClient())
	monkeypatch.setattr(main, "_get_cached_dashboard", fake_get_cached_dashboard)

	asyncio.run(main._refresh_user_dashboards(session, [current_user], clear_market_data=True))

	assert refresh_calls["cache_clear"] == 1
	assert refresh_calls["dashboard_rebuild"] == 1
