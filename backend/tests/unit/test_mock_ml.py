"""The mock must be deterministic across processes, not merely repeatable."""

from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from shelfeye_contracts import SemanticType

from app.adapters.mock_ml_client import MockMLClient
from app.core.exceptions import MLServiceError, UnreadableImageError

RID = uuid.UUID("11111111-2222-3333-4444-555555555555")
BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def client() -> MockMLClient:
    return MockMLClient()


def test_same_uri_yields_identical_detections(client: MockMLClient) -> None:
    a = client.infer("s3://bucket/shelf_gaps.jpg", RID)
    b = client.infer("s3://bucket/shelf_gaps.jpg", uuid.uuid4())
    assert [d.model_dump() for d in a.detections] == [d.model_dump() for d in b.detections]


def test_different_uris_differ(client: MockMLClient) -> None:
    a = client.infer("s3://bucket/one_gaps.jpg", RID)
    b = client.infer("s3://bucket/two_gaps.jpg", RID)
    assert [d.confidence for d in a.detections] != [d.confidence for d in b.detections]


def test_determinism_survives_a_new_process() -> None:
    """A fresh interpreter must produce the same bytes — no PYTHONHASHSEED luck."""
    script = (
        "import uuid,json;"
        "from app.adapters.mock_ml_client import MockMLClient;"
        "r=MockMLClient().infer('s3://bucket/shelf_gaps.jpg',"
        "uuid.UUID('11111111-2222-3333-4444-555555555555'));"
        "print(json.dumps([[str(d.detection_id),d.confidence] for d in r.detections]))"
    )
    out = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    from_subprocess = json.loads(out.stdout)
    local = MockMLClient().infer("s3://bucket/shelf_gaps.jpg", RID)
    assert from_subprocess == [[str(d.detection_id), d.confidence] for d in local.detections]


def test_full_scenario_has_no_gaps(client: MockMLClient) -> None:
    result = client.infer("s3://bucket/shelf_full.jpg", RID)
    assert not [d for d in result.detections if d.semantic_type is SemanticType.GAP]


def test_gaps_scenario_has_three_gaps(client: MockMLClient) -> None:
    result = client.infer("s3://bucket/shelf_gaps.jpg", RID)
    gaps = [d for d in result.detections if d.semantic_type is SemanticType.GAP]
    assert len(gaps) == 3


def test_lowconf_scenario_sits_inside_the_uncertain_band(client: MockMLClient) -> None:
    result = client.infer("s3://bucket/shelf_lowconf.jpg", RID)
    gaps = [d for d in result.detections if d.semantic_type is SemanticType.GAP]
    assert all(0.35 <= d.confidence < 0.55 for d in gaps)


def test_unreadable_raises_terminal_error(client: MockMLClient) -> None:
    """Terminal: the pipeline must NOT retry this."""
    with pytest.raises(UnreadableImageError):
        client.infer("s3://bucket/shelf_unreadable.jpg", RID)


def test_error_scenario_raises_retryable_error(client: MockMLClient) -> None:
    with pytest.raises(MLServiceError):
        client.infer("s3://bucket/shelf_error.jpg", RID)


def test_price_tags_are_present_so_exclusion_is_exercised(client: MockMLClient) -> None:
    result = client.infer("s3://bucket/shelf_gaps.jpg", RID)
    assert [d for d in result.detections if d.semantic_type is SemanticType.PRICE_TAG]


def test_bboxes_are_absolute_pixels(client: MockMLClient) -> None:
    """Normalised coordinates would all be <= 1 — a classic silent bug."""
    result = client.infer("s3://bucket/shelf_gaps.jpg", RID)
    assert any(d.bbox.x > 1 or d.bbox.w > 1 for d in result.detections)
    assert all(d.bbox.x + d.bbox.w <= result.image_width for d in result.detections)
