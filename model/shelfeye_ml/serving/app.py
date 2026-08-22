"""The inference service. Implements contracts/inference-v1.yaml, nothing more.

This service has never heard of a store, a visit, a rep, or OSA. It receives an
image URI and returns boxes with a semantic_type attached. Every threshold that
turns those boxes into a business verdict lives in the backend, where it can be
changed without a model release.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Response, status
from fastapi.responses import JSONResponse
from shelfeye_contracts import (
    HealthResponse,
    InferError,
    InferErrorCode,
    InferRequest,
    InferResponse,
    ModelInfo,
    ModelsResponse,
)

from shelfeye_ml.serving.engine import InferenceEngine
from shelfeye_ml.serving.preprocess import (
    ImageNotFoundError,
    ImageUnreadableError,
    load_image,
)
from shelfeye_ml.serving.storage import S3Reader

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = Path(os.environ.get("MODEL_ARTIFACT_DIR", ROOT / "artifacts" / "shelf-product-v1"))
MODEL_VERSION = os.environ.get("MODEL_VERSION", ARTIFACT_DIR.name)
CONF_THRESHOLD = float(os.environ.get("CONF_THRESHOLD", "0.25"))

# Below this many detections we treat the image as having no visible shelf
# structure. One stray box on a photo of the ceiling is not a shelf.
MIN_DETECTIONS_FOR_SHELF = int(os.environ.get("MIN_DETECTIONS_FOR_SHELF", "2"))

_engine: InferenceEngine | None = None
_storage = S3Reader()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _engine
    try:
        _engine = InferenceEngine(ARTIFACT_DIR, MODEL_VERSION)
        warm_ms = _engine.warm_up()
        print(f"[ml] loaded {MODEL_VERSION} sha={_engine.model_sha} warm_up={warm_ms:.0f}ms")
    except Exception as exc:  # noqa: BLE001 — stay up and report unready
        print(f"[ml] model load failed: {exc}")
        _engine = None
    yield


app = FastAPI(title="ShelfEye ML", version="1.0.0", lifespan=lifespan)


def _error(status_code: int, code: InferErrorCode, detail: str, request_id=None) -> JSONResponse:
    body = InferError(request_id=request_id, error_code=code, detail=detail)
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


@app.post("/internal/v1/infer")
async def infer(body: InferRequest) -> Response:
    if _engine is None or not _engine.is_ready:
        return _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            InferErrorCode.MODEL_NOT_LOADED,
            "model is not loaded",
            body.request_id,
        )

    # Version pinning is a reproducibility feature for contract disputes. This
    # build keeps only the active model loadable, and says so rather than
    # silently answering with the wrong version.
    if body.model_version and body.model_version != _engine.version:
        return _error(
            status.HTTP_501_NOT_IMPLEMENTED,
            InferErrorCode.VERSION_NOT_AVAILABLE,
            f"only {_engine.version} is loadable in this build",
            body.request_id,
        )

    try:
        image = load_image(body.image_uri, _storage)
    except ImageNotFoundError as exc:
        return _error(422, InferErrorCode.IMAGE_NOT_FOUND, str(exc), body.request_id)
    except ImageUnreadableError as exc:
        return _error(422, InferErrorCode.UNREADABLE_IMAGE, str(exc), body.request_id)

    detections, inference_ms, transform = _engine.infer(image, CONF_THRESHOLD)

    if len(detections) < MIN_DETECTIONS_FOR_SHELF:
        # ⚠️ An image where the model finds nothing must NEVER be reported as a
        # perfect shelf. "No gaps found" and "no shelf found" are different
        # answers and the backend needs to be able to tell them apart.
        return _error(
            422,
            InferErrorCode.NO_SHELF_DETECTED,
            f"only {len(detections)} detections; no shelf structure visible",
            body.request_id,
        )

    return JSONResponse(
        content=InferResponse(
            request_id=body.request_id,
            model_version=_engine.version,
            model_sha=_engine.model_sha,
            inference_ms=inference_ms,
            image_width=transform.original_width,
            image_height=transform.original_height,
            detections=detections,
        ).model_dump(mode="json")
    )


@app.get("/internal/v1/models", response_model=ModelsResponse)
async def list_models() -> ModelsResponse:
    if _engine is None:
        return ModelsResponse(active_version=None, models=[])
    return ModelsResponse(
        active_version=_engine.version,
        models=[
            ModelInfo(
                version=_engine.version,
                sha=_engine.model_sha,
                is_active=True,
                loaded=_engine.is_ready,
            )
        ],
    )


@app.get("/internal/v1/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    """Liveness — the process is up, whatever the model is doing."""
    return HealthResponse(status="ok")


@app.get("/internal/v1/readyz")
async def readyz() -> Response:
    """Readiness — model loaded AND warm."""
    if _engine is None:
        return JSONResponse(
            status_code=503,
            content=HealthResponse(status="unavailable", detail="model not loaded").model_dump(),
        )
    if not _engine.is_ready:
        return JSONResponse(
            status_code=503,
            content=HealthResponse(status="warming", detail="warm-up in progress").model_dump(),
        )
    return JSONResponse(
        content=HealthResponse(status="ready", detail=_engine.version).model_dump()
    )
