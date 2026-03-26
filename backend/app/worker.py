from __future__ import annotations

import asyncio
import logging
import signal

from app.runtime_state import validate_runtime_redis_connection
from app.services.job_service import start_background_job_worker, stop_background_job_worker
from app.services import realtime_analytics_service, service_context

logger = logging.getLogger(__name__)
settings = service_context.settings


async def run_worker() -> None:
	settings.validate_runtime()
	validate_runtime_redis_connection()
	stop_event = asyncio.Event()
	loop = asyncio.get_running_loop()

	for sig in (signal.SIGINT, signal.SIGTERM):
		try:
			loop.add_signal_handler(sig, stop_event.set)
		except NotImplementedError:  # pragma: no cover - platform dependent
			logger.debug("Signal handlers are unavailable on this platform.")

	start_background_job_worker()
	realtime_analytics_service.start_realtime_analytics_sampler()
	try:
		await stop_event.wait()
	finally:
		await realtime_analytics_service.stop_realtime_analytics_sampler()
		await stop_background_job_worker()


def main() -> None:
	asyncio.run(run_worker())


if __name__ == "__main__":
	main()
