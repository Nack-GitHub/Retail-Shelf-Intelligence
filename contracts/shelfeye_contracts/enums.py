"""Enums shared across the inference boundary.

`SemanticType` is the load-bearing one: it is the ONLY field the backend is
permitted to branch on. Raw class names (there are 45 of them today, and the
list changes on every retrain) never reach backend business logic.
"""

from __future__ import annotations

from enum import StrEnum


class SemanticType(StrEnum):
    """Stable operational meaning of a detection, owned by the ML service.

    The mapping from a raw model class to one of these values ships inside the
    model artifact as `class_map.yaml`. When the SKU list changes, only the
    artifact changes — the backend does not redeploy.
    """

    PRODUCT = "PRODUCT"
    GAP = "GAP"
    PRICE_TAG = "PRICE_TAG"
    PROMO_TAG = "PROMO_TAG"


class InferErrorCode(StrEnum):
    """Machine-readable reasons an inference request could not be served."""

    # 422 — the caller must not retry; the photo itself is the problem.
    UNREADABLE_IMAGE = "UNREADABLE_IMAGE"
    NO_SHELF_DETECTED = "NO_SHELF_DETECTED"
    IMAGE_NOT_FOUND = "IMAGE_NOT_FOUND"

    # 503 — transient; retrying is the correct response.
    MODEL_NOT_LOADED = "MODEL_NOT_LOADED"
    MODEL_WARMING_UP = "MODEL_WARMING_UP"

    # 501 — pinning to an older version is not supported in this build.
    VERSION_NOT_AVAILABLE = "VERSION_NOT_AVAILABLE"
