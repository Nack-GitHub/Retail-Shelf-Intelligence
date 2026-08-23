"""The shelf catalogue: which categories exist, and how each one last measured.

The category list itself is a documented demo stand-in, the same posture as
`services/sku_catalog.py` — a real deployment reads it from the planogram
system, keyed by store format. What is NOT invented is `lastOsa`: that comes
from the analyses actually computed for this store's captures, and is null for
a category nobody has photographed here.

⛔ Aggregation is by STORE and CATEGORY. Nothing here may group by user.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import ShelfCategoryOut
from app.db.models import Capture, ShelfAnalysisRow, User, Visit

router = APIRouter(tags=["catalog"])

# id, ชื่อหมวด, ชั้นวาง, จำนวน SKU
CATEGORIES: list[tuple[str, str, list[str], int]] = [
    ("cat-coffee", "กาแฟ", ["A1", "A2", "A3"], 42),
    ("cat-milk", "นมและผลิตภัณฑ์นม", ["B1", "B2"], 31),
    ("cat-snack", "ขนมขบเคี้ยว", ["C1", "C2", "C3", "C4"], 56),
    ("cat-drink", "เครื่องดื่มไม่มีแอลกอฮอล์", ["D1", "D2"], 38),
    ("cat-instant", "อาหารสำเร็จรูป", ["E1"], 24),
]


@router.get("/categories", response_model=list[ShelfCategoryOut])
async def list_categories(
    store_id: UUID = Query(..., alias="storeId", description="Shelf health is per store"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> list[ShelfCategoryOut]:
    """Categories with this store's most recent OSA for each.

    `store_id` is required rather than optional: a rep standing in front of a
    shelf must not be shown another store's score for it.
    """
    # DISTINCT ON takes the newest analysis per category — the same reason as
    # in repositories/store_risk.py, where MAX() answered the wrong question.
    rows = (
        await db.execute(
            select(Capture.category, ShelfAnalysisRow.osa_score)
            .join(Visit, Visit.id == Capture.visit_id)
            .join(ShelfAnalysisRow, ShelfAnalysisRow.capture_id == Capture.id)
            .where(Visit.store_id == store_id)
            .distinct(Capture.category)
            .order_by(Capture.category, ShelfAnalysisRow.computed_at.desc())
        )
    ).all()
    last_osa = dict(rows)

    return [
        ShelfCategoryOut(
            id=category_id,
            name=name,
            bays=bays,
            sku_count=sku_count,
            last_osa=round(last_osa[category_id], 4) if category_id in last_osa else None,
        )
        for category_id, name, bays, sku_count in CATEGORIES
    ]
