from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import logging
import threading
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, text
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlmodel import Session, select
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.analytics import bucket_start_utc, build_return_timeline, build_timeline
from app.database import engine, get_session, init_db
from app.models import (
	ASSET_MUTATION_OPERATIONS,
	FEEDBACK_CATEGORIES,
	FEEDBACK_PRIORITIES,
	FEEDBACK_SOURCES,
	FEEDBACK_STATUSES,
	HOLDING_TRANSACTION_SIDES,
	INBOX_MESSAGE_KINDS,
	HOLDING_HISTORY_SYNC_STATUSES,
	AssetMutationAudit,
	CashAccount,
	DashboardCorrection,
	FixedAsset,
	HoldingHistorySyncRequest,
	HoldingPerformanceSnapshot,
	InboxMessageVisibility,
	LiabilityEntry,
	OtherAsset,
	PortfolioSnapshot,
	ReleaseNote,
	ReleaseNoteDelivery,
	SecurityHolding,
	SecurityHoldingTransaction,
	UserFeedback,
	UserAccount,
	utc_now,
)
from app.schemas import (
	ActionMessageRead,
	AdminFeedbackAcknowledgeUpdate,
	AdminFeedbackClassifyUpdate,
	AdminFeedbackListRead,
	AdminFeedbackRead,
	AdminFeedbackReplyUpdate,
	AllocationSlice,
	AssetMutationAuditRead,
	AuthLoginCredentials,
	AuthRegisterCredentials,
	AuthSessionRead,
	CashAccountCreate,
	CashAccountRead,
	CashAccountUpdate,
	DashboardCorrectionCreate,
	DashboardCorrectionRead,
	DashboardResponse,
	FixedAssetCreate,
	FixedAssetRead,
	FixedAssetUpdate,
	FeedbackSummaryRead,
	HoldingReturnSeries,
	HoldingTransactionApplyRead,
	InboxMessageHideCreate,
	LiabilityEntryCreate,
	LiabilityEntryRead,
	LiabilityEntryUpdate,
	OtherAssetCreate,
	OtherAssetRead,
	OtherAssetUpdate,
	PasswordResetRequest,
	ReleaseNoteCreate,
	ReleaseNoteDeliveryRead,
	ReleaseNoteRead,
	SecuritySearchRead,
	SecurityHoldingTransactionCreate,
	SecurityHoldingTransactionRead,
	UserEmailUpdate,
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
	hash_email,
	hash_password,
	normalize_user_id,
	require_session_user_id,
	verify_api_token,
	verify_email,
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
GLOBAL_FORCE_REFRESH_INTERVAL = timedelta(seconds=60)
DASHBOARD_SERIES_SCOPES = ("PORTFOLIO_TOTAL", "HOLDINGS_RETURN_TOTAL", "HOLDING_RETURN")
DASHBOARD_CORRECTION_ACTIONS = ("OVERRIDE", "DELETE")
DASHBOARD_CORRECTION_GRANULARITIES = ("hour", "day", "month", "year")
LOGIN_ATTEMPT_WINDOW = timedelta(minutes=1)
MAX_LOGIN_ATTEMPTS_PER_WINDOW = 8
FAILED_LOGIN_FORGOT_PASSWORD_THRESHOLD = 5
MAX_LOGIN_DEVICE_ID_LENGTH = 120
LOGIN_ATTEMPT_STATE_TTL = timedelta(hours=24)
HOLDING_QUANTITY_EPSILON = 1e-8


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


@dataclass(slots=True)
class HoldingLot:
	quantity: float
	traded_on: date
	cost_per_unit: float | None


@dataclass(slots=True)
class ProjectedHoldingState:
	symbol: str
	name: str
	market: str
	fallback_currency: str
	broker: str | None
	note: str | None
	lots: list[HoldingLot]


@dataclass(slots=True)
class LoginAttemptState:
	attempt_timestamps: list[datetime]
	consecutive_failed_attempts: int
	last_attempt_at: datetime


dashboard_cache: dict[str, DashboardCacheEntry] = {}
live_portfolio_states: dict[str, LivePortfolioState] = {}
live_holdings_return_states: dict[str, LiveHoldingsReturnState] = {}
login_attempt_states: dict[tuple[str, str], LoginAttemptState] = {}
dashboard_cache_lock = asyncio.Lock()
global_force_refresh_lock = asyncio.Lock()
last_global_force_refresh_at: datetime | None = None
background_refresh_task: asyncio.Task[None] | None = None
holding_history_sync_lock = asyncio.Lock()
login_attempts_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
	global background_refresh_task
	settings.validate_runtime()
	init_db()
	_ensure_legacy_schema()
	_migrate_legacy_holdings_to_transactions()
	_audit_legacy_user_ownership()

	try:
		with Session(engine) as session:
			await _process_pending_holding_history_sync_requests(session, limit=5)
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
	allow_headers=["Content-Type", "X-API-Key", "X-Client-Device-Id"],
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


def _json_ready(value: Any) -> Any:
	if isinstance(value, datetime):
		return _coerce_utc_datetime(value).isoformat().replace("+00:00", "Z")
	if isinstance(value, date):
		return value.isoformat()
	if isinstance(value, dict):
		return {str(key): _json_ready(item) for key, item in value.items()}
	if isinstance(value, (list, tuple)):
		return [_json_ready(item) for item in value]
	return value


def _capture_model_state(
	model: CashAccount
	| SecurityHolding
	| SecurityHoldingTransaction
	| FixedAsset
	| LiabilityEntry
	| OtherAsset,
) -> dict[str, Any]:
	return _json_ready(model.model_dump())


def _serialize_audit_state(state: dict[str, Any] | None) -> str | None:
	if state is None:
		return None
	return json.dumps(_json_ready(state), ensure_ascii=False, sort_keys=True)


def _record_asset_mutation(
	session: Session,
	current_user: UserAccount,
	entity_type: str,
	entity_id: int | None,
	operation: str,
	before_state: dict[str, Any] | None,
	after_state: dict[str, Any] | None,
	reason: str | None = None,
) -> None:
	if operation not in ASSET_MUTATION_OPERATIONS:
		raise ValueError(f"Unsupported asset mutation operation: {operation}")

	session.add(
		AssetMutationAudit(
			user_id=current_user.username,
			actor_user_id=current_user.username,
			entity_type=entity_type,
			entity_id=entity_id,
			operation=operation,
			before_state=_serialize_audit_state(before_state),
			after_state=_serialize_audit_state(after_state),
			reason=reason,
		),
	)


def _touch_model(
	model: CashAccount
	| SecurityHolding
	| SecurityHoldingTransaction
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


def _server_today_date(value: datetime | None = None) -> date:
	timestamp = _coerce_utc_datetime(value or utc_now()).astimezone(FEEDBACK_TIMEZONE)
	return timestamp.date()


def _ensure_date_not_future(value: date | None, *, field_label: str) -> None:
	if value is None:
		return

	server_today = _server_today_date()
	if value > server_today:
		raise HTTPException(
			status_code=422,
			detail=f"{field_label}不能晚于今日（服务器日期：{server_today.isoformat()}）。",
		)


def _date_start_utc(value: date) -> datetime:
	"""Convert a local calendar date into the UTC timestamp of local 00:00."""
	day_start_local = datetime(
		value.year,
		value.month,
		value.day,
		tzinfo=FEEDBACK_TIMEZONE,
	)
	return day_start_local.astimezone(timezone.utc)


def _is_current_minute(value: datetime | None, now: datetime | None = None) -> bool:
	if value is None:
		return False

	return _current_minute_bucket(value) == _current_minute_bucket(now)


async def _consume_global_force_refresh_slot() -> bool:
	"""Allow at most one cache-clearing force refresh every 60 seconds across the process."""
	global last_global_force_refresh_at

	async with global_force_refresh_lock:
		now = utc_now()
		if (
			last_global_force_refresh_at is not None
			and now - _coerce_utc_datetime(last_global_force_refresh_at) < GLOBAL_FORCE_REFRESH_INTERVAL
		):
			return False

		last_global_force_refresh_at = now
		return True


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
				await _process_pending_holding_history_sync_requests(session, limit=1)
				await _refresh_user_dashboards(
					session,
					session.exec(select(UserAccount)).all(),
					clear_market_data=True,
				)
		except Exception:
			logger.exception("Scheduled dashboard refresh failed.")


def _enqueue_holding_history_sync_request(
	session: Session,
	*,
	user_id: str,
	trigger_symbol: str | None = None,
) -> None:
	existing_request = session.exec(
		select(HoldingHistorySyncRequest)
		.where(HoldingHistorySyncRequest.user_id == user_id)
		.order_by(HoldingHistorySyncRequest.requested_at.desc(), HoldingHistorySyncRequest.id.desc()),
	).first()
	now = utc_now()
	if existing_request is None:
		session.add(
			HoldingHistorySyncRequest(
				user_id=user_id,
				status=HOLDING_HISTORY_SYNC_STATUSES[0],
				trigger_symbol=trigger_symbol,
				requested_at=now,
				started_at=None,
				completed_at=None,
				error_message=None,
			),
		)
		return

	existing_request.status = HOLDING_HISTORY_SYNC_STATUSES[0]
	existing_request.trigger_symbol = trigger_symbol
	existing_request.requested_at = now
	existing_request.started_at = None
	existing_request.completed_at = None
	existing_request.error_message = None
	session.add(existing_request)


def _has_holding_history_sync_pending(session: Session, user_id: str) -> bool:
	request = session.exec(
		select(HoldingHistorySyncRequest.id).where(
			HoldingHistorySyncRequest.user_id == user_id,
			HoldingHistorySyncRequest.status.in_(
				(
					HOLDING_HISTORY_SYNC_STATUSES[0],
					HOLDING_HISTORY_SYNC_STATUSES[1],
				),
			),
		),
	).first()
	return request is not None


def _build_hour_buckets(start_at: datetime, end_at: datetime) -> list[datetime]:
	start_hour = _current_hour_bucket(start_at)
	end_hour = _current_hour_bucket(end_at)
	if end_hour < start_hour:
		return []

	hours: list[datetime] = []
	cursor = start_hour
	while cursor <= end_hour:
		hours.append(cursor)
		cursor += timedelta(hours=1)
	return hours


def _fill_hourly_prices(
	hours: list[datetime],
	known_points: list[tuple[datetime, float]],
	fallback_price: float,
) -> dict[datetime, float]:
	known_map: dict[datetime, float] = {}
	for bucket, price in known_points:
		if price <= 0:
			continue
		known_map[_current_hour_bucket(bucket)] = float(price)

	first_known_price = next(iter(sorted(known_map.values())), None)
	default_price = fallback_price if fallback_price > 0 else (first_known_price or 0.0)
	last_known_price: float | None = None

	filled: dict[datetime, float] = {}
	for hour in hours:
		if hour in known_map:
			last_known_price = known_map[hour]
			filled[hour] = known_map[hour]
			continue

		if last_known_price is not None:
			filled[hour] = last_known_price
			continue

		filled[hour] = default_price

	return filled


async def _rebuild_user_holding_history_snapshots(session: Session, user_id: str) -> None:
	now = utc_now()
	end_hour = _current_hour_bucket(now)
	holdings = list(
		session.exec(
			select(SecurityHolding)
			.where(SecurityHolding.user_id == user_id)
			.order_by(SecurityHolding.symbol, SecurityHolding.name),
		),
	)

	session.exec(
		delete(HoldingPerformanceSnapshot).where(
			HoldingPerformanceSnapshot.user_id == user_id,
			HoldingPerformanceSnapshot.scope.in_(("HOLDING", "TOTAL")),
		),
	)
	session.commit()

	weighted_sum_by_hour: dict[datetime, float] = {}
	total_basis_by_hour: dict[datetime, float] = {}
	history_warnings: list[str] = []

	for holding in holdings:
		if (
			holding.cost_basis_price is None
			or holding.cost_basis_price <= 0
			or holding.quantity <= 0
			or holding.started_on is None
		):
			continue

		start_at = _date_start_utc(holding.started_on)
		if start_at > end_hour:
			continue

		known_points, history_currency, warnings = await market_data_client.fetch_hourly_price_series(
			holding.symbol,
			market=holding.market,
			start_at=start_at,
			end_at=end_hour + timedelta(hours=1),
		)
		history_warnings.extend(warnings)

		fallback_price = holding.cost_basis_price
		currency_for_pricing = history_currency
		if not known_points or not currency_for_pricing:
			latest_quote, quote_warnings = await market_data_client.fetch_quote(
				holding.symbol,
				holding.market,
			)
			history_warnings.extend(quote_warnings)
			if latest_quote.price > 0:
				fallback_price = latest_quote.price
			currency_for_pricing = currency_for_pricing or latest_quote.currency

		currency_code = _normalize_currency(currency_for_pricing or holding.fallback_currency)
		if currency_code == "CNY":
			fx_to_cny = 1.0
		else:
			fx_to_cny, fx_warnings = await market_data_client.fetch_fx_rate(currency_code, "CNY")
			history_warnings.extend(fx_warnings)

		basis_value_cny = holding.cost_basis_price * holding.quantity * fx_to_cny
		if basis_value_cny <= 0:
			continue

		hours = _build_hour_buckets(start_at, end_hour)
		filled_prices = _fill_hourly_prices(hours, known_points, fallback_price)
		symbol_rows: list[HoldingPerformanceSnapshot] = []
		for hour in hours:
			price = filled_prices.get(hour, 0.0)
			return_pct = _calculate_return_pct(price, holding.cost_basis_price)
			if return_pct is None:
				continue

			symbol_rows.append(
				HoldingPerformanceSnapshot(
					user_id=user_id,
					scope="HOLDING",
					symbol=holding.symbol,
					name=holding.name,
					return_pct=return_pct,
					created_at=hour,
				),
			)
			weighted_sum_by_hour[hour] = weighted_sum_by_hour.get(hour, 0.0) + return_pct * basis_value_cny
			total_basis_by_hour[hour] = total_basis_by_hour.get(hour, 0.0) + basis_value_cny

		if symbol_rows:
			session.add_all(symbol_rows)
			session.commit()

	total_rows: list[HoldingPerformanceSnapshot] = []
	for hour in sorted(total_basis_by_hour):
		total_basis = total_basis_by_hour.get(hour, 0.0)
		if total_basis <= 0:
			continue
		total_return_pct = round(weighted_sum_by_hour[hour] / total_basis, 2)
		total_rows.append(
			HoldingPerformanceSnapshot(
				user_id=user_id,
				scope="TOTAL",
				symbol=None,
				name="非现金资产",
				return_pct=total_return_pct,
				created_at=hour,
			),
		)
	if total_rows:
		session.add_all(total_rows)
		session.commit()

	if history_warnings:
		logger.warning(
			"Holding history rebuild warnings for user %s: %s",
			user_id,
			"; ".join(history_warnings[:8]),
		)

	live_holdings_return_states.pop(user_id, None)
	_invalidate_dashboard_cache(user_id)


async def _process_pending_holding_history_sync_requests(
	session: Session,
	*,
	limit: int = 1,
	user_id: str | None = None,
) -> None:
	async with holding_history_sync_lock:
		query = (
			select(HoldingHistorySyncRequest)
			.where(HoldingHistorySyncRequest.status == HOLDING_HISTORY_SYNC_STATUSES[0])
			.order_by(HoldingHistorySyncRequest.requested_at.asc(), HoldingHistorySyncRequest.id.asc())
			.limit(limit)
		)
		if user_id is not None:
			query = query.where(HoldingHistorySyncRequest.user_id == user_id)
		pending_requests = list(session.exec(query))
		for request_row in pending_requests:
			request_row.status = HOLDING_HISTORY_SYNC_STATUSES[1]
			request_row.started_at = utc_now()
			request_row.error_message = None
			session.add(request_row)
			session.commit()
			session.refresh(request_row)

			try:
				await _rebuild_user_holding_history_snapshots(session, request_row.user_id)
			except Exception as exc:  # pragma: no cover - defensive path
				logger.exception(
					"Holding history rebuild failed for user %s.",
					request_row.user_id,
				)
				request_row.status = HOLDING_HISTORY_SYNC_STATUSES[0]
				request_row.error_message = str(exc)[:500]
				request_row.started_at = None
				session.add(request_row)
				session.commit()
				continue

			request_row.status = HOLDING_HISTORY_SYNC_STATUSES[2]
			request_row.error_message = None
			request_row.completed_at = utc_now()
			session.add(request_row)
			session.commit()


def _load_table_columns(session: Session, table_name: str) -> set[str]:
	rows = session.exec(text(f"PRAGMA table_info({table_name})")).all()
	return {row[1] for row in rows}


def _ensure_legacy_schema() -> None:
	"""Add newly introduced columns when the local SQLite file predates them."""
	schema_changes = (
		(
			UserAccount.__table__.name,
			{
				"email": "TEXT",
				"email_digest": "TEXT",
			},
		),
		(
			UserFeedback.__table__.name,
			{
				"category": "TEXT NOT NULL DEFAULT 'USER_REQUEST'",
				"priority": "TEXT NOT NULL DEFAULT 'MEDIUM'",
				"source": "TEXT NOT NULL DEFAULT 'USER'",
				"status": "TEXT NOT NULL DEFAULT 'OPEN'",
				"reply_message": "TEXT",
				"replied_at": "TEXT",
				"replied_by": "TEXT",
				"reply_seen_at": "TEXT",
				"resolved_at": "TEXT",
				"closed_by": "TEXT",
				"assignee": "TEXT",
				"acknowledged_at": "TEXT",
				"acknowledged_by": "TEXT",
				"ack_deadline": "TEXT",
				"internal_note": "TEXT",
				"internal_note_updated_at": "TEXT",
				"internal_note_updated_by": "TEXT",
				"fingerprint": "TEXT",
				"dedupe_window_minutes": "INTEGER",
				"occurrence_count": "INTEGER NOT NULL DEFAULT 1",
				"last_seen_at": "TEXT",
			},
		),
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


def _migrate_legacy_holdings_to_transactions() -> None:
	"""Backfill transaction rows from legacy holding snapshots for historical continuity."""
	with Session(engine) as session:
		holdings = list(
			session.exec(
				select(SecurityHolding)
				.order_by(SecurityHolding.user_id, SecurityHolding.symbol, SecurityHolding.id),
			),
		)
		if not holdings:
			return

		has_changes = False
		for holding in holdings:
			transactions = list(
				session.exec(
					select(SecurityHoldingTransaction)
					.where(SecurityHoldingTransaction.user_id == holding.user_id)
					.where(SecurityHoldingTransaction.symbol == holding.symbol)
					.where(SecurityHoldingTransaction.market == holding.market),
				),
			)

			if transactions:
				for transaction in transactions:
					if transaction.side == "ADJUST":
						transaction.side = "BUY"
						_touch_model(transaction)
						session.add(transaction)
						has_changes = True

				earliest_traded_on = min(item.traded_on for item in transactions)
				if holding.started_on is None or earliest_traded_on < holding.started_on:
					holding.started_on = earliest_traded_on
					_touch_model(holding)
					session.add(holding)
					has_changes = True
				continue

			fallback_started_on = holding.started_on or _server_today_date(
				_coerce_utc_datetime(holding.created_at),
			)
			if holding.started_on is None:
				holding.started_on = fallback_started_on
				_touch_model(holding)
				session.add(holding)
				has_changes = True

			if holding.quantity <= HOLDING_QUANTITY_EPSILON:
				continue

			session.add(
				SecurityHoldingTransaction(
					user_id=holding.user_id,
					symbol=holding.symbol,
					name=holding.name,
					side="BUY",
					quantity=max(holding.quantity, 0.0),
					price=holding.cost_basis_price
					if holding.cost_basis_price and holding.cost_basis_price > 0
					else None,
					fallback_currency=_normalize_currency(holding.fallback_currency),
					market=holding.market,
					broker=holding.broker,
					traded_on=fallback_started_on,
					note=holding.note,
				),
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
	*,
	force_pending: bool = False,
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
			logger.warning(
				"Quote lookup still pending for %s: %s",
				holding.symbol,
				exc,
			)
			value_cny = 0.0
			price = 0.0
			price_currency = holding.fallback_currency
			fx_rate = 0.0
			last_updated = None
			warnings.append(f"持仓 {holding.symbol} 行情更新中")

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
				last_updated=None if force_pending else last_updated,
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


def _to_holding_transaction_read(
	transaction: SecurityHoldingTransaction,
) -> SecurityHoldingTransactionRead:
	return SecurityHoldingTransactionRead(
		id=transaction.id or 0,
		symbol=transaction.symbol,
		name=transaction.name,
		side=transaction.side,
		quantity=transaction.quantity,
		price=transaction.price,
		fallback_currency=transaction.fallback_currency,
		market=transaction.market,
		broker=transaction.broker,
		traded_on=transaction.traded_on,
		note=transaction.note,
		created_at=transaction.created_at,
		updated_at=transaction.updated_at,
	)


def _holding_transaction_side_priority(side: str) -> int:
	if side == "ADJUST":
		return 0
	if side == "BUY":
		return 1
	return 2


def _holding_transaction_sort_key(
	transaction: SecurityHoldingTransaction,
) -> tuple[date, int, datetime, int]:
	return (
		transaction.traded_on,
		_holding_transaction_side_priority(transaction.side),
		_coerce_utc_datetime(transaction.created_at),
		transaction.id or 0,
	)


def _projected_holding_quantity(state: ProjectedHoldingState) -> float:
	total = sum(lot.quantity for lot in state.lots)
	if total <= HOLDING_QUANTITY_EPSILON:
		return 0.0
	return round(total, 8)


def _projected_holding_started_on(state: ProjectedHoldingState) -> date | None:
	if not state.lots:
		return None
	return min(lot.traded_on for lot in state.lots)


def _projected_holding_cost_basis(state: ProjectedHoldingState) -> float | None:
	quantity = _projected_holding_quantity(state)
	if quantity <= HOLDING_QUANTITY_EPSILON:
		return None

	total_cost = 0.0
	for lot in state.lots:
		if lot.cost_per_unit is None:
			return None
		total_cost += lot.quantity * lot.cost_per_unit

	if total_cost <= 0:
		return None
	return round(total_cost / quantity, 8)


def _normalize_holding_transaction_side(side: str) -> str:
	normalized = side.strip().upper()
	if normalized not in HOLDING_TRANSACTION_SIDES:
		raise HTTPException(
			status_code=422,
			detail=f"交易方向必须是 {', '.join(HOLDING_TRANSACTION_SIDES)}。",
		)
	return normalized


def _list_holdings_for_symbol(
	session: Session,
	*,
	user_id: str,
	symbol: str,
	market: str,
) -> list[SecurityHolding]:
	return list(
		session.exec(
			select(SecurityHolding)
			.where(SecurityHolding.user_id == user_id)
			.where(SecurityHolding.symbol == symbol)
			.where(SecurityHolding.market == market)
			.order_by(SecurityHolding.id.asc()),
		),
	)


def _delete_holding_transactions_for_symbol(
	session: Session,
	*,
	user_id: str,
	symbol: str,
	market: str,
) -> None:
	session.exec(
		delete(SecurityHoldingTransaction)
		.where(SecurityHoldingTransaction.user_id == user_id)
		.where(SecurityHoldingTransaction.symbol == symbol)
		.where(SecurityHoldingTransaction.market == market),
	)


def _ensure_transaction_baseline_from_holding_snapshot(
	session: Session,
	*,
	holding: SecurityHolding,
) -> None:
	existing_transaction = session.exec(
		select(SecurityHoldingTransaction.id)
		.where(SecurityHoldingTransaction.user_id == holding.user_id)
		.where(SecurityHoldingTransaction.symbol == holding.symbol)
		.where(SecurityHoldingTransaction.market == holding.market)
		.limit(1),
	).first()
	if existing_transaction is not None:
		return

	baseline_date = holding.started_on or _server_today_date(
		_coerce_utc_datetime(holding.created_at),
	)
	session.add(
		SecurityHoldingTransaction(
			user_id=holding.user_id,
			symbol=holding.symbol,
			name=holding.name,
			side="BUY",
			quantity=max(holding.quantity, 0.0),
			price=holding.cost_basis_price if holding.cost_basis_price and holding.cost_basis_price > 0 else None,
			fallback_currency=_normalize_currency(holding.fallback_currency),
			market=holding.market,
			broker=holding.broker,
			traded_on=baseline_date,
			note=holding.note,
		),
	)


def _reset_holding_transactions_from_snapshot(
	session: Session,
	*,
	holding: SecurityHolding,
) -> SecurityHoldingTransaction | None:
	_delete_holding_transactions_for_symbol(
		session,
		user_id=holding.user_id,
		symbol=holding.symbol,
		market=holding.market,
	)
	if holding.quantity <= HOLDING_QUANTITY_EPSILON:
		return None

	baseline_date = holding.started_on or _server_today_date(
		_coerce_utc_datetime(holding.created_at),
	)
	transaction = SecurityHoldingTransaction(
		user_id=holding.user_id,
		symbol=holding.symbol,
		name=holding.name,
		side="BUY",
		quantity=max(holding.quantity, 0.0),
		price=holding.cost_basis_price if holding.cost_basis_price and holding.cost_basis_price > 0 else None,
		fallback_currency=_normalize_currency(holding.fallback_currency),
		market=holding.market,
		broker=holding.broker,
		traded_on=baseline_date,
		note=holding.note,
	)
	session.add(transaction)
	return transaction


def _project_holding_state_from_transactions(
	session: Session,
	*,
	user_id: str,
	symbol: str,
	market: str,
) -> ProjectedHoldingState | None:
	transactions = list(
		session.exec(
			select(SecurityHoldingTransaction)
			.where(SecurityHoldingTransaction.user_id == user_id)
			.where(SecurityHoldingTransaction.symbol == symbol)
			.where(SecurityHoldingTransaction.market == market),
		),
	)
	if not transactions:
		return None

	transactions.sort(key=_holding_transaction_sort_key)
	first = transactions[0]
	state = ProjectedHoldingState(
		symbol=symbol,
		name=first.name,
		market=market,
		fallback_currency=first.fallback_currency,
		broker=first.broker,
		note=first.note,
		lots=[],
	)

	for transaction in transactions:
		side = _normalize_holding_transaction_side(transaction.side)
		quantity = max(transaction.quantity, 0.0)
		if quantity <= HOLDING_QUANTITY_EPSILON:
			continue

		# Keep metadata from the latest transaction that carries a value.
		state.name = transaction.name or state.name
		state.fallback_currency = _normalize_currency(
			transaction.fallback_currency or state.fallback_currency,
		)
		state.broker = _normalize_optional_text(transaction.broker) or state.broker
		state.note = _normalize_optional_text(transaction.note) or state.note

		if side == "ADJUST":
			cost_per_unit = (
				transaction.price if transaction.price is not None and transaction.price > 0 else None
			)
			state.lots = [
				HoldingLot(
					quantity=quantity,
					traded_on=transaction.traded_on,
					cost_per_unit=cost_per_unit,
				),
			]
			continue

		if side == "BUY":
			state.lots.append(
				HoldingLot(
					quantity=quantity,
					traded_on=transaction.traded_on,
					cost_per_unit=transaction.price if transaction.price and transaction.price > 0 else None,
				),
			)
			continue

		remaining_to_sell = quantity
		next_lots: list[HoldingLot] = []
		for lot in sorted(state.lots, key=lambda item: item.traded_on):
			if remaining_to_sell <= HOLDING_QUANTITY_EPSILON:
				next_lots.append(lot)
				continue
			if lot.quantity <= remaining_to_sell + HOLDING_QUANTITY_EPSILON:
				remaining_to_sell -= lot.quantity
				continue
			next_lots.append(
				HoldingLot(
					quantity=round(lot.quantity - remaining_to_sell, 8),
					traded_on=lot.traded_on,
					cost_per_unit=lot.cost_per_unit,
				),
			)
			remaining_to_sell = 0.0

		if remaining_to_sell > HOLDING_QUANTITY_EPSILON:
			raise HTTPException(
				status_code=422,
				detail=(
					f"{symbol} 可卖数量不足。当前可卖 "
					f"{_projected_holding_quantity(state):g}，请求卖出 {quantity:g}。"
				),
			)

		state.lots = next_lots

	if _projected_holding_quantity(state) <= HOLDING_QUANTITY_EPSILON:
		return None
	return state


def _sync_holding_projection_for_symbol(
	session: Session,
	*,
	user_id: str,
	symbol: str,
	market: str,
) -> SecurityHolding | None:
	existing_holdings = _list_holdings_for_symbol(
		session,
		user_id=user_id,
		symbol=symbol,
		market=market,
	)
	primary_holding = existing_holdings[0] if existing_holdings else None
	for stale_holding in existing_holdings[1:]:
		session.delete(stale_holding)

	projected_state = _project_holding_state_from_transactions(
		session,
		user_id=user_id,
		symbol=symbol,
		market=market,
	)
	if projected_state is None:
		if primary_holding is not None:
			session.delete(primary_holding)
		return None

	quantity = _projected_holding_quantity(projected_state)
	started_on = _projected_holding_started_on(projected_state)
	cost_basis_price = _projected_holding_cost_basis(projected_state)
	if primary_holding is None:
		primary_holding = SecurityHolding(
			user_id=user_id,
			symbol=symbol,
			name=projected_state.name,
			quantity=quantity,
			fallback_currency=projected_state.fallback_currency,
			cost_basis_price=cost_basis_price,
			market=market,
			broker=projected_state.broker,
			started_on=started_on,
			note=projected_state.note,
		)
	else:
		primary_holding.name = projected_state.name
		primary_holding.quantity = quantity
		primary_holding.fallback_currency = projected_state.fallback_currency
		primary_holding.cost_basis_price = cost_basis_price
		primary_holding.market = market
		primary_holding.broker = projected_state.broker
		primary_holding.started_on = started_on
		primary_holding.note = projected_state.note
		_touch_model(primary_holding)

	session.add(primary_holding)
	session.flush()
	return primary_holding


def _resolve_sell_execution_price_and_currency(
	*,
	symbol: str,
	market: str,
	fallback_currency: str,
	payload_price: float | None,
) -> tuple[float, str]:
	resolved_price = payload_price if payload_price and payload_price > 0 else None
	resolved_currency = _normalize_currency(fallback_currency)

	try:
		quote, _warnings = asyncio.run(
			market_data_client.fetch_quote(symbol, market),
		)
		if quote.price > 0:
			resolved_price = quote.price
		if quote.currency:
			resolved_currency = _normalize_currency(quote.currency)
	except (QuoteLookupError, ValueError):
		# Fallback to payload-provided price/currency when live quote is temporarily unavailable.
		pass

	if resolved_price is None or resolved_price <= 0:
		raise HTTPException(
			status_code=422,
			detail="卖出交易缺少可用价格，请稍后重试或手动提供成交价。",
		)

	return round(resolved_price, 8), resolved_currency


def _create_auto_cash_account_from_sell(
	session: Session,
	*,
	current_user: UserAccount,
	symbol: str,
	name: str,
	market: str,
	quantity: float,
	execution_price: float,
	currency: str,
	traded_on: date,
	transaction_id: int | None,
) -> CashAccount:
	proceeds = round(quantity * execution_price, 8)
	cash_entry = CashAccount(
		user_id=current_user.username,
		name=f"{symbol} 卖出回款",
		platform="交易回款",
		currency=_normalize_currency(currency),
		balance=proceeds,
		account_type="OTHER",
		started_on=traded_on,
		note=(
			f"来源：卖出 {name}({symbol}) [{market}] "
			f"数量 {quantity:g}，成交价 {execution_price:g} {currency}"
			+ (f"，交易ID #{transaction_id}" if transaction_id is not None else "")
		),
	)
	session.add(cash_entry)
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="ACCOUNT",
		entity_id=cash_entry.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(cash_entry),
		reason=f"AUTO_SELL_PROCEEDS#{transaction_id}" if transaction_id is not None else "AUTO_SELL_PROCEEDS",
	)
	return cash_entry


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
	_update_live_portfolio_state(user_id, now, total_value_cny, has_assets)
	_update_live_holdings_return_state(
		user_id,
		now,
		aggregate_holdings_return_pct,
		holding_return_points,
	)
	correction_lookup = _load_dashboard_correction_lookup(session, user_id)

	hour_series_raw = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(hours=24)),
		"hour",
	)
	day_series_raw = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(days=30)),
		"day",
	)
	month_series_raw = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(days=366)),
		"month",
	)
	year_series_raw = build_timeline(
		_load_series_with_live_snapshot(session, user_id, now - timedelta(days=366 * 5)),
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
		warnings=[
			*(
				["持仓历史更新中，曲线会在回填完成后自动同步。"]
				if history_sync_pending
				else []
			),
			*fx_display_warnings,
			*account_warnings,
			*holding_warnings,
			*liability_warnings,
		],
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


def _create_user_account(session: Session, credentials: AuthRegisterCredentials) -> UserAccount:
	if _get_user(session, credentials.user_id) is not None:
		raise HTTPException(status_code=409, detail="用户名已存在。")

	email_digest = hash_email(credentials.email)
	if session.exec(select(UserAccount).where(UserAccount.email_digest == email_digest)).first():
		raise HTTPException(status_code=409, detail="该邮箱已被其他账号使用。")

	user = UserAccount(
		username=credentials.user_id,
		email=credentials.email,
		password_digest=hash_password(credentials.password),
		email_digest=email_digest,
	)
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def _normalize_client_device_id(raw_device_id: str | None) -> str | None:
	if raw_device_id is None:
		return None

	normalized = raw_device_id.strip()
	if not normalized:
		return None

	return normalized[:MAX_LOGIN_DEVICE_ID_LENGTH]


def _build_login_attempt_key(request: Request, user_id: str) -> tuple[str, str]:
	explicit_device_id = _normalize_client_device_id(
		request.headers.get("X-Client-Device-Id"),
	)
	if explicit_device_id is not None:
		return normalize_user_id(user_id), f"device:{explicit_device_id}"

	client_host = request.client.host if request.client is not None else "unknown"
	user_agent = (request.headers.get("user-agent") or "").strip().lower()
	fallback_seed = f"{client_host}|{user_agent}"
	fallback_hash = hashlib.sha256(fallback_seed.encode("utf-8")).hexdigest()[:24]
	return normalize_user_id(user_id), f"fallback:{fallback_hash}"


def _prune_login_attempt_timestamps(
	attempt_timestamps: list[datetime],
	now: datetime,
) -> list[datetime]:
	window_start = now - LOGIN_ATTEMPT_WINDOW
	return [timestamp for timestamp in attempt_timestamps if timestamp >= window_start]


def _cleanup_expired_login_attempt_states(now: datetime) -> None:
	expired_before = now - LOGIN_ATTEMPT_STATE_TTL
	expired_keys = [
		key
		for key, state in login_attempt_states.items()
		if state.last_attempt_at < expired_before
	]
	for key in expired_keys:
		login_attempt_states.pop(key, None)


def _reserve_login_attempt(
	attempt_key: tuple[str, str],
	now: datetime,
) -> None:
	with login_attempts_lock:
		state = login_attempt_states.get(attempt_key)
		if state is None:
			state = LoginAttemptState(
				attempt_timestamps=[],
				consecutive_failed_attempts=0,
				last_attempt_at=now,
			)
			login_attempt_states[attempt_key] = state

		state.attempt_timestamps = _prune_login_attempt_timestamps(
			state.attempt_timestamps,
			now,
		)
		if len(state.attempt_timestamps) >= MAX_LOGIN_ATTEMPTS_PER_WINDOW:
			raise HTTPException(
				status_code=429,
				detail="同一设备同一账号 1 分钟内最多尝试 8 次，请稍后再试。",
			)

		state.attempt_timestamps.append(now)
		state.last_attempt_at = now

		if len(login_attempt_states) > 2048:
			_cleanup_expired_login_attempt_states(now)


def _record_failed_login_attempt(
	attempt_key: tuple[str, str],
	now: datetime,
) -> int:
	with login_attempts_lock:
		state = login_attempt_states.get(attempt_key)
		if state is None:
			state = LoginAttemptState(
				attempt_timestamps=[now],
				consecutive_failed_attempts=0,
				last_attempt_at=now,
			)
			login_attempt_states[attempt_key] = state

		state.consecutive_failed_attempts += 1
		state.last_attempt_at = now
		return state.consecutive_failed_attempts


def _record_successful_login(attempt_key: tuple[str, str], now: datetime) -> None:
	with login_attempts_lock:
		state = login_attempt_states.get(attempt_key)
		if state is None:
			return
		state.consecutive_failed_attempts = 0
		state.last_attempt_at = now


def _authenticate_user_account(
	session: Session,
	credentials: AuthLoginCredentials,
	*,
	attempt_key: tuple[str, str] | None = None,
) -> UserAccount:
	now = utc_now()
	login_attempt_key = attempt_key or (normalize_user_id(credentials.user_id), "device:unknown")
	_reserve_login_attempt(login_attempt_key, now)
	user = _get_user(session, credentials.user_id)
	if user is None or not verify_password(credentials.password, user.password_digest):
		failed_attempts = _record_failed_login_attempt(login_attempt_key, now)
		if failed_attempts >= FAILED_LOGIN_FORGOT_PASSWORD_THRESHOLD:
			raise HTTPException(
				status_code=401,
				detail=(
					"账号或密码错误。已连续输错 5 次，是否忘记密码？"
					"可点击“忘记密码”重设。"
				),
			)
		raise HTTPException(status_code=401, detail="账号或密码错误。")

	_record_successful_login(login_attempt_key, now)
	return user


def _reset_user_password_with_email(
	session: Session,
	payload: PasswordResetRequest,
) -> UserAccount:
	user = _get_user(session, payload.user_id)
	if user is None or not verify_email(payload.email, user.email_digest):
		raise HTTPException(status_code=401, detail="用户名或邮箱不匹配。")

	user.password_digest = hash_password(payload.new_password)
	user.updated_at = utc_now()
	session.add(user)
	session.commit()
	session.refresh(user)
	return user


def _update_user_email(
	session: Session,
	current_user: UserAccount,
	payload: UserEmailUpdate,
) -> UserAccount:
	email_digest = hash_email(payload.email)
	existing_user = session.exec(
		select(UserAccount).where(UserAccount.email_digest == email_digest),
	).first()
	if existing_user is not None and existing_user.username != current_user.username:
		raise HTTPException(status_code=409, detail="该邮箱已被其他账号使用。")

	current_user.email = payload.email
	current_user.email_digest = email_digest
	current_user.updated_at = utc_now()
	session.add(current_user)
	session.commit()
	session.refresh(current_user)
	return current_user


def _require_admin_user(current_user: UserAccount) -> None:
	if current_user.username != "admin":
		raise HTTPException(status_code=403, detail="仅管理员可访问。")


def _normalize_feedback_choice(
	value: str | None,
	allowed_values: tuple[str, ...],
	fallback: str,
) -> str:
	if value is None:
		return fallback

	normalized = value.strip().upper()
	if normalized in allowed_values:
		return normalized
	return fallback


def _is_system_feedback_item(feedback: UserFeedback) -> bool:
	category = _normalize_feedback_choice(
		feedback.category,
		FEEDBACK_CATEGORIES,
		"USER_REQUEST",
	)
	source = _normalize_feedback_choice(
		feedback.source,
		FEEDBACK_SOURCES,
		"USER",
	)
	return category.startswith("SYSTEM_") or source != "USER"


def _is_user_feedback_item(feedback: UserFeedback) -> bool:
	return not _is_system_feedback_item(feedback)


def _derive_feedback_status(feedback: UserFeedback) -> str:
	if feedback.resolved_at is not None:
		return "RESOLVED"

	status = _normalize_feedback_choice(
		feedback.status,
		FEEDBACK_STATUSES,
		"OPEN",
	)
	if status == "RESOLVED":
		return "OPEN"
	if status == "ACKED":
		return "ACKED"
	if status == "IN_PROGRESS":
		return "IN_PROGRESS"
	if status == "SILENCED":
		return "SILENCED"
	if feedback.replied_at is not None:
		return "IN_PROGRESS"
	return "OPEN"


def _feedback_sort_key(feedback: UserFeedback) -> tuple[int, int, float]:
	status_rank = {
		"OPEN": 0,
		"ACKED": 1,
		"IN_PROGRESS": 2,
		"SILENCED": 3,
		"RESOLVED": 4,
	}
	priority_rank = {
		"HIGH": 0,
		"MEDIUM": 1,
		"LOW": 2,
	}
	status_value = _derive_feedback_status(feedback)
	priority_value = _normalize_feedback_choice(
		feedback.priority,
		FEEDBACK_PRIORITIES,
		"MEDIUM",
	)
	created_at = feedback.created_at
	if created_at.tzinfo is None:
		created_at = created_at.replace(tzinfo=timezone.utc)
	return (
		status_rank.get(status_value, 3),
		priority_rank.get(priority_value, 3),
		-created_at.timestamp(),
	)


def _to_feedback_read(feedback: UserFeedback) -> UserFeedbackRead:
	category = _normalize_feedback_choice(
		feedback.category,
		FEEDBACK_CATEGORIES,
		"USER_REQUEST",
	)
	priority = _normalize_feedback_choice(
		feedback.priority,
		FEEDBACK_PRIORITIES,
		"MEDIUM",
	)
	source = _normalize_feedback_choice(
		feedback.source,
		FEEDBACK_SOURCES,
		"USER",
	)
	status = _derive_feedback_status(feedback)
	return UserFeedbackRead(
		id=feedback.id or 0,
		user_id=feedback.user_id,
		message=feedback.message,
		category=category,
		priority=priority,
		source=source,
		status=status,
		is_system=_is_system_feedback_item(feedback),
		reply_message=feedback.reply_message,
		replied_at=feedback.replied_at,
		replied_by=feedback.replied_by,
		reply_seen_at=feedback.reply_seen_at,
		resolved_at=feedback.resolved_at,
		closed_by=feedback.closed_by,
		created_at=feedback.created_at,
	)


def _to_admin_feedback_read(feedback: UserFeedback) -> AdminFeedbackRead:
	base_read = _to_feedback_read(feedback)
	return AdminFeedbackRead(
		**base_read.model_dump(),
		assignee=feedback.assignee,
		acknowledged_at=feedback.acknowledged_at,
		acknowledged_by=feedback.acknowledged_by,
		ack_deadline=feedback.ack_deadline,
		internal_note=feedback.internal_note,
		internal_note_updated_at=feedback.internal_note_updated_at,
		internal_note_updated_by=feedback.internal_note_updated_by,
		fingerprint=feedback.fingerprint,
		dedupe_window_minutes=feedback.dedupe_window_minutes,
		occurrence_count=max(1, feedback.occurrence_count),
		last_seen_at=feedback.last_seen_at,
	)


def _load_hidden_message_ids(
	session: Session,
	*,
	user_id: str,
	message_kind: str,
) -> set[int]:
	if message_kind not in INBOX_MESSAGE_KINDS:
		return set()

	return {
		int(record_id)
		for record_id in session.exec(
			select(InboxMessageVisibility.message_id).where(
				InboxMessageVisibility.user_id == user_id,
				InboxMessageVisibility.message_kind == message_kind,
			),
		)
	}


def _parse_feedback_filter_values(
	raw_value: str | None,
	*,
	allowed_values: tuple[str, ...],
	field_name: str,
) -> set[str] | None:
	if raw_value is None:
		return None

	parsed_values = {
		item.strip().upper()
		for item in raw_value.split(",")
		if item.strip()
	}
	if not parsed_values:
		return None

	invalid_values = sorted(value for value in parsed_values if value not in allowed_values)
	if invalid_values:
		raise HTTPException(
			status_code=400,
			detail=(
				f"{field_name} contains invalid values: {', '.join(invalid_values)}. "
				f"Allowed: {', '.join(allowed_values)}"
			),
		)
	return parsed_values


def _apply_feedback_status_transition(
	feedback: UserFeedback,
	*,
	target_status: str,
	actor_username: str,
) -> None:
	is_system_item = _is_system_feedback_item(feedback)
	if target_status == "SILENCED" and not is_system_item:
		raise HTTPException(status_code=400, detail="仅系统工单可设置为 SILENCED。")

	now = utc_now()
	if target_status == "RESOLVED":
		if feedback.resolved_at is None:
			feedback.resolved_at = now
		feedback.closed_by = actor_username
		feedback.status = "RESOLVED"
		return

	if feedback.resolved_at is not None:
		feedback.resolved_at = None
		feedback.closed_by = None

	if target_status == "ACKED":
		feedback.acknowledged_at = now
		feedback.acknowledged_by = actor_username
	elif target_status == "OPEN":
		feedback.acknowledged_at = None
		feedback.acknowledged_by = None

	feedback.status = target_status


def _build_admin_feedback_list(
	*,
	items: list[UserFeedback],
	status_filter: set[str] | None,
	priority_filter: set[str] | None,
	page: int,
	page_size: int,
) -> AdminFeedbackListRead:
	filtered_items = items
	if status_filter is not None:
		filtered_items = [
			item for item in filtered_items if _derive_feedback_status(item) in status_filter
		]
	if priority_filter is not None:
		filtered_items = [
			item
			for item in filtered_items
			if _normalize_feedback_choice(item.priority, FEEDBACK_PRIORITIES, "MEDIUM")
			in priority_filter
		]

	sorted_items = sorted(filtered_items, key=_feedback_sort_key)
	total_items = len(sorted_items)
	offset = (page - 1) * page_size
	page_items = sorted_items[offset: offset + page_size]
	return AdminFeedbackListRead(
		items=[_to_admin_feedback_read(item) for item in page_items],
		total=total_items,
		page=page,
		page_size=page_size,
		has_more=offset + page_size < total_items,
	)


def _encode_source_feedback_ids(source_feedback_ids: list[int]) -> str | None:
	if not source_feedback_ids:
		return None

	return json.dumps(sorted(set(source_feedback_ids)), ensure_ascii=False)


def _decode_source_feedback_ids(payload: str | None) -> list[int]:
	if not payload:
		return []

	try:
		raw_value = json.loads(payload)
	except json.JSONDecodeError:
		return []

	if not isinstance(raw_value, list):
		return []

	source_feedback_ids: list[int] = []
	for item in raw_value:
		if not isinstance(item, int) or item <= 0:
			continue
		source_feedback_ids.append(item)

	return sorted(set(source_feedback_ids))


def _count_release_note_deliveries(session: Session, release_note_id: int) -> int:
	return len(
		list(
			session.exec(
				select(ReleaseNoteDelivery.id).where(
					ReleaseNoteDelivery.release_note_id == release_note_id,
				),
			),
		),
	)


def _to_release_note_read(
	session: Session,
	release_note: ReleaseNote,
) -> ReleaseNoteRead:
	return ReleaseNoteRead(
		id=release_note.id or 0,
		version=release_note.version,
		title=release_note.title,
		content=release_note.content,
		source_feedback_ids=_decode_source_feedback_ids(release_note.source_feedback_ids_json),
		created_by=release_note.created_by,
		created_at=release_note.created_at,
		published_at=release_note.published_at,
		delivery_count=_count_release_note_deliveries(session, release_note.id or 0),
	)


def _to_release_note_delivery_read(
	delivery: ReleaseNoteDelivery,
	release_note: ReleaseNote,
	*,
	title_override: str | None = None,
	content_override: str | None = None,
) -> ReleaseNoteDeliveryRead:
	return ReleaseNoteDeliveryRead(
		delivery_id=delivery.id or 0,
		release_note_id=release_note.id or 0,
		version=release_note.version,
		title=title_override if title_override is not None else release_note.title,
		content=content_override if content_override is not None else release_note.content,
		source_feedback_ids=_decode_source_feedback_ids(release_note.source_feedback_ids_json),
		delivered_at=delivery.delivered_at,
		seen_at=delivery.seen_at,
		published_at=release_note.published_at or delivery.delivered_at,
	)


def _list_published_release_notes_desc(session: Session) -> list[ReleaseNote]:
	return list(
		session.exec(
			select(ReleaseNote)
			.where(ReleaseNote.published_at.is_not(None))
			.order_by(ReleaseNote.published_at.desc(), ReleaseNote.id.desc()),
		),
	)


def _get_latest_published_release_note(session: Session) -> ReleaseNote | None:
	return session.exec(
		select(ReleaseNote)
		.where(ReleaseNote.published_at.is_not(None))
		.order_by(ReleaseNote.published_at.desc(), ReleaseNote.id.desc()),
	).first()


def _format_release_note_stream_content(release_notes: list[ReleaseNote]) -> str:
	if not release_notes:
		return ""

	sections: list[str] = []
	for release_note in release_notes:
		published_at = (release_note.published_at or release_note.created_at).astimezone(
			FEEDBACK_TIMEZONE,
		)
		source_feedback_ids = _decode_source_feedback_ids(release_note.source_feedback_ids_json)
		source_feedback_line = ""
		if source_feedback_ids:
			source_feedback_line = (
				"\n关联反馈："
				+ ", ".join(f"#{feedback_id}" for feedback_id in source_feedback_ids)
			)

		sections.append(
			"\n".join(
				[
					f"## v{release_note.version} · {published_at:%Y-%m-%d %H:%M}",
					release_note.title,
					"",
					release_note.content,
					source_feedback_line,
				],
			).strip(),
		)

	return "# 更新日志\n\n" + "\n\n---\n\n".join(sections)


def _upsert_release_note_stream_delivery(
	session: Session,
	*,
	user_id: str,
	release_note: ReleaseNote,
	reset_seen: bool,
) -> bool:
	release_note_id = release_note.id
	if release_note_id is None:
		return False

	deliveries = list(
		session.exec(
			select(ReleaseNoteDelivery)
			.where(ReleaseNoteDelivery.user_id == user_id)
			.order_by(ReleaseNoteDelivery.delivered_at.desc(), ReleaseNoteDelivery.id.desc()),
		),
	)

	target_delivered_at = release_note.published_at or utc_now()
	changed = False
	if not deliveries:
		session.add(
			ReleaseNoteDelivery(
				release_note_id=release_note_id,
				user_id=user_id,
				delivered_at=target_delivered_at,
				seen_at=None,
			),
		)
		return True

	primary_delivery = deliveries[0]
	is_new_release_for_user = primary_delivery.release_note_id != release_note_id
	if primary_delivery.release_note_id != release_note_id:
		primary_delivery.release_note_id = release_note_id
		changed = True
	if primary_delivery.delivered_at != target_delivered_at:
		primary_delivery.delivered_at = target_delivered_at
		changed = True
	if is_new_release_for_user or reset_seen:
		if primary_delivery.seen_at is not None:
			primary_delivery.seen_at = None
			changed = True
	session.add(primary_delivery)

	for stale_delivery in deliveries[1:]:
		session.delete(stale_delivery)
		changed = True

	return changed


def _ensure_release_note_deliveries_for_user(session: Session, user_id: str) -> None:
	latest_release_note = _get_latest_published_release_note(session)
	if latest_release_note is None:
		return

	if _upsert_release_note_stream_delivery(
		session,
		user_id=user_id,
		release_note=latest_release_note,
		reset_seen=False,
	):
		session.commit()


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


def _to_asset_mutation_audit_read(audit: AssetMutationAudit) -> AssetMutationAuditRead:
	return AssetMutationAuditRead(
		id=audit.id or 0,
		entity_type=audit.entity_type,
		entity_id=audit.entity_id,
		operation=audit.operation,
		before_state=audit.before_state,
		after_state=audit.after_state,
		reason=audit.reason,
		created_at=audit.created_at,
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

	return AuthSessionRead(user_id=user.username, email=user.email)


@app.post("/api/auth/register", response_model=AuthSessionRead, status_code=201)
def register_user(
	request: Request,
	payload: AuthRegisterCredentials,
	_: TokenDependency,
	session: SessionDependency,
) -> AuthSessionRead:
	user = _create_user_account(session, payload)
	request.session["user_id"] = user.username
	return AuthSessionRead(user_id=user.username, email=user.email)


@app.post("/api/auth/login", response_model=AuthSessionRead)
def login_user(
	request: Request,
	payload: AuthLoginCredentials,
	_: TokenDependency,
	session: SessionDependency,
) -> AuthSessionRead:
	attempt_key = _build_login_attempt_key(request, payload.user_id)
	user = _authenticate_user_account(
		session,
		payload,
		attempt_key=attempt_key,
	)
	request.session["user_id"] = user.username
	return AuthSessionRead(user_id=user.username, email=user.email)


@app.post("/api/auth/reset-password", response_model=ActionMessageRead)
def reset_password_with_email(
	payload: PasswordResetRequest,
	_: TokenDependency,
	session: SessionDependency,
) -> ActionMessageRead:
	_reset_user_password_with_email(session, payload)
	return ActionMessageRead(message="密码已重置，请使用新密码登录。")


@app.patch("/api/auth/email", response_model=AuthSessionRead)
def update_user_email(
	request: Request,
	payload: UserEmailUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> AuthSessionRead:
	user = _update_user_email(session, current_user, payload)
	request.session["user_id"] = user.username
	return AuthSessionRead(user_id=user.username, email=user.email)


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
	requested_category = _normalize_feedback_choice(
		payload.category,
		FEEDBACK_CATEGORIES,
		"USER_REQUEST",
	) if payload.category is not None else None
	requested_priority = _normalize_feedback_choice(
		payload.priority,
		FEEDBACK_PRIORITIES,
		"MEDIUM",
	) if payload.priority is not None else None
	requested_source = _normalize_feedback_choice(
		payload.source,
		FEEDBACK_SOURCES,
		"USER",
	) if payload.source is not None else None
	requested_fingerprint = (payload.fingerprint or "").strip() or None
	requested_dedupe_window_minutes = payload.dedupe_window_minutes

	if current_user.username == "admin":
		category = requested_category
		source = requested_source

		if category is None:
			if source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}:
				category = "SYSTEM_TASK"
			else:
				category = "USER_REQUEST"

		if source is None:
			source = "SYSTEM" if category.startswith("SYSTEM_") else "ADMIN"

		if category == "USER_REQUEST" and source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}:
			category = "SYSTEM_TASK"

		default_priority = "MEDIUM"
		if category == "SYSTEM_ALERT":
			default_priority = "HIGH"
		elif category == "SYSTEM_HEARTBEAT":
			default_priority = "LOW"
		priority = requested_priority or default_priority
	else:
		category = "USER_REQUEST"
		priority = "MEDIUM"
		source = "USER"
		requested_fingerprint = None
		requested_dedupe_window_minutes = None

	if source == "USER":
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

	now = utc_now()
	if (
		current_user.username == "admin"
		and source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}
		and requested_fingerprint is not None
		and requested_dedupe_window_minutes is not None
	):
		window_start = now - timedelta(minutes=requested_dedupe_window_minutes)
		existing_feedback = session.exec(
			select(UserFeedback)
			.where(
				UserFeedback.user_id == current_user.username,
				UserFeedback.source == source,
				UserFeedback.category == category,
				UserFeedback.fingerprint == requested_fingerprint,
				UserFeedback.created_at >= window_start,
			)
			.order_by(UserFeedback.created_at.desc(), UserFeedback.id.desc()),
		).first()
		if existing_feedback is not None:
			existing_feedback.occurrence_count = max(1, existing_feedback.occurrence_count) + 1
			existing_feedback.last_seen_at = now
			if existing_feedback.resolved_at is not None and _is_system_feedback_item(existing_feedback):
				existing_feedback.resolved_at = None
				existing_feedback.closed_by = None
				existing_feedback.status = "OPEN"
			session.add(existing_feedback)
			session.commit()
			session.refresh(existing_feedback)
			return _to_feedback_read(existing_feedback)

	auto_resolve = (
		category == "SYSTEM_HEARTBEAT"
		and priority == "LOW"
		and source in {"SYSTEM", "API_MONITOR", "TRADING_AGENT"}
	)
	feedback = UserFeedback(
		user_id=current_user.username,
		message=payload.message,
		category=category,
		priority=priority,
		source=source,
		status="RESOLVED" if auto_resolve else "OPEN",
		resolved_at=now if auto_resolve else None,
		closed_by="system-auto" if auto_resolve else None,
		fingerprint=requested_fingerprint,
		dedupe_window_minutes=requested_dedupe_window_minutes,
		occurrence_count=1,
		last_seen_at=now,
	)
	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return _to_feedback_read(feedback)


