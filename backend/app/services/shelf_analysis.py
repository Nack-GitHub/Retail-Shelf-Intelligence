"""On-shelf-availability rules. PURE — no I/O, no ORM, no framework, no clock.

Everything here is a business decision that trade marketing will want to change
without a model release, which is exactly why it lives in the backend rather
than in the model. Every threshold arrives via AnalysisConfig and the config
version is stamped onto the result, so a finding from three months ago can
still be explained with the rules that were in force when it was made.

## Measurement caveat

This module reports AREA-SHARE metrics (gap_ratio, osa_score) and deliberately
does not count units. Occlusion, stacked facings and promotional signage make
piece-counting unreliable, whereas area share degrades gracefully under all
three. A request for exact piece counts should be pushed back on with this
rationale rather than implemented.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterable, Sequence
from statistics import median
from uuid import UUID

from shelfeye_contracts import SemanticType

from app.core.exceptions import NoShelfDetectedError
from app.domain.enums import OsaStatus
from app.domain.values import (
    AnalysisConfig,
    Detection,
    GapFinding,
    RowMetrics,
    ShelfAnalysis,
)

# Only these two carry shelf area. Price and promo tags are physically on the
# shelf edge, not in the facing space, so counting them would inflate the
# denominator and make every shelf look better stocked than it is.
_AREA_TYPES = frozenset({SemanticType.PRODUCT, SemanticType.GAP})

_POSITION_LABELS = ("ตำแหน่งซ้าย", "ตำแหน่งกลาง", "ตำแหน่งขวา")


def analyse(
    detections: Sequence[Detection],
    config: AnalysisConfig,
    *,
    image_width: int,
    image_height: int,
) -> ShelfAnalysis:
    """Turn raw detections into an OSA verdict.

    Raises:
        NoShelfDetectedError: when the image yields nothing that can support a
            judgement. This is NOT the same as a full shelf — see below.
    """
    if image_width <= 0 or image_height <= 0:
        raise ValueError("image dimensions must be positive")

    kept = _filter_by_confidence(detections, config)
    if not kept:
        # An image where the model finds nothing must never be reported as a
        # perfect shelf. "No gaps found" and "nothing found at all" are
        # different answers, and conflating them silently poisons every trend
        # built on top of this data.
        raise NoShelfDetectedError(
            "no detections above the confidence floor",
            candidates=len(detections),
            min_confidence=config.min_confidence,
        )

    # Price tags only: we can see the shelf edge but nothing about what is or
    # isn't on it. Reporting either 0% or 100% here would be a fabrication.
    shelf_boxes = [d for d in kept if d.semantic_type in _AREA_TYPES]
    if not shelf_boxes:
        raise NoShelfDetectedError(
            "no product or gap area found; only tags were detected",
            candidates=len(detections),
            kept=len(kept),
        )

    rows = _cluster_into_rows(shelf_boxes, config)
    row_metrics, row_index_by_detection = _measure_rows(rows)
    row_index_by_detection.update(_row_index_for_tags(rows, kept))

    total_gap = sum(r.gap_area for r in row_metrics)
    total_product = sum(r.product_area for r in row_metrics)
    shelf_area = total_gap + total_product

    if shelf_area <= 0:
        # Boxes with no extent. Nothing to divide by, so nothing to report.
        raise NoShelfDetectedError(
            "product and gap boxes were found but they enclose no area",
            candidates=len(detections),
            kept=len(kept),
        )

    gap_ratio = total_gap / shelf_area
    osa_score = 1.0 - gap_ratio

    return ShelfAnalysis(
        row_count=len(row_metrics),
        total_shelf_area=shelf_area,
        gap_area=total_gap,
        gap_ratio=gap_ratio,
        osa_score=osa_score,
        status=_classify(osa_score, config),
        config_version=config.version,
        low_confidence_count=sum(1 for d in kept if _is_low_confidence(d, config)),
        rows=tuple(row_metrics),
        findings=_build_findings(kept, row_index_by_detection, config, image_width),
        row_index_by_detection=row_index_by_detection,
    )


# ── Step 1: filter ───────────────────────────────────────────────────────────


def _filter_by_confidence(
    detections: Iterable[Detection], config: AnalysisConfig
) -> list[Detection]:
    return [d for d in detections if d.confidence >= config.min_confidence]


def _is_low_confidence(detection: Detection, config: AnalysisConfig) -> bool:
    """Between the floor and the trust threshold: real enough to show, not to assert."""
    return detection.confidence < config.low_confidence_threshold


# ── Step 2: row clustering ───────────────────────────────────────────────────


def _cluster_into_rows(
    shelf_boxes: Sequence[Detection], config: AnalysisConfig
) -> list[list[Detection]]:
    """Group the shelf-bearing boxes into rows by the y-centre of each box.

    A shelf photo is a grid, and the vertical space between rows is far larger
    than the vertical jitter within one. Single-linkage agglomerative clustering
    in 1-D reduces to sorting by centre-y and splitting wherever the gap to the
    next box exceeds the tolerance — same result, none of the matrix work.

    Tolerance scales with median box height rather than being absolute, so the
    same rule works on a close-up of one shelf and a wide shot of a whole bay.

    Only _AREA_TYPES define a row, for two reasons that both showed up on real
    photos. A price rail hangs below the products it prices and outside their
    vertical spread, so clustering tags alongside products turns one physical
    shelf into two rows and every row number below it is then too high. And a
    tag box is roughly a quarter the height of a product, so tags drag the
    median down and shrink the tolerance until genuine rows split as well.
    Tags are attached to a row afterwards, by _row_index_for_tags.
    """
    ordered = sorted(shelf_boxes, key=lambda d: d.bbox.center_y)
    tolerance = config.row_tolerance_ratio * median(d.bbox.h for d in ordered)

    rows: list[list[Detection]] = [[ordered[0]]]
    for previous, current in zip(ordered, ordered[1:], strict=False):
        if current.bbox.center_y - previous.bbox.center_y > tolerance:
            rows.append([current])
        else:
            rows[-1].append(current)
    return rows


def _row_index_for_tags(
    rows: Sequence[Sequence[Detection]], kept: Sequence[Detection]
) -> dict[UUID, int]:
    """Give every price/promo tag the row it prices.

    A price rail is mounted on the front lip of the board its products stand
    on, which puts the products it belongs to ABOVE it. Picking the nearest
    row by centre distance instead is close to a coin flip between that row
    and the one below, and lands on the wrong one about half the time. A tag
    above every row — a header strip over the top shelf — belongs to row 1.

    Presentation only: tags carry no shelf area, so nothing decided here can
    move an OSA score or a gap ratio.
    """
    anchors = [median(d.bbox.center_y for d in row) for row in rows]
    return {
        d.detection_id: max(bisect_right(anchors, d.bbox.center_y), 1)
        for d in kept
        if d.semantic_type not in _AREA_TYPES
    }


# ── Step 3: per-row metrics ──────────────────────────────────────────────────


def _measure_rows(
    rows: Sequence[Sequence[Detection]],
) -> tuple[list[RowMetrics], dict[UUID, int]]:
    metrics: list[RowMetrics] = []
    row_index_by_detection: dict[UUID, int] = {}

    for index, row in enumerate(rows, start=1):
        product_area = sum(d.bbox.area for d in row if d.semantic_type is SemanticType.PRODUCT)
        gap_area = sum(d.bbox.area for d in row if d.semantic_type is SemanticType.GAP)
        denominator = product_area + gap_area

        for detection in row:
            row_index_by_detection[detection.detection_id] = index

        metrics.append(
            RowMetrics(
                shelf_row_index=index,
                product_area=product_area,
                gap_area=gap_area,
                # A row always holds at least one PRODUCT or GAP — that is what
                # defined it — so the guard is only for zero-extent boxes.
                gap_ratio=gap_area / denominator if denominator > 0 else 0.0,
                detection_count=len(row),
            )
        )

    return metrics, row_index_by_detection


# ── Step 4: image-level status ───────────────────────────────────────────────


def _classify(osa_score: float, config: AnalysisConfig) -> OsaStatus:
    if osa_score < config.critical_threshold:
        return OsaStatus.CRITICAL
    if osa_score < config.low_threshold:
        return OsaStatus.LOW
    return OsaStatus.OK


# ── Step 5: gap findings ─────────────────────────────────────────────────────


def _build_findings(
    detections: Sequence[Detection],
    row_index_by_detection: dict[UUID, int],
    config: AnalysisConfig,
    image_width: int,
) -> tuple[GapFinding, ...]:
    gaps = [d for d in detections if d.semantic_type is SemanticType.GAP]
    # Top row first, then left to right along it, so the list walks the shelf in
    # the order the rep does. Sorting by the finished label instead orders the
    # Thai words by code point — กลาง, ขวา, ซ้าย — which puts the middle of every
    # row ahead of its left-hand end.
    gaps.sort(key=lambda d: (row_index_by_detection[d.detection_id], d.bbox.center_x))
    return tuple(
        GapFinding(
            detection_id=d.detection_id,
            shelf_row_index=row_index_by_detection[d.detection_id],
            position_label=_position_label(
                row_index_by_detection[d.detection_id], d.bbox.center_x, image_width
            ),
            confidence=d.confidence,
            # The UI renders these as "ต้องตรวจสอบ" rather than asserting them
            # as fact, so the rep is never told something the model half-believes.
            is_low_confidence=_is_low_confidence(d, config),
        )
        for d in gaps
    )


def _position_label(row_index: int, center_x: float, image_width: int) -> str:
    """Human-readable location, e.g. "ชั้นที่ 2 · ตำแหน่งซ้าย".

    A rep standing at the shelf needs to find the gap in seconds; pixel
    coordinates are useless to them and row + horizontal third is not.

    Both halves are read off THIS photo: the row number counts the shelves
    visible in the frame from the top down, and left/middle/right splits the
    frame's width, not the bay's. Photograph half a bay and its top shelf is
    still "ชั้นที่ 1".
    """
    third = min(int(center_x / (image_width / 3)), 2)
    return f"ชั้นที่ {row_index} · {_POSITION_LABELS[third]}"
