"""Integration fixtures.

Runs against the compose stack (postgres + redis + minio) with Celery in eager
mode, so a full check-in-to-checkout path executes inline in the test process.
No broker, no worker, no running API server needed — `make test` is one command.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest

os.environ.setdefault("ML_CLIENT", "mock")

from fastapi.testclient import TestClient  # noqa: E402

from app.adapters.storage_client import get_storage  # noqa: E402
from app.db.seed import seed  # noqa: E402
from app.workers.celery_app import celery_app  # noqa: E402
from app.workers.session import SyncSessionFactory  # noqa: E402

# Eager mode: .delay() runs the task inline and propagates exceptions.
celery_app.conf.task_always_eager = True
celery_app.conf.task_eager_propagates = False


@pytest.fixture(scope="session", autouse=True)
def _prepare_environment() -> Iterator[None]:
    with SyncSessionFactory() as session:
        seed(session)
    get_storage().ensure_bucket()
    yield


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def _token(client: TestClient, email: str) -> str:
    response = client.post("/v1/auth/login", json={"email": email, "password": "demo1234"})
    response.raise_for_status()
    return response.json()["accessToken"]


@pytest.fixture(scope="session")
def rep_auth(client: TestClient) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(client, 'rep@shelfeye.demo')}"}


@pytest.fixture(scope="session")
def manager_auth(client: TestClient) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(client, 'manager@shelfeye.demo')}"}


@pytest.fixture
def idempotency_key() -> str:
    return f"test-{uuid.uuid4()}"


@pytest.fixture
def visit(client: TestClient, rep_auth: dict[str, str]) -> dict:
    stores = client.get("/v1/routes/today", headers=rep_auth).json()
    response = client.post(
        "/v1/visits",
        headers=rep_auth,
        json={
            "storeId": stores[0]["id"],
            "gpsLat": stores[0]["lat"],
            "gpsLng": stores[0]["lng"],
            "photoConsentConfirmed": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload_capture(
    client: TestClient,
    auth: dict[str, str],
    visit_id: str,
    *,
    bay: str = "BAY-01",
    phase: str = "BEFORE",
    category: str = "coffee",
    idem: str | None = None,
) -> dict:
    """presign -> PUT -> commit. Returns the job payload.

    `bay` selects the MockMLClient scenario, because the bay label is carried
    into the object key and the mock reads its scenario from the URI.
    """
    import httpx

    presign = client.post(
        "/v1/captures/presign",
        headers=auth,
        json={"visitId": visit_id, "category": category, "shelfBayLabel": bay, "phase": phase},
    ).json()

    httpx.put(
        presign["uploadUrl"], content=b"fake-jpeg-bytes", headers={"Content-Type": "image/jpeg"}
    ).raise_for_status()

    response = client.post(
        f"/v1/captures/{presign['captureId']}/commit",
        headers={**auth, "Idempotency-Key": idem or f"test-{uuid.uuid4()}"},
        json={"imageWidth": 1920, "imageHeight": 1080, "faceBlurApplied": True, "faceBlurCount": 0},
    )
    assert response.status_code == 202, response.text
    return {**response.json(), "captureId": presign["captureId"], "objectKey": presign["objectKey"]}


@pytest.fixture
def unvisited_store() -> Iterator[str]:
    """A store with no history at all.

    Seeded stores accumulate visits as the suite runs, so a test about the
    "never measured" case has to bring its own store or it will pass on a
    fresh database and fail on a used one.
    """
    from app.db.models import Store

    store_id = uuid.uuid4()
    with SyncSessionFactory() as session:
        session.add(
            Store(
                id=store_id,
                external_code=f"TEST-{store_id.hex[:8]}",
                name="ร้านทดสอบ ยังไม่เคยเข้า",
                chain="ทดสอบ",
                store_format="CVS",
                area_id="area-bke",
                address="ไม่มีที่อยู่จริง",
                lat=13.7563,
                lng=100.5018,
            )
        )
        session.commit()

    yield str(store_id)

    with SyncSessionFactory() as session:
        session.delete(session.get(Store, store_id))
        session.commit()


@pytest.fixture
def measured_store(client: TestClient, rep_auth: dict[str, str]) -> str:
    """A store with at least one analysed capture, arranged by this fixture.

    Tests that assert on aggregate analytics need an analysis to exist. Relying
    on one left behind by an alphabetically-earlier test file makes them pass
    on a used database and fail on a fresh one — the same order-dependence the
    `unvisited_store` fixture exists to avoid, in the other direction.
    """
    stores = client.get("/v1/stores", headers=rep_auth).json()
    store_id = stores[0]["id"]
    visit = client.post(
        "/v1/visits",
        headers=rep_auth,
        json={"storeId": store_id, "photoConsentConfirmed": True},
    ).json()
    upload_capture(client, rep_auth, visit["id"], bay="A2_gaps", category="cat-coffee")
    return store_id