@app.get("/api/feedback", response_model=list[UserFeedbackRead])
def list_feedback_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[UserFeedbackRead]:
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = list(
		session.exec(
			select(UserFeedback)
			.where(UserFeedback.user_id == current_user.username)
			.order_by(UserFeedback.created_at.desc()),
		),
	)
	visible_feedback_items = [
		feedback for feedback in feedback_items if (feedback.id or 0) not in hidden_feedback_ids
	]
	return [_to_feedback_read(feedback) for feedback in visible_feedback_items]


@app.post("/api/feedback/mark-seen", response_model=ActionMessageRead)
def mark_feedback_seen_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = list(
		session.exec(
			select(UserFeedback).where(
				UserFeedback.user_id == current_user.username,
				UserFeedback.replied_at.is_not(None),
				UserFeedback.reply_seen_at.is_(None),
			),
		),
	)
	feedback_items = [
		item for item in feedback_items if (item.id or 0) not in hidden_feedback_ids
	]
	if not feedback_items:
		return ActionMessageRead(message="没有新的回复。")

	now = utc_now()
	for feedback in feedback_items:
		feedback.reply_seen_at = now
		session.add(feedback)

	session.commit()
	return ActionMessageRead(message="消息已标记为已读。")


@app.get("/api/feedback/summary", response_model=FeedbackSummaryRead)
def get_feedback_summary(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> FeedbackSummaryRead:
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	if current_user.username == "admin":
		inbox_count = len(
			[
				feedback_id
				for feedback_id in session.exec(
					select(UserFeedback.id).where(UserFeedback.resolved_at.is_(None)),
				)
				if int(feedback_id) not in hidden_feedback_ids
			],
		)
		return FeedbackSummaryRead(inbox_count=inbox_count, mode="admin-open")

	_ensure_release_note_deliveries_for_user(session, current_user.username)
	hidden_release_note_delivery_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="RELEASE_NOTE",
	)
	feedback_unread_count = len(
		[
			feedback_id
			for feedback_id in session.exec(
				select(UserFeedback.id).where(
					UserFeedback.user_id == current_user.username,
					UserFeedback.replied_at.is_not(None),
					UserFeedback.reply_seen_at.is_(None),
				),
			)
			if int(feedback_id) not in hidden_feedback_ids
		],
	)
	release_note_unread_count = 1 if any(
		int(delivery_id) not in hidden_release_note_delivery_ids
		for delivery_id in session.exec(
			select(ReleaseNoteDelivery.id).where(
				ReleaseNoteDelivery.user_id == current_user.username,
				ReleaseNoteDelivery.seen_at.is_(None),
			),
		)
	) else 0
	return FeedbackSummaryRead(
		inbox_count=feedback_unread_count + release_note_unread_count,
		mode="user-unread",
	)


