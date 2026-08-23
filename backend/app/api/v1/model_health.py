"""Model health and the relabel queue.

Two screens for the data team: is the model good enough to trust, and which
images should be labelled next.

⛔ The relabel queue returns the image and the reason a finding was rejected.
It must NEVER return who rejected it. A queue that named the rejecting rep is
a per-rep accuracy metric by another route, and reps who know their rejections
are counted stop rejecting things — which destroys the very signal this queue
exists to collect.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage_client import get_storage
from app.api.v1.deps import get_db, require_roles
from app.core.config import settings
from app.db.models import (
    Capture,
    DetectionRow,
    GapFindingRow,
    ModelVersion,
    Store,
    User,
    Visit,
)
from app.domain.enums import Role

router = APIRouter(tags=["model"])

# Model health is a data-team and management concern, not part of a rep's job.
data_team_only = require_roles(Role.MANAGER, Role.ADMIN, Role.DATA)


@router.get("/model/health")
async def model_health(
    weeks: int = Query(12, ge=1, le=52),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(data_team_only),
) -> dict:
    """Which model is live, how it scored, and how often reps disagree with it.

    There is no "drift" figure here. Drift needs a reference distribution to
    measure against, and this system stores none — a number with nothing
    behind it would be decoration. What IS measurable is the rate at which
    reps overrule the model, which moves for the same reasons drift would and
    is counted from real verifications every time this is called.
    """
    versions = (
        (
            await db.execute(
                select(ModelVersion).order_by(ModelVersion.promoted_at.desc().nullslast())
            )
        )
        .scalars()
        .all()
    )

    since = datetime.now(UTC) - timedelta(weeks=weeks)
    rows = (
        await db.execute(
            select(
                func.date_trunc("week", GapFindingRow.verified_at).label("bucket"),
                func.count().label("reviewed"),
                func.sum(case((GapFindingRow.verification_status == "REJECTED", 1), else_=0)).label(
                    "rejected"
                ),
            )
            .where(
                GapFindingRow.verified_at.is_not(None),
                GapFindingRow.verified_at >= since,
            )
            .group_by("bucket")
            .order_by("bucket")
        )
    ).all()

    return {
        "activeVersion": next((v.version for v in versions if v.is_active), None),
        "mlClient": settings.ml_client,
        "versions": [
            {
                "version": v.version,
                "sha": v.sha,
                "sourceDataset": v.source_dataset,
                "datasetVersion": v.dataset_version,
                "isActive": v.is_active,
                "promotedAt": v.promoted_at.isoformat() if v.promoted_at else None,
                "modelCardUri": v.model_card_uri,
                "metrics": v.metrics,
            }
            for v in versions
        ],
        "overrideRate": [
            {
                "bucket": bucket.date().isoformat(),
                "rate": round(int(rejected or 0) / reviewed, 4),
                "reviewed": reviewed,
            }
            for bucket, reviewed, rejected in rows
        ],
    }


@router.get("/model/relabel-queue")
async def relabel_queue(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(data_team_only),
) -> dict:
    """Findings worth a second look: the ones reps rejected, and the ones the
    model itself was unsure about.

    ⛔ `GapFindingRow.verified_by` is deliberately not selected. Do not add it.
    """
    rows = (
        (
            await db.execute(
                select(GapFindingRow, Capture, Store, DetectionRow)
                .join(Capture, Capture.id == GapFindingRow.capture_id)
                .join(Visit, Visit.id == Capture.visit_id)
                .join(Store, Store.id == Visit.store_id)
                .outerjoin(DetectionRow, DetectionRow.id == GapFindingRow.detection_id)
                .where(
                    (GapFindingRow.verification_status == "REJECTED")
                    | (GapFindingRow.is_low_confidence.is_(True))
                )
                .order_by(GapFindingRow.created_at.desc())
                .limit(limit)
            )
        )
        .tuples()
        .all()
    )

    storage = get_storage()
    items = []
    for finding, capture, store, detection in rows:
        items.append(
            {
                "findingId": str(finding.id),
                "captureId": str(capture.id),
                "reason": (
                    "REP_REJECTED"
                    if finding.verification_status == "REJECTED"
                    else "LOW_CONFIDENCE"
                ),
                "rejectedReason": finding.rejected_reason,
                "confidence": round(finding.confidence, 4),
                "isLowConfidence": finding.is_low_confidence,
                "storeName": store.name,
                "category": capture.category,
                "capturedAt": capture.captured_at.isoformat() if capture.captured_at else None,
                "imageUrl": (
                    storage.presign_get(capture.object_key) if capture.object_key else None
                ),
                "imageWidth": capture.image_width,
                "imageHeight": capture.image_height,
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
                "modelVersion": detection.model_version if detection else None,
            }
        )

    return {"items": items}
