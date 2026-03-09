import asyncio
from collections.abc import Iterator
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine, select
from starlette.requests import Request

import app.main as main
from app.main import (
	create_account,
	create_holding_transaction,
	get_agent_context,
	get_current_user,
	get_security_quote,
	issue_agent_token_with_password,
	list_all_holding_transactions,
	revoke_agent_token,
)
from app.models import AgentAccessToken, UserAccount
from app.schemas import (
	AgentTokenIssueCreate,
	AllocationSlice,
	CashAccountCreate,
	DashboardResponse,
	SecurityHoldingTransactionCreate,
	ValuedCashAccount,
	ValuedHolding,
)
from app.security import hash_password
from app.services.market_data import Quote


class StaticMarketDataClient:
	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		if from_currency.upper() == to_currency.upper():
			return 1.0, []
		return 7.0, []

	async def fetch_hourly_price_series(
		self,
		symbol: str,
		*,
		market: str | None = None,
		start_at: datetime,
		end_at: datetime,
	) -> tuple[list[tuple[datetime, float]], str | None, list[str]]:
		return [], "USD", []

	async def fetch_quote(
		self,
		symbol: str,
		market: str | None = None,
	) -> tuple[Quote, list[str]]:
		return (
			Quote(
				symbol=symbol,
				name="Apple",
				price=188.5,
				currency="USD",
				market_time=datetime(2026, 3, 9, 12, 0, tzinfo=timezone.utc),
			),
			["cache-hit"],
		)

	def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
		return None


@pytest.fixture
def session(tmp_path: Path) -> Iterator[Session]:
	engine = create_engine(
		f"sqlite:///{tmp_path / 'agent-api-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)

	with Session(engine) as db_session:
		yield db_session


@pytest.fixture(autouse=True)
def reset_runtime_state() -> Iterator[None]:
	main.dashboard_cache.clear()
	main.login_attempt_states.clear()
	yield
	main.dashboard_cache.clear()
	main.login_attempt_states.clear()


def make_user(session: Session, username: str = "tester") -> UserAccount:
	user = UserAccount(
		username=username,
		password_digest=hash_password("qwer1234"),
	)
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def build_request(
	*,
	method: str = "GET",
	path: str = "/",
	headers: dict[str, str] | None = None,
	session_data: dict[str, object] | None = None,
) -> Request:
	scope = {
		"type": "http",
		"method": method,
		"path": path,
		"scheme": "http",
		"http_version": "1.1",
		"query_string": b"",
		"headers": [
			(key.lower().encode("utf-8"), value.encode("utf-8"))
			for key, value in (headers or {}).items()
		],
		"client": ("127.0.0.1", 12345),
		"session": session_data or {},
	}
	return Request(scope)


def test_issue_agent_token_with_password_and_use_bearer_auth(session: Session) -> None:
	make_user(session)

	issued_token = issue_agent_token_with_password(
		build_request(method="POST", path="/api/agent/tokens/issue"),
		AgentTokenIssueCreate(
			user_id="tester",
			password="qwer1234",
			name="quant-runner",
			expires_in_days=30,
		),
		None,
		session,
	)

	assert issued_token.access_token.startswith("atrk_")
	stored_token = session.exec(select(AgentAccessToken)).one()
	assert stored_token.user_id == "tester"
	assert stored_token.name == "quant-runner"
	assert stored_token.token_hint.startswith("...")

	authenticated_user = get_current_user(
		build_request(
			headers={"Authorization": f"Bearer {issued_token.access_token}"},
		),
		session,
		None,
	)

	assert authenticated_user.username == "tester"
	session.refresh(stored_token)
	assert stored_token.last_used_at is not None


def test_revoked_agent_token_can_no_longer_authenticate(session: Session) -> None:
	current_user = make_user(session)
	issued_token = issue_agent_token_with_password(
		build_request(method="POST", path="/api/agent/tokens/issue"),
		AgentTokenIssueCreate(
			user_id=current_user.username,
			password="qwer1234",
			name="revoked-token",
			expires_in_days=30,
		),
		None,
		session,
	)
	token_row = session.exec(select(AgentAccessToken)).one()

	response = revoke_agent_token(token_row.id or 0, current_user, session)

	assert response.message == "智能体访问令牌已撤销。"
	with pytest.raises(HTTPException) as error:
		get_current_user(
			build_request(
				headers={"Authorization": f"Bearer {issued_token.access_token}"},
			),
			session,
			None,
		)

	assert error.value.status_code == 401
	assert error.value.detail == "Invalid bearer token."


def test_list_all_holding_transactions_supports_symbol_filter(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="BUY",
			symbol="AAPL",
			name="Apple",
			quantity=2,
			price=180,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 8),
		),
		current_user,
		session,
	)
	create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="BUY",
			symbol="TSLA",
			name="Tesla",
			quantity=1,
			price=220,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 9),
		),
		current_user,
		session,
	)

	transactions = list_all_holding_transactions(
		current_user,
		session,
		symbol="AAPL",
		market="US",
		side=None,
		limit=50,
	)

	assert len(transactions) == 1
	assert transactions[0].symbol == "AAPL"
	assert transactions[0].market == "US"


