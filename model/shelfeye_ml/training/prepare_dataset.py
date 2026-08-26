"""Prepare and sanitize the Roboflow dataset for YOLO training.

Ensures:
1. Dataset archive is extracted.
2. Mixed polygon segmentation annotations from Roboflow are converted to valid
   bounding boxes (cls cx cy w h) so Ultralytics does not discard images.
3. Obsolete .cache files are cleaned up.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"


def sanitize_label_file(label_path: Path) -> bool:
    """Convert any polygon annotations (>5 elements) to standard bbox (5 elements)."""
    lines = label_path.read_text().strip().split("\n")
    new_lines: list[str] = []
    changed = False

    for line in lines:
        parts = line.strip().split()
        if not parts:
            continue
        if len(parts) == 5:
            new_lines.append(" ".join(parts))
        elif len(parts) > 5:
            changed = True
            cls_id = parts[0]
            coords = [float(x) for x in parts[1:]]
            xs = coords[0::2]
            ys = coords[1::2]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            cx = (min_x + max_x) / 2.0
            cy = (min_y + max_y) / 2.0
            w = max_x - min_x
            h = max_y - min_y
            new_lines.append(f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

    if changed:
        label_path.write_text("\n".join(new_lines) + "\n")
    return changed


def prepare_dataset() -> None:
    """Extract zip archives and sanitize all split labels."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Check for zip archives
    zip_files = list(DATA_DIR.glob("*.zip")) + list(ROOT.glob("*.zip"))
    data_yaml = DATA_DIR / "data.yaml"

    if not data_yaml.exists() and zip_files:
        archive = zip_files[0]
        print(f"[prepare_dataset] Extracting {archive.name} -> {DATA_DIR}...")
        with zipfile.ZipFile(archive, "r") as zf:
            zf.extractall(DATA_DIR)

    # Sanitize label formats across train, valid, test
    total_sanitized = 0
    for split in ["train", "valid", "test"]:
        lbl_dir = DATA_DIR / split / "labels"
        if not lbl_dir.exists():
            continue

        cache_file = DATA_DIR / split / "labels.cache"
        if cache_file.exists():
            cache_file.unlink()

        split_sanitized = 0
        for lbl_file in lbl_dir.glob("*.txt"):
            if sanitize_label_file(lbl_file):
                split_sanitized += 1
        total_sanitized += split_sanitized
        if split_sanitized > 0:
            print(f"[prepare_dataset] Sanitized {split_sanitized} label files in {split}/labels")

    if total_sanitized > 0:
        print(f"[prepare_dataset] Total label files sanitized: {total_sanitized}")


if __name__ == "__main__":
    prepare_dataset()
