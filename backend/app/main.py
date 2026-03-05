from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import json
import logging
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlmodel import Session, select
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.analytics import bucket_start_utc, build_return_timeline, build_timeline
from app.database import engine, get_session, init_db
from app.models import (
	ASSET_MUTATION_OPERATIONS,
	CashAccount,
	DashboardCorrection,
	FixedAsset,
	HoldingPerformanceSnapshot,
	LiabilityEntry,
	OtherAsset,
	PortfolioSnapshot,
	ReleaseNote,
	ReleaseNoteDelivery,
	SecurityHolding,
	AssetMutationAudit,
	UserFeedback,
	UserAccount,
	utc_now,
)
from app.schemas import (
	ActionMessageRead,
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
global_force_refresh_lock = asyncio.Lock()
last_global_force_refresh_at: datetime | None = None
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
	model: CashAccount | SecurityHolding | FixedAsset | LiabilityEntry | OtherAsset,
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
			UserAccount.__table__.name,
			{
				"email": "TEXT",
				"email_digest": "TEXT",
			},
		),
		(
			UserFeedback.__table__.name,
			{
				"reply_message": "TEXT",
				"replied_at": "TEXT",
				"replied_by": "TEXT",
				"reply_seen_at": "TEXT",
				"resolved_at": "TEXT",
				"closed_by": "TEXT",
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


def _authenticate_user_account(
	session: Session,
	credentials: AuthLoginCredentials,
) -> UserAccount:
	user = _get_user(session, credentials.user_id)
	if user is None or not verify_password(credentials.password, user.password_digest):
		raise HTTPException(status_code=401, detail="账号或密码错误。")
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


def _to_feedback_read(feedback: UserFeedback) -> UserFeedbackRead:
	return UserFeedbackRead(
		id=feedback.id or 0,
		user_id=feedback.user_id,
		message=feedback.message,
		reply_message=feedback.reply_message,
		replied_at=feedback.replied_at,
		replied_by=feedback.replied_by,
		reply_seen_at=feedback.reply_seen_at,
		resolved_at=feedback.resolved_at,
		closed_by=feedback.closed_by,
		created_at=feedback.created_at,
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
) -> ReleaseNoteDeliveryRead:
	return ReleaseNoteDeliveryRead(
		delivery_id=delivery.id or 0,
		release_note_id=release_note.id or 0,
		version=release_note.version,
		title=release_note.title,
		content=release_note.content,
		source_feedback_ids=_decode_source_feedback_ids(release_note.source_feedback_ids_json),
		delivered_at=delivery.delivered_at,
		seen_at=delivery.seen_at,
		published_at=release_note.published_at or delivery.delivered_at,
	)


def _ensure_release_note_deliveries_for_user(session: Session, user_id: str) -> None:
	published_notes = list(
		session.exec(
			select(ReleaseNote).where(ReleaseNote.published_at.is_not(None)),
		),
	)
	if not published_notes:
		return

	delivered_release_note_ids = set(
		session.exec(
			select(ReleaseNoteDelivery.release_note_id).where(
				ReleaseNoteDelivery.user_id == user_id,
			),
		).all(),
	)
	created_new_delivery = False
	for release_note in published_notes:
		release_note_id = release_note.id
		if release_note_id is None or release_note_id in delivered_release_note_ids:
			continue

		session.add(
			ReleaseNoteDelivery(
				release_note_id=release_note_id,
				user_id=user_id,
				delivered_at=release_note.published_at or utc_now(),
			),
		)
		created_new_delivery = True

	if created_new_delivery:
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
	user = _authenticate_user_account(session, payload)
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
	return _to_feedback_read(feedback)


@app.get("/api/feedback", response_model=list[UserFeedbackRead])
def list_feedback_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[UserFeedbackRead]:
	feedback_items = list(
		session.exec(
			select(UserFeedback)
			.where(UserFeedback.user_id == current_user.username)
			.order_by(UserFeedback.created_at.desc()),
		),
	)
	return [_to_feedback_read(feedback) for feedback in feedback_items]


@app.post("/api/feedback/mark-seen", response_model=ActionMessageRead)
def mark_feedback_seen_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	feedback_items = list(
		session.exec(
			select(UserFeedback).where(
				UserFeedback.user_id == current_user.username,
				UserFeedback.replied_at.is_not(None),
				UserFeedback.reply_seen_at.is_(None),
			),
		),
	)
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
	if current_user.username == "admin":
		inbox_count = len(
			list(
				session.exec(
					select(UserFeedback.id).where(UserFeedback.resolved_at.is_(None)),
				),
			),
		)
		return FeedbackSummaryRead(inbox_count=inbox_count, mode="admin-open")

	_ensure_release_note_deliveries_for_user(session, current_user.username)
	feedback_unread_count = len(
		list(
			session.exec(
				select(UserFeedback.id).where(
					UserFeedback.user_id == current_user.username,
					UserFeedback.replied_at.is_not(None),
					UserFeedback.reply_seen_at.is_(None),
				),
			),
		),
	)
	release_note_unread_count = len(
		list(
			session.exec(
				select(ReleaseNoteDelivery.id).where(
					ReleaseNoteDelivery.user_id == current_user.username,
					ReleaseNoteDelivery.seen_at.is_(None),
				),
			),
		),
	)
	return FeedbackSummaryRead(
		inbox_count=feedback_unread_count + release_note_unread_count,
		mode="user-unread",
	)


@app.get("/api/admin/feedback", response_model=list[UserFeedbackRead])
def list_feedback_for_admin(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[UserFeedbackRead]:
	_require_admin_user(current_user)
	feedback_items = list(
		session.exec(
			select(UserFeedback).order_by(
				UserFeedback.resolved_at.is_not(None),
				UserFeedback.created_at.desc(),
			),
		),
	)
	return [
		_to_feedback_read(feedback)
		for feedback in feedback_items
	]


@app.post("/api/admin/feedback/{feedback_id}/reply", response_model=UserFeedbackRead)
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

	feedback.reply_message = payload.reply_message
	feedback.replied_at = utc_now()
	feedback.replied_by = current_user.username
	feedback.reply_seen_at = None
	if payload.close and feedback.resolved_at is None:
		feedback.resolved_at = utc_now()
		feedback.closed_by = current_user.username
	session.add(feedback)
	session.commit()
	session.refresh(feedback)

	return _to_feedback_read(feedback)


@app.post("/api/admin/feedback/{feedback_id}/close", response_model=UserFeedbackRead)
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
		session.add(feedback)
		session.commit()
		session.refresh(feedback)

	return _to_feedback_read(feedback)


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

	existing_recipients = set(
		session.exec(
			select(ReleaseNoteDelivery.user_id).where(
				ReleaseNoteDelivery.release_note_id == release_note_id,
			),
		).all(),
	)
	recipient_ids = list(
		session.exec(
			select(UserAccount.username).where(UserAccount.username != current_user.username),
		),
	)
	created_new_delivery = False
	for recipient_id in recipient_ids:
		if recipient_id in existing_recipients:
			continue
		session.add(
			ReleaseNoteDelivery(
				release_note_id=release_note_id,
				user_id=recipient_id,
				delivered_at=release_note.published_at or utc_now(),
			),
		)
		created_new_delivery = True

	if created_new_delivery:
		session.commit()

	return _to_release_note_read(session, release_note)


@app.get("/api/release-notes", response_model=list[ReleaseNoteDeliveryRead])
def list_release_notes_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> list[ReleaseNoteDeliveryRead]:
	_ensure_release_note_deliveries_for_user(session, current_user.username)
	rows = list(
		session.exec(
			select(ReleaseNoteDelivery, ReleaseNote)
			.join(ReleaseNote, ReleaseNote.id == ReleaseNoteDelivery.release_note_id)
			.where(
				ReleaseNoteDelivery.user_id == current_user.username,
				ReleaseNote.published_at.is_not(None),
			)
			.order_by(ReleaseNoteDelivery.delivered_at.desc()),
		),
	)
	return [_to_release_note_delivery_read(delivery, release_note) for delivery, release_note in rows]


@app.post("/api/release-notes/mark-seen", response_model=ActionMessageRead)
def mark_release_notes_seen_for_current_user(
	current_user: CurrentUserDependency,
	session: SessionDependency,
	_: TokenDependency,
) -> ActionMessageRead:
	_ensure_release_note_deliveries_for_user(session, current_user.username)
	pending_items = list(
		session.exec(
			select(ReleaseNoteDelivery).where(
				ReleaseNoteDelivery.user_id == current_user.username,
				ReleaseNoteDelivery.seen_at.is_(None),
			),
		),
	)
	if not pending_items:
		return ActionMessageRead(message="没有新的更新日志。")

	now = utc_now()
	for delivery in pending_items:
		delivery.seen_at = now
		session.add(delivery)

	session.commit()
	return ActionMessageRead(message="更新日志已标记为已读。")


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
	session.flush()
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING",
		entity_id=holding.id,
		operation="CREATE",
		before_state=None,
		after_state=_capture_model_state(holding),
	)
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
		holding.started_on = payload.started_on
	if "note" in payload.model_fields_set:
		holding.note = _normalize_optional_text(payload.note)
	_touch_model(holding)
	session.add(holding)
	_record_asset_mutation(
		session,
		current_user,
		entity_type="HOLDING",
		entity_id=holding.id,
		operation="UPDATE",
		before_state=before_state,
		after_state=_capture_model_state(holding),
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
		if await _consume_global_force_refresh_slot():
			market_data_client.clear_runtime_caches()
		_invalidate_dashboard_cache(current_user.username)
		return await _get_cached_dashboard(session, current_user, force_refresh=True)

	return await _get_cached_dashboard(session, current_user)
