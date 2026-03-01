from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
from typing import Annotated

from sqlalchemy import text
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlmodel import Session, select
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.analytics import build_return_timeline, build_timeline
from app.database import engine, get_session, init_db
from app.models import (
	CashAccount,
	HoldingPerformanceSnapshot,
	PortfolioSnapshot,
	SecurityHolding,
	utc_now,
)
from app.schemas import (
	AllocationSlice,
	CashAccountCreate,
	CashAccountRead,
	CashAccountUpdate,
	DashboardResponse,
	HoldingReturnSeries,
	SecuritySearchRead,
	SecurityHoldingCreate,
	SecurityHoldingRead,
	SecurityHoldingUpdate,
	ValuedCashAccount,
	ValuedHolding,
)
from app.security import verify_api_token
from app.settings import get_settings
from app.services.market_data import (
	MarketDataClient,
	QuoteLookupError,
	normalize_symbol as normalize_market_symbol,
	normalize_symbol_for_market as normalize_market_symbol_for_market,
)

SessionDependency = Annotated[Session, Depends(get_session)]
TokenDependency = Annotated[None, Depends(verify_api_token)]
market_data_client = MarketDataClient()
settings = get_settings()
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class DashboardCacheEntry:
	dashboard: DashboardResponse
	generated_at: datetime


@dataclass(slots=True)
class LivePortfolioState:
	hour_bucket: datetime
	latest_value_cny: float
	latest_generated_at: datetime
	has_assets_in_bucket: bool


@dataclass(slots=True)
class LiveHoldingReturnPoint:
	symbol: str
	name: str
	return_pct: float


@dataclass(slots=True)
class LiveHoldingsReturnState:
	hour_bucket: datetime
	latest_generated_at: datetime
	aggregate_return_pct: float | None
	holding_points: tuple[LiveHoldingReturnPoint, ...]
	has_tracked_holdings_in_bucket: bool


dashboard_cache: DashboardCacheEntry | None = None
live_portfolio_state: LivePortfolioState | None = None
live_holdings_return_state: LiveHoldingsReturnState | None = None
dashboard_cache_lock = asyncio.Lock()
background_refresh_task: asyncio.Task[None] | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
	global background_refresh_task
	settings.validate_runtime()
	init_db()
	_ensure_legacy_schema()

	try:
		with Session(engine) as session:
			await _get_cached_dashboard(session, force_refresh=True)
	except Exception:
		logger.exception("Initial dashboard refresh failed during startup.")

	background_refresh_task = asyncio.create_task(_background_refresh_loop())

	try:
		yield
	finally:
		if background_refresh_task is not None:
			background_refresh_task.cancel()
			with suppress(asyncio.CancelledError):
				await background_refresh_task
			background_refresh_task = None


app = FastAPI(
	title="Personal Asset Tracker API",
	version="0.1.0",
	lifespan=lifespan,
)

app.add_middleware(
	TrustedHostMiddleware,
	allowed_hosts=settings.trusted_hosts() or ["localhost", "127.0.0.1"],
)

