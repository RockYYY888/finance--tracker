from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import SQLModel, Session, create_engine, select

from app.main import (
	create_account,
	create_holding,
	delete_account,
	delete_holding,
	update_account,
	update_holding,
)
from app.models import CashAccount, SecurityHolding
from app.schemas import (
	CashAccountCreate,
	CashAccountUpdate,
	SecurityHoldingCreate,
	SecurityHoldingUpdate,
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
	assert holding.market == "US"
	assert holding.broker == "IBKR"
	assert holding.note == "long term"

	stored_holding = session.get(SecurityHolding, holding.id)
	assert stored_holding is not None
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


def test_holding_schema_rejects_invalid_market() -> None:
	with pytest.raises(ValidationError):
		SecurityHoldingCreate(
			symbol="AAPL",
			name="Apple",
			quantity=1,
			fallback_currency="USD",
			market="JP",
		)
