from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, Query
from fastapi.responses import Response
from sqlmodel import Session, select

from app import runtime_state
from app.analytics import bucket_start_utc, build_return_timeline, build_timeline
from app.models import (
    CashAccount,
    DashboardCorrection,
    FixedAsset,
    HoldingPerformanceSnapshot,
    LiabilityEntry,
    OtherAsset,
    PortfolioSnapshot,
    SecurityHolding,
    UserAccount,
    utc_now,
)
from app.runtime_state import (
	DashboardCacheEntry,
	LiveHoldingReturnPoint,
	LiveHoldingsReturnState,
	LivePortfolioState,
)
from app.schemas import (
	AllocationSlice,
	DashboardCorrectionCreate,
	DashboardCorrectionRead,
	DashboardResponse,
	HoldingReturnSeries,
	ValuedHolding,
)
from app.services.auth_service import CurrentUserDependency
from app.services.common_service import (
	DASHBOARD_CORRECTION_ACTIONS,
	DASHBOARD_CORRECTION_GRANULARITIES,
	DASHBOARD_SERIES_SCOPES,
	_consume_global_force_refresh_slot,
	_coerce_utc_datetime,
    _current_hour_bucket,
    _filter_dashboard_warnings_for_user,
    _invalidate_dashboard_cache,
    _is_current_minute,
    _server_today_date,
)
from app.services.history_sync_service import _has_holding_history_sync_pending
from app.services.portfolio_service import (
    _load_display_fx_rates,
    _value_cash_accounts,
    _value_fixed_assets,
    _value_holdings,
    _value_liabilities,
    _value_other_assets,
)
from app.services import service_context
from app.services.service_context import SessionDependency

async def _refresh_user_dashboards(
	session: Session,
	users: list[UserAccount],
	*,
	clear_market_data: bool = False,
) -> None:
	if clear_market_data:
		service_context.market_data_client.clear_runtime_caches()

	for user in users:
		await _get_cached_dashboard(session, user, force_refresh=True)

def _summarize_holdings_return_state(
	holdings: list[ValuedHolding],
) -> tuple[float | None, tuple[LiveHoldingReturnPoint, ...]]:
	total_cost_basis_cny = 0.0
	total_market_value_cny = 0.0
	points: list[LiveHoldingReturnPoint] = []

	for holding in holdings:
		if (
			holding.cost_basis_price is None
			or holding.cost_basis_price <= 0
			or holding.fx_to_cny <= 0
			or holding.quantity <= 0
			or holding.return_pct is None
		):
			continue

		cost_basis_value_cny = holding.cost_basis_price * holding.quantity * holding.fx_to_cny
		if cost_basis_value_cny <= 0:
			continue

		total_cost_basis_cny += cost_basis_value_cny
		total_market_value_cny += holding.value_cny
		points.append(
			LiveHoldingReturnPoint(
				symbol=holding.symbol,
				name=holding.name,
				return_pct=holding.return_pct,
			),
		)

	if total_cost_basis_cny <= 0:
		return None, tuple(points)

	return (
		round(((total_market_value_cny - total_cost_basis_cny) / total_cost_basis_cny) * 100, 2),
		tuple(points),
	)

def _build_transient_portfolio_snapshot(
	*,
	user_id: str,
	generated_at: datetime,
	total_value_cny: float,
	has_assets: bool,
) -> PortfolioSnapshot | None:
	if not has_assets:
		return None
	return PortfolioSnapshot(
		user_id=user_id,
		total_value_cny=total_value_cny,
		created_at=generated_at,
	)

