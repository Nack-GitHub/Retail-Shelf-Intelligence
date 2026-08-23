"""Store lookup.

`/routes/today` already answers "where am I going", but a manager opening one
store's page, and a rep deep-linking into a check-in screen, both need to ask
about a single store without pulling a whole route.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def test_list_returns_the_seeded_stores(client: TestClient, rep_auth: dict[str, str]) -> None:
    response = client.get("/v1/stores", headers=rep_auth)
    assert response.status_code == 200

    stores = response.json()
    assert len(stores) >= 5
    codes = {s["externalCode"] for s in stores}
    assert {"QS-1042", "FM-2210", "MB-0788", "TD-3391", "QS-1119"} <= codes


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
