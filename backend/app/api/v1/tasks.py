"""Replenishment tasks."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import TaskOut, TaskPatch
from app.db.models import GapFindingRow, ReplenishmentRequest, TaskRow, User, Visit
from app.domain.enums import BlockedReason, TaskStatus

router = APIRouter(tags=["tasks"])


@router.get("/visits/{visit_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    visit_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> list[TaskOut]:
    rows = (
        await db.execute(
            select(TaskRow, GapFindingRow)
            .join(GapFindingRow, GapFindingRow.id == TaskRow.gap_finding_id)
            .where(TaskRow.visit_id == visit_id)
            .order_by(TaskRow.priority, GapFindingRow.shelf_row_index)
        )
    ).all()

    return [
        TaskOut(
            id=task.id,
            finding_id=finding.id,
            sku_code=finding.sku_code,
            sku_name=finding.sku_name,
            sku_brand=finding.sku_brand,
            position_label=finding.position_label,
            priority=finding.priority,
            facings=finding.facings,
            status=task.status,
            blocked_reason=task.blocked_reason,
        )
        for task, finding in rows
    ]


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: UUID,
    body: TaskPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> TaskOut:
    """Mark a task fixed or blocked.

    OUT_OF_BACKSTOCK auto-raises a replenishment request: the rep has already
    discovered the shelf is empty AND the stockroom is empty, and making them
    file that separately is how the information gets lost.
    """
    task = (await db.execute(select(TaskRow).where(TaskRow.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบงาน")

    # status and blocked_reason are Literal-typed on the schema.
    new_status = body.status

    if new_status == TaskStatus.BLOCKED:
        if not body.blocked_reason:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "ต้องระบุเหตุผลที่ทำไม่ได้")
        reason = body.blocked_reason
        task.blocked_reason = reason

        if reason == BlockedReason.OUT_OF_BACKSTOCK:
            visit = (await db.execute(select(Visit).where(Visit.id == task.visit_id))).scalar_one()
            already = (
                await db.execute(
                    select(ReplenishmentRequest).where(
                        ReplenishmentRequest.source_task_id == task.id
                    )
                )
            ).scalar_one_or_none()
            if already is None:
                db.add(
                    ReplenishmentRequest(
                        store_id=visit.store_id,
                        sku_code=task.sku_code,
                        source_task_id=task.id,
                    )
                )
    else:
        task.blocked_reason = None

    task.status = new_status
    task.after_capture_id = body.after_capture_id
    # Stamp the FIRST time this task left OPEN, not the latest write. The
    # offline queue replays this endpoint, and completed_at feeds the
    # detection-to-restock KPI: a task closed in the shop and drained an hour
    # later would otherwise report a one-hour restock that never happened.
    if new_status == TaskStatus.OPEN:
        task.completed_at = None
    elif task.completed_at is None:
        task.completed_at = datetime.now(UTC)
    await db.commit()

    finding = (
        await db.execute(select(GapFindingRow).where(GapFindingRow.id == task.gap_finding_id))
    ).scalar_one()

    return TaskOut(
        id=task.id,
        finding_id=finding.id,
        sku_code=finding.sku_code,
        sku_name=finding.sku_name,
        sku_brand=finding.sku_brand,
        position_label=finding.position_label,
        priority=finding.priority,
        facings=finding.facings,
        status=task.status,
        blocked_reason=task.blocked_reason,
    )