def _build_transient_holdings_return_snapshots(
	*,
	user_id: str,
	generated_at: datetime,
	aggregate_return_pct: float | None,
	holding_points: tuple[LiveHoldingReturnPoint, ...],
) -> dict[tuple[str, str | None], HoldingPerformanceSnapshot]:
	snapshots: dict[tuple[str, str | None], HoldingPerformanceSnapshot] = {}
	if aggregate_return_pct is not None:
		snapshots[("TOTAL", None)] = HoldingPerformanceSnapshot(
			user_id=user_id,
			scope="TOTAL",
			symbol=None,
			name="非现金资产",
			return_pct=aggregate_return_pct,
			created_at=generated_at,
		)
	for point in holding_points:
		snapshots[("HOLDING", point.symbol)] = HoldingPerformanceSnapshot(
			user_id=user_id,
			scope="HOLDING",
			symbol=point.symbol,
			name=point.name,
			return_pct=point.return_pct,
			created_at=generated_at,
		)
	return snapshots

def _persist_holdings_return_snapshot(
	session: Session,
	user_id: str,
	hour_bucket: datetime,
	aggregate_return_pct: float | None,
	holding_points: tuple[LiveHoldingReturnPoint, ...],
) -> None:
	hour_start = _current_hour_bucket(hour_bucket)
	hour_end = hour_start + timedelta(hours=1)
	existing_snapshots = list(
		session.exec(
			select(HoldingPerformanceSnapshot)
			.where(HoldingPerformanceSnapshot.user_id == user_id)
			.where(HoldingPerformanceSnapshot.created_at >= hour_start)
			.where(HoldingPerformanceSnapshot.created_at < hour_end)
			.order_by(HoldingPerformanceSnapshot.created_at.desc()),
		),
	)
	indexed_snapshots = {
		(snapshot.scope, snapshot.symbol or ""): snapshot for snapshot in existing_snapshots
	}
	expected_keys: set[tuple[str, str]] = set()

	if aggregate_return_pct is not None:
		key = ("TOTAL", "")
		expected_keys.add(key)
		snapshot = indexed_snapshots.get(key)
		if snapshot is None:
			session.add(
				HoldingPerformanceSnapshot(
					user_id=user_id,
					scope="TOTAL",
					symbol=None,
					name="非现金资产",
					return_pct=aggregate_return_pct,
					created_at=hour_start,
				),
			)
		else:
			snapshot.name = "非现金资产"
			snapshot.return_pct = aggregate_return_pct
			snapshot.created_at = hour_start
			session.add(snapshot)

	for point in holding_points:
		key = ("HOLDING", point.symbol)
		expected_keys.add(key)
		snapshot = indexed_snapshots.get(key)
		if snapshot is None:
			session.add(
				HoldingPerformanceSnapshot(
					user_id=user_id,
					scope="HOLDING",
					symbol=point.symbol,
					name=point.name,
					return_pct=point.return_pct,
					created_at=hour_start,
				),
			)
		else:
			snapshot.name = point.name
			snapshot.return_pct = point.return_pct
			snapshot.created_at = hour_start
			session.add(snapshot)

	for snapshot in existing_snapshots:
		key = (snapshot.scope, snapshot.symbol or "")
		if key not in expected_keys:
			session.delete(snapshot)

	session.commit()

def _persist_hour_snapshot(
	session: Session,
	user_id: str,
	hour_bucket: datetime,
	total_value_cny: float,
) -> None:
	hour_start = _current_hour_bucket(hour_bucket)
	hour_end = hour_start + timedelta(hours=1)
	existing_snapshots = list(
		session.exec(
			select(PortfolioSnapshot)
			.where(PortfolioSnapshot.user_id == user_id)
			.where(PortfolioSnapshot.created_at >= hour_start)
			.where(PortfolioSnapshot.created_at < hour_end)
			.order_by(PortfolioSnapshot.created_at.desc()),
		),
	)
	primary_snapshot = existing_snapshots[0] if existing_snapshots else None

	if primary_snapshot is None:
		session.add(
				PortfolioSnapshot(
					user_id=user_id,
					total_value_cny=total_value_cny,
					created_at=hour_start,
				),
		)
	else:
		primary_snapshot.total_value_cny = total_value_cny
		primary_snapshot.created_at = hour_start
		session.add(primary_snapshot)

	for duplicate_snapshot in existing_snapshots[1:]:
		session.delete(duplicate_snapshot)

	session.commit()

