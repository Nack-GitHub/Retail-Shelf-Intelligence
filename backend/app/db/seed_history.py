"""Demo history: real dataset photographs, run through the real pipeline.

`seed.py` gives the system stores and users. With nothing behind them every
manager screen is an empty state — no OSA trend, no risk ranking, no
detection-to-restock KPI — and a demo of empty charts demonstrates nothing.

Three decisions shape this module.

**The photographs are real.** Every seeded capture is an actual image from
`model/data/`, uploaded to object storage under the visit's own date, so a
manager drilling from a KPI into the evidence sees the pixels the number was
computed from rather than a placeholder.

**The detections are the dataset's labels, not a model's output.** They are
what is genuinely on those shelves, which is why every row written here is
stamped `seed-groundtruth-v1` instead of a model version. Recording this
history under the trained model's name would credit it with a precision it
does not have — its gap recall is 0.74, and a history built from labels is
implicitly perfect.

**The `test/` split is never touched.** Those 66 images are held back so the
live demo can photograph a shelf the model has never seen. Seeding them would
quietly turn the presentation into a memorisation test.

The analysis is not recomputed here. This module implements the `MLClient`
protocol and hands itself to `analysis_pipeline.run_analysis`, so every OSA
score, row index and position label comes from the same code the API runs.
Timestamps are rewritten afterwards: the pipeline stamps `now()`, and a
history that all happened in one second answers none of the questions the
dashboards ask of it.
"""

from __future__ import annotations

import asyncio
import json
import random
import struct
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from uuid import UUID

import yaml
from shelfeye_contracts import BBox, Detection, InferResponse, SemanticType
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.adapters.storage_client import get_storage
from app.core.config import DISPOSABLE_ENVIRONMENTS, settings
from app.db.models import (
    AuditLog,
    Capture,
    DetectionRow,
    GapFindingRow,
    InferenceJob,
    ModelVersion,
    ReplenishmentRequest,
    ShelfAnalysisRow,
    Store,
    TaskRow,
    User,
    Visit,
)
from app.db.seed import store_uuid
from app.db.session import SessionFactory
from app.domain.enums import (
    BlockedReason,
    JobStatus,
    RejectReason,
    TaskStatus,
    VerificationStatus,
    VisitStatus,
)
from app.repositories import store_risk
from app.services.analysis_pipeline import run_analysis
from app.services.risk import haversine_km
from app.workers.session import SyncSessionFactory

DATA_ROOT = Path(__file__).resolve().parents[3] / "model" / "data"

# `test` is absent on purpose — see the module docstring. Anything that adds it
# here removes the only images the live demo can honestly be run on.
HISTORY_SPLITS = ("train", "valid")

# Not a model version. The name is the point: anyone reading a seeded row can
# tell at a glance that no model produced it.
SEED_MODEL_VERSION = "seed-groundtruth-v1"
SEED_MODEL_SHA = "groundtruth"

# Dataset class ids that carry no shelf facing area. Kept here rather than
# imported because this module stands in for the ML service, which is the only
# side of the boundary allowed to know raw class ids at all.
_GAP_CLASS_ID = 19
_PRICE_CLASS_ID = 31
_PROMO_CLASS_ID = 18

_SEMANTIC_BY_CLASS_ID = {
    _GAP_CLASS_ID: SemanticType.GAP,
    _PRICE_CLASS_ID: SemanticType.PRICE_TAG,
    _PROMO_CLASS_ID: SemanticType.PROMO_TAG,
}

# Below this an image is a close-up of one or two facings, which produces a
# single shelf row and a position label with nothing to distinguish it.
_MIN_BOXES = 15

# Every seeded capture is a coffee shelf because every dataset image is one.
# Choosing any other category would put a number under a card the dataset
# cannot support.
_CATEGORY = "cat-coffee"
_BAYS = ("A1", "A2", "A3")


# ── the dataset, as this module reads it ─────────────────────────────────────


@dataclass(frozen=True)
class DatasetImage:
    """One labelled photograph, with the shelf metrics its labels imply."""

    split: str
    stem: str
    image_path: Path
    width: int
    height: int
    # (class_id, x, y, w, h) in absolute pixels, already converted from
    # whichever of the two label forms this file used.
    boxes: tuple[tuple[int, float, float, float, float], ...]
    gap_ratio: float
    gap_count: int


