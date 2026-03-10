from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from sqlmodel import Session

from app.database import engine
from app import runtime_state

logger = logging.getLogger(__name__)


def schedule_user_portfolio_snapshot_rebuild(user_id: str) -> None:
	normalized_user_id = user_id.strip()
	if not normalized_user_id or normalized_user_id in runtime_state.snapshot_rebuild_users_in_queue:
		return
	runtime_state.snapshot_rebuild_users_in_queue.add(normalized_user_id)
	runtime_state.snapshot_rebuild_queue.put_nowait(normalized_user_id)


async def process_user_snapshot_rebuild_if_pending(
	session: Session,
	user_id: str,
) -> bool:
	normalized_user_id = user_id.strip()
	if (
		not normalized_user_id
		or normalized_user_id not in runtime_state.snapshot_rebuild_users_in_queue
	):
		return False

	runtime_state.snapshot_rebuild_users_in_queue.discard(normalized_user_id)
	from app.services import legacy_service

	await legacy_service._rebuild_user_portfolio_snapshots(session, normalized_user_id)
	return True


async def _consume_snapshot_rebuild_queue_item(user_id: str) -> None:
	if user_id not in runtime_state.snapshot_rebuild_users_in_queue:
		return

	runtime_state.snapshot_rebuild_users_in_queue.discard(user_id)
	from app.services import legacy_service

	with Session(engine) as session:
		await legacy_service._rebuild_user_portfolio_snapshots(session, user_id)
		session.commit()
		legacy_service._invalidate_dashboard_cache(user_id)


async def snapshot_rebuild_worker() -> None:
	while True:
		user_id = await runtime_state.snapshot_rebuild_queue.get()
		try:
			await _consume_snapshot_rebuild_queue_item(user_id)
		except Exception:  # pragma: no cover - defensive worker path
			logger.exception("Portfolio snapshot rebuild worker failed for user %s", user_id)
		finally:
			runtime_state.snapshot_rebuild_queue.task_done()


def start_snapshot_rebuild_worker() -> asyncio.Task[None]:
	if (
		runtime_state.snapshot_rebuild_worker_task is None
		or runtime_state.snapshot_rebuild_worker_task.done()
	):
		runtime_state.snapshot_rebuild_worker_task = asyncio.create_task(snapshot_rebuild_worker())
	return runtime_state.snapshot_rebuild_worker_task


async def stop_snapshot_rebuild_worker() -> None:
	if runtime_state.snapshot_rebuild_worker_task is None:
		return
	runtime_state.snapshot_rebuild_worker_task.cancel()
	with suppress(asyncio.CancelledError):
		await runtime_state.snapshot_rebuild_worker_task
	runtime_state.snapshot_rebuild_worker_task = None
