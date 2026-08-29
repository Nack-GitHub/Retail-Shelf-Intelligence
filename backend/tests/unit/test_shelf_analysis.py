"""Fixtures for the OSA engine. Runs with NO services and NO network.

The six scenarios required by the spec, plus the boundary cases that would
otherwise be discovered in production by a rep standing in a shop.
"""

from __future__ import annotations

import uuid

import pytest
from shelfeye_contracts import SemanticType

from app.core.exceptions import NoShelfDetectedError
from app.domain.enums import OsaStatus
from app.domain.values import AnalysisConfig, BBox, Detection
from app.services.shelf_analysis import _POSITION_LABELS, analyse

W, H = 1920, 1080
CONFIG = AnalysisConfig()


def det(
    x: float,
    y: float,
    w: float = 100,
    h: float = 200,
    semantic: SemanticType = SemanticType.PRODUCT,
    conf: float = 0.9,
    class_id: int = 0,
) -> Detection:
    return Detection(
        detection_id=uuid.uuid4(),
        class_id=class_id,
        class_name="fixture",
        semantic_type=semantic,
        bbox=BBox(x=x, y=y, w=w, h=h),
        confidence=conf,
    )


def row_of(count: int, y: float, *, gaps: int = 0, conf: float = 0.9) -> list[Detection]:
    """One shelf row: `gaps` of the `count` slots are empty."""
    return [
        det(
            x=100 + i * 150,
            y=y,
            semantic=SemanticType.GAP if i < gaps else SemanticType.PRODUCT,
            conf=conf,
        )
        for i in range(count)
    ]


def shelf_bay(shelf_count: int, *, rails: bool = True, gap_on_shelf: int = 0) -> list[Detection]:
    """A bay shot head-on, in the shape every photo in the dataset has.

    Products stand on each board; the price rail is mounted on that board's
    front lip, which puts it below the products it prices and outside their
    vertical spread. `rails=False` gives the same bay with the rails cropped
    out, so the two can be compared.
    """
    detections: list[Detection] = []
    for shelf in range(1, shelf_count + 1):
        top = 100 + (shelf - 1) * 300
        detections += [
            det(
                x=100 + i * 150,
                y=top,
                semantic=(
                    SemanticType.GAP if shelf == gap_on_shelf and i == 4 else SemanticType.PRODUCT
                ),
            )
            for i in range(8)
        ]
        if rails:
            detections += [
                det(x=100 + i * 200, y=top + 210, w=90, h=45, semantic=SemanticType.PRICE_TAG)
                for i in range(6)
            ]
    return detections


# ── Fixture 1: a full shelf ──────────────────────────────────────────────────


def test_full_shelf_scores_perfect() -> None:
    detections = row_of(8, 100) + row_of(8, 400) + row_of(8, 700)
    result = analyse(detections, CONFIG, image_width=W, image_height=H)

    assert result.osa_score == pytest.approx(1.0)
    assert result.gap_ratio == pytest.approx(0.0)
    assert result.status is OsaStatus.OK
    assert result.row_count == 3
    assert result.findings == ()


# ── Fixture 2: one large gap ─────────────────────────────────────────────────


def test_single_large_gap_is_flagged() -> None:
    detections = row_of(8, 100) + row_of(8, 400, gaps=3) + row_of(8, 700)
    result = analyse(detections, CONFIG, image_width=W, image_height=H)

    assert result.gap_ratio == pytest.approx(3 / 24)
    assert result.osa_score == pytest.approx(1 - 3 / 24)
    assert result.status is OsaStatus.LOW
    assert len(result.findings) == 3
    assert all(f.shelf_row_index == 2 for f in result.findings)


def test_critical_threshold_uses_config_not_a_literal() -> None:
    """Trade marketing changes this number; the engine must follow the config."""
    detections = row_of(10, 100, gaps=3)

    default = analyse(detections, CONFIG, image_width=W, image_height=H)
    assert default.status is OsaStatus.CRITICAL  # osa 0.70 < 0.75

    lenient = analyse(
        detections,
        AnalysisConfig(version="v2", critical_threshold=0.60, low_threshold=0.65),
        image_width=W,
        image_height=H,
    )
    assert lenient.status is OsaStatus.OK
    assert lenient.config_version == "v2"


# ── Fixture 3: a badly tilted photo where rows overlap ───────────────────────