@app.post("/api/messages/hide", response_model=ActionMessageRead)
def hide_inbox_message_for_current_user(
	payload: InboxMessageHideCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	message_kind = payload.message_kind
	message_id = payload.message_id

	if message_kind == "FEEDBACK":
		feedback = session.get(UserFeedback, message_id)
		if feedback is None:
			raise HTTPException(status_code=404, detail="消息不存在。")
		if current_user.username != "admin" and feedback.user_id != current_user.username:
			raise HTTPException(status_code=403, detail="无权移除该消息。")
	elif message_kind == "RELEASE_NOTE":
		delivery = session.get(ReleaseNoteDelivery, message_id)
		if delivery is None:
			raise HTTPException(status_code=404, detail="消息不存在。")
		if delivery.user_id != current_user.username:
			raise HTTPException(status_code=403, detail="无权移除该消息。")
	else:
		raise HTTPException(status_code=400, detail="message_kind 无效。")

	existing_visibility = session.exec(
		select(InboxMessageVisibility).where(
			InboxMessageVisibility.user_id == current_user.username,
			InboxMessageVisibility.message_kind == message_kind,
			InboxMessageVisibility.message_id == message_id,
		),
	).first()
	if existing_visibility is not None:
		return ActionMessageRead(message="消息已从当前列表移除。")

	visibility = InboxMessageVisibility(
		user_id=current_user.username,
		message_kind=message_kind,
		message_id=message_id,
	)
	session.add(visibility)
	session.commit()
	return ActionMessageRead(message="消息已从当前列表移除。")


@app.get("/api/admin/feedback", response_model=list[UserFeedbackRead])
def list_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[UserFeedbackRead]:
	_require_admin_user(current_user)
	feedback_items = list(session.exec(select(UserFeedback)))
	feedback_items = sorted(feedback_items, key=_feedback_sort_key)
	return [
		_to_feedback_read(feedback)
		for feedback in feedback_items
	]


@app.get("/api/admin/feedback/user", response_model=AdminFeedbackListRead)
def list_user_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=50, ge=1, le=200),
	status: str | None = Query(default=None),
	priority: str | None = Query(default=None),
) -> AdminFeedbackListRead:
	_require_admin_user(current_user)
	status_filter = _parse_feedback_filter_values(
		status,
		allowed_values=FEEDBACK_STATUSES,
		field_name="status",
	)
	priority_filter = _parse_feedback_filter_values(
		priority,
		allowed_values=FEEDBACK_PRIORITIES,
		field_name="priority",
	)
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = [
		feedback
		for feedback in session.exec(select(UserFeedback))
		if _is_user_feedback_item(feedback) and (feedback.id or 0) not in hidden_feedback_ids
	]
	return _build_admin_feedback_list(
		items=feedback_items,
		status_filter=status_filter,
		priority_filter=priority_filter,
		page=page,
		page_size=page_size,
	)