def _roll_live_portfolio_state_if_needed(session: Session, user_id: str, now: datetime) -> None:
	live_portfolio_state = runtime_state.live_portfolio_states.get(user_id)
	if live_portfolio_state is None:
		return

	current_hour = _current_hour_bucket(now)
	if live_portfolio_state.hour_bucket >= current_hour:
		return

	if live_portfolio_state.has_assets_in_bucket or live_portfolio_state.latest_value_cny > 0:
		_persist_hour_snapshot(
			session,
			user_id,
			live_portfolio_state.hour_bucket,
			live_portfolio_state.latest_value_cny,
		)

		runtime_state.live_portfolio_states.pop(user_id, None)

def _roll_live_holdings_return_state_if_needed(
	session: Session,
	user_id: str,
	now: datetime,
) -> None:
	live_holdings_return_state = runtime_state.live_holdings_return_states.get(user_id)
	if live_holdings_return_state is None:
		return

	current_hour = _current_hour_bucket(now)
	if live_holdings_return_state.hour_bucket >= current_hour:
		return

	if (
		live_holdings_return_state.has_tracked_holdings_in_bucket
		or live_holdings_return_state.aggregate_return_pct is not None
	):
		_persist_holdings_return_snapshot(
			session,
			user_id,
			live_holdings_return_state.hour_bucket,
			live_holdings_return_state.aggregate_return_pct,
			live_holdings_return_state.holding_points,
		)

		runtime_state.live_holdings_return_states.pop(user_id, None)

def _update_live_portfolio_state(
	user_id: str,
	now: datetime,
	total_value_cny: float,
	has_assets: bool,
) -> None:
	live_portfolio_state = runtime_state.live_portfolio_states.get(user_id)
	current_hour = _current_hour_bucket(now)
	if live_portfolio_state is None:
		if not has_assets:
			return

		runtime_state.live_portfolio_states[user_id] = LivePortfolioState(
			hour_bucket=current_hour,
			latest_value_cny=total_value_cny,
			latest_generated_at=now,
			has_assets_in_bucket=has_assets,
		)
		return

	if live_portfolio_state.hour_bucket != current_hour:
		if not has_assets:
			runtime_state.live_portfolio_states.pop(user_id, None)
			return

		runtime_state.live_portfolio_states[user_id] = LivePortfolioState(
			hour_bucket=current_hour,
			latest_value_cny=total_value_cny,
			latest_generated_at=now,
			has_assets_in_bucket=has_assets,
		)
		return

	live_portfolio_state.latest_value_cny = total_value_cny
	live_portfolio_state.latest_generated_at = now
	live_portfolio_state.has_assets_in_bucket = (
		live_portfolio_state.has_assets_in_bucket or has_assets
	)
	runtime_state.live_portfolio_states[user_id] = live_portfolio_state

