"""Guards for the constraints that are not negotiable.

These tests exist because each rule is one careless commit away from being
broken, and each would be expensive or impossible to walk back once shipped.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

APP = Path(__file__).resolve().parents[2] / "app"
BACKEND = Path(__file__).resolve().parents[2]


def _python_sources(root: Path) -> list[Path]:
    return [p for p in root.rglob("*.py") if "__pycache__" not in p.parts]


def _code_only(path: Path) -> str:
    """Source with docstrings and comments stripped.

    These guards must judge what the code DOES, not the prose explaining the
    rule. Several modules deliberately spell out the prohibition they are
    subject to, and scanning raw text would flag the warning as the violation.
    """
    import ast

    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


# ── 1. No ML libraries in the backend ────────────────────────────────────────


def test_no_cv_library_is_imported_anywhere_in_the_backend() -> None:
    """Changing the model must never require redeploying this service."""
    forbidden = re.compile(
        r"^\s*(?:import|from)\s+(torch|ultralytics|cv2|tensorflow|onnxruntime)\b", re.MULTILINE
    )
    offenders = [p for p in _python_sources(APP) if forbidden.search(_code_only(p))]
    assert not offenders, f"CV library imported in: {[str(p) for p in offenders]}"


def test_requirements_declares_no_cv_library() -> None:
    text = (BACKEND / "requirements.txt").read_text().lower()
    for package in ("torch", "ultralytics", "opencv", "tensorflow"):
        assert not re.search(rf"^{package}", text, re.MULTILINE), f"{package} in requirements.txt"


# ── 2. semantic_type only — never a raw class name ───────────────────────────


def test_business_logic_never_mentions_a_raw_model_class_name() -> None:
    """The dataset's 45 class names change on every retrain.

    `Empty Shelf` appearing in a service or router would silently stop matching
    the day the ML team renames a class, and OSA would quietly become 100%.
    """
    raw_names = ("Empty Shelf", "FM Bohne", "Discount Price", "Barista", "Simo ")
    logic_dirs = [APP / "services", APP / "api", APP / "repositories", APP / "workers"]

    offenders = []
    for directory in logic_dirs:
        for path in _python_sources(directory):
            code = _code_only(path)
            offenders += [(str(path), name) for name in raw_names if name in code]
    assert not offenders, f"raw class name in business logic: {offenders}"


def test_only_the_adapter_layer_knows_the_ml_service_exists() -> None:
    outside_adapters = [
        p
        for p in _python_sources(APP)
        if p.parent.name != "adapters"
        and "ml_service_url" in _code_only(p)
        and p.name != "config.py"
    ]
    assert not outside_adapters, f"ML service referenced outside adapters: {outside_adapters}"


# ── 3. No per-rep metrics — a labour-rights constraint ───────────────────────


def test_no_analytics_endpoint_aggregates_by_user() -> None:
    """If the score is tied to an individual, reps photograph only flattering
    angles and the whole dataset becomes worthless."""
    lowered = _code_only(APP / "api" / "v1" / "analytics.py").lower()
    for banned in (
        "group_by(visit.user_id",
        "group_by(user",
        ".user_id)",
        "rep_score",
        "leaderboard",
        "per_rep",
    ):
        assert banned not in lowered, f"per-rep aggregation appeared: {banned}"


def test_no_route_path_mentions_reps(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    for path in paths:
        assert "/reps" not in path and "leaderboard" not in path.lower(), path


def test_no_response_schema_exposes_a_rep_identity(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    for name, schema in schemas.items():
        for field in schema.get("properties", {}):
            lowered = field.lower()
            assert "repname" not in lowered, f"{name}.{field}"
            assert "repscore" not in lowered, f"{name}.{field}"
            assert "performance" not in lowered, f"{name}.{field}"


def test_analytics_responses_carry_no_user_identifiers(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    ranking = client.get("/v1/analytics/risk-ranking", headers=manager_auth).json()
    serialised = str(ranking).lower()
    for banned in ("userid", "repid", "repname", "user_id"):
        assert banned not in serialised


# ── 4. No face recognition ───────────────────────────────────────────────────


def test_no_face_recognition_capability_exists() -> None:
    """Detection-for-blurring only — and even that is deferred. Never identity."""
    banned = ("face_recognition", "face_embedding", "face_match", "identify_face")
    offenders = [
        (str(p), term)
        for p in _python_sources(APP)
        for term in banned
        if term in _code_only(p).lower()
    ]
    assert not offenders, offenders


# ── 5. No automated competitor-price response ────────────────────────────────


def test_no_endpoint_emits_competitor_prices(client: TestClient) -> None:
    """Competition-law guardrail: price data may surface only in aggregate."""
    paths = client.get("/openapi.json").json()["paths"]
    for path in paths:
        lowered = path.lower()
        assert "price-feed" not in lowered
        assert "competitor" not in lowered
        assert "pricing" not in lowered


# ── 6. Append-only derived data ──────────────────────────────────────────────


def test_no_code_path_updates_or_deletes_detections_or_analyses() -> None:
    """Findings must stay reproducible for a commercial dispute months later."""
    pattern = re.compile(
        r"(delete\(\s*(DetectionRow|ShelfAnalysisRow)|"
        r"(DetectionRow|ShelfAnalysisRow)\s*\)\s*\.\s*(delete|update))"
    )
    offenders = [p for p in _python_sources(APP) if pattern.search(_code_only(p))]
    assert not offenders, f"mutation of append-only tables in: {offenders}"


# ── 7. Thresholds live in config, never as literals ──────────────────────────


def test_osa_thresholds_are_not_hardcoded_in_the_engine() -> None:
    body = "\n".join(
        line
        for line in _code_only(APP / "services" / "shelf_analysis.py").splitlines()
        if "config." not in line
    )
    for literal in ("0.75", "0.90", "0.35", "0.55"):
        assert literal not in body, f"threshold {literal} hardcoded in the OSA engine"


# ── 8. Identity must not be reachable by COMPOSING endpoints ─────────────────


def test_no_response_field_is_a_user_identifier(client: TestClient) -> None:
    """Field-by-field, across every schema the API publishes.

    The earlier version of this test banned `repname` and `repscore` but not
    `userid` — so `VisitOut.userId` passed it, and the prohibition was broken
    by a field whose name nobody thought to ban.
    """
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    offenders = [
        f"{name}.{field}"
        for name, schema in schemas.items()
        for field in schema.get("properties", {})
        if field.lower() in {"userid", "user_id", "repid", "repname", "verifiedby", "createdby"}
    ]
    assert not offenders, f"response schemas expose a user identifier: {offenders}"


def test_identity_is_not_reachable_by_following_ids_the_api_hands_out(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    """The constraint has to hold across JOINS, not just per response.

    Every individual payload can be clean while the graph between them is not:
    the store history publishes a visitId, and if fetching that visit returns
    a user id then the pair reconstructs, per named person, every score they
    produced and every hour they worked. That is precisely the outcome this
    prohibition exists to prevent, and a per-response check cannot see it.
    """
    history = client.get(f"/v1/stores/{visit['storeId']}/history", headers=manager_auth).json()
    assert history["visits"], "no visits to walk"

    banned = ("userid", "user_id", "repname", "verifiedby")
    for row in history["visits"][:5]:
        followed = client.get(f"/v1/visits/{row['visitId']}", headers=rep_auth)
        if followed.status_code != 200:
            continue  # scoped away entirely is also a valid answer
        body = str(followed.json()).lower()
        for term in banned:
            assert term not in body, (
                f"following visitId {row['visitId']} from store history reached {term}"
            )
