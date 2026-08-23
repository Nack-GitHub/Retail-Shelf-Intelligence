"""Public API wire models — camelCase.

The frontend's `types/index.ts` is the contract for these shapes; matching it
exactly is what lets `lib/mock/*` be swapped for real HTTP calls without
touching a single component. Internally, and on the ML contract, everything
stays snake_case.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Auth ─────────────────────────────────────────────────────────────────────


class LoginRequest(ApiModel):
    email: str
    password: str


class TokenResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(ApiModel):
    id: UUID
    email: str
    full_name: str
    role: str
    area_id: str | None = None


# ── Stores & routes ──────────────────────────────────────────────────────────


class StoreOut(ApiModel):
    id: UUID
    external_code: str
    name: str
    chain: str
    store_format: str
    address: str
    lat: float
    lng: float
    photo_policy: str
    visit_window: str


class StoreRiskOut(StoreOut):
    """A store plus how much attention it needs.

    `last_osa` and `days_since_last_visit` are nullable on purpose: a store
    nobody has photographed has no OSA, and rendering that as 0 would show a
    perfectly healthy shelf as a catastrophe.
    """

    area_id: str
    last_osa: float | None
    days_since_last_visit: int | None
    risk_band: str
    risk_score: float
    repeat_gap_skus: int


class RouteStopOut(StoreRiskOut):
    distance_km: float


class ShelfCategoryOut(ApiModel):
    """A shelf a rep can choose to photograph.

    `last_osa` is null when this store has no analysed capture in the
    category — "never measured" is not "measured as empty".
    """

    id: str
    name: str
    bays: list[str]
    sku_count: int
    last_osa: float | None


# ── Visits ───────────────────────────────────────────────────────────────────


class VisitCreate(ApiModel):
    store_id: UUID
    gps_lat: float | None = None
    gps_lng: float | None = None
    # PDPA deferred: recorded for the evidence trail, not gated on.
    photo_consent_confirmed: bool | None = None


class VisitOut(ApiModel):
    id: UUID
    store_id: UUID
    user_id: UUID
    checked_in_at: datetime
    checked_out_at: datetime | None
    gps_match: bool
    photo_consent_confirmed: bool | None
    osa_before: float | None
    osa_after: float | None
    status: str


# ── Captures ─────────────────────────────────────────────────────────────────


class PresignRequest(ApiModel):
    """A presign response is a write grant to object storage.

    The constraints below are the grant's limits: only image types, only a real
    phase, and a bounded label — which is slugified into the object key, so an
    unbounded or path-shaped value would end up in the storage layout.
    """

    visit_id: UUID
    category: str = Field(min_length=1, max_length=64)
    shelf_bay_label: str = Field(default="", max_length=64)
    phase: Literal["BEFORE", "AFTER"] = "BEFORE"
    content_type: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class PresignResponse(ApiModel):
    capture_id: UUID
    upload_url: str
    object_key: str
    expires_in: int


class CaptureCommit(ApiModel):
    image_width: int = Field(gt=0, le=20000)
    image_height: int = Field(gt=0, le=20000)
    captured_at: datetime | None = None
    device_info: dict | None = None
    face_blur_applied: bool | None = None
    face_blur_count: int | None = None


class JobAccepted(ApiModel):
    job_id: UUID
    capture_id: UUID
    status: str


class JobOut(ApiModel):
    job_id: UUID = Field(validation_alias="id")
    capture_id: UUID
    status: str
    progress_hint: str
    error_code: str | None = None
    user_message: str | None = None
    result_url: str | None = None


# ── Results ──────────────────────────────────────────────────────────────────


class BBoxOut(ApiModel):
    x: float
    y: float
    w: float
    h: float


class DetectionOut(ApiModel):
    detection_id: UUID
    class_id: int
    class_name: str
    semantic_type: str
    bbox: BBoxOut
    confidence: float
    shelf_row_index: int | None


class GapFindingOut(ApiModel):
    id: UUID
    detection_id: UUID
    shelf_row_index: int
    position_label: str
    confidence: float
    is_low_confidence: bool
    verification_status: str
    rejected_reason: str | None
    sku_code: str
    sku_name: str
    sku_brand: str
    priority: int
    facings: int


class ShelfAnalysisOut(ApiModel):
    capture_id: UUID
    model_version: str
    # Presigned GET for the photograph these boxes were drawn on. Every number
    # a manager sees must be traceable back to the pixels that produced it.
    image_url: str | None = None
    image_width: int
    image_height: int
    row_count: int
    gap_ratio: float
    osa_score: float
    status: str
    inference_ms: int
    low_confidence_count: int
    detections: list[DetectionOut]
    gap_findings: list[GapFindingOut]


# ── Verification & tasks ─────────────────────────────────────────────────────


class VerifyRequest(ApiModel):
    verdict: Literal["CONFIRMED", "REJECTED"]
    reason: Literal["OCCLUDED", "NOT_OUR_SKU", "NORMAL_EMPTY", "OTHER"] | None = None


class TaskOut(ApiModel):
    id: UUID
    finding_id: UUID
    sku_code: str
    sku_name: str
    sku_brand: str
    position_label: str
    priority: int
    facings: int
    status: str
    blocked_reason: str | None


class TaskPatch(ApiModel):
    status: Literal["OPEN", "FIXED", "BLOCKED"]
    blocked_reason: Literal["OUT_OF_BACKSTOCK", "STORE_REFUSED", "DELISTED"] | None = None
    after_capture_id: UUID | None = None


class CheckoutResponse(ApiModel):
    visit_id: UUID
    osa_before: float | None
    osa_after: float | None
    tasks_total: int
    tasks_fixed: int
    tasks_blocked: int
    checked_out_at: datetime


# ── Sync ─────────────────────────────────────────────────────────────────────


class SyncOperationIn(ApiModel):
    idempotency_key: str = Field(min_length=1, max_length=128)
    kind: Literal["CAPTURE", "VERIFY", "TASK", "CHECKOUT"]
    payload: dict


class SyncBatchRequest(ApiModel):
    # Bounded because the client controls the size and drains unattended after
    # a day offline. A rep's whole day is well under 200 operations; anything
    # larger is a bug or an attack, and either way should not be processed
    # one-by-one inside a single request.
    operations: list[SyncOperationIn] = Field(max_length=200)


class SyncItemResult(ApiModel):
    idempotency_key: str
    ok: bool
    error: str | None = None
    result: dict | None = None


class SyncBatchResponse(ApiModel):
    results: list[SyncItemResult]
