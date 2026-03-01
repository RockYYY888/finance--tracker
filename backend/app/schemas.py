from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import CASH_ACCOUNT_TYPES, SECURITY_MARKETS


def _normalize_optional_text(value: str | None) -> str | None:
	if value is None:
		return None

	stripped = value.strip()
	return stripped or None


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
	note: Optional[str] = None
	fx_to_cny: Optional[float] = None
	value_cny: Optional[float] = None


class SecurityHoldingCreate(BaseModel):
	symbol: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=120)
	quantity: float = Field(gt=0)
	fallback_currency: str = Field(default="CNY", min_length=3, max_length=8)
	cost_basis_price: Optional[float] = Field(default=None, gt=0)
	market: str = Field(default="OTHER", min_length=2, max_length=16)
	broker: Optional[str] = Field(default=None, max_length=120)
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


class ValuedCashAccount(BaseModel):
	id: int
	name: str
	platform: str
	balance: float
	currency: str
	account_type: str
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
	note: Optional[str] = None
	price: float
	price_currency: str
	fx_to_cny: float
	value_cny: float
	return_pct: Optional[float] = None
	last_updated: Optional[datetime] = None


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
	cash_accounts: list[ValuedCashAccount]
	holdings: list[ValuedHolding]
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
