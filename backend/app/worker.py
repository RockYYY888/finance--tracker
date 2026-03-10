from __future__ import annotations

import asyncio
import logging
import signal

from app.database import init_db
from app.services import core_support
from app.services.job_service import start_background_job_worker, stop_background_job_worker

logger = logging.getLogger(__name__)
settings = core_support.settings


async def run_worker() -> None:
	settings.validate_runtime()
	init_db()
	stop_event = asyncio.Event()
	loop = asyncio.get_running_loop()

	for sig in (signal.SIGINT, signal.SIGTERM):
		try:
			loop.add_signal_handler(sig, stop_event.set)
		except NotImplementedError:  # pragma: no cover - platform dependent
			logger.debug("Signal handlers are unavailable on this platform.")

	start_background_job_worker()
	try:
		await stop_event.wait()
	finally:
		await stop_background_job_worker()


def main() -> None:
	asyncio.run(run_worker())


if __name__ == "__main__":
	main()