def _jpeg_size(path: Path) -> tuple[int, int]:
    """Width and height from the JPEG header.

    Hand-rolled because the backend has no imaging library and does not want
    one: it never decodes pixels, and adding Pillow so a seed script can read
    two integers would put an image codec in the dependency tree of a service
    whose entire design is that images bypass it.
    """
    with path.open("rb") as handle:
        if handle.read(2) != b"\xff\xd8":
            raise ValueError(f"{path} is not a JPEG")
        while True:
            marker = handle.read(2)
            if len(marker) < 2 or marker[0] != 0xFF:
                raise ValueError(f"{path}: malformed JPEG segment")
            code = marker[1]
            (length,) = struct.unpack(">H", handle.read(2))
            # SOF0-SOF15, minus the three that are not frame headers.
            if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
                body = handle.read(5)
                height, width = struct.unpack(">HH", body[1:5])
                return width, height
            handle.seek(length - 2, 1)


def _read_label_file(
    path: Path, width: int, height: int
) -> list[tuple[int, float, float, float, float]]:
    """Absolute-pixel boxes from one label file.

    This export mixes two forms in the same directory: 42,852 lines are YOLO
    detection boxes (`class cx cy w h`) and 9,666 are polygons of four or more
    points. Reading every line as the first form would silently treat a
    polygon's second vertex as a width, so the arity is checked per line
    rather than per file.
    """
    boxes: list[tuple[int, float, float, float, float]] = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if not parts:
            continue
        class_id = int(parts[0])
        values = [float(v) for v in parts[1:]]
        if len(values) == 4:
            cx, cy, bw, bh = values
        elif len(values) >= 6 and len(values) % 2 == 0:
            xs, ys = values[0::2], values[1::2]
            bw, bh = max(xs) - min(xs), max(ys) - min(ys)
            cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        else:
            continue

        x = max((cx - bw / 2) * width, 0.0)
        y = max((cy - bh / 2) * height, 0.0)
        pixel_w, pixel_h = bw * width, bh * height
        # The contract requires w and h strictly positive; a label rounded to
        # zero on one axis is a degenerate annotation, not a detection.
        if pixel_w <= 0 or pixel_h <= 0:
            continue
        boxes.append((class_id, x, y, pixel_w, pixel_h))
    return boxes


@lru_cache(maxsize=1)
def _catalogue() -> tuple[DatasetImage, ...]:
    """Every usable labelled image in the splits this seed may draw from."""
    images: list[DatasetImage] = []
    for split in HISTORY_SPLITS:
        label_dir = DATA_ROOT / split / "labels"
        image_dir = DATA_ROOT / split / "images"
        if not label_dir.is_dir():
            continue
        for label_path in sorted(label_dir.glob("*.txt")):
            image_path = image_dir / f"{label_path.stem}.jpg"
            if not image_path.exists():
                continue
            width, height = _jpeg_size(image_path)
            boxes = _read_label_file(label_path, width, height)
            if len(boxes) < _MIN_BOXES:
                continue

            gap_area = sum(w * h for c, _, _, w, h in boxes if c == _GAP_CLASS_ID)
            product_area = sum(
                w * h
                for c, _, _, w, h in boxes
                if c not in (_GAP_CLASS_ID, _PRICE_CLASS_ID, _PROMO_CLASS_ID)
            )
            if gap_area + product_area <= 0:
                continue

            images.append(
                DatasetImage(
                    split=split,
                    stem=label_path.stem,
                    image_path=image_path,
                    width=width,
                    height=height,
                    boxes=tuple(boxes),
                    gap_ratio=gap_area / (gap_area + product_area),
                    gap_count=sum(1 for c, *_ in boxes if c == _GAP_CLASS_ID),
                )
            )
    return tuple(images)


