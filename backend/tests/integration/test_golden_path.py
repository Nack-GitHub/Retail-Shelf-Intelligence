"""The path a demo walks: check-in → capture → result → verify → task → checkout."""

from __future__ import annotations

import time
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


def _queue_an_unanalysed_after_capture(visit_id: str) -> str:
    """A photograph that has been sent but not yet read by the model.

    Celery runs eagerly under test, so an upload is finished before the request
    that made it returns — the state a rep on a real connection spends seconds
    in never occurs on its own.
    """
    import uuid as _uuid

    from app.db.models import Capture, InferenceJob
    from app.domain.enums import JobStatus
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        capture = Capture(
            visit_id=_uuid.UUID(visit_id),
            category="coffee",
            shelf_bay_label="BAY_full",
            phase="AFTER",
            object_key=f"pending/{_uuid.uuid4()}.jpg",
        )
        session.add(capture)
        session.flush()
        session.add(InferenceJob(capture_id=capture.id, status=JobStatus.QUEUED))
        session.commit()
        return str(capture.id)


def _finish_the_job(capture_id: str) -> None:
    """Let the model catch up: the analysis lands and the job goes terminal."""
    import uuid as _uuid

    from app.db.models import InferenceJob, ShelfAnalysisRow
    from app.domain.enums import JobStatus, OsaStatus
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        job = (
            session.query(InferenceJob)
            .filter(InferenceJob.capture_id == _uuid.UUID(capture_id))
            .one()
        )
        job.status = JobStatus.DONE
        session.add(
            ShelfAnalysisRow(
                capture_id=_uuid.UUID(capture_id),
                run_id=_uuid.uuid4(),
                model_version="test-pending",
                row_count=1,
                total_shelf_area=100.0,
                gap_area=10.0,
                gap_ratio=0.1,
                osa_score=0.9,
                status=OsaStatus.OK.value,
                low_confidence_count=0,
                config_version="v1",
            )
        )
        session.commit()


def test_checkout_says_when_an_after_photo_is_still_being_read(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Silence and "no after-photo" look identical to the rep, and are not.

    The summary that says nothing was photographed is the one a rep sees right
    after photographing the shelf, and the route list contradicts it seconds
    later. The visit still closes — a worker that never finishes must not trap
    a rep in a shop.
    """
    upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps", phase="BEFORE")
    _queue_an_unanalysed_after_capture(visit["id"])

    summary = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()

    assert summary["analysisPending"] is True
    assert summary["osaAfter"] is None
    assert client.get(f"/v1/visits/{visit['id']}", headers=rep_auth).json()["status"] == "CLOSED"


def test_checking_out_again_picks_up_the_analysis_that_landed(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Asking again is how the figure arrives, so asking again must be safe."""
    upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps", phase="BEFORE")
    capture_id = _queue_an_unanalysed_after_capture(visit["id"])

    first = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()
    _finish_the_job(capture_id)
    second = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()

    assert second["analysisPending"] is False
    assert second["osaAfter"] == pytest.approx(0.9)
    assert second["checkedOutAt"] == first["checkedOutAt"], (
        "waiting for the analysis stretched the recorded visit duration"
    )


def test_a_visit_with_no_after_photo_is_not_reported_as_pending(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Nothing to wait for is not the same as something still coming."""
    upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps", phase="BEFORE")

    summary = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()

    assert summary["analysisPending"] is False
    assert summary["osaAfter"] is None


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


def test_result_carries_a_signed_url_for_the_photograph(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Every number a manager sees must be traceable back to the pixels.

    The overlay is drawn in the capture's own pixel space, so the image and
    its dimensions have to travel with the boxes or they cannot be aligned.
    """
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()

    assert result["imageUrl"], "no signed URL — the result screen has nothing to draw on"
    assert result["imageWidth"] > 0 and result["imageHeight"] > 0


def test_result_dimensions_are_the_space_the_boxes_live_in(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """The overlay draws boxes against imageWidth/imageHeight from this payload.

    If those describe a different image than the one the detections were
    computed against, every box lands *almost* right — the failure the
    contract's coordinate-space warning exists to prevent. The client commits
    the size it believes it uploaded; the ML service reports the size it
    actually decoded, and that is the one that has to win.
    """
    presign = client.post(
        "/v1/captures/presign",
        headers=rep_auth,
        json={"visitId": visit["id"], "category": "cat-coffee", "shelfBayLabel": "A2_gaps"},
    ).json()

    import httpx

    httpx.put(
        presign["uploadUrl"], content=b"fake-jpeg-bytes", headers={"Content-Type": "image/jpeg"}
    ).raise_for_status()

    # Deliberately wrong: half the size the mock reports for its detections.
    client.post(
        f"/v1/captures/{presign['captureId']}/commit",
        headers={**rep_auth, "Idempotency-Key": f"dims-{uuid.uuid4()}"},
        json={"imageWidth": 960, "imageHeight": 540},
    )

    result = client.get(f"/v1/captures/{presign['captureId']}/result", headers=rep_auth).json()

    boxes = [d["bbox"] for d in result["detections"]]
    assert boxes, "no detections to check"
    for box in boxes:
        assert box["x"] + box["w"] <= result["imageWidth"], "box runs off the right edge"
        assert box["y"] + box["h"] <= result["imageHeight"], "box runs off the bottom edge"


def test_replaying_a_task_close_does_not_move_its_completion_time(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """The offline queue replays PATCH /tasks/{id}. It must land once.

    `completed_at` feeds the "time from detection to restock" KPI. A task
    closed in the shop and drained an hour later would otherwise report a
    one-hour restock that never happened — and that is the number trade
    marketing argues about.
    """
    job = upload_capture(client, rep_auth, visit["id"], bay="A2_gaps")
    result = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    finding = result["gapFindings"][0]

    verified = client.post(
        f"/v1/findings/{finding['id']}/verify", headers=rep_auth, json={"verdict": "CONFIRMED"}
    ).json()
    task_id = verified["taskId"]

    first = client.patch(f"/v1/tasks/{task_id}", headers=rep_auth, json={"status": "FIXED"})
    assert first.status_code == 200
    completed_first = _completed_at(client, rep_auth, visit["id"], task_id)

    time.sleep(1.1)
    replay = client.patch(f"/v1/tasks/{task_id}", headers=rep_auth, json={"status": "FIXED"})
    assert replay.status_code == 200
    completed_again = _completed_at(client, rep_auth, visit["id"], task_id)

    assert completed_first == completed_again, (
        "replaying the same close moved completed_at, stretching time-to-restock"
    )


def _completed_at(client: TestClient, auth: dict[str, str], visit_id: str, task_id: str):
    import uuid as _uuid

    from app.db.models import TaskRow
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        return session.get(TaskRow, _uuid.UUID(task_id)).completed_at


def test_replaying_a_checkout_does_not_move_the_checkout_time(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Checkout is replayed by the offline queue too, and `checked_out_at`
    is what the manager's average visit duration is computed from."""
    first = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()
    time.sleep(1.1)
    replay = client.post(f"/v1/visits/{visit['id']}/checkout", headers=rep_auth).json()

    assert first["checkedOutAt"] == replay["checkedOutAt"], (
        "replaying checkout stretched the recorded visit duration"
    )
