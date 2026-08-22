"""Manager analytics.

⛔ ABSOLUTE PROHIBITION — READ BEFORE ADDING ANYTHING HERE

There must be no endpoint, query or response field that aggregates, ranks or
scores by user_id. No per-rep leaderboard, no rep performance metric, no
GROUP BY user_id. Aggregation is permitted at STORE and AREA level only.

Reason: if the score is tied to an individual, reps will photograph only
flattering angles and the entire dataset becomes worthless. This is a
labour-rights constraint agreed at design stage, not a missing feature. A
ticket asking for per-rep scoring should be escalated, not implemented.

`tests/integration/test_no_per_rep_analytics.py` enforces this by inspecting
this module's source.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.db.models import (
    Capture,
    GapFindingRow,
    ShelfAnalysisRow,
    Store,
    User,
    Visit,
)
from app.services.risk import risk_band, risk_score

router = APIRouter(tags=["analytics"])


@router.get("/analytics/osa")
async def osa_trend(
    scope: str = Query("area", pattern="^(area|store)$"),
    area_id: str | None = None,
    store_id: UUID | None = None,
    days: int = Query(84, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """OSA over time, bucketed by week. Store or area scope only."""
    since = datetime.now(UTC) - timedelta(days=days)

    query = (
        select(
            func.date_trunc("week", ShelfAnalysisRow.computed_at).label("bucket"),
            func.avg(ShelfAnalysisRow.osa_score).label("osa"),
            func.count(func.distinct(Visit.id)).label("visits"),
        )
        .join(Capture, Capture.id == ShelfAnalysisRow.capture_id)
        .join(Visit, Visit.id == Capture.visit_id)
        .join(Store, Store.id == Visit.store_id)
        .where(ShelfAnalysisRow.computed_at >= since)
        .group_by("bucket")
        .order_by("bucket")
    )
    if scope == "store" and store_id:
        query = query.where(Store.id == store_id)
    elif area_id:
        query = query.where(Store.area_id == area_id)

    rows = (await db.execute(query)).all()
    return {
        "scope": scope,
        "areaId": area_id,
        "storeId": str(store_id) if store_id else None,
        "points": [
            {
                "bucket": bucket.date().isoformat(),
                "osa": round(float(osa), 4),
                "visits": visits,
            }
            for bucket, osa, visits in rows
        ],
    }


@router.get("/analytics/risk-ranking")
async def risk_ranking(
    area_id: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Stores ranked by risk. Stores — never people."""
    query = select(Store)
    if area_id:
        query = query.where(Store.area_id == area_id)
    stores = (await db.execute(query)).scalars().all()

    latest_osa = dict(
        (
            await db.execute(
                select(Visit.store_id, func.max(ShelfAnalysisRow.osa_score))
                .join(Capture, Capture.visit_id == Visit.id)
                .join(ShelfAnalysisRow, ShelfAnalysisRow.capture_id == Capture.id)
                .group_by(Visit.store_id)
            )
        ).all()
    )
    last_seen = dict(
        (
            await db.execute(
                select(Visit.store_id, func.max(Visit.checked_in_at)).group_by(Visit.store_id)
            )
        ).all()
    )

    now = datetime.now(UTC)
    rows = []
    for store in stores:
        osa = latest_osa.get(store.id)
        days = (now - last_seen[store.id]).days if store.id in last_seen else None
        score = risk_score(osa, days, repeat_gap_skus=0)
        rows.append(
            {
                "storeId": str(store.id),
                "storeName": store.name,
                "chain": store.chain,
                "storeFormat": store.store_format,
                "areaId": store.area_id,
                "lastOsa": round(osa, 4) if osa is not None else None,
                "daysSinceLastVisit": days,
                "riskScore": score,
                "riskBand": risk_band(score).value,
            }
        )

    rows.sort(key=lambda r: -r["riskScore"])
    return {"areaId": area_id, "rows": rows[:limit]}


@router.get("/stores/{store_id}/history")
async def store_history(
    store_id: UUID,
    limit: int = Query(30, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Visit timeline for one store, with before/after OSA per visit."""
    visits = (
        (
            await db.execute(
                select(Visit)
                .where(Visit.store_id == store_id)
                .order_by(Visit.checked_in_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    gap_counts = dict(
        (
            await db.execute(
                select(Capture.visit_id, func.count(GapFindingRow.id))
                .join(GapFindingRow, GapFindingRow.capture_id == Capture.id)
                .where(Capture.visit_id.in_([v.id for v in visits]) if visits else False)
                .group_by(Capture.visit_id)
            )
        ).all()
    )

    return {
        "storeId": str(store_id),
        "visits": [
            {
                "visitId": str(v.id),
                "checkedInAt": v.checked_in_at.isoformat(),
                "checkedOutAt": v.checked_out_at.isoformat() if v.checked_out_at else None,
                "osaBefore": float(v.osa_before) if v.osa_before is not None else None,
                "osaAfter": float(v.osa_after) if v.osa_after is not None else None,
                "gapsFound": gap_counts.get(v.id, 0),
                "gpsMatch": v.gps_match,
                "status": v.status,
            }
            for v in visits
        ],
    }
