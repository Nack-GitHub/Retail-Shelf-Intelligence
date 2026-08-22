"""Celery application.

One queue, bounded retries, no dead-letter machinery: this is a demo, and the
job status on `inference_jobs` already answers "what happened to my photo".
"""

from __future__ import annotations

from celery import Celery

from app.core.config import settings
from app.core.logging import configure_logging

configure_logging()

celery_app = Celery(
    "shelfeye",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.analyze"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=120,
    task_soft_time_limit=90,
)
