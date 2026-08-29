"""Frozen value objects for the pure analysis layer.

These deliberately do not import SQLAlchemy, FastAPI or Celery. The OSA engine
consumes and produces only these, which is what lets it be tested from JSON
fixtures with no infrastructure running at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from shelfeye_contracts import SemanticType

from .enums import OsaStatus


@dataclass(frozen=True, slots=True)
class BBox:
    """Absolute pixels, top-left origin. Never normalised."""

    x: float
    y: float
    w: float
    h: float

    @property
    def area(self) -> float:
        return self.w * self.h

    @property
    def center_y(self) -> float:
        return self.y + self.h / 2

    @property
    def center_x(self) -> float:
        return self.x + self.w / 2


@dataclass(frozen=True, slots=True)
class Detection:
    detection_id: UUID
    class_id: int
    class_name: str
    semantic_type: SemanticType
    bbox: BBox
    confidence: float


@dataclass(frozen=True, slots=True)
class AnalysisConfig:
    """Every threshold the OSA engine uses.

    Sourced from settings (and, in a fuller build, a versioned config table).
    `version` is stamped onto each analysis so a finding from three months ago
    can still be explained with the rules that were in force at the time.
    """

    version: str = "v2"
    min_confidence: float = 0.35
    low_confidence_threshold: float = 0.55
    # See config.py for how this number was measured.
    row_tolerance_ratio: float = 0.75
    critical_threshold: float = 0.75
    low_threshold: float = 0.90


@dataclass(frozen=True, slots=True)
class RowMetrics:
    shelf_row_index: int
    product_area: float
    gap_area: float
    gap_ratio: float
    detection_count: int


@dataclass(frozen=True, slots=True)
class GapFinding:
    detection_id: UUID
    shelf_row_index: int
    position_label: str
    confidence: float
    is_low_confidence: bool


@dataclass(frozen=True, slots=True)
class ShelfAnalysis:
    """Result of the pure analysis. Area-share metrics only — never unit counts."""

    row_count: int
    total_shelf_area: float
    gap_area: float
    gap_ratio: float
    osa_score: float
    status: OsaStatus
    config_version: str
    low_confidence_count: int
    rows: tuple[RowMetrics, ...] = field(default_factory=tuple)
    findings: tuple[GapFinding, ...] = field(default_factory=tuple)
    row_index_by_detection: dict[UUID, int] = field(default_factory=dict)
