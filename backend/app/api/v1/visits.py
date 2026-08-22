"""Visit check-in and check-out."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import current_user, get_db
from app.api.v1.schemas import CheckoutResponse, VisitCreate, VisitOut
from app.core.config import settings
from app.db.models import Capture, ShelfAnalysisRow, Store, TaskRow, User, Visit
from app.domain.enums import PhotoPolicy, TaskStatus, VisitStatus
from app.services.risk import haversine_km

router = APIRouter(tags=["visits"])


@router.post("/visits", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
async def check_in(
    body: VisitCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> Visit:
    store = (await db.execute(select(Store).where(Store.id == body.store_id))).scalar_one_or_none()
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบร้านค้า")

    if store.photo_policy == PhotoPolicy.FORBIDDEN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ร้านนี้ไม่อนุญาตให้ถ่ายภาพ")

    # GPS mismatch is flagged for the evidence trail, never blocking: reps
    # legitimately stand outside a shop while checking in.
    gps_match = False
    if body.gps_lat is not None and body.gps_lng is not None:
        distance_m = haversine_km(body.gps_lat, body.gps_lng, store.lat, store.lng) * 1000
        gps_match = distance_m <= settings.gps_match_radius_meters

    visit = Visit(
        store_id=store.id,
        user_id=user.id,
        gps_lat=body.gps_lat,
        gps_lng=body.gps_lng,
        gps_match=gps_match,
        photo_consent_confirmed=body.photo_consent_confirmed,
        status=VisitStatus.OPEN,
    )
    db.add(visit)
    await db.commit()
    await db.refresh(visit)
    return visit


@router.get("/visits/{visit_id}", response_model=VisitOut)
async def get_visit(
    visit_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> Visit:
    visit = (await db.execute(select(Visit).where(Visit.id == visit_id))).scalar_one_or_none()
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบการเข้าร้าน")
    return visit


@router.post("/visits/{visit_id}/checkout", response_model=CheckoutResponse)
async def check_out(
    visit_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
) -> CheckoutResponse:
    """Close the visit and compute osa_after from AFTER-phase captures."""
    visit = (await db.execute(select(Visit).where(Visit.id == visit_id))).scalar_one_or_none()
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ไม่พบการเข้าร้าน")

    osa_after = (
        await db.execute(
            select(func.avg(ShelfAnalysisRow.osa_score))
            .join(Capture, Capture.id == ShelfAnalysisRow.capture_id)
            .where(Capture.visit_id == visit.id, Capture.phase == "AFTER")
        )
    ).scalar()

    counts = dict(
        (
            await db.execute(
                select(TaskRow.status, func.count())
                .where(TaskRow.visit_id == visit.id)
                .group_by(TaskRow.status)
            )
        ).all()
    )

    if osa_after is not None:
        visit.osa_after = round(float(osa_after), 4)
    visit.checked_out_at = datetime.now(UTC)
    visit.status = VisitStatus.CLOSED
    await db.commit()

    return CheckoutResponse(
        visit_id=visit.id,
        osa_before=float(visit.osa_before) if visit.osa_before is not None else None,
        osa_after=float(visit.osa_after) if visit.osa_after is not None else None,
        tasks_total=sum(counts.values()),
        tasks_fixed=counts.get(TaskStatus.FIXED.value, 0),
        tasks_blocked=counts.get(TaskStatus.BLOCKED.value, 0),
        checked_out_at=visit.checked_out_at,
    )
