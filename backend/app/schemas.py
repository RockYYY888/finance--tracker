from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import (
	CASH_ACCOUNT_TYPES,
	FIXED_ASSET_CATEGORIES,
	LIABILITY_CATEGORIES,
	LIABILITY_CURRENCIES,
	OTHER_ASSET_CATEGORIES,
	SECURITY_MARKETS,
)
from app.security import normalize_email, normalize_user_id, validate_password_strength


def _normalize_optional_text(value: str | None) -> str | None:
	if value is None:
		return None

	stripped = value.strip()
	return stripped or None


def _normalize_required_text(value: str, field_name: str) -> str:
	stripped = value.strip()
	if not stripped:
		raise ValueError(f"{field_name} cannot be empty.")

	return stripped


def _normalize_choice(
	value: str | None,
	allowed_values: tuple[str, ...],
	field_name: str,
) -> str | None:
	if value is None:
		return None

	normalized = value.strip().upper()
	if normalized not in allowed_values:
		raise ValueError(f"{field_name} must be one of: {', '.join(allowed_values)}.")

	return normalized


class CashAccountCreate(BaseModel):
	name: str = Field(min_length=1, max_length=80)
	platform: str = Field(min_length=1, max_length=80)
	currency: str = Field(default="CNY", min_length=3, max_length=8)
	balance: float = Field(ge=0)
	account_type: str = Field(default="OTHER", min_length=4, max_length=20)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("account_type", mode="before")
	@classmethod
	def validate_account_type(cls, value: str | None) -> str | None:
		return _normalize_choice(value, CASH_ACCOUNT_TYPES, "account_type")

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class CashAccountUpdate(BaseModel):
	name: str = Field(min_length=1, max_length=80)
	platform: str = Field(min_length=1, max_length=80)
	currency: str = Field(default="CNY", min_length=3, max_length=8)
	balance: float = Field(ge=0)
	account_type: Optional[str] = Field(default=None, min_length=4, max_length=20)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("account_type", mode="before")
	@classmethod
	def validate_account_type(cls, value: str | None) -> str | None:
		return _normalize_choice(value, CASH_ACCOUNT_TYPES, "account_type")

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class CashAccountRead(BaseModel):
	id: int
	name: str
	platform: str
	currency: str
	balance: float
	account_type: str
	started_on: Optional[date] = None
	note: Optional[str] = None
	fx_to_cny: Optional[float] = None
	value_cny: Optional[float] = None


class FixedAssetBase(BaseModel):
	name: str = Field(min_length=1, max_length=120)
	category: str = Field(default="OTHER", min_length=4, max_length=24)
	current_value_cny: float = Field(gt=0)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("category", mode="before")
	@classmethod
	def validate_category(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FIXED_ASSET_CATEGORIES, "category")

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class FixedAssetCreate(FixedAssetBase):
	purchase_value_cny: Optional[float] = Field(default=None, gt=0)


class FixedAssetUpdate(FixedAssetBase):
	purchase_value_cny: Optional[float] = Field(default=None, gt=0)


class FixedAssetRead(BaseModel):
	id: int
	name: str
	category: str
	current_value_cny: float
	purchase_value_cny: Optional[float] = None
	started_on: Optional[date] = None
	note: Optional[str] = None
	value_cny: float
	return_pct: Optional[float] = None


class LiabilityEntryCreate(BaseModel):
	name: str = Field(min_length=1, max_length=120)
	category: str = Field(default="OTHER", min_length=4, max_length=24)
	currency: str = Field(default="CNY", min_length=3, max_length=8)
	balance: float = Field(ge=0)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("category", mode="before")
	@classmethod
	def validate_category(cls, value: str | None) -> str | None:
		return _normalize_choice(value, LIABILITY_CATEGORIES, "category")

	@field_validator("currency", mode="before")
	@classmethod
	def validate_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, LIABILITY_CURRENCIES, "currency")

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class LiabilityEntryUpdate(BaseModel):
	name: str = Field(min_length=1, max_length=120)
	category: Optional[str] = Field(default=None, min_length=4, max_length=24)
	currency: str = Field(default="CNY", min_length=3, max_length=8)
	balance: float = Field(ge=0)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("category", mode="before")
	@classmethod
	def validate_category(cls, value: str | None) -> str | None:
		return _normalize_choice(value, LIABILITY_CATEGORIES, "category")

	@field_validator("currency", mode="before")
	@classmethod
	def validate_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, LIABILITY_CURRENCIES, "currency")

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class LiabilityEntryRead(BaseModel):
	id: int
	name: str
	category: str
	currency: str
	balance: float
	started_on: Optional[date] = None
	note: Optional[str] = None
	fx_to_cny: Optional[float] = None
	value_cny: Optional[float] = None


