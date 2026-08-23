"""The manager dashboard's numbers.

⛔ Every assertion here doubles as a prohibition check: a KPI that could be
computed per rep is exactly the kind of thing that gets added by accident.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_kpis_are_manager_only(client: TestClient, rep_auth: dict[str, str]) -> None:
    assert client.get("/v1/analytics/kpis", headers=rep_auth).status_code == 403


def test_kpis_return_only_what_the_database_can_answer(
    client: TestClient, manager_auth: dict[str, str], measured_store: str
) -> None:
    """No card is invented.

    "ต้นทุนต่อการตรวจ" has no cost data behind it anywhere in this system, so
    it is absent rather than estimated. A dashboard that mixes measured and
    invented numbers teaches its readers to trust neither.
    """
    payload = client.get("/v1/analytics/kpis", headers=manager_auth).json()
    ids = {k["id"] for k in payload["kpis"]}

    # `measured_store` guarantees an analysis exists, so the osa card is the
    # fixture's doing rather than a leftover from whichever test ran first.
    assert "osa" in ids
    assert "visits" in ids
    assert "cost" not in ids, "cost has no backing data and must not be reported"

    for kpi in payload["kpis"]:
        assert set(kpi) >= {"id", "label", "value", "unit"}
        assert kpi["value"] is not None


def test_kpis_carry_no_user_identifier(client: TestClient, manager_auth: dict[str, str]) -> None:
    body = str(client.get("/v1/analytics/kpis", headers=manager_auth).json()).lower()
    for banned in ("userid", "user_id", "repname", "repid", "perrep", "leaderboard"):
        assert banned not in body


def test_areas_lists_what_stores_actually_belong_to(
    client: TestClient, rep_auth: dict[str, str]
) -> None:
    areas = client.get("/v1/areas", headers=rep_auth).json()
    assert areas, "no areas"
    assert {"id", "name", "storeCount"} == set(areas[0])
    assert any(a["id"] == "area-bke" for a in areas)
    assert all(a["storeCount"] > 0 for a in areas), "an area with no stores is not an area"


def test_route_plan_is_ordered_by_risk(client: TestClient, manager_auth: dict[str, str]) -> None:
    rows = client.get("/v1/analytics/route-plan", headers=manager_auth).json()["stops"]
    assert rows
    assert [r["riskScore"] for r in rows] == sorted([r["riskScore"] for r in rows], reverse=True)


def test_route_plan_reports_null_rather_than_a_guessed_duration(
    client: TestClient, manager_auth: dict[str, str], unvisited_store: str
) -> None:
    """`avgVisitMinutes` is measured from closed visits. A store nobody has
    visited has no average, and inventing one would put a fabricated number
    next to measured ones with nothing to distinguish them."""
    rows = client.get("/v1/analytics/route-plan", headers=manager_auth).json()["stops"]
    fresh = next(r for r in rows if r["storeId"] == unvisited_store)
    assert fresh["avgVisitMinutes"] is None


def test_route_plan_carries_no_user_identifier(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    body = str(client.get("/v1/analytics/route-plan", headers=manager_auth).json()).lower()
    for banned in ("userid", "user_id", "repname", "repid"):
        assert banned not in body


def test_store_history_carries_the_captures_behind_each_visit(
    client: TestClient, manager_auth: dict[str, str], rep_auth: dict[str, str], visit: dict
) -> None:
    """A number a manager cannot open back to the photograph is a claim, not
    evidence. Each visit row carries the captures it produced."""
    from tests.integration.conftest import upload_capture

    upload_capture(client, rep_auth, visit["id"], bay="A2_gaps", category="cat-coffee")

    history = client.get(f"/v1/stores/{visit['storeId']}/history", headers=manager_auth).json()
    row = next(v for v in history["visits"] if v["visitId"] == visit["id"])

    assert row["captures"], "no captures on the visit that produced the score"
    capture = row["captures"][0]
    assert set(capture) == {
        "captureId",
        "category",
        "shelfBayLabel",
        "phase",
        "capturedAt",
        "osaScore",
        "modelVersion",
    }
    assert row["gapsFound"] > 0


def test_store_history_carries_no_user_identifier(
    client: TestClient, manager_auth: dict[str, str], visit: dict
) -> None:
    """⛔ Who visited the store is not part of what a manager reviews."""
    body = str(
        client.get(f"/v1/stores/{visit['storeId']}/history", headers=manager_auth).json()
    ).lower()
    for banned in ("userid", "user_id", "repname", "capturedby", "verifiedby"):
        assert banned not in body


def test_visits_kpi_counts_stores_not_visits(
    client: TestClient, rep_auth: dict[str, str], manager_auth: dict[str, str]
) -> None:
    """The card is labelled "ร้านที่ตรวจ" and its unit is "ร้าน", so it has to
    count STORES. Counting visit rows made an area of 5 stores report 483,
    which a manager reads as coverage and acts on.
    """
    before = next(
        k
        for k in client.get("/v1/analytics/kpis?days=1", headers=manager_auth).json()["kpis"]
        if k["id"] == "visits"
    )["value"]

    stores = client.get("/v1/stores", headers=rep_auth).json()
    store_id = stores[0]["id"]

    # Three separate visits to ONE store.
    for _ in range(3):
        response = client.post(
            "/v1/visits",
            headers=rep_auth,
            json={"storeId": store_id, "photoConsentConfirmed": True},
        )
        assert response.status_code == 201

    after = next(
        k
        for k in client.get("/v1/analytics/kpis?days=1", headers=manager_auth).json()["kpis"]
        if k["id"] == "visits"
    )["value"]

    # Asserting on the DELTA, not the total. `value <= len(stores)` passed on a
    # fresh database even with the bug present — 3 visits reads as 3, and
    # 3 <= 5 — so the test could not catch its own regression.
    assert after - before <= 1, (
        f"three visits to one store moved the store count by {after - before}; "
        "it counts visits, not stores"
    )
