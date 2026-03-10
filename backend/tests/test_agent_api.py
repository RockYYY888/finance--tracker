import asyncio
from collections.abc import Iterator
from datetime import date, datetime, timezone
import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine, select
from starlette.requests import Request

import app.database as database
from app import runtime_state
import app.main as main
from app.main import (
	create_agent_task,
	create_cash_transfer,
	create_account,
	create_holding_transaction,
	get_agent_context,
	get_current_user,
	get_security_quote,
	issue_agent_token_with_password,
	list_all_holding_transactions,
	list_asset_mutation_audits,
	revoke_agent_token,
)
from app.models import (
	AgentAccessToken,
	AgentTask,
	AssetMutationAudit,
	CashAccount,
	CashLedgerEntry,
	CashTransfer,
	OutboxJob,
	SecurityHoldingTransaction,
	UserAccount,
)
from app.schemas import (
	AgentTaskCreate,
	AgentTokenIssueCreate,
	AllocationSlice,
	CashAccountCreate,
	CashTransferCreate,
	DashboardResponse,
	SecurityHoldingTransactionCreate,
	ValuedCashAccount,
	ValuedHolding,
)
from app.security import hash_password
from app.services.market_data import Quote
from app.services import dashboard_service, job_service, legacy_service, service_context


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


def _reset_async_runtime_state() -> None:
	runtime_state.set_last_global_force_refresh_at(None)
	runtime_state.background_job_worker_task = None
	runtime_state.snapshot_rebuild_users_in_queue.clear()
	runtime_state.snapshot_rebuild_worker_task = None
	while True:
		try:
			runtime_state.snapshot_rebuild_queue.get_nowait()
		except asyncio.QueueEmpty:
			break
		runtime_state.snapshot_rebuild_queue.task_done()


@pytest.fixture
def session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
	engine = create_engine(
		f"sqlite:///{tmp_path / 'agent-api-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)
	monkeypatch.setattr(database, "engine", engine)
	monkeypatch.setattr(job_service, "engine", engine)
	monkeypatch.setattr(legacy_service, "engine", engine)
	_reset_async_runtime_state()

	with Session(engine) as db_session:
		yield db_session
	_reset_async_runtime_state()


@pytest.fixture(autouse=True)
def reset_runtime_state() -> Iterator[None]:
	main.dashboard_cache.clear()
	main.login_attempt_states.clear()
	_reset_async_runtime_state()
	yield
	main.dashboard_cache.clear()
	main.login_attempt_states.clear()
	_reset_async_runtime_state()


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


def run_background_jobs(limit: int = 20) -> int:
	return asyncio.run(job_service.process_all_pending_background_jobs(limit=limit))


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
	monkeypatch.setattr(service_context, "market_data_client", StaticMarketDataClient())

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


def test_list_all_holding_transactions_includes_sell_cash_settlement_metadata(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(service_context, "market_data_client", StaticMarketDataClient())

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
	cash_account = create_account(
		CashAccountCreate(
			name="Broker Cash",
			platform="Futu",
			currency="CNY",
			balance=500,
			account_type="BANK",
		),
		current_user,
		session,
	)
	create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="SELL",
			symbol="AAPL",
			name="Apple",
			quantity=1,
			price=188.5,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 9),
			sell_proceeds_handling="ADD_TO_EXISTING_CASH",
			sell_proceeds_account_id=cash_account.id,
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

	sell_transaction = next(item for item in transactions if item.side == "SELL")
	assert sell_transaction.sell_proceeds_handling == "ADD_TO_EXISTING_CASH"
	assert sell_transaction.sell_proceeds_account_id == cash_account.id


def test_get_security_quote_returns_live_quote_for_agent(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(service_context, "market_data_client", StaticMarketDataClient())

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
	monkeypatch.setattr(service_context, "market_data_client", StaticMarketDataClient())
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

	monkeypatch.setattr(dashboard_service, "get_dashboard", fake_get_dashboard)

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


def test_create_holding_transaction_replays_by_idempotency_key(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(service_context, "market_data_client", StaticMarketDataClient())

	first = create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="BUY",
			symbol="AAPL",
			name="Apple",
			quantity=1,
			price=180,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 9),
		),
		current_user,
		session,
		"buy-001",
	)
	second = create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="BUY",
			symbol="AAPL",
			name="Apple",
			quantity=1,
			price=180,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 9),
		),
		current_user,
		session,
		"buy-001",
	)

	assert first.transaction.id == second.transaction.id
	assert len(session.exec(select(SecurityHoldingTransaction)).all()) == 1


