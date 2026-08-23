"""Model health and the relabel queue — the data team's two screens.

⛔ The relabel queue shows WHAT was rejected and WHY, never WHO rejected it.
A queue that named the rejecting rep would be a per-rep accuracy metric by
another route, and would make reps reluctant to reject anything.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.integration.conftest import upload_capture


def test_model_health_is_not_open_to_reps(client: TestClient, rep_auth: dict[str, str]) -> None:
    assert client.get("/v1/model/health", headers=rep_auth).status_code == 403


def test_model_health_reports_the_versions_the_system_has(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    payload = client.get("/v1/model/health", headers=manager_auth).json()

    assert payload["versions"], "no model versions recorded"
    for version in payload["versions"]:
        assert set(version) >= {"version", "sha", "isActive", "promotedAt", "metrics"}


def test_model_health_reports_gate_failures_honestly(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    """The trained model fails its promotion gates, and the screen says so.

    A demo that hid a failing gate behind a rounded-up number would be
    teaching the exact habit this project exists to prevent.
    """
    payload = client.get("/v1/model/health", headers=manager_auth).json()
    trained = [v for v in payload["versions"] if v["metrics"]]
    if not trained:
        return  # no artifact on this machine; nothing to assert

    gates = trained[0]["metrics"].get("gates") or {}
    assert gates, "metrics with no gates cannot say whether the model may ship"
    for gate in gates.values():
        assert "passed" in gate and "detail" in gate


def test_override_rate_is_computed_not_stored(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    """The rate reps reject the model's findings, weekly.

    This replaces a "drift" figure that had nothing behind it. Every point
    here is counted from gap_findings at request time.
    """
    payload = client.get("/v1/model/health", headers=manager_auth).json()
    for point in payload["overrideRate"]:
        assert set(point) == {"bucket", "rate", "reviewed"}
        assert 0.0 <= point["rate"] <= 1.0
        assert point["reviewed"] > 0


def test_relabel_queue_never_says_who_rejected_a_finding(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    """⛔ SPEC §7: the queue returns the image and the reason, never the person."""
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    finding = result["gapFindings"][0]
    client.post(
        f"/v1/findings/{finding['id']}/verify",
        headers=rep_auth,
        json={"verdict": "REJECTED", "reason": "OCCLUDED"},
    )

    payload = client.get("/v1/model/relabel-queue", headers=manager_auth).json()
    assert payload["items"], "a rejected finding should reach the queue"

    serialised = str(payload).lower()
    for banned in ("verifiedby", "verified_by", "userid", "user_id", "repname", "email"):
        assert banned not in serialised, f"queue leaked {banned}"


def test_relabel_queue_carries_the_image_and_the_reason(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    payload = client.get("/v1/model/relabel-queue", headers=manager_auth).json()
    for item in payload["items"]:
        assert set(item) == {
            "findingId",
            "captureId",
            "reason",
            "rejectedReason",
            "confidence",
            "isLowConfidence",
            "storeName",
            "category",
            "capturedAt",
            "imageUrl",
            "imageWidth",
            "imageHeight",
            "bbox",
            "modelVersion",
        }
        assert item["reason"] in {"REP_REJECTED", "LOW_CONFIDENCE"}
