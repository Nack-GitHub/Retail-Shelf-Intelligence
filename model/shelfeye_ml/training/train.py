"""Reproducible YOLO11 training for the shelf-product dataset.

Run:
    python -m shelfeye_ml.training.train --config configs/smoke.yaml
    python -m shelfeye_ml.training.train --config configs/yolo11n-960.yaml
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
DATA_YAML = ROOT / "data" / "data.yaml"
ARTIFACTS = ROOT / "artifacts"

# Augmentation tuned for the failure modes these photos actually have: reps
# shoot under wildly varying store lighting, slightly off-axis, sometimes
# moving, and the phone re-compresses everything.
AUGMENT = {
    "hsv_h": 0.015,
    "hsv_s": 0.6,      # packaging colour varies under store lighting
    "hsv_v": 0.5,      # heavy brightness jitter: dim trad-trade vs bright hyper
    "degrees": 3.0,    # reps hold the phone slightly rotated
    "translate": 0.1,
    "scale": 0.4,
    "shear": 2.0,
    "perspective": 0.0008,  # mild off-axis framing
    "fliplr": 0.5,
    # ⛔ NEVER flip vertically. A shelf has a fixed gravity orientation; an
    # upside-down shelf is not a thing the model will ever see, and training on
    # one teaches it nothing real.
    "flipud": 0.0,
    "mosaic": 1.0,
    "close_mosaic": 10,
    "erasing": 0.2,    # stands in for partial occlusion by shoppers/trolleys
}


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def _resolve_device() -> str:
    """Prefer MPS on Apple Silicon, CUDA where present, else CPU."""
    import torch

    if torch.cuda.is_available():
        return "0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def train(config_path: Path) -> Path:
    from ultralytics import YOLO

    cfg = yaml.safe_load(config_path.read_text())
    run_name = cfg["run_name"]
    device = _resolve_device()
    out_dir = ARTIFACTS / run_name
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[train] config={config_path.name} device={device} imgsz={cfg['imgsz']} epochs={cfg['epochs']}")

    started = time.monotonic()
    model = YOLO(cfg["model"])
    model.train(
        data=str(DATA_YAML),
        imgsz=cfg["imgsz"],
        epochs=cfg["epochs"],
        batch=cfg["batch"],
        patience=cfg["patience"],
        workers=cfg["workers"],
        seed=cfg["seed"],
        device=device,
        project=str(ARTIFACTS),
        name=run_name,
        exist_ok=True,
        plots=True,
        # Per-epoch validation is disabled deliberately. An early-epoch model
        # emits a flood of low-confidence boxes across 45 classes, and NMS at
        # the validation confidence floor (0.001) then costs MORE than the
        # training epoch itself — measured at 193 s/iteration with repeated
        # "NMS time limit exceeded" warnings, versus ~2 s/iteration to train.
        # Validation runs once at the end via shelfeye_ml.eval.evaluate.
        val=cfg.get("val", False),
        **AUGMENT,
    )
    elapsed = time.monotonic() - started

    weights = out_dir / "weights" / "best.pt"
    manifest = {
        "run_name": run_name,
        "config": cfg,
        "device": device,
        "augment": AUGMENT,
        "dataset": "roboflow-ngkro/shelf-product",
        "dataset_version": "1",
        "git_sha": _git_sha(),
        "trained_at": datetime.now(UTC).isoformat(),
        "elapsed_seconds": round(elapsed, 1),
        "seconds_per_epoch": round(elapsed / max(cfg["epochs"], 1), 1),
        "weights": str(weights.relative_to(ROOT)) if weights.exists() else None,
    }
    (out_dir / "run_manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"[train] done in {elapsed / 60:.1f} min "
          f"({manifest['seconds_per_epoch']}s/epoch) -> {weights}")
    return weights


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a shelf-product detector.")
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    train(args.config if args.config.is_absolute() else ROOT / args.config)


if __name__ == "__main__":
    main()