@app.get("/api/admin/feedback/system", response_model=AdminFeedbackListRead)
def list_system_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
	page: int = Query(default=1, ge=1),
	page_size: int = Query(default=50, ge=1, le=200),
	status: str | None = Query(default=None),
	priority: str | None = Query(default=None),
) -> AdminFeedbackListRead:
	_require_admin_user(current_user)
	status_filter = _parse_feedback_filter_values(
		status,
		allowed_values=FEEDBACK_STATUSES,
		field_name="status",
	)
	priority_filter = _parse_feedback_filter_values(
		priority,
		allowed_values=FEEDBACK_PRIORITIES,
		field_name="priority",
	)
	hidden_feedback_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="FEEDBACK",
	)
	feedback_items = [
		feedback
		for feedback in session.exec(select(UserFeedback))
		if _is_system_feedback_item(feedback) and (feedback.id or 0) not in hidden_feedback_ids
	]
	return _build_admin_feedback_list(
		items=feedback_items,
		status_filter=status_filter,
		priority_filter=priority_filter,
		page=page,
		page_size=page_size,
	)


@app.post("/api/admin/feedback/{feedback_id}/reply", response_model=AdminFeedbackRead)
def reply_to_feedback_for_admin(
	feedback_id: int,
	payload: AdminFeedbackReplyUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> UserFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")
	if _is_system_feedback_item(feedback):
		raise HTTPException(
			status_code=400,
			detail="系统工单无需回复，请直接关闭或调整状态。",
		)

	now = utc_now()
	feedback.reply_message = payload.reply_message
	feedback.replied_at = now
	feedback.replied_by = current_user.username
	feedback.reply_seen_at = None
	if payload.close and feedback.resolved_at is None:
		feedback.resolved_at = now
		feedback.closed_by = current_user.username
		feedback.status = "RESOLVED"
	else:
		feedback.status = "IN_PROGRESS"
	session.add(feedback)
	session.commit()
	session.refresh(feedback)

	return _to_admin_feedback_read(feedback)


@app.post("/api/admin/feedback/{feedback_id}/close", response_model=AdminFeedbackRead)
def close_feedback_for_admin(
	feedback_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> UserFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")

	if feedback.resolved_at is None:
		feedback.resolved_at = utc_now()
		feedback.closed_by = current_user.username
		feedback.status = "RESOLVED"
		session.add(feedback)
		session.commit()
		session.refresh(feedback)

	return _to_admin_feedback_read(feedback)


@app.post("/api/admin/feedback/{feedback_id}/ack", response_model=AdminFeedbackRead)
def acknowledge_feedback_for_admin(
	feedback_id: int,
	payload: AdminFeedbackAcknowledgeUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> AdminFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")
	if feedback.resolved_at is not None:
		raise HTTPException(status_code=400, detail="已关闭工单无法确认。")

	feedback.status = "ACKED"
	feedback.acknowledged_at = utc_now()
	feedback.acknowledged_by = current_user.username
	if "assignee" in payload.model_fields_set:
		feedback.assignee = payload.assignee
	if "ack_deadline" in payload.model_fields_set:
		feedback.ack_deadline = payload.ack_deadline
	if "internal_note" in payload.model_fields_set:
		feedback.internal_note = payload.internal_note
		feedback.internal_note_updated_at = utc_now()
		feedback.internal_note_updated_by = current_user.username
	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return _to_admin_feedback_read(feedback)


@app.post("/api/admin/feedback/{feedback_id}/classify", response_model=AdminFeedbackRead)
def classify_feedback_for_admin(
	feedback_id: int,
	payload: AdminFeedbackClassifyUpdate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> UserFeedbackRead:
	_require_admin_user(current_user)
	feedback = session.get(UserFeedback, feedback_id)
	if feedback is None:
		raise HTTPException(status_code=404, detail="反馈不存在。")

	if "category" in payload.model_fields_set:
		feedback.category = payload.category
	if "priority" in payload.model_fields_set:
		feedback.priority = payload.priority
	if "source" in payload.model_fields_set:
		feedback.source = payload.source
	if "status" in payload.model_fields_set:
		_apply_feedback_status_transition(
			feedback,
			target_status=payload.status or "OPEN",
			actor_username=current_user.username,
		)
	if "assignee" in payload.model_fields_set:
		feedback.assignee = payload.assignee
	if "ack_deadline" in payload.model_fields_set:
		feedback.ack_deadline = payload.ack_deadline
	if "internal_note" in payload.model_fields_set:
		feedback.internal_note = payload.internal_note
		feedback.internal_note_updated_at = utc_now()
		feedback.internal_note_updated_by = current_user.username

	session.add(feedback)
	session.commit()
	session.refresh(feedback)
	return _to_admin_feedback_read(feedback)


@app.get("/api/admin/release-notes", response_model=list[ReleaseNoteRead])
def list_release_notes_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[ReleaseNoteRead]:
	_require_admin_user(current_user)
	release_notes = list(
		session.exec(
			select(ReleaseNote).order_by(ReleaseNote.created_at.desc()),
		),
	)
	return [_to_release_note_read(session, release_note) for release_note in release_notes]


@app.post("/api/admin/release-notes", response_model=ReleaseNoteRead, status_code=201)
def create_release_note_for_admin(
	payload: ReleaseNoteCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ReleaseNoteRead:
	_require_admin_user(current_user)
	existing_release_note = session.exec(
		select(ReleaseNote).where(ReleaseNote.version == payload.version),
	).first()
	if existing_release_note is not None:
		raise HTTPException(status_code=409, detail="该版本号已存在。")

	release_note = ReleaseNote(
		version=payload.version,
		title=payload.title,
		content=payload.content,
		source_feedback_ids_json=_encode_source_feedback_ids(payload.source_feedback_ids),
		created_by=current_user.username,
	)
	session.add(release_note)
	session.commit()
	session.refresh(release_note)
	return _to_release_note_read(session, release_note)


@app.get("/api/release-notes", response_model=list[ReleaseNoteDeliveryRead])
def list_release_notes_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[ReleaseNoteDeliveryRead]:
	_ensure_release_note_deliveries_for_user(session, current_user.username)
	hidden_delivery_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="RELEASE_NOTE",
	)
	rows = list(
		session.exec(
		select(ReleaseNoteDelivery, ReleaseNote)
		.join(ReleaseNote, ReleaseNote.id == ReleaseNoteDelivery.release_note_id)
		.where(
			ReleaseNoteDelivery.user_id == current_user.username,
			ReleaseNote.published_at.is_not(None),
		)
		.order_by(ReleaseNoteDelivery.delivered_at.desc(), ReleaseNoteDelivery.id.desc()),
	),
	)
	if not rows:
		return []

	visible_row = next(
		(
			(delivery, release_note)
			for delivery, release_note in rows
			if (delivery.id or 0) not in hidden_delivery_ids
		),
		None,
	)
	if visible_row is None:
		return []
	delivery, latest_release_note = visible_row
	stream_content = _format_release_note_stream_content(_list_published_release_notes_desc(session))
	return [
		_to_release_note_delivery_read(
			delivery,
			latest_release_note,
			title_override="产品更新日志（持续更新）",
			content_override=stream_content,
		),
	]


@app.post("/api/release-notes/mark-seen", response_model=ActionMessageRead)
def mark_release_notes_seen_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	_ensure_release_note_deliveries_for_user(session, current_user.username)
	hidden_delivery_ids = _load_hidden_message_ids(
		session,
		user_id=current_user.username,
		message_kind="RELEASE_NOTE",
	)
	pending_items = list(
		session.exec(
			select(ReleaseNoteDelivery).where(
				ReleaseNoteDelivery.user_id == current_user.username,
				ReleaseNoteDelivery.seen_at.is_(None),
			),
		),
	)
	pending_items = [
		item for item in pending_items if (item.id or 0) not in hidden_delivery_ids
	]
	if not pending_items:
		return ActionMessageRead(message="没有新的更新日志。")

	now = utc_now()
	for delivery in pending_items:
		delivery.seen_at = now
		session.add(delivery)

	session.commit()
	return ActionMessageRead(message="更新日志已标记为已读。")


@app.post("/api/admin/release-notes/{release_note_id}/publish", response_model=ReleaseNoteRead)
def publish_release_note_for_admin(
	release_note_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ReleaseNoteRead:
	_require_admin_user(current_user)
	release_note = session.get(ReleaseNote, release_note_id)
	if release_note is None:
		raise HTTPException(status_code=404, detail="更新日志不存在。")

	if release_note.published_at is None:
		release_note.published_at = utc_now()
		session.add(release_note)
		session.commit()
		session.refresh(release_note)

	recipient_ids = list(
		session.exec(
			select(UserAccount.username).where(UserAccount.username != current_user.username),
		),
	)
	updated_delivery = False
	for recipient_id in recipient_ids:
		if _upsert_release_note_stream_delivery(
			session,
			user_id=recipient_id,
			release_note=release_note,
			reset_seen=True,
		):
			updated_delivery = True

	if updated_delivery:
		session.commit()

	return _to_release_note_read(session, release_note)


@app.post("/api/dashboard/corrections", response_model=DashboardCorrectionRead, status_code=201)
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


@app.get("/api/dashboard/corrections", response_model=list[DashboardCorrectionRead])
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


@app.delete("/api/dashboard/corrections/{correction_id}", status_code=204)
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


@app.get("/api/audit-log", response_model=list[AssetMutationAuditRead])
def list_asset_mutation_audits(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	limit: int = 200,
) -> list[AssetMutationAuditRead]:
	clamped_limit = max(1, min(limit, 500))
	rows = list(
		session.exec(
			select(AssetMutationAudit)
			.where(AssetMutationAudit.user_id == current_user.username)
			.order_by(AssetMutationAudit.created_at.desc())
			.limit(clamped_limit),
		),
	)
	return [_to_asset_mutation_audit_read(row) for row in rows]


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
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="CASH_ACCOUNT",
		entity_id=account.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(account),
	)
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

	before_state = _capture_model_state(account)
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
	_record_asset_mutation(
		session,
		current_user,
		entity_type="CASH_ACCOUNT",
		entity_id=account.id,
		operation="UPDATE",
		before_state=before_state,
		after_state=_capture_model_state(account),
	)
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

	before_state = _capture_model_state(account)
	session.delete(account)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="CASH_ACCOUNT",
		entity_id=account_id,
		operation="DELETE",
		before_state=before_state,
		after_state=None,
	)
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
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="FIXED_ASSET",
		entity_id=asset.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(asset),
	)
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

	before_state = _capture_model_state(asset)
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
	_record_asset_mutation(
		session,
		current_user,
		entity_type="FIXED_ASSET",
		entity_id=asset.id,
		operation="UPDATE",
		before_state=before_state,
		after_state=_capture_model_state(asset),
	)
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

	before_state = _capture_model_state(asset)
	session.delete(asset)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="FIXED_ASSET",
		entity_id=asset_id,
		operation="DELETE",
		before_state=before_state,
		after_state=None,
	)
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
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="LIABILITY",
		entity_id=entry.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(entry),
	)
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

	before_state = _capture_model_state(entry)
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
	_record_asset_mutation(
		session,
		current_user,
		entity_type="LIABILITY",
		entity_id=entry.id,
		operation="UPDATE",
		before_state=before_state,
		after_state=_capture_model_state(entry),
	)
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

	before_state = _capture_model_state(entry)
	session.delete(entry)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="LIABILITY",
		entity_id=entry_id,
		operation="DELETE",
		before_state=before_state,
		after_state=None,
	)
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
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="OTHER_ASSET",
		entity_id=asset.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(asset),
	)
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

	before_state = _capture_model_state(asset)
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
	_record_asset_mutation(
		session,
		current_user,
		entity_type="OTHER_ASSET",
		entity_id=asset.id,
		operation="UPDATE",
		before_state=before_state,
		after_state=_capture_model_state(asset),
	)
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

	before_state = _capture_model_state(asset)
	session.delete(asset)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="OTHER_ASSET",
		entity_id=asset_id,
		operation="DELETE",
		before_state=before_state,
		after_state=None,
	)
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