def _pick(
    used: set[str], target_osa: float, min_gaps: int, max_gaps: int | None = None
) -> DatasetImage:
    """The unused image whose real OSA sits closest to `target_osa`.

    Selecting by measured shelf state rather than by filename is what keeps
    the seeded numbers honest: the plan below asks for a store that is doing
    badly, and the dataset decides which photograph that actually is.

    `max_gaps` exists for after-photos. OSA is an area share, so a shelf can
    improve on area while showing more separate holes — and a before/after
    pair where the "after" has six gaps against the before's one reads as a
    restock that went backwards, whatever the score says.
    """
    pool = [
        i
        for i in _catalogue()
        if i.stem not in used
        and i.gap_count >= min_gaps
        and (max_gaps is None or i.gap_count <= max_gaps)
    ]
    if not pool:
        raise RuntimeError("dataset exhausted while selecting seed images")
    chosen = min(pool, key=lambda i: abs((1.0 - i.gap_ratio) - target_osa))
    used.add(chosen.stem)
    return chosen


# ── standing in for the ML service ───────────────────────────────────────────

ARTIFACT_DIR = DATA_ROOT.parent / "artifacts" / "shelf-product-yolo26l-960"

# Fallbacks for a machine that has the dataset but not a trained artifact.
# Chosen to sit above the confidence floor and below the trust threshold's
# neighbourhood, so nothing is silently filtered and nothing is asserted more
# strongly than the real model would assert it.
_DEFAULT_PRECISION = 0.80
_DEFAULT_GAP_RECALL = 0.75


@lru_cache(maxsize=1)
def _class_table() -> dict[int, tuple[str, SemanticType]]:
    """class_id -> (raw name, semantic type), read from the model's own map.

    Reading `class_map.yaml` here does not breach the boundary rule: this
    module IS the ML service for the duration of the seed, and the class map
    is exactly what the real service uses to turn class ids into the semantic
    types the backend consumes. Nothing downstream of `infer` sees the names.
    """
    class_map = ARTIFACT_DIR / "class_map.yaml"
    if class_map.exists():
        raw = yaml.safe_load(class_map.read_text())
        return {
            int(cid): (body["name"], SemanticType(body["semantic_type"]))
            for cid, body in raw["classes"].items()
        }

    # No artifact on this machine. The dataset still names its own classes.
    data_yaml = DATA_ROOT / "data.yaml"
    names = yaml.safe_load(data_yaml.read_text())["names"]
    return {
        i: (name, _SEMANTIC_BY_CLASS_ID.get(i, SemanticType.PRODUCT))
        for i, name in enumerate(names)
    }


@lru_cache(maxsize=1)
def _confidence_profile() -> tuple[dict[str, float], float]:
    """Per-class precision, and the trained model's recall on gaps.

    Confidence has to come from somewhere, and inventing a flat 0.9 for every
    box would make the seeded history look more certain than the system has
    ever been. Centring each class's confidence on its own measured precision
    ties the number to something that was actually observed.
    """
    metrics_file = ARTIFACT_DIR / "metrics.json"
    if not metrics_file.exists():
        return {}, _DEFAULT_GAP_RECALL
    metrics = json.loads(metrics_file.read_text())
    per_class = {
        name: float(body.get("precision", _DEFAULT_PRECISION))
        for name, body in metrics.get("per_class", {}).items()
    }
    gap_recall = float(metrics.get("gap_class", {}).get("recall", _DEFAULT_GAP_RECALL))
    return per_class, gap_recall


