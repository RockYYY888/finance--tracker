import asyncio
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import SQLModel, Session, create_engine, select

import app.main as main
from app.main import (
	_persist_hour_snapshot,
	_persist_holdings_return_snapshot,
	_summarize_holdings_return_state,
	create_account,
	create_holding,
	delete_account,
	delete_holding,
	update_account,
	update_holding,
)
from app.models import CashAccount, HoldingPerformanceSnapshot, PortfolioSnapshot, SecurityHolding
from app.schemas import (
	CashAccountCreate,
	CashAccountUpdate,
	SecurityHoldingCreate,
	SecurityHoldingUpdate,
)
from app.services.market_data import Quote


class StaticMarketDataClient:
	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		if from_currency.upper() == to_currency.upper():
			return 1.0, []
		return 7.0, []

	async def fetch_quote(self, symbol: str) -> tuple[Quote, list[str]]:
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


@pytest.fixture
def session(tmp_path: Path) -> Iterator[Session]:
	engine = create_engine(
		f"sqlite:///{tmp_path / 'asset-crud-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)

	with Session(engine) as db_session:
		yield db_session


def test_create_account_persists_account_type_and_note(session: Session) -> None:
	account = create_account(
		CashAccountCreate(
			name="Emergency Fund",
			platform="Alipay",
			currency="cny",
			balance=1280.5,
			account_type="alipay",
			note="  spare cash  ",
		),
		None,
		session,
	)

	assert account.id is not None
	assert account.currency == "CNY"
	assert account.account_type == "ALIPAY"
	assert account.note == "spare cash"

	stored_account = session.get(CashAccount, account.id)
	assert stored_account is not None
	assert stored_account.account_type == "ALIPAY"
	assert stored_account.note == "spare cash"


def test_update_account_keeps_new_fields_when_omitted_from_payload(session: Session) -> None:
	account = create_account(
		CashAccountCreate(
			name="Wallet",
			platform="Cash",
			currency="cny",
			balance=50,
			account_type="cash",
			note="Daily spending",
		),
		None,
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
		None,
		session,
	)

	assert updated_account.name == "Pocket Wallet"
	assert updated_account.currency == "USD"
	assert updated_account.balance == 66.5
	assert updated_account.account_type == "CASH"
	assert updated_account.note == "Daily spending"


def test_delete_account_removes_record(session: Session) -> None:
	account = create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="cny",
			balance=800,
			account_type="bank",
		),
		None,
		session,
	)

	response = delete_account(account.id or 0, None, session)

	assert response.status_code == 204
	assert session.exec(select(CashAccount)).all() == []


def test_delete_account_returns_404_when_missing(session: Session) -> None:
	with pytest.raises(HTTPException) as error:
		delete_account(9999, None, session)

	assert error.value.status_code == 404
	assert error.value.detail == "Account not found."


def test_persist_hour_snapshot_compacts_rows_within_the_same_hour(session: Session) -> None:
	session.add(
		PortfolioSnapshot(
			total_value_cny=1000,
			created_at=datetime(2026, 3, 1, 3, 12, tzinfo=timezone.utc),
		),
	)
	session.add(
		PortfolioSnapshot(
			total_value_cny=1200,
			created_at=datetime(2026, 3, 1, 3, 41, tzinfo=timezone.utc),
		),
	)
	session.commit()

	_persist_hour_snapshot(
		session,
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
			scope="TOTAL",
			symbol=None,
			name="非现金资产",
			return_pct=1.5,
			created_at=datetime(2026, 3, 1, 3, 12, tzinfo=timezone.utc),
		),
	)
	session.add(
		HoldingPerformanceSnapshot(
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
	create_account(
		CashAccountCreate(
			name="Checking",
			platform="Bank",
			currency="usd",
			balance=100,
			account_type="bank",
		),
		None,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	accounts = asyncio.run(main.list_accounts(None, session))

	assert len(accounts) == 1
	assert accounts[0].fx_to_cny == 7.0
	assert accounts[0].value_cny == 700.0


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
	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=3,
			fallback_currency="usd",
			cost_basis_price=92.5,
			market="us",
			broker="  IBKR  ",
			note="  long term  ",
		),
		None,
		session,
	)

	assert holding.id is not None
	assert holding.symbol == "AAPL"
	assert holding.fallback_currency == "USD"
	assert holding.cost_basis_price == 92.5
	assert holding.market == "US"
	assert holding.broker == "IBKR"
	assert holding.note == "long term"

	stored_holding = session.get(SecurityHolding, holding.id)
	assert stored_holding is not None
	assert stored_holding.cost_basis_price == 92.5
	assert stored_holding.market == "US"
	assert stored_holding.broker == "IBKR"
	assert stored_holding.note == "long term"


def test_update_holding_updates_new_fields(session: Session) -> None:
	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=2,
			fallback_currency="usd",
		),
		None,
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
		None,
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
	holding = create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=1,
			fallback_currency="usd",
			market="us",
		),
		None,
		session,
	)

	response = delete_holding(holding.id or 0, None, session)

	assert response.status_code == 204
	assert session.exec(select(SecurityHolding)).all() == []


def test_delete_holding_returns_404_when_missing(session: Session) -> None:
	with pytest.raises(HTTPException) as error:
		delete_holding(9999, None, session)

	assert error.value.status_code == 404
	assert error.value.detail == "Holding not found."


def test_list_holdings_returns_enriched_quote_fields(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	create_holding(
		SecurityHoldingCreate(
			symbol="aapl",
			name="Apple",
			quantity=2,
			fallback_currency="usd",
			cost_basis_price=80,
			market="us",
		),
		None,
		session,
	)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	holdings = asyncio.run(main.list_holdings(None, session))

	assert len(holdings) == 1
	assert holdings[0].price == 100.0
	assert holdings[0].price_currency == "USD"
	assert holdings[0].value_cny == 1400.0
	assert holdings[0].cost_basis_price == 80
	assert holdings[0].return_pct == 25.0


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
