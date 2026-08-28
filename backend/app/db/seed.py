"""Demo seed data.

⛔ These accounts share one password and it is written in this file, which is
in the repository. Seeding them into an environment that holds anyone's real
data hands out four logins, one of them ADMIN. `main()` refuses to run outside
`local` / `ci` / `demo` for that reason — UAT and production create their own
accounts.

The stores mirror the fixtures the front-end was first built against, so the
API and the screens line up during development.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.mock_ml_client import MOCK_MODEL_SHA, MOCK_MODEL_VERSION
from app.core.config import DISPOSABLE_ENVIRONMENTS, settings
from app.core.security import hash_password
from app.db.models import ModelVersion, Store, User
from app.domain.enums import PhotoPolicy, Role, StoreFormat
from app.workers.session import SyncSessionFactory

# The trained artifact, if this machine has one. Reading the metrics file
# stands in for a promotion step that a real deployment performs from the ML
# side — the backend never imports a CV library or learns a class name, which
# is what the boundary rule actually protects.
ARTIFACT_DIR = (
    Path(__file__).resolve().parents[3] / "model" / "artifacts" / "shelf-product-yolo26l-960"
)

AREA_ID = "area-bke"

USERS = [
    ("rep@shelfeye.demo", "demo1234", "สมชาย ใจดี", Role.REP),
    ("manager@shelfeye.demo", "demo1234", "ปรียา วงศ์สุข", Role.MANAGER),
    ("admin@shelfeye.demo", "demo1234", "ผู้ดูแลระบบ", Role.ADMIN),
    ("data@shelfeye.demo", "demo1234", "ทีมข้อมูล", Role.DATA),
]


# Deterministic ids so the frontend's "st-101" maps to a stable UUID.
def store_uuid(slug: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"shelfeye:store:{slug}")


STORES = [
    (
        "st-101",
        "QS-1042",
        "ควิกช้อป อ่อนนุช 17",
        "ควิกช้อป",
        StoreFormat.CVS,
        "ถ.สุขุมวิท 77 แขวงสวนหลวง",
        13.7051,
        100.6012,
        PhotoPolicy.ALLOWED,
        "09:00 – 11:00",
    ),
    (
        "st-102",
        "FM-2210",
        "เฟรชมาร์ท ทองหล่อ 25",
        "เฟรชมาร์ท",
        StoreFormat.SUPER,
        "ซ.ทองหล่อ 25 แขวงคลองตันเหนือ",
        13.7368,
        100.5847,
        PhotoPolicy.ALLOWED,
        "11:00 – 13:00",
    ),
    (
        "st-103",
        "MB-0788",
        "มินิบิ๊ก พระราม 9 ซอย 41",
        "มินิบิ๊ก",
        StoreFormat.CVS,
        "ถ.พระราม 9 แขวงสวนหลวง",
        13.7539,
        100.6221,
        PhotoPolicy.RESTRICTED,
        "13:30 – 15:00",
    ),
    (
        "st-104",
        "TD-3391",
        "ร้านลุงสมชาย ซอยรามคำแหง 24",
        "ร้านค้าดั้งเดิม",
        StoreFormat.TRAD,
        "ซ.รามคำแหง 24 แขวงหัวหมาก",
        13.7644,
        100.6293,
        PhotoPolicy.ALLOWED,
        "15:00 – 16:30",
    ),
    (
        "st-105",
        "QS-1119",
        "ควิกช้อป ศรีนครินทร์ 42",
        "ควิกช้อป",
        StoreFormat.CVS,
        "ถ.ศรีนครินทร์ แขวงหนองบอน",
        13.6889,
        100.6455,
        PhotoPolicy.ALLOWED,
        "16:30 – 18:00",
    ),
]


def _seed_model_versions(session: Session) -> None:
    """Record the models this system has run, and mark the one serving traffic.

    Which version is active is not a seed-time preference — it follows
    `ML_CLIENT`, because that env var is what actually decides where an
    inference request goes. Hardcoding `mock-v1` as active while the service
    is configured to call the real one made the model-health screen report a
    model nobody was using, on the screen whose entire job is to say which
    model produced the numbers.

    The trained model is recorded with its REAL metrics, gate failures
    included. It is promoted despite failing two of its three gates, which was
    a deliberate call: UAT needs a model that looks at pixels more than it
    needs a model that passes. Rounding a failing recall up to a passing one
    would teach the exact habit this project exists to prevent, so the numbers
    stay as measured and the screen keeps warning about them.
    """
    serving_mock = settings.ml_client == "mock"

    mock = session.execute(
        select(ModelVersion).where(ModelVersion.version == MOCK_MODEL_VERSION)
    ).scalar_one_or_none()
    if mock is None:
        mock = ModelVersion(
            version=MOCK_MODEL_VERSION,
            sha=MOCK_MODEL_SHA,
            source_dataset="deterministic stand-in — no dataset",
            dataset_version="—",
            metrics=None,
        )
        session.add(mock)
    mock.is_active = serving_mock
    mock.promoted_at = datetime.now(UTC) if serving_mock else None
    mock.promoted_by = "seed (ML_CLIENT=mock)" if serving_mock else None

    metrics_file = ARTIFACT_DIR / "metrics.json"
    artifact_file = ARTIFACT_DIR / "artifact.json"
    if not metrics_file.exists():
        if not serving_mock:
            print(
                f"⚠️  ML_CLIENT={settings.ml_client} but no artifact at {ARTIFACT_DIR} — "
                "no model version is marked active"
            )
        return

    metrics = json.loads(metrics_file.read_text())
    sha = "unknown"
    if artifact_file.exists():
        sha = json.loads(artifact_file.read_text()).get("model_sha", "unknown")

    trained = session.execute(
        select(ModelVersion).where(ModelVersion.version == ARTIFACT_DIR.name)
    ).scalar_one_or_none()
    if trained is None:
        trained = ModelVersion(
            version=ARTIFACT_DIR.name,
            sha=sha,
            source_dataset="roboflow-ngkro/shelf-product",
            dataset_version="v1",
            metrics=metrics,
        )
        session.add(trained)
    trained.is_active = not serving_mock
    trained.promoted_at = None if serving_mock else datetime.now(UTC)
    trained.promoted_by = None if serving_mock else "seed (ML_CLIENT=http, gates failed)"


def seed(session: Session) -> None:
    for email, password, name, role in USERS:
        if session.execute(select(User).where(User.email == email)).scalar_one_or_none():
            continue
        session.add(
            User(
                email=email,
                hashed_password=hash_password(password),
                full_name=name,
                role=role.value,
                area_id=AREA_ID,
            )
        )

    for slug, code, name, chain, fmt, address, lat, lng, policy, window in STORES:
        store_id = store_uuid(slug)
        if session.get(Store, store_id):
            continue
        session.add(
            Store(
                id=store_id,
                external_code=code,
                name=name,
                chain=chain,
                store_format=fmt.value,
                area_id=AREA_ID,
                address=address,
                lat=lat,
                lng=lng,
                photo_policy=policy.value,
                visit_window=window,
            )
        )

    _seed_model_versions(session)

    session.commit()


def main() -> None:
    if settings.environment not in DISPOSABLE_ENVIRONMENTS:
        raise SystemExit(
            f"refusing to seed demo accounts into ENVIRONMENT={settings.environment}. "
            "These four logins share the password written in this file, and one of "
            "them is ADMIN. Create real accounts instead."
        )
    with SyncSessionFactory() as session:
        seed(session)
        users = session.execute(select(User)).scalars().all()
        stores = session.execute(select(Store)).scalars().all()
        models = session.execute(select(ModelVersion)).scalars().all()
    print(f"seeded: {len(users)} users, {len(stores)} stores, {len(models)} model versions")
    print("login: rep@shelfeye.demo / demo1234  (demo accounts — never outside local/ci/demo)")


if __name__ == "__main__":
    main()
