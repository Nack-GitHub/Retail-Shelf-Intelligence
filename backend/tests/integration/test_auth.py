"""Auth and role guards."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_login_returns_a_token(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/login", json={"email": "rep@shelfeye.demo", "password": "demo1234"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tokenType"] == "bearer"
    assert body["expiresIn"] == 8 * 3600


def test_wrong_password_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/login", json={"email": "rep@shelfeye.demo", "password": "wrong"}
    )
    assert response.status_code == 401


def test_unknown_email_gives_the_same_answer_as_a_wrong_password(client: TestClient) -> None:
    """Distinguishing them would let anyone enumerate valid accounts."""
    unknown = client.post(
        "/v1/auth/login", json={"email": "nobody@shelfeye.demo", "password": "demo1234"}
    )
    wrong = client.post("/v1/auth/login", json={"email": "rep@shelfeye.demo", "password": "wrong"})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_protected_route_requires_a_token(client: TestClient) -> None:
    """401, not 403: the caller is unauthenticated, not insufficiently privileged."""
    assert client.get("/v1/routes/today").status_code == 401


def test_garbage_token_is_rejected(client: TestClient) -> None:
    response = client.get("/v1/routes/today", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_me_returns_the_authenticated_user(client: TestClient, rep_auth: dict[str, str]) -> None:
    body = client.get("/v1/me", headers=rep_auth).json()
    assert body["email"] == "rep@shelfeye.demo"
    assert body["role"] == "REP"
