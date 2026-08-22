"""Wire models for POST /internal/v1/infer.

⚠️ COORDINATE SPACE — read before touching anything in this file.

Every bounding box crossing this boundary is in ABSOLUTE PIXELS of the
ORIGINAL image, top-left origin, x rightward and y downward. Never
normalised to 0..1. Never YOLO centre-form (cx, cy, w, h). The ML service
reverses its own letterbox padding before responding.

This is the single most common integration bug in detection systems: the
model speaks normalised centre-form, the UI draws absolute corner-form, and
a mismatch produces boxes that look *almost* right, which is far worse than
boxes that look obviously wrong.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .enums import InferErrorCode, SemanticType


class BBox(BaseModel):
    """Axis-aligned box in absolute pixels of the original image."""

    model_config = ConfigDict(frozen=True)

    x: float = Field(ge=0, description="Left edge, absolute pixels from image left.")
    y: float = Field(ge=0, description="Top edge, absolute pixels from image top.")
    w: float = Field(gt=0, description="Width in absolute pixels.")
    h: float = Field(gt=0, description="Height in absolute pixels.")

    @property
    def area(self) -> float:
        return self.w * self.h

    @property
    def center_y(self) -> float:
        return self.y + self.h / 2

    @property
    def center_x(self) -> float:
        return self.x + self.w / 2


class Detection(BaseModel):
    """One detected object.

    `class_id` and `class_name` are carried for audit and debugging only.
    Backend business logic must branch on `semantic_type` — see enums.py.
    """

    model_config = ConfigDict(frozen=True)

    detection_id: UUID
    class_id: int = Field(ge=0)
    class_name: str
    semantic_type: SemanticType
    bbox: BBox
    confidence: float = Field(ge=0.0, le=1.0)


class InferRequest(BaseModel):
    """The backend sends a URI, never image bytes."""

    image_uri: str = Field(
        description="Object-store URI the ML service reads directly, e.g. s3://bucket/key."
    )
    request_id: UUID = Field(description="Propagated into ML service logs for tracing.")
    model_version: str | None = Field(
        default=None,
        description="Pin a specific version to reproduce an old finding. Omit to use the active model.",
    )


class InferResponse(BaseModel):
    """A successful inference.

    An EMPTY `detections` list means the model ran and found nothing, which is
    NOT the same as a full shelf. The ML service returns 422 NO_SHELF_DETECTED
    rather than an empty 200 whenever it cannot see shelf structure at all.
    """

    request_id: UUID
    model_version: str
    model_sha: str
    inference_ms: int = Field(ge=0)
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    detections: list[Detection]


class InferError(BaseModel):
    """Body of a 422, 503 or 501 response."""

    request_id: UUID | None = None
    error_code: InferErrorCode
    detail: str


class ModelInfo(BaseModel):
    version: str
    sha: str
    is_active: bool
    loaded: bool


class ModelsResponse(BaseModel):
    active_version: str | None
    models: list[ModelInfo]


class HealthResponse(BaseModel):
    status: str
    detail: str | None = None
