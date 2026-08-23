"""The shelf catalogue a rep picks from before opening the camera."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.integration.conftest import upload_capture


def test_returns_the_categories_a_rep_can_photograph(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    response = client.get(f"/v1/categories?storeId={visit['storeId']}", headers=rep_auth)
    assert response.status_code == 200

    categories = response.json()
    assert len(categories) >= 5
    for category in categories:
        assert set(category) == {"id", "name", "bays", "skuCount", "lastOsa"}
        assert category["bays"], "a category with no bay cannot be photographed"
        assert category["skuCount"] > 0


def test_store_id_is_required(client: TestClient, rep_auth: dict[str, str]) -> None:
    """`lastOsa` is per store. Serving the catalogue without one would report
    another store's shelf health against the shelf in front of the rep."""
    assert client.get("/v1/categories", headers=rep_auth).status_code == 422


def test_never_photographed_category_reports_null(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    categories = client.get(f"/v1/categories?storeId={visit['storeId']}", headers=rep_auth).json()
    instant = next(c for c in categories if c["id"] == "cat-instant")
    assert instant["lastOsa"] is None


def test_last_osa_reflects_a_real_analysis(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """The number on the category card is the score the model actually
    produced for this store's shelf, not an average of somewhere else."""
    upload_capture(client, rep_auth, visit["id"], bay="A2_gaps", category="cat-coffee")

    categories = client.get(f"/v1/categories?storeId={visit['storeId']}", headers=rep_auth).json()
    coffee = next(c for c in categories if c["id"] == "cat-coffee")

    assert coffee["lastOsa"] is not None
    assert 0.0 <= coffee["lastOsa"] <= 1.0


def test_catalog_carries_no_user_identifier(
    client: TestClient, rep_auth: dict[str, str], visit: dict
) -> None:
    """⛔ No per-individual data, on any endpoint (SPEC §10)."""
    body = str(
        client.get(f"/v1/categories?storeId={visit['storeId']}", headers=rep_auth).json()
    ).lower()
    for banned in ("userid", "user_id", "repname", "capturedby", "verifiedby"):
        assert banned not in body
