from __future__ import annotations

from datetime import date, datetime, timezone
import re
from typing import Any, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator

from app.models import (
	AGENT_TASK_STATUSES,
	AGENT_TASK_TYPES,
	BUY_FUNDING_HANDLINGS,
	CASH_ACCOUNT_TYPES,
	CASH_LEDGER_ENTRY_TYPES,
	CASH_SETTLEMENT_DIRECTIONS,
	DASHBOARD_CORRECTION_ACTIONS,
	DASHBOARD_CORRECTION_GRANULARITIES,
	DASHBOARD_SERIES_SCOPES,
	FEEDBACK_CATEGORIES,
	INBOX_MESSAGE_KINDS,
	FEEDBACK_PRIORITIES,
	FEEDBACK_SOURCES,
	FEEDBACK_STATUSES,
	FIXED_ASSET_CATEGORIES,
	HOLDING_TRANSACTION_SIDES,
	LIABILITY_CATEGORIES,
	LIABILITY_CURRENCIES,
	OTHER_ASSET_CATEGORIES,
	SELL_PROCEEDS_HANDLINGS,
	SECURITY_MARKETS,
	SUPPORTED_CURRENCIES,
)
from app.security import normalize_email, normalize_user_id, validate_password_strength

AGENT_TOKEN_NAME_PATTERN = re.compile(r"^[a-z]+(?:-[a-z]+)*$")


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


def _coerce_utc_datetime(value: datetime) -> datetime:
	if value.tzinfo is None:
		return value.replace(tzinfo=timezone.utc)

	return value.astimezone(timezone.utc)


def _serialize_utc_datetime(value: datetime) -> str:
	return _coerce_utc_datetime(value).isoformat().replace("+00:00", "Z")


class UtcTimestampResponseModel(BaseModel):
	@field_serializer("*", when_used="json", check_fields=False)
	def serialize_datetime_fields(self, value: Any) -> Any:
		if isinstance(value, datetime):
			return _serialize_utc_datetime(value)

		return value


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

	@field_validator("currency", mode="before")
	@classmethod
	def validate_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SUPPORTED_CURRENCIES, "currency")

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

	@field_validator("currency", mode="before")
	@classmethod
	def validate_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SUPPORTED_CURRENCIES, "currency")

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


class AgentTokenCreate(BaseModel):
	name: str = Field(min_length=3, max_length=80)
	expires_in_days: int | None = Field(default=None, ge=1, le=3650)

	@field_validator("name", mode="before")
	@classmethod
	def normalize_name(cls, value: str) -> str:
		name = _normalize_required_text(value, "name")
		if any(ord(character) < 32 for character in name):
			raise ValueError("API Key 名称不能包含换行或控制字符。")
		if not AGENT_TOKEN_NAME_PATTERN.fullmatch(name):
			raise ValueError(
				"API Key 名称仅支持小写字母和连字符（-），例如 daily-sync。",
			)
		return name


class AgentTokenIssueCreate(AgentTokenCreate):
	user_id: str = Field(min_length=3, max_length=32)
	password: str = Field(min_length=1, max_length=128)

	@field_validator("user_id", mode="before")
	@classmethod
	def validate_user_id(cls, value: str) -> str:
		return normalize_user_id(value)


class AgentTokenRead(UtcTimestampResponseModel):
	id: int
	name: str
	token_hint: str
	created_at: datetime
	updated_at: datetime
	last_used_at: datetime | None = None
	expires_at: datetime | None = None
	revoked_at: datetime | None = None


