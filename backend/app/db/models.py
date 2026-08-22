"""Persistence models.

Two rules shape this file:

1. `detections` and `shelf_analyses` are APPEND-ONLY. Re-running inference with
   a new model version inserts new rows; it never updates or deletes old ones.
   Findings must stay reproducible for commercial disputes months later.
2. Every derived row carries `model_version`, so "which model produced this
   result in May" is always answerable.

Compliance columns (consent, face blur, retention) exist but are nullable and
ungated — PDPA enforcement is deferred, and keeping the columns means turning
it on later is a config change plus one constraint, not a rewrite of every
write path.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

_UUID = PgUUID(as_uuid=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    area_id: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    external_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    chain: Mapped[str] = mapped_column(String(128), nullable=False)
    store_format: Mapped[str] = mapped_column(String(16), nullable=False)
    area_id: Mapped[str] = mapped_column(String(64), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    photo_policy: Mapped[str] = mapped_column(String(16), nullable=False, default="ALLOWED")
    visit_window: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_stores_area", "area_id"), Index("ix_stores_geo", "lat", "lng"))


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    checked_in_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gps_lat: Mapped[float | None] = mapped_column(Float)
    gps_lng: Mapped[float | None] = mapped_column(Float)
    # Flagged, never blocking: reps legitimately stand outside the geofence.
    gps_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # PDPA deferred — recorded when supplied, not enforced.
    photo_consent_confirmed: Mapped[bool | None] = mapped_column(Boolean)
    osa_before: Mapped[float | None] = mapped_column(Numeric(5, 4))
    osa_after: Mapped[float | None] = mapped_column(Numeric(5, 4))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")

    store: Mapped[Store] = relationship(lazy="joined")

    __table_args__ = (Index("ix_visits_store_time", "store_id", "checked_in_at"),)


class Capture(Base):
    __tablename__ = "captures"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("visits.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    shelf_bay_label: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    object_key: Mapped[str | None] = mapped_column(String(512))
    image_width: Mapped[int | None] = mapped_column(Integer)
    image_height: Mapped[int | None] = mapped_column(Integer)
    phase: Mapped[str] = mapped_column(String(8), nullable=False, default="BEFORE")
    # PDPA deferred — columns kept so enforcement is a config flag later.
    face_blur_applied: Mapped[bool | None] = mapped_column(Boolean)
    face_blur_count: Mapped[int | None] = mapped_column(Integer)
    retention_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    device_info: Mapped[dict | None] = mapped_column(JSONB)
    client_idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    visit: Mapped[Visit] = relationship(lazy="joined")

    __table_args__ = (Index("ix_captures_visit", "visit_id"),)


class InferenceJob(Base):
    __tablename__ = "inference_jobs"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    capture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("captures.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED")
    model_version: Mapped[str | None] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_detail: Mapped[str | None] = mapped_column(Text)
    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    inference_ms: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (Index("ix_jobs_capture", "capture_id"),)


class DetectionRow(Base):
    """APPEND-ONLY. Never updated, never deleted.

    `run_id` identifies the single inference run that produced this row.
    model_version alone is not enough: re-running the SAME model on a capture
    appends a second set of rows, and a reader filtering only by model_version
    would return both and draw every box twice.

    Kept as a plain table rather than partitioned by month: this is a demo, and
    partitioning buys storage management we do not need at this volume.
    """

    __tablename__ = "detections"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    capture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("captures.id"), nullable=False)
    run_id: Mapped[uuid.UUID] = mapped_column(_UUID, nullable=False)
    # The id the ML service assigned within its response. Kept for tracing a
    # row back to one inference call, but NOT used as the primary key: it is
    # only unique within a response, and a deterministic service reuses it
    # across runs. Owning our own key is what makes re-inference safe.
    source_detection_id: Mapped[uuid.UUID] = mapped_column(_UUID, nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    class_name: Mapped[str] = mapped_column(String(128), nullable=False)
    semantic_type: Mapped[str] = mapped_column(String(16), nullable=False)
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_w: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_h: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    shelf_row_index: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_detections_capture", "capture_id"),
        Index("ix_detections_run", "run_id"),
        Index("ix_detections_source", "source_detection_id"),
    )


class ShelfAnalysisRow(Base):
    """APPEND-ONLY, one row per (capture, model_version, config_version)."""

    __tablename__ = "shelf_analyses"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    capture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("captures.id"), nullable=False)
    run_id: Mapped[uuid.UUID] = mapped_column(_UUID, nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_shelf_area: Mapped[float] = mapped_column(Float, nullable=False)
    gap_area: Mapped[float] = mapped_column(Float, nullable=False)
    gap_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    osa_score: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    low_confidence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    config_version: Mapped[str] = mapped_column(String(32), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_analyses_capture", "capture_id"),)


class GapFindingRow(Base):
    __tablename__ = "gap_findings"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    capture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("captures.id"), nullable=False)
    run_id: Mapped[uuid.UUID] = mapped_column(_UUID, nullable=False)
    detection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("detections.id"), nullable=False)
    shelf_row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    position_label: Mapped[str] = mapped_column(String(128), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    is_low_confidence: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sku_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    sku_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    sku_brand: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    facings: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    verification_status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    rejected_reason: Mapped[str | None] = mapped_column(String(32))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_findings_capture", "capture_id"),
        Index("ix_findings_run", "run_id"),
        # Partial index: the pending queue is the only hot read on this table.
        Index(
            "ix_findings_pending",
            "verification_status",
            postgresql_where=(verification_status == "PENDING"),
        ),
    )


class TaskRow(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("visits.id"), nullable=False)
    gap_finding_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("gap_findings.id"), nullable=False)
    sku_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")
    blocked_reason: Mapped[str | None] = mapped_column(String(32))
    after_capture_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("captures.id"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_tasks_visit", "visit_id"),
        UniqueConstraint("gap_finding_id", name="uq_task_per_finding"),
    )


class ReplenishmentRequest(Base):
    __tablename__ = "replenishment_requests"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    store_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stores.id"), nullable=False)
    sku_code: Mapped[str] = mapped_column(String(64), nullable=False)
    source_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id"))
    quantity_hint: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="REQUESTED")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    version: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    sha: Mapped[str] = mapped_column(String(64), nullable=False)
    source_dataset: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    dataset_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    metrics: Mapped[dict | None] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    model_card_uri: Mapped[str | None] = mapped_column(String(512))
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    promoted_by: Mapped[str | None] = mapped_column(String(255))


class AuditLog(Base):
    """Append-only. Written for verifications, disputes, and model promotions."""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    actor_role: Mapped[str | None] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id"),)


class SyncOperation(Base):
    """Idempotency ledger for the offline queue drain.

    Keyed by the client's Idempotency-Key so replaying the same batch is safe.
    """

    __tablename__ = "sync_operations"

    id: Mapped[uuid.UUID] = mapped_column(_UUID, primary_key=True, default=uuid.uuid4)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
