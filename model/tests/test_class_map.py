"""The class map is the contract boundary — these tests guard it."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from shelfeye_contracts import SemanticType
from shelfeye_ml.artifact.class_map import ClassMap

ROOT = Path(__file__).resolve().parents[1]
CLASS_MAP = ROOT / "class_map.yaml"
DATA_YAML = ROOT / "data" / "data.yaml"


@pytest.fixture(scope="module")
def cmap() -> ClassMap:
    return ClassMap.load(CLASS_MAP)


def test_every_dataset_class_is_mapped(cmap: ClassMap) -> None:
    """An unmapped class would silently vanish from every inference response."""
    if not DATA_YAML.exists():
        pytest.skip("dataset not extracted; run `make dataset`")
    names = yaml.safe_load(DATA_YAML.read_text())["names"]
    assert len(cmap) == len(names)
    for i, name in enumerate(names):
        assert cmap.name(i) == name


def test_exactly_one_gap_class(cmap: ClassMap) -> None:
    """OSA is computed from GAP area. Two GAP classes would double-count it."""
    assert cmap.gap_class_ids == (19,)
    assert cmap.name(19) == "Empty Shelf"


def test_semantic_type_distribution(cmap: ClassMap) -> None:
    counts = cmap.counts_by_semantic_type()
    assert counts[SemanticType.GAP] == 1
    assert counts[SemanticType.PRICE_TAG] == 1
    assert counts[SemanticType.PROMO_TAG] == 1
    assert counts[SemanticType.PRODUCT] == 42


def test_price_and_promo_are_distinct(cmap: ClassMap) -> None:
    """They are excluded from area math but carry different business meaning."""
    assert cmap.semantic_type(31) is SemanticType.PRICE_TAG
    assert cmap.semantic_type(18) is SemanticType.PROMO_TAG


def test_unknown_class_id_raises(cmap: ClassMap) -> None:
    """Weights and map from different runs must fail loudly, not mislabel."""
    with pytest.raises(KeyError):
        cmap.semantic_type(999)


def test_dataset_version_is_pinned(cmap: ClassMap) -> None:
    """Training against 'latest' makes a finding irreproducible."""
    assert cmap.dataset == "roboflow-ngkro/shelf-product"
    assert cmap.dataset_version == "1"
