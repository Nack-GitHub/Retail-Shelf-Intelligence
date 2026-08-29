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
    ("rep@shelfeye.demo", "demo1234", "นายทดสอบ รอดเกือบทุกรอบ", Role.REP),
    ("manager@shelfeye.demo", "demo1234", "นายสมมุติ สุดหล่อ", Role.MANAGER),
    ("admin@shelfeye.demo", "demo1234", "ผู้ดูแลระบบ", Role.ADMIN),
    ("data@shelfeye.demo", "demo1234", "ทีมข้อมูล", Role.DATA),
]


# Deterministic ids so the frontend's "st-101" maps to a stable UUID.
def store_uuid(slug: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"shelfeye:store:{slug}")


# ⛔ Every chain here is invented. Not one is a real Thai retailer, and that is
# deliberate: this table is read alongside fabricated OSA figures — one of these
# stores is seeded at 61% shelf availability with work left undone — and a
# screenshot of "โลตัส บางกะปิ 61%" travels a great deal further than the
# caption explaining it was demo data. The districts and roads ARE real, because
# geography is not a brand and the map snippet has to land somewhere plausible.
#
# The slug is what generates the store's UUID (`store_uuid`), so renaming a
# store is safe but re-slugging one is not: `seed_history.PLAN` addresses stores
# by slug, and every seeded visit, capture and finding hangs off that id.
STORES = [
    (
        "st-101",
        "DG-1042",
        "เดลี่โก อารีย์",
        "เดลี่โก",
        StoreFormat.CVS,
        "ซ.พหลโยธิน 7 แขวงสามเสนใน เขตพญาไท",
        13.7795,
        100.5443,
        PhotoPolicy.ALLOWED,
        "09:00 – 11:00",
    ),
    (
        "st-102",
        "GL-2210",
        "กรีนเลน มาร์เก็ต ทองหล่อ",
        "กรีนเลน มาร์เก็ต",
        StoreFormat.SUPER,
        "ซ.สุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา",
        13.7368,
        100.5847,
        PhotoPolicy.ALLOWED,
        "11:00 – 13:00",
    ),
    (
        # Premium food hall inside a shopping centre. RESTRICTED is the whole
        # point of this row: mall tenancy agreements are where photo policies
        # actually come from, and it is why seed_history visits this store
        # three times in twelve weeks while others get twelve.
        "st-103",
        "SV-0788",
        "ซาวารี่ กูร์เมต์ สุขุมวิท 24",
        "ซาวารี่ กูร์เมต์",
        StoreFormat.SUPER,
        "ถ.สุขุมวิท แขวงคลองตัน เขตคลองเตย · ชั้น G ศูนย์การค้า",
        13.7305,
        100.5698,
        PhotoPolicy.RESTRICTED,
        "13:30 – 15:00",
    ),
    (
        # The worst store in the area, and the furthest out — which is most of
        # why it is the worst. A big suburban hypermarket at the end of the
        # route is the one that gets dropped when a day runs late.
        "st-104",
        "MV-3391",
        "เมกะแวลู บางกะปิ",
        "เมกะแวลู",
        StoreFormat.HYPER,
        "ถ.ลาดพร้าว แขวงคลองจั่น เขตบางกะปิ",
        13.7648,
        100.6432,
        PhotoPolicy.ALLOWED,
        "15:00 – 16:30",
    ),
    (
        "st-105",
        "DG-1119",
        "เดลี่โก พระราม 9",
        "เดลี่โก",
        StoreFormat.CVS,
        "ถ.พระราม 9 แขวงห้วยขวาง เขตห้วยขวาง",
        13.7580,
        100.5665,
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
