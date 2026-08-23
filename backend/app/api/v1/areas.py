"""Sales areas.

There is no `areas` table: an area is a string column on `stores` and `users`.
That is deliberate for a demo — a real deployment reads the hierarchy from the
sales-org system, and inventing a local table to mirror it would mean two
sources of truth for the same fact.

So the list comes from what stores actually claim, and the Thai names come from
a constant here. An area with no stores is not an area, and does not appear.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import AreaOut
from app.db.models import Store, User

router = APIRouter(tags=["areas"])

AREA_NAMES = {
    "area-bke": "กรุงเทพฯ ตะวันออก",
    "area-bkn": "กรุงเทพฯ เหนือ",
    "area-bkw": "กรุงเทพฯ ตะวันตก",
    "area-est": "ภาคตะวันออก",
}


@router.get("/areas", response_model=list[AreaOut])
async def list_areas(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[AreaOut]:
    rows = (
        await db.execute(
            select(Store.area_id, func.count(Store.id))
            .group_by(Store.area_id)
            .order_by(Store.area_id)
        )
    ).all()

    return [
        # An id with no Thai name falls back to the id itself rather than an
        # empty chip — a demo dataset gains areas faster than this map does.
        AreaOut(id=area_id, name=AREA_NAMES.get(area_id, area_id), store_count=count)
        for area_id, count in rows
    ]
