"""The path a demo walks: check-in → capture → result → verify → task → checkout."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from tests.integration.conftest import upload_capture


def _await_job(client: TestClient, auth: dict[str, str], job_id: str) -> dict:
    """Eager Celery means the job is already terminal by the time commit returns."""
    return client.get(f"/v1/jobs/{job_id}", headers=auth).json()


def test_route_is_sorted_by_risk_then_distance(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    stops = client.get("/v1/routes/today?lat=13.7051&lng=100.6012", headers=rep_auth).json()
    assert stops
    keys = [(-s["riskScore"], s["distanceKm"]) for s in stops]
    assert keys == sorted(keys)


def test_route_uses_camel_case_matching_the_frontend_types(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    """`lib/mock` must be swappable for this response without touching components."""
    stop = client.get("/v1/routes/today", headers=rep_auth).json()[0]
    for field in (
        "externalCode",
        "storeFormat",
        "distanceKm",
        "lastOsa",
        "daysSinceLastVisit",
        "riskBand",
        "photoPolicy",
        "visitWindow",
    ):
        assert field in stop, f"missing {field}"
    assert not [k for k in stop if "_" in k], "snake_case leaked into the public API"


def test_gps_mismatch_is_flagged_but_never_blocks(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    """Reps legitimately stand outside a shop; blocking them would be wrong."""
    store = client.get("/v1/routes/today", headers=rep_auth).json()[0]
    response = client.post(
        "/v1/visits",
        headers=rep_auth,
        json={"storeId": store["id"], "gpsLat": 18.7883, "gpsLng": 98.9853},
    )
    assert response.status_code == 201
    assert response.json()["gpsMatch"] is False


def test_forbidden_photo_policy_blocks_check_in(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    from sqlalchemy import select

    from app.db.models import Store
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        store = session.execute(select(Store)).scalars().first()
        original = store.photo_policy
        store.photo_policy = "FORBIDDEN"
        session.commit()
        store_id = str(store.id)

    try:
        response = client.post("/v1/visits", headers=rep_auth, json={"storeId": store_id})
        assert response.status_code == 403
    finally:
        with SyncSessionFactory() as session:
            session.get(Store, uuid.UUID(store_id)).photo_policy = original
            session.commit()


def test_capture_commit_is_idempotent(
    client: TestClient, rep_auth: dict[str, str], visit: dict, idempotency_key: str
) -> None:
    """A phone that loses signal mid-request retries; that must not double-queue."""
    first = upload_capture(client, rep_auth, visit["id"], idem=idempotency_key)
    second = client.post(
        f"/v1/captures/{first['captureId']}/commit",
        headers={**rep_auth, "Idempotency-Key": idempotency_key},
        json={"imageWidth": 1920, "imageHeight": 1080},
    )
    assert second.status_code == 202
    assert second.json()["jobId"] == first["jobId"]


def test_commit_without_idempotency_key_is_rejected(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    presign = client.post(
        "/v1/captures/presign",
        headers=rep_auth,
        json={
            "visitId": visit["id"],
            "category": "coffee",
            "shelfBayLabel": "B",
            "phase": "BEFORE",
        },
    ).json()
    response = client.post(
        f"/v1/captures/{presign['captureId']}/commit",
        headers=rep_auth,
        json={"imageWidth": 1920, "imageHeight": 1080},
    )
    assert response.status_code == 422


def test_full_shelf_scores_one(client: TestClient, rep_auth: dict[str, str], visit: dict) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_full")
    assert _await_job(client, rep_auth, job["jobId"])["status"] == "DONE"

    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    assert result["osaScore"] == pytest.approx(1.0)
    assert result["status"] == "OK"
    assert result["gapFindings"] == []


def test_shelf_with_gaps_produces_findings(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    assert _await_job(client, rep_auth, job["jobId"])["status"] == "DONE"

    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    assert len(result["gapFindings"]) == 3
    assert result["osaScore"] < 1.0
    assert result["rowCount"] == 3
    assert all("ชั้นที่" in f["positionLabel"] for f in result["gapFindings"])
    # Price tags are detected but excluded from the area maths.
    assert any(d["semanticType"] == "PRICE_TAG" for d in result["detections"])


def test_result_shape_matches_frontend_shelf_analysis_type(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()

    for field in (
        "captureId",
        "modelVersion",
        "imageWidth",
        "imageHeight",
        "rowCount",
        "gapRatio",
        "osaScore",
        "status",
        "inferenceMs",
        "lowConfidenceCount",
        "detections",
        "gapFindings",
    ):
        assert field in result, f"ShelfAnalysis missing {field}"
    for field in (
        "detectionId",
        "classId",
        "className",
        "semanticType",
        "bbox",
        "confidence",
        "shelfRowIndex",
    ):
        assert field in result["detections"][0], f"Detection missing {field}"
    assert set(result["detections"][0]["bbox"]) == {"x", "y", "w", "h"}


def test_unreadable_image_fails_without_retrying(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """A 422 from the ML service is terminal: the photo itself is the problem."""
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_unreadable")
    status = _await_job(client, rep_auth, job["jobId"])

    assert status["status"] == "FAILED"
    assert status["errorCode"] == "UNREADABLE_IMAGE"
    assert "ถ่ายใหม่" in status["userMessage"]

    from sqlalchemy import select

    from app.db.models import InferenceJob
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        row = session.execute(
            select(InferenceJob).where(InferenceJob.id == uuid.UUID(job["jobId"]))
        ).scalar_one()
        assert row.attempts == 1, "an unreadable image must not be retried"


def test_empty_result_is_never_reported_as_a_perfect_shelf(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """The single most damaging failure this system could ship."""
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_unreadable")
    assert _await_job(client, rep_auth, job["jobId"])["status"] == "FAILED"

    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth)
    assert result.status_code == 404, "a failed analysis must not surface an OSA score"


def test_verify_confirm_creates_a_task_and_is_idempotent(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    findings = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()[
        "gapFindings"
    ]

    first = client.post(
        f"/v1/findings/{findings[0]['id']}/verify", headers=rep_auth, json={"verdict": "CONFIRMED"}
    ).json()
    assert first["taskId"] and first["idempotent"] is False

    replay = client.post(
        f"/v1/findings/{findings[0]['id']}/verify", headers=rep_auth, json={"verdict": "CONFIRMED"}
    ).json()
    assert replay["idempotent"] is True
    assert replay["taskId"] == first["taskId"]


def test_verify_reject_records_the_reason_and_creates_no_task(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Rejection reasons are training signal for the next model, not noise."""
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    findings = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()[
        "gapFindings"
    ]

    body = client.post(
        f"/v1/findings/{findings[0]['id']}/verify",
        headers=rep_auth,
        json={"verdict": "REJECTED", "reason": "OCCLUDED"},
    ).json()
    assert body["taskId"] is None

    refreshed = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()[
        "gapFindings"
    ]
    rejected = next(f for f in refreshed if f["id"] == findings[0]["id"])
    assert rejected["verificationStatus"] == "REJECTED"
    assert rejected["rejectedReason"] == "OCCLUDED"