def _update_live_holdings_return_state(
	user_id: str,
	now: datetime,
	aggregate_return_pct: float | None,
	holding_points: tuple[LiveHoldingReturnPoint, ...],
) -> None:
	live_holdings_return_state = runtime_state.live_holdings_return_states.get(user_id)
	current_hour = _current_hour_bucket(now)
	has_tracked_holdings = bool(holding_points)
	has_return_data = has_tracked_holdings or aggregate_return_pct is not None

	if live_holdings_return_state is None:
		if not has_return_data:
			return

		runtime_state.live_holdings_return_states[user_id] = LiveHoldingsReturnState(
			hour_bucket=current_hour,
			latest_generated_at=now,
			aggregate_return_pct=aggregate_return_pct,
			holding_points=holding_points,
			has_tracked_holdings_in_bucket=has_tracked_holdings,
		)
		return

	if live_holdings_return_state.hour_bucket != current_hour:
		if not has_return_data:
			runtime_state.live_holdings_return_states.pop(user_id, None)
			return

		runtime_state.live_holdings_return_states[user_id] = LiveHoldingsReturnState(
			hour_bucket=current_hour,
			latest_generated_at=now,
			aggregate_return_pct=aggregate_return_pct,
			holding_points=holding_points,
			has_tracked_holdings_in_bucket=has_tracked_holdings,
		)
		return

	live_holdings_return_state.latest_generated_at = now
	live_holdings_return_state.aggregate_return_pct = aggregate_return_pct
	live_holdings_return_state.holding_points = holding_points
	live_holdings_return_state.has_tracked_holdings_in_bucket = (
		live_holdings_return_state.has_tracked_holdings_in_bucket or has_tracked_holdings
	)
	runtime_state.live_holdings_return_states[user_id] = live_holdings_return_state

def _load_series(session: Session, user_id: str, since: datetime) -> list[PortfolioSnapshot]:
	return list(
		session.exec(
			select(PortfolioSnapshot)
			.where(PortfolioSnapshot.user_id == user_id)
			.where(PortfolioSnapshot.created_at >= since)
			.order_by(PortfolioSnapshot.created_at.asc()),
		),
	)

def _load_series_with_live_snapshot(
	session: Session,
	user_id: str,
	since: datetime,
	*,
	live_snapshot: PortfolioSnapshot | None = None,
) -> list[PortfolioSnapshot]:
	snapshots = _load_series(session, user_id, since)
	if live_snapshot is not None and live_snapshot.created_at >= _coerce_utc_datetime(since):
		snapshots.append(live_snapshot)
	return snapshots

def _load_holdings_return_series(
	session: Session,
	user_id: str,
	since: datetime,
	scope: str,
	symbol: str | None = None,
) -> list[HoldingPerformanceSnapshot]:
	statement = (
		select(HoldingPerformanceSnapshot)
		.where(HoldingPerformanceSnapshot.user_id == user_id)
		.where(HoldingPerformanceSnapshot.created_at >= since)
		.where(HoldingPerformanceSnapshot.scope == scope)
		.order_by(HoldingPerformanceSnapshot.created_at.asc())
	)
	if symbol is None:
		statement = statement.where(HoldingPerformanceSnapshot.symbol.is_(None))
	else:
		statement = statement.where(HoldingPerformanceSnapshot.symbol == symbol)

	return list(session.exec(statement))

def _load_holdings_return_series_with_live_snapshot(
	session: Session,
	user_id: str,
	since: datetime,
	scope: str,
	symbol: str | None = None,
	default_name: str | None = None,
	*,
	live_snapshots: dict[tuple[str, str | None], HoldingPerformanceSnapshot] | None = None,
) -> list[HoldingPerformanceSnapshot]:
	snapshots = _load_holdings_return_series(session, user_id, since, scope, symbol)
	if live_snapshots is None:
		return snapshots

	live_snapshot = live_snapshots.get((scope, symbol))
	if live_snapshot is not None and live_snapshot.created_at >= _coerce_utc_datetime(since):
		snapshots.append(live_snapshot)
	return snapshots