class OtherAssetBase(BaseModel):
	name: str = Field(min_length=1, max_length=120)
	category: str = Field(default="OTHER", min_length=4, max_length=24)
	current_value_cny: float = Field(gt=0)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("category", mode="before")
	@classmethod
	def validate_category(cls, value: str | None) -> str | None:
		return _normalize_choice(value, OTHER_ASSET_CATEGORIES, "category")

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class OtherAssetCreate(OtherAssetBase):
	original_value_cny: Optional[float] = Field(default=None, gt=0)


class OtherAssetUpdate(OtherAssetBase):
	original_value_cny: Optional[float] = Field(default=None, gt=0)


class OtherAssetRead(BaseModel):
	id: int
	name: str
	category: str
	current_value_cny: float
	original_value_cny: Optional[float] = None
	started_on: Optional[date] = None
	note: Optional[str] = None
	value_cny: float
	return_pct: Optional[float] = None


class AuthRegisterCredentials(BaseModel):
	user_id: str = Field(min_length=3, max_length=32)
	email: str = Field(min_length=3, max_length=320)
	password: str = Field(min_length=8, max_length=128)

	@field_validator("user_id", mode="before")
	@classmethod
	def validate_user_id(cls, value: str) -> str:
		return normalize_user_id(value)

	@field_validator("password", mode="before")
	@classmethod
	def validate_password(cls, value: str) -> str:
		return validate_password_strength(value)

	@field_validator("email", mode="before")
	@classmethod
	def validate_email(cls, value: str) -> str:
		return normalize_email(value)


class AuthLoginCredentials(BaseModel):
	user_id: str = Field(min_length=3, max_length=32)
	password: str = Field(min_length=1, max_length=128)

	@field_validator("user_id", mode="before")
	@classmethod
	def validate_user_id(cls, value: str) -> str:
		return normalize_user_id(value)


class AuthSessionRead(BaseModel):
	user_id: str
	email: str | None = None


class PasswordResetRequest(BaseModel):
	user_id: str = Field(min_length=3, max_length=32)
	email: str = Field(min_length=3, max_length=320)
	new_password: str = Field(min_length=8, max_length=128)

	@field_validator("user_id", mode="before")
	@classmethod
	def validate_user_id(cls, value: str) -> str:
		return normalize_user_id(value)

	@field_validator("email", mode="before")
	@classmethod
	def validate_email(cls, value: str) -> str:
		return normalize_email(value)

	@field_validator("new_password", mode="before")
	@classmethod
	def validate_password(cls, value: str) -> str:
		return validate_password_strength(value)


class ActionMessageRead(BaseModel):
	message: str


class UserEmailUpdate(BaseModel):
	email: str = Field(min_length=3, max_length=320)

	@field_validator("email", mode="before")
	@classmethod
	def validate_email(cls, value: str) -> str:
		return normalize_email(value)


class UserFeedbackCreate(BaseModel):
	message: str = Field(min_length=5, max_length=1000)

	@field_validator("message", mode="before")
	@classmethod
	def normalize_message(cls, value: str) -> str:
		return _normalize_required_text(value, "message")


class UserFeedbackRead(BaseModel):
	id: int
	user_id: str
	message: str
	reply_message: str | None = None
	replied_at: datetime | None = None
	replied_by: str | None = None
	reply_seen_at: datetime | None = None
	resolved_at: datetime | None = None
	closed_by: str | None = None
	created_at: datetime


class FeedbackSummaryRead(BaseModel):
	inbox_count: int
	mode: str


class AdminFeedbackReplyUpdate(BaseModel):
	reply_message: str = Field(min_length=1, max_length=2000)
	close: bool = False

	@field_validator("reply_message", mode="before")
	@classmethod
	def normalize_reply_message(cls, value: str) -> str:
		return _normalize_required_text(value, "reply_message")


