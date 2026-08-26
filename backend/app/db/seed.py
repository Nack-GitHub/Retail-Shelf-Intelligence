"""Demo seed data.

Stores mirror `frontend/src/lib/mock/data.ts` exactly — same names, codes,
coordinates and photo policies — so the real API and the existing UI line up
during development and the mock layer can be swapped out screen by screen.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.mock_ml_client import MOCK_MODEL_SHA, MOCK_MODEL_VERSION
from app.core.security import hash_password
from app.db.models import ModelVersion, Store, User
from app.domain.enums import PhotoPolicy, Role, StoreFormat
from app.workers.session import SyncSessionFactory

# The trained artifact, if this machine has one. Reading the metrics file
# stands in for a promotion step that a real deployment performs from the ML
# side — the backend never imports a CV library or learns a class name, which
# is what the boundary rule actually protects.
ARTIFACT_DIR = Path(__file__).resolve().parents[3] / "model" / "artifacts" / "shelf-product-yolo26l-960"

AREA_ID = "area-bke"

USERS = [
    ("rep@shelfeye.demo", "demo1234", "สมชาย ใจดี", Role.REP),
    ("manager@shelfeye.demo", "demo1234", "ปรียา วงศ์สุข", Role.MANAGER),
    ("admin@shelfeye.demo", "demo1234", "ผู้ดูแลระบบ", Role.ADMIN),
    ("data@shelfeye.demo", "demo1234", "ทีมข้อมูล", Role.DATA),
]


# Deterministic ids so the frontend's "st-101" maps to a stable UUID.
def _store_uuid(slug: str) -> uuid.UUID:
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
    """Record the models this system has actually run.

    `mock-v1` is not a placeholder — it is what serves every demo inference,
    and a model-health screen that omitted it would be describing a model
    nobody is using. The trained model is recorded with its REAL metrics,
    gate failures included: a demo that rounded a failing recall up to a
    passing one would teach the exact habit this project exists to prevent.
    """
    if not session.execute(
        select(ModelVersion).where(ModelVersion.version == MOCK_MODEL_VERSION)
    ).scalar_one_or_none():
        session.add(
            ModelVersion(
                version=MOCK_MODEL_VERSION,
                sha=MOCK_MODEL_SHA,
                source_dataset="deterministic stand-in — no dataset",
                dataset_version="—",
                metrics=None,
                is_active=True,
                promoted_at=datetime.now(UTC),
                promoted_by="seed",
            )
        )

    metrics_file = ARTIFACT_DIR / "metrics.json"
    artifact_file = ARTIFACT_DIR / "artifact.json"
    if not metrics_file.exists():
        return

    if session.execute(
        select(ModelVersion).where(ModelVersion.version == ARTIFACT_DIR.name)
    ).scalar_one_or_none():
        return

    metrics = json.loads(metrics_file.read_text())
    sha = "unknown"
    if artifact_file.exists():
        sha = json.loads(artifact_file.read_text()).get("model_sha", "unknown")

    session.add(
        ModelVersion(
            version=ARTIFACT_DIR.name,
            sha=sha,
            source_dataset="roboflow-ngkro/shelf-product",
            dataset_version="v1",
            metrics=metrics,
            # Recorded, never promoted: it fails every gate in its own
            # metrics file, and ML_CLIENT stays on the mock because of it.
            is_active=False,
            promoted_at=None,
            promoted_by=None,
        )
    )


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
        store_id = _store_uuid(slug)
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
    with SyncSessionFactory() as session:
        seed(session)
        users = session.execute(select(User)).scalars().all()
        stores = session.execute(select(Store)).scalars().all()
        models = session.execute(select(ModelVersion)).scalars().all()
    print(f"seeded: {len(users)} users, {len(stores)} stores, {len(models)} model versions")
    print("login: rep@shelfeye.demo / demo1234")


if __name__ == "__main__":
    main()
