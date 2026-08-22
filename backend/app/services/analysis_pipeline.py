"""Orchestrates one capture through inference and persistence.

Deliberately synchronous and free of Celery imports so it can be called
directly in tests. The worker in app/workers/analyze.py is a thin shell around
this function that adds retry policy and nothing else.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from shelfeye_contracts import InferResponse
from sqlalchemy.orm import Session

from app.adapters.ml_client import MLClient
from app.core.config import settings
from app.core.exceptions import (
    MLServiceError,
    NoShelfDetectedError,
    ShelfEyeError,
    UnreadableImageError,
)
from app.core.logging import get_logger
from app.db.models import (
    Capture,
    DetectionRow,
    GapFindingRow,
    InferenceJob,
    ShelfAnalysisRow,
)
from app.domain.enums import JobStatus
from app.domain.values import AnalysisConfig, BBox, Detection
from app.services import sku_catalog
from app.services.shelf_analysis import analyse

log = get_logger(__name__)


def analysis_config() -> AnalysisConfig:
    return AnalysisConfig(
        version=settings.analysis_config_version,
        min_confidence=settings.min_confidence,
        low_confidence_threshold=settings.low_confidence_threshold,
        row_tolerance_ratio=settings.row_tolerance_ratio,
        critical_threshold=settings.critical_threshold,
        low_threshold=settings.low_threshold,
    )


def run_analysis(session: Session, job_id: UUID, ml_client: MLClient) -> InferenceJob:
    """Infer, analyse and persist. Raises on retryable failure.

    A terminal failure (bad photo) is recorded on the job and returned normally,
    because there is nothing to retry — the rep must take a new picture. A
    transient failure propagates so the caller's retry policy can act.
    """
    job = session.get(InferenceJob, job_id)
    if job is None:
        raise ShelfEyeError(f"job {job_id} not found")

    capture = session.get(Capture, job.capture_id)
    if capture is None or not capture.object_key:
        raise ShelfEyeError(f"capture for job {job_id} has no object key")

    job.status = JobStatus.RUNNING
    job.started_at = datetime.now(UTC)
    job.attempts += 1
    session.commit()

    image_uri = f"s3://{settings.s3_bucket}/{capture.object_key}"
    request_id = uuid4()

    try:
        response = ml_client.infer(image_uri, request_id)
    except (NoShelfDetectedError, UnreadableImageError) as exc:
        # Terminal. Retrying an unreadable photo produces an unreadable photo.
        _fail(session, job, exc)
        return job
    except MLServiceError:
        # Transient. Let it bubble so the retry policy sees it.
        job.status = JobStatus.QUEUED
        session.commit()
        raise

    try:
        _persist(session, capture, job, response)
    except NoShelfDetectedError as exc:
        # The model returned boxes but none that support a judgement — e.g.
        # price tags only. Still the rep's cue to retake, not a perfect shelf.
        _fail(session, job, exc)
        return job

    job.status = JobStatus.DONE
    job.model_version = response.model_version
    job.inference_ms = response.inference_ms
    job.finished_at = datetime.now(UTC)
    job.error_code = None
    job.error_detail = None
    session.commit()

    log.info(
        "analysis_done",
        job_id=str(job.id),
        capture_id=str(capture.id),
        model_version=response.model_version,
        detections=len(response.detections),
    )
    return job


def _fail(session: Session, job: InferenceJob, exc: ShelfEyeError) -> None:
    job.status = JobStatus.FAILED
    job.error_code = exc.code
    job.error_detail = exc.detail
    job.finished_at = datetime.now(UTC)
    session.commit()
    log.warning("analysis_failed", job_id=str(job.id), error_code=exc.code)


def _persist(
    session: Session, capture: Capture, job: InferenceJob, response: InferResponse
) -> None:
    """Write detections, the analysis, and the findings. All append-only."""
    config = analysis_config()

    domain_detections = [
        Detection(
            detection_id=d.detection_id,
            class_id=d.class_id,
            class_name=d.class_name,
            semantic_type=d.semantic_type,
            bbox=BBox(x=d.bbox.x, y=d.bbox.y, w=d.bbox.w, h=d.bbox.h),
            confidence=d.confidence,
        )
        for d in response.detections
    ]

    # Analyse BEFORE inserting: a NoShelfDetectedError here means we write
    # nothing at all rather than orphan detections with no analysis.
    result = analyse(
        domain_detections,
        config,
        image_width=response.image_width,
        image_height=response.image_height,
    )

    if not capture.image_width:
        capture.image_width = response.image_width
        capture.image_height = response.image_height

    detection_rows = {
        d.detection_id: DetectionRow(
            id=d.detection_id,
            capture_id=capture.id,
            model_version=response.model_version,
            class_id=d.class_id,
            class_name=d.class_name,
            semantic_type=d.semantic_type.value,
            bbox_x=d.bbox.x,
            bbox_y=d.bbox.y,
            bbox_w=d.bbox.w,
            bbox_h=d.bbox.h,
            confidence=d.confidence,
            shelf_row_index=result.row_index_by_detection.get(d.detection_id),
        )
        for d in domain_detections
    }
    session.add_all(detection_rows.values())

    session.add(
        ShelfAnalysisRow(
            capture_id=capture.id,
            model_version=response.model_version,
            row_count=result.row_count,
            total_shelf_area=result.total_shelf_area,
            gap_area=result.gap_area,
            gap_ratio=result.gap_ratio,
            osa_score=result.osa_score,
            status=result.status.value,
            low_confidence_count=result.low_confidence_count,
            config_version=result.config_version,
        )
    )

    for position, finding in enumerate(result.findings):
        sku_code, sku_name, brand, priority, facings = sku_catalog.lookup(
            finding.shelf_row_index, position
        )
        session.add(
            GapFindingRow(
                capture_id=capture.id,
                detection_id=finding.detection_id,
                shelf_row_index=finding.shelf_row_index,
                position_label=finding.position_label,
                confidence=finding.confidence,
                is_low_confidence=finding.is_low_confidence,
                sku_code=sku_code,
                sku_name=sku_name,
                sku_brand=brand,
                priority=priority,
                facings=facings,
            )
        )

    session.flush()

    # osa_before is the visit's first BEFORE-phase reading; later captures in
    # the same visit must not overwrite it.
    if capture.phase == "BEFORE":
        visit = capture.visit
        if visit is not None and visit.osa_before is None:
            visit.osa_before = round(result.osa_score, 4)
