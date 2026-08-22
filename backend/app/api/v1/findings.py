"""Gap verification. The rep is the ground truth, not the model."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage_client import get_storage
from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import VerifyRequest
from app.db.models import AuditLog, Capture, GapFindingRow, TaskRow, User
from app.domain.enums import TaskStatus, VerificationStatus

router = APIRouter(tags=["findings"])


@router.post("/findings/{finding_id}/verify")
async def verify_finding(
    finding_id: UUID,
    body: VerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Confirm or reject a gap.

    Idempotent: a phone retrying on a flaky connection must not create two
    tasks for one gap. A CONFIRMED finding creates the replenishment task; a
    REJECTED one records the reason, which is training signal for the next
    model rather than noise to be discarded.
    """
    finding = (
        await db.execute(select(GapFindingRow).where(GapFindingRow.id == finding_id))
    ).scalar_one_or_none()
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบรายการที่ต้องตรวจสอบ")

    # verdict and reason are Literal-typed on the schema, so an invalid
    # value is rejected as a 422 before this function runs.
    verdict = body.verdict

    if finding.verification_status == verdict:
        existing = (
            await db.execute(select(TaskRow).where(TaskRow.gap_finding_id == finding.id))
        ).scalar_one_or_none()
        return {
            "findingId": str(finding.id),
            "verdict": verdict,
            "taskId": str(existing.id) if existing else None,
            "idempotent": True,
        }

    before = {"verification_status": finding.verification_status}
    finding.verification_status = verdict
    finding.rejected_reason = body.reason
    finding.verified_by = user.id
    finding.verified_at = datetime.now(UTC)

    task_id: UUID | None = None
    if verdict == VerificationStatus.REJECTED:
        # A rep who confirms and then corrects themselves must not leave work
        # behind for a gap they have just said is not a gap. Without this the
        # task list shows phantom work and checkout counts it.
        existing_task = (
            await db.execute(select(TaskRow).where(TaskRow.gap_finding_id == finding.id))
        ).scalar_one_or_none()
        if existing_task is not None:
            await db.delete(existing_task)

    if verdict == VerificationStatus.CONFIRMED:
        capture = (
            await db.execute(select(Capture).where(Capture.id == finding.capture_id))
        ).scalar_one()
        task = TaskRow(
            visit_id=capture.visit_id,
            gap_finding_id=finding.id,
            sku_code=finding.sku_code,
            priority=finding.priority,
            status=TaskStatus.OPEN,
        )
        db.add(task)
        await db.flush()
        task_id = task.id

    db.add(
        AuditLog(
            actor_id=user.id,
            actor_role=user.role,
            action=f"FINDING_{verdict}",
            entity_type="gap_finding",
            entity_id=str(finding.id),
            before=before,
            after={"verification_status": verdict, "rejected_reason": finding.rejected_reason},
            ip=request.client.host if request.client else None,
        )
    )
    await db.commit()

    return {
        "findingId": str(finding.id),
        "verdict": verdict,
        "taskId": str(task_id) if task_id else None,
        "idempotent": False,
    }


@router.get("/evidence/{finding_id}")
async def get_evidence(
    finding_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    """Signed URL plus the overlay data needed to redraw the box.

    Every number a manager sees must be traceable back to the pixels that
    produced it, along with the model version that made the call.
    """
    finding = (
        await db.execute(select(GapFindingRow).where(GapFindingRow.id == finding_id))
    ).scalar_one_or_none()
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบหลักฐาน")

    capture = (
        await db.execute(select(Capture).where(Capture.id == finding.capture_id))
    ).scalar_one()
    from app.db.models import DetectionRow

    detection = (
        await db.execute(select(DetectionRow).where(DetectionRow.id == finding.detection_id))
    ).scalar_one_or_none()

    return {
        "findingId": str(finding.id),
        "captureId": str(capture.id),
        "imageUrl": get_storage().presign_get(capture.object_key) if capture.object_key else None,
        "imageWidth": capture.image_width,
        "imageHeight": capture.image_height,
        "capturedAt": capture.captured_at.isoformat() if capture.captured_at else None,
        "positionLabel": finding.position_label,
        "confidence": finding.confidence,
        "isLowConfidence": finding.is_low_confidence,
        "verificationStatus": finding.verification_status,
        "modelVersion": detection.model_version if detection else None,
        "bbox": (
            {
                "x": detection.bbox_x,
                "y": detection.bbox_y,
                "w": detection.bbox_w,
                "h": detection.bbox_h,
            }
            if detection
            else None
        ),
    }