def test_tilted_photo_degrades_gracefully() -> None:
    """A tilted shot chains rows together. The engine must still produce a
    usable number rather than crashing or inventing dozens of rows."""
    detections = [
        det(x=100 + i * 150, y=100 + i * 40, semantic=SemanticType.PRODUCT) for i in range(8)
    ] + [det(x=100 + i * 150, y=420 + i * 40, semantic=SemanticType.GAP) for i in range(4)]
    result = analyse(detections, CONFIG, image_width=W, image_height=H)

    assert result.row_count >= 1
    assert 0.0 <= result.osa_score <= 1.0
    assert len(result.findings) == 4
    # Every finding still gets a row and a human-readable position.
    assert all(f.shelf_row_index >= 1 for f in result.findings)
    assert all("ชั้นที่" in f.position_label for f in result.findings)


# ── Fixture 4: an image with only price tags ─────────────────────────────────


def test_price_tags_only_is_not_a_verdict() -> None:
    """Seeing the shelf edge tells us nothing about availability.

    Returning either 0% or 100% here would be a fabrication, so this is an error.
    """
    detections = [
        det(x=100 + i * 150, y=300, h=40, semantic=SemanticType.PRICE_TAG) for i in range(6)
    ] + [det(x=900, y=300, h=40, semantic=SemanticType.PROMO_TAG)]

    with pytest.raises(NoShelfDetectedError):
        analyse(detections, CONFIG, image_width=W, image_height=H)


def test_tags_are_excluded_from_area_math() -> None:
    """A huge promo sign must not dilute the gap ratio."""
    without_tags = analyse(row_of(4, 100, gaps=2), CONFIG, image_width=W, image_height=H)
    with_tags = analyse(
        row_of(4, 100, gaps=2) + [det(x=0, y=90, w=800, h=220, semantic=SemanticType.PROMO_TAG)],
        CONFIG,
        image_width=W,
        image_height=H,
    )
    assert with_tags.gap_ratio == pytest.approx(without_tags.gap_ratio)
    assert with_tags.osa_score == pytest.approx(0.5)


# ── Row numbering: only shelves get a number ─────────────────────────────────


def test_price_rails_do_not_get_shelf_numbers_of_their_own() -> None:
    """The defect this fixture exists for: a rep sent to the wrong shelf.

    Clustering every detection together made each board two rows — its products
    and the rail under them — so a six-shelf bay reported twelve rows and a gap
    on the fourth shelf was announced as "ชั้นที่ 7".
    """
    with_rails = analyse(shelf_bay(6), CONFIG, image_width=W, image_height=H)
    cropped = analyse(shelf_bay(6, rails=False), CONFIG, image_width=W, image_height=H)

    assert with_rails.row_count == 6
    assert cropped.row_count == with_rails.row_count


def test_a_gap_reports_the_shelf_a_rep_can_count_to() -> None:
    result = analyse(shelf_bay(6, gap_on_shelf=4), CONFIG, image_width=W, image_height=H)

    assert len(result.findings) == 1
    assert result.findings[0].shelf_row_index == 4
    assert "ชั้นที่ 4" in result.findings[0].position_label


def test_tag_boxes_do_not_shrink_the_row_tolerance() -> None:
    """Tags are a quarter the height of a product. Letting them into the median
    pulled the tolerance down until genuine rows split apart as well."""
    products = row_of(6, 100) + row_of(6, 340)
    swarm = [
        det(x=100 + i * 90, y=305, w=60, h=30, semantic=SemanticType.PRICE_TAG) for i in range(20)
    ]

    assert analyse(products, CONFIG, image_width=W, image_height=H).row_count == 2
    assert analyse(products + swarm, CONFIG, image_width=W, image_height=H).row_count == 2


def test_a_price_rail_belongs_to_the_shelf_above_it() -> None:
    """A rail prices the products standing on its own board — the ones above it.

    This rail sits past the midpoint between the two rows, so picking the
    nearest row by centre distance would answer 2. Physically it is 1.
    """
    upper = row_of(4, 100)  # centre y 200
    lower = row_of(4, 700)  # centre y 800
    rail = det(x=100, y=500, w=90, h=40, semantic=SemanticType.PRICE_TAG)  # centre y 520

    result = analyse([*upper, *lower, rail], CONFIG, image_width=W, image_height=H)

    assert result.row_count == 2
    assert result.row_index_by_detection[rail.detection_id] == 1