class AgentTokenIssueRead(AgentTokenRead):
	access_token: str


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
	category: str | None = Field(default=None, max_length=32)
	priority: str | None = Field(default=None, max_length=16)
	source: str | None = Field(default=None, max_length=32)
	fingerprint: str | None = Field(default=None, max_length=96)
	dedupe_window_minutes: int | None = Field(default=None, ge=1, le=10_080)

	@field_validator("message", mode="before")
	@classmethod
	def normalize_message(cls, value: str) -> str:
		return _normalize_required_text(value, "message")

	@field_validator("category", mode="before")
	@classmethod
	def normalize_category(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_CATEGORIES, "category")

	@field_validator("priority", mode="before")
	@classmethod
	def normalize_priority(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_PRIORITIES, "priority")

	@field_validator("source", mode="before")
	@classmethod
	def normalize_source(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_SOURCES, "source")

	@field_validator("fingerprint", mode="before")
	@classmethod
	def normalize_fingerprint(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class UserFeedbackRead(UtcTimestampResponseModel):
	id: int
	user_id: str
	message: str
	category: str
	priority: str
	source: str
	status: str
	is_system: bool
	reply_message: str | None = None
	replied_at: datetime | None = None
	replied_by: str | None = None
	reply_seen_at: datetime | None = None
	resolved_at: datetime | None = None
	closed_by: str | None = None
	created_at: datetime


class AdminFeedbackRead(UserFeedbackRead):
	assignee: str | None = None
	acknowledged_at: datetime | None = None
	acknowledged_by: str | None = None
	ack_deadline: datetime | None = None
	internal_note: str | None = None
	internal_note_updated_at: datetime | None = None
	internal_note_updated_by: str | None = None
	fingerprint: str | None = None
	dedupe_window_minutes: int | None = None
	occurrence_count: int = 1
	last_seen_at: datetime | None = None


class AdminFeedbackListRead(BaseModel):
	items: list[AdminFeedbackRead]
	total: int
	page: int
	page_size: int
	has_more: bool


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


class AdminFeedbackClassifyUpdate(BaseModel):
	category: str | None = Field(default=None, max_length=32)
	priority: str | None = Field(default=None, max_length=16)
	source: str | None = Field(default=None, max_length=32)
	status: str | None = Field(default=None, max_length=16)
	assignee: str | None = Field(default=None, max_length=32)
	ack_deadline: datetime | None = Field(default=None)
	internal_note: str | None = Field(default=None, max_length=3000)

	@field_validator("category", mode="before")
	@classmethod
	def normalize_category(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_CATEGORIES, "category")

	@field_validator("priority", mode="before")
	@classmethod
	def normalize_priority(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_PRIORITIES, "priority")

	@field_validator("source", mode="before")
	@classmethod
	def normalize_source(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_SOURCES, "source")

	@field_validator("status", mode="before")
	@classmethod
	def normalize_status(cls, value: str | None) -> str | None:
		return _normalize_choice(value, FEEDBACK_STATUSES, "status")

	@field_validator("assignee", mode="before")
	@classmethod
	def normalize_assignee(cls, value: str | None) -> str | None:
		if value is None:
			return None
		return normalize_user_id(value)

	@field_validator("internal_note", mode="before")
	@classmethod
	def normalize_internal_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class AdminFeedbackAcknowledgeUpdate(BaseModel):
	assignee: str | None = Field(default=None, max_length=32)
	ack_deadline: datetime | None = Field(default=None)
	internal_note: str | None = Field(default=None, max_length=3000)

	@field_validator("assignee", mode="before")
	@classmethod
	def normalize_assignee(cls, value: str | None) -> str | None:
		if value is None:
			return None
		return normalize_user_id(value)

	@field_validator("internal_note", mode="before")
	@classmethod
	def normalize_internal_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class InboxMessageHideCreate(BaseModel):
	message_kind: str = Field(max_length=24)
	message_id: int = Field(gt=0)

	@field_validator("message_kind", mode="before")
	@classmethod
	def normalize_message_kind(cls, value: str) -> str:
		normalized = _normalize_required_text(value, "message_kind").upper()
		if normalized not in INBOX_MESSAGE_KINDS:
			raise ValueError(f"message_kind must be one of: {', '.join(INBOX_MESSAGE_KINDS)}")
		return normalized


SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


class ReleaseNoteCreate(BaseModel):
	version: str = Field(min_length=1, max_length=32)
	title: str = Field(min_length=1, max_length=120)
	content: str = Field(min_length=1, max_length=6000)
	source_feedback_ids: list[int] = Field(default_factory=list)

	@field_validator("version", mode="before")
	@classmethod
	def validate_version(cls, value: str) -> str:
		normalized = _normalize_required_text(value, "version")
		if SEMVER_PATTERN.match(normalized) is None:
			raise ValueError("version must match semantic version format: x.y.z")
		return normalized

	@field_validator("title", "content", mode="before")
	@classmethod
	def normalize_required_fields(cls, value: str, info: Any) -> str:
		return _normalize_required_text(value, info.field_name)

	@field_validator("source_feedback_ids")
	@classmethod
	def validate_source_feedback_ids(cls, value: list[int]) -> list[int]:
		normalized_ids = sorted(set(value))
		if any(item <= 0 for item in normalized_ids):
			raise ValueError("source_feedback_ids must contain positive integers only.")
		return normalized_ids


class ReleaseNotePublishChangelogCreate(ReleaseNoteCreate):
	release_url: str | None = Field(default=None, max_length=500)

	@field_validator("release_url", mode="before")
	@classmethod
	def normalize_release_url(cls, value: str | None) -> str | None:
		normalized = _normalize_optional_text(value)
		if normalized is None:
			return None

		parsed = urlparse(normalized)
		if parsed.scheme not in {"http", "https"} or not parsed.netloc:
			raise ValueError("release_url must be a valid http or https URL.")

		return normalized


class ReleaseNoteRead(UtcTimestampResponseModel):
	id: int
	version: str
	title: str
	content: str
	source_feedback_ids: list[int]
	created_by: str
	created_at: datetime
	published_at: datetime | None = None
	delivery_count: int = 0


class ReleaseNoteDeliveryRead(UtcTimestampResponseModel):
	delivery_id: int
	release_note_id: int
	version: str
	title: str
	content: str
	source_feedback_ids: list[int]
	delivered_at: datetime
	seen_at: datetime | None = None
	published_at: datetime


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

	@field_validator("fallback_currency", mode="before")
	@classmethod
	def validate_fallback_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SUPPORTED_CURRENCIES, "fallback_currency")

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
	model_config = ConfigDict(extra="forbid")

	quantity: Optional[float] = Field(default=None, gt=0)
	cost_basis_price: Optional[float] = Field(default=None, gt=0)
	started_on: Optional[date] = None
	broker: Optional[str] = Field(default=None, max_length=120)
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("broker", "note", mode="before")
	@classmethod
	def normalize_optional_fields(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class SecurityHoldingRead(UtcTimestampResponseModel):
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


class SecurityHoldingTransactionCreate(BaseModel):
	side: str = Field(default="BUY", min_length=3, max_length=12)
	symbol: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=120)
	quantity: float = Field(gt=0)
	price: Optional[float] = Field(default=None, gt=0)
	fallback_currency: str = Field(default="CNY", min_length=3, max_length=8)
	market: str = Field(default="OTHER", min_length=2, max_length=16)
	broker: Optional[str] = Field(default=None, max_length=120)
	traded_on: date
	note: Optional[str] = Field(default=None, max_length=500)
	sell_proceeds_handling: Optional[str] = Field(default=None, min_length=7, max_length=32)
	sell_proceeds_account_id: Optional[int] = Field(default=None, ge=1)
	buy_funding_handling: Optional[str] = Field(default=None, min_length=10, max_length=32)
	buy_funding_account_id: Optional[int] = Field(default=None, ge=1)

	@field_validator("side", mode="before")
	@classmethod
	def validate_side(cls, value: str | None) -> str | None:
		return _normalize_choice(value, HOLDING_TRANSACTION_SIDES, "side")

	@field_validator("market", mode="before")
	@classmethod
	def validate_market(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SECURITY_MARKETS, "market")

	@field_validator("fallback_currency", mode="before")
	@classmethod
	def validate_fallback_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SUPPORTED_CURRENCIES, "fallback_currency")

	@field_validator("sell_proceeds_handling", mode="before")
	@classmethod
	def validate_sell_proceeds_handling(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SELL_PROCEEDS_HANDLINGS, "sell_proceeds_handling")

	@field_validator("buy_funding_handling", mode="before")
	@classmethod
	def validate_buy_funding_handling(cls, value: str | None) -> str | None:
		return _normalize_choice(value, BUY_FUNDING_HANDLINGS, "buy_funding_handling")

	@field_validator("broker", "note", mode="before")
	@classmethod
	def normalize_optional_fields(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_quantity_for_market(self) -> SecurityHoldingTransactionCreate:
		if self.market not in {"FUND", "CRYPTO"} and not float(self.quantity).is_integer():
			raise ValueError("股票请使用整数数量，基金可使用份额。")

		if self.side == "BUY":
			if self.sell_proceeds_handling is not None or self.sell_proceeds_account_id is not None:
				raise ValueError("买入交易不支持卖出回款处理选项。")
			effective_funding = (
				self.buy_funding_handling
				or ("DEDUCT_FROM_EXISTING_CASH" if self.buy_funding_account_id is not None else None)
			)
			if effective_funding == "DEDUCT_FROM_EXISTING_CASH" and self.buy_funding_account_id is None:
				raise ValueError("买入从现金账户扣款时必须选择目标现金账户。")
			if effective_funding != "DEDUCT_FROM_EXISTING_CASH" and self.buy_funding_account_id is not None:
				raise ValueError("只有从现有现金账户扣款时才允许传入目标现金账户。")
			return self

		if self.buy_funding_handling is not None or self.buy_funding_account_id is not None:
			raise ValueError("卖出交易不支持买入扣款处理选项。")

		effective_handling = self.sell_proceeds_handling or "CREATE_NEW_CASH"
		if effective_handling == "ADD_TO_EXISTING_CASH" and self.sell_proceeds_account_id is None:
			raise ValueError("卖出并入现有现金时必须选择目标现金账户。")
		if effective_handling != "ADD_TO_EXISTING_CASH" and self.sell_proceeds_account_id is not None:
			raise ValueError("只有并入现有现金时才允许传入目标现金账户。")

		return self


class SecurityHoldingTransactionUpdate(BaseModel):
	model_config = ConfigDict(extra="forbid")

	name: Optional[str] = Field(default=None, min_length=1, max_length=120)
	quantity: Optional[float] = Field(default=None, gt=0)
	price: Optional[float] = Field(default=None, gt=0)
	fallback_currency: Optional[str] = Field(default=None, min_length=3, max_length=8)
	broker: Optional[str] = Field(default=None, max_length=120)
	traded_on: Optional[date] = None
	note: Optional[str] = Field(default=None, max_length=500)
	sell_proceeds_handling: Optional[str] = Field(default=None, min_length=7, max_length=32)
	sell_proceeds_account_id: Optional[int] = Field(default=None, ge=1)
	buy_funding_handling: Optional[str] = Field(default=None, min_length=10, max_length=32)
	buy_funding_account_id: Optional[int] = Field(default=None, ge=1)

	@field_validator("name", mode="before")
	@classmethod
	def normalize_name(cls, value: str | None) -> str | None:
		if value is None:
			return None
		return _normalize_required_text(value, "name")

	@field_validator("sell_proceeds_handling", mode="before")
	@classmethod
	def validate_sell_proceeds_handling(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SELL_PROCEEDS_HANDLINGS, "sell_proceeds_handling")

	@field_validator("fallback_currency", mode="before")
	@classmethod
	def validate_fallback_currency(cls, value: str | None) -> str | None:
		return _normalize_choice(value, SUPPORTED_CURRENCIES, "fallback_currency")

	@field_validator("buy_funding_handling", mode="before")
	@classmethod
	def validate_buy_funding_handling(cls, value: str | None) -> str | None:
		return _normalize_choice(value, BUY_FUNDING_HANDLINGS, "buy_funding_handling")

	@field_validator("broker", "note", mode="before")
	@classmethod
	def normalize_optional_fields(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_sell_proceeds_fields(self) -> SecurityHoldingTransactionUpdate:
		if (
			self.sell_proceeds_handling is not None
			and self.sell_proceeds_handling != "ADD_TO_EXISTING_CASH"
			and self.sell_proceeds_account_id is not None
		):
			raise ValueError("只有并入现有现金时才允许传入目标现金账户。")
		if (
			self.buy_funding_handling is not None
			and self.buy_funding_handling != "DEDUCT_FROM_EXISTING_CASH"
			and self.buy_funding_account_id is not None
		):
			raise ValueError("只有从现有现金账户扣款时才允许传入目标现金账户。")
		return self


class SecurityHoldingTransactionRead(UtcTimestampResponseModel):
	id: int
	symbol: str
	name: str
	side: str
	quantity: float
	price: Optional[float] = None
	fallback_currency: str
	market: str
	broker: Optional[str] = None
	traded_on: date
	note: Optional[str] = None
	sell_proceeds_handling: Optional[str] = None
	sell_proceeds_account_id: Optional[int] = None
	buy_funding_handling: Optional[str] = None
	buy_funding_account_id: Optional[int] = None
	created_at: datetime
	updated_at: datetime


class HoldingTransactionApplyRead(UtcTimestampResponseModel):
	transaction: SecurityHoldingTransactionRead
	holding: SecurityHoldingRead | None = None
	cash_account: CashAccountRead | None = None
	sell_proceeds_handling: str | None = None


class CashLedgerEntryRead(UtcTimestampResponseModel):
	id: int
	cash_account_id: int
	entry_type: str
	amount: float
	currency: str
	happened_on: date
	note: str | None = None
	holding_transaction_id: int | None = None
	cash_transfer_id: int | None = None
	created_at: datetime
	updated_at: datetime

	@field_validator("entry_type", mode="before")
	@classmethod
	def validate_entry_type(cls, value: str | None) -> str | None:
		return _normalize_choice(value, CASH_LEDGER_ENTRY_TYPES, "entry_type")


class CashTransferCreate(BaseModel):
	from_account_id: int = Field(ge=1)
	to_account_id: int = Field(ge=1)
	source_amount: float = Field(gt=0)
	target_amount: float | None = Field(default=None, gt=0)
	transferred_on: date
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_accounts(self) -> CashTransferCreate:
		if self.from_account_id == self.to_account_id:
			raise ValueError("转出账户和转入账户不能相同。")
		return self


class CashTransferUpdate(BaseModel):
	from_account_id: int | None = Field(default=None, ge=1)
	to_account_id: int | None = Field(default=None, ge=1)
	source_amount: float | None = Field(default=None, gt=0)
	target_amount: float | None = Field(default=None, gt=0)
	transferred_on: date | None = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_accounts(self) -> CashTransferUpdate:
		if self.from_account_id is not None and self.from_account_id == self.to_account_id:
			raise ValueError("转出账户和转入账户不能相同。")
		return self


class CashTransferRead(UtcTimestampResponseModel):
	id: int
	from_account_id: int
	to_account_id: int
	source_amount: float
	target_amount: float
	source_currency: str
	target_currency: str
	transferred_on: date
	note: str | None = None
	created_at: datetime
	updated_at: datetime


class CashTransferApplyRead(UtcTimestampResponseModel):
	transfer: CashTransferRead
	from_account: CashAccountRead
	to_account: CashAccountRead


class CashLedgerAdjustmentCreate(BaseModel):
	cash_account_id: int = Field(ge=1)
	amount: float
	happened_on: date
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("amount")
	@classmethod
	def validate_amount(cls, value: float) -> float:
		if abs(value) <= 1e-12:
			raise ValueError("调整金额不能为 0。")
		return value

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class CashLedgerAdjustmentUpdate(BaseModel):
	amount: float | None = None
	happened_on: date | None = None
	note: Optional[str] = Field(default=None, max_length=500)

	@field_validator("amount")
	@classmethod
	def validate_amount(cls, value: float | None) -> float | None:
		if value is not None and abs(value) <= 1e-12:
			raise ValueError("调整金额不能为 0。")
		return value

	@field_validator("note", mode="before")
	@classmethod
	def normalize_note(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)


class CashLedgerAdjustmentApplyRead(UtcTimestampResponseModel):
	entry: CashLedgerEntryRead
	account: CashAccountRead


class AgentTaskCreate(BaseModel):
	task_type: str = Field(min_length=1, max_length=40)
	payload: dict[str, Any] = Field(default_factory=dict)

	@field_validator("task_type", mode="before")
	@classmethod
	def validate_task_type(cls, value: str | None) -> str | None:
		return _normalize_choice(value, AGENT_TASK_TYPES, "task_type")


class AgentTaskRead(UtcTimestampResponseModel):
	id: int
	request_source: str
	api_key_name: str | None = None
	agent_name: str | None = None
	task_type: str
	status: str
	payload: dict[str, Any]
	result: dict[str, Any] | None = None
	error_message: str | None = None
	created_at: datetime
	updated_at: datetime
	completed_at: datetime | None = None

	@field_validator("task_type", mode="before")
	@classmethod
	def validate_task_type(cls, value: str | None) -> str | None:
		return _normalize_choice(value, AGENT_TASK_TYPES, "task_type")

	@field_validator("status", mode="before")
	@classmethod
	def validate_status(cls, value: str | None) -> str | None:
		return _normalize_choice(value, AGENT_TASK_STATUSES, "status")


class AgentRegistrationRead(UtcTimestampResponseModel):
	id: int
	user_id: str
	name: str
	status: str
	request_count: int
	latest_api_key_name: str | None = None
	last_used_at: datetime | None = None
	last_seen_at: datetime | None = None
	created_at: datetime
	updated_at: datetime


class SecuritySearchRead(BaseModel):
	symbol: str
	name: str
	market: str
	currency: str
	exchange: Optional[str] = None
	source: Optional[str] = None


class SecurityQuoteRead(UtcTimestampResponseModel):
	symbol: str
	name: str
	market: str
	price: float
	currency: str
	market_time: datetime | None = None
	warnings: list[str]


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


class ValuedHolding(UtcTimestampResponseModel):
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
	timestamp_utc: datetime
	corrected: bool = False


class DashboardCorrectionCreate(BaseModel):
	series_scope: str = Field(min_length=1, max_length=32)
	symbol: str | None = Field(default=None, max_length=64)
	granularity: str = Field(min_length=3, max_length=8)
	bucket_utc: datetime
	action: str = Field(min_length=6, max_length=16)
	corrected_value: float | None = None
	reason: str = Field(min_length=1, max_length=500)

	@field_validator("series_scope", mode="before")
	@classmethod
	def validate_series_scope(cls, value: str | None) -> str | None:
		return _normalize_choice(value, DASHBOARD_SERIES_SCOPES, "series_scope")

	@field_validator("granularity", mode="before")
	@classmethod
	def validate_granularity(cls, value: str | None) -> str | None:
		if value is None:
			return None
		normalized = value.strip().lower()
		if normalized not in DASHBOARD_CORRECTION_GRANULARITIES:
			raise ValueError(
				f"granularity must be one of: {', '.join(DASHBOARD_CORRECTION_GRANULARITIES)}.",
			)
		return normalized

	@field_validator("action", mode="before")
	@classmethod
	def validate_action(cls, value: str | None) -> str | None:
		return _normalize_choice(value, DASHBOARD_CORRECTION_ACTIONS, "action")

	@field_validator("symbol", "reason", mode="before")
	@classmethod
	def normalize_optional_fields(cls, value: str | None) -> str | None:
		return _normalize_optional_text(value)

	@model_validator(mode="after")
	def validate_corrected_value(self) -> DashboardCorrectionCreate:
		if self.action == "OVERRIDE" and self.corrected_value is None:
			raise ValueError("corrected_value is required when action is OVERRIDE.")
		if self.action == "DELETE" and self.corrected_value is not None:
			raise ValueError("corrected_value must be omitted when action is DELETE.")
		if self.series_scope != "HOLDING_RETURN":
			self.symbol = None
		elif self.symbol is None:
			raise ValueError("symbol is required for HOLDING_RETURN corrections.")
		return self


class DashboardCorrectionRead(UtcTimestampResponseModel):
	id: int
	series_scope: str
	symbol: str | None = None
	granularity: str
	bucket_utc: datetime
	action: str
	corrected_value: float | None = None
	reason: str
	created_at: datetime
	updated_at: datetime


class AssetMutationAuditRead(UtcTimestampResponseModel):
	id: int
	actor_source: str
	api_key_name: str | None = None
	agent_name: str | None = None
	agent_task_id: int | None = None
	entity_type: str
	entity_id: int | None = None
	operation: str
	before_state: str | None = None
	after_state: str | None = None
	reason: str | None = None
	created_at: datetime


class AssetRecordRead(UtcTimestampResponseModel):
	id: int
	source: str
	api_key_name: str | None = None
	agent_name: str | None = None
	agent_task_id: int | None = None
	asset_class: str
	operation_kind: str
	entity_type: str
	entity_id: int | None = None
	title: str
	summary: str | None = None
	symbol: str | None = None
	effective_date: date | None = None
	amount: float | None = None
	currency: str | None = None
	profit_amount: float | None = None
	profit_currency: str | None = None
	profit_rate_pct: float | None = None
	created_at: datetime


class HoldingReturnSeries(BaseModel):
	symbol: str
	name: str
	quantity: float
	hour_series: list[TimelinePoint]
	day_series: list[TimelinePoint]
	month_series: list[TimelinePoint]
	year_series: list[TimelinePoint]


class DashboardResponse(BaseModel):
	server_today: date
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
	recent_holding_transactions: list[SecurityHoldingTransactionRead] = Field(default_factory=list)
	warnings: list[str]


class AgentContextRead(UtcTimestampResponseModel):
	user_id: str
	generated_at: datetime
	server_today: date
	total_value_cny: float
	cash_value_cny: float
	holdings_value_cny: float
	fixed_assets_value_cny: float
	liabilities_value_cny: float
	other_assets_value_cny: float
	usd_cny_rate: Optional[float] = None
	hkd_cny_rate: Optional[float] = None
	allocation: list[AllocationSlice]
	cash_accounts: list[ValuedCashAccount]
	holdings: list[ValuedHolding]
	recent_holding_transactions: list[SecurityHoldingTransactionRead]
	pending_history_sync_requests: int
	warnings: list[str]
