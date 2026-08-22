# SPEC: ShelfEye — Backend API + ML Model

> Source requirements: [backend.md](backend.md) (prompts C1, B1–B5, B7.1, M1, M3) · [ui.md](ui.md) (screen inventory, guardrails)
> Dataset: `model/shelf-product.v1i.yolov11.zip` — [roboflow-ngkro/shelf-product v1](https://universe.roboflow.com/roboflow-ngkro/shelf-product/dataset/1)
> Status: **DRAFT — awaiting approval** · Created 2026-08-22

---

## 1. Objective

Build the two server-side halves of ShelfEye, a shelf on-shelf-availability (OSA) system where a field rep photographs a retail shelf and gets a gap analysis back **while still standing in front of the shelf**.

| Service | Directory | Owns |
| :-- | :-- | :-- |
| `shelfeye-api` | `backend/` | Auth, visits, captures, jobs, OSA business rules, storage, analytics |
| `shelfeye-ml` | `model/` | Training pipeline, model artifact + class map, ONNX inference server |
| `shelfeye-contracts` | `contracts/` | The single coupling point — OpenAPI 3.1 spec + Pydantic models |

**Users.** Field rep (mobile web, Thai UI, one-handed, poor in-store connectivity) · Area manager (web dashboard) · Data/ML team (model health, relabel queue).

**What success looks like.** The existing Next.js app in `frontend/` drops `lib/mock/*` for real HTTP calls **without touching a single component**, and switching from the mock ML service to the real one is a **one-line env var change** (`ML_CLIENT=mock` → `http`).

### 1.1 Scope of this spec — Sprint 1–3

**In scope**

- C1 — Inference contract, Pydantic package, mock server
- B1 — Backend scaffolding, layered architecture, config, structured logging
- B2 — PostgreSQL schema + Alembic migrations
- B3 — Core REST API (rep endpoints + manager read endpoints), JWT + RBAC
- B4 — Celery async inference pipeline with retries, circuit breaker, DLQ
- B5 — `services/shelf_analysis.py` — pure OSA rules engine
- B7.1 — `MockMLClient` with deterministic fixture scenarios
- M1 — Reproducible YOLO11 training pipeline + `class_map.yaml` + model card
- M3 — FastAPI/ONNX Runtime inference service implementing the contract
- **Trained baseline weights** produced by an actual training run on this dataset

**Explicitly out of scope (deferred, not cancelled)**

| Deferred | Reason |
| :-- | :-- |
| B6 — retention job, blur-verification sampler, evidence PDF export, audit hardening | PDPA deferred by decision (see §8.1) |
| B7.2–7.4 — schemathesis contract tests, testcontainers E2E, locust load test | Sprint 4 |
| M2 — automated promotion gate in CI, slice evaluation | Sprint 4 — *but the eval script and its thresholds are written now, run manually* |
| M4 — active-learning feedback loop, drift monitoring | Sprint 5 |
| `POST /v1/findings/{id}/dispute`, `GET /v1/evidence/{id}/export` | Sprint 5 |

---

## 2. Tech Stack

### backend/ — `shelfeye-api`

```
Python 3.12          FastAPI 0.115+ / Uvicorn (standard)
PostgreSQL 16        SQLAlchemy 2.x async + asyncpg + Alembic
Redis 7              Celery 5.4 (two queues: high / low)
MinIO                boto3 (S3-compatible, presigned PUT/GET)
pydantic 2.9         pydantic-settings for all config
structlog            JSON logs, request_id propagated end-to-end
pyjwt + passlib      HS256 access (15m) + refresh (7d) tokens
pytest + pytest-asyncio + httpx
```

> **Hard constraint:** `backend/requirements.txt` must contain **no** `torch`, `ultralytics`, `opencv`, `tensorflow`, `numpy`-for-CV. A CI grep enforces this (§6.4).

### model/ — `shelfeye-ml`

```
Python 3.12          ultralytics 8.3.x, torch 2.x (MPS on Apple Silicon)
onnx + onnxruntime   opset 17 export, CPU EP locally
FastAPI + Uvicorn    thin serving layer, no business logic
Pillow + numpy       image I/O and letterbox pre-processing
PyYAML               class_map.yaml, data.yaml
mlflow (local file store)  experiment tracking, optional
pytest
```

### contracts/ — `shelfeye-contracts`

```
pydantic 2.9         installable via `pip install -e ./contracts` by BOTH services
OpenAPI 3.1          contracts/inference-v1.yaml is the normative artifact
```

### Infrastructure

`docker-compose.yml` with services: `api`, `worker`, `beat`, `postgres`, `redis`, `minio`, `minio-init`, `ml` (real) / `mock-ml` (profile-switched).

---

## 3. Commands

```bash
# ── Bootstrap ────────────────────────────────────────────────
make setup                  # venvs, pip install -e ./contracts in both, .env from .env.example
make dataset                # unzip model/shelf-product.v1i.yolov11.zip -> model/data/ (idempotent)

# ── Local stack ──────────────────────────────────────────────
docker compose up -d postgres redis minio
docker compose --profile mock up -d          # api + worker + mock-ml   (no ML deps)
docker compose --profile real up -d          # api + worker + real ml service
docker compose logs -f api worker

# ── Backend ──────────────────────────────────────────────────
cd backend
uvicorn app.main:app --reload --port 8000
celery -A app.workers.celery_app worker -Q high,low -c 4 --loglevel=info
celery -A app.workers.celery_app beat --loglevel=info
alembic revision --autogenerate -m "message"
alembic upgrade head
pytest -q --cov=app --cov-report=term-missing
ruff check app tests --fix && ruff format app tests
mypy app --strict

# ── ML ───────────────────────────────────────────────────────
cd model
python -m shelfeye_ml.training.train --config configs/yolo11n-960.yaml
python -m shelfeye_ml.training.train --config configs/smoke.yaml     # 2 epochs, imgsz 320
python -m shelfeye_ml.eval.evaluate --weights artifacts/<run>/best.pt --split test
python -m shelfeye_ml.training.export_onnx --weights artifacts/<run>/best.pt --opset 17
uvicorn shelfeye_ml.serving.app:app --port 9000
pytest -q

# ── Contract ─────────────────────────────────────────────────
make contract-lint          # openapi-spec-validator on contracts/inference-v1.yaml
make contract-check         # asserts Pydantic models match the YAML schema
```

---

## 4. Project Structure

```
Retail-Shelf-Intelligence/
├── SPEC.md
├── Makefile
├── docker-compose.yml
│
├── contracts/                          # ⚠️ the ONLY coupling point
│   ├── inference-v1.yaml               # OpenAPI 3.1 — normative
│   ├── pyproject.toml
│   └── shelfeye_contracts/
│       ├── __init__.py
│       ├── inference.py                # InferRequest, InferResponse, Detection, BBox
│       ├── enums.py                    # SemanticType, InferErrorCode
│       └── errors.py
│
├── backend/                            # REPO A — shelfeye-api
│   ├── app/
│   │   ├── main.py
│   │   ├── api/v1/                     # HTTP only — no business logic
│   │   │   ├── deps.py                 # auth, db session, current_user
│   │   │   ├── auth.py  routes.py  visits.py  captures.py
│   │   │   ├── jobs.py  findings.py  tasks.py  sync.py  analytics.py
│   │   ├── services/                   # pure business logic, no FastAPI imports
│   │   │   ├── shelf_analysis.py       # ⭐ B5 — zero I/O, zero framework
│   │   │   ├── visit_service.py  capture_service.py
│   │   │   ├── finding_service.py  task_service.py  analytics_service.py
│   │   ├── domain/                     # entities, value objects, enums
│   │   ├── repositories/               # one per aggregate
│   │   ├── adapters/
│   │   │   ├── ml_client.py            # ⭐ ONLY file that knows ML exists
│   │   │   ├── mock_ml_client.py       # deterministic, seeded by image_uri
│   │   │   └── storage_client.py       # MinIO/S3 presign
│   │   ├── workers/
│   │   │   ├── celery_app.py  analyze.py  dlq.py
│   │   ├── core/
│   │   │   ├── config.py               # pydantic-settings; NO literal thresholds elsewhere
│   │   │   ├── security.py  logging.py  exceptions.py  circuit_breaker.py
│   │   └── db/                         # engine, session, base
│   ├── alembic/versions/
│   ├── tests/
│   │   ├── unit/                       # shelf_analysis, services — no DB
│   │   ├── integration/                # API + DB via docker compose
│   │   └── fixtures/                   # detection JSON fixtures for B5
│   ├── requirements.txt                # ⛔ no torch / ultralytics / opencv
│   ├── .env.example
│   └── Dockerfile
│
└── model/                              # REPO B — shelfeye-ml
    ├── shelf-product.v1i.yolov11.zip   # source dataset (committed, 108MB)
    ├── data/                           # 🚫 gitignored — extracted from the zip
    │   ├── data.yaml  train/  valid/  test/
    ├── shelfeye_ml/
    │   ├── training/
    │   │   ├── train.py  dataset.py  augment.py  export_onnx.py
    │   ├── eval/
    │   │   ├── evaluate.py             # per-class metrics + M2 gate thresholds
    │   │   └── slices.py               # bright/dim, angled, dense/sparse, top/bottom
    │   ├── serving/
    │   │   ├── app.py                  # implements contracts/inference-v1.yaml
    │   │   ├── engine.py               # ONNX Runtime session, warm-up, batching
    │   │   ├── preprocess.py  postprocess.py
    │   │   └── registry.py             # keeps last 3 promoted versions loadable
    │   └── artifact/
    │       └── class_map.py            # loads class_map.yaml FROM the artifact
    ├── configs/
    │   ├── yolo11n-960.yaml  yolo11s-960.yaml  smoke.yaml
    ├── artifacts/                      # 🚫 gitignored — weights, onnx, model_card.md
    │   └── <run_id>/{best.pt,best.onnx,class_map.yaml,model_card.md,metrics.json}
    ├── tests/
    ├── requirements.txt
    └── Dockerfile
```

---

## 5. The Inference Contract (C1)

**`POST /internal/v1/infer`** — snake_case, absolute pixel coordinates, top-left origin.

```jsonc
// request
{ "image_uri": "s3://shelfeye-raw/2026/08/22/cap_01J8X.jpg",
  "request_id": "uuid",
  "model_version": "shelf-product-v1" }        // optional; omit = active model

// 200
{ "request_id": "uuid", "model_version": "shelf-product-v1", "model_sha": "a1b2c3d4",
  "inference_ms": 340, "image_width": 1920, "image_height": 1080,
  "detections": [
    { "detection_id": "uuid", "class_id": 19, "class_name": "Empty Shelf",
      "semantic_type": "GAP",
      "bbox": { "x": 120, "y": 340, "w": 88, "h": 210 },   // ABSOLUTE PIXELS
      "confidence": 0.87 } ] }
```

`422` image unreadable / no shelf structure · `503` model not loaded or warming.
Also: `GET /internal/v1/models`, `/healthz`, `/readyz`.

### 5.1 Two rules that must never be broken

1. **`semantic_type` is the only field the backend may branch on.** The backend must never see or test a raw `class_name` such as `"Empty Shelf"` or `"FM Bohne"`. The 45 class names change on every retrain; `SemanticType` does not.
   *(เหตุผล: ชื่อคลาสเปลี่ยนทุกครั้งที่เทรนใหม่ — ถ้า backend hardcode ไว้ ต้อง deploy ใหม่ทุกรอบ)*
2. **Bounding boxes are absolute pixels, never normalized, never YOLO `cx,cy,w,h`.** The ML service converts before responding. This is the single most common integration bug in this class of system, and it is documented in the OpenAPI description of every bbox field.

### 5.2 Class map — shipped inside the model artifact

`class_map.yaml` lives in the artifact directory, not in code, not in the backend:

| class_id | class_name | semantic_type |
| --: | :-- | :-- |
| 19 | `Empty Shelf` | `GAP` |
| 31 | `Price` | `PRICE_TAG` |
| 18 | `Discount Price` | `PROMO_TAG` |
| *42 others* | coffee SKUs | `PRODUCT` |

---

## 6. Backend Design

### 6.1 Data model (B2)

Tables per B2: `users`, `stores`, `visits`, `captures`, `inference_jobs`, `detections`, `shelf_analyses`, `gap_findings`, `tasks`, `replenishment_requests`, `model_versions`, `audit_log`, plus `analysis_configs` (versioned thresholds, referenced by `shelf_analyses.config_version`).

**Rules that shape the schema**

- `detections` and `shelf_analyses` are **APPEND-ONLY**. Re-running inference with a new model inserts new rows; it never updates or deletes. Findings must stay reproducible for contract disputes.
- `detections` is **partitioned by month** (`RANGE (created_at)`) — one shelf photo yields 200+ rows and this table will dominate storage.
- Every `detections` and `shelf_analyses` row carries `model_version`.
- Indexes: `captures(visit_id)` · `detections(capture_id)` · partial `gap_findings(verification_status) WHERE verification_status='PENDING'` · `visits(store_id, checked_in_at DESC)` · GIST on `stores(lat,lng)`.
- Compliance columns are **created but not enforced** (§8.1): `visits.photo_consent_confirmed`, `captures.face_blur_applied`, `captures.face_blur_count`, `captures.retention_expires_at` — all nullable, no CHECK constraint, no 422 gate.

### 6.2 OSA rules engine (B5) — `services/shelf_analysis.py`

A **pure module**: no DB, no HTTP, no FastAPI import, no `datetime.now()`. Input `(list[Detection], AnalysisConfig)` → output `ShelfAnalysis`. Fully unit-testable from JSON fixtures.

```
1. Filter        confidence >= min_confidence (0.35)
                 flag 0.35..low_confidence_threshold (0.55) as is_low_confidence
2. Row cluster   1-D agglomerative on bbox centre-y,
                 threshold = row_tolerance_ratio (0.6) × median box height
                 sort top→bottom, shelf_row_index starts at 1
3. Per row       product_area = Σ area(PRODUCT); gap_area = Σ area(GAP)
                 row_gap_ratio = gap_area / (product_area + gap_area)
                 PRICE_TAG and PROMO_TAG are excluded from ALL area math
4. Image level   gap_ratio = Σ gap_area / Σ (product_area + gap_area)
                 osa_score = 1 - gap_ratio
                 CRITICAL if osa < 0.75 · LOW if osa < 0.90 · else OK
5. Findings      one per GAP detection, position_label from row + horizontal thirds
                 → "ชั้นที่ 2 · ตำแหน่งซ้าย"
```

Every threshold above comes from `AnalysisConfig`, loaded from the versioned `analysis_configs` table, and `config_version` is stamped onto each `shelf_analyses` row. **No threshold literal may appear anywhere else in the codebase.**

**Measurement caveat encoded in the module docstring:** report area-share metrics only. Do not attempt exact unit counts — occlusion, stacked facings and promo signage make piece-counting unreliable, whereas area share degrades gracefully.

**Edge case that must be handled explicitly:** an empty detection list is **not** `osa=1.0`. Zero detections means "nothing found at all" → the job surfaces `NO_SHELF_DETECTED` and the rep is told to retake, never "perfect shelf".

### 6.3 Async pipeline (B4)

```
commit → enqueue analyze_capture(capture_id)
       → resolve object_key to URI
       → MLClient.infer(image_uri, request_id)     15s hard timeout
       → persist raw detections (append-only)
       → ShelfAnalysisService (pure)
       → persist shelf_analysis + gap_findings
       → job DONE → push notification
```

- **Retries:** 3 attempts, backoff 2s/8s/32s, **only** on 5xx or timeout. A `422` is *not* retryable → job `FAILED`, `error_code=UNREADABLE_IMAGE`, user-facing "ถ่ายภาพใหม่อีกครั้ง".
- **Circuit breaker:** 5 consecutive failures → open 60s → fail fast rather than queueing thousands of doomed jobs.
- **DLQ** + admin inspect/requeue endpoint.
- **Two queues:** `high` for captures on an ACTIVE visit (rep is standing there), `low` for offline batch sync (nobody is waiting). ~70% of daily volume lands in a 3-hour morning window.
- **Metrics:** `job_queue_depth`, `inference_latency_p50/p95/p99`, `end_to_end_latency`, `ml_error_rate` by code. **p95 end-to-end is the primary operational SLO — target < 10s.**

### 6.4 Boundary enforcement

`adapters/ml_client.py` defines `MLClient` (Protocol) with two implementations selected by `ML_CLIENT`:

| value | class | behaviour |
| :-- | :-- | :-- |
| `mock` | `MockMLClient` | deterministic detections seeded from `sha256(image_uri)` |
| `http` | `HttpMLClient` | real service over the contract |

`MockMLClient` fixture scenarios by filename: `*_full.jpg` no gaps · `*_gaps.jpg` 3 gaps · `*_lowconf.jpg` · `*_unreadable.jpg` → 422 · `*_slow.jpg` 12s delay · `*_error.jpg` → 503.

A CI check greps `backend/app/` for `torch|ultralytics|cv2|tensorflow` and for raw class-name string literals, and fails the build on a hit.

### 6.5 Public API surface

All under `/v1`, JWT bearer, RBAC by `role ∈ {REP, MANAGER, ADMIN, DATA}`.

**Rep:** `GET /v1/routes/today` · `POST /v1/visits` · `POST /v1/captures/presign` · `POST /v1/captures/{id}/commit` (Idempotency-Key required → 202 + job_id) · `GET /v1/jobs/{id}` · `GET /v1/captures/{id}/result` · `POST /v1/findings/{id}/verify` · `GET /v1/visits/{id}/tasks` · `PATCH /v1/tasks/{id}` · `POST /v1/visits/{id}/checkout` · `POST /v1/sync/batch`

**Manager (read):** `GET /v1/analytics/osa` · `GET /v1/analytics/risk-ranking` · `GET /v1/stores/{id}/history` · `GET /v1/evidence/{finding_id}` (signed URL + overlay data; **PDF export deferred**)

**Notable behaviours**

- `POST /v1/visits` sets `gps_match = distance < 150m` but **never blocks** on a mismatch — reps legitimately stand outside. Flag it on the record for the evidence trail.
- `POST /v1/captures/presign` returns a presigned PUT. **Image bytes never pass through the API process.**
- `PATCH /v1/tasks/{id}` with `blocked_reason=OUT_OF_BACKSTOCK` auto-creates a `replenishment_request`.
- `POST /v1/sync/batch` and every mutating rep endpoint are idempotent by `Idempotency-Key`; replaying the same payload must be safe.

### 6.6 JSON casing

- **Public `/v1`** — **camelCase** (`osaScore`, `gapFindings`, `shelfRowIndex`) via a Pydantic `alias_generator`, matching [frontend/src/types/index.ts](frontend/src/types/index.ts) verbatim so `lib/mock` swaps out with zero component changes.
- **Internal `/internal/v1`** — **snake_case**, exactly as `contracts/inference-v1.yaml` specifies.

---

## 7. ML Design

### 7.1 Dataset

Extracted from `model/shelf-product.v1i.yolov11.zip`, pinned to `roboflow-ngkro/shelf-product` **version 1**, never "latest". The version and a SHA256 of the zip are recorded in the model card.

| split | images |
| :-- | --: |
| train | 1,146 |
| valid | 137 |
| test | 66 |
| **total** | **1,349** |

Verified by extraction; matches the count in `backend.md`. Zip SHA256 `d6378c1ce6d6…f8f1e9` is recorded in the model card.

45 classes. Published baseline to beat: **mAP@50 = 90.5%, precision 88.2%, recall 90.5%**.

### 7.2 Training (M1)

```yaml
model: yolo11n.pt          # yolo11s as the accuracy variant
imgsz: 960                 # 640 loses the thin gap regions between facings
epochs: 100
batch: 8                   # M2 16GB constraint
device: mps                # CUDA if available; CPU fallback
patience: 25
augment:
  hsv_v: 0.5  hsv_s: 0.6   # heavy brightness/contrast jitter
  degrees: 3  perspective: 0.0008
  fliplr: 0.5
  flipud: 0.0              # ⛔ NEVER — shelves have fixed gravity orientation
  mosaic: 1.0  close_mosaic: 10
  motion_blur / jpeg_compression via albumentations
```

**Class imbalance:** `Empty Shelf` is far rarer than product classes. Oversample gap-containing images, and **always report per-class metrics — never the mAP average alone**.

**Outputs per run:** `best.pt`, `best.onnx` (opset 17), `class_map.yaml`, `metrics.json`, `model_card.md` (dataset version + zip SHA, class map, per-class metrics, known limitations, training date, git SHA).

**Runtime estimate on this machine (Apple M2, 16GB, MPS):** roughly 3–6 hours for 100 epochs at imgsz 960. `configs/smoke.yaml` (2 epochs, imgsz 320) verifies the pipeline in minutes before committing to the long run.

### 7.3 Evaluation thresholds (M2 — script now, CI gate later)

| Gate | Threshold | Rationale |
| :-- | :-- | :-- |
| Recall on `Empty Shelf` | ≥ 0.90 | A missed gap is revenue that can never be recovered — the rep has already walked away. |
| Precision on `Empty Shelf` | ≥ 0.85 | Below this, reps stop trusting alerts within weeks and adoption collapses. |
| Overall mAP@50 | ≥ 0.85 | |
| p95 inference latency | ≤ 400ms @ imgsz 960 | |
| Per-class recall regression | ≤ 5 points vs active model | Evaluated on a frozen holdout never used for training or HPO. |

**These errors are not symmetric.** Optimise the operating point for recall on GAP, then maximise precision subject to that constraint.

**Slice reporting (never averaged away):** bright vs dim · straight-on vs angled · dense vs sparse · top vs bottom rows.

### 7.4 ⚠️ Domain gap — must appear at the top of every model card

> The shelf-product dataset is **European coffee aisles** (Edeka, REWE, tegut — visible in the filenames). Lighting, shelf density, packaging design and store format differ substantially from Thai convenience and traditional-trade stores. **Metrics on this dataset are a capability proof, not a production-readiness signal.** Production promotion additionally requires a held-out set of ≥ 300 photographs from Thai pilot stores, with both numbers reported side by side.

### 7.5 Inference service (M3)

FastAPI over ONNX Runtime (GPU when available, CPU fallback). Loads the active model at startup and runs a **warm-up inference on a dummy tensor at boot** — the first real request from a waiting rep must not pay the JIT cost. `/readyz` returns 503 until warm. Keeps the **last 3 promoted versions loadable** so an old finding can be reproduced for a contract dispute. Reads images directly from the object-store URI — the backend never sends bytes. Batches opportunistically within a 50ms window (~3× throughput during the morning burst).

Returns **422 with a specific `error_code`** when the image is unreadable or contains no detectable shelf structure. *An image where the model finds nothing must never be reported as a perfect shelf.*

---

## 8. Boundaries

### 8.1 Deferred by decision — PDPA

Per your instruction, PDPA work is **skipped for now, enforcement only**:

- ✅ **Kept:** `photo_consent_confirmed`, `face_blur_applied`, `face_blur_count`, `retention_expires_at` columns (nullable), and the `audit_log` table.
- ❌ **Skipped:** the 422 gate on consent, the 422 gate on face blur, the CHECK constraint tying captures to consent, the nightly retention-deletion beat job, the 2% blur-verification sampler, `POST /internal/v1/detect-faces`.
- 🔁 **Re-enabling later** = flipping config flags and adding one migration for the CHECK constraint — no write-path rewrites. The columns exist precisely so that stays cheap.

### 8.2 Always

- Every threshold and business rule lives in config or the `analysis_configs` table — **never a literal in code**.
- Every detection and analysis row carries `model_version`; both tables are append-only.
- `request_id` is generated at the API edge and propagated into logs, Celery task headers, and the ML service call.
- Public API is camelCase; internal contract is snake_case; bboxes are absolute pixels everywhere.
- Run `ruff`, `mypy --strict`, and `pytest` before any commit.
- Thai-language user-facing strings (error messages, position labels) — the reps read Thai.

### 8.3 Ask first

- Any change to `contracts/inference-v1.yaml` — it is the coupling point between two teams.
- Adding a dependency to either `requirements.txt`.
- Any schema change after the first migration is applied.
- Committing anything into `model/artifacts/` or `model/data/` (both gitignored by design).
- Starting the multi-hour training run.

### 8.4 ⛔ Never

1. **No ML libraries in `backend/`.** No `torch`, `ultralytics`, `opencv`, `tensorflow`. CI-enforced.
2. **No raw class names in backend business logic.** Branch on `semantic_type` only.
3. **No per-rep metrics — anywhere.** No `/v1/analytics/reps`, no leaderboard, no rep performance field in any response schema, no `GROUP BY user_id` in any analytics query. Aggregation is permitted at **STORE and AREA level only**. If a future ticket asks for per-rep scoring, escalate rather than implement.
   *เหตุผล: ถ้าคะแนนผูกกับตัวบุคคล พนักงานจะถ่ายแต่มุมที่ดูดี แล้วข้อมูลทั้งชุดจะไร้ค่า* — this is a labour-rights constraint agreed at design stage, not a missing feature.
4. **No automated competitor-price response.** Price-tag data may surface only through aggregate market-level analytics. No endpoint, webhook, or scheduled job that emits near-real-time competitor price changes to a pricing system. *(Competition-law guardrail.)*
5. **No face recognition, identification, matching, or embedding storage.** Detection-for-blurring only — and that endpoint is deferred entirely for now.
6. **No mutation of `detections` or `shelf_analyses`.** Re-inference inserts; it never overwrites.
7. **No image bytes through the API process.** Presigned URLs only.
8. **No vertical flip in augmentation.** Shelves have a fixed gravity orientation.
9. **Empty detections ≠ OSA 100%.** Distinguish "no gaps found" from "nothing found at all".

---

## 9. Code Style

```python
# app/services/shelf_analysis.py
"""Pure OSA rules. No I/O, no ORM, no framework imports, no clock reads.

Reports area-share metrics only. Exact unit counts are deliberately not
computed: occlusion, stacked facings and promo signage make piece-counting
unreliable, whereas area share degrades gracefully under all three.
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from app.domain.enums import OsaStatus, SemanticType
from app.domain.values import AnalysisConfig, Detection, ShelfAnalysis


@dataclass(frozen=True, slots=True)
class _Row:
    index: int
    detections: tuple[Detection, ...]

    @property
    def gap_ratio(self) -> float:
        gap = _area_of(self.detections, SemanticType.GAP)
        product = _area_of(self.detections, SemanticType.PRODUCT)
        denominator = gap + product
        # A row of nothing but price tags has no shelf area to judge.
        return gap / denominator if denominator > 0 else 0.0


def analyse(detections: list[Detection], config: AnalysisConfig) -> ShelfAnalysis:
    kept = [d for d in detections if d.confidence >= config.min_confidence]
    if not kept:
        # Not a perfect shelf — an unreadable one. The caller must surface
        # NO_SHELF_DETECTED so the rep retakes the photo.
        raise NoShelfDetectedError(candidates=len(detections))

    rows = _cluster_rows(kept, tolerance=config.row_tolerance_ratio * median(...))
    ...
```

**Conventions.** `snake_case` functions, `PascalCase` classes, `_leading_underscore` module-private. Full type hints, `from __future__ import annotations`, `mypy --strict` clean. Frozen dataclasses for value objects, Pydantic only at HTTP boundaries. Line length 100, `ruff format`. Comments explain *why*, never *what* — every comment in the sample above encodes a decision that would otherwise be re-litigated.

---

## 10. Testing Strategy

| Level | Location | Runs against | Covers |
| :-- | :-- | :-- | :-- |
| Unit | `backend/tests/unit/` | nothing (pure) | `shelf_analysis`, services, circuit breaker, idempotency keys |
| Integration | `backend/tests/integration/` | docker compose pg+redis+minio, `ML_CLIENT=mock` | Full API paths, migrations, Celery eager mode |
| Contract | `contracts/tests/` | Pydantic ↔ OpenAPI | Model/schema drift fails the build |
| ML | `model/tests/` | fixtures + tiny ONNX | class_map integrity, pre/post-process, letterbox round-trip, bbox coordinate space |

**Coverage:** ≥ 90% on `app/services/`, ≥ 75% overall. Framework glue is not chased for coverage.

**Required B5 fixtures** (`backend/tests/fixtures/`): full shelf (osa = 1.0) · one large gap · badly tilted photo where rows overlap · price tags only · **empty detection list** · single-row close-up.

**Critical assertions**

- Round-tripping a detection through the contract preserves absolute-pixel bbox coordinates exactly.
- `MockMLClient` returns byte-identical output for the same `image_uri` across processes.
- No analytics query contains `user_id` in a `GROUP BY` — asserted by a test that greps the SQL layer.

---

## 11. Success Criteria

- [ ] `docker compose --profile mock up` gives a working API with zero ML dependencies installed.
- [ ] Golden path passes end-to-end against the mock: check-in → presign → commit → job → result → verify → task → checkout.
- [ ] Switching mock → real ML is **exactly one env var**, with no business-logic file touched. *(This is the stated measure that the separation succeeded.)*
- [ ] `grep -rE 'torch|ultralytics|cv2|tensorflow' backend/app backend/requirements.txt` returns nothing.
- [ ] `grep -rE 'Empty Shelf|FM Bohne' backend/app/services backend/app/api` returns nothing.
- [ ] `shelf_analysis.py` has zero imports from `fastapi`, `sqlalchemy`, or `celery`, and its tests run with no services up.
- [ ] All six B5 fixtures pass, including empty-list → `NoShelfDetectedError`, not `osa=1.0`.
- [ ] A trained model exists with `model_card.md` reporting **per-class** precision/recall for `Empty Shelf`, plus the domain-gap warning.
- [ ] Real inference service answers `POST /internal/v1/infer` with absolute-pixel bboxes and correct `semantic_type`.
- [ ] `/readyz` returns 503 until the warm-up inference completes.
- [ ] The frontend's `lib/mock/*` can be replaced by HTTP calls with **no component file changed**.
- [ ] No endpoint, query, or response field anywhere references per-rep aggregation.

---

## 12. Open Questions

1. **Training target.** Is beating the published baseline (mAP@50 90.5%) a hard requirement for this sprint, or is "pipeline reproducible + a working artifact" enough? The eval gates in §7.3 are written either way, but §7.4's domain gap means a Thai-store number is what actually matters and we have none.
2. **Auth seeding.** How should the first ADMIN user be created — a seed script, an `alembic` data migration, or an env-var bootstrap on first boot?
3. **Store/route data.** The frontend mocks 4 areas and a store list. Do you have real store master data to seed, or should I generate a seed matching `lib/mock/data.ts` so the two line up during development?
4. **Push notification** on job completion (B4) — real transport (FCM/web-push), or a no-op adapter behind an interface for now given the frontend polls `/v1/jobs/{id}` every 500ms anyway?
5. **MLflow** — spin it up in compose, or use the local file store (`mlruns/`) for this sprint?

---

## 13. Delivery Order

| Step | Deliverable | Verify |
| --: | :-- | :-- |
| 1 | `contracts/` — OpenAPI + Pydantic + mock server | `make contract-check` |
| 2 | B1 scaffolding, config, logging, compose | `docker compose up`, `/healthz` 200 |
| 3 | B2 schema + migrations | `alembic upgrade head` on clean DB |
| 4 | **B5 OSA engine + all 6 fixtures** *(pure, no deps — build early)* | `pytest tests/unit -q` |
| 5 | B7.1 `MockMLClient` | determinism test passes |
| 6 | B3 core API + JWT/RBAC | integration golden path |
| 7 | B4 Celery pipeline, retries, breaker, DLQ | 422 → no retry; 503 → 3 retries |
| 8 | M1 dataset prep + smoke training run | `configs/smoke.yaml` completes |
| 9 | M1 full training run + model card | per-class metrics reported |
| 10 | M1 ONNX export | opset 17, parity vs `.pt` within tolerance |
| 11 | M3 inference service | contract conformance vs `inference-v1.yaml` |
| 12 | **Flip `ML_CLIENT=mock` → `http`** | golden path passes unchanged |