def test_a_header_strip_above_every_shelf_falls_back_to_row_one() -> None:
    banner = det(x=0, y=10, w=1800, h=60, semantic=SemanticType.PROMO_TAG)
    result = analyse([*row_of(4, 200), banner], CONFIG, image_width=W, image_height=H)

    assert result.row_index_by_detection[banner.detection_id] == 1


# ── Fixture 5: an empty detection list ───────────────────────────────────────


def test_empty_detections_is_an_error_not_a_perfect_shelf() -> None:
    """The single most damaging bug this system could ship."""
    with pytest.raises(NoShelfDetectedError):
        analyse([], CONFIG, image_width=W, image_height=H)


def test_everything_below_confidence_floor_is_also_an_error() -> None:
    detections = row_of(8, 100, conf=0.2)
    with pytest.raises(NoShelfDetectedError):
        analyse(detections, CONFIG, image_width=W, image_height=H)


# ── Fixture 6: a single-row close-up ─────────────────────────────────────────


def test_single_row_closeup() -> None:
    detections = [
        det(x=100 + i * 300, y=400, w=250, h=500, semantic=SemanticType.PRODUCT) for i in range(5)
    ]
    detections[2] = det(x=700, y=400, w=250, h=500, semantic=SemanticType.GAP)

    result = analyse(detections, CONFIG, image_width=W, image_height=H)
    assert result.row_count == 1
    assert result.osa_score == pytest.approx(0.8)
    assert len(result.findings) == 1
    assert result.findings[0].shelf_row_index == 1


# ── Low confidence handling ──────────────────────────────────────────────────


def test_low_confidence_detections_are_marked_not_dropped() -> None:
    """Between 0.35 and 0.55 the model half-believes it. Show it, don't assert it."""
    detections = row_of(6, 100) + [det(x=1000, y=100, semantic=SemanticType.GAP, conf=0.45)]
    result = analyse(detections, CONFIG, image_width=W, image_height=H)

    assert result.low_confidence_count == 1
    assert len(result.findings) == 1
    assert result.findings[0].is_low_confidence is True


# ── Position labels ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "center_x,expected",
    [(100, "ตำแหน่งซ้าย"), (960, "ตำแหน่งกลาง"), (1800, "ตำแหน่งขวา")],
)
def test_position_label_thirds(center_x: float, expected: str) -> None:
    detections = row_of(4, 100) + [det(x=center_x - 50, y=100, w=100, semantic=SemanticType.GAP)]
    result = analyse(detections, CONFIG, image_width=W, image_height=H)
    assert expected in result.findings[0].position_label


def test_position_label_right_edge_does_not_overflow() -> None:
    """A gap flush against the right edge must not index past the label tuple."""
    detections = row_of(4, 100) + [det(x=W - 100, y=100, w=100, semantic=SemanticType.GAP)]
    result = analyse(detections, CONFIG, image_width=W, image_height=H)
    assert "ตำแหน่งขวา" in result.findings[0].position_label


def test_findings_run_left_to_right_across_a_row() -> None:
    """Sorting by the finished label ordered the Thai words by code point —
    กลาง, ขวา, ซ้าย — handing the rep every row's middle before its left end."""
    left = det(x=100, y=100, semantic=SemanticType.GAP)  # centre x 150
    middle = det(x=900, y=100, semantic=SemanticType.GAP)  # centre x 950
    right = det(x=1700, y=100, semantic=SemanticType.GAP)  # centre x 1750

    result = analyse([*row_of(4, 100), right, middle, left], CONFIG, image_width=W, image_height=H)

    assert [f.detection_id for f in result.findings] == [
        left.detection_id,
        middle.detection_id,
        right.detection_id,
    ]
    assert [f.position_label.split(" · ")[1] for f in result.findings] == list(_POSITION_LABELS)


# ── Purity ───────────────────────────────────────────────────────────────────


def test_module_imports_no_framework() -> None:
    """The engine must stay testable with nothing running."""
    import inspect

    from app.services import shelf_analysis

    source = inspect.getsource(shelf_analysis)
    for forbidden in ("fastapi", "sqlalchemy", "celery", "boto3", "httpx", "datetime.now"):
        assert forbidden not in source, f"{forbidden} leaked into the pure engine"
