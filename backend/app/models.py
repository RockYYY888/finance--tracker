from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel
from sqlalchemy import UniqueConstraint

CASH_ACCOUNT_TYPES = ("ALIPAY", "WECHAT", "BANK", "CASH", "OTHER")
SECURITY_MARKETS = ("CN", "HK", "US", "FUND", "CRYPTO", "OTHER")
HOLDING_TRANSACTION_SIDES = ("BUY", "SELL", "ADJUST")
SELL_PROCEEDS_HANDLINGS = ("DISCARD", "ADD_TO_EXISTING_CASH", "CREATE_NEW_CASH")
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
DASHBOARD_SERIES_SCOPES = ("PORTFOLIO_TOTAL", "HOLDINGS_RETURN_TOTAL", "HOLDING_RETURN")
DASHBOARD_CORRECTION_ACTIONS = ("OVERRIDE", "DELETE")
DASHBOARD_CORRECTION_GRANULARITIES = ("hour", "day", "month", "year")
ASSET_MUTATION_OPERATIONS = ("CREATE", "UPDATE", "DELETE")
HOLDING_HISTORY_SYNC_STATUSES = ("PENDING", "RUNNING", "DONE")
FEEDBACK_CATEGORIES = ("USER_REQUEST", "SYSTEM_ALERT", "SYSTEM_HEARTBEAT", "SYSTEM_TASK")
FEEDBACK_PRIORITIES = ("LOW", "MEDIUM", "HIGH")
FEEDBACK_SOURCES = ("USER", "SYSTEM", "API_MONITOR", "TRADING_AGENT", "ADMIN")
FEEDBACK_STATUSES = ("OPEN", "ACKED", "IN_PROGRESS", "SILENCED", "RESOLVED")
INBOX_MESSAGE_KINDS = ("FEEDBACK", "RELEASE_NOTE")


def utc_now() -> datetime:
	"""Return the current UTC timestamp."""
	return datetime.now(timezone.utc)


class UserAccount(SQLModel, table=True):
	username: str = Field(primary_key=True, max_length=32)
	email: str | None = Field(default=None, max_length=320, index=True)
	password_digest: str = Field(max_length=512)
	email_digest: str | None = Field(default=None, max_length=64, index=True)
	created_at: datetime = Field(default_factory=utc_now, nullable=False)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class AgentAccessToken(SQLModel, table=True):
	__table_args__ = (
		UniqueConstraint(
			"token_digest",
			name="uq_agent_access_token_digest",
		),
	)

	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	name: str = Field(max_length=80)
	token_digest: str = Field(index=True, max_length=64)
	token_hint: str = Field(max_length=16)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	last_used_at: datetime | None = Field(default=None, index=True)
	expires_at: datetime | None = Field(default=None, index=True)
	revoked_at: datetime | None = Field(default=None, index=True)


class UserFeedback(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	message: str = Field(max_length=1000)
	category: str = Field(default="USER_REQUEST", index=True, max_length=32)
	priority: str = Field(default="MEDIUM", index=True, max_length=16)
	source: str = Field(default="USER", index=True, max_length=32)
	status: str = Field(default="OPEN", index=True, max_length=16)
	reply_message: str | None = Field(default=None, max_length=2000)
	replied_at: datetime | None = Field(default=None, index=True)
	replied_by: str | None = Field(default=None, max_length=32)
	reply_seen_at: datetime | None = Field(default=None, index=True)
	resolved_at: datetime | None = Field(default=None, index=True)
	closed_by: str | None = Field(default=None, max_length=32)
	assignee: str | None = Field(default=None, index=True, max_length=32)
	acknowledged_at: datetime | None = Field(default=None, index=True)
	acknowledged_by: str | None = Field(default=None, max_length=32)
	ack_deadline: datetime | None = Field(default=None, index=True)
	internal_note: str | None = Field(default=None, max_length=3000)
	internal_note_updated_at: datetime | None = Field(default=None, index=True)
	internal_note_updated_by: str | None = Field(default=None, max_length=32)
	fingerprint: str | None = Field(default=None, index=True, max_length=96)
	dedupe_window_minutes: int | None = Field(default=None)
	occurrence_count: int = Field(default=1)
	last_seen_at: datetime | None = Field(default=None, index=True)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)


class InboxMessageVisibility(SQLModel, table=True):
	__table_args__ = (
		UniqueConstraint(
			"user_id",
			"message_kind",
			"message_id",
			name="uq_inbox_message_visibility_user_kind_message",
		),
	)

	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	message_kind: str = Field(index=True, max_length=24)
	message_id: int = Field(index=True)
	hidden_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)


class ReleaseNote(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	version: str = Field(index=True, max_length=32)
	title: str = Field(max_length=120)
	content: str = Field(max_length=6000)
	source_feedback_ids_json: str | None = Field(default=None, max_length=2000)
	created_by: str = Field(index=True, max_length=32)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	published_at: datetime | None = Field(default=None, index=True)


class ReleaseNoteDelivery(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	release_note_id: int = Field(index=True)
	user_id: str = Field(index=True, max_length=32)
	delivered_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	seen_at: datetime | None = Field(default=None, index=True)


class HoldingHistorySyncRequest(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	status: str = Field(default="PENDING", max_length=16, index=True)
	trigger_symbol: str | None = Field(default=None, max_length=32)
	error_message: str | None = Field(default=None, max_length=500)
	requested_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	started_at: datetime | None = Field(default=None, index=True)
	completed_at: datetime | None = Field(default=None, index=True)


class CashAccount(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
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
	user_id: str = Field(index=True, max_length=32)
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


class SecurityHoldingTransaction(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	symbol: str = Field(index=True)
	name: str
	side: str = Field(default="BUY", index=True, max_length=12)
	quantity: float = Field(gt=0)
	price: float | None = Field(default=None)
	fallback_currency: str = Field(default="CNY", max_length=8)
	market: str = Field(default="OTHER", max_length=16)
	broker: Optional[str] = Field(default=None, max_length=120)
	traded_on: date = Field(index=True)
	note: Optional[str] = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class FixedAsset(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
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
	user_id: str = Field(index=True, max_length=32)
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
	user_id: str = Field(index=True, max_length=32)
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
	user_id: str = Field(index=True, max_length=32)
	total_value_cny: float = Field(default=0)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)


class HoldingPerformanceSnapshot(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	scope: str = Field(default="TOTAL", max_length=16, index=True)
	symbol: Optional[str] = Field(default=None, index=True)
	name: Optional[str] = Field(default=None, max_length=120)
	return_pct: float = Field(default=0)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)


class DashboardCorrection(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	series_scope: str = Field(index=True, max_length=32)
	symbol: Optional[str] = Field(default=None, index=True, max_length=64)
	granularity: str = Field(index=True, max_length=8)
	bucket_utc: datetime = Field(nullable=False, index=True)
	action: str = Field(max_length=16)
	corrected_value: float | None = Field(default=None)
	reason: str = Field(max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
	updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class AssetMutationAudit(SQLModel, table=True):
	id: Optional[int] = Field(default=None, primary_key=True)
	user_id: str = Field(index=True, max_length=32)
	actor_user_id: str = Field(index=True, max_length=32)
	entity_type: str = Field(index=True, max_length=32)
	entity_id: int | None = Field(default=None, index=True)
	operation: str = Field(index=True, max_length=16)
	before_state: str | None = Field(default=None)
	after_state: str | None = Field(default=None)
	reason: str | None = Field(default=None, max_length=500)
	created_at: datetime = Field(default_factory=utc_now, nullable=False, index=True)
