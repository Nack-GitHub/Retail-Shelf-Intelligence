"""Today's route for a field rep."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import RouteStopOut
from app.db.models import Capture, ShelfAnalysisRow, Store, User, Visit
from app.services.risk import haversine_km, risk_band, risk_score

router = APIRouter(tags=["routes"])


@router.get("/routes/today", response_model=list[RouteStopOut])
async def todays_route(
    lat: float = Query(13.7563, description="Rep's current latitude"),
    lng: float = Query(100.5018, description="Rep's current longitude"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[RouteStopOut]:
    """Stores assigned today, sorted by (risk DESC, distance ASC).

    Risk first, distance second: an hour saved driving is worth less than a
    critical store left unvisited.
    """
    stores = (
        (await db.execute(select(Store).where(Store.area_id == (user.area_id or Store.area_id))))
        .scalars()
        .all()
    )

    # Latest OSA and last visit date per store, in two aggregate queries rather
    # than one per store.
    last_visit_rows = (
        await db.execute(
            select(Visit.store_id, func.max(Visit.checked_in_at)).group_by(Visit.store_id)
        )
    ).all()
    last_visit_at = dict(last_visit_rows)

    osa_rows = (
        await db.execute(
            select(Visit.store_id, func.max(ShelfAnalysisRow.osa_score))
            .join(Capture, Capture.visit_id == Visit.id)
            .join(ShelfAnalysisRow, ShelfAnalysisRow.capture_id == Capture.id)
            .group_by(Visit.store_id)
        )
    ).all()
    last_osa = dict(osa_rows)

    now = datetime.now(UTC)
    stops: list[RouteStopOut] = []
    for store in stores:
        seen_at = last_visit_at.get(store.id)
        days = (now - seen_at).days if seen_at else None
        osa = last_osa.get(store.id)
        score = risk_score(osa, days, repeat_gap_skus=0)

        stops.append(
            RouteStopOut(
                id=store.id,
                external_code=store.external_code,
                name=store.name,
                chain=store.chain,
                store_format=store.store_format,
                address=store.address,
                lat=store.lat,
                lng=store.lng,
                photo_policy=store.photo_policy,
                visit_window=store.visit_window,
                distance_km=round(haversine_km(lat, lng, store.lat, store.lng), 2),
                last_osa=round(osa, 4) if osa is not None else None,
                days_since_last_visit=days,
                risk_band=risk_band(score).value,
                risk_score=score,
                repeat_gap_skus=0,
            )
        )

    stops.sort(key=lambda s: (-s.risk_score, s.distance_km))
    return stops
