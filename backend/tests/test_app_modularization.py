import asyncio
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

import app.database as database
from app import runtime_state
import app.main as main
import app.worker as worker
from app.main import create_holding_transaction
from app.models import OutboxJob, UserAccount
from app.schemas import SecurityHoldingTransactionCreate
from app.security import hash_password
from app.services import dashboard_service, history_service, job_service, legacy_service, service_context


class StaticDashboardMarketDataClient:
	async def fetch_fx_rate(
		self,
		from_currency: str,
		to_currency: str,
		*,
		prefer_stale: bool = False,
	) -> tuple[float, list[str]]:
		if from_currency.upper() == to_currency.upper():
			return 1.0, []
		return 7.0, []

	async def fetch_quote(
		self,
		symbol: str,
		market: str | None = None,
		*,
		prefer_stale: bool = False,
	):
		raise AssertionError("Quote lookup should not run for an empty dashboard test.")

	async def fetch_hourly_price_series(self, *args, **kwargs):
		return [], "CNY", []

	def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
		return None


def _reset_snapshot_runtime_state() -> None:
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
		f"sqlite:///{tmp_path / 'app-modularization-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)
	monkeypatch.setattr(database, "engine", engine)
	monkeypatch.setattr(job_service, "engine", engine)
	monkeypatch.setattr(legacy_service, "engine", engine)

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


def test_api_lifespan_only_initializes_db(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	call_order: list[str] = []

	def fake_validate_runtime() -> None:
		call_order.append("validate_runtime")

	def fake_validate_runtime_redis_connection() -> None:
		call_order.append("validate_runtime_redis_connection")

	def fake_init_db() -> None:
		call_order.append("init_db")

	def fail_heavy_startup(*_args, **_kwargs) -> None:
		raise AssertionError("Legacy startup backfill should not run during app lifespan.")

	monkeypatch.setattr(main, "init_db", fake_init_db)
	monkeypatch.setattr(main, "validate_runtime_redis_connection", fake_validate_runtime_redis_connection)
	monkeypatch.setattr(legacy_service, "_ensure_legacy_schema", fail_heavy_startup)
	monkeypatch.setattr(legacy_service, "_migrate_legacy_holdings_to_transactions", fail_heavy_startup)
	monkeypatch.setattr(
		legacy_service,
		"_backfill_holding_transaction_cash_settlements",
		fail_heavy_startup,
	)
	monkeypatch.setattr(legacy_service, "_backfill_cash_ledger_entries", fail_heavy_startup)
	monkeypatch.setattr(legacy_service, "_audit_legacy_user_ownership", fail_heavy_startup)
	monkeypatch.setattr(
		main,
		"settings",
		type("FakeSettings", (), {"validate_runtime": staticmethod(fake_validate_runtime)})(),
	)

	async def exercise_lifespan() -> None:
		async with main.lifespan(main.app):
			call_order.append("inside_lifespan")

	asyncio.run(exercise_lifespan())

	assert call_order == [
		"validate_runtime",
		"validate_runtime_redis_connection",
		"init_db",
		"inside_lifespan",
	]


def test_worker_lifecycle_initializes_db_and_background_job_worker(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	call_order: list[str] = []

	def fake_init_db() -> None:
		call_order.append("init_db")

	def fake_validate_runtime() -> None:
		call_order.append("validate_runtime")

	def fake_validate_runtime_redis_connection() -> None:
		call_order.append("validate_runtime_redis_connection")

	def fake_start_background_job_worker() -> None:
		call_order.append("start_background_job_worker")

	async def fake_stop_background_job_worker() -> None:
		call_order.append("stop_background_job_worker")

	class FakeLoop:
		def add_signal_handler(self, _sig, callback) -> None:
			call_order.append("add_signal_handler")
			if call_order.count("add_signal_handler") == 2:
				callback()

	class FakeSettings:
		def validate_runtime(self) -> None:
			fake_validate_runtime()

	monkeypatch.setattr(worker, "init_db", fake_init_db)
	monkeypatch.setattr(worker, "settings", FakeSettings())
	monkeypatch.setattr(worker, "validate_runtime_redis_connection", fake_validate_runtime_redis_connection)
	monkeypatch.setattr(worker, "start_background_job_worker", fake_start_background_job_worker)
	monkeypatch.setattr(worker, "stop_background_job_worker", fake_stop_background_job_worker)
	monkeypatch.setattr(asyncio, "get_running_loop", lambda: FakeLoop())

	asyncio.run(worker.run_worker())

	assert call_order == [
		"validate_runtime",
		"validate_runtime_redis_connection",
		"init_db",
		"add_signal_handler",
		"add_signal_handler",
		"start_background_job_worker",
		"stop_background_job_worker",
	]


def test_snapshot_rebuild_enqueue_deduplicates_pending_jobs(session: Session) -> None:
	job_service.enqueue_user_portfolio_snapshot_rebuild(session, " tester ")
	job_service.enqueue_user_portfolio_snapshot_rebuild(session, "tester")
	job_service.enqueue_user_portfolio_snapshot_rebuild(session, "tester")
	session.commit()

	jobs = list(session.exec(select(OutboxJob)).all())
	assert len(jobs) == 1
	assert jobs[0].job_type == "SNAPSHOT_REBUILD"
	assert jobs[0].user_id == "tester"
	assert jobs[0].status == "PENDING"


def test_create_holding_transaction_only_schedules_snapshot_rebuild(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)

	async def fail_sync_rebuild(*_args, **_kwargs) -> None:
		raise AssertionError("Holding writes should not rebuild snapshots synchronously.")

	monkeypatch.setattr(
		history_service,
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
	jobs = list(session.exec(select(OutboxJob)).all())
	assert len(jobs) == 1
	assert jobs[0].job_type == "SNAPSHOT_REBUILD"
	assert jobs[0].user_id == current_user.username


def test_get_cached_dashboard_does_not_execute_snapshot_jobs_inline(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	job_service.enqueue_user_portfolio_snapshot_rebuild(session, current_user.username)
	session.commit()

	async def fail_sync_rebuild(*_args, **_kwargs) -> None:
		raise AssertionError("Dashboard reads should not rebuild snapshots inline.")

	monkeypatch.setattr(history_service, "_rebuild_user_portfolio_snapshots", fail_sync_rebuild)
	monkeypatch.setattr(service_context, "market_data_client", StaticDashboardMarketDataClient())

	dashboard = asyncio.run(main._get_cached_dashboard(session, current_user))

	assert dashboard.total_value_cny == 0
	job = session.exec(select(OutboxJob)).one()
	assert job.status == "PENDING"


def test_background_job_worker_processes_snapshot_rebuild_job(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	current_user = make_user(session)
	job = job_service.enqueue_user_portfolio_snapshot_rebuild(session, current_user.username)
	session.commit()
	rebuilt_users: list[str] = []

	async def fake_rebuild(_session: Session, user_id: str) -> None:
		rebuilt_users.append(user_id)

	monkeypatch.setattr(history_service, "_rebuild_user_portfolio_snapshots", fake_rebuild)

	assert asyncio.run(job_service.process_next_background_job()) is True

	session.refresh(job)
	assert rebuilt_users == [current_user.username]
	assert job.status == "DONE"
