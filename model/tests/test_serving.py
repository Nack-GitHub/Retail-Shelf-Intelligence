"""Serving tests. The coordinate maths gets the most attention on purpose."""

from __future__ import annotations

import uuid
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from shelfeye_contracts import SemanticType

from shelfeye_ml.artifact.class_map import ClassMap
from shelfeye_ml.serving.postprocess import decode
from shelfeye_ml.serving.preprocess import letterbox

ROOT = Path(__file__).resolve().parents[1]
CLASS_MAP = ClassMap.load(ROOT / "class_map.yaml")


# ── Letterbox round-trip ─────────────────────────────────────────────────────


@pytest.mark.parametrize("size", [(1920, 1080), (1080, 1920), (800, 800), (4000, 2250)])
def test_letterbox_round_trip_recovers_original_coordinates(size: tuple[int, int]) -> None:
    """The single most common integration bug in detection systems."""
    image = Image.new("RGB", size)
    _, transform = letterbox(image, 640)

    for original_x, original_y in [(0, 0), (size[0] / 2, size[1] / 2), (size[0] - 1, size[1] - 1)]:
        letterboxed_x = original_x * transform.scale + transform.pad_x
        letterboxed_y = original_y * transform.scale + transform.pad_y
        back_x, back_y = transform.to_original(letterboxed_x, letterboxed_y)
        assert back_x == pytest.approx(original_x, abs=0.01)
        assert back_y == pytest.approx(original_y, abs=0.01)


def test_letterbox_preserves_aspect_ratio() -> None:
    tensor, transform = letterbox(Image.new("RGB", (1920, 1080)), 640)
    assert tensor.shape == (1, 3, 640, 640)
    assert transform.scale == pytest.approx(640 / 1920)
    assert transform.pad_y > 0 and transform.pad_x == 0


def test_letterbox_output_is_normalised_nchw_float32() -> None:
    tensor, _ = letterbox(Image.new("RGB", (100, 100), (255, 255, 255)), 320)
    assert tensor.dtype == np.float32
    assert tensor.max() <= 1.0 and tensor.min() >= 0.0


# ── Decoding ─────────────────────────────────────────────────────────────────


def _raw_prediction(boxes: list[tuple[float, float, float, float, int, float]]) -> np.ndarray:
    """Build a fake (1, 4+nc, N) YOLO head from (cx, cy, w, h, class_id, conf)."""
    n_classes = len(CLASS_MAP)
    out = np.zeros((1, 4 + n_classes, len(boxes)), dtype=np.float32)
    for i, (cx, cy, w, h, class_id, conf) in enumerate(boxes):
        out[0, :4, i] = [cx, cy, w, h]
        out[0, 4 + class_id, i] = conf
    return out


def test_decode_converts_centre_form_to_absolute_corner_pixels() -> None:
    image = Image.new("RGB", (1920, 1080))
    _, transform = letterbox(image, 640)

    # A box centred in the letterboxed frame must land centred in the original.
    raw = _raw_prediction([(320.0, 320.0, 100.0, 60.0, 19, 0.9)])
    detections = decode(raw, transform, CLASS_MAP, conf_threshold=0.25)

    assert len(detections) == 1
    box = detections[0].bbox
    assert box.center_x == pytest.approx(960, abs=2)
    assert box.center_y == pytest.approx(540, abs=2)
    # Absolute pixels, not normalised.
    assert box.w > 1 and box.h > 1


def test_decode_attaches_semantic_type_from_the_class_map() -> None:
    _, transform = letterbox(Image.new("RGB", (1920, 1080)), 640)
    raw = _raw_prediction(
        [(320.0, 300.0, 80.0, 80.0, 19, 0.9),   # Empty Shelf -> GAP
         (200.0, 300.0, 80.0, 80.0, 31, 0.8),   # Price       -> PRICE_TAG
         (400.0, 300.0, 80.0, 80.0, 18, 0.8),   # Discount    -> PROMO_TAG
         (100.0, 300.0, 80.0, 80.0, 0, 0.8)]    # AB Bohne    -> PRODUCT
    )
    by_type = {d.semantic_type for d in decode(raw, transform, CLASS_MAP, conf_threshold=0.25)}
    assert by_type == {
        SemanticType.GAP, SemanticType.PRICE_TAG, SemanticType.PROMO_TAG, SemanticType.PRODUCT
    }


def test_decode_drops_low_confidence_predictions() -> None:
    _, transform = letterbox(Image.new("RGB", (640, 640)), 640)
    raw = _raw_prediction([(320.0, 320.0, 50.0, 50.0, 19, 0.10)])
    assert decode(raw, transform, CLASS_MAP, conf_threshold=0.25) == []