class GroundTruthMLClient:
    """An `MLClient` that answers from the dataset's labels.

    Registered image by image: `run_analysis` asks for an `s3://` URI, and the
    only thing that can map that back to a label file is the code that put the
    object there in the first place.
    """

    def __init__(self) -> None:
        self._by_uri: dict[str, DatasetImage] = {}

    def register(self, object_key: str, image: DatasetImage) -> None:
        self._by_uri[get_storage().to_uri(object_key)] = image

    def infer(
        self, image_uri: str, request_id: UUID, model_version: str | None = None
    ) -> InferResponse:
        image = self._by_uri[image_uri]
        classes = _class_table()
        precision_by_name, gap_recall = _confidence_profile()

        # Seeded from the filename so re-running the seed on a rebuilt database
        # reproduces the same confidences, and therefore the same OSA history.
        rng = random.Random(image.stem)
        detections: list[Detection] = []

        for class_id, x, y, w, h in image.boxes:
            name, semantic_type = classes.get(class_id, (f"class-{class_id}", SemanticType.PRODUCT))
            detections.append(
                Detection(
                    detection_id=uuid.UUID(int=rng.getrandbits(128), version=4),
                    class_id=class_id,
                    class_name=name,
                    semantic_type=semantic_type,
                    bbox=BBox(x=x, y=y, w=w, h=h),
                    confidence=_confidence(rng, name, semantic_type, precision_by_name, gap_recall),
                )
            )

        return InferResponse(
            request_id=request_id,
            model_version=model_version or SEED_MODEL_VERSION,
            model_sha=SEED_MODEL_SHA,
            inference_ms=rng.randint(240, 610),
            image_width=image.width,
            image_height=image.height,
            detections=detections,
        )


def _confidence(
    rng: random.Random,
    class_name: str,
    semantic_type: SemanticType,
    precision_by_name: dict[str, float],
    gap_recall: float,
) -> float:
    """A plausible confidence for one detection.

    Gaps get a deliberate low-confidence tail sized by the trained model's
    measured recall: it finds roughly three gaps in four, so about a quarter of
    them land in the band the UI shows as "ต้องตรวจสอบ" instead of asserting.
    A seeded history with no uncertain findings would leave that whole review
    path undemonstrated.

    Nothing is ever drawn below the confidence floor. A filtered-out box would
    change the OSA away from the shelf's real state, which is the one number
    this module exists to keep true.
    """
    floor = settings.min_confidence + 0.05
    if semantic_type is SemanticType.GAP and rng.random() > gap_recall:
        return round(rng.uniform(floor, settings.low_confidence_threshold - 0.01), 3)

    centre = precision_by_name.get(class_name, _DEFAULT_PRECISION)
    return round(min(max(rng.uniform(centre - 0.12, centre + 0.10), floor), 0.98), 3)


# ── the plan ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PlannedVisit:
    """One visit to seed, described by what it should demonstrate."""

    store_slug: str
    days_ago: int
    target_osa: float
    min_gaps: int
    # "clean"  — nothing found, nothing to do
    # "fixed"  — the rep confirmed every gap and restocked it
    # "mixed"  — one gap overruled, one blocked, the rest restocked
    # "stalled" — work confirmed and then left undone
    resolution: str
    after_osa: float | None = None
    gps_off: bool = False


# Dates are spread so the three windows the dashboards use all have data: the
# 28-day KPI window, the 28-day window before it that every KPI is compared
# against, and the 84-day OSA trend. A store whose most recent visit is inside
# 28 days cannot score HIGH risk however bad its shelf is — staleness carries
# 0.30 of the score — so the two stores meant to rank worst are also the two
# nobody has been back to, which is the situation the ranking exists to catch.
#
# ⚠️ No store's MOST RECENT visit carries an after-photo. A store's headline
# OSA is its latest analysis, and an after-photo is by definition later and
# better than the before-photo beside it — so putting one on a store's last
# visit publishes the restocked score as that store's standing state and drops
# it down the risk ranking. Adding `after_osa` to a final visit here is what
# turns the worst store in the area into a middling one.
PLAN: tuple[PlannedVisit, ...] = (
    # Healthy. Its first visit found nothing at all, which is a real outcome
    # for half the images in this dataset and a screen state worth showing.
    PlannedVisit("st-101", 70, 1.00, 0, "clean"),
    PlannedVisit("st-101", 40, 0.97, 1, "fixed"),
    PlannedVisit("st-101", 12, 0.98, 1, "fixed"),
    # Dipped once, recovered. The dip is the visit with an after-photo.
    PlannedVisit("st-102", 66, 0.95, 1, "fixed"),
    PlannedVisit("st-102", 35, 0.91, 3, "mixed", after_osa=0.98),
    PlannedVisit("st-102", 6, 0.96, 1, "fixed", gps_off=True),
    # Photo-restricted, so it is visited rarely and sits at a persistent low.
    PlannedVisit("st-103", 75, 0.85, 4, "mixed"),
    PlannedVisit("st-103", 48, 0.86, 4, "mixed", after_osa=0.92),
    PlannedVisit("st-103", 24, 0.82, 4, "fixed"),
    # The worst store: declining, stale, and full of work nobody finished.
    # Its `min_gaps` are high on every visit, not just the last one, because
    # the repeat-offender term only counts a SKU confirmed missing across two
    # separate visits — a store whose earlier visits found one gap each cannot
    # demonstrate that term however bad its latest photograph is.
    PlannedVisit("st-104", 80, 0.86, 6, "mixed"),
    PlannedVisit("st-104", 55, 0.74, 7, "mixed", after_osa=0.93),
    PlannedVisit("st-104", 32, 0.62, 8, "stalled", gps_off=True),
    # Recovering — the story a manager wants the ranking to reward.
    PlannedVisit("st-105", 58, 0.80, 3, "mixed", after_osa=0.96),
    PlannedVisit("st-105", 26, 0.88, 2, "fixed"),
    PlannedVisit("st-105", 4, 0.95, 2, "fixed"),
)

