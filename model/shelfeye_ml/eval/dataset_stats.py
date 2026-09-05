"""Ground-truth accounting for an eval split.

Every recall number needs the denominator printed next to it. `Espresso SArt`
is reported at recall 0.0000 with mAP@50 0.9950 in the shipped metrics.json —
a combination that is arithmetically impossible until you notice the class has
exactly 2 instances in the test split. Numbers like that are not results, and
this module exists so the report can say so.
"""

from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import yaml

# Boundaries in pixels of sqrt(box area), measured at the eval imgsz. Chosen
# for THIS dataset rather than COCO's 32/96: gap boxes run p10 47px, median
# 75px, p90 389px, so COCO's buckets would put ~99% of them in one bin.
SIZE_BUCKETS: tuple[tuple[str, float, float], ...] = (
    ("small", 0.0, 64.0),
    ("medium", 64.0, 256.0),
    ("large", 256.0, float("inf")),
)


def image_to_label(image: Path) -> Path:
    """Mirror Ultralytics' img2label_paths: swap the last `images` dir for `labels`."""
    parts = list(image.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "images":
            parts[i] = "labels"
            break
    return Path(*parts).with_suffix(".txt")


def _resolve_split_entry(data_yaml: Path, root: Path, entry: Path) -> Path:
    """Find where a split entry actually points.

    Roboflow writes `test: ../test/images` into a data.yaml that sits BESIDE
    those directories, not one level above them, so resolving the entry
    literally lands a directory too high. Ultralytics quietly copes with this;
    anything reading the same yaml has to cope with it too, or it disagrees
    with the trainer about which images are in the split — which is the kind
    of disagreement that produces a confidently wrong metric.
    """
    if entry.is_absolute():
        return entry

    candidates = [
        (root / entry),
        # The Roboflow idiom: drop the leading `..` hops and re-anchor.
        (data_yaml.parent / Path(*[p for p in entry.parts if p != ".."])),
    ]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.exists():
            return resolved
    return candidates[0].resolve()


def iter_split_images(data_yaml: Path, split: str) -> list[Path]:
    """Resolve a split entry to image paths, whether it is a directory or a .txt list."""
    cfg = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    key = "val" if split == "valid" else split
    if key not in cfg:
        raise SystemExit(f"{data_yaml} has no `{key}:` entry")

    root = Path(cfg.get("path", data_yaml.parent))
    if not root.is_absolute():
        root = (data_yaml.parent / root).resolve()

    entry = _resolve_split_entry(data_yaml, root, Path(cfg[key]))

    if entry.is_dir():
        return sorted(p for p in entry.iterdir()
                      if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if entry.is_file():
        return [Path(line) if Path(line).is_absolute() else (entry.parent / line).resolve()
                for line in entry.read_text(encoding="utf-8").split()]
    raise SystemExit(f"split `{key}` points at {entry}, which does not exist")


def read_boxes(label: Path) -> list[tuple[int, float, float, float, float]]:
    """Read one label file as (class, cx, cy, w, h), normalised.

    Roughly 18% of the rows in this dataset are polygons, not boxes — Roboflow
    lets an annotator trace a tilted quad and the exporter keeps it verbatim.
    Ultralytics silently takes the axis-aligned hull of those, which for a quad
    tilted 20 degrees is 25-40% larger than the object. Same conversion here,
    so the accounting matches what the model was scored against.
    """
    if not label.exists():
        return []
    out = []
    for line in label.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        cls = int(float(parts[0]))
        coords = [float(x) for x in parts[1:]]
        if len(coords) == 4:
            cx, cy, w, h = coords
        else:
            xs, ys = coords[0::2], coords[1::2]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            w, h = max(xs) - min(xs), max(ys) - min(ys)
        out.append((cls, cx, cy, w, h))
    return out


def size_bucket(w: float, h: float, imgsz: int) -> str:
    side = math.sqrt(max(w * h, 0.0)) * imgsz
    for name, lo, hi in SIZE_BUCKETS:
        if lo <= side < hi:
            return name
    return SIZE_BUCKETS[-1][0]


def count_instances(data_yaml: Path, split: str) -> Counter:
    """GT instances per class id in the split."""
    counts: Counter = Counter()
    for image in iter_split_images(data_yaml, split):
        for cls, *_ in read_boxes(image_to_label(image)):
            counts[cls] += 1
    return counts


def wilson_interval(p: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% CI for a proportion. Normal approximation lies at these sample sizes."""
    if n <= 0:
        return (float("nan"), float("nan"))
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))
