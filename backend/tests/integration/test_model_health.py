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


def test_model_health_names_the_active_version_and_inference_mode(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    """Both fields drive the /w/model-health header, and neither was asserted."""
    payload = client.get("/v1/model/health", headers=manager_auth).json()
    assert payload["activeVersion"], "no model is marked active"
    assert payload["mlClient"] in {"mock", "http"}


def test_model_health_rejects_an_out_of_range_window(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    assert client.get("/v1/model/health?weeks=0", headers=manager_auth).status_code == 422
    assert client.get("/v1/model/health?weeks=99", headers=manager_auth).status_code == 422


def test_model_health_carries_no_user_identifier(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    """`metrics` is a free-form blob passed straight through from metrics.json,
    and ModelVersion carries a `promoted_by` column one keystroke from being
    serialised."""
    body = str(client.get("/v1/model/health", headers=manager_auth).json()).lower()
    for banned in ("userid", "user_id", "repname", "promoted_by", "promotedby", "@"):
        assert banned not in body, f"model health leaked {banned}"


def test_override_rate_is_computed_not_stored(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    """The rate reps reject the model's findings, weekly.

    This replaces a "drift" figure that had nothing behind it. Every point
    here is counted from gap_findings at request time.

    The verdict below is this test's own arrangement: without it the list is
    empty on a fresh database and the loop asserts nothing at all.
    """
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    client.post(
        f"/v1/findings/{result['gapFindings'][0]['id']}/verify",
        headers=rep_auth,
        json={"verdict": "CONFIRMED"},
    )

    payload = client.get("/v1/model/health", headers=manager_auth).json()
    assert payload["overrideRate"], "a verified finding should produce a bucket"
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


def test_relabel_queue_is_not_open_to_reps(client: TestClient, rep_auth: dict[str, str]) -> None:
    """It hands out presigned image URLs for every flagged capture."""
    assert client.get("/v1/model/relabel-queue", headers=rep_auth).status_code == 403


def test_relabel_queue_carries_the_image_and_the_reason(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    client.post(
        f"/v1/findings/{result['gapFindings'][0]['id']}/verify",
        headers=rep_auth,
        json={"verdict": "REJECTED", "reason": "OCCLUDED"},
    )

    payload = client.get("/v1/model/relabel-queue", headers=manager_auth).json()
    assert payload["items"], "a rejected finding should reach the queue"
    for item in payload["items"]:
        assert set(item) == {
            "findingId",
            "captureId",
            "reason",
            "rejectedReason",
            "confidence",
            "isLowConfidence",
            "storeId",
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


def test_confirming_a_low_confidence_finding_takes_it_out_of_the_queue(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    """A queue that cannot be emptied stops being a queue.

    Every uncertain detection used to stay here forever, whether or not a rep
    had already stood at the shelf and answered the question. A REJECTED
    finding still stays — that disagreement is the whole signal.
    """
    # `_lowconf` is the marker the mock reads out of the object key: it puts the
    # gap's score inside the 0.35-0.55 band. `_gaps` scores 0.72-0.94, so asking
    # for that bay here made the test pass without exercising anything.
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_lowconf")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    uncertain = [f for f in result["gapFindings"] if f["isLowConfidence"]]
    assert uncertain, "the lowconf scenario must produce an uncertain finding to test with"

    finding_id = uncertain[0]["id"]
    before = client.get("/v1/model/relabel-queue", headers=manager_auth).json()["items"]
    assert any(i["findingId"] == finding_id for i in before)

    client.post(
        f"/v1/findings/{finding_id}/verify",
        headers=rep_auth,
        json={"verdict": "CONFIRMED"},
    )

    after = client.get("/v1/model/relabel-queue", headers=manager_auth).json()["items"]
    assert not any(i["findingId"] == finding_id for i in after)


def test_the_queue_links_each_card_to_the_store_it_came_from(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    """⛔ A store id, never a rep id — the card opens the photograph, not a person."""
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    client.post(
        f"/v1/findings/{result['gapFindings'][0]['id']}/verify",
        headers=rep_auth,
        json={"verdict": "REJECTED", "reason": "OCCLUDED"},
    )

    # The queue is global and session-scoped fixtures leave findings from other
    # tests in it, so this asserts on the row it just created rather than on
    # every row — an earlier version compared every item to this visit's store
    # and failed the moment a second test had run.
    items = client.get("/v1/model/relabel-queue", headers=manager_auth).json()["items"]
    mine = [i for i in items if i["captureId"] == job["captureId"]]
    assert mine, "the finding just rejected should be in the queue"
    for item in mine:
        assert item["storeId"] == visit["storeId"]
    for item in items:
        assert item["storeId"], "every card needs a store to open its photograph from"