# Cycled rather than fixed so the relabel queue shows more than one failure
# mode — the queue exists to tell the data team WHICH kind of mistake to fix.
_REJECT_CYCLE = (RejectReason.OCCLUDED, RejectReason.NORMAL_EMPTY, RejectReason.NOT_OUR_SKU)
_BLOCKED_CYCLE = (BlockedReason.OUT_OF_BACKSTOCK, BlockedReason.STORE_REFUSED)


@dataclass(frozen=True)
class Outcome:
    verdict: str
    reject_reason: str | None
    task_status: str | None
    blocked_reason: str | None


def _outcomes(resolution: str, count: int, salt: int) -> list[Outcome]:
    """How each finding on one capture was dealt with.

    Index-driven rather than random: the same plan must produce the same
    history every time it is seeded, or two people rehearsing the same demo
    see different numbers.
    """
    confirmed_fixed = Outcome(VerificationStatus.CONFIRMED, None, TaskStatus.FIXED, None)
    results: list[Outcome] = []

    for index in range(count):
        if resolution == "fixed":
            results.append(confirmed_fixed)
            continue

        if resolution == "mixed":
            # A single finding has no room for a mix; overruling it would
            # leave the visit with no work at all, which is a different story.
            if count >= 3 and index == 0:
                results.append(
                    Outcome(
                        VerificationStatus.REJECTED,
                        _REJECT_CYCLE[(salt + index) % len(_REJECT_CYCLE)],
                        None,
                        None,
                    )
                )
            elif count >= 2 and index == count - 1:
                results.append(
                    Outcome(
                        VerificationStatus.CONFIRMED,
                        None,
                        TaskStatus.BLOCKED,
                        BlockedReason.OUT_OF_BACKSTOCK,
                    )
                )
            else:
                results.append(confirmed_fixed)
            continue

        # "stalled": confirmed work that was never finished.
        if count > 1 and index == 0:
            results.append(
                Outcome(VerificationStatus.REJECTED, RejectReason.NORMAL_EMPTY, None, None)
            )
        elif index <= count // 3:
            results.append(confirmed_fixed)
        elif index <= count // 2 + 1:
            results.append(
                Outcome(
                    VerificationStatus.CONFIRMED,
                    None,
                    TaskStatus.BLOCKED,
                    _BLOCKED_CYCLE[(salt + index) % len(_BLOCKED_CYCLE)],
                )
            )
        else:
            results.append(Outcome(VerificationStatus.CONFIRMED, None, TaskStatus.OPEN, None))

    return results


# ── writing it ───────────────────────────────────────────────────────────────


def _upload(object_key: str, image: DatasetImage) -> None:
    """PUT the photograph the same way a phone would.

    Through a presigned URL rather than the storage client's own connection,
    so the seed exercises the path the app actually uses — a bucket policy that
    would reject a real upload fails here too, at seed time, rather than in
    front of an audience.
    """
    url = get_storage().presign_put(object_key, "image/jpeg")
    request = urllib.request.Request(url, data=image.image_path.read_bytes(), method="PUT")
    request.add_header("Content-Type", "image/jpeg")
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status not in (200, 204):
            raise RuntimeError(f"upload of {object_key} returned HTTP {response.status}")