def create_holding(
	payload: SecurityHoldingCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> SecurityHoldingRead:
	_ensure_date_not_future(payload.started_on, field_label="持仓日")
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
	session.flush()
	_reset_holding_transactions_from_snapshot(
		session,
		holding=holding,
	)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING",
		entity_id=holding.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(holding),
	)
	_enqueue_holding_history_sync_request(
		session,
		user_id=current_user.username,
		trigger_symbol=holding.symbol,
	)
	session.commit()
	session.refresh(holding)
	_invalidate_dashboard_cache(current_user.username)
	return _to_holding_read(holding)


@app.post("/api/holdings", status_code=410)
def create_holding_legacy_endpoint(
	_: SecurityHoldingCreate,
	__: CurrentUserDependency,
) -> Response:
	raise HTTPException(
		status_code=410,
		detail="持仓新增接口已停用，请改用 /api/holding-transactions 提交买入/卖出。",
	)


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

	previous_symbol = holding.symbol
	previous_market = holding.market
	before_state = _capture_model_state(holding)
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
		_ensure_date_not_future(payload.started_on, field_label="持仓日")
		holding.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		holding.note = _normalize_optional_text(payload.note)
	_touch_model(holding)
	session.add(holding)
	if previous_symbol != holding.symbol or previous_market != holding.market:
		_delete_holding_transactions_for_symbol(
			session,
			user_id=current_user.username,
			symbol=previous_symbol,
			market=previous_market,
		)
	_reset_holding_transactions_from_snapshot(
		session,
		holding=holding,
	)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING",
		entity_id=holding.id,
		operation="UPDATE",
		before_state=before_state,
		after_state=_capture_model_state(holding),
	)
	_enqueue_holding_history_sync_request(
		session,
		user_id=current_user.username,
		trigger_symbol=holding.symbol,
	)
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

	before_state = _capture_model_state(holding)
	_delete_holding_transactions_for_symbol(
		session,
		user_id=current_user.username,
		symbol=holding.symbol,
		market=holding.market,
	)
	session.delete(holding)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING",
		entity_id=holding_id,
		operation="DELETE",
		before_state=before_state,
		after_state=None,
	)
	_enqueue_holding_history_sync_request(
		session,
		user_id=current_user.username,
		trigger_symbol=holding.symbol,
	)
	session.commit()
	_invalidate_dashboard_cache(current_user.username)
	return Response(status_code=204)


