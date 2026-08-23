"""Today's route for a field rep."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import RouteStopOut
from app.db.models import Store, User
from app.repositories import store_risk
from app.services.risk import haversine_km

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

    facts = await store_risk.load(db, [s.id for s in stores])

    stops: list[RouteStopOut] = []
    for store in stores:
        risk = store_risk.for_store(facts, store.id)
        stops.append(
            RouteStopOut(
                id=store.id,
                external_code=store.external_code,
                name=store.name,
                chain=store.chain,
                store_format=store.store_format,
                area_id=store.area_id,
                address=store.address,
                lat=store.lat,
                lng=store.lng,
                photo_policy=store.photo_policy,
                visit_window=store.visit_window,
                distance_km=round(haversine_km(lat, lng, store.lat, store.lng), 2),
                last_osa=risk.last_osa,
                days_since_last_visit=risk.days_since_last_visit,
                risk_band=risk.band,
                risk_score=risk.score,
                repeat_gap_skus=risk.repeat_gap_skus,
            )
        )

    stops.sort(key=lambda s: (-s.risk_score, s.distance_km))
    return stops
