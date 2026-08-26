"""ONNX Runtime session with a warm-up pass.

`/readyz` stays 503 until warm-up completes so the first real request from a
rep standing at a shelf does not pay the graph-optimisation cost.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

from shelfeye_ml.artifact.class_map import ClassMap
from shelfeye_ml.serving.postprocess import decode
from shelfeye_ml.serving.preprocess import LetterboxTransform, letterbox


class InferenceEngine:
    """Wraps one model artifact. Holds no domain knowledge whatsoever."""

    def __init__(self, artifact_dir: Path, version: str) -> None:
        self.artifact_dir = artifact_dir
        self.version = version
        self.is_ready = False

        meta_path = artifact_dir / "artifact.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        self.imgsz = int(meta.get("imgsz", 640))
        self.model_sha = str(meta.get("model_sha", "unknown"))

        self.class_map = ClassMap.load(artifact_dir / "class_map.yaml")

        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if "CUDAExecutionProvider" in ort.get_available_providers()
            else ["CPUExecutionProvider"]
        )
        self.session = ort.InferenceSession(str(artifact_dir / "best.onnx"), providers=providers)
        self.input_name = self.session.get_inputs()[0].name

    def warm_up(self) -> float:
        """One pass on a dummy tensor so the first real request is not the slow one."""
        started = time.perf_counter()
        dummy = np.zeros((1, 3, self.imgsz, self.imgsz), dtype=np.float32)
        self.session.run(None, {self.input_name: dummy})
        self.is_ready = True
        return (time.perf_counter() - started) * 1000

    def infer(
        self,
        image,
        conf_threshold: float = 0.25,
        class_thresholds: dict | None = None,
    ) -> tuple[list, int, LetterboxTransform]:
        tensor, transform = letterbox(image, self.imgsz)
        started = time.perf_counter()
        raw = self.session.run(None, {self.input_name: tensor})[0]
        elapsed_ms = int((time.perf_counter() - started) * 1000)

        detections = decode(
            np.asarray(raw),
            transform,
            self.class_map,
            conf_threshold=conf_threshold,
            class_thresholds=class_thresholds,
        )
        return detections, elapsed_ms, transform