@app.get(
	"/api/holdings/{holding_id}/transactions",
	response_model=list[SecurityHoldingTransactionRead],
)
def list_holding_transactions(
	holding_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> list[SecurityHoldingTransactionRead]:
	holding = session.get(SecurityHolding, holding_id)
	if holding is None or holding.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Holding not found.")

	_ensure_transaction_baseline_from_holding_snapshot(
		session,
		holding=holding,
	)
	transactions = list(
		session.exec(
			select(SecurityHoldingTransaction)
			.where(SecurityHoldingTransaction.user_id == current_user.username)
			.where(SecurityHoldingTransaction.symbol == holding.symbol)
			.where(SecurityHoldingTransaction.market == holding.market)
			.order_by(
				SecurityHoldingTransaction.traded_on.desc(),
				SecurityHoldingTransaction.created_at.desc(),
				SecurityHoldingTransaction.id.desc(),
			),
		),
	)
	return [_to_holding_transaction_read(item) for item in transactions]


@app.post(
	"/api/holding-transactions",
	response_model=HoldingTransactionApplyRead,
	status_code=201,
)
def create_holding_transaction(
	payload: SecurityHoldingTransactionCreate,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> HoldingTransactionApplyRead:
	_ensure_date_not_future(payload.traded_on, field_label="交易日")
	side = _normalize_holding_transaction_side(payload.side)
	if side not in {"BUY", "SELL"}:
		raise HTTPException(status_code=422, detail="只允许新增买入或卖出交易。")

	normalized_market = payload.market
	normalized_symbol = _normalize_symbol(payload.symbol, normalized_market)
	normalized_currency = _normalize_currency(payload.fallback_currency)
	normalized_broker = _normalize_optional_text(payload.broker)
	normalized_note = _normalize_optional_text(payload.note)
	normalized_name = payload.name.strip()

	existing_holdings = _list_holdings_for_symbol(
		session,
		user_id=current_user.username,
		symbol=normalized_symbol,
		market=normalized_market,
	)
	for holding in existing_holdings:
		_ensure_transaction_baseline_from_holding_snapshot(
			session,
			holding=holding,
		)

	execution_price = payload.price if payload.price and payload.price > 0 else None
	execution_currency = normalized_currency
	if side == "SELL":
		projected_before = _project_holding_state_from_transactions(
			session,
			user_id=current_user.username,
			symbol=normalized_symbol,
			market=normalized_market,
		)
		available_quantity = (
			_projected_holding_quantity(projected_before)
			if projected_before is not None
			else 0.0
		)
		if available_quantity + HOLDING_QUANTITY_EPSILON < payload.quantity:
			raise HTTPException(
				status_code=422,
				detail=(
					f"{normalized_symbol} 可卖数量不足。当前可卖 "
					f"{available_quantity:g}，请求卖出 {payload.quantity:g}。"
				),
			)
		execution_price, execution_currency = _resolve_sell_execution_price_and_currency(
			symbol=normalized_symbol,
			market=normalized_market,
			fallback_currency=normalized_currency,
			payload_price=payload.price,
		)

	transaction = SecurityHoldingTransaction(
		user_id=current_user.username,
		symbol=normalized_symbol,
		name=normalized_name,
		side=side,
		quantity=payload.quantity,
		price=execution_price,
		fallback_currency=execution_currency,
		market=normalized_market,
		broker=normalized_broker,
		traded_on=payload.traded_on,
		note=normalized_note,
	)
	session.add(transaction)
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING_TRANSACTION",
		entity_id=transaction.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(transaction),
	)

	holding = _sync_holding_projection_for_symbol(
		session,
		user_id=current_user.username,
		symbol=normalized_symbol,
		market=normalized_market,
	)
	if side == "SELL" and execution_price is not None:
		_create_auto_cash_account_from_sell(
			session,
			current_user=current_user,
			symbol=normalized_symbol,
			name=normalized_name,
			market=normalized_market,
			quantity=payload.quantity,
			execution_price=execution_price,
			currency=execution_currency,
			traded_on=payload.traded_on,
			transaction_id=transaction.id,
		)
	_enqueue_holding_history_sync_request(
		session,
		user_id=current_user.username,
		trigger_symbol=normalized_symbol,
	)
	session.commit()
	session.refresh(transaction)
	if holding is not None:
		session.refresh(holding)
	_invalidate_dashboard_cache(current_user.username)

	return HoldingTransactionApplyRead(
		transaction=_to_holding_transaction_read(transaction),
		holding=_to_holding_read(holding) if holding is not None else None,
	)


@app.delete("/api/holding-transactions/{transaction_id}", status_code=204)
def delete_holding_transaction(
	transaction_id: int,
	current_user: CurrentUserDependency,
	session: SessionDependency,
) -> Response:
	transaction = session.get(SecurityHoldingTransaction, transaction_id)
	if transaction is None or transaction.user_id != current_user.username:
		raise HTTPException(status_code=404, detail="Holding transaction not found.")

	before_state = _capture_model_state(transaction)
	symbol = transaction.symbol
	market = transaction.market
	session.delete(transaction)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING_TRANSACTION",
		entity_id=transaction_id,
		operation="DELETE",
		before_state=before_state,
		after_state=None,
	)
	_sync_holding_projection_for_symbol(
		session,
		user_id=current_user.username,
		symbol=symbol,
		market=market,
	)
	_enqueue_holding_history_sync_request(
		session,
		user_id=current_user.username,
		trigger_symbol=symbol,
	)
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
		await _process_pending_holding_history_sync_requests(
			session,
			limit=1,
			user_id=current_user.username,
		)
		if await _consume_global_force_refresh_slot():
			market_data_client.clear_runtime_caches()
		_invalidate_dashboard_cache(current_user.username)
		return await _get_cached_dashboard(session, current_user, force_refresh=True)

	return await _get_cached_dashboard(session, current_user)
