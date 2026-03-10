import asyncio
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from sqlmodel import SQLModel, Session, create_engine

from app import runtime_state
import app.main as main
from app.main import create_holding_transaction
from app.models import UserAccount
from app.schemas import SecurityHoldingTransactionCreate
from app.security import hash_password
from app.services import snapshot_service


def _reset_snapshot_runtime_state() -> None:
	runtime_state.last_global_force_refresh_at = None
	runtime_state.snapshot_rebuild_users_in_queue.clear()
	runtime_state.snapshot_rebuild_worker_task = None
	while True:
		try:
			runtime_state.snapshot_rebuild_queue.get_nowait()
		except asyncio.QueueEmpty:
			break
		runtime_state.snapshot_rebuild_queue.task_done()


@pytest.fixture
def session(tmp_path: Path) -> Iterator[Session]:
	engine = create_engine(
		f"sqlite:///{tmp_path / 'app-modularization-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)

	with Session(engine) as db_session:
		yield db_session


@pytest.fixture(autouse=True)
def reset_runtime_state() -> Iterator[None]:
	main.dashboard_cache.clear()
	main.login_attempt_states.clear()
	_reset_snapshot_runtime_state()
	yield
	main.dashboard_cache.clear()
	main.login_attempt_states.clear()
	_reset_snapshot_runtime_state()


def make_user(session: Session, username: str = "tester") -> UserAccount:
	user = UserAccount(
		username=username,
		password_digest=hash_password("qwer1234"),
	)
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def test_lifespan_only_initializes_db_and_snapshot_worker(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	call_order: list[str] = []

	def fake_init_db() -> None:
		call_order.append("init_db")

	def fake_start_snapshot_rebuild_worker() -> None:
		call_order.append("start_snapshot_worker")

	async def fake_stop_snapshot_rebuild_worker() -> None:
		call_order.append("stop_snapshot_worker")

	def fail_heavy_startup(*_args, **_kwargs) -> None:
		raise AssertionError("Legacy startup backfill should not run during app lifespan.")

	monkeypatch.setattr(main, "init_db", fake_init_db)
	monkeypatch.setattr(main, "start_snapshot_rebuild_worker", fake_start_snapshot_rebuild_worker)
	monkeypatch.setattr(main, "stop_snapshot_rebuild_worker", fake_stop_snapshot_rebuild_worker)
	monkeypatch.setattr(main.legacy_service, "_ensure_legacy_schema", fail_heavy_startup)
	monkeypatch.setattr(main.legacy_service, "_migrate_legacy_holdings_to_transactions", fail_heavy_startup)
	monkeypatch.setattr(
		main.legacy_service,
		"_backfill_holding_transaction_cash_settlements",
		fail_heavy_startup,
	)
	monkeypatch.setattr(main.legacy_service, "_backfill_cash_ledger_entries", fail_heavy_startup)
	monkeypatch.setattr(main.legacy_service, "_audit_legacy_user_ownership", fail_heavy_startup)

	async def exercise_lifespan() -> None:
		async with main.lifespan(main.app):
			call_order.append("inside_lifespan")

	asyncio.run(exercise_lifespan())

	assert call_order == [
		"init_db",
		"start_snapshot_worker",
		"inside_lifespan",
		"stop_snapshot_worker",
	]


def test_snapshot_rebuild_scheduler_deduplicates_pending_users() -> None:
	snapshot_service.schedule_user_portfolio_snapshot_rebuild(" tester ")
	snapshot_service.schedule_user_portfolio_snapshot_rebuild("tester")
	snapshot_service.schedule_user_portfolio_snapshot_rebuild("tester")

	assert runtime_state.snapshot_rebuild_users_in_queue == {"tester"}
	assert runtime_state.snapshot_rebuild_queue.qsize() == 1


def test_create_holding_transaction_only_schedules_snapshot_rebuild(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	scheduled_users: list[str] = []

	def fake_schedule_user_portfolio_snapshot_rebuild(user_id: str) -> None:
		scheduled_users.append(user_id)

	async def fail_sync_rebuild(*_args, **_kwargs) -> None:
		raise AssertionError("Holding writes should not rebuild snapshots synchronously.")

	monkeypatch.setattr(
		snapshot_service,
		"schedule_user_portfolio_snapshot_rebuild",
		fake_schedule_user_portfolio_snapshot_rebuild,
	)
	monkeypatch.setattr(
		main.legacy_service,
		"_rebuild_user_portfolio_snapshots",
		fail_sync_rebuild,
	)

	applied_transaction = create_holding_transaction(
		SecurityHoldingTransactionCreate(
			side="BUY",
			symbol="AAPL",
			name="Apple",
			market="US",
			quantity=2,
			price=180,
			fallback_currency="USD",
			traded_on=date(2026, 3, 9),
		),
		current_user,
		session,
		None,
	)

	assert applied_transaction.transaction.symbol == "AAPL"
	assert scheduled_users == [current_user.username]