def _make_capture(
    session: Session,
    visit: Visit,
    image: DatasetImage,
    *,
    phase: str,
    at: datetime,
    bay: str,
) -> Capture:
    capture = Capture(
        visit_id=visit.id,
        category=_CATEGORY,
        shelf_bay_label=bay,
        phase=phase,
        image_width=image.width,
        image_height=image.height,
        captured_at=at,
        created_at=at,
        client_idempotency_key=f"seed-{visit.id}-{phase.lower()}",
        # Which dataset image this capture is, recorded where a real device
        # would record its model and OS. Without it there is no way to trace a
        # seeded number back to the photograph it came from.
        device_info={
            "source": "seed",
            "dataset": "roboflow-ngkro/shelf-product",
            "split": image.split,
            "file": image.image_path.name,
        },
        # Face blur is not implemented. Recording it as applied would be the
        # precise claim the UAT preparation is removing from this system.
        face_blur_applied=None,
        face_blur_count=None,
    )
    session.add(capture)
    session.flush()

    # `StorageClient.build_object_key` date-partitions by today. These objects
    # belong under the day they were taken, or the bucket layout contradicts
    # every timestamp in the database.
    capture.object_key = f"{at:%Y/%m/%d}/cap_{capture.id}_{bay.lower()}.jpg"
    session.flush()
    return capture


def _analyse(
    session: Session,
    client: GroundTruthMLClient,
    capture: Capture,
    image: DatasetImage,
    at: datetime,
) -> None:
    """Upload, infer and persist, then move the whole run back in time."""
    assert capture.object_key is not None
    _upload(capture.object_key, image)
    client.register(capture.object_key, image)

    job = InferenceJob(capture_id=capture.id, status=JobStatus.QUEUED, queued_at=at)
    session.add(job)
    session.flush()

    run_analysis(session, job.id, client)
    if job.status != JobStatus.DONE:
        raise RuntimeError(f"seed analysis failed for {image.stem}: {job.error_code}")

    finished = at + timedelta(seconds=10, milliseconds=job.inference_ms or 0)
    job.queued_at, job.started_at, job.finished_at = at, at + timedelta(seconds=10), finished
    for model, column in (
        (DetectionRow, "created_at"),
        (ShelfAnalysisRow, "computed_at"),
        (GapFindingRow, "created_at"),
    ):
        session.execute(
            update(model).where(model.capture_id == capture.id).values(**{column: finished})
        )
    capture.captured_at = at
    capture.created_at = at
    session.commit()


def _resolve_findings(
    session: Session,
    visit: Visit,
    capture: Capture,
    rep: User,
    resolution: str,
    salt: int,
) -> None:
    """Walk the rep through verifying each gap, exactly as the API would.

    The endpoint's own rules are mirrored rather than called: a REJECTED
    finding leaves no task behind, a CONFIRMED one creates exactly one, and
    OUT_OF_BACKSTOCK raises the replenishment request the rep would otherwise
    have to file separately.
    """
    findings = (
        session.execute(
            select(GapFindingRow)
            .where(GapFindingRow.capture_id == capture.id)
            .order_by(GapFindingRow.shelf_row_index, GapFindingRow.position_label)
        )
        .scalars()
        .all()
    )
    if not findings:
        return

    base = visit.checked_in_at
    for index, (finding, outcome) in enumerate(
        zip(findings, _outcomes(resolution, len(findings), salt), strict=True)
    ):
        verified_at = base + timedelta(minutes=6, seconds=index * 60)
        finding.verification_status = outcome.verdict
        finding.rejected_reason = outcome.reject_reason
        finding.verified_by = rep.id
        finding.verified_at = verified_at

        session.add(
            AuditLog(
                actor_id=rep.id,
                actor_role=rep.role,
                action=f"FINDING_{outcome.verdict}",
                entity_type="gap_finding",
                entity_id=str(finding.id),
                before={"verification_status": VerificationStatus.PENDING.value},
                after={
                    "verification_status": outcome.verdict,
                    "rejected_reason": outcome.reject_reason,
                },
                created_at=verified_at,
            )
        )

        if outcome.task_status is None:
            continue

        completed_at = (
            verified_at + timedelta(minutes=3 + (index * 2) % 7)
            if outcome.task_status != TaskStatus.OPEN
            else None
        )
        task = TaskRow(
            visit_id=visit.id,
            gap_finding_id=finding.id,
            sku_code=finding.sku_code,
            priority=finding.priority,
            status=outcome.task_status,
            blocked_reason=outcome.blocked_reason,
            created_at=verified_at,
            completed_at=completed_at,
        )
        session.add(task)
        session.flush()

        if outcome.blocked_reason == BlockedReason.OUT_OF_BACKSTOCK:
            session.add(
                ReplenishmentRequest(
                    store_id=visit.store_id,
                    sku_code=finding.sku_code,
                    source_task_id=task.id,
                    created_at=completed_at or verified_at,
                )
            )
    session.flush()


