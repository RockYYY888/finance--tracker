"""Backward-compatible compatibility layer.

This module intentionally contains no business implementation. It only re-exports
the real service modules so older imports and `app.main.__getattr__` keep working
while tests and callers migrate to the split service layout.
"""

from app.database import engine
from app.models import utc_now
from app.runtime_state import (
	DashboardCacheEntry,
	LiveHoldingReturnPoint,
	LiveHoldingsReturnState,
	LivePortfolioState,
	background_job_worker_task,
	background_refresh_task,
	dashboard_cache,
	dashboard_cache_lock,
	get_last_global_force_refresh_at,
	global_force_refresh_lock,
	holding_history_sync_lock,
	live_holdings_return_states,
	live_portfolio_states,
	login_attempt_states,
	login_attempts_lock,
	set_last_global_force_refresh_at,
	snapshot_rebuild_queue,
	snapshot_rebuild_users_in_queue,
	snapshot_rebuild_worker_task,
)
from app.schemas import ValuedHolding
from app.services.agent_service import *  # noqa: F401,F403
from app.services.auth_service import *  # noqa: F401,F403
from app.services.common_service import *  # noqa: F401,F403
from app.services.dashboard_service import *  # noqa: F401,F403
from app.services.feedback_service import *  # noqa: F401,F403
from app.services.history_service import *  # noqa: F401,F403
from app.services.history_sync_service import *  # noqa: F401,F403
from app.services.inbox_service import *  # noqa: F401,F403
from app.services.legacy_service import *  # noqa: F401,F403
from app.services.portfolio_service import *  # noqa: F401,F403
from app.services.release_note_service import *  # noqa: F401,F403
from app.services.service_context import logger, market_data_client, settings
