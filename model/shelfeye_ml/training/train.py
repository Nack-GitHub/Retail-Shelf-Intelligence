"""Reproducible YOLO training for the shelf-product dataset.

Run:
    python -m shelfeye_ml.training.train --config configs/smoke.yaml
    python -m shelfeye_ml.training.train --config configs/yolo26l-640-recall.yaml
    python -m shelfeye_ml.training.train --config configs/yolo26l-640-recall.yaml --fold 0
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
SPLITS_DIR = ROOT / "data" / "splits"
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
    # ⚠️ `erasing` blanks a random rectangle to stand in for occlusion by
    # shoppers and trolleys. That reads as a sensible proxy for the 44 SKU
    # classes and as an ACTIVE HARM for `Empty Shelf`: a blanked rectangle on
    # a shelf is a gap that carries no label, so every draw teaches the model
    # that a gap is background. Recall on the one class the product exists to
    # find is what pays for that. Configs chasing gap recall set this to 0.0.
    "erasing": 0.2,
}

# Below this epoch, validation is skipped. An early-epoch model emits a flood
# of low-confidence boxes across 45 classes, and NMS at the validation
# confidence floor (0.001) then costs MORE than the training epoch itself —
# measured at 193 s/iteration with repeated "NMS time limit exceeded"
# warnings, versus ~2 s/iteration to train. That cost is real but it is
# confined to the first few epochs; disabling validation for the whole run to
# dodge it (the previous approach) silently disables `patience` too, and
# leaves `best.pt` meaning "the last epoch" rather than "the best one".
VAL_WARMUP_EPOCHS = 15


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def _resolve_device() -> str:
    """Prefer CUDA where present, then MPS on Apple Silicon, else CPU."""
    import torch

    if torch.cuda.is_available():
        return "0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def resolve_data_yaml(cfg: dict, fold: int | None, data_override: Path | None) -> Path:
    """Pick the dataset manifest: explicit path > fold > config > Roboflow default."""
    if data_override is not None:
        return data_override if data_override.is_absolute() else ROOT / data_override
    if fold is not None:
        candidate = SPLITS_DIR / "kfold" / f"fold{fold}" / "data.yaml"
        if not candidate.exists():
            raise SystemExit(
                f"{candidate} not found — run `python -m shelfeye_ml.training.resplit "
                f"--mode kfold` on this machine first."
            )
        return candidate
    if "data" in cfg:
        path = Path(cfg["data"])
        return path if path.is_absolute() else ROOT / path
    return DATA_YAML


def _val_warmup_callback(warmup_epochs: int):
    """Turn validation on once the model stops flooding NMS.

    Ultralytics reads `trainer.args.val` at the top of each epoch, so flipping
    it here is enough — no fork, no monkeypatch. `patience` and the `best.pt`
    selection both start working from the first validated epoch.
    """

    def _callback(trainer) -> None:
        trainer.args.val = trainer.epoch >= warmup_epochs

    return _callback


def train(config_path: Path, fold: int | None = None, data_override: Path | None = None) -> Path:
    from ultralytics import YOLO
    from shelfeye_ml.training.prepare_dataset import prepare_dataset

    if not DATA_YAML.exists():
        prepare_dataset()

    cfg = yaml.safe_load(config_path.read_text())
    run_name = cfg["run_name"] if fold is None else f"{cfg['run_name']}-fold{fold}"
    device = _resolve_device()
    data_yaml = resolve_data_yaml(cfg, fold, data_override)
    out_dir = ARTIFACTS / run_name
    out_dir.mkdir(parents=True, exist_ok=True)

    # Anything in `overrides:` lands on model.train() verbatim, on top of the
    # shared augmentation. One flat namespace, because that is what Ultralytics
    # exposes — `erasing` and `cos_lr` are both just train kwargs.
    settings = {**AUGMENT, **(cfg.get("overrides") or {})}

    want_val = cfg.get("val", True)
    warmup = int(cfg.get("val_warmup_epochs", VAL_WARMUP_EPOCHS))

    print(f"[train] config={config_path.name} run={run_name} device={device} "
          f"imgsz={cfg['imgsz']} epochs={cfg['epochs']} data={data_yaml}")
    if want_val:
        print(f"[train] validation starts at epoch {warmup} (patience={cfg['patience']})")
    else:
        print("[train] ⚠️  val disabled — `patience` is inert and best.pt will be the LAST epoch")

    started = time.monotonic()
    model = YOLO(cfg["model"])
    if want_val and warmup > 0:
        model.add_callback("on_train_epoch_start", _val_warmup_callback(warmup))
    model.train(
        data=str(data_yaml),
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
        val=want_val,
        **settings,
    )
    elapsed = time.monotonic() - started

    weights = out_dir / "weights" / "best.pt"
    manifest = {
        "run_name": run_name,
        "config": cfg,
        "config_file": config_path.name,
        "fold": fold,
        "data_yaml": str(data_yaml),
        "device": device,
        "settings": settings,
        "val_warmup_epochs": warmup if want_val else None,
        "dataset": "roboflow-ngkro/shelf-product",
        "dataset_version": "1",
        "git_sha": _git_sha(),
        "trained_at": datetime.now(UTC).isoformat(),
        "elapsed_seconds": round(elapsed, 1),
        "seconds_per_epoch": round(elapsed / max(cfg["epochs"], 1), 1),
        "weights": str(weights.relative_to(ROOT)) if weights.exists() else None,
    }
    (out_dir / "run_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[train] done in {elapsed / 60:.1f} min "
          f"({manifest['seconds_per_epoch']}s/epoch) -> {weights}")
    return weights


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a shelf-product detector.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--fold", type=int, help="train on data/splits/kfold/fold<N>/data.yaml")
    parser.add_argument("--data", type=Path, help="explicit dataset yaml, overrides --fold")
    args = parser.parse_args()
    train(
        args.config if args.config.is_absolute() else ROOT / args.config,
        fold=args.fold,
        data_override=args.data,
    )


if __name__ == "__main__":
    main()