async def _build_dashboard(session: Session, user: UserAccount) -> DashboardResponse:
	user_id = user.username
	now = utc_now()
	fx_rate_overrides, usd_cny_rate, hkd_cny_rate, fx_display_warnings = await _load_display_fx_rates()

	accounts = list(
		session.exec(
			select(CashAccount)
			.where(CashAccount.user_id == user_id)
			.order_by(CashAccount.platform, CashAccount.name),
		),
	)
	holdings = list(
		session.exec(
			select(SecurityHolding)
			.where(SecurityHolding.user_id == user_id)
			.order_by(SecurityHolding.symbol, SecurityHolding.name),
		),
	)
	fixed_assets = list(
		session.exec(
			select(FixedAsset)
			.where(FixedAsset.user_id == user_id)
			.order_by(FixedAsset.category, FixedAsset.name),
		),
	)
	liabilities = list(
		session.exec(
			select(LiabilityEntry)
			.where(LiabilityEntry.user_id == user_id)
			.order_by(LiabilityEntry.category, LiabilityEntry.name),
		),
	)
	other_assets = list(
		session.exec(
			select(OtherAsset)
			.where(OtherAsset.user_id == user_id)
			.order_by(OtherAsset.category, OtherAsset.name),
		),
	)
	history_sync_pending = _has_holding_history_sync_pending(session, user_id)

	valued_accounts, cash_value_cny, account_warnings = await _value_cash_accounts(
		accounts,
		fx_rate_overrides,
	)
	valued_holdings, holdings_value_cny, holding_warnings = await _value_holdings(
		holdings,
		fx_rate_overrides,
		force_pending=history_sync_pending,
	)
	valued_fixed_assets, fixed_assets_value_cny = _value_fixed_assets(fixed_assets)
	valued_liabilities, liabilities_value_cny, liability_warnings = await _value_liabilities(
		liabilities,
		fx_rate_overrides,
	)
	valued_other_assets, other_assets_value_cny = _value_other_assets(other_assets)
	total_value_cny = round(
		cash_value_cny
		+ holdings_value_cny
		+ fixed_assets_value_cny
		+ other_assets_value_cny
		- liabilities_value_cny,
		2,
	)
	has_assets = bool(accounts or holdings or fixed_assets or liabilities or other_assets)
	aggregate_holdings_return_pct, holding_return_points = _summarize_holdings_return_state(
		valued_holdings,
	)
	live_portfolio_snapshot = _build_transient_portfolio_snapshot(
		user_id=user_id,
		generated_at=now,
		total_value_cny=total_value_cny,
		has_assets=has_assets,
	)
	live_holdings_return_snapshots = _build_transient_holdings_return_snapshots(
		user_id=user_id,
		generated_at=now,
		aggregate_return_pct=aggregate_holdings_return_pct,
		holding_points=holding_return_points,
	)
	correction_lookup = _load_dashboard_correction_lookup(session, user_id)

	hour_series_raw = build_timeline(
		_load_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(hours=24),
			live_snapshot=live_portfolio_snapshot,
		),
		"hour",
	)
	day_series_raw = build_timeline(
		_load_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=30),
			live_snapshot=live_portfolio_snapshot,
		),
		"day",
	)
	month_series_raw = build_timeline(
		_load_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=366),
			live_snapshot=live_portfolio_snapshot,
		),
		"month",
	)
	year_series_raw = build_timeline(
		_load_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=366 * 5),
			live_snapshot=live_portfolio_snapshot,
		),
		"year",
	)
	hour_series = _apply_dashboard_corrections(
		hour_series_raw,
		correction_lookup,
		series_scope="PORTFOLIO_TOTAL",
		granularity="hour",
	)
	day_series = _apply_dashboard_corrections(
		day_series_raw,
		correction_lookup,
		series_scope="PORTFOLIO_TOTAL",
		granularity="day",
	)
	month_series = _apply_dashboard_corrections(
		month_series_raw,
		correction_lookup,
		series_scope="PORTFOLIO_TOTAL",
		granularity="month",
	)
	year_series = _apply_dashboard_corrections(
		year_series_raw,
		correction_lookup,
		series_scope="PORTFOLIO_TOTAL",
		granularity="year",
	)

	holdings_return_hour_series_raw = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(hours=24),
			"TOTAL",
			default_name="非现金资产",
			live_snapshots=live_holdings_return_snapshots,
		),
		"hour",
	)
	holdings_return_day_series_raw = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=30),
			"TOTAL",
			default_name="非现金资产",
			live_snapshots=live_holdings_return_snapshots,
		),
		"day",
	)
	holdings_return_month_series_raw = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=366),
			"TOTAL",
			default_name="非现金资产",
			live_snapshots=live_holdings_return_snapshots,
		),
		"month",
	)
	holdings_return_year_series_raw = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=366 * 5),
			"TOTAL",
			default_name="非现金资产",
			live_snapshots=live_holdings_return_snapshots,
		),
		"year",
	)
	holdings_return_hour_series = _apply_dashboard_corrections(
		holdings_return_hour_series_raw,
		correction_lookup,
		series_scope="HOLDINGS_RETURN_TOTAL",
		granularity="hour",
	)
	holdings_return_day_series = _apply_dashboard_corrections(
		holdings_return_day_series_raw,
		correction_lookup,
		series_scope="HOLDINGS_RETURN_TOTAL",
		granularity="day",
	)
	holdings_return_month_series = _apply_dashboard_corrections(
		holdings_return_month_series_raw,
		correction_lookup,
		series_scope="HOLDINGS_RETURN_TOTAL",
		granularity="month",
	)
	holdings_return_year_series = _apply_dashboard_corrections(
		holdings_return_year_series_raw,
		correction_lookup,
		series_scope="HOLDINGS_RETURN_TOTAL",
		granularity="year",
	)
	holding_return_series = []
	for holding in valued_holdings:
		if holding.cost_basis_price is None:
			continue

		holding_hour_series_raw = build_return_timeline(
			_load_holdings_return_series_with_live_snapshot(
				session,
				user_id,
				now - timedelta(hours=24),
				"HOLDING",
				symbol=holding.symbol,
				default_name=holding.name,
				live_snapshots=live_holdings_return_snapshots,
			),
			"hour",
		)
		holding_day_series_raw = build_return_timeline(
			_load_holdings_return_series_with_live_snapshot(
				session,
				user_id,
				now - timedelta(days=30),
				"HOLDING",
				symbol=holding.symbol,
				default_name=holding.name,
				live_snapshots=live_holdings_return_snapshots,
			),
			"day",
		)
		holding_month_series_raw = build_return_timeline(
			_load_holdings_return_series_with_live_snapshot(
				session,
				user_id,
				now - timedelta(days=366),
				"HOLDING",
				symbol=holding.symbol,
				default_name=holding.name,
				live_snapshots=live_holdings_return_snapshots,
			),
			"month",
		)
		holding_year_series_raw = build_return_timeline(
			_load_holdings_return_series_with_live_snapshot(
				session,
				user_id,
				now - timedelta(days=366 * 5),
				"HOLDING",
				symbol=holding.symbol,
				default_name=holding.name,
				live_snapshots=live_holdings_return_snapshots,
			),
			"year",
		)

		holding_return_series.append(
			HoldingReturnSeries(
				symbol=holding.symbol,
				name=holding.name,
				hour_series=_apply_dashboard_corrections(
					holding_hour_series_raw,
					correction_lookup,
					series_scope="HOLDING_RETURN",
					granularity="hour",
					symbol=holding.symbol,
				),
				day_series=_apply_dashboard_corrections(
					holding_day_series_raw,
					correction_lookup,
					series_scope="HOLDING_RETURN",
					granularity="day",
					symbol=holding.symbol,
				),
				month_series=_apply_dashboard_corrections(
					holding_month_series_raw,
					correction_lookup,
					series_scope="HOLDING_RETURN",
					granularity="month",
					symbol=holding.symbol,
				),
				year_series=_apply_dashboard_corrections(
					holding_year_series_raw,
					correction_lookup,
					series_scope="HOLDING_RETURN",
					granularity="year",
					symbol=holding.symbol,
				),
			),
		)

	dashboard_warnings = [
		*(
			["持仓历史更新中，曲线会在回填完成后自动同步。"]
			if history_sync_pending
			else []
		),
		*fx_display_warnings,
		*account_warnings,
		*holding_warnings,
		*liability_warnings,
	]

	return DashboardResponse(
		server_today=_server_today_date(now),
		total_value_cny=total_value_cny,
		cash_value_cny=cash_value_cny,
		holdings_value_cny=holdings_value_cny,
		fixed_assets_value_cny=fixed_assets_value_cny,
		liabilities_value_cny=liabilities_value_cny,
		other_assets_value_cny=other_assets_value_cny,
		usd_cny_rate=usd_cny_rate,
		hkd_cny_rate=hkd_cny_rate,
		cash_accounts=valued_accounts,
		holdings=valued_holdings,
		fixed_assets=valued_fixed_assets,
		liabilities=valued_liabilities,
		other_assets=valued_other_assets,
		allocation=[
			AllocationSlice(label=label, value=value)
			for label, value in (
				("现金", cash_value_cny),
				("投资类", holdings_value_cny),
				("固定资产", fixed_assets_value_cny),
				("其他", other_assets_value_cny),
			)
			if value > 0
		],
		hour_series=hour_series,
		day_series=day_series,
		month_series=month_series,
		year_series=year_series,
		holdings_return_hour_series=holdings_return_hour_series,
		holdings_return_day_series=holdings_return_day_series,
		holdings_return_month_series=holdings_return_month_series,
		holdings_return_year_series=holdings_return_year_series,
		holding_return_series=holding_return_series,
		warnings=_filter_dashboard_warnings_for_user(dashboard_warnings, user),
	)

