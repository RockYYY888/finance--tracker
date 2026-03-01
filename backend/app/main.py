from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
from typing import Annotated
from zoneinfo import ZoneInfo

from sqlalchemy import text
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlmodel import Session, select
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.analytics import build_return_timeline, build_timeline
from app.database import engine, get_session, init_db
from app.models import (
	CashAccount,
	FixedAsset,
	HoldingPerformanceSnapshot,
	LiabilityEntry,
	OtherAsset,
	PortfolioSnapshot,
	SecurityHolding,
	UserFeedback,
	UserAccount,
	utc_now,
)
from app.schemas import (
	AllocationSlice,
	AuthCredentials,
	AuthSessionRead,
	CashAccountCreate,
	CashAccountRead,
	CashAccountUpdate,
	DashboardResponse,
	FixedAssetCreate,
	FixedAssetRead,
	FixedAssetUpdate,
	HoldingReturnSeries,
	LiabilityEntryCreate,
	LiabilityEntryRead,
	LiabilityEntryUpdate,
	OtherAssetCreate,
	OtherAssetRead,
	OtherAssetUpdate,
	SecuritySearchRead,
	SecurityHoldingCreate,
	SecurityHoldingRead,
	SecurityHoldingUpdate,
	UserFeedbackCreate,
	UserFeedbackRead,
	ValuedCashAccount,
	ValuedFixedAsset,
	ValuedHolding,
	ValuedLiabilityEntry,
	ValuedOtherAsset,
)
from app.security import (
	get_session_user_id,
	hash_password,
	normalize_user_id,
	require_session_user_id,
	verify_api_token,
	verify_password,
)
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
FEEDBACK_TIMEZONE = ZoneInfo("Asia/Shanghai")
MAX_DAILY_FEEDBACK_SUBMISSIONS = 3


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


dashboard_cache: dict[str, DashboardCacheEntry] = {}
live_portfolio_states: dict[str, LivePortfolioState] = {}
live_holdings_return_states: dict[str, LiveHoldingsReturnState] = {}
dashboard_cache_lock = asyncio.Lock()
background_refresh_task: asyncio.Task[None] | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
	global background_refresh_task
	settings.validate_runtime()
	init_db()
	_ensure_legacy_schema()
	_audit_legacy_user_ownership()

	try:
		with Session(engine) as session:
			await _refresh_user_dashboards(
				session,
				session.exec(select(UserAccount)).all(),
				clear_market_data=True,
			)
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
	allow_credentials=True,
	allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allow_headers=["Content-Type", "X-API-Key"],
)

