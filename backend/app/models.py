from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel

CASH_ACCOUNT_TYPES = ("ALIPAY", "WECHAT", "BANK", "CASH", "OTHER")
SECURITY_MARKETS = ("CN", "HK", "US", "FUND", "CRYPTO", "OTHER")
FIXED_ASSET_CATEGORIES = (
	"REAL_ESTATE",
	"VEHICLE",
	"PRECIOUS_METAL",
	"COLLECTIBLE",
	"SOCIAL_SECURITY",
	"OTHER",
)
LIABILITY_CATEGORIES = (
	"MORTGAGE",
	"AUTO_LOAN",
	"CREDIT_CARD",
	"PERSONAL_LOAN",
	"OTHER",
)
LIABILITY_CURRENCIES = ("CNY", "USD")
OTHER_ASSET_CATEGORIES = ("RECEIVABLE", "OTHER")


def utc_now() -> datetime:
	"""Return the current UTC timestamp."""
	return datetime.now(timezone.utc)


class UserAccount(SQLModel, table=True):
	username: str = Field(primary_key=True, max_length=32)
	password_digest: str = Field(max_length=512)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class UserFeedback(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	message: str = Field(max_length=1000)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)


class CashAccount(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	name: str
	platform: str
	currency: str = Field(default="CNY", max_length=8)
	balance: float = Field(default=0)
	account_type: str = Field(default="OTHER", max_length=20)
	started_on: Optional[date] = Field(default=None)
	note: Optional[str] = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class SecurityHolding(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	symbol: str = Field(index=True)
	name: str
	quantity: float = Field(default=0)
	fallback_currency: str = Field(default="CNY", max_length=8)
	cost_basis_price: Optional[float] = Field(default=None)
	market: str = Field(default="OTHER", max_length=16)
	broker: Optional[str] = Field(default=None, max_length=120)
	started_on: Optional[date] = Field(default=None)
	note: Optional[str] = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class FixedAsset(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	name: str
	category: str = Field(default="OTHER", max_length=24)
	current_value_cny: float = Field(default=0)
	purchase_value_cny: Optional[float] = Field(default=None)
	started_on: Optional[date] = Field(default=None)
	note: Optional[str] = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class LiabilityEntry(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	name: str
	category: str = Field(default="OTHER", max_length=24)
	currency: str = Field(default="CNY", max_length=8)
	balance: float = Field(default=0)
	started_on: Optional[date] = Field(default=None)
	note: Optional[str] = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class OtherAsset(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	name: str
	category: str = Field(default="OTHER", max_length=24)
	current_value_cny: float = Field(default=0)
	original_value_cny: Optional[float] = Field(default=None)
	started_on: Optional[date] = Field(default=None)
	note: Optional[str] = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class PortfolioSnapshot(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	total_value_cny: float = Field(default=0)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)


class HoldingPerformanceSnapshot(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(default="admin", index=True, max_length=32)
	scope: str = Field(default="TOTAL", max_length=16, index=True)
	symbol: Optional[str] = Field(default=None, index=True)
	name: Optional[str] = Field(default=None, max_length=120)
	return_pct: float = Field(default=0)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
