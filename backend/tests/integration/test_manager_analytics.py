"""The manager dashboard's numbers.

⛔ Every assertion here doubles as a prohibition check: a KPI that could be
computed per rep is exactly the kind of thing that gets added by accident.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_kpis_are_manager_only(client: TestClient, rep_auth: dict[str, str]) -> None:
    assert client.get("/v1/analytics/kpis", headers=rep_auth).status_code == 403


def test_kpis_return_only_what_the_database_can_answer(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    """No card is invented.

    "ต้นทุนต่อการตรวจ" has no cost data behind it anywhere in this system, so
    it is absent rather than estimated. A dashboard that mixes measured and
    invented numbers teaches its readers to trust neither.
    """
    payload = client.get("/v1/analytics/kpis", headers=manager_auth).json()
    ids = {k["id"] for k in payload["kpis"]}

    assert "osa" in ids
    assert "visits" in ids
    assert "cost" not in ids, "cost has no backing data and must not be reported"

    for kpi in payload["kpis"]:
        assert set(kpi) >= {"id", "label", "value", "unit"}
        assert kpi["value"] is not None


def test_kpis_carry_no_user_identifier(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
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


def test_route_plan_is_ordered_by_risk(
    client: TestClient, manager_auth: dict[str, str]
) -> None:
    rows = client.get("/v1/analytics/route-plan", headers=manager_auth).json()["stops"]
    assert rows
    assert [r["riskScore"] for r in rows] == sorted(
        [r["riskScore"] for r in rows], reverse=True
    )


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