async def _get_cached_dashboard(
	session: Session,
	user: UserAccount,
	force_refresh: bool = False,
) -> DashboardResponse:
	cache_entry = runtime_state.dashboard_cache.get(user.username)

	if (
		not force_refresh
		and cache_entry is not None
		and _is_current_minute(cache_entry.generated_at)
	):
		return cache_entry.dashboard

	async with runtime_state.dashboard_cache_lock:
		cache_entry = runtime_state.dashboard_cache.get(user.username)
		if (
			not force_refresh
			and cache_entry is not None
			and _is_current_minute(cache_entry.generated_at)
		):
			return cache_entry.dashboard

		dashboard = await _build_dashboard(session, user)
		runtime_state.dashboard_cache[user.username] = DashboardCacheEntry(
			dashboard=dashboard,
			generated_at=utc_now(),
		)
		return dashboard

def healthcheck() -> dict[str, str]:
	return {"status": "ok"}

def _to_dashboard_correction_read(correction: DashboardCorrection) -> DashboardCorrectionRead:
	return DashboardCorrectionRead(
		id=correction.id or 0,
		series_scope=correction.series_scope,
		symbol=correction.symbol,
		granularity=correction.granularity,
		bucket_utc=correction.bucket_utc,
		action=correction.action,
		corrected_value=correction.corrected_value,
		reason=correction.reason,
		created_at=correction.created_at,
		updated_at=correction.updated_at,
	)