def _seed_model_version(session: Session) -> None:
    """Record the label-derived history as its own, never-active 'version'.

    The model-health screen lists every version that produced stored rows. If
    this one were missing, a reader would find thousands of detections
    attributed to nothing; if it were marked active, the system would be
    claiming a model that scores 1.00 on everything is serving traffic.
    """
    if session.execute(
        select(ModelVersion).where(ModelVersion.version == SEED_MODEL_VERSION)
    ).scalar_one_or_none():
        return
    session.add(
        ModelVersion(
            version=SEED_MODEL_VERSION,
            sha=SEED_MODEL_SHA,
            source_dataset="roboflow-ngkro/shelf-product",
            dataset_version="1",
            # No metrics: these detections are the labels themselves, so every
            # score would be 1.0 by construction. Publishing that beside a real
            # model's numbers would invite exactly the wrong comparison.
            metrics=None,
            is_active=False,
            promoted_at=None,
            promoted_by=None,
        )
    )


def seed_history(session: Session) -> dict[str, int]:
    """Seed the visit history described by `PLAN`. Idempotent by refusal."""
    if settings.environment not in DISPOSABLE_ENVIRONMENTS:
        raise SystemExit(
            f"refusing to seed demo history into ENVIRONMENT={settings.environment}. "
            "These are fifteen invented visits attributed to a demo rep; mixed into "
            "a real database they corrupt every OSA trend and KPI computed from it."
        )

    if not (DATA_ROOT / "train" / "labels").is_dir():
        raise RuntimeError(
            f"dataset not found at {DATA_ROOT} — run `make dataset` before seeding history"
        )

    if session.execute(select(func.count()).select_from(Visit)).scalar():
        return {"skipped": 1}

    rep = session.execute(
        select(User).where(User.email == "rep@shelfeye.demo")
    ).scalar_one_or_none()
    if rep is None:
        raise RuntimeError("run the base seed first — no rep account to attribute visits to")

    try:
        get_storage().ensure_bucket()
    except Exception as exc:  # noqa: BLE001 — the cause is printed, not swallowed
        raise RuntimeError(
            f"object storage unreachable ({exc}) — run `make infra` before seeding history"
        ) from None

    _seed_model_version(session)
    session.commit()

    client = GroundTruthMLClient()
    used: set[str] = set()
    counts = {"visits": 0, "captures": 0, "findings": 0, "tasks": 0}

    for index, planned in enumerate(PLAN):
        store = session.get(Store, store_uuid(planned.store_slug))
        if store is None:
            raise RuntimeError(f"store {planned.store_slug} is missing — run the base seed first")

        # Business hours in Bangkok, staggered so the visits do not all land in
        # the same hour of the same weekday.
        base = (datetime.now(UTC) - timedelta(days=planned.days_ago)).replace(
            hour=2 + index % 5, minute=15, second=0, microsecond=0
        )

        # A rep standing across the street is flagged, never blocked. Seeding
        # only clean check-ins would leave that distinction undemonstrated.
        offset = 0.0125 if planned.gps_off else 0.0004
        gps_lat, gps_lng = store.lat + offset, store.lng + offset
        distance_m = haversine_km(gps_lat, gps_lng, store.lat, store.lng) * 1000

        visit = Visit(
            store_id=store.id,
            user_id=rep.id,
            checked_in_at=base,
            gps_lat=gps_lat,
            gps_lng=gps_lng,
            gps_match=distance_m <= settings.gps_match_radius_meters,
            photo_consent_confirmed=True,
            status=VisitStatus.OPEN,
        )
        session.add(visit)
        session.flush()

        before_image = _pick(used, planned.target_osa, planned.min_gaps)
        before = _make_capture(
            session,
            visit,
            before_image,
            phase="BEFORE",
            at=base + timedelta(minutes=3),
            bay=_BAYS[index % len(_BAYS)],
        )
        _analyse(session, client, before, before_image, base + timedelta(minutes=3))
        _resolve_findings(session, visit, before, rep, planned.resolution, salt=index)
        counts["captures"] += 1

        if planned.after_osa is not None:
            after_image = _pick(used, planned.after_osa, 0, max_gaps=before_image.gap_count)
            after = _make_capture(
                session,
                visit,
                after_image,
                phase="AFTER",
                at=base + timedelta(minutes=30),
                bay=_BAYS[index % len(_BAYS)],
            )
            _analyse(session, client, after, after_image, base + timedelta(minutes=30))
            counts["captures"] += 1

        osa_after = session.execute(
            select(func.avg(ShelfAnalysisRow.osa_score))
            .join(Capture, Capture.id == ShelfAnalysisRow.capture_id)
            .where(Capture.visit_id == visit.id, Capture.phase == "AFTER")
        ).scalar()
        if osa_after is not None:
            visit.osa_after = round(float(osa_after), 4)
        visit.checked_out_at = base + timedelta(minutes=38)
        visit.status = VisitStatus.CLOSED
        counts["visits"] += 1
        session.commit()

    counts["findings"] = session.execute(select(func.count()).select_from(GapFindingRow)).scalar()
    counts["tasks"] = session.execute(select(func.count()).select_from(TaskRow)).scalar()
    return counts


