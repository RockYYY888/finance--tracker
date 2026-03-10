from __future__ import annotations

from sqlmodel import Session

from app.database import engine
from app.services import job_service


def schedule_user_portfolio_snapshot_rebuild(user_id: str) -> None:
	with Session(engine) as session:
		job_service.enqueue_user_portfolio_snapshot_rebuild(session, user_id)
		session.commit()


async def process_user_snapshot_rebuild_if_pending(
	session: Session,
	user_id: str,
) -> bool:
	return False


async def snapshot_rebuild_worker() -> None:
	await job_service.background_job_worker()


def start_snapshot_rebuild_worker():
	return job_service.start_background_job_worker()


async def stop_snapshot_rebuild_worker() -> None:
	await job_service.stop_background_job_worker()
