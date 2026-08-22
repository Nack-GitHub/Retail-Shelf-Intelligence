"""Offline queue drain.

Reps work in shops with poor signal. The client queues operations locally and
drains them here when it reconnects. Each operation carries its own
Idempotency-Key so replaying an entire batch — which happens whenever the
connection drops mid-drain — is safe.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import (
    SyncBatchRequest,
    SyncBatchResponse,
    SyncItemResult,
    SyncOperationIn,
)
from app.core.logging import get_logger
from app.db.models import SyncOperation, User

router = APIRouter(tags=["sync"])
log = get_logger(__name__)


@router.post("/sync/batch", response_model=SyncBatchResponse)
async def sync_batch(
    body: SyncBatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> SyncBatchResponse:
    """Process operations in order, reporting per-item success or failure.

    One bad operation must not fail the batch: the rep's other seven captures
    should still land.
    """
    results: list[SyncItemResult] = []

    for operation in body.operations:
        seen = (
            await db.execute(
                select(SyncOperation).where(
                    SyncOperation.idempotency_key == operation.idempotency_key
                )
            )
        ).scalar_one_or_none()

        if seen is not None:
            results.append(
                SyncItemResult(
                    idempotency_key=operation.idempotency_key, ok=True, result=seen.result
                )
            )
            continue

        try:
            result = await _apply(operation)
            db.add(
                SyncOperation(
                    idempotency_key=operation.idempotency_key,
                    kind=operation.kind,
                    result=result,
                )
            )
            await db.commit()
            results.append(
                SyncItemResult(idempotency_key=operation.idempotency_key, ok=True, result=result)
            )
        except Exception as exc:  # noqa: BLE001 — per-item isolation is the point
            await db.rollback()
            log.warning(
                "sync_item_failed",
                key=operation.idempotency_key,
                kind=operation.kind,
                error=str(exc),
            )
            results.append(
                SyncItemResult(
                    idempotency_key=operation.idempotency_key, ok=False, error=str(exc)[:200]
                )
            )

    return SyncBatchResponse(results=results)


async def _apply(operation: SyncOperationIn) -> dict:
    """Record the operation.

    The demo's client-side queue replays real endpoints directly and uses this
    only as an acknowledgement ledger; a fuller build would dispatch by `kind`.
    """
    return {"kind": operation.kind, "accepted": True}
