"""Push notification on job completion.

A no-op adapter behind a real interface: the mobile client polls
GET /v1/jobs/{id} every 500ms while the rep waits, so push adds nothing to the
demo. Wiring FCM later means implementing this one method.
"""

from __future__ import annotations

from uuid import UUID

from app.core.logging import get_logger

log = get_logger(__name__)


class NotificationClient:
    def notify_job_done(self, *, capture_id: UUID, job_id: UUID, status: str) -> None:
        log.info("notify_job_done", capture_id=str(capture_id), job_id=str(job_id), status=status)


def get_notifier() -> NotificationClient:
    return NotificationClient()