def _correction_key(
	series_scope: str,
	symbol: str | None,
	granularity: str,
	bucket_utc: datetime,
) -> tuple[str, str, str, datetime]:
	return (
		series_scope,
		(symbol or "").upper(),
		granularity,
		_coerce_utc_datetime(bucket_utc),
	)

def _load_dashboard_correction_lookup(
	session: Session,
	user_id: str,
) -> dict[tuple[str, str, str, datetime], DashboardCorrection]:
	rows = list(
		session.exec(
			select(DashboardCorrection)
			.where(DashboardCorrection.user_id == user_id)
			.order_by(DashboardCorrection.bucket_utc.asc(), DashboardCorrection.updated_at.asc()),
		),
	)
	lookup: dict[tuple[str, str, str, datetime], DashboardCorrection] = {}
	for row in rows:
		lookup[_correction_key(row.series_scope, row.symbol, row.granularity, row.bucket_utc)] = row
	return lookup

def _apply_dashboard_corrections(
	points: list[Any],
	correction_lookup: dict[tuple[str, str, str, datetime], DashboardCorrection],
	*,
	series_scope: str,
	granularity: str,
	symbol: str | None = None,
) -> list[Any]:
	corrected_points: list[Any] = []
	for point in points:
		point_timestamp = _coerce_utc_datetime(point.timestamp_utc)
		correction = correction_lookup.get(
			_correction_key(series_scope, symbol, granularity, point_timestamp),
		)
		if correction is None:
			corrected_points.append(point)
			continue

		if correction.action == "DELETE":
			continue

		updated_value = point.value
		if correction.corrected_value is not None:
			updated_value = round(correction.corrected_value, 2)

		corrected_points.append(
			point.model_copy(
				update={
					"value": updated_value,
					"corrected": True,
				},
			),
		)
	return corrected_points

