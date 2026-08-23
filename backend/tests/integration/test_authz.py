"""Ownership and input-bound checks."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_sync_batch_rejects_an_unbounded_operation_list(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    """An offline queue drain is attacker-controlled in size. Cap it."""
    payload = {
        "operations": [
            {"idempotencyKey": f"flood-{i}", "kind": "TASK", "payload": {}} for i in range(5000)
        ]
    }
    assert client.post("/v1/sync/batch", headers=rep_auth, json=payload).status_code == 422


def test_presign_rejects_a_non_image_content_type(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """A presigned PUT is a write grant. Do not hand one out for arbitrary types."""
    response = client.post(
        "/v1/captures/presign",
        headers=rep_auth,
        json={
            "visitId": visit["id"],
            "category": "coffee",
            "shelfBayLabel": "BAY-01",
            "phase": "BEFORE",
            "contentType": "text/html",
        },
    )
    assert response.status_code == 422


def test_presign_rejects_an_unknown_phase(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    response = client.post(
        "/v1/captures/presign",
        headers=rep_auth,
        json={
            "visitId": visit["id"],
            "category": "coffee",
            "shelfBayLabel": "BAY-01",
            "phase": "SIDEWAYS",
        },
    )
    assert response.status_code == 422


def test_bay_label_cannot_inject_a_path_into_the_object_key(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """The label is caller-supplied and lands in the storage key."""
    response = client.post(
        "/v1/captures/presign",
        headers=rep_auth,
        json={
            "visitId": visit["id"],
            "category": "coffee",
            "shelfBayLabel": "../../../etc/passwd",
            "phase": "BEFORE",
        },
    )
    assert response.status_code in (200, 422)
    if response.status_code == 200:
        key = response.json()["objectKey"]
        assert ".." not in key, f"path traversal survived into the object key: {key}"


def test_a_rep_cannot_presign_into_another_users_visit(
    client: TestClient, rep_auth: dict[str, str], manager_auth: dict[str, str]
) -> None:
    """⛔ "Authenticated" is not "authorised".

    Without this check any account could attach a capture — and the OSA score
    and gap findings derived from it — to somebody else's visit at a store
    they had never entered, and that fabricated work would flow into the
    store's risk score and the area's analytics under another person's name.
    """
    stores = client.get("/v1/stores", headers=manager_auth).json()
    foreign = client.post(
        "/v1/visits",
        headers=manager_auth,
        json={"storeId": stores[0]["id"], "photoConsentConfirmed": True},
    ).json()

    response = client.post(
        "/v1/captures/presign",
        headers=rep_auth,
        json={"visitId": foreign["id"], "category": "cat-coffee", "shelfBayLabel": "A1"},
    )
    assert response.status_code == 403, response.text
