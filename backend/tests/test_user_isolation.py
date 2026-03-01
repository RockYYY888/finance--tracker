import asyncio
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

import app.main as main
from app.main import create_account, create_holding, submit_feedback
from app.models import UserAccount, UserFeedback
from app.schemas import CashAccountCreate, SecurityHoldingCreate, UserFeedbackCreate
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
				name="Static Quote",
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
		f"sqlite:///{tmp_path / 'user-isolation-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)
	main.dashboard_cache.clear()
	main.live_portfolio_states.clear()
	main.live_holdings_return_states.clear()

	with Session(engine) as db_session:
		yield db_session

	main.dashboard_cache.clear()
	main.live_portfolio_states.clear()
	main.live_holdings_return_states.clear()


def make_user(session: Session, username: str) -> UserAccount:
	user = UserAccount(
		username=username,
		password_digest="scrypt$16384$8$1$bc13ea73dad1a1d781e1bf06e769ccda$"
		"de4af04355be41e4ec61f7dc8b3c19fcc4fc940ba47784324063d4169d57e80a"
		"14cc1588be5fea70338075226ff4b32aafe37ab0a114d05b70e0a2364a0d2bf7",
	)
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def test_cached_dashboard_keeps_each_user_in_a_separate_cache_entry(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	first_user = make_user(session, "first_user")
	second_user = make_user(session, "second_user")
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	create_account(
		CashAccountCreate(
			name="First Wallet",
			platform="Cash",
			currency="cny",
			balance=100,
			account_type="cash",
		),
		first_user,
		session,
	)
	create_account(
		CashAccountCreate(
			name="Second Wallet",
			platform="Cash",
			currency="cny",
			balance=250,
			account_type="cash",
		),
		second_user,
		session,
	)

	first_dashboard = asyncio.run(main._get_cached_dashboard(session, first_user))
	second_dashboard = asyncio.run(main._get_cached_dashboard(session, second_user))

	assert first_dashboard.total_value_cny == 100.0
	assert second_dashboard.total_value_cny == 250.0
	assert sorted(main.dashboard_cache.keys()) == ["first_user", "second_user"]


def test_dashboard_only_includes_assets_belonging_to_the_current_user(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	first_user = make_user(session, "alpha_user")
	second_user = make_user(session, "beta_user")
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	create_account(
		CashAccountCreate(
			name="Alpha Cash",
			platform="Bank",
			currency="cny",
			balance=100,
			account_type="bank",
		),
		first_user,
		session,
	)
	create_holding(
		SecurityHoldingCreate(
			symbol="AAPL",
			name="Alpha Holding",
			quantity=2,
			fallback_currency="usd",
			cost_basis_price=80,
			market="us",
		),
		first_user,
		session,
	)
	create_account(
		CashAccountCreate(
			name="Beta Cash",
			platform="Bank",
			currency="cny",
			balance=200,
			account_type="bank",
		),
		second_user,
		session,
	)

	dashboard = asyncio.run(main._build_dashboard(session, second_user))

	assert dashboard.total_value_cny == 200.0
	assert dashboard.cash_value_cny == 200.0
	assert dashboard.holdings_value_cny == 0.0
	assert [account.name for account in dashboard.cash_accounts] == ["Beta Cash"]
	assert dashboard.holdings == []


def test_feedback_daily_limit_is_counted_per_user_not_globally(session: Session) -> None:
	first_user = make_user(session, "feedback_a")
	second_user = make_user(session, "feedback_b")

	for index in range(3):
		created_feedback = submit_feedback(
			UserFeedbackCreate(message=f"A 用户第 {index + 1} 次反馈。"),
			first_user,
			session,
		)
		assert created_feedback.id > 0

	second_user_feedback = submit_feedback(
		UserFeedbackCreate(message="B 用户今天的首次反馈。"),
		second_user,
		session,
	)

	assert second_user_feedback.id > 0
	persisted_feedback = session.exec(
		select(UserFeedback).where(UserFeedback.user_id == second_user.username),
	).all()
	assert len(persisted_feedback) == 1
	assert persisted_feedback[0].message == "B 用户今天的首次反馈。"