app.add_middleware(
	CORSMiddleware,
	allow_origins=settings.cors_origins(),
	allow_credentials=False,
	allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allow_headers=["Content-Type", "X-API-Key"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
	response: Response = await call_next(request)
	response.headers["Cache-Control"] = "no-store"
	response.headers["Pragma"] = "no-cache"
	response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
	response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
	response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=()"
	response.headers["Referrer-Policy"] = "same-origin"
	response.headers["X-Content-Type-Options"] = "nosniff"
	response.headers["X-Frame-Options"] = "DENY"
	if request.headers.get("x-forwarded-proto", request.url.scheme) == "https":
		response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
	return response


def _normalize_currency(code: str) -> str:
	return code.strip().upper()


def _normalize_symbol(symbol: str, market: str | None = None) -> str:
	try:
		if market:
			return normalize_market_symbol_for_market(symbol, market)
		return normalize_market_symbol(symbol)
	except ValueError as exc:
		raise HTTPException(status_code=422, detail=str(exc)) from exc


def _normalize_optional_text(value: str | None) -> str | None:
	if value is None:
		return None

	stripped = value.strip()
	return stripped or None


def _touch_model(model: CashAccount | SecurityHolding) -> None:
	model.updated_at = utc_now()


def _coerce_utc_datetime(value: datetime) -> datetime:
	"""Normalize persisted datetimes so legacy naive rows compare safely."""
	if value.tzinfo is None:
		return value.replace(tzinfo=timezone.utc)

	return value.astimezone(timezone.utc)


def _current_minute_bucket(value: datetime | None = None) -> datetime:
	timestamp = _coerce_utc_datetime(value or utc_now())
	return timestamp.replace(second=0, microsecond=0)


def _current_hour_bucket(value: datetime | None = None) -> datetime:
	timestamp = _coerce_utc_datetime(value or utc_now())
	return timestamp.replace(minute=0, second=0, microsecond=0)


def _is_current_minute(value: datetime | None, now: datetime | None = None) -> bool:
	if value is None:
		return False

	return _current_minute_bucket(value) == _current_minute_bucket(now)


def _is_same_hour(value: datetime | None, now: datetime | None = None) -> bool:
	if value is None:
		return False

	return _current_hour_bucket(value) == _current_hour_bucket(now)


def _invalidate_dashboard_cache() -> None:
	global dashboard_cache
	dashboard_cache = None


async def _sleep_until_next_minute() -> None:
	now = datetime.now(timezone.utc)
	delay_seconds = 60 - now.second - (now.microsecond / 1_000_000)
	await asyncio.sleep(max(delay_seconds, 0.05))


async def _background_refresh_loop() -> None:
	while True:
		await _sleep_until_next_minute()
		try:
			with Session(engine) as session:
				await _get_cached_dashboard(session, force_refresh=True)
		except Exception:
			logger.exception("Scheduled dashboard refresh failed.")


def _load_table_columns(session: Session, table_name: str) -> set[str]:
	rows = session.exec(text(f"PRAGMA table_info({table_name})")).all()
	return {row[1] for row in rows}


def _ensure_legacy_schema() -> None:
	"""Add newly introduced columns when the local SQLite file predates them."""
	schema_changes = (
		(
			CashAccount.__table__.name,
			{
				"account_type": "TEXT NOT NULL DEFAULT 'OTHER'",
				"note": "TEXT",
			},
		),
		(
			SecurityHolding.__table__.name,
			{
				"cost_basis_price": "REAL",
				"market": "TEXT NOT NULL DEFAULT 'OTHER'",
				"broker": "TEXT",
				"note": "TEXT",
			},
		),
	)

	with Session(engine) as session:
		has_changes = False
		for table_name, column_defs in schema_changes:
			existing_columns = _load_table_columns(session, table_name)
			if not existing_columns:
				continue

			for column_name, definition in column_defs.items():
				if column_name in existing_columns:
					continue

				session.exec(
					text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
				)
				has_changes = True

		if has_changes:
			session.commit()


async def _value_cash_accounts(
	accounts: list[CashAccount],
) -> tuple[list[ValuedCashAccount], float, list[str]]:
	items: list[ValuedCashAccount] = []
	total = 0.0
	warnings: list[str] = []

	for account in accounts:
		try:
			fx_rate, fx_warnings = await market_data_client.fetch_fx_rate(account.currency, "CNY")
			value_cny = round(account.balance * fx_rate, 2)
			warnings.extend(fx_warnings)
		except (QuoteLookupError, ValueError) as exc:
			fx_rate = 0.0
			value_cny = 0.0
			warnings.append(f"现金账户 {account.name} 换汇失败: {exc}")

		items.append(
			ValuedCashAccount(
				id=account.id or 0,
				name=account.name,
				platform=account.platform,
				balance=round(account.balance, 2),
				currency=account.currency,
				account_type=account.account_type,
				note=account.note,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings


async def _value_holdings(
	holdings: list[SecurityHolding],
) -> tuple[list[ValuedHolding], float, list[str]]:
	items: list[ValuedHolding] = []
	total = 0.0
	warnings: list[str] = []

	for holding in holdings:
		try:
			quote, quote_warnings = await market_data_client.fetch_quote(holding.symbol)
			fx_rate, fx_warnings = await market_data_client.fetch_fx_rate(quote.currency, "CNY")
			value_cny = round(holding.quantity * quote.price * fx_rate, 2)
			price = round(quote.price, 4)
			price_currency = quote.currency
			last_updated = quote.market_time
			warnings.extend(quote_warnings)
			warnings.extend(fx_warnings)
		except (QuoteLookupError, ValueError) as exc:
			value_cny = 0.0
			price = 0.0
			price_currency = holding.fallback_currency
			fx_rate = 0.0
			last_updated = None
			warnings.append(f"持仓 {holding.symbol} 行情拉取失败: {exc}")

		items.append(
			ValuedHolding(
				id=holding.id or 0,
				symbol=holding.symbol,
				name=holding.name,
				quantity=round(holding.quantity, 4),
				fallback_currency=holding.fallback_currency,
				cost_basis_price=round(holding.cost_basis_price, 4)
				if holding.cost_basis_price is not None
				else None,
				market=holding.market,
				broker=holding.broker,
				note=holding.note,
				price=price,
				price_currency=price_currency,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
				return_pct=round(((price - holding.cost_basis_price) / holding.cost_basis_price) * 100, 2)
				if holding.cost_basis_price and price > 0
				else None,
				last_updated=last_updated,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings


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


def _persist_holdings_return_snapshot(
	session: Session,
	hour_bucket: datetime,
	aggregate_return_pct: float | None,
	holding_points: tuple[LiveHoldingReturnPoint, ...],
) -> None:
	hour_start = _current_hour_bucket(hour_bucket)
	hour_end = hour_start + timedelta(hours=1)
	existing_snapshots = list(
		session.exec(
			select(HoldingPerformanceSnapshot)
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
	hour_bucket: datetime,
	total_value_cny: float,
) -> None:
	hour_start = _current_hour_bucket(hour_bucket)
	hour_end = hour_start + timedelta(hours=1)
	existing_snapshots = list(
		session.exec(
			select(PortfolioSnapshot)
			.where(PortfolioSnapshot.created_at >= hour_start)
			.where(PortfolioSnapshot.created_at < hour_end)
			.order_by(PortfolioSnapshot.created_at.desc()),
		),
	)
	primary_snapshot = existing_snapshots[0] if existing_snapshots else None

	if primary_snapshot is None:
		session.add(
			PortfolioSnapshot(
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


def _roll_live_portfolio_state_if_needed(session: Session, now: datetime) -> None:
	global live_portfolio_state

	if live_portfolio_state is None:
		return

	current_hour = _current_hour_bucket(now)
	if live_portfolio_state.hour_bucket >= current_hour:
		return

	if live_portfolio_state.has_assets_in_bucket or live_portfolio_state.latest_value_cny > 0:
		_persist_hour_snapshot(
			session,
			live_portfolio_state.hour_bucket,
			live_portfolio_state.latest_value_cny,
		)

	live_portfolio_state = None


def _roll_live_holdings_return_state_if_needed(session: Session, now: datetime) -> None:
	global live_holdings_return_state

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
			live_holdings_return_state.hour_bucket,
			live_holdings_return_state.aggregate_return_pct,
			live_holdings_return_state.holding_points,
		)

	live_holdings_return_state = None


def _update_live_portfolio_state(
	now: datetime,
	total_value_cny: float,
	has_assets: bool,
) -> None:
	global live_portfolio_state

	current_hour = _current_hour_bucket(now)
	if live_portfolio_state is None:
		if not has_assets:
			return

		live_portfolio_state = LivePortfolioState(
			hour_bucket=current_hour,
			latest_value_cny=total_value_cny,
			latest_generated_at=now,
			has_assets_in_bucket=has_assets,
		)
		return

	if live_portfolio_state.hour_bucket != current_hour:
		if not has_assets:
			live_portfolio_state = None
			return

		live_portfolio_state = LivePortfolioState(
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


def _update_live_holdings_return_state(
	now: datetime,
	aggregate_return_pct: float | None,
	holding_points: tuple[LiveHoldingReturnPoint, ...],
) -> None:
	global live_holdings_return_state

	current_hour = _current_hour_bucket(now)
	has_tracked_holdings = bool(holding_points)
	has_return_data = has_tracked_holdings or aggregate_return_pct is not None

	if live_holdings_return_state is None:
		if not has_return_data:
			return

		live_holdings_return_state = LiveHoldingsReturnState(
			hour_bucket=current_hour,
			latest_generated_at=now,
			aggregate_return_pct=aggregate_return_pct,
			holding_points=holding_points,
			has_tracked_holdings_in_bucket=has_tracked_holdings,
		)
		return

	if live_holdings_return_state.hour_bucket != current_hour:
		if not has_return_data:
			live_holdings_return_state = None
			return

		live_holdings_return_state = LiveHoldingsReturnState(
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


def _load_series(session: Session, since: datetime) -> list[PortfolioSnapshot]:
	return list(
		session.exec(
			select(PortfolioSnapshot)
			.where(PortfolioSnapshot.created_at >= since)
			.order_by(PortfolioSnapshot.created_at.asc()),
		),
	)


def _load_series_with_live_snapshot(session: Session, since: datetime) -> list[PortfolioSnapshot]:
	snapshots = _load_series(session, since)
	if (
		live_portfolio_state is not None
		and live_portfolio_state.latest_generated_at >= _coerce_utc_datetime(since)
	):
		snapshots.append(
			PortfolioSnapshot(
				total_value_cny=live_portfolio_state.latest_value_cny,
				created_at=live_portfolio_state.latest_generated_at,
			),
		)

	return snapshots


def _load_holdings_return_series(
	session: Session,
	since: datetime,
	scope: str,
	symbol: str | None = None,
) -> list[HoldingPerformanceSnapshot]:
	statement = (
		select(HoldingPerformanceSnapshot)
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
	since: datetime,
	scope: str,
	symbol: str | None = None,
	default_name: str | None = None,
) -> list[HoldingPerformanceSnapshot]:
	snapshots = _load_holdings_return_series(session, since, scope, symbol)
	if live_holdings_return_state is None:
		return snapshots

	if live_holdings_return_state.latest_generated_at < _coerce_utc_datetime(since):
		return snapshots

	if scope == "TOTAL":
		if live_holdings_return_state.aggregate_return_pct is None:
			return snapshots
		snapshots.append(
			HoldingPerformanceSnapshot(
				scope="TOTAL",
				symbol=None,
				name=default_name or "非现金资产",
				return_pct=live_holdings_return_state.aggregate_return_pct,
				created_at=live_holdings_return_state.latest_generated_at,
			),
		)
		return snapshots

	for point in live_holdings_return_state.holding_points:
		if point.symbol != symbol:
			continue
		snapshots.append(
			HoldingPerformanceSnapshot(
				scope="HOLDING",
				symbol=point.symbol,
				name=point.name,
				return_pct=point.return_pct,
				created_at=live_holdings_return_state.latest_generated_at,
			),
		)
		break

	return snapshots


async def _build_dashboard(session: Session) -> DashboardResponse:
	now = utc_now()
	_roll_live_portfolio_state_if_needed(session, now)
	_roll_live_holdings_return_state_if_needed(session, now)

	accounts = list(session.exec(select(CashAccount).order_by(CashAccount.platform, CashAccount.name)))
	holdings = list(
		session.exec(select(SecurityHolding).order_by(SecurityHolding.symbol, SecurityHolding.name)),
	)

	valued_accounts, cash_value_cny, account_warnings = await _value_cash_accounts(accounts)
	valued_holdings, holdings_value_cny, holding_warnings = await _value_holdings(holdings)
	total_value_cny = round(cash_value_cny + holdings_value_cny, 2)
	has_assets = bool(accounts or holdings)
	aggregate_holdings_return_pct, holding_return_points = _summarize_holdings_return_state(
		valued_holdings,
	)
	_update_live_portfolio_state(now, total_value_cny, has_assets)
	_update_live_holdings_return_state(now, aggregate_holdings_return_pct, holding_return_points)

	hour_series = build_timeline(
		_load_series_with_live_snapshot(session, now - timedelta(hours=24)),
		"hour",
	)
	day_series = build_timeline(
		_load_series_with_live_snapshot(session, now - timedelta(days=30)),
		"day",
	)
	month_series = build_timeline(
		_load_series_with_live_snapshot(session, now - timedelta(days=366)),
		"month",
	)
	year_series = build_timeline(
		_load_series_with_live_snapshot(session, now - timedelta(days=366 * 5)),
		"year",
	)
	holdings_return_hour_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			now - timedelta(hours=24),
			"TOTAL",
			default_name="非现金资产",
		),
		"hour",
	)
	holdings_return_day_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			now - timedelta(days=30),
			"TOTAL",
			default_name="非现金资产",
		),
		"day",
	)
	holdings_return_month_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			now - timedelta(days=366),
			"TOTAL",
			default_name="非现金资产",
		),
		"month",
	)
	holdings_return_year_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			now - timedelta(days=366 * 5),
			"TOTAL",
			default_name="非现金资产",
		),
		"year",
	)
	holding_return_series = []
	for holding in valued_holdings:
		if holding.cost_basis_price is None:
			continue

		holding_return_series.append(
			HoldingReturnSeries(
				symbol=holding.symbol,
				name=holding.name,
				hour_series=build_return_timeline(
					_load_holdings_return_series_with_live_snapshot(
						session,
						now - timedelta(hours=24),
						"HOLDING",
						symbol=holding.symbol,
						default_name=holding.name,
					),
					"hour",
				),
				day_series=build_return_timeline(
					_load_holdings_return_series_with_live_snapshot(
						session,
						now - timedelta(days=30),
						"HOLDING",
						symbol=holding.symbol,
						default_name=holding.name,
					),
					"day",
				),
				month_series=build_return_timeline(
					_load_holdings_return_series_with_live_snapshot(
						session,
						now - timedelta(days=366),
						"HOLDING",
						symbol=holding.symbol,
						default_name=holding.name,
					),
					"month",
				),
				year_series=build_return_timeline(
					_load_holdings_return_series_with_live_snapshot(
						session,
						now - timedelta(days=366 * 5),
						"HOLDING",
						symbol=holding.symbol,
						default_name=holding.name,
					),
					"year",
				),
			),
		)

	return DashboardResponse(
		total_value_cny=total_value_cny,
		cash_value_cny=cash_value_cny,
		holdings_value_cny=holdings_value_cny,
		cash_accounts=valued_accounts,
		holdings=valued_holdings,
		allocation=[
			AllocationSlice(label="现金", value=cash_value_cny),
			AllocationSlice(label="证券", value=holdings_value_cny),
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
		warnings=[*account_warnings, *holding_warnings],
	)


async def _get_cached_dashboard(
	session: Session,
	force_refresh: bool = False,
) -> DashboardResponse:
	global dashboard_cache

	if (
		not force_refresh
		and dashboard_cache is not None
		and _is_current_minute(dashboard_cache.generated_at)
	):
		return dashboard_cache.dashboard

	async with dashboard_cache_lock:
		if (
			not force_refresh
			and dashboard_cache is not None
			and _is_current_minute(dashboard_cache.generated_at)
		):
			return dashboard_cache.dashboard

		dashboard = await _build_dashboard(session)
		dashboard_cache = DashboardCacheEntry(
			dashboard=dashboard,
			generated_at=utc_now(),
		)
		return dashboard


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
	return {"status": "ok"}


@app.get("/api/accounts", response_model=list[CashAccountRead])
async def list_accounts(_: TokenDependency, session: SessionDependency) -> list[CashAccountRead]:
	dashboard = await _get_cached_dashboard(session)
	accounts = list(session.exec(select(CashAccount).order_by(CashAccount.platform, CashAccount.name)))
	valued_account_map = {account.id: account for account in dashboard.cash_accounts}
	items: list[CashAccountRead] = []

	for account in accounts:
		valued_account = valued_account_map.get(account.id or 0)
		items.append(
			CashAccountRead(
				id=account.id or 0,
				name=account.name,
				platform=account.platform,
				currency=account.currency,
				balance=account.balance,
				account_type=account.account_type,
				note=account.note,
				fx_to_cny=valued_account.fx_to_cny if valued_account else None,
				value_cny=valued_account.value_cny if valued_account else None,
			),
		)

	return items


@app.post("/api/accounts", response_model=CashAccountRead, status_code=201)
def create_account(
	payload: CashAccountCreate,
	_: TokenDependency,
	session: SessionDependency,
) -> CashAccount:
	account = CashAccount(
		name=payload.name.strip(),
		platform=payload.platform.strip(),
		currency=_normalize_currency(payload.currency),
		balance=payload.balance,
		account_type=payload.account_type,
		note=payload.note,
	)
	session.add(account)
	session.commit()
	session.refresh(account)
	_invalidate_dashboard_cache()
	return account


@app.put("/api/accounts/{account_id}", response_model=CashAccountRead)
def update_account(
	account_id: int,
	payload: CashAccountUpdate,
	_: TokenDependency,
	session: SessionDependency,
) -> CashAccount:
	account = session.get(CashAccount, account_id)
	if account is None:
		raise HTTPException(status_code=404, detail="Account not found.")

	account.name = payload.name.strip()
	account.platform = payload.platform.strip()
	account.currency = _normalize_currency(payload.currency)
	account.balance = payload.balance
	if payload.account_type is not None:
		account.account_type = payload.account_type
	if "note" in payload.model_fields_set:
		account.note = _normalize_optional_text(payload.note)
	_touch_model(account)
	session.add(account)
	session.commit()
	session.refresh(account)
	_invalidate_dashboard_cache()
	return account


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(
	account_id: int,
	_: TokenDependency,
	session: SessionDependency,
) -> Response:
	account = session.get(CashAccount, account_id)
	if account is None:
		raise HTTPException(status_code=404, detail="Account not found.")

	session.delete(account)
	session.commit()
	_invalidate_dashboard_cache()
	return Response(status_code=204)


@app.get("/api/holdings", response_model=list[SecurityHoldingRead])
async def list_holdings(
	_: TokenDependency,
	session: SessionDependency,
) -> list[SecurityHoldingRead]:
	dashboard = await _get_cached_dashboard(session)
	holdings = list(
		session.exec(select(SecurityHolding).order_by(SecurityHolding.symbol, SecurityHolding.name)),
	)
	valued_holding_map = {holding.id: holding for holding in dashboard.holdings}
	items: list[SecurityHoldingRead] = []

	for holding in holdings:
		valued_holding = valued_holding_map.get(holding.id or 0)
		items.append(
			SecurityHoldingRead(
				id=holding.id or 0,
				symbol=holding.symbol,
				name=holding.name,
				quantity=holding.quantity,
				fallback_currency=holding.fallback_currency,
				cost_basis_price=holding.cost_basis_price,
				market=holding.market,
				broker=holding.broker,
				note=holding.note,
				price=valued_holding.price if valued_holding else None,
				price_currency=valued_holding.price_currency if valued_holding else None,
				value_cny=valued_holding.value_cny if valued_holding else None,
				return_pct=valued_holding.return_pct if valued_holding else None,
				last_updated=valued_holding.last_updated if valued_holding else None,
			),
		)

	return items


@app.post("/api/holdings", response_model=SecurityHoldingRead, status_code=201)
def create_holding(
	payload: SecurityHoldingCreate,
	_: TokenDependency,
	session: SessionDependency,
) -> SecurityHolding:
	holding = SecurityHolding(
		symbol=_normalize_symbol(payload.symbol, payload.market),
		name=payload.name.strip(),
		quantity=payload.quantity,
		fallback_currency=_normalize_currency(payload.fallback_currency),
		cost_basis_price=payload.cost_basis_price,
		market=payload.market,
		broker=payload.broker,
		note=payload.note,
	)
	session.add(holding)
	session.commit()
	session.refresh(holding)
	_invalidate_dashboard_cache()
	return holding


@app.put("/api/holdings/{holding_id}", response_model=SecurityHoldingRead)
def update_holding(
	holding_id: int,
	payload: SecurityHoldingUpdate,
	_: TokenDependency,
	session: SessionDependency,
) -> SecurityHolding:
	holding = session.get(SecurityHolding, holding_id)
	if holding is None:
		raise HTTPException(status_code=404, detail="Holding not found.")

	holding.symbol = _normalize_symbol(payload.symbol, payload.market or holding.market)
	holding.name = payload.name.strip()
	holding.quantity = payload.quantity
	holding.fallback_currency = _normalize_currency(payload.fallback_currency)
	if "cost_basis_price" in payload.model_fields_set:
		holding.cost_basis_price = payload.cost_basis_price
	if payload.market is not None:
		holding.market = payload.market
	if "broker" in payload.model_fields_set:
		holding.broker = _normalize_optional_text(payload.broker)
	if "note" in payload.model_fields_set:
		holding.note = _normalize_optional_text(payload.note)
	_touch_model(holding)
	session.add(holding)
	session.commit()
	session.refresh(holding)
	_invalidate_dashboard_cache()
	return holding


@app.delete("/api/holdings/{holding_id}", status_code=204)
def delete_holding(
	holding_id: int,
	_: TokenDependency,
	session: SessionDependency,
) -> Response:
	holding = session.get(SecurityHolding, holding_id)
	if holding is None:
		raise HTTPException(status_code=404, detail="Holding not found.")

	session.delete(holding)
	session.commit()
	_invalidate_dashboard_cache()
	return Response(status_code=204)


@app.get("/api/securities/search", response_model=list[SecuritySearchRead])
async def search_securities(
	q: str,
	_: TokenDependency,
) -> list[SecuritySearchRead]:
	query = q.strip()
	if not query:
		return []

	return await market_data_client.search_securities(query)


@app.get("/api/dashboard", response_model=DashboardResponse)
async def get_dashboard(_: TokenDependency, session: SessionDependency) -> DashboardResponse:
	return await _get_cached_dashboard(session)
