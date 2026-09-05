"""Re-split the dataset by GROUP, not by image.

Why this exists
---------------
The Roboflow split is 85/10/5 and was drawn at the image level. Two things go
wrong with that:

1.  The test split holds only 124 `Empty Shelf` instances. The Wilson 95%
    interval on a recall of 0.74 measured over 124 instances is +-0.077, so a
    run that moves recall from 0.74 to 0.81 is indistinguishable from noise.
    You cannot tune against a ruler that wobbles more than the effect you are
    chasing.

2.  A rep photographs the same fixture two to four times in one visit. Those
    frames are near-duplicates. Split them at the image level and one lands in
    train while its twin lands in test, which quietly inflates every number.
    Measured on the current split: 55 of 782 stores straddle a split boundary.

So groups -- not images -- are the unit that gets dealt out, and the deal is
stratified on how many gaps each group contains so that every split carries a
representative share of the class we actually care about.

Output is a set of image-list .txt files plus a data.yaml per split. No image
is copied or symlinked: Ultralytics reads a .txt of image paths directly, and
derives each label path by swapping `images` for `labels`.

    python -m shelfeye_ml.training.resplit --mode holdout --ratios 70 15 15
    python -m shelfeye_ml.training.resplit --mode kfold --folds 5

Paths written into the .txt files are ABSOLUTE. Re-run this on whatever
machine trains the model; it takes under a second and needs no GPU.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
SPLITS_DIR = DATA_DIR / "splits"
SOURCE_SPLITS = ("train", "valid", "test")

GAP_CLASS_ID = 19

# Roboflow appends `_jpg.rf.<md5>.jpg` to every exported filename.
_RF_SUFFIX = re.compile(r"_jpg\.rf\.[0-9a-f]+\.(jpg|jpeg|png)$", re.IGNORECASE)


@dataclass(slots=True)
class Group:
    """One shooting session: every frame of one fixture in one store visit."""

    key: str
    images: list[Path] = field(default_factory=list)
    gaps: int = 0
    boxes: int = 0

    @property
    def gaps_per_image(self) -> float:
        return self.gaps / max(len(self.images), 1)


def group_key(image_path: Path) -> str:
    """Frames that share a key must never be dealt into different splits.

    The dataset carries two filename shapes:

        20052618_Depotbesuch_REWE-Hamburg-Kieler-Strasse-101_Raja-Kumar_...jpg
        P8250185_JPG.rf.<hash>.jpg

    The first is a depot visit and its third field is the store, which is the
    strongest correlation signal available -- the same fixture, the same
    lighting, the same planogram. The second shape carries no visit metadata,
    so each such file is its own group. That is the conservative choice: it
    can only over-separate, never leak.
    """
    stem = _RF_SUFFIX.sub("", image_path.name)
    parts = stem.split("_")
    if len(parts) >= 6:
        return f"store::{parts[2]}"
    return f"solo::{stem}"


def _count_boxes(label_path: Path) -> tuple[int, int]:
    """Return (total boxes, gap boxes). Polygon rows count as one box each."""
    if not label_path.exists():
        return 0, 0
    total = gaps = 0
    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        total += 1
        if int(float(parts[0])) == GAP_CLASS_ID:
            gaps += 1
    return total, gaps


def collect_groups() -> list[Group]:
    groups: dict[str, Group] = {}
    for split in SOURCE_SPLITS:
        image_dir = DATA_DIR / split / "images"
        if not image_dir.is_dir():
            continue
        for image in sorted(image_dir.iterdir()):
            if image.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            label = DATA_DIR / split / "labels" / f"{image.stem}.txt"
            boxes, gaps = _count_boxes(label)
            group = groups.setdefault(group_key(image), Group(key=group_key(image)))
            group.images.append(image)
            group.boxes += boxes
            group.gaps += gaps
    return sorted(groups.values(), key=lambda g: g.key)


def _stratum(group: Group) -> int:
    """Bin a group by gap density so every split gets its share of hard images."""
    return min(round(group.gaps_per_image), 6)


def deal(groups: list[Group], weights: list[float], seed: int) -> list[list[Group]]:
    """Deal groups into len(weights) buckets, balancing GAP INSTANCES.

    Balancing on image count alone would be the obvious move and the wrong
    one: the quantity whose confidence interval we are trying to shrink is the
    number of `Empty Shelf` instances in the eval split. So the deficit that
    drives each placement sums both -- gaps decide where the gap-dense groups
    go, image count decides where the ~570 gap-free groups go, and neither
    lands wherever the shuffle happens to drop it. Within each stratum the
    most gap-dense groups are dealt first, since those are the ones that can
    throw the balance off if placed late.
    """
    rng = random.Random(seed)
    total = sum(weights)
    share = [w / total for w in weights]
    buckets: list[list[Group]] = [[] for _ in weights]
    gaps_in = [0.0] * len(weights)
    images_in = [0.0] * len(weights)

    by_stratum: dict[int, list[Group]] = defaultdict(list)
    for group in groups:
        by_stratum[_stratum(group)].append(group)

    for stratum in sorted(by_stratum, reverse=True):
        members = by_stratum[stratum]
        rng.shuffle(members)
        members.sort(key=lambda g: g.gaps, reverse=True)
        for group in members:
            gap_total = sum(gaps_in) + group.gaps
            img_total = sum(images_in) + len(group.images)
            # Deficit against the target share; gaps dominate, images break
            # ties for groups that contain no gap at all.
            deficits = [
                (share[i] * gap_total - gaps_in[i]) + (share[i] * img_total - images_in[i])
                for i in range(len(weights))
            ]
            target = max(range(len(weights)), key=deficits.__getitem__)
            buckets[target].append(group)
            gaps_in[target] += group.gaps
            images_in[target] += len(group.images)

    return buckets


def _wilson_half_width(p: float, n: int, z: float = 1.96) -> float:
    if n == 0:
        return float("nan")
    denom = 1 + z * z / n
    return z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom


def summarise(groups: list[Group]) -> dict:
    images = sum(len(g.images) for g in groups)
    gaps = sum(g.gaps for g in groups)
    boxes = sum(g.boxes for g in groups)
    return {
        "groups": len(groups),
        "images": images,
        "boxes": boxes,
        "gap_instances": gaps,
        # What this split can actually resolve, assuming the model lands on the
        # 0.90 recall gate. If the half-width is wider than the improvement you
        # are chasing, the split is too small to tell you anything.
        "recall_ci_half_width_at_0.90": round(_wilson_half_width(0.90, gaps), 4),
    }


def _write_split(path: Path, groups: list[Group]) -> None:
    lines = sorted(str(image.resolve()) for group in groups for image in group.images)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_data_yaml(path: Path, names: list[str], train: Path, val: Path, test: Path | None) -> None:
    payload = {
        "train": str(train.resolve()),
        "val": str(val.resolve()),
        "nc": len(names),
        "names": names,
    }
    if test is not None:
        payload["test"] = str(test.resolve())
    path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def build_holdout(groups: list[Group], ratios: tuple[float, float, float], seed: int, names: list[str]) -> dict:
    train, val, test = deal(groups, list(ratios), seed)
    out = SPLITS_DIR / "holdout"
    out.mkdir(parents=True, exist_ok=True)

    _write_split(out / "train.txt", train)
    _write_split(out / "val.txt", val)
    _write_split(out / "test.txt", test)
    _write_data_yaml(out / "data.yaml", names, out / "train.txt", out / "val.txt", out / "test.txt")

    return {
        "mode": "holdout",
        "ratios": list(ratios),
        "seed": seed,
        "splits": {"train": summarise(train), "val": summarise(val), "test": summarise(test)},
    }


def build_kfold(groups: list[Group], folds: int, test_ratio: float, seed: int, names: list[str]) -> dict:
    """Carve off one untouched test split, then k-fold the remainder.

    The test split is dealt FIRST and never enters a fold. Cross-validation
    that recycles the test set answers a different, easier question than the
    one the promotion gate asks.
    """
    pool, test = deal(groups, [100.0 - test_ratio, test_ratio], seed)
    # Deliberately NOT `holdout/` -- writing there would leave a half-updated
    # holdout whose train.txt and test.txt came from different deals, which is
    # leakage that looks like a passing run.
    test_out = SPLITS_DIR / "kfold"
    test_out.mkdir(parents=True, exist_ok=True)
    _write_split(test_out / "test.txt", test)

    parts = deal(pool, [1.0] * folds, seed + 1)
    report = {
        "mode": "kfold",
        "folds": folds,
        "test_ratio": test_ratio,
        "seed": seed,
        "test": summarise(test),
        "fold_splits": {},
    }

    for k in range(folds):
        val_groups = parts[k]
        train_groups = [g for j, part in enumerate(parts) if j != k for g in part]
        out = SPLITS_DIR / "kfold" / f"fold{k}"
        out.mkdir(parents=True, exist_ok=True)
        _write_split(out / "train.txt", train_groups)
        _write_split(out / "val.txt", val_groups)
        _write_data_yaml(out / "data.yaml", names, out / "train.txt", out / "val.txt", test_out / "test.txt")
        report["fold_splits"][f"fold{k}"] = {
            "train": summarise(train_groups),
            "val": summarise(val_groups),
        }

    return report


def _print_report(report: dict) -> None:
    def row(label: str, s: dict) -> None:
        print(f"  {label:<10} groups {s['groups']:>5}  images {s['images']:>5}  "
              f"boxes {s['boxes']:>6}  gaps {s['gap_instances']:>5}  "
              f"recall CI +-{s['recall_ci_half_width_at_0.90']:.3f}")

    print(f"\n=== {report['mode']} (seed {report['seed']}) ===")
    if report["mode"] == "holdout":
        for name, stats in report["splits"].items():
            row(name, stats)
    else:
        row("test", report["test"])
        for fold, splits in report["fold_splits"].items():
            print(f"  -- {fold}")
            row("train", splits["train"])
            row("val", splits["val"])


def main() -> None:
    parser = argparse.ArgumentParser(description="Group-aware, gap-stratified re-split.")
    parser.add_argument("--mode", choices=["holdout", "kfold"], default="holdout")
    parser.add_argument("--ratios", type=float, nargs=3, default=(70.0, 15.0, 15.0),
                        metavar=("TRAIN", "VAL", "TEST"), help="holdout mode only")
    parser.add_argument("--folds", type=int, default=5, help="kfold mode only")
    parser.add_argument("--test-ratio", type=float, default=15.0,
                        help="kfold mode only: share held out from every fold")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    names = yaml.safe_load((DATA_DIR / "data.yaml").read_text(encoding="utf-8"))["names"]
    groups = collect_groups()
    if not groups:
        raise SystemExit(f"no images found under {DATA_DIR} -- run `make dataset` first")

    print(f"[resplit] {sum(len(g.images) for g in groups)} images in {len(groups)} groups")

    if args.mode == "holdout":
        report = build_holdout(groups, tuple(args.ratios), args.seed, names)
    else:
        report = build_kfold(groups, args.folds, args.test_ratio, args.seed, names)

    SPLITS_DIR.mkdir(parents=True, exist_ok=True)
    out = SPLITS_DIR / f"{args.mode}_report.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    _print_report(report)
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
