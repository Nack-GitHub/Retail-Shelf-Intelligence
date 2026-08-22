"""Deterministic fake inference, so the backend ships without the ML team.

Determinism matters more than realism here: the same image_uri must produce
byte-identical detections in every process, forever. That is what makes an
integration test's expected OSA score a fixed number rather than a range, and
what lets a demo be rehearsed.

Scenarios are selected by filename convention so a test can ask for a specific
shape of shelf without any setup:

    *_full.jpg        a well-stocked shelf, no gaps
    *_gaps.jpg        three gaps in the middle row
    *_lowconf.jpg     a gap the model only half-believes
    *_unreadable.jpg  422 — the rep must retake the photo
    *_slow.jpg        12s delay, for timeout behaviour
    *_error.jpg       503 — transient, retryable
"""

from __future__ import annotations

import hashlib
import random
import time
import uuid
from uuid import UUID

from shelfeye_contracts import BBox, Detection, InferResponse, SemanticType

from app.core.exceptions import MLServiceError, UnreadableImageError

MOCK_MODEL_VERSION = "mock-v1"
MOCK_MODEL_SHA = "mockmock"

# Mirrors the real dataset's class ids so anything downstream that logs them
# sees plausible values.
_GAP_CLASS = (19, "Empty Shelf")
_PRICE_CLASS = (31, "Price")
_PRODUCTS = [(0, "AB Bohne"), (4, "BM Bohne"), (25, "FM Bohne"), (32, "SM Bohne")]

_IMAGE_W, _IMAGE_H = 1920, 1080
_ROWS_Y = (140, 440, 740)
_SLOTS_PER_ROW = 8
_SLOT_W, _SLOT_H = 180, 240


class MockMLClient:
    """A seeded, offline stand-in for the inference service."""

    def infer(
        self, image_uri: str, request_id: UUID, model_version: str | None = None
    ) -> InferResponse:
        scenario = _scenario_for(image_uri)

        if scenario == "unreadable":
            raise UnreadableImageError("mock: image marked unreadable by filename")
        if scenario == "error":
            raise MLServiceError("mock: service marked unavailable by filename")
        if scenario == "slow":
            time.sleep(12)

        rng = random.Random(_seed(image_uri))
        detections = _build_detections(scenario, rng)

        return InferResponse(
            request_id=request_id,
            model_version=model_version or MOCK_MODEL_VERSION,
            model_sha=MOCK_MODEL_SHA,
            inference_ms=rng.randint(180, 420),
            image_width=_IMAGE_W,
            image_height=_IMAGE_H,
            detections=detections,
        )


def _seed(image_uri: str) -> int:
    """A stable seed derived from the URI, not from process state."""
    return int.from_bytes(hashlib.sha256(image_uri.encode()).digest()[:8], "big")


def _scenario_for(image_uri: str) -> str:
    """Pick a scenario from a `_marker` token anywhere in the URI.

    Matching the whole URI rather than just the extension means the marker
    survives being embedded in a date-partitioned object key, so tests and
    demos can drive a specific shelf shape through the real presign flow.
    """
    lowered = image_uri.lower()
    for marker in ("unreadable", "error", "slow", "lowconf", "full", "gaps"):
        if f"_{marker}" in lowered:
            return marker
    return "default"


def _stable_uuid(rng: random.Random) -> uuid.UUID:
    """UUID4-shaped but drawn from the seeded RNG, so runs are reproducible."""
    return uuid.UUID(int=rng.getrandbits(128), version=4)


def _build_detections(scenario: str, rng: random.Random) -> list[Detection]:
    gaps_by_row = {
        "full": (0, 0, 0),
        "gaps": (0, 3, 0),
        "lowconf": (0, 1, 0),
        "default": (1, 2, 0),
    }[scenario if scenario in {"full", "gaps", "lowconf"} else "default"]

    detections: list[Detection] = []
    for row_y, gap_count in zip(_ROWS_Y, gaps_by_row, strict=True):
        for slot in range(_SLOTS_PER_ROW):
            is_gap = slot < gap_count
            class_id, class_name = _GAP_CLASS if is_gap else _PRODUCTS[slot % len(_PRODUCTS)]

            if is_gap and scenario == "lowconf":
                # Deliberately inside the 0.35–0.55 band so the UI shows this as
                # "ต้องตรวจสอบ" rather than asserting it.
                confidence = 0.42
            elif is_gap:
                confidence = round(rng.uniform(0.72, 0.94), 3)
            else:
                confidence = round(rng.uniform(0.68, 0.97), 3)

            detections.append(
                Detection(
                    detection_id=_stable_uuid(rng),
                    class_id=class_id,
                    class_name=class_name,
                    semantic_type=SemanticType.GAP if is_gap else SemanticType.PRODUCT,
                    bbox=BBox(x=80 + slot * 220, y=row_y, w=_SLOT_W, h=_SLOT_H),
                    confidence=confidence,
                )
            )

        # A price rail under each row. Excluded from area math by the engine —
        # present precisely so that exclusion is exercised.
        detections.append(
            Detection(
                detection_id=_stable_uuid(rng),
                class_id=_PRICE_CLASS[0],
                class_name=_PRICE_CLASS[1],
                semantic_type=SemanticType.PRICE_TAG,
                bbox=BBox(x=80, y=row_y + _SLOT_H + 6, w=1700, h=34),
                confidence=round(rng.uniform(0.6, 0.9), 3),
            )
        )

    return detections