def test_blocked_out_of_backstock_raises_a_replenishment_request(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    findings = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()[
        "gapFindings"
    ]
    task_id = client.post(
        f"/v1/findings/{findings[0]['id']}/verify", headers=rep_auth, json={"verdict": "CONFIRMED"}
    ).json()["taskId"]

    patched = client.patch(
        f"/v1/tasks/{task_id}",
        headers=rep_auth,
        json={"status": "BLOCKED", "blockedReason": "OUT_OF_BACKSTOCK"},
    ).json()
    assert patched["status"] == "BLOCKED"

    from sqlalchemy import select

    from app.db.models import ReplenishmentRequest
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        assert (
            session.execute(
                select(ReplenishmentRequest).where(
                    ReplenishmentRequest.source_task_id == uuid.UUID(task_id)
                )
            ).scalar_one_or_none()
            is not None
        )


def test_blocked_requires_a_reason(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    findings = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()[
        "gapFindings"
    ]
    task_id = client.post(
        f"/v1/findings/{findings[0]['id']}/verify", headers=rep_auth, json={"verdict": "CONFIRMED"}
    ).json()["taskId"]

    response = client.patch(f"/v1/tasks/{task_id}", headers=rep_auth, json={"status": "BLOCKED"})
    assert response.status_code == 422


def test_checkout_computes_osa_after_from_after_phase_captures(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """The before/after story is the product's proof that the visit mattered."""
    upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps", phase="BEFORE")
    upload_capture(client, rep_auth, visit["id"], bay="BAY_full", phase="AFTER")

    summary = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()
    assert summary["osaBefore"] == pytest.approx(0.875)
    assert summary["osaAfter"] == pytest.approx(1.0)
    assert summary["checkedOutAt"]


def test_sync_batch_is_safe_to_replay(client: TestClient, rep_auth: dict[str, str]) -> None:
    payload = {
        "operations": [
            {"idempotencyKey": f"sync-{uuid.uuid4()}", "kind": "TASK", "payload": {"a": 1}},
            {"idempotencyKey": f"sync-{uuid.uuid4()}", "kind": "VERIFY", "payload": {"b": 2}},
        ]
    }
    first = client.post("/v1/sync/batch", headers=rep_auth, json=payload).json()
    second = client.post("/v1/sync/batch", headers=rep_auth, json=payload).json()

    assert all(r["ok"] for r in first["results"])
    assert all(r["ok"] for r in second["results"])
    assert [r["idempotencyKey"] for r in first["results"]] == [
        r["idempotencyKey"] for r in second["results"]
    ]
