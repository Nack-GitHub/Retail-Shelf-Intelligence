"""Parity between the Pydantic models and the OpenAPI spec.

Both services install this package; the YAML is what the two teams agreed on.
If someone renames a field on one side without the other, this test fails
loudly rather than the system silently producing nulls at runtime.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import BaseModel

from shelfeye_contracts import (
    BBox,
    Detection,
    HealthResponse,
    InferError,
    InferErrorCode,
    InferRequest,
    InferResponse,
    ModelInfo,
    ModelsResponse,
    SemanticType,
)

SPEC_PATH = Path(__file__).resolve().parents[1] / "inference-v1.yaml"

# Every model that must appear in the spec, keyed by its schema name there.
MODELS: dict[str, type[BaseModel]] = {
    "BBox": BBox,
    "Detection": Detection,
    "InferRequest": InferRequest,
    "InferResponse": InferResponse,
    "InferError": InferError,
    "ModelInfo": ModelInfo,
    "ModelsResponse": ModelsResponse,
    "HealthResponse": HealthResponse,
}


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC_PATH.read_text())


@pytest.mark.parametrize("name,model", MODELS.items())
def test_model_fields_match_spec(spec: dict, name: str, model: type[BaseModel]) -> None:
    schema = spec["components"]["schemas"][name]
    assert set(model.model_fields) == set(schema["properties"]), (
        f"{name}: Pydantic and OpenAPI disagree on which fields exist"
    )


@pytest.mark.parametrize("name,model", MODELS.items())
def test_required_fields_match_spec(spec: dict, name: str, model: type[BaseModel]) -> None:
    schema = spec["components"]["schemas"][name]
    spec_required = set(schema.get("required", []))
    model_required = {n for n, f in model.model_fields.items() if f.is_required()}
    assert model_required == spec_required, f"{name}: required-field sets diverged"


@pytest.mark.parametrize(
    "name,enum",
    [("SemanticType", SemanticType), ("InferErrorCode", InferErrorCode)],
)
def test_enum_members_match_spec(spec: dict, name: str, enum: type) -> None:
    assert {m.value for m in enum} == set(spec["components"]["schemas"][name]["enum"])


def test_paths_declared_in_spec(spec: dict) -> None:
    from shelfeye_contracts import HEALTHZ_PATH, INFER_PATH, MODELS_PATH, READYZ_PATH

    assert {INFER_PATH, MODELS_PATH, HEALTHZ_PATH, READYZ_PATH} <= set(spec["paths"])


def test_bbox_is_absolute_pixels_not_normalised() -> None:
    """A normalised box would satisfy 0..1 bounds; ours must accept real pixels."""
    box = BBox(x=120, y=340, w=88, h=210)
    assert box.area == 88 * 210
    assert box.center_y == 340 + 105
    assert box.center_x == 120 + 44


def test_semantic_type_is_the_only_branchable_field() -> None:
    """Guards the design rule: class_name is audit metadata, semantic_type is logic.

    If someone ever adds a semantic type, this test forces them to notice that
    every backend consumer branching on the enum needs a new arm.
    """
    assert {m.value for m in SemanticType} == {"PRODUCT", "GAP", "PRICE_TAG", "PROMO_TAG"}
