"""shelfeye-contracts — the only code shared by shelfeye-api and shelfeye-ml.

Changing anything here is a two-team decision. Both services install this
package; a field renamed on one side without the other breaks the build
loudly, which is the entire point.
"""

from .enums import InferErrorCode, SemanticType
from .inference import (
    BBox,
    Detection,
    HealthResponse,
    InferError,
    InferRequest,
    InferResponse,
    ModelInfo,
    ModelsResponse,
)

CONTRACT_VERSION = "1.0.0"
INFER_PATH = "/internal/v1/infer"
MODELS_PATH = "/internal/v1/models"
HEALTHZ_PATH = "/internal/v1/healthz"
READYZ_PATH = "/internal/v1/readyz"

__all__ = [
    "BBox",
    "CONTRACT_VERSION",
    "Detection",
    "HEALTHZ_PATH",
    "HealthResponse",
    "INFER_PATH",
    "InferError",
    "InferErrorCode",
    "InferRequest",
    "InferResponse",
    "MODELS_PATH",
    "ModelInfo",
    "ModelsResponse",
    "READYZ_PATH",
    "SemanticType",
]
