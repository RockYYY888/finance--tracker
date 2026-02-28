from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlmodel import Session, select
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.analytics import build_timeline
from app.database import get_session, init_db
from app.models import CashAccount, PortfolioSnapshot, SecurityHolding, utc_now
from app.schemas import (
	AllocationSlice,
	CashAccountCreate,
	CashAccountRead,
	CashAccountUpdate,
	DashboardResponse,
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
)

SessionDependency = Annotated[Session, Depends(get_session)]
TokenDependency = Annotated[None, Depends(verify_api_token)]
market_data_client = MarketDataClient()
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
	init_db()
	yield


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
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
	response: Response = await call_next(request)
	response.headers["Cache-Control"] = "no-store"
	response.headers["Pragma"] = "no-cache"
	response.headers["Referrer-Policy"] = "same-origin"
	response.headers["X-Content-Type-Options"] = "nosniff"
	response.headers["X-Frame-Options"] = "DENY"
	return response


def _normalize_currency(code: str) -> str:
	return code.strip().upper()


def _normalize_symbol(symbol: str) -> str:
	try:
		return normalize_market_symbol(symbol)
	except ValueError as exc:
		raise HTTPException(status_code=422, detail=str(exc)) from exc


def _touch_model(model: CashAccount | SecurityHolding) -> None:
	model.updated_at = utc_now()


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
				price=price,
				price_currency=price_currency,
				fx_to_cny=round(fx_rate, 6),
				value_cny=value_cny,
				last_updated=last_updated,
			),
		)
		total += value_cny

	return items, round(total, 2), warnings


def _persist_snapshot(session: Session, total_value_cny: float) -> None:
	cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
	last_snapshot = session.exec(
		select(PortfolioSnapshot)
		.order_by(PortfolioSnapshot.created_at.desc())
		.limit(1),
	).first()

	if last_snapshot and last_snapshot.created_at >= cutoff:
		last_snapshot.total_value_cny = total_value_cny
		last_snapshot.created_at = utc_now()
		session.add(last_snapshot)
	else:
		session.add(PortfolioSnapshot(total_value_cny=total_value_cny))

	session.commit()


def _load_series(session: Session, since: datetime) -> list[PortfolioSnapshot]:
	return list(
		session.exec(
			select(PortfolioSnapshot)
			.where(PortfolioSnapshot.created_at >= since)
			.order_by(PortfolioSnapshot.created_at.asc()),
		),
	)


async def _build_dashboard(session: Session) -> DashboardResponse:
	accounts = list(session.exec(select(CashAccount).order_by(CashAccount.platform, CashAccount.name)))
	holdings = list(
		session.exec(select(SecurityHolding).order_by(SecurityHolding.symbol, SecurityHolding.name)),
	)

	valued_accounts, cash_value_cny, account_warnings = await _value_cash_accounts(accounts)
	valued_holdings, holdings_value_cny, holding_warnings = await _value_holdings(holdings)
	total_value_cny = round(cash_value_cny + holdings_value_cny, 2)

	_persist_snapshot(session, total_value_cny)

	now = datetime.now(timezone.utc)
	day_series = build_timeline(_load_series(session, now - timedelta(days=1)), "day")
	month_series = build_timeline(_load_series(session, now - timedelta(days=31)), "month")
	year_series = build_timeline(_load_series(session, now - timedelta(days=366)), "year")

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
		day_series=day_series,
		month_series=month_series,
		year_series=year_series,
		warnings=[*account_warnings, *holding_warnings],
	)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
	return {"status": "ok"}


@app.get("/api/accounts", response_model=list[CashAccountRead])
def list_accounts(_: TokenDependency, session: SessionDependency) -> list[CashAccount]:
	return list(session.exec(select(CashAccount).order_by(CashAccount.platform, CashAccount.name)))


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
	)
	session.add(account)
	session.commit()
	session.refresh(account)
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
	_touch_model(account)
	session.add(account)
	session.commit()
	session.refresh(account)
	return account


@app.get("/api/holdings", response_model=list[SecurityHoldingRead])
def list_holdings(_: TokenDependency, session: SessionDependency) -> list[SecurityHolding]:
	return list(session.exec(select(SecurityHolding).order_by(SecurityHolding.symbol, SecurityHolding.name)))


@app.post("/api/holdings", response_model=SecurityHoldingRead, status_code=201)
def create_holding(
	payload: SecurityHoldingCreate,
	_: TokenDependency,
	session: SessionDependency,
) -> SecurityHolding:
	holding = SecurityHolding(
		symbol=_normalize_symbol(payload.symbol),
		name=payload.name.strip(),
		quantity=payload.quantity,
		fallback_currency=_normalize_currency(payload.fallback_currency),
	)
	session.add(holding)
	session.commit()
	session.refresh(holding)
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

	holding.symbol = _normalize_symbol(payload.symbol)
	holding.name = payload.name.strip()
	holding.quantity = payload.quantity
	holding.fallback_currency = _normalize_currency(payload.fallback_currency)
	_touch_model(holding)
	session.add(holding)
	session.commit()
	session.refresh(holding)
	return holding


@app.get("/api/dashboard", response_model=DashboardResponse)
async def get_dashboard(_: TokenDependency, session: SessionDependency) -> DashboardResponse:
	return await _build_dashboard(session)
