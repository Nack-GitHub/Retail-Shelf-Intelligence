"""The inference task.

A thin shell around `services.analysis_pipeline.run_analysis`. The only thing
this file adds is retry policy — all the logic lives in the service so it can
be tested without a broker.

Retry rules follow the error's nature, not its convenience:
  • MLServiceError (5xx / timeout)  -> retry at 2s, 8s, 32s
  • Unreadable image / no shelf     -> NEVER retry; the photo is the problem
"""

from __future__ import annotations

from uuid import UUID

from celery import Task

from app.adapters.ml_client import build_ml_client
from app.adapters.notifications import get_notifier
from app.core.config import settings
from app.core.exceptions import MLServiceError
from app.core.logging import get_logger, set_request_id
from app.workers.celery_app import celery_app
from app.workers.session import SyncSessionFactory

log = get_logger(__name__)


@celery_app.task(bind=True, name="shelfeye.analyze_capture", max_retries=settings.ml_max_retries)
def analyze_capture(self: Task, job_id: str, request_id: str | None = None) -> dict:
    from app.services.analysis_pipeline import run_analysis

    set_request_id(request_id)
    session = SyncSessionFactory()
    try:
        job = run_analysis(session, UUID(job_id), build_ml_client())
        get_notifier().notify_job_done(capture_id=job.capture_id, job_id=job.id, status=job.status)
        return {"job_id": job_id, "status": job.status, "error_code": job.error_code}
    except MLServiceError as exc:
        attempt = self.request.retries
        backoff = settings.ml_retry_backoff_seconds
        if attempt >= len(backoff):
            log.error("analysis_retries_exhausted", job_id=job_id, attempts=attempt)
            _mark_failed(session, UUID(job_id), "ML_UNAVAILABLE", str(exc))
            return {"job_id": job_id, "status": "FAILED", "error_code": "ML_UNAVAILABLE"}
        delay = backoff[attempt]
        log.warning("analysis_retry", job_id=job_id, attempt=attempt, delay=delay)
        raise self.retry(exc=exc, countdown=delay) from exc
    finally:
        session.close()


def _mark_failed(session, job_id: UUID, code: str, detail: str) -> None:
    from datetime import UTC, datetime

    from app.db.models import InferenceJob
    from app.domain.enums import JobStatus

    job = session.get(InferenceJob, job_id)
    if job is not None:
        job.status = JobStatus.FAILED
        job.error_code = code
        job.error_detail = detail[:2000]
        job.finished_at = datetime.now(UTC)
        session.commit()