def test_list_holding_transactions_includes_buy_funding_metadata(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	monkeypatch.setattr(service_context, "market_data_client", StaticMarketDataClient())
	cash_account = create_account(
		CashAccountCreate(
			name="主账户",
			platform="Bank",
			currency="CNY",
			balance=2000,
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
			quantity=1,
			price=180,
			fallback_currency="USD",
			market="US",
			traded_on=date(2026, 3, 9),
			buy_funding_handling="DEDUCT_FROM_EXISTING_CASH",
			buy_funding_account_id=cash_account.id,
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

	assert transactions[0].buy_funding_handling == "DEDUCT_FROM_EXISTING_CASH"
	assert transactions[0].buy_funding_account_id == cash_account.id


def test_create_cash_transfer_replays_by_idempotency_key(session: Session) -> None:
	current_user = make_user(session)
	source_account = create_account(
		CashAccountCreate(
			name="主账户",
			platform="Bank",
			currency="CNY",
			balance=1000,
			account_type="BANK",
		),
		current_user,
		session,
	)
	target_account = create_account(
		CashAccountCreate(
			name="备用金",
			platform="Cash",
			currency="CNY",
			balance=100,
			account_type="CASH",
		),
		current_user,
		session,
	)

	first = create_cash_transfer(
		CashTransferCreate(
			from_account_id=source_account.id or 0,
			to_account_id=target_account.id or 0,
			source_amount=200,
			transferred_on=date(2026, 3, 9),
		),
		current_user,
		session,
		"transfer-001",
	)
	second = create_cash_transfer(
		CashTransferCreate(
			from_account_id=source_account.id or 0,
			to_account_id=target_account.id or 0,
			source_amount=200,
			transferred_on=date(2026, 3, 9),
		),
		current_user,
		session,
		"transfer-001",
	)

	assert first.transfer.id == second.transfer.id
	assert len(session.exec(select(CashTransfer)).all()) == 1


def test_create_agent_task_executes_cash_transfer(session: Session) -> None:
	current_user = make_user(session)
	source_account = create_account(
		CashAccountCreate(
			name="主账户",
			platform="Bank",
			currency="CNY",
			balance=500,
			account_type="BANK",
		),
		current_user,
		session,
	)
	target_account = create_account(
		CashAccountCreate(
			name="零钱",
			platform="Cash",
			currency="CNY",
			balance=0,
			account_type="CASH",
		),
		current_user,
		session,
	)

	task = create_agent_task(
		AgentTaskCreate(
			task_type="CREATE_CASH_TRANSFER",
			payload={
				"from_account_id": source_account.id,
				"to_account_id": target_account.id,
				"source_amount": 120,
				"transferred_on": "2026-03-09",
			},
		),
		current_user,
		session,
		"agent-task-001",
	)

	assert task.status == "PENDING"
	assert task.result is None
	jobs = list(
		session.exec(
			select(OutboxJob).where(OutboxJob.job_type == "AGENT_TASK_EXECUTION"),
		).all(),
	)
	assert len(jobs) == 1

	assert run_background_jobs() >= 1

	session.expire_all()
	source_account_row = session.get(CashAccount, source_account.id)
	target_account_row = session.get(CashAccount, target_account.id)
	stored_task = session.get(AgentTask, task.id)
	assert source_account_row is not None
	assert target_account_row is not None
	assert source_account_row.balance == 380
	assert target_account_row.balance == 120
	assert stored_task is not None
	assert stored_task.status == "DONE"
	assert stored_task.result_json is not None
	assert '"source_amount": 120' in stored_task.result_json
	assert len(session.exec(select(AgentTask)).all()) == 1


def test_agent_task_update_cash_transfer_links_mutation_audit(session: Session) -> None:
	current_user = make_user(session)
	source_account = create_account(
		CashAccountCreate(
			name="主账户",
			platform="Bank",
			currency="CNY",
			balance=600,
			account_type="BANK",
		),
		current_user,
		session,
	)
	target_account = create_account(
		CashAccountCreate(
			name="备用金",
			platform="Cash",
			currency="CNY",
			balance=0,
			account_type="CASH",
		),
		current_user,
		session,
	)
	created_transfer = create_cash_transfer(
		CashTransferCreate(
			from_account_id=source_account.id or 0,
			to_account_id=target_account.id or 0,
			source_amount=120,
			transferred_on=date(2026, 3, 9),
		),
		current_user,
		session,
	)

	task = create_agent_task(
		AgentTaskCreate(
			task_type="UPDATE_CASH_TRANSFER",
			payload={
				"transfer_id": created_transfer.transfer.id,
				"source_amount": 80,
				"transferred_on": "2026-03-10",
				"note": "agent corrected transfer",
			},
		),
		current_user,
		session,
		"agent-task-transfer-update-001",
	)

	assert task.status == "PENDING"
	assert task.result is None
	assert run_background_jobs() >= 1
	session.expire_all()
	stored_task = session.get(AgentTask, task.id)
	assert stored_task is not None
	assert stored_task.status == "DONE"
	assert stored_task.result_json is not None
	assert '"source_amount": 80' in stored_task.result_json
	mutations = list_asset_mutation_audits(
		current_user,
		session,
		limit=20,
		agent_task_id=task.id,
	)
	assert any(item.entity_type == "CASH_TRANSFER" for item in mutations)
	assert any(item.entity_type == "CASH_ACCOUNT" for item in mutations)
	db_mutations = list(
		session.exec(
			select(AssetMutationAudit).where(AssetMutationAudit.agent_task_id == task.id),
		),
	)
	assert len(db_mutations) >= 2


def test_agent_task_can_create_and_delete_manual_cash_ledger_adjustment(
	session: Session,
) -> None:
	current_user = make_user(session)
	account = create_account(
		CashAccountCreate(
			name="主账户",
			platform="Bank",
			currency="CNY",
			balance=100,
			account_type="BANK",
		),
		current_user,
		session,
	)

	create_task = create_agent_task(
		AgentTaskCreate(
			task_type="CREATE_CASH_LEDGER_ADJUSTMENT",
			payload={
				"cash_account_id": account.id,
				"amount": 15,
				"happened_on": "2026-03-10",
				"note": "agent manual adjustment",
			},
		),
		current_user,
		session,
		"agent-task-ledger-create-001",
	)

	assert create_task.status == "PENDING"
	assert run_background_jobs() >= 1
	session.expire_all()
	stored_create_task = session.get(AgentTask, create_task.id)
	assert stored_create_task is not None
	assert stored_create_task.status == "DONE"
	assert stored_create_task.result_json is not None
	entry_id = int(json.loads(stored_create_task.result_json)["entry"]["id"])
	entry = session.get(CashLedgerEntry, entry_id)
	assert entry is not None
	assert entry.entry_type == "MANUAL_ADJUSTMENT"

	delete_task = create_agent_task(
		AgentTaskCreate(
			task_type="DELETE_CASH_LEDGER_ADJUSTMENT",
			payload={
				"entry_id": entry_id,
			},
		),
		current_user,
		session,
		"agent-task-ledger-delete-001",
	)

	assert delete_task.status == "PENDING"
	assert run_background_jobs() >= 1
	session.expire_all()
	stored_delete_task = session.get(AgentTask, delete_task.id)
	assert stored_delete_task is not None
	assert stored_delete_task.status == "DONE"
	assert stored_delete_task.result_json is not None
	assert json.loads(stored_delete_task.result_json) == {"message": "手工账本调整已删除。"}
	assert session.get(CashLedgerEntry, entry_id) is None
	mutations = list_asset_mutation_audits(
		current_user,
		session,
		limit=20,
		agent_task_id=delete_task.id,
	)
	assert any(item.entity_type == "CASH_LEDGER_ADJUSTMENT" for item in mutations)