def test_decode_suppresses_duplicates_of_the_same_class() -> None:
    _, transform = letterbox(Image.new("RGB", (640, 640)), 640)
    raw = _raw_prediction(
        [(320.0, 320.0, 100.0, 100.0, 19, 0.90), (322.0, 321.0, 100.0, 100.0, 19, 0.85)]
    )
    assert len(decode(raw, transform, CLASS_MAP, conf_threshold=0.25)) == 1


def test_decode_keeps_overlapping_boxes_of_different_classes() -> None:
    """A price label overlapping the product above it is two real detections."""
    _, transform = letterbox(Image.new("RGB", (640, 640)), 640)
    raw = _raw_prediction(
        [(320.0, 320.0, 100.0, 100.0, 19, 0.90), (320.0, 320.0, 100.0, 100.0, 31, 0.88)]
    )
    assert len(decode(raw, transform, CLASS_MAP, conf_threshold=0.25)) == 2


def test_decode_clamps_boxes_that_extend_into_the_padding() -> None:
    _, transform = letterbox(Image.new("RGB", (1920, 1080)), 640)
    raw = _raw_prediction([(20.0, 20.0, 200.0, 200.0, 19, 0.9)])
    for detection in decode(raw, transform, CLASS_MAP, conf_threshold=0.25):
        assert detection.bbox.x >= 0 and detection.bbox.y >= 0
        assert detection.bbox.x + detection.bbox.w <= 1920 + 1
        assert detection.bbox.y + detection.bbox.h <= 1080 + 1


def test_decode_rejects_a_head_whose_class_count_disagrees_with_the_artifact() -> None:
    """Weights and class map from different runs must fail loudly.

    Silently skipping the unknown classes would let a 50-class model serve
    through a 45-class map, quietly relabelling every detection — the worst
    possible outcome, since the output still looks perfectly well-formed.
    """
    _, transform = letterbox(Image.new("RGB", (640, 640)), 640)
    raw = np.zeros((1, 4 + 50, 8), dtype=np.float32)
    raw[0, :4, 0] = [320, 320, 50, 50]
    raw[0, 4 + 47, 0] = 0.99

    with pytest.raises(ValueError, match="neither axis"):
        decode(raw, transform, CLASS_MAP, conf_threshold=0.25)


def test_decode_returns_empty_for_an_empty_head() -> None:
    _, transform = letterbox(Image.new("RGB", (640, 640)), 640)
    assert decode(np.zeros((1, 4 + len(CLASS_MAP), 0), np.float32), transform, CLASS_MAP) == []
    assert decode(np.zeros((1, 0, 6), np.float32), transform, CLASS_MAP) == []


# ── YOLO26 End-to-End Format ──────────────────────────────────────────────────


def test_decode_handles_yolo26_end_to_end_format() -> None:
    image = Image.new("RGB", (1920, 1080))
    _, transform = letterbox(image, 640)

    # YOLO26 ONNX outputs (1, N, 6) where cols are [x1, y1, x2, y2, conf, class_id]
    # In letterboxed 640x640:
    # y pad is (640 - 1080 * (640/1920)) / 2 = (640 - 360) / 2 = 140
    # A box from letterbox (270, 110, 370, 170) -> cx=320, cy=140 in letterbox -> original cx=960, cy=0
    raw = np.array([
        [[270.0, 110.0, 370.0, 170.0, 0.95, 19.0],  # Empty Shelf (GAP)
         [100.0, 150.0, 200.0, 250.0, 0.85, 31.0],  # Price (PRICE_TAG)
         [50.0, 50.0, 80.0, 80.0, 0.10, 0.0]],     # Low confidence -> filtered
    ], dtype=np.float32)

    detections = decode(raw, transform, CLASS_MAP, conf_threshold=0.25)
    assert len(detections) == 2
    assert detections[0].semantic_type == SemanticType.GAP
    assert detections[0].class_name == "Empty Shelf"
    assert detections[0].confidence == 0.95
    assert detections[1].semantic_type == SemanticType.PRICE_TAG
    assert detections[1].class_name == "Price"


def test_decode_supports_per_class_thresholds() -> None:
    image = Image.new("RGB", (640, 640))
    _, transform = letterbox(image, 640)

    # Empty Shelf with conf 0.16 (above 0.15 gap threshold, below 0.25 default)
    # Product with conf 0.20 (below 0.25 product threshold)
    raw = np.array([
        [[100.0, 100.0, 200.0, 200.0, 0.16, 19.0],  # Empty Shelf
         [300.0, 300.0, 400.0, 400.0, 0.20, 0.0]],   # AB Bohne (Product)
    ], dtype=np.float32)

    class_thresholds = {"Empty Shelf": 0.15, "default": 0.25}
    detections = decode(raw, transform, CLASS_MAP, conf_threshold=0.25, class_thresholds=class_thresholds)

    assert len(detections) == 1
    assert detections[0].class_name == "Empty Shelf"
    assert detections[0].semantic_type == SemanticType.GAP