app.add_middleware(
	SessionMiddleware,
	secret_key=settings.session_secret_value() or "asset-tracker-session-fallback",
	session_cookie="asset_tracker_session",
	max_age=60 * 60 * 24 * 30,
	same_site="lax",
	https_only=settings.is_production,
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


def _touch_model(
	model: CashAccount
	| SecurityHolding
	| FixedAsset
	| LiabilityEntry
	| OtherAsset
	| UserAccount,
) -> None:
	model.updated_at = utc_now()


def _calculate_return_pct(
	current_value: float,
	basis_value: float | None,
) -> float | None:
	if basis_value is None or basis_value <= 0:
		return None

	return round(((current_value - basis_value) / basis_value) * 100, 2)


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


def _feedback_day_window(value: datetime | None = None) -> tuple[datetime, datetime]:
	timestamp = _coerce_utc_datetime(value or utc_now()).astimezone(FEEDBACK_TIMEZONE)
	day_start_local = timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
	day_end_local = day_start_local + timedelta(days=1)
	return day_start_local.astimezone(timezone.utc), day_end_local.astimezone(timezone.utc)


def _is_current_minute(value: datetime | None, now: datetime | None = None) -> bool:
	if value is None:
		return False

	return _current_minute_bucket(value) == _current_minute_bucket(now)


def _is_same_hour(value: datetime | None, now: datetime | None = None) -> bool:
	if value is None:
		return False

	return _current_hour_bucket(value) == _current_hour_bucket(now)


def _invalidate_dashboard_cache(user_id: str | None = None) -> None:
	global dashboard_cache
	if user_id is None:
		dashboard_cache = {}
		return

	dashboard_cache.pop(user_id, None)


def _get_user(session: Session, user_id: str) -> UserAccount | None:
	return session.get(UserAccount, normalize_user_id(user_id))


def _audit_legacy_user_ownership() -> None:
	with Session(engine) as session:
		for table_name in (
			CashAccount.__table__.name,
			SecurityHolding.__table__.name,
			FixedAsset.__table__.name,
			LiabilityEntry.__table__.name,
			OtherAsset.__table__.name,
			PortfolioSnapshot.__table__.name,
			HoldingPerformanceSnapshot.__table__.name,
		):
			legacy_row_count = int(
				session.exec(
					text(
						f"SELECT COUNT(*) FROM {table_name} "
						"WHERE user_id IS NULL OR TRIM(user_id) = ''",
					),
				).one()[0],
			)
			if legacy_row_count > 0:
				logger.warning(
					"%s contains %s rows without a user_id. "
					"Those rows remain inaccessible until they are reassigned explicitly.",
					table_name,
					legacy_row_count,
				)


def get_current_user(request: Request, session: SessionDependency, _: TokenDependency) -> UserAccount:
	user_id = require_session_user_id(request)
	user = _get_user(session, user_id)
	if user is None:
		request.session.clear()
		raise HTTPException(status_code=401, detail="请重新登录。")
	return user


CurrentUserDependency = Annotated[UserAccount, Depends(get_current_user)]


async def _sleep_until_next_minute() -> None:
	now = datetime.now(timezone.utc)
	delay_seconds = 60 - now.second - (now.microsecond / 1_000_000)
	await asyncio.sleep(max(delay_seconds, 0.05))


async def _background_refresh_loop() -> None:
	while True:
		await _sleep_until_next_minute()
		try:
			with Session(engine) as session:
				await _refresh_user_dashboards(
					session,
					session.exec(select(UserAccount)).all(),
					clear_market_data=True,
				)
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
				"user_id": "TEXT",
				"account_type": "TEXT NOT NULL DEFAULT 'OTHER'",
				"started_on": "TEXT",
				"note": "TEXT",
			},
		),
		(
			SecurityHolding.__table__.name,
			{
				"user_id": "TEXT",
				"cost_basis_price": "REAL",
				"market": "TEXT NOT NULL DEFAULT 'OTHER'",
				"broker": "TEXT",
				"started_on": "TEXT",
				"note": "TEXT",
			},
		),
		(
			FixedAsset.__table__.name,
			{
				"user_id": "TEXT",
				"started_on": "TEXT",
			},
		),
		(
			LiabilityEntry.__table__.name,
			{
				"user_id": "TEXT",
				"started_on": "TEXT",
			},
		),
		(
			OtherAsset.__table__.name,
			{
				"user_id": "TEXT",
				"started_on": "TEXT",
			},
		),
		(
			PortfolioSnapshot.__table__.name,
			{
				"user_id": "TEXT",
			},
		),
		(
			HoldingPerformanceSnapshot.__table__.name,
			{
				"user_id": "TEXT",
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


async def _load_display_fx_rates() -> tuple[dict[str, float], float | None, float | None, list[str]]:
	"""Load top-level display FX rates and reuse them in dashboard valuation."""
	rates: dict[str, float] = {"CNY": 1.0}
	warnings: list[str] = []
	usd_cny_rate: float | None = None
	hkd_cny_rate: float | None = None

	for currency_code in ("USD", "HKD"):
		try:
			rate, rate_warnings = await market_data_client.fetch_fx_rate(currency_code, "CNY")
		except (QuoteLookupError, ValueError) as exc:
			warnings.append(f"{currency_code}/CNY 汇率拉取失败: {exc}")
			continue

		rates[currency_code] = rate
		warnings.extend(rate_warnings)
		if currency_code == "USD":
			usd_cny_rate = round(rate, 6)
		else:
			hkd_cny_rate = round(rate, 6)

	return rates, usd_cny_rate, hkd_cny_rate, warnings


async def _refresh_user_dashboards(
	session: Session,
	users: list[UserAccount],
	*,
	clear_market_data: bool = False,
) -> None:
	if clear_market_data:
		market_data_client.clear_runtime_caches()

	for user in users:
		await _get_cached_dashboard(session, user, force_refresh=True)


async def _value_cash_accounts(
	accounts: list[CashAccount],
	fx_rate_overrides: dict[str, float] | None = None,
) -> tuple[list[ValuedCashAccount], float, list[str]]:
	items: list[ValuedCashAccount] = []
	total = 0.0
	warnings: list[str] = []

	for account in accounts:
		currency_code = _normalize_currency(account.currency)
		try:
			override_rate = fx_rate_overrides.get(currency_code) if fx_rate_overrides else None
			if override_rate is not None:
				fx_rate = override_rate
				fx_warnings: list[str] = []
			else:
				fx_rate, fx_warnings = await market_data_client.fetch_fx_rate(currency_code, "CNY")
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
				started_on=account.started_on,
				note=account.note,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings


async def _value_holdings(
	holdings: list[SecurityHolding],
	fx_rate_overrides: dict[str, float] | None = None,
) -> tuple[list[ValuedHolding], float, list[str]]:
	items: list[ValuedHolding] = []
	total = 0.0
	warnings: list[str] = []

	for holding in holdings:
		try:
			quote, quote_warnings = await market_data_client.fetch_quote(
				holding.symbol,
				holding.market,
			)
			currency_code = _normalize_currency(quote.currency)
			override_rate = fx_rate_overrides.get(currency_code) if fx_rate_overrides else None
			if override_rate is not None:
				fx_rate = override_rate
				fx_warnings: list[str] = []
			else:
				fx_rate, fx_warnings = await market_data_client.fetch_fx_rate(currency_code, "CNY")
			value_cny = round(holding.quantity * quote.price * fx_rate, 2)
			price = round(quote.price, 4)
			price_currency = currency_code
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
				started_on=holding.started_on,
				note=holding.note,
				price=price,
				price_currency=price_currency,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
				return_pct=_calculate_return_pct(price, holding.cost_basis_price)
				if price > 0
				else None,
				last_updated=last_updated,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings


def _value_fixed_assets(
	assets: list[FixedAsset],
) -> tuple[list[ValuedFixedAsset], float]:
	items: list[ValuedFixedAsset] = []
	total = 0.0

	for asset in assets:
		value_cny = round(asset.current_value_cny, 2)
		items.append(
			ValuedFixedAsset(
				id=asset.id or 0,
				name=asset.name,
				category=asset.category,
				current_value_cny=value_cny,
				purchase_value_cny=round(asset.purchase_value_cny, 2)
				if asset.purchase_value_cny is not None
				else None,
				started_on=asset.started_on,
				note=asset.note,
				value_cny=value_cny,
				return_pct=_calculate_return_pct(value_cny, asset.purchase_value_cny),
			),
		)
		total += value_cny

	return items, round(total, 2)


async def _value_liabilities(
	entries: list[LiabilityEntry],
	fx_rate_overrides: dict[str, float] | None = None,
) -> tuple[list[ValuedLiabilityEntry], float, list[str]]:
	items: list[ValuedLiabilityEntry] = []
	total = 0.0
	warnings: list[str] = []

	for entry in entries:
		currency_code = _normalize_currency(entry.currency)
		try:
			override_rate = fx_rate_overrides.get(currency_code) if fx_rate_overrides else None
			if override_rate is not None:
				fx_rate = override_rate
				fx_warnings: list[str] = []
			else:
				fx_rate, fx_warnings = await market_data_client.fetch_fx_rate(currency_code, "CNY")
			value_cny = round(entry.balance * fx_rate, 2)
			warnings.extend(fx_warnings)
		except (QuoteLookupError, ValueError) as exc:
			fx_rate = 0.0
			value_cny = 0.0
			warnings.append(f"负债 {entry.name} 换汇失败: {exc}")

		items.append(
			ValuedLiabilityEntry(
				id=entry.id or 0,
				name=entry.name,
				category=entry.category,
				currency=entry.currency,
				balance=round(entry.balance, 2),
				started_on=entry.started_on,
				note=entry.note,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings


def _value_other_assets(
	assets: list[OtherAsset],
) -> tuple[list[ValuedOtherAsset], float]:
	items: list[ValuedOtherAsset] = []
	total = 0.0

	for asset in assets:
		value_cny = round(asset.current_value_cny, 2)
		items.append(
			ValuedOtherAsset(
				id=asset.id or 0,
				name=asset.name,
				category=asset.category,
				current_value_cny=value_cny,
				original_value_cny=round(asset.original_value_cny, 2)
				if asset.original_value_cny is not None
				else None,
				started_on=asset.started_on,
				note=asset.note,
				value_cny=value_cny,
				return_pct=_calculate_return_pct(value_cny, asset.original_value_cny),
			),
		)
		total += value_cny

	return items, round(total, 2)


def _to_cash_account_read(account: CashAccount) -> CashAccountRead:
	valued_accounts, _, _warnings = asyncio.run(_value_cash_accounts([account]))
	valued_account = valued_accounts[0] if valued_accounts else None
	return CashAccountRead(
		id=account.id or 0,
		name=account.name,
		platform=account.platform,
		currency=account.currency,
		balance=account.balance,
		account_type=account.account_type,
		started_on=account.started_on,
		note=account.note,
		fx_to_cny=valued_account.fx_to_cny if valued_account else None,
		value_cny=valued_account.value_cny if valued_account else None,
	)


def _to_holding_read(holding: SecurityHolding) -> SecurityHoldingRead:
	valued_holdings, _, _warnings = asyncio.run(_value_holdings([holding]))
	valued_holding = valued_holdings[0] if valued_holdings else None
	return SecurityHoldingRead(
		id=holding.id or 0,
		symbol=holding.symbol,
		name=holding.name,
		quantity=holding.quantity,
		fallback_currency=holding.fallback_currency,
		cost_basis_price=holding.cost_basis_price,
		market=holding.market,
		broker=holding.broker,
		started_on=holding.started_on,
		note=holding.note,
		price=valued_holding.price if valued_holding else None,
		price_currency=valued_holding.price_currency if valued_holding else None,
		value_cny=valued_holding.value_cny if valued_holding else None,
		return_pct=valued_holding.return_pct if valued_holding else None,
		last_updated=valued_holding.last_updated if valued_holding else None,
	)


def _to_liability_read(entry: LiabilityEntry) -> LiabilityEntryRead:
	valued_entries, _, _warnings = asyncio.run(_value_liabilities([entry]))
	valued_entry = valued_entries[0] if valued_entries else None
	return LiabilityEntryRead(
		id=entry.id or 0,
		name=entry.name,
		category=entry.category,
		currency=entry.currency,
		balance=round(entry.balance, 2),
		started_on=entry.started_on,
		note=entry.note,
		fx_to_cny=valued_entry.fx_to_cny if valued_entry else None,
		value_cny=valued_entry.value_cny if valued_entry else None,
	)


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
	live_portfolio_state = live_portfolio_states.get(user_id)
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

	live_portfolio_states.pop(user_id, None)


def _roll_live_holdings_return_state_if_needed(
	session: Session,
	user_id: str,
	now: datetime,
) -> None:
	live_holdings_return_state = live_holdings_return_states.get(user_id)
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

	live_holdings_return_states.pop(user_id, None)


def _update_live_portfolio_state(
	user_id: str,
	now: datetime,
	total_value_cny: float,
	has_assets: bool,
) -> None:
	live_portfolio_state = live_portfolio_states.get(user_id)
	current_hour = _current_hour_bucket(now)
	if live_portfolio_state is None:
		if not has_assets:
			return

		live_portfolio_states[user_id] = LivePortfolioState(
			hour_bucket=current_hour,
			latest_value_cny=total_value_cny,
			latest_generated_at=now,
			has_assets_in_bucket=has_assets,
		)
		return

	if live_portfolio_state.hour_bucket != current_hour:
		if not has_assets:
			live_portfolio_states.pop(user_id, None)
			return

		live_portfolio_states[user_id] = LivePortfolioState(
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
	live_portfolio_states[user_id] = live_portfolio_state


def _update_live_holdings_return_state(
	user_id: str,
	now: datetime,
	aggregate_return_pct: float | None,
	holding_points: tuple[LiveHoldingReturnPoint, ...],
) -> None:
	live_holdings_return_state = live_holdings_return_states.get(user_id)
	current_hour = _current_hour_bucket(now)
	has_tracked_holdings = bool(holding_points)
	has_return_data = has_tracked_holdings or aggregate_return_pct is not None

	if live_holdings_return_state is None:
		if not has_return_data:
			return

		live_holdings_return_states[user_id] = LiveHoldingsReturnState(
			hour_bucket=current_hour,
			latest_generated_at=now,
			aggregate_return_pct=aggregate_return_pct,
			holding_points=holding_points,
			has_tracked_holdings_in_bucket=has_tracked_holdings,
		)
		return

	if live_holdings_return_state.hour_bucket != current_hour:
		if not has_return_data:
			live_holdings_return_states.pop(user_id, None)
			return

		live_holdings_return_states[user_id] = LiveHoldingsReturnState(
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
	live_holdings_return_states[user_id] = live_holdings_return_state


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
) -> list[PortfolioSnapshot]:
	snapshots = _load_series(session, user_id, since)
	live_portfolio_state = live_portfolio_states.get(user_id)
	if (
		live_portfolio_state is not None
		and live_portfolio_state.latest_generated_at >= _coerce_utc_datetime(since)
	):
		snapshots.append(
			PortfolioSnapshot(
				user_id=user_id,
				total_value_cny=live_portfolio_state.latest_value_cny,
				created_at=live_portfolio_state.latest_generated_at,
			),
		)

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
) -> list[HoldingPerformanceSnapshot]:
	snapshots = _load_holdings_return_series(session, user_id, since, scope, symbol)
	live_holdings_return_state = live_holdings_return_states.get(user_id)
	if live_holdings_return_state is None:
		return snapshots

	if live_holdings_return_state.latest_generated_at < _coerce_utc_datetime(since):
		return snapshots

	if scope == "TOTAL":
		if live_holdings_return_state.aggregate_return_pct is None:
			return snapshots
		snapshots.append(
			HoldingPerformanceSnapshot(
				user_id=user_id,
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
				user_id=user_id,
				scope="HOLDING",
				symbol=point.symbol,
				name=point.name,
				return_pct=point.return_pct,
				created_at=live_holdings_return_state.latest_generated_at,
			),
		)
		break

	return snapshots


async def _build_dashboard(session: Session, user: UserAccount) -> DashboardResponse:
	user_id = user.username
	now = utc_now()
	_roll_live_portfolio_state_if_needed(session, user_id, now)
	_roll_live_holdings_return_state_if_needed(session, user_id, now)
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

	valued_accounts, cash_value_cny, account_warnings = await _value_cash_accounts(
		accounts,
		fx_rate_overrides,
	)
	valued_holdings, holdings_value_cny, holding_warnings = await _value_holdings(
		holdings,
		fx_rate_overrides,
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
	_update_live_portfolio_state(user_id, now, total_value_cny, has_assets)
	_update_live_holdings_return_state(
		user_id,
		now,
		aggregate_holdings_return_pct,
		holding_return_points,
	)

	hour_series = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(hours=24)),
		"hour",
	)
	day_series = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(days=30)),
		"day",
	)
	month_series = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(days=366)),
		"month",
	)
	year_series = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(days=366 * 5)),
		"year",
	)
	holdings_return_hour_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(hours=24),
			"TOTAL",
			default_name="非现金资产",
		),
		"hour",
	)
	holdings_return_day_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=30),
			"TOTAL",
			default_name="非现金资产",
		),
		"day",
	)
	holdings_return_month_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
			now - timedelta(days=366),
			"TOTAL",
			default_name="非现金资产",
		),
		"month",
	)
	holdings_return_year_series = build_return_timeline(
		_load_holdings_return_series_with_live_snapshot(
			session,
			user_id,
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
							user_id,
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
							user_id,
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
							user_id,
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
							user_id,
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
		warnings=[*fx_display_warnings, *account_warnings, *holding_warnings, *liability_warnings],
	)


async def _get_cached_dashboard(
	session: Session,
	user: UserAccount,
	force_refresh: bool = False,
) -> DashboardResponse:
	cache_entry = dashboard_cache.get(user.username)

	if (
		not force_refresh
		and cache_entry is not None
		and _is_current_minute(cache_entry.generated_at)
	):
		return cache_entry.dashboard

	async with dashboard_cache_lock:
		cache_entry = dashboard_cache.get(user.username)
		if (
			not force_refresh
			and cache_entry is not None
			and _is_current_minute(cache_entry.generated_at)
		):
			return cache_entry.dashboard

		dashboard = await _build_dashboard(session, user)
		dashboard_cache[user.username] = DashboardCacheEntry(
			dashboard=dashboard,
			generated_at=utc_now(),
		)
		return dashboard


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
	return {"status": "ok"}


def _create_user_account(session: Session, credentials: AuthCredentials) -> UserAccount:
	if _get_user(session, credentials.user_id) is not None:
		raise HTTPException(status_code=409, detail="用户名已存在。")

	user = UserAccount(
		username=credentials.user_id,
		password_digest=hash_password(credentials.password),
	)
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def _authenticate_user_account(session: Session, credentials: AuthCredentials) -> UserAccount:
	user = _get_user(session, credentials.user_id)
	if user is None or not verify_password(credentials.password, user.password_digest):
		raise HTTPException(status_code=401, detail="账号或密码错误。")
	return user


@app.get("/api/auth/session", response_model=AuthSessionRead)
def get_auth_session(
	request: Request,
	session: SessionDependency,
	_: TokenDependency,
) -> AuthSessionRead:
	user_id = get_session_user_id(request)
	if user_id is None:
		raise HTTPException(status_code=401, detail="请先登录。")

	user = _get_user(session, user_id)
	if user is None:
		request.session.clear()
		raise HTTPException(status_code=401, detail="请重新登录。")

	return AuthSessionRead(user_id=user.username)


@app.post("/api/auth/register", response_model=AuthSessionRead, status_code=201)
def register_user(
	request: Request,
	payload: AuthCredentials,
	_: TokenDependency,
	session: SessionDependency,
) -> AuthSessionRead:
	user = _create_user_account(session, payload)
	request.session["user_id"] = user.username
	return AuthSessionRead(user_id=user.username)


@app.post("/api/auth/login", response_model=AuthSessionRead)
def login_user(
	request: Request,
	payload: AuthCredentials,
	_: TokenDependency,
	session: SessionDependency,
) -> AuthSessionRead:
	user = _authenticate_user_account(session, payload)
	request.session["user_id"] = user.username
	return AuthSessionRead(user_id=user.username)


@app.post("/api/auth/logout", status_code=204)
def logout_user(request: Request, _: TokenDependency) -> Response:
	request.session.clear()
	return Response(status_code=204)


@app.post("/api/feedback", response_model=UserFeedbackRead, status_code=201)
def submit_feedback(
	payload: UserFeedbackCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> UserFeedbackRead:
	day_start, day_end = _feedback_day_window()
	submission_count = len(
		list(
			session.exec(
				select(UserFeedback.id).where(
					UserFeedback.user_id == current_user.username,
					UserFeedback.created_at >= day_start,
					UserFeedback.created_at < day_end,
				),
			),
		),
	)
	if submission_count >= MAX_DAILY_FEEDBACK_SUBMISSIONS:
		raise HTTPException(status_code=429, detail="今日反馈次数已达上限，请明天再试。")

	feedback = UserFeedback(
		user_id=current_user.username,
		message=payload.message,
	)
	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return UserFeedbackRead(
		id=feedback.id or 0,
		message=feedback.message,
		created_at=feedback.created_at,
	)


@app.get("/api/accounts", response_model=list[CashAccountRead])
async def list_accounts(
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[CashAccountRead]:
	dashboard = await _get_cached_dashboard(session, current_user)
	accounts = list(
		session.exec(
			select(CashAccount)
			.where(CashAccount.user_id == current_user.username)
			.order_by(CashAccount.platform, CashAccount.name),
		),
	)
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
				started_on=account.started_on,
				note=account.note,
				fx_to_cny=valued_account.fx_to_cny if valued_account else None,
				value_cny=valued_account.value_cny if valued_account else None,
			),
		)

	return items


@app.post("/api/accounts", response_model=CashAccountRead, status_code=201)
def create_account(
	payload: CashAccountCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> CashAccountRead:
	account = CashAccount(
		user_id=current_user.username,
		name=payload.name.strip(),
		platform=payload.platform.strip(),
		currency=_normalize_currency(payload.currency),
		balance=payload.balance,
		account_type=payload.account_type,
		started_on=payload.started_on,
		note=payload.note,
	)
	session.add(account)
	session.commit()
	session.refresh(account)
	_invalidate_dashboard_cache(current_user.username)
	return _to_cash_account_read(account)


@app.put("/api/accounts/{account_id}", response_model=CashAccountRead)
def update_account(
	account_id: int,
	payload: CashAccountUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> CashAccountRead:
	account = session.get(CashAccount, account_id)
	if account is None or account.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Account not found.")

	account.name = payload.name.strip()
	account.platform = payload.platform.strip()
	account.currency = _normalize_currency(payload.currency)
	account.balance = payload.balance
	if payload.account_type is not None:
		account.account_type = payload.account_type
	if "started_on" in payload.model_fields_set:
		account.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		account.note = _normalize_optional_text(payload.note)
	_touch_model(account)
	session.add(account)
	session.commit()
	session.refresh(account)
	_invalidate_dashboard_cache(current_user.username)
	return _to_cash_account_read(account)


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(
	account_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	account = session.get(CashAccount, account_id)
	if account is None or account.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Account not found.")

	session.delete(account)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)


@app.get("/api/fixed-assets", response_model=list[FixedAssetRead])
async def list_fixed_assets(
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[FixedAssetRead]:
	dashboard = await _get_cached_dashboard(session, current_user)
	assets = list(
		session.exec(
			select(FixedAsset)
			.where(FixedAsset.user_id == current_user.username)
			.order_by(FixedAsset.category, FixedAsset.name),
		),
	)
	valued_asset_map = {asset.id: asset for asset in dashboard.fixed_assets}
	items: list[FixedAssetRead] = []

	for asset in assets:
		valued_asset = valued_asset_map.get(asset.id or 0)
		items.append(
			FixedAssetRead(
				id=asset.id or 0,
				name=asset.name,
				category=asset.category,
				current_value_cny=round(asset.current_value_cny, 2),
				purchase_value_cny=round(asset.purchase_value_cny, 2)
				if asset.purchase_value_cny is not None
				else None,
				started_on=asset.started_on,
				note=asset.note,
				value_cny=valued_asset.value_cny if valued_asset else round(asset.current_value_cny, 2),
				return_pct=valued_asset.return_pct if valued_asset else None,
			),
		)

	return items


@app.post("/api/fixed-assets", response_model=FixedAssetRead, status_code=201)
def create_fixed_asset(
	payload: FixedAssetCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> FixedAssetRead:
	asset = FixedAsset(
		user_id=current_user.username,
		name=payload.name.strip(),
		category=payload.category,
		current_value_cny=payload.current_value_cny,
		purchase_value_cny=payload.purchase_value_cny,
		started_on=payload.started_on,
		note=payload.note,
	)
	session.add(asset)
	session.commit()
	session.refresh(asset)
	_invalidate_dashboard_cache(current_user.username)
	value_cny = round(asset.current_value_cny, 2)
	return FixedAssetRead(
		id=asset.id or 0,
		name=asset.name,
		category=asset.category,
		current_value_cny=value_cny,
		purchase_value_cny=round(asset.purchase_value_cny, 2)
		if asset.purchase_value_cny is not None
		else None,
		started_on=asset.started_on,
		note=asset.note,
		value_cny=value_cny,
		return_pct=_calculate_return_pct(value_cny, asset.purchase_value_cny),
	)


@app.put("/api/fixed-assets/{asset_id}", response_model=FixedAssetRead)
def update_fixed_asset(
	asset_id: int,
	payload: FixedAssetUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> FixedAssetRead:
	asset = session.get(FixedAsset, asset_id)
	if asset is None or asset.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Fixed asset not found.")

	asset.name = payload.name.strip()
	asset.category = payload.category
	asset.current_value_cny = payload.current_value_cny
	asset.purchase_value_cny = payload.purchase_value_cny
	if "started_on" in payload.model_fields_set:
		asset.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		asset.note = _normalize_optional_text(payload.note)
	_touch_model(asset)
	session.add(asset)
	session.commit()
	session.refresh(asset)
	_invalidate_dashboard_cache(current_user.username)
	value_cny = round(asset.current_value_cny, 2)
	return FixedAssetRead(
		id=asset.id or 0,
		name=asset.name,
		category=asset.category,
		current_value_cny=value_cny,
		purchase_value_cny=round(asset.purchase_value_cny, 2)
		if asset.purchase_value_cny is not None
		else None,
		started_on=asset.started_on,
		note=asset.note,
		value_cny=value_cny,
		return_pct=_calculate_return_pct(value_cny, asset.purchase_value_cny),
	)


@app.delete("/api/fixed-assets/{asset_id}", status_code=204)
def delete_fixed_asset(
	asset_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	asset = session.get(FixedAsset, asset_id)
	if asset is None or asset.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Fixed asset not found.")

	session.delete(asset)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)


@app.get("/api/liabilities", response_model=list[LiabilityEntryRead])
async def list_liabilities(
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[LiabilityEntryRead]:
	dashboard = await _get_cached_dashboard(session, current_user)
	entries = list(
		session.exec(
			select(LiabilityEntry)
			.where(LiabilityEntry.user_id == current_user.username)
			.order_by(LiabilityEntry.category, LiabilityEntry.name),
		),
	)
	valued_entry_map = {entry.id: entry for entry in dashboard.liabilities}
	items: list[LiabilityEntryRead] = []

	for entry in entries:
		valued_entry = valued_entry_map.get(entry.id or 0)
		items.append(
			LiabilityEntryRead(
				id=entry.id or 0,
				name=entry.name,
				category=entry.category,
				currency=entry.currency,
				balance=round(entry.balance, 2),
				started_on=entry.started_on,
				note=entry.note,
				fx_to_cny=valued_entry.fx_to_cny if valued_entry else None,
				value_cny=valued_entry.value_cny if valued_entry else None,
			),
		)

	return items


@app.post("/api/liabilities", response_model=LiabilityEntryRead, status_code=201)
def create_liability(
	payload: LiabilityEntryCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> LiabilityEntryRead:
	entry = LiabilityEntry(
		user_id=current_user.username,
		name=payload.name.strip(),
		category=payload.category,
		currency=_normalize_currency(payload.currency),
		balance=payload.balance,
		started_on=payload.started_on,
		note=payload.note,
	)
	session.add(entry)
	session.commit()
	session.refresh(entry)
	_invalidate_dashboard_cache(current_user.username)
	return _to_liability_read(entry)


@app.put("/api/liabilities/{entry_id}", response_model=LiabilityEntryRead)
def update_liability(
	entry_id: int,
	payload: LiabilityEntryUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> LiabilityEntryRead:
	entry = session.get(LiabilityEntry, entry_id)
	if entry is None or entry.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Liability not found.")

	entry.name = payload.name.strip()
	entry.currency = _normalize_currency(payload.currency)
	entry.balance = payload.balance
	if payload.category is not None:
		entry.category = payload.category
	if "started_on" in payload.model_fields_set:
		entry.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		entry.note = _normalize_optional_text(payload.note)
	_touch_model(entry)
	session.add(entry)
	session.commit()
	session.refresh(entry)
	_invalidate_dashboard_cache(current_user.username)
	return _to_liability_read(entry)


@app.delete("/api/liabilities/{entry_id}", status_code=204)
def delete_liability(
	entry_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	entry = session.get(LiabilityEntry, entry_id)
	if entry is None or entry.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Liability not found.")

	session.delete(entry)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)


@app.get("/api/other-assets", response_model=list[OtherAssetRead])
async def list_other_assets(
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[OtherAssetRead]:
	dashboard = await _get_cached_dashboard(session, current_user)
	assets = list(
		session.exec(
			select(OtherAsset)
			.where(OtherAsset.user_id == current_user.username)
			.order_by(OtherAsset.category, OtherAsset.name),
		),
	)
	valued_asset_map = {asset.id: asset for asset in dashboard.other_assets}
	items: list[OtherAssetRead] = []

	for asset in assets:
		valued_asset = valued_asset_map.get(asset.id or 0)
		items.append(
			OtherAssetRead(
				id=asset.id or 0,
				name=asset.name,
				category=asset.category,
				current_value_cny=round(asset.current_value_cny, 2),
				original_value_cny=round(asset.original_value_cny, 2)
				if asset.original_value_cny is not None
				else None,
				started_on=asset.started_on,
				note=asset.note,
				value_cny=valued_asset.value_cny if valued_asset else round(asset.current_value_cny, 2),
				return_pct=valued_asset.return_pct if valued_asset else None,
			),
		)

	return items


@app.post("/api/other-assets", response_model=OtherAssetRead, status_code=201)
def create_other_asset(
	payload: OtherAssetCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> OtherAssetRead:
	asset = OtherAsset(
		user_id=current_user.username,
		name=payload.name.strip(),
		category=payload.category,
		current_value_cny=payload.current_value_cny,
		original_value_cny=payload.original_value_cny,
		started_on=payload.started_on,
		note=payload.note,
	)
	session.add(asset)
	session.commit()
	session.refresh(asset)
	_invalidate_dashboard_cache(current_user.username)
	value_cny = round(asset.current_value_cny, 2)
	return OtherAssetRead(
		id=asset.id or 0,
		name=asset.name,
		category=asset.category,
		current_value_cny=value_cny,
		original_value_cny=round(asset.original_value_cny, 2)
		if asset.original_value_cny is not None
		else None,
		started_on=asset.started_on,
		note=asset.note,
		value_cny=value_cny,
		return_pct=_calculate_return_pct(value_cny, asset.original_value_cny),
	)


@app.put("/api/other-assets/{asset_id}", response_model=OtherAssetRead)
def update_other_asset(
	asset_id: int,
	payload: OtherAssetUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> OtherAssetRead:
	asset = session.get(OtherAsset, asset_id)
	if asset is None or asset.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Other asset not found.")

	asset.name = payload.name.strip()
	asset.category = payload.category
	asset.current_value_cny = payload.current_value_cny
	asset.original_value_cny = payload.original_value_cny
	if "started_on" in payload.model_fields_set:
		asset.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		asset.note = _normalize_optional_text(payload.note)
	_touch_model(asset)
	session.add(asset)
	session.commit()
	session.refresh(asset)
	_invalidate_dashboard_cache(current_user.username)
	value_cny = round(asset.current_value_cny, 2)
	return OtherAssetRead(
		id=asset.id or 0,
		name=asset.name,
		category=asset.category,
		current_value_cny=value_cny,
		original_value_cny=round(asset.original_value_cny, 2)
		if asset.original_value_cny is not None
		else None,
		started_on=asset.started_on,
		note=asset.note,
		value_cny=value_cny,
		return_pct=_calculate_return_pct(value_cny, asset.original_value_cny),
	)


@app.delete("/api/other-assets/{asset_id}", status_code=204)
def delete_other_asset(
	asset_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	asset = session.get(OtherAsset, asset_id)
	if asset is None or asset.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Other asset not found.")

	session.delete(asset)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)


@app.get("/api/holdings", response_model=list[SecurityHoldingRead])
async def list_holdings(
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[SecurityHoldingRead]:
	dashboard = await _get_cached_dashboard(session, current_user)
	holdings = list(
		session.exec(
			select(SecurityHolding)
			.where(SecurityHolding.user_id == current_user.username)
			.order_by(SecurityHolding.symbol, SecurityHolding.name),
		),
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
				started_on=holding.started_on,
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
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> SecurityHoldingRead:
	holding = SecurityHolding(
		user_id=current_user.username,
		symbol=_normalize_symbol(payload.symbol, payload.market),
		name=payload.name.strip(),
		quantity=payload.quantity,
		fallback_currency=_normalize_currency(payload.fallback_currency),
		cost_basis_price=payload.cost_basis_price,
		market=payload.market,
		broker=payload.broker,
		started_on=payload.started_on,
		note=payload.note,
	)
	session.add(holding)
	session.commit()
	session.refresh(holding)
	_invalidate_dashboard_cache(current_user.username)
	return _to_holding_read(holding)


@app.put("/api/holdings/{holding_id}", response_model=SecurityHoldingRead)
def update_holding(
	holding_id: int,
	payload: SecurityHoldingUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> SecurityHoldingRead:
	holding = session.get(SecurityHolding, holding_id)
	if holding is None or holding.user_id != current_user.username:
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
	if "started_on" in payload.model_fields_set:
		holding.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		holding.note = _normalize_optional_text(payload.note)
	_touch_model(holding)
	session.add(holding)
	session.commit()
	session.refresh(holding)
	_invalidate_dashboard_cache(current_user.username)
	return _to_holding_read(holding)


@app.delete("/api/holdings/{holding_id}", status_code=204)
def delete_holding(
	holding_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	holding = session.get(SecurityHolding, holding_id)
	if holding is None or holding.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Holding not found.")

	session.delete(holding)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)


@app.get("/api/securities/search", response_model=list[SecuritySearchRead])
async def search_securities(
	q: str,
	__: CurrentUserDependency,
) -> list[SecuritySearchRead]:
	query = q.strip()
	if not query:
		return []

	return await market_data_client.search_securities(query)


@app.get("/api/dashboard", response_model=DashboardResponse)
async def get_dashboard(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	refresh: bool = False,
) -> DashboardResponse:
	if refresh:
		market_data_client.clear_runtime_caches()
		_invalidate_dashboard_cache(current_user.username)
		return await _get_cached_dashboard(session, current_user, force_refresh=True)

	return await _get_cached_dashboard(session, current_user)
