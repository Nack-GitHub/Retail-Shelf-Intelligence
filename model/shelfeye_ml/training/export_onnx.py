"""Export trained weights to ONNX and assemble the deployable artifact.

The artifact directory is self-contained: weights, class map, metrics and model
card travel together. The serving layer reads the class map FROM the artifact,
never from the repo, so a mismatched pair fails loudly at load rather than
silently mislabelling gaps as products.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _sha8(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:8]


def export(weights: Path, imgsz: int = 640, opset: int = 17) -> Path:
    from ultralytics import YOLO

    model = YOLO(str(weights))
    onnx_path = Path(
        model.export(format="onnx", opset=opset, imgsz=imgsz, simplify=False, dynamic=False)
    )

    artifact_dir = weights.parent.parent
    target = artifact_dir / "best.onnx"
    if onnx_path.resolve() != target.resolve():
        shutil.copy2(onnx_path, target)

    # The class map must ship WITH the weights, not alongside the code.
    shutil.copy2(ROOT / "class_map.yaml", artifact_dir / "class_map.yaml")

    meta = {
        "onnx": target.name,
        "opset": opset,
        "imgsz": imgsz,
        "model_sha": _sha8(target),
        "weights_sha": _sha8(weights),
    }
    (artifact_dir / "artifact.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"[export] {target}  sha={meta['model_sha']}  opset={opset}  imgsz={imgsz}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()
    export(args.weights if args.weights.is_absolute() else ROOT / args.weights,
           args.imgsz, args.opset)


if __name__ == "__main__":
    main()
