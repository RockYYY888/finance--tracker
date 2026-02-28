from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CashAccountCreate(BaseModel):
	name: str = Field(min_length=1, max_length=80)
	platform: str = Field(min_length=1, max_length=80)
	currency: str = Field(default="CNY", min_length=3, max_length=8)
	balance: float = Field(ge=0)


class CashAccountUpdate(BaseModel):
	name: str = Field(min_length=1, max_length=80)
	platform: str = Field(min_length=1, max_length=80)
	currency: str = Field(default="CNY", min_length=3, max_length=8)
	balance: float = Field(ge=0)


class CashAccountRead(BaseModel):
	id: int
	name: str
	platform: str
	currency: str
	balance: float


class SecurityHoldingCreate(BaseModel):
	symbol: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=120)
	quantity: float = Field(gt=0)
	fallback_currency: str = Field(default="CNY", min_length=3, max_length=8)


class SecurityHoldingUpdate(BaseModel):
	symbol: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=120)
	quantity: float = Field(gt=0)
	fallback_currency: str = Field(default="CNY", min_length=3, max_length=8)


class SecurityHoldingRead(BaseModel):
	id: int
	symbol: str
	name: str
	quantity: float
	fallback_currency: str


class ValuedCashAccount(BaseModel):
	id: int
	name: str
	platform: str
	balance: float
	currency: str
	fx_to_cny: float
	value_cny: float


class ValuedHolding(BaseModel):
	id: int
	symbol: str
	name: str
	quantity: float
	price: float
	price_currency: str
	fx_to_cny: float
	value_cny: float
	last_updated: Optional[datetime] = None


class AllocationSlice(BaseModel):
	label: str
	value: float


class TimelinePoint(BaseModel):
	label: str
	value: float


class DashboardResponse(BaseModel):
	total_value_cny: float
	cash_value_cny: float
	holdings_value_cny: float
	cash_accounts: list[ValuedCashAccount]
	holdings: list[ValuedHolding]
	allocation: list[AllocationSlice]
	day_series: list[TimelinePoint]
	month_series: list[TimelinePoint]
	year_series: list[TimelinePoint]
	warnings: list[str]
