from __future__ import annotations

import asyncio
import threading
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime

from app.schemas import DashboardResponse


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
current_agent_task_id_context: ContextVar[int | None] = ContextVar(
	"current_agent_task_id",
	default=None,
)
snapshot_rebuild_queue: asyncio.Queue[str] = asyncio.Queue()
snapshot_rebuild_users_in_queue: set[str] = set()
snapshot_rebuild_worker_task: asyncio.Task[None] | None = None