def test_get_security_quote_returns_live_quote_for_agent(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())

	quote = asyncio.run(get_security_quote("aapl", "us", current_user))

	assert quote.symbol == "AAPL"
	assert quote.market == "US"
	assert quote.price == 188.5
	assert quote.currency == "USD"
	assert quote.warnings == ["cache-hit"]


def test_get_agent_context_returns_dashboard_summary_and_recent_transactions(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(main, "market_data_client", StaticMarketDataClient())
	create_account(
		CashAccountCreate(
			name="Broker Cash",
			platform="Futu",
			currency="USD",
			balance=500,
			account_type="BANK",
		),
		current_user,
		session,
	)
	create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="BUY",
			symbol="AAPL",
			name="Apple",
			quantity=2,
			price=180,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 9),
		),
		current_user,
		session,
	)

	async def fake_get_dashboard(
		user: UserAccount,
		db_session: Session,
		refresh: bool = False,
	) -> DashboardResponse:
		assert user.username == current_user.username
		assert db_session is session
		assert refresh is False
		return DashboardResponse(
			server_today=date(2026, 3, 9),
			total_value_cny=10000,
			cash_value_cny=3500,
			holdings_value_cny=6500,
			fixed_assets_value_cny=0,
			liabilities_value_cny=0,
			other_assets_value_cny=0,
			usd_cny_rate=7.0,
			hkd_cny_rate=0.92,
			cash_accounts=[
				ValuedCashAccount(
					id=1,
					name="Broker Cash",
					platform="Futu",
					balance=500,
					currency="USD",
					account_type="BANK",
					fx_to_cny=7.0,
					value_cny=3500,
				),
			],
			holdings=[
				ValuedHolding(
					id=1,
					symbol="AAPL",
					name="Apple",
					quantity=2,
					fallback_currency="USD",
					cost_basis_price=180,
					market="US",
					price=188.5,
					price_currency="USD",
					fx_to_cny=7.0,
					value_cny=2639,
					return_pct=4.72,
					last_updated=datetime(2026, 3, 9, 12, 0, tzinfo=timezone.utc),
				),
			],
			fixed_assets=[],
			liabilities=[],
			other_assets=[],
			allocation=[AllocationSlice(label="投资类", value=6500)],
			hour_series=[],
			day_series=[],
			month_series=[],
			year_series=[],
			holdings_return_hour_series=[],
			holdings_return_day_series=[],
			holdings_return_month_series=[],
			holdings_return_year_series=[],
			holding_return_series=[],
			warnings=["quote-cache-hit"],
		)

	monkeypatch.setattr(main, "get_dashboard", fake_get_dashboard)

	context = asyncio.run(
		get_agent_context(
			current_user,
			session,
			refresh=False,
			transaction_limit=10,
		),
	)

	assert context.user_id == current_user.username
	assert context.total_value_cny == 10000
	assert context.pending_history_sync_requests == 1
	assert len(context.cash_accounts) == 1
	assert len(context.holdings) == 1
	assert len(context.recent_holding_transactions) == 1
	assert context.recent_holding_transactions[0].symbol == "AAPL"
	assert context.warnings == ["quote-cache-hit"]
