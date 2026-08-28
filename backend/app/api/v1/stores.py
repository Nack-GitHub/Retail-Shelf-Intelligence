"""Store lookup.

`/routes/today` answers "where am I going next" and sorts by distance from a
rep who is standing somewhere. These answer "tell me about this store", which
a manager's store page and a deep-linked check-in both need without a route.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import StoreRiskOut
from app.db.models import Store, User
from app.repositories import store_risk

router = APIRouter(tags=["stores"])


def _to_out(store: Store, risk: store_risk.StoreRisk) -> StoreRiskOut:
    return StoreRiskOut(
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
        last_osa=risk.last_osa,
        last_osa_phase=risk.last_osa_phase,
        last_osa_category=risk.last_osa_category,
        last_osa_at=risk.last_osa_at,
        days_since_last_visit=risk.days_since_last_visit,
        repeat_gap_skus=risk.repeat_gap_skus,
        risk_score=risk.score,
        risk_band=risk.band,
    )


@router.get("/stores", response_model=list[StoreRiskOut])
async def list_stores(
    area_id: str | None = Query(None, alias="areaId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[StoreRiskOut]:
    """Every store in an area, worst first."""
    query = select(Store)
    if area_id:
        query = query.where(Store.area_id == area_id)
    stores = (await db.execute(query)).scalars().all()

    facts = await store_risk.load(db, [s.id for s in stores])
    rows = [_to_out(s, store_risk.for_store(facts, s.id)) for s in stores]
    rows.sort(key=lambda s: (-s.risk_score, s.name))
    return rows


@router.get("/stores/{store_id}", response_model=StoreRiskOut)
async def get_store(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> StoreRiskOut:
    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบร้านค้า")

    facts = await store_risk.load(db, [store.id])
    return _to_out(store, store_risk.for_store(facts, store.id))