def main() -> None:
    # Same gate as seed.py. This module hangs its visits off the accounts that
    # one creates, so letting it run where those accounts must not exist would
    # either fail confusingly or attach fabricated history to real users.
    if settings.environment not in DISPOSABLE_ENVIRONMENTS:
        raise SystemExit(
            f"refusing to seed demo history into ENVIRONMENT={settings.environment}. "
            "These visits are manufactured from dataset photographs and would sit "
            "in the same tables as real ones."
        )

    with SyncSessionFactory() as session:
        counts = seed_history(session)
        if counts.get("skipped"):
            print("history already present — drop the schema first (`make reset-db`)")
            return

        print(
            f"seeded history: {counts['visits']} visits, {counts['captures']} captures, "
            f"{counts['findings']} findings, {counts['tasks']} tasks"
        )
        print(f"detections stamped: {SEED_MODEL_VERSION} (labels, not model output)")

        # Printed because the numbers a demo is rehearsed on should be checked
        # before the demo, not discovered during it.
        async def show() -> None:
            async with SessionFactory() as adb:
                stores = (await adb.execute(select(Store).order_by(Store.external_code))).scalars()
                stores = list(stores)
                risks = await store_risk.load(adb, [s.id for s in stores])
                print(f"\n{'store':<34}{'lastOSA':>9}{'days':>6}{'repeat':>8}{'risk':>8}  band")
                for store in sorted(
                    stores,
                    key=lambda s: -risks.get(s.id, store_risk.NEVER_MEASURED).score,
                ):
                    risk = risks.get(store.id, store_risk.NEVER_MEASURED)
                    osa = f"{risk.last_osa:.4f}" if risk.last_osa is not None else "—"
                    print(
                        f"{store.name[:33]:<34}{osa:>9}{risk.days_since_last_visit or 0:>6}"
                        f"{risk.repeat_gap_skus:>8}{risk.score:>8.3f}  {risk.band}"
                    )

        asyncio.run(show())


if __name__ == "__main__":
    main()
