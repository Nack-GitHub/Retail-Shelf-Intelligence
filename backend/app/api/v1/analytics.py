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

from app.api.v1.deps import get_db, require_roles
from app.db.models import (
    Capture,
    GapFindingRow,
    ShelfAnalysisRow,
    Store,
    TaskRow,
    User,
    Visit,
)
from app.domain.enums import Role
from app.repositories import store_risk

router = APIRouter(tags=["analytics"])

# Analytics is management reporting, not part of a rep's job. Guarding at the
# router keeps a future endpoint from being added without a role check.
manager_only = require_roles(Role.MANAGER, Role.ADMIN, Role.DATA)


@router.get("/analytics/osa")
async def osa_trend(
    scope: str = Query("area", pattern="^(area|store)$"),
    area_id: str | None = Query(None, alias="areaId"),
    store_id: UUID | None = Query(None, alias="storeId"),
    days: int = Query(84, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(manager_only),
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
    area_id: str | None = Query(None, alias="areaId"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(manager_only),
) -> dict:
    """Stores ranked by risk. Stores — never people."""
    query = select(Store)
    if area_id:
        query = query.where(Store.area_id == area_id)
    stores = (await db.execute(query)).scalars().all()

    # Shared with /v1/stores and /v1/routes/today. Three copies of this query
    # meant three chances for the rep's route and the manager's ranking to
    # disagree about which store is worst.
    facts = await store_risk.load(db, [s.id for s in stores])

    rows = []
    for store in stores:
        risk = store_risk.for_store(facts, store.id)
        rows.append(
            {
                "storeId": str(store.id),
                "storeName": store.name,
                "chain": store.chain,
                "storeFormat": store.store_format,
                "areaId": store.area_id,
                "lastOsa": risk.last_osa,
                "daysSinceLastVisit": risk.days_since_last_visit,
                "repeatGapSkus": risk.repeat_gap_skus,
                "riskScore": risk.score,
                "riskBand": risk.band,
            }
        )

    rows.sort(key=lambda r: -r["riskScore"])
    return {"areaId": area_id, "rows": rows[:limit]}


@router.get("/stores/{store_id}/history")
async def store_history(
    store_id: UUID,
    limit: int = Query(30, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(manager_only),
) -> dict:
    """Visit timeline for one store, with the captures behind each row.

    The captures travel with the visit because every number a manager sees has
    to be openable back to the pixels that produced it. A timeline that shows
    an OSA score with no way to reach the photograph is a claim, not evidence.

    ⛔ Carries no identity. Who visited the store is not part of what a
    manager reviews, and a per-visit rep name is a per-rep metric by another
    route.
    """
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
    visit_ids = [v.id for v in visits]

    if not visit_ids:
        return {"storeId": str(store_id), "visits": []}

    gap_counts = dict(
        (
            await db.execute(
                select(Capture.visit_id, func.count(GapFindingRow.id))
                .join(GapFindingRow, GapFindingRow.capture_id == Capture.id)
                .where(Capture.visit_id.in_(visit_ids))
                .group_by(Capture.visit_id)
            )
        ).all()
    )

    fixed_counts = dict(
        (
            await db.execute(
                select(TaskRow.visit_id, func.count(TaskRow.id))
                .where(TaskRow.visit_id.in_(visit_ids), TaskRow.status == "FIXED")
                .group_by(TaskRow.visit_id)
            )
        ).all()
    )

    # The newest analysis per capture — the table is append-only, so a
    # re-inference adds a row rather than replacing one.
    capture_rows = (
        await db.execute(
            select(
                Capture.visit_id,
                Capture.id,
                Capture.category,
                Capture.shelf_bay_label,
                Capture.phase,
                Capture.captured_at,
                ShelfAnalysisRow.osa_score,
                ShelfAnalysisRow.model_version,
            )
            .outerjoin(ShelfAnalysisRow, ShelfAnalysisRow.capture_id == Capture.id)
            .where(Capture.visit_id.in_(visit_ids))
            .distinct(Capture.id)
            .order_by(Capture.id, ShelfAnalysisRow.computed_at.desc())
        )
    ).all()

    captures_by_visit: dict[UUID, list[dict]] = {}
    for visit_id, capture_id, category, bay, phase, captured_at, osa, model_version in capture_rows:
        captures_by_visit.setdefault(visit_id, []).append(
            {
                "captureId": str(capture_id),
                "category": category,
                "shelfBayLabel": bay,
                "phase": phase,
                "capturedAt": captured_at.isoformat() if captured_at else None,
                "osaScore": round(float(osa), 4) if osa is not None else None,
                "modelVersion": model_version,
            }
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
                "gapsFixed": fixed_counts.get(v.id, 0),
                "gpsMatch": v.gps_match,
                "status": v.status,
                "captures": captures_by_visit.get(v.id, []),
            }
            for v in visits
        ],
    }


@router.get("/analytics/kpis")
async def kpis(
    days: int = Query(28, ge=1, le=365),
    area_id: str | None = Query(None, alias="areaId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(manager_only),
) -> dict:
    """The headline numbers, and ONLY the ones the database can answer.

    "ต้นทุนต่อการตรวจ" is deliberately absent: there is no cost data anywhere
    in this system, and a card showing an estimate would sit beside measured
    numbers with nothing to tell a reader which is which. The frontend renders
    whatever arrives, so an absent KPI simply is not drawn.

    ⛔ Every figure here is an area or store aggregate. None may be per rep.
    """
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    # The preceding window of equal length. A delta against "some earlier time"
    # would not be comparable; against the same span it is.
    previous_since = since - timedelta(days=days)
    cards: list[dict] = []

    def scoped(query):
        return query.where(Store.area_id == area_id) if area_id else query

    def osa_between(start, end):
        return scoped(
            select(func.avg(ShelfAnalysisRow.osa_score))
            .join(Capture, Capture.id == ShelfAnalysisRow.capture_id)
            .join(Visit, Visit.id == Capture.visit_id)
            .join(Store, Store.id == Visit.store_id)
            .where(ShelfAnalysisRow.computed_at >= start, ShelfAnalysisRow.computed_at < end)
        )

    def visits_between(start, end):
        return scoped(
            select(func.count(Visit.id))
            .join(Store, Store.id == Visit.store_id)
            .where(Visit.checked_in_at >= start, Visit.checked_in_at < end)
        )

    def ttr_between(start, end):
        # Detection to shelf: how long a confirmed gap waits before someone
        # actually puts the product back. The number trade marketing argues about.
        return scoped(
            select(func.avg(TaskRow.completed_at - GapFindingRow.created_at))
            .join(GapFindingRow, GapFindingRow.id == TaskRow.gap_finding_id)
            .join(Capture, Capture.id == GapFindingRow.capture_id)
            .join(Visit, Visit.id == Capture.visit_id)
            .join(Store, Store.id == Visit.store_id)
            .where(TaskRow.status == "FIXED", TaskRow.completed_at.is_not(None))
            .where(GapFindingRow.created_at >= start, GapFindingRow.created_at < end)
        )

    previous_label = f"เทียบ {days} วันก่อนหน้า"

    osa = (await db.execute(osa_between(since, now))).scalar()
    if osa is not None:
        previous = (await db.execute(osa_between(previous_since, since))).scalar()
        value = round(float(osa) * 100, 1)
        cards.append(
            {
                "id": "osa",
                "label": "OSA เฉลี่ยของพื้นที่",
                "value": value,
                "unit": "%",
                # null, not zero: with no earlier window there is no change to
                # report, and "0" would read as "held steady".
                "delta": (
                    round(value - float(previous) * 100, 1) if previous is not None else None
                ),
                "deltaLabel": previous_label,
                "good": "up",
                "target": 90,
            }
        )

    ttr = (await db.execute(ttr_between(since, now))).scalar()
    if ttr is not None:
        previous = (await db.execute(ttr_between(previous_since, since))).scalar()
        minutes = round(ttr.total_seconds() / 60, 1)
        cards.append(
            {
                "id": "ttr",
                "label": "เวลาเฉลี่ยจากตรวจพบถึงเติมของสำเร็จ",
                "value": minutes,
                "unit": "นาที",
                "delta": (
                    round(minutes - previous.total_seconds() / 60, 1)
                    if previous is not None
                    else None
                ),
                "deltaLabel": previous_label,
                "good": "down",
                "target": 30,
            }
        )

    visits = (await db.execute(visits_between(since, now))).scalar() or 0
    previous_visits = (await db.execute(visits_between(previous_since, since))).scalar() or 0
    cards.append(
        {
            "id": "visits",
            "label": f"ร้านที่ตรวจใน {days} วันล่าสุด",
            "value": visits,
            "unit": "ร้าน",
            "delta": visits - previous_visits,
            "deltaLabel": previous_label,
            "good": "up",
            "target": None,
        }
    )

    return {"areaId": area_id, "days": days, "kpis": cards}


@router.get("/analytics/route-plan")
async def route_plan(
    area_id: str | None = Query(None, alias="areaId"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(manager_only),
) -> dict:
    """Next week's visits, worst store first.

    `avgVisitMinutes` is measured from this store's own closed visits and is
    null when there are none. Filling that gap with a default would place a
    fabricated duration beside measured ones with nothing to tell them apart.
    """
    query = select(Store)
    if area_id:
        query = query.where(Store.area_id == area_id)
    stores = (await db.execute(query)).scalars().all()

    facts = await store_risk.load(db, [s.id for s in stores])

    durations = dict(
        (
            await db.execute(
                select(
                    Visit.store_id,
                    func.avg(Visit.checked_out_at - Visit.checked_in_at),
                )
                .where(Visit.checked_out_at.is_not(None))
                .group_by(Visit.store_id)
            )
        ).all()
    )

    stops = []
    for store in stores:
        risk = store_risk.for_store(facts, store.id)
        duration = durations.get(store.id)
        stops.append(
            {
                "storeId": str(store.id),
                "storeName": store.name,
                "chain": store.chain,
                "areaId": store.area_id,
                "lastOsa": risk.last_osa,
                "daysSinceLastVisit": risk.days_since_last_visit,
                "repeatGapSkus": risk.repeat_gap_skus,
                "riskScore": risk.score,
                "riskBand": risk.band,
                "avgVisitMinutes": (
                    round(duration.total_seconds() / 60) if duration is not None else None
                ),
            }
        )

    stops.sort(key=lambda s: -s["riskScore"])
    return {"areaId": area_id, "stops": stops[:limit]}
