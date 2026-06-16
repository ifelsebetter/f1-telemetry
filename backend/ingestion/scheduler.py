"""Periodic ingestion scheduler.

Uses APScheduler's ``AsyncIOScheduler`` to pull telemetry at a configurable
interval.  The scheduler is attached to the FastAPI lifespan so it starts and
stops cleanly with the application.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.config import settings

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _default_ingestion_job() -> None:
    """Placeholder ingestion job.

    In a fully-configured deployment this would call
    ``FastF1Client.fetch_session_telemetry`` for the latest session and
    push results through the processing pipeline.  The actual wiring is
    done in ``backend.main`` at startup time.
    """
    logger.info("Scheduled ingestion tick (no-op — configure via app startup)")


def get_scheduler() -> AsyncIOScheduler:
    """Return the module-level scheduler singleton (lazy-init)."""
    global _scheduler  # noqa: PLW0603
    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
    return _scheduler


def start_scheduler(
    job_func: object | None = None,
    interval_seconds: int | None = None,
) -> None:
    """Start the ingestion scheduler.

    Parameters
    ----------
    job_func:
        Async callable to execute on each tick.  Falls back to the
        built-in no-op placeholder.
    interval_seconds:
        Override for the configured interval.
    """
    if not settings.enable_scheduled_ingestion:
        logger.info("Scheduled ingestion disabled — skipping scheduler start")
        return

    scheduler = get_scheduler()
    func = job_func or _default_ingestion_job
    interval = interval_seconds or settings.ingestion_interval_seconds

    scheduler.add_job(
        func,
        "interval",
        seconds=interval,
        id="telemetry_ingestion",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Ingestion scheduler started (interval=%ds)", interval)


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler if it is running."""
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Ingestion scheduler stopped")
