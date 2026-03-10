import asyncio
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlmodel import SQLModel, Session, create_engine, select

from app import runtime_state
import app.main as main
from app.analytics import bucket_start_utc
from app.main import (
	create_account,
	create_dashboard_correction,
	delete_account,
	update_account,
)
from app.models import AssetMutationAudit, PortfolioSnapshot, UserAccount
from app.schemas import CashAccountCreate, CashAccountUpdate, DashboardCorrectionCreate


class StaticMarketDataClient:
	async def fetch_fx_rate(self, from_currency: str, to_currency: str) -> tuple[float, list[str]]:
		if from_currency.upper() == to_currency.upper():
			return 1.0, []
		return 7.0, []

	async def fetch_quote(
		self,
		symbol: str,
		market: str | None = None,
	) -> tuple[object, list[str]]:
		raise AssertionError("Quote fetching is not expected in this test.")

	def clear_runtime_caches(self, *, clear_search: bool = False) -> None:
		return None


def _reset_async_runtime_state() -> None:
	runtime_state.set_last_global_force_refresh_at(None)
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
		f"sqlite:///{tmp_path / 'dashboard-corrections-audit-test.db'}",
		connect_args={"check_same_thread": False},
	)
	SQLModel.metadata.create_all(engine)
	main.dashboard_cache.clear()
	main.live_portfolio_states.clear()
	main.live_holdings_return_states.clear()
	_reset_async_runtime_state()

	with Session(engine) as db_session:
		yield db_session

	main.dashboard_cache.clear()
	main.live_portfolio_states.clear()
	main.live_holdings_return_states.clear()
	_reset_async_runtime_state()


def make_user(session: Session, username: str = "tester") -> UserAccount:
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


def test_dashboard_correction_override_and_delete_are_applied_to_hour_series(
	session: Session,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	user = make_user(session, "correction_user")
	monkeypatch.setattr(main.core_support, "market_data_client", StaticMarketDataClient())

	now = datetime.now(timezone.utc)
	older_point_at = now - timedelta(hours=2)
	newer_point_at = now - timedelta(hours=1)

	session.add(
		PortfolioSnapshot(
			user_id=user.username,
			total_value_cny=1000,
			created_at=older_point_at,
		),
	)
	session.add(
		PortfolioSnapshot(
			user_id=user.username,
			total_value_cny=2000,
			created_at=newer_point_at,
		),
	)
	session.commit()

	create_dashboard_correction(
		DashboardCorrectionCreate(
			series_scope="PORTFOLIO_TOTAL",
			granularity="hour",
			bucket_utc=older_point_at,
			action="OVERRIDE",
			corrected_value=888,
			reason="修正误录数据",
		),
		user,
		session,
	)
	create_dashboard_correction(
		DashboardCorrectionCreate(
			series_scope="PORTFOLIO_TOTAL",
			granularity="hour",
			bucket_utc=newer_point_at,
			action="DELETE",
			reason="删除异常点",
		),
		user,
		session,
	)

	dashboard = asyncio.run(main._build_dashboard(session, user))
	bucket_utc = bucket_start_utc(older_point_at, "hour")

	assert len(dashboard.hour_series) == 1
	assert dashboard.hour_series[0].value == 888
	assert dashboard.hour_series[0].corrected is True
	assert dashboard.hour_series[0].timestamp_utc == bucket_utc


def test_account_crud_generates_mutation_audit_rows(session: Session) -> None:
	user = make_user(session, "audit_user")

	created_account = create_account(
		CashAccountCreate(
			name="Audit Wallet",
			platform="Bank",
			currency="cny",
			balance=10,
			account_type="bank",
		),
		user,
		session,
	)
	updated_account = update_account(
		created_account.id,
		CashAccountUpdate(
			name="Audit Wallet 2",
			platform="Bank",
			currency="cny",
			balance=20,
			account_type="bank",
		),
		user,
		session,
	)
	delete_account(updated_account.id, user, session)

	audits = list(
		session.exec(
			select(AssetMutationAudit)
			.where(AssetMutationAudit.user_id == user.username)
			.order_by(AssetMutationAudit.created_at.asc()),
		),
	)

	assert [audit.operation for audit in audits] == ["CREATE", "UPDATE", "DELETE"]
	assert audits[0].before_state is None
	assert audits[0].after_state is not None
	assert "Audit Wallet" in (audits[0].after_state or "")
	assert audits[1].before_state is not None
	assert audits[1].after_state is not None
	assert "Audit Wallet 2" in (audits[1].after_state or "")
	assert audits[2].before_state is not None
	assert audits[2].after_state is None


def test_dashboard_correction_requires_symbol_for_holding_scope() -> None:
	with pytest.raises(ValidationError):
		DashboardCorrectionCreate(
			series_scope="HOLDING_RETURN",
			granularity="day",
			bucket_utc=datetime.now(timezone.utc),
			action="OVERRIDE",
			corrected_value=1.23,
			reason="缺少symbol",
		)