def create_dashboard_correction(
	payload: DashboardCorrectionCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> DashboardCorrectionRead:
	if payload.series_scope not in DASHBOARD_SERIES_SCOPES:
		raise HTTPException(status_code=422, detail="Unsupported series_scope.")
	if payload.action not in DASHBOARD_CORRECTION_ACTIONS:
		raise HTTPException(status_code=422, detail="Unsupported correction action.")
	if payload.granularity not in DASHBOARD_CORRECTION_GRANULARITIES:
		raise HTTPException(status_code=422, detail="Unsupported granularity.")

	bucket_utc = bucket_start_utc(payload.bucket_utc, payload.granularity)
	correction = DashboardCorrection(
		user_id=current_user.username,
		series_scope=payload.series_scope,
		symbol=payload.symbol.upper() if payload.symbol else None,
		granularity=payload.granularity,
		bucket_utc=bucket_utc,
		action=payload.action,
		corrected_value=payload.corrected_value,
		reason=payload.reason,
	)
	session.add(correction)
	session.commit()
	session.refresh(correction)
	_invalidate_dashboard_cache(current_user.username)
	return _to_dashboard_correction_read(correction)

def list_dashboard_corrections(
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[DashboardCorrectionRead]:
	corrections = list(
		session.exec(
			select(DashboardCorrection)
			.where(DashboardCorrection.user_id == current_user.username)
			.order_by(DashboardCorrection.bucket_utc.desc(), DashboardCorrection.updated_at.desc()),
		),
	)
	return [_to_dashboard_correction_read(correction) for correction in corrections]

def delete_dashboard_correction(
	correction_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	correction = session.get(DashboardCorrection, correction_id)
	if correction is None or correction.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Dashboard correction not found.")

	session.delete(correction)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)

async def get_dashboard(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	refresh: bool = False,
) -> DashboardResponse:
	if refresh:
		if await _consume_global_force_refresh_slot():
			service_context.market_data_client.clear_runtime_caches()
		_invalidate_dashboard_cache(current_user.username)
		return await _get_cached_dashboard(session, current_user, force_refresh=True)

	return await _get_cached_dashboard(session, current_user)

__all__ = ['_refresh_user_dashboards', '_summarize_holdings_return_state', '_build_transient_portfolio_snapshot', '_build_transient_holdings_return_snapshots', '_persist_holdings_return_snapshot', '_persist_hour_snapshot', '_roll_live_portfolio_state_if_needed', '_roll_live_holdings_return_state_if_needed', '_update_live_portfolio_state', '_update_live_holdings_return_state', '_load_series', '_load_series_with_live_snapshot', '_load_holdings_return_series', '_load_holdings_return_series_with_live_snapshot', '_build_dashboard', '_get_cached_dashboard', 'healthcheck', '_to_dashboard_correction_read', '_correction_key', '_load_dashboard_correction_lookup', '_apply_dashboard_corrections', 'create_dashboard_correction', 'list_dashboard_corrections', 'delete_dashboard_correction', 'get_dashboard']
