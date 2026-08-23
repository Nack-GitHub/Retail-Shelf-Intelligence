"""Capture presign, commit, and result — the core of the product."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage_client import get_storage
from app.api.v1.deps import current_user, get_db, owns_or_supervises
from app.api.v1.schemas import (
    BBoxOut,
    CaptureCommit,
    DetectionOut,
    GapFindingOut,
    JobAccepted,
    JobOut,
    PresignRequest,
    PresignResponse,
    ShelfAnalysisOut,
)
from app.core.config import settings
from app.core.logging import get_request_id
from app.db.models import (
    Capture,
    DetectionRow,
    GapFindingRow,
    InferenceJob,
    ShelfAnalysisRow,
    User,
    Visit,
)
from app.domain.enums import JobStatus

router = APIRouter(tags=["captures"])

_PROGRESS = {
    JobStatus.QUEUED: "กำลังรอคิว",
    JobStatus.RUNNING: "กำลังวิเคราะห์ภาพ",
    JobStatus.DONE: "วิเคราะห์เสร็จแล้ว",
    JobStatus.FAILED: "วิเคราะห์ไม่สำเร็จ",
}

_USER_MESSAGE = {
    "NO_SHELF_DETECTED": "ไม่พบชั้นวางในภาพ กรุณาถ่ายใหม่โดยให้เห็นชั้นวางเต็มภาพ",
    "UNREADABLE_IMAGE": "ภาพไม่ชัดหรือเสียหาย กรุณาถ่ายใหม่",
    "ML_UNAVAILABLE": "ระบบวิเคราะห์ไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง",
}


@router.post("/captures/presign", response_model=PresignResponse)
async def presign(
    body: PresignRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> PresignResponse:
    """Issue a presigned PUT. Image bytes never pass through this process."""
    visit = (await db.execute(select(Visit).where(Visit.id == body.visit_id))).scalar_one_or_none()
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบการเข้าร้าน")

    # A write grant against someone else's visit would let any account attach
    # a photograph — and the OSA score and findings derived from it — to a
    # store they never entered, under another person's name.
    if not owns_or_supervises(user, visit.user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ไม่สามารถถ่ายภาพในการเข้าร้านของผู้อื่นได้")

    capture = Capture(
        visit_id=visit.id,
        category=body.category,
        shelf_bay_label=body.shelf_bay_label,
        phase=body.phase,
        retention_expires_at=datetime.now(UTC) + timedelta(days=settings.retention_days),
    )
    db.add(capture)
    await db.flush()

    storage = get_storage()
    object_key = storage.build_object_key(capture.id, body.content_type, body.shelf_bay_label)
    capture.object_key = object_key
    await db.commit()

    return PresignResponse(
        capture_id=capture.id,
        upload_url=storage.presign_put(object_key, body.content_type),
        object_key=object_key,
        expires_in=settings.presign_expiry_seconds,
    )


@router.post(
    "/captures/{capture_id}/commit",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def commit(
    capture_id: UUID,
    body: CaptureCommit,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> JobAccepted:
    """Record upload completion and enqueue analysis.

    Idempotent by header: a phone that loses signal mid-request will retry, and
    that must not produce two jobs for one photo.
    """
    existing = (
        await db.execute(select(Capture).where(Capture.client_idempotency_key == idempotency_key))
    ).scalar_one_or_none()
    if existing is not None:
        job = (
            (
                await db.execute(
                    select(InferenceJob)
                    .where(InferenceJob.capture_id == existing.id)
                    .order_by(InferenceJob.queued_at.desc())
                )
            )
            .scalars()
            .first()
        )
        if job is not None:
            return JobAccepted(job_id=job.id, capture_id=existing.id, status=job.status)

    capture = (
        await db.execute(select(Capture).where(Capture.id == capture_id))
    ).scalar_one_or_none()
    if capture is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบภาพที่อัปโหลด")

    capture.image_width = body.image_width
    capture.image_height = body.image_height
    capture.captured_at = body.captured_at or datetime.now(UTC)
    capture.device_info = body.device_info
    # PDPA deferred: recorded when the client sends it, not gated on.
    capture.face_blur_applied = body.face_blur_applied
    capture.face_blur_count = body.face_blur_count
    capture.client_idempotency_key = idempotency_key

    job = InferenceJob(capture_id=capture.id, status=JobStatus.QUEUED)
    db.add(job)
    await db.commit()

    _enqueue(job.id)
    return JobAccepted(job_id=job.id, capture_id=capture.id, status=job.status)


def _enqueue(job_id: UUID) -> None:
    """Hand the job to the worker. Import is local so the API can boot without a broker."""
    from app.workers.analyze import analyze_capture

    analyze_capture.delay(str(job_id), get_request_id())


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(
    job_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> JobOut:
    job = (
        await db.execute(select(InferenceJob).where(InferenceJob.id == job_id))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบงานวิเคราะห์")

    return JobOut(
        id=job.id,
        capture_id=job.capture_id,
        status=job.status,
        progress_hint=_PROGRESS.get(JobStatus(job.status), ""),
        error_code=job.error_code,
        user_message=_USER_MESSAGE.get(job.error_code or "") if job.error_code else None,
        result_url=f"/v1/captures/{job.capture_id}/result"
        if job.status == JobStatus.DONE
        else None,
    )


@router.get("/captures/{capture_id}/result", response_model=ShelfAnalysisOut)
async def get_result(
    capture_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> ShelfAnalysisOut:
    """The latest analysis for this capture.

    Ordered by computed_at DESC because the table is append-only: re-running
    inference with a newer model adds a row rather than replacing one, and the
    UI wants the current verdict.
    """
    analysis = (
        (
            await db.execute(
                select(ShelfAnalysisRow)
                .where(ShelfAnalysisRow.capture_id == capture_id)
                .order_by(ShelfAnalysisRow.computed_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if analysis is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ยังไม่มีผลวิเคราะห์สำหรับภาพนี้")

    capture = (await db.execute(select(Capture).where(Capture.id == capture_id))).scalar_one()
    job = (
        (
            await db.execute(
                select(InferenceJob)
                .where(InferenceJob.capture_id == capture_id)
                .order_by(InferenceJob.queued_at.desc())
            )
        )
        .scalars()
        .first()
    )

    detections = (
        (
            await db.execute(
                # Scope to the analysis's OWN run. Filtering by model_version
                # would merge every run of that version — re-inference appends
                # rather than replaces, so the overlay would draw each box twice.
                select(DetectionRow).where(DetectionRow.run_id == analysis.run_id)
            )
        )
        .scalars()
        .all()
    )

    findings = (
        (
            await db.execute(
                select(GapFindingRow)
                .where(GapFindingRow.run_id == analysis.run_id)
                .order_by(GapFindingRow.shelf_row_index, GapFindingRow.position_label)
            )
        )
        .scalars()
        .all()
    )

    return ShelfAnalysisOut(
        capture_id=capture_id,
        model_version=analysis.model_version,
        image_url=get_storage().presign_get(capture.object_key) if capture.object_key else None,
        image_width=capture.image_width or 0,
        image_height=capture.image_height or 0,
        row_count=analysis.row_count,
        gap_ratio=analysis.gap_ratio,
        osa_score=analysis.osa_score,
        status=analysis.status,
        inference_ms=job.inference_ms if job and job.inference_ms else 0,
        low_confidence_count=analysis.low_confidence_count,
        detections=[
            DetectionOut(
                detection_id=d.id,
                class_id=d.class_id,
                class_name=d.class_name,
                semantic_type=d.semantic_type,
                bbox=BBoxOut(x=d.bbox_x, y=d.bbox_y, w=d.bbox_w, h=d.bbox_h),
                confidence=d.confidence,
                shelf_row_index=d.shelf_row_index,
            )
            for d in detections
        ],
        gap_findings=[
            GapFindingOut(
                id=f.id,
                detection_id=f.detection_id,
                shelf_row_index=f.shelf_row_index,
                position_label=f.position_label,
                confidence=f.confidence,
                is_low_confidence=f.is_low_confidence,
                verification_status=f.verification_status,
                rejected_reason=f.rejected_reason,
                sku_code=f.sku_code,
                sku_name=f.sku_name,
                sku_brand=f.sku_brand,
                priority=f.priority,
                facings=f.facings,
            )
            for f in findings
        ],
    )
