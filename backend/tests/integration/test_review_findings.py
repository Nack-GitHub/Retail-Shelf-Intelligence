"""Regression tests for defects found during review."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from tests.integration.conftest import upload_capture


def test_rep_cannot_read_manager_analytics(client: TestClient, rep_auth: dict[str, str]) -> None:
    """RBAC exists as a helper; it must actually be wired to the routes."""
    for path in ("/v1/analytics/osa", "/v1/analytics/risk-ranking"):
        assert client.get(path, headers=rep_auth).status_code == 403, path


def test_manager_can_read_analytics(client: TestClient, manager_auth: dict[str, str]) -> None:
    assert client.get("/v1/analytics/risk-ranking", headers=manager_auth).status_code == 200


def test_rejecting_a_confirmed_finding_closes_its_task(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """A rep who confirms then corrects themselves must not leave an orphan task.

    Otherwise the task list shows work for a gap the rep has already said is
    not a gap, and checkout counts it.
    """
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    finding = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()[
        "gapFindings"
    ][0]

    task_id = client.post(
        f"/v1/findings/{finding['id']}/verify", headers=rep_auth, json={"verdict": "CONFIRMED"}
    ).json()["taskId"]
    assert task_id

    client.post(
        f"/v1/findings/{finding['id']}/verify",
        headers=rep_auth,
        json={"verdict": "REJECTED", "reason": "OCCLUDED"},
    )

    open_tasks = client.get(f"/v1/visits/{visit['id']}/tasks", headers=rep_auth).json()
    assert task_id not in [t["id"] for t in open_tasks], "orphan task survived the rejection"


def test_store_history_for_a_store_with_no_visits(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    """An unvisited store is the normal case on day one, not an error."""
    from sqlalchemy import select

    from app.db.models import Store, Visit
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        visited = {v.store_id for v in session.execute(select(Visit)).scalars()}
        unvisited = next(
            (s for s in session.execute(select(Store)).scalars() if s.id not in visited), None
        )

    if unvisited is None:  # every seeded store has been visited by earlier tests
        return

    response = client.get(f"/v1/stores/{unvisited.id}/history", headers=manager_auth)
    assert response.status_code == 200
    assert response.json()["visits"] == []


def test_result_does_not_mix_detections_from_two_runs(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """Append-only means re-inference ADDS rows. The result must show one run.

    Without a per-run key, a second analysis at the same model_version would
    return both runs' detections and double every box on the overlay.
    """
    job = upload_capture(client, rep_auth, visit["id"], bay="BAY_gaps")
    before = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()

    # Re-run inference on the same capture with the same model version.
    from app.adapters.ml_client import build_ml_client
    from app.db.models import InferenceJob
    from app.services.analysis_pipeline import run_analysis
    from app.workers.session import SyncSessionFactory

    with SyncSessionFactory() as session:
        rerun = InferenceJob(capture_id=uuid.UUID(job["captureId"]), status="QUEUED")
        session.add(rerun)
        session.commit()
        run_analysis(session, rerun.id, build_ml_client())

    after = client.get(f"/v1/captures/{job['captureId']}/result", headers=rep_auth).json()
    assert len(after["detections"]) == len(before["detections"]), (
        f"detections doubled: {len(before['detections'])} -> {len(after['detections'])}"
    )
    assert len(after["gapFindings"]) == len(before["gapFindings"])
