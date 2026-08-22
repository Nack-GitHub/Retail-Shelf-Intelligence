"""The ONLY file in this service that knows an ML service exists.

Everything above this layer speaks in `shelfeye_contracts` types and branches
on `semantic_type`. Nothing above this layer imports httpx, knows the ML
service's URL, or has ever heard of YOLO.

Selecting between the mock and the real service is one env var, `ML_CLIENT`.
If switching from mock to real ever requires editing a file other than config,
the boundary has leaked and the fix belongs here — not in the caller.
"""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

import httpx
from shelfeye_contracts import INFER_PATH, InferRequest, InferResponse

from app.core.config import settings
from app.core.exceptions import (
    MLServiceError,
    NoShelfDetectedError,
    UnreadableImageError,
)
from app.core.logging import get_logger

log = get_logger(__name__)

# 422 error codes and the domain exception each maps to. All are terminal:
# the photo is the problem, and retrying an identical request cannot help.
_TERMINAL_ERRORS = {
    "NO_SHELF_DETECTED": NoShelfDetectedError,
    "UNREADABLE_IMAGE": UnreadableImageError,
    "IMAGE_NOT_FOUND": UnreadableImageError,
}


class MLClient(Protocol):
    """What the rest of the backend is allowed to ask of the model."""

    def infer(
        self, image_uri: str, request_id: UUID, model_version: str | None = None
    ) -> InferResponse: ...


class HttpMLClient:
    """Talks to the real inference service over the shared contract."""

    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        self._base_url = (base_url or settings.ml_service_url).rstrip("/")
        self._timeout = timeout or settings.ml_timeout_seconds

    def infer(
        self, image_uri: str, request_id: UUID, model_version: str | None = None
    ) -> InferResponse:
        payload = InferRequest(
            image_uri=image_uri, request_id=request_id, model_version=model_version
        )
        try:
            response = httpx.post(
                f"{self._base_url}{INFER_PATH}",
                json=payload.model_dump(mode="json"),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            # A timeout is transient; the caller's retry policy handles it.
            raise MLServiceError(f"inference timed out after {self._timeout}s") from exc
        except httpx.HTTPError as exc:
            raise MLServiceError(f"inference transport error: {exc}") from exc

        if response.status_code == 200:
            return InferResponse.model_validate(response.json())

        body = _safe_json(response)
        code = str(body.get("error_code", "UNKNOWN"))
        detail = str(body.get("detail", response.text[:200]))

        if response.status_code == 422:
            # NOT retryable. The rep must retake the photo.
            raise _TERMINAL_ERRORS.get(code, UnreadableImageError)(detail)

        # 5xx, 503 warming, anything else — retryable.
        raise MLServiceError(f"ml service returned {response.status_code}: {code} {detail}")


def _safe_json(response: httpx.Response) -> dict:
    try:
        parsed = response.json()
        return parsed if isinstance(parsed, dict) else {}
    except ValueError:
        return {}


def build_ml_client() -> MLClient:
    """Resolve the configured client. The single switch point."""
    if settings.ml_client == "mock":
        from app.adapters.mock_ml_client import MockMLClient

        log.info("ml_client_selected", implementation="mock")
        return MockMLClient()

    log.info("ml_client_selected", implementation="http", url=settings.ml_service_url)
    return HttpMLClient()