class SecurityHoldingCreate(BaseModel):
	symbol: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=120)
	quantity: float = Field(gt=0)
	fallback_currency: str = Field(default="CNY", min_length=3, max_length=8)
	cost_basis_price: Optional[float] = Field(default=None, gt=0)
	market: str = Field(default="OTHER", min_length=2, max_length=16)
	broker: Optional[str] = Field(default=None, max_length=120)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("market", mode="before")
	@classmethod
	def validate_market(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SECURITY_MARKETS, "market")

	@field_validator("broker", "note", mode="before")
	@classmethod
	def normalize_optional_fields(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_quantity_for_market(self) -> SecurityHoldingCreate:
		if self.market not in {"FUND", "CRYPTO"} and not float(self.quantity).is_integer():
			raise ValueError("股票请使用整数数量，基金可使用份额。")
		return self


class SecurityHoldingUpdate(BaseModel):
	symbol: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=120)
	quantity: float = Field(gt=0)
	fallback_currency: str = Field(default="CNY", min_length=3, max_length=8)
	cost_basis_price: Optional[float] = Field(default=None, gt=0)
	market: Optional[str] = Field(default=None, min_length=2, max_length=16)
	broker: Optional[str] = Field(default=None, max_length=120)
	started_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("market", mode="before")
	@classmethod
	def validate_market(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SECURITY_MARKETS, "market")

	@field_validator("broker", "note", mode="before")
	@classmethod
	def normalize_optional_fields(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_quantity_for_market(self) -> SecurityHoldingUpdate:
		if (self.market or "OTHER") not in {"FUND", "CRYPTO"} and not float(self.quantity).is_integer():
			raise ValueError("股票请使用整数数量，基金可使用份额。")
		return self


class SecurityHoldingRead(BaseModel):
	id: int
	symbol: str
	name: str
	quantity: float
	fallback_currency: str
	cost_basis_price: Optional[float] = None
	market: str
	broker: Optional[str] = None
	started_on: Optional[date] = None
	note: Optional[str] = None
	price: Optional[float] = None
	price_currency: Optional[str] = None
	value_cny: Optional[float] = None
	return_pct: Optional[float] = None
	last_updated: Optional[datetime] = None


class SecuritySearchRead(BaseModel):
	symbol: str
	name: str
	market: str
	currency: str
	exchange: Optional[str] = None
	source: Optional[str] = None


class ValuedCashAccount(BaseModel):
	id: int
	name: str
	platform: str
	balance: float
	currency: str
	account_type: str
	started_on: Optional[date] = None
	note: Optional[str] = None
	fx_to_cny: float
	value_cny: float


class ValuedHolding(BaseModel):
	id: int
	symbol: str
	name: str
	quantity: float
	fallback_currency: str
	cost_basis_price: Optional[float] = None
	market: str
	broker: Optional[str] = None
	started_on: Optional[date] = None
	note: Optional[str] = None
	price: float
	price_currency: str
	fx_to_cny: float
	value_cny: float
	return_pct: Optional[float] = None
	last_updated: Optional[datetime] = None


class ValuedFixedAsset(BaseModel):
	id: int
	name: str
	category: str
	current_value_cny: float
	purchase_value_cny: Optional[float] = None
	started_on: Optional[date] = None
	note: Optional[str] = None
	value_cny: float
	return_pct: Optional[float] = None


class ValuedLiabilityEntry(BaseModel):
	id: int
	name: str
	category: str
	currency: str
	balance: float
	started_on: Optional[date] = None
	note: Optional[str] = None
	fx_to_cny: float
	value_cny: float


class ValuedOtherAsset(BaseModel):
	id: int
	name: str
	category: str
	current_value_cny: float
	original_value_cny: Optional[float] = None
	started_on: Optional[date] = None
	note: Optional[str] = None
	value_cny: float
	return_pct: Optional[float] = None


class AllocationSlice(BaseModel):
	label: str
	value: float


class TimelinePoint(BaseModel):
	label: str
	value: float


class HoldingReturnSeries(BaseModel):
	symbol: str
	name: str
	hour_series: list[TimelinePoint]
	day_series: list[TimelinePoint]
	month_series: list[TimelinePoint]
	year_series: list[TimelinePoint]


class DashboardResponse(BaseModel):
	total_value_cny: float
	cash_value_cny: float
	holdings_value_cny: float
	fixed_assets_value_cny: float
	liabilities_value_cny: float
	other_assets_value_cny: float
	usd_cny_rate: Optional[float] = None
	hkd_cny_rate: Optional[float] = None
	cash_accounts: list[ValuedCashAccount]
	holdings: list[ValuedHolding]
	fixed_assets: list[ValuedFixedAsset]
	liabilities: list[ValuedLiabilityEntry]
	other_assets: list[ValuedOtherAsset]
	allocation: list[AllocationSlice]
	hour_series: list[TimelinePoint]
	day_series: list[TimelinePoint]
	month_series: list[TimelinePoint]
	year_series: list[TimelinePoint]
	holdings_return_hour_series: list[TimelinePoint]
	holdings_return_day_series: list[TimelinePoint]
	holdings_return_month_series: list[TimelinePoint]
	holdings_return_year_series: list[TimelinePoint]
	holding_return_series: list[HoldingReturnSeries]
	warnings: list[str]
