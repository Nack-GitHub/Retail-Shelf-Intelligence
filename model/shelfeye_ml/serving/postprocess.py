"""Decode YOLO output into contract detections.

Two conversions happen here and both are load-bearing:

1. centre-form (cx, cy, w, h) -> corner-form (x, y, w, h)
2. letterbox space -> ORIGINAL image pixels

The contract says absolute pixels, top-left origin. Anything else produces
boxes that look almost right, which is worse than obviously wrong.
"""

from __future__ import annotations

import uuid

import numpy as np
from shelfeye_contracts import BBox, Detection

from shelfeye_ml.artifact.class_map import ClassMap
from shelfeye_ml.serving.preprocess import LetterboxTransform


def decode(
    raw: np.ndarray,
    transform: LetterboxTransform,
    class_map: ClassMap,
    *,
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.45,
    max_detections: int = 300,
) -> list[Detection]:
    """Turn a (1, 4+nc, N) YOLO head into contract detections."""
    predictions = raw[0] if raw.ndim == 3 else raw

    # Orient to (N, 4+nc). Decide by matching the KNOWN feature count, not by
    # comparing the two axis lengths: with fewer detections than features — a
    # near-empty shelf, or any unit test — the size comparison picks the wrong
    # axis and silently reads class scores as coordinates.
    features = 4 + len(class_map)
    if predictions.shape[0] == features and predictions.shape[1] != features:
        predictions = predictions.T
    elif predictions.shape[1] != features:
        raise ValueError(
            f"model head has neither axis equal to {features}: shape {predictions.shape}"
        )

    if predictions.shape[0] == 0:
        return []

    boxes_cxcywh = predictions[:, :4]
    class_scores = predictions[:, 4:]

    class_ids = class_scores.argmax(axis=1)
    confidences = class_scores.max(axis=1)

    keep = confidences >= conf_threshold
    boxes_cxcywh, class_ids, confidences = (
        boxes_cxcywh[keep],
        class_ids[keep],
        confidences[keep],
    )
    if len(confidences) == 0:
        return []

    xyxy = _to_corners(boxes_cxcywh)
    kept = _nms(xyxy, confidences, class_ids, iou_threshold)[:max_detections]

    detections: list[Detection] = []
    for index in kept:
        class_id = int(class_ids[index])
        if class_id not in class_map:
            # Weights and class map disagree — better to skip than mislabel.
            continue

        x1, y1 = transform.to_original(xyxy[index][0], xyxy[index][1])
        x2, y2 = transform.to_original(xyxy[index][2], xyxy[index][3])

        # Clamp to the image: a box may extend into the padding.
        x1 = max(0.0, min(x1, transform.original_width))
        y1 = max(0.0, min(y1, transform.original_height))
        x2 = max(0.0, min(x2, transform.original_width))
        y2 = max(0.0, min(y2, transform.original_height))
        if x2 - x1 <= 1 or y2 - y1 <= 1:
            continue

        entry = class_map.entry(class_id)
        detections.append(
            Detection(
                detection_id=uuid.uuid4(),
                class_id=class_id,
                class_name=entry.name,
                semantic_type=entry.semantic_type,
                bbox=BBox(x=round(x1, 2), y=round(y1, 2),
                          w=round(x2 - x1, 2), h=round(y2 - y1, 2)),
                confidence=round(float(confidences[index]), 4),
            )
        )
    return detections


def _to_corners(cxcywh: np.ndarray) -> np.ndarray:
    half_w, half_h = cxcywh[:, 2] / 2, cxcywh[:, 3] / 2
    return np.stack(
        [cxcywh[:, 0] - half_w, cxcywh[:, 1] - half_h,
         cxcywh[:, 0] + half_w, cxcywh[:, 1] + half_h],
        axis=1,
    )


def _nms(
    boxes: np.ndarray, scores: np.ndarray, class_ids: np.ndarray, iou_threshold: float
) -> list[int]:
    """Class-aware NMS.

    Per class, because a `Price` label overlapping the product above it is two
    real detections, not one duplicate.
    """
    keep: list[int] = []
    for class_id in np.unique(class_ids):
        indices = np.where(class_ids == class_id)[0]
        order = indices[scores[indices].argsort()[::-1]]
        while order.size:
            best = order[0]
            keep.append(int(best))
            if order.size == 1:
                break
            order = order[1:][_iou(boxes[best], boxes[order[1:]]) <= iou_threshold]
    keep.sort(key=lambda i: -scores[i])
    return keep


def _iou(box: np.ndarray, others: np.ndarray) -> np.ndarray:
    x1 = np.maximum(box[0], others[:, 0])
    y1 = np.maximum(box[1], others[:, 1])
    x2 = np.minimum(box[2], others[:, 2])
    y2 = np.minimum(box[3], others[:, 3])

    intersection = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = (box[2] - box[0]) * (box[3] - box[1])
    areas = (others[:, 2] - others[:, 0]) * (others[:, 3] - others[:, 1])
    return intersection / np.maximum(area + areas - intersection, 1e-9)
