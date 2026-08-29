"""Store lookup.

`/routes/today` already answers "where am I going", but a manager opening one
store's page, and a rep deep-linking into a check-in screen, both need to ask
about a single store without pulling a whole route.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.seed import STORES
from tests.integration.conftest import upload_capture


def test_list_returns_the_seeded_stores(client: TestClient, rep_auth: dict[str, str]) -> None:
    response = client.get("/v1/stores", headers=rep_auth)
    assert response.status_code == 200

    stores = response.json()
    assert len(stores) >= len(STORES)
    # Read out of the seed table rather than pinned here. Hardcoding the codes
    # meant renaming a demo store — a presentation decision with no bearing on
    # behaviour — turned this suite red for the wrong reason.
    codes = {s["externalCode"] for s in stores}
    assert {external_code for _, external_code, *_ in STORES} <= codes


def test_list_is_camel_case_and_carries_risk(client: TestClient, rep_auth: dict[str, str]) -> None:
    """The frontend's `types/index.ts` is the contract; matching it exactly is
    what lets the mock layer be deleted without touching a component."""
    store = client.get("/v1/stores", headers=rep_auth).json()[0]
    for field in (
        "id",
        "externalCode",
        "storeFormat",
        "photoPolicy",
        "visitWindow",
        "riskBand",
        "riskScore",
        "lastOsa",
        "daysSinceLastVisit",
        "repeatGapSkus",
    ):
        assert field in store, f"missing {field}"

    assert store["riskBand"] in {"HIGH", "MEDIUM", "LOW"}
    assert 0.0 <= store["riskScore"] <= 1.0


def test_last_osa_says_which_photograph_it_came_from(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    """A card showing a bare percentage cannot be read honestly.

    `lastOsa` is the store's most recent analysis, whichever shelf it was and
    whichever side of a restock — so a rep who has just finished a visit can be
    looking at the before-photo's figure and read it as their result. The
    screens need to know what they are showing.
    """
    stores = client.get("/v1/stores", headers=rep_auth).json()
    store_id = stores[0]["id"]
    visit = client.post(
        "/v1/visits",
        headers=rep_auth,
        json={"storeId": store_id, "photoConsentConfirmed": True},
    ).json()
    upload_capture(client, rep_auth, visit["id"], bay="A2_gaps", category="cat-coffee")

    store = client.get(f"/v1/stores/{store_id}", headers=rep_auth).json()

    assert store["lastOsa"] is not None
    assert store["lastOsaPhase"] == "BEFORE"
    assert store["lastOsaCategory"] == "cat-coffee"
    assert store["lastOsaAt"]

    upload_capture(
        client, rep_auth, visit["id"], bay="BAY_full", phase="AFTER", category="cat-milk"
    )
    after = client.get(f"/v1/stores/{store_id}", headers=rep_auth).json()

    assert after["lastOsaPhase"] == "AFTER"
    assert after["lastOsaCategory"] == "cat-milk"
    assert after["lastOsaAt"] >= store["lastOsaAt"]
    # The LATEST reading, not the best one: a full shelf photographed after a
    # restock replaces the gappy before-shot, and MAX() would have flattened
    # every store that was ever full to 100%.
    assert after["lastOsa"] == pytest.approx(1.0)


def test_never_measured_store_has_nothing_to_describe(
    client: TestClient, rep_auth: dict[str, str], unvisited_store: str
) -> None:
    store = client.get(f"/v1/stores/{unvisited_store}", headers=rep_auth).json()

    assert store["lastOsa"] is None
    assert store["lastOsaPhase"] is None
    assert store["lastOsaCategory"] is None
    assert store["lastOsaAt"] is None


def test_the_route_describes_its_figures_too(client: TestClient, rep_auth: dict[str, str]) -> None:
    """The route list is where the confusion was reported, so it carries them."""
    stop = client.get("/v1/routes/today", headers=rep_auth).json()[0]
    for field in ("lastOsaPhase", "lastOsaCategory", "lastOsaAt"):
        assert field in stop, f"missing {field}"


def test_list_is_ordered_by_risk(client: TestClient, rep_auth: dict[str, str]) -> None:
    scores = [s["riskScore"] for s in client.get("/v1/stores", headers=rep_auth).json()]
    assert scores == sorted(scores, reverse=True)


def test_never_visited_store_reports_null_not_zero(
    client: TestClient, rep_auth: dict[str, str], unvisited_store: str
) -> None:
    """A store nobody has photographed has NO OSA. Reporting 0.0 would render
    as a catastrophically empty shelf and would poison every average built on
    it — "not measured" and "measured as empty" are different answers.

    The store is created by the fixture rather than picked out of the seed:
    every seeded store accumulates visits as the suite runs, so relying on one
    staying untouched makes this test pass or fail by run order.
    """
    store = client.get(f"/v1/stores/{unvisited_store}", headers=rep_auth).json()
    assert store["lastOsa"] is None
    assert store["daysSinceLastVisit"] is None
    assert store["repeatGapSkus"] == 0
    # Never measured is treated as urgent: the point of the visit is to find out.
    assert store["riskBand"] == "HIGH"


def test_single_store_matches_its_row_in_the_list(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    listed = client.get("/v1/stores", headers=rep_auth).json()[0]
    fetched = client.get(f"/v1/stores/{listed['id']}", headers=rep_auth).json()
    assert fetched == listed


def test_unknown_store_is_404(client: TestClient, rep_auth: dict[str, str]) -> None:
    response = client.get(f"/v1/stores/{uuid.uuid4()}", headers=rep_auth)
    assert response.status_code == 404


def test_store_responses_carry_no_user_identifier(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    """⛔ No per-individual data, on any endpoint (SPEC §10)."""
    serialised = str(client.get("/v1/stores", headers=rep_auth).json()).lower()
    for banned in ("userid", "user_id", "repname", "repid", "verifiedby"):
        assert banned not in serialised


def test_single_store_response_carries_no_user_identifier(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    listed = client.get("/v1/stores", headers=rep_auth).json()[0]
    body = str(client.get(f"/v1/stores/{listed['id']}", headers=rep_auth).json()).lower()
    for banned in ("userid", "user_id", "repname", "verifiedby"):
        assert banned not in body


def test_store_history_is_not_open_to_reps(client: TestClient, rep_auth: dict[str, str]) -> None:
    """It exposes every visit's before/after OSA for one store."""
    listed = client.get("/v1/stores", headers=rep_auth).json()[0]
    response = client.get(f"/v1/stores/{listed['id']}/history", headers=rep_auth)
    assert response.status_code == 403
