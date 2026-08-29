# ShelfEye — Shelf Gap Detection & Replenishment

A field rep photographs a retail shelf and gets an on-shelf-availability (OSA)
score back **while still standing in front of it**, with each gap boxed,
labelled in Thai, and turned into a replenishment task before they walk out.

> **Demo build.** Working end-to-end over production-hardened. What was
> deliberately left out, and why, is recorded in [docs/archive/](docs/archive/).

**The whole system runs without the ML model.** `ML_CLIENT=mock` gives you
deterministic fake detections, so a new contributor can clone, `make setup`,
and walk the entire golden path in about ten minutes — no GPU, no 2-hour
training run, no dataset download. See [Quick start](#quick-start).

---

## Contents

| | |
| :-- | :-- |
| [Architecture](#architecture) | the three services and the one contract between them |
| [Repository layout](#repository-layout) | every directory, annotated |
| [Quick start](#quick-start) | clone → running app, in mock mode |
| [Configuration](#configuration) | every environment variable |
| [The golden path](#the-golden-path) | the request-by-request workflow |
| [Domain rules](#domain-rules) | OSA scoring, risk ranking, verification |
| [Data model](#data-model) | tables, and why two are append-only |
| [API reference](#api-reference) | every endpoint and who may call it |
| [The mock ML client](#the-mock-ml-client) | driving specific shelf shapes without a model |
| [Frontend](#frontend) | routes, the data layer, offline queue, camera |
| [ML pipeline](#ml-pipeline) | dataset → train → evaluate → export → serve |
| [Switching to the real model](#switching-to-the-real-model) | the one-variable flip |
| [Testing](#testing) | four suites, what each needs |
| [Development guide](#development-guide) | how to make the common changes |
| [Troubleshooting](#troubleshooting) | the failures you will actually hit |
| [What this system will not do](#what-this-system-will-not-do) | enforced by tests, not convention |

---

## Architecture

Three deployables. Two of them share exactly one thing — a contract — and the
third talks to neither directly, only to the API.

```
┌────────────────────────────┐         ┌────────────────────────────┐
│  backend/  shelfeye-api    │         │  model/  shelfeye-ml       │
│  FastAPI + Celery :8000    │  HTTP   │  FastAPI + ONNX RT :8001   │
│                            │ ──────► │                            │
│  auth · visits · captures  │ ◄────── │  training pipeline         │
│  OSA rules · tasks         │  JSON   │  ONNX inference service    │
│  analytics · storage       │         │  class map (in artifact)   │
│                            │         │                            │
│  ⛔ no torch/ultralytics   │         │  ⛔ never hears "store"    │
│  ⛔ never sees class names │         │  ⛔ never computes OSA     │
└────────────────────────────┘         └────────────────────────────┘
                    └──── contracts/ ────┘
                    OpenAPI 3.1 + Pydantic v2

┌────────────────────────────┐
│  frontend/  Next.js 16     │
│  React 19 · Tailwind 4     │
│                            │  every request goes through
│  /m  mobile: the rep's day │  lib/api/client.ts — the only
│  /w  web: manager + data   │  file that knows the base URL
│                            │  or holds the token
│  ⛔ no component calls     │
│     fetch directly         │
└────────────────────────────┘
```

**Supporting infrastructure** (Docker Compose): PostgreSQL 16, Redis 7, MinIO.

**The measure of whether the separation worked:** going from fake detections to
the real model is one environment variable, `ML_CLIENT=mock` → `http`, with no
business-logic file touched.

### Why the boundary is drawn there

| Rule | Reason |
| :-- | :-- |
| Backend branches on `semantic_type`, never on a class name | The dataset's 45 class names change on every retrain. `Empty Shelf` hardcoded in a service would silently stop matching one day, and OSA would quietly read 100%. |
| OSA thresholds live in the backend, not the model | "Below 75% is critical" is a business decision trade marketing revisits monthly. It must never require a model release. |
| `detections` and `shelf_analyses` are append-only | A finding may be disputed commercially months later. Re-running inference inserts; it never overwrites. |
| Every derived row carries `model_version` and `run_id` | "Which model produced this result in May?" must always be answerable, and re-running the *same* model must not draw every box twice. |
| Bounding boxes are absolute pixels, everywhere | Mixed coordinate conventions produce boxes that look *almost* right — far worse than obviously wrong. |
| The API never touches image bytes | Uploads go browser → presigned URL → MinIO. The ML service reads from storage with its own credentials. |

### The three chokepoints

Each service has exactly one file that knows about the outside world. If a
change to an external system requires editing anything else, the boundary has
leaked:

| File | Sole knowledge |
| :-- | :-- |
| [backend/app/adapters/ml_client.py](backend/app/adapters/ml_client.py) | that an ML service exists, its URL, its retry semantics |
| [backend/app/adapters/storage_client.py](backend/app/adapters/storage_client.py) | S3/MinIO, presigning, object-key layout |
| [frontend/src/lib/api/client.ts](frontend/src/lib/api/client.ts) | the API base URL, the bearer token, 401 handling |

---

## Repository layout

```
.
├── Makefile                      every workflow command — start here
├── docker-compose.yml            postgres · redis · minio, plus optional app/ml profiles
├── pyrightconfig.json
│
├── contracts/                    THE shared boundary. Installed into both venvs.
│   ├── inference-v1.yaml         OpenAPI 3.1 — the normative contract
│   ├── shelfeye_contracts/
│   │   ├── enums.py              SemanticType, InferErrorCode
│   │   └── inference.py          BBox, Detection, InferRequest/Response, errors
│   └── tests/
│       └── test_contract_parity.py   Pydantic models ↔ OpenAPI must not drift
│
├── backend/                      shelfeye-api — FastAPI + Celery
│   ├── app/
│   │   ├── main.py               app factory, CORS, request-id middleware, /healthz
│   │   ├── core/
│   │   │   ├── config.py         ALL configuration and every business threshold
│   │   │   ├── exceptions.py     domain errors → HTTP status + Thai user message
│   │   │   ├── logging.py        structlog, request-id propagation
│   │   │   └── security.py       bcrypt hashing, JWT mint/verify
│   │   ├── domain/
│   │   │   ├── enums.py          Role, JobStatus, OsaStatus, RejectReason, …
│   │   │   └── values.py         frozen dataclasses: Detection, BBox, ShelfAnalysis
│   │   ├── db/
│   │   │   ├── models.py         SQLAlchemy 2.0 ORM — 14 tables
│   │   │   ├── session.py        async engine (API)
│   │   │   ├── base.py
│   │   │   └── seed.py           demo users, stores, model versions — idempotent
│   │   ├── adapters/             everything that talks to the outside world
│   │   │   ├── ml_client.py      MLClient protocol + HttpMLClient + build_ml_client()
│   │   │   ├── mock_ml_client.py deterministic offline inference
│   │   │   ├── storage_client.py presign PUT/GET, object-key layout, bucket bootstrap
│   │   │   └── notifications.py  job-done notifier (log-only in this build)
│   │   ├── services/             business logic — no framework imports
│   │   │   ├── shelf_analysis.py THE OSA ENGINE. Pure: no I/O, no ORM, no clock.
│   │   │   ├── analysis_pipeline.py  infer → analyse → persist, all append-only
│   │   │   ├── risk.py           haversine + store risk score, pure
│   │   │   └── sku_catalog.py    shelf position → SKU (planogram stand-in)
│   │   ├── repositories/
│   │   │   └── store_risk.py     the one query complex enough to isolate
│   │   ├── api/v1/               HTTP layer only — no business rules
│   │   │   ├── deps.py           get_db, current_user, require_roles
│   │   │   ├── schemas.py        request/response models (camelCase on the wire)
│   │   │   ├── auth.py           login, /me
│   │   │   ├── routes.py         today's route for a rep
│   │   │   ├── stores.py areas.py catalog.py
│   │   │   ├── visits.py         check-in, check-out
│   │   │   ├── captures.py       presign, commit, job poll, result
│   │   │   ├── findings.py       verify a gap, fetch evidence
│   │   │   ├── tasks.py          replenishment tasks
│   │   │   ├── analytics.py      manager dashboards  ⛔ never GROUP BY user_id
│   │   │   ├── model_health.py   model health + relabel queue
│   │   │   └── sync.py           offline queue drain
│   │   └── workers/
│   │       ├── celery_app.py     broker config
│   │       ├── session.py        sync session factory (Celery + Alembic)
│   │       └── analyze.py        the task: retry policy and nothing else
│   ├── alembic/versions/         4 migrations
│   ├── scripts/demo_golden_path.py   `make demo` — walks the whole flow, prints it
│   ├── devrun.py                 detached launcher for api/worker (survives the shell)
│   ├── tests/
│   │   ├── unit/                 OSA engine + mock ML — need nothing running
│   │   └── integration/          API + prohibitions — need infra + migrate
│   ├── requirements.txt          ⛔ must never contain a CV library
│   ├── Dockerfile
│   └── .env.example
│
├── model/                        shelfeye-ml — training and inference
│   ├── shelfeye_ml/
│   │   ├── artifact/class_map.py class_id → (name, semantic_type)
│   │   ├── training/
│   │   │   ├── prepare_dataset.py    extracts the archive, converts Roboflow polygon
│   │   │   │                         labels to bboxes so Ultralytics keeps the images
│   │   │   ├── train.py              Ultralytics wrapper + run manifest
│   │   │   └── export_onnx.py        ONNX opset 17 into the artifact dir
│   │   ├── eval/
│   │   │   ├── evaluate.py           test split + the promotion gates
│   │   │   └── model_card.py         model_card.md, domain-gap warning first
│   │   └── serving/
│   │       ├── app.py                the inference service — implements the contract
│   │       ├── engine.py             ONNX Runtime session, warm-up, sha
│   │       ├── preprocess.py         letterbox, EXIF, image loading
│   │       ├── postprocess.py        NMS, per-class thresholds, un-letterbox
│   │       └── storage.py            S3 reader (its own credentials)
│   ├── configs/                  one YAML per training run, each with its rationale
│   ├── class_map.yaml            45 classes → 4 semantic types
│   ├── artifacts/<run_name>/     weights, metrics.json, model_card.md   (gitignored)
│   ├── data/                     extracted dataset                       (gitignored)
│   ├── launch_training.py        detached training launcher
│   ├── devrun_ml.py              detached launcher for the inference service
│   ├── tests/
│   ├── requirements.txt          training: torch + ultralytics
│   ├── requirements-serve.txt    serving: ONNX Runtime only, ~10× smaller image
│   └── Dockerfile
│
├── frontend/                     Next.js 16 App Router, React 19, Tailwind v4
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx          platform launcher (pick mobile or web)
│   │   │   ├── m/                MOBILE — the rep's day, 13 screens
│   │   │   └── w/                WEB — manager and data team, 6 screens
│   │   ├── components/
│   │   │   ├── auth/AuthGate.tsx one place decides whether a screen may render
│   │   │   ├── mobile/  web/  shelf/  charts/  ui/  offline/
│   │   ├── lib/
│   │   │   ├── api/client.ts     the ONLY file with the base URL or the token
│   │   │   ├── api/*.ts          one module per resource, wire → domain mapping
│   │   │   ├── offline/queue.ts  hand-written IndexedDB queue (photos are Blobs)
│   │   │   ├── capture.ts        camera/upload → CapturedPhoto
│   │   │   └── store.ts          zustand: visit-scoped UI state
│   │   ├── hooks/useCamera.ts
│   │   └── types/index.ts
│   ├── next.config.ts            dev proxy for /v1/* and /shelfeye-raw/*
│   └── .env.example
│
└── docs/
    ├── running.md                คู่มือการรันโปรเจกต์ (Thai run guide)
    ├── backend.md  ui.md         original requirements
    └── archive/                  planning docs for both finished rounds
```

---

## Quick start

### Prerequisites

| | Version | Used for |
| :-- | :-- | :-- |
| Docker | any with `docker compose` | postgres · redis · minio |
| Python | 3.12 | backend and ML |
| Node | 20+ | frontend |

Host ports are shifted off the defaults so this stack never collides with
anything already running:

| Service | Port | |
| :-- | --: | :-- |
| postgres | **5433** | default 5432 avoided |
| redis | **6380** | default 6379 avoided |
| minio | 9000 · 9001 | 9001 is the web console (`shelfeye` / `shelfeye123`) |
| API | 8000 | |
| ML service | 8001 | only when running the real model |
| frontend | 3000 | |

### Six commands

```bash
make setup                    # both venvs + the shared contracts package
make infra                    # postgres + redis + minio, and create the bucket
make migrate seed             # schema + demo users, stores, model versions
make api worker               # API on :8000, Celery worker — both detached
make demo                     # walk the golden path and print each step
cd frontend && npm install && npm run dev
```

`make setup` copies `backend/.env.example` to `backend/.env` if it does not
exist. **Confirm it says `ML_CLIENT=mock`** — the default baked into
[config.py](backend/app/core/config.py) is `http`, so a missing `.env` means the
backend will look for an ML service that is not running:

```bash
curl -s localhost:8000/healthz
```

should print `{"status":"ok", … "mlClient":"mock"}`.

Then open <http://localhost:3000>.

### Demo accounts

Password is `demo1234` for all four.

| Email | Role | Lands on |
| :-- | :-- | :-- |
| `rep@shelfeye.demo` | REP | `/m` — the mobile app |
| `manager@shelfeye.demo` | MANAGER | `/w` — the dashboard |
| `admin@shelfeye.demo` | ADMIN | `/w` |
| `data@shelfeye.demo` | DATA | `/w` — model health, relabel queue |

Five seeded Bangkok stores, deterministic UUIDs (`uuid5` of the slug), so
`st-101` is the same id on every machine.

### Keeping the demo demonstrable

Development databases fill up. After a few hundred captures every store reads
100% OSA and "0 days since last visit", and the demo stops demonstrating
anything:

```bash
make reset-db
```

Drops and rebuilds **this project's** schema only, then reseeds.

### Testing the camera on a real phone

The camera needs a secure context, so the phone must reach the dev server over
HTTPS:

```bash
cd frontend && npm run dev:mobile
```

`next.config.ts` already allows tunnel and private-network origins. **Leave
`NEXT_PUBLIC_API_URL` unset** — the Next dev server proxies `/v1/*` to the API
and `/shelfeye-raw/*` to MinIO, so everything reaches the phone through one
origin and CORS never enters the picture. Setting the variable to your LAN IP
bypasses the proxy and you will need to add that origin to the CORS allowlist in
[main.py](backend/app/main.py) yourself.

On a desktop with no camera the capture screen offers "อัปโหลดรูปแทน" and the
rest of the flow is identical.

---

## Configuration

### Backend — `backend/.env`

Everything is read once, at import, through a cached `Settings` object.
**Changing `.env` requires restarting both the API and the worker** (`make stop
api worker`) — `get_settings()` is `@lru_cache`d per process.

| Variable | Default | Notes |
| :-- | :-- | :-- |
| `DATABASE_URL` | `postgresql+asyncpg://shelfeye:shelfeye@localhost:5433/shelfeye` | Alembic and Celery strip `+asyncpg` automatically |
| `REDIS_URL` | `redis://localhost:6380/0` | Celery broker and result backend |
| `S3_ENDPOINT_URL` | `http://localhost:9000` | where the API signs from |
| `S3_PUBLIC_ENDPOINT_URL` | `http://localhost:9000` | what goes into the signed URL the browser gets |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `shelfeye` / `shelfeye123` | |
| `S3_BUCKET` | `shelfeye-raw` | private; nothing anonymous |
| `PRESIGN_EXPIRY_SECONDS` | `900` | |
| **`ML_CLIENT`** | **`http`** | `mock` or `http`. **The entire switch.** |
| `ML_SERVICE_URL` | `http://localhost:8001` | |
| `ML_TIMEOUT_SECONDS` | `15.0` | |
| `ML_MAX_RETRIES` | `3` | |
| `JWT_SECRET` | committed dev default | refuses to boot with the default unless `ENVIRONMENT=local` |
| `JWT_EXPIRY_HOURS` | `8` | one working day |
| `ENVIRONMENT` | `local` | `local` · `ci` · `demo` |

**OSA business rules** — these are the numbers trade marketing changes, and
they live here precisely so that changing them is not a model release:

| Variable | Default | Meaning |
| :-- | --: | :-- |
| `ANALYSIS_CONFIG_VERSION` | `v1` | **bump this whenever any value below changes** — every `shelf_analyses` row records it |
| `MIN_CONFIDENCE` | `0.35` | below this a detection is discarded entirely |
| `LOW_CONFIDENCE_THRESHOLD` | `0.55` | between the two, shown as "ต้องตรวจสอบ" rather than asserted |
| `ROW_TOLERANCE_RATIO` | `0.6` | × median box height = the row-clustering gap |
| `CRITICAL_THRESHOLD` | `0.75` | OSA below this is CRITICAL |
| `LOW_THRESHOLD` | `0.90` | OSA below this is LOW |
| `GPS_MATCH_RADIUS_METERS` | `150.0` | check-in outside this is **flagged, never blocked** |
| `RETENTION_DAYS` | `90` | column exists; enforcement deferred |

### ML service — environment only, no `.env` file

| Variable | Default | |
| :-- | :-- | :-- |
| `MODEL_ARTIFACT_DIR` | `model/artifacts/shelf-product-yolo26l-960` | must contain `best.onnx` and `class_map.yaml` |
| `MODEL_VERSION` | the artifact directory's name | recorded on every derived row |
| `CONF_THRESHOLD` | `0.25` | default per-class floor |
| `GAP_CONF_THRESHOLD` | `0.15` | lower for `Empty Shelf` — a missed gap is unrecoverable |
| `PRICE_CONF_THRESHOLD` | `0.20` | |
| `MIN_DETECTIONS_FOR_SHELF` | `2` | below this → 422 `NO_SHELF_DETECTED`, never an empty 200 |

### Frontend — `frontend/.env`

| Variable | Default | |
| :-- | :-- | :-- |
| `NEXT_PUBLIC_API_URL` | *(empty)* | leave unset locally and on the LAN; requests go to `/v1/*` and `next.config.ts` proxies them |

---

## The golden path

```
check-in → presign → PUT to storage → commit (202) → job → result
        → verify gap → task → after-photo → checkout
```

`make demo` walks exactly this against a running API and prints what a demo
would show:

```
2. today's route  (risk DESC, distance ASC)
  HIGH   score=0.575    0.0km  เมกะแวลู บางกะปิ
3. check-in  (GPS ~5km off: flagged, NOT blocked)
  visit 75b3a282  gpsMatch=False  status=OPEN
8. result
  osaScore=0.8750  status=LOW  rows=3  gapRatio=0.1250
    · ชั้นที่ 1 · ตำแหน่งซ้าย  ลาเต้ กระป๋อง 180ml (SKU-1002)
```

### Step by step

| # | Actor | Call | What happens |
| --: | :-- | :-- | :-- |
| 1 | rep | `POST /v1/auth/login` | bcrypt verify, JWT minted, 8h expiry |
| 2 | rep | `GET /v1/routes/today?lat&lng` | stores ordered by risk DESC, then distance ASC |
| 3 | rep | `POST /v1/visits` | check-in. GPS beyond 150 m sets `gpsMatch=false` — **flagged, not blocked**: reps legitimately stand outside the geofence |
| 4 | rep | `POST /v1/captures/presign` | a `captures` row is created and a presigned PUT returned. The object key is date-partitioned and carries the bay label |
| 5 | browser | `PUT` → MinIO | **image bytes never touch the API process.** The one sanctioned `fetch` outside `client.ts` |
| 6 | rep | `POST /v1/captures/{id}/commit` | `Idempotency-Key` required. Creates an `inference_jobs` row, enqueues the Celery task, returns **202** |
| 7 | worker | `analyze_capture` | `build_ml_client().infer(s3://…)` → mock or HTTP |
| 8 | worker | — | `shelf_analysis.analyse()` computes OSA; detections, analysis and findings are inserted under one shared `run_id` |
| 9 | rep | `GET /v1/jobs/{id}` | polled every 500 ms while the rep waits |
| 10 | rep | `GET /v1/captures/{id}/result` | OSA score, status, rows, gap findings with Thai position labels and SKU names |
| 11 | rep | `POST /v1/findings/{id}/verify` | CONFIRMED creates a task; REJECTED records a reason as training signal |
| 12 | rep | `PATCH /v1/tasks/{id}` | FIXED or BLOCKED with a reason |
| 13 | rep | presign + commit, `phase=AFTER` | the after-photo, analysed the same way |
| 14 | rep | `POST /v1/visits/{id}/checkout` | writes `osa_before` / `osa_after` onto the visit |

### Failure handling

| Failure | Class | Behaviour |
| :-- | :-- | :-- |
| `UNREADABLE_IMAGE`, `NO_SHELF_DETECTED`, `IMAGE_NOT_FOUND` (422) | terminal | job marked FAILED with a Thai message telling the rep to retake. **Never retried** — retrying an unreadable photo produces an unreadable photo |
| `MODEL_NOT_LOADED`, `MODEL_WARMING_UP`, 5xx, timeout | transient | Celery retries at **2s, 8s, 32s**, then FAILED with `ML_UNAVAILABLE` |
| No signal on the phone | client-side | the operation, photo bytes included, goes into IndexedDB and replays on reconnect through `POST /v1/sync/batch` |

An **empty detection list is never reported as a perfect shelf.** The ML service
returns 422 rather than an empty 200, and the OSA engine raises
`NoShelfDetectedError` rather than scoring 1.0. Conflating "no gaps found" with
"nothing found at all" would poison every trend built on this data.

---

## Domain rules

### The OSA engine

[backend/app/services/shelf_analysis.py](backend/app/services/shelf_analysis.py)
is **pure** — no I/O, no ORM, no framework import, no clock read. That is why
its 25 tests run in 0.1 s with nothing running.

1. **Filter** — drop everything below `MIN_CONFIDENCE`. If nothing survives,
   raise `NoShelfDetectedError`.
2. **Cluster into rows** — sort by box centre-y and split wherever the gap to
   the next box exceeds `ROW_TOLERANCE_RATIO × median(box height)`. Single-linkage
   clustering in 1-D reduces to exactly this, with none of the matrix work.
   Scaling the tolerance by median height means the same rule works on a close-up
   of one shelf and a wide shot of a whole bay.
3. **Measure** — per row, `product_area` and `gap_area`. **Only `PRODUCT` and
   `GAP` carry shelf area.** Price and promo tags sit on the shelf edge, not in
   the facing space; counting them would inflate the denominator and make every
   shelf look better stocked than it is.
4. **Score** — `gap_ratio = gap_area / (gap_area + product_area)`,
   `osa_score = 1 − gap_ratio`. Classify: `< 0.75` CRITICAL, `< 0.90` LOW, else OK.
5. **Findings** — one per GAP detection, with a Thai position label
   ("ชั้นที่ 2 · ตำแหน่งซ้าย") built from the row index and the horizontal third.
   A rep at the shelf needs to find the gap in seconds; pixel coordinates are
   useless to them.

**Area share, not unit counts.** Occlusion, stacked facings and promo signage
make piece-counting unreliable, whereas area share degrades gracefully under all
three. A request for exact counts should be pushed back on with this rationale.

### Store risk

[backend/app/services/risk.py](backend/app/services/risk.py) — also pure, and
deliberately a **store-level** property. Nothing here takes a user into account.

```
risk = 0.55 × (1 − last_osa)          # never visited → treated as 0.5, not "unknown"
     + 0.30 × min(days_since_visit / 30, 1)
     + 0.15 × min(repeat_gap_skus / 10, 1)
```

Bands: `≥ 0.55` HIGH, `≥ 0.35` MEDIUM, else LOW. Distance is haversine.

### Verification and rejection reasons

Rejection reasons are training signal, not noise. `OCCLUDED` and `NORMAL_EMPTY`
are two distinct model failure modes needing different fixes — the first wants
more occluded-shelf training data, the second wants better negative examples of
structural shelf voids. The relabel queue surfaces both, **and never who
rejected them**: a queue that named the rejecting rep would be a per-rep accuracy
metric by another route, and reps who know their rejections are counted stop
rejecting things.

---

## Data model

14 tables. Full definitions in [backend/app/db/models.py](backend/app/db/models.py).

```
users ──┐
        ├── visits ── captures ──┬── inference_jobs
stores ─┘                        ├── detections        (APPEND-ONLY)
                                 ├── shelf_analyses    (APPEND-ONLY)
                                 └── gap_findings ── tasks ── replenishment_requests

model_versions      audit_log      sync_operations
```

| Table | Purpose |
| :-- | :-- |
| `users` | four roles: REP, MANAGER, ADMIN, DATA. bcrypt hashes. |
| `stores` | chain, format, geo, `photo_policy`, visit window. Indexed on area and lat/lng. |
| `visits` | check-in/out, `gps_match` (flag only), `osa_before` / `osa_after`. |
| `captures` | one photo. `object_key`, phase BEFORE/AFTER, `client_idempotency_key` (unique). |
| `inference_jobs` | QUEUED → RUNNING → DONE/FAILED, attempts, `error_code`, `inference_ms`. |
| **`detections`** | **append-only.** Owns its own PK; `source_detection_id` keeps the ML service's id for tracing but is *not* the key — it is only unique within one response. |
| **`shelf_analyses`** | **append-only.** One row per (capture, model_version, config_version). |
| `gap_findings` | verification status, reject reason, SKU, priority. Partial index on PENDING — the only hot read. |
| `tasks` | one per finding (`uq_task_per_finding`), FIXED/BLOCKED with reason, links the after-photo. |
| `replenishment_requests` | the downstream hand-off. |
| `model_versions` | version, sha, dataset, **real metrics including gate failures**, `is_active`. |
| `audit_log` | append-only: verifications, disputes, promotions. |
| `sync_operations` | idempotency ledger for the offline drain, keyed by the client's key. |

**`run_id` on all three derived tables.** `model_version` alone is not enough:
re-running the *same* model on a capture appends a second set of rows, and a
reader filtering only by `model_version` would return both and draw every box
twice.

Compliance columns (consent, face blur, retention) exist but are nullable and
ungated. PDPA enforcement is deferred; keeping the columns means turning it on
later is a config change plus one constraint, not a rewrite of every write path.

---

## API reference

Base path `/v1`. Public responses are **camelCase** to match the frontend's
domain types; the internal ML contract is **snake_case**. Interactive docs at
<http://localhost:8000/docs>.

Two access levels. Most endpoints require only a valid token (`current_user`);
the management surfaces are guarded by a module-level
`require_roles(MANAGER, ADMIN, DATA)` applied to every handler in the module, so
a new endpoint added there cannot silently skip the check.

| Method | Path | Access | Purpose |
| :-- | :-- | :-- | :-- |
| `POST` | `/auth/login` | public | email + password → JWT |
| `GET` | `/me` | any token | current user, role, area |
| `GET` | `/routes/today` | any token | risk DESC, distance ASC |
| `GET` | `/areas` | any token | area list |
| `GET` | `/stores` | any token | store list with risk |
| `GET` | `/stores/{id}` | any token | one store |
| `GET` | `/categories?storeId=` | any token | categories + this store's last OSA per category |
| `POST` | `/visits` | any token | check-in |
| `GET` | `/visits/{id}` | any token | |
| `POST` | `/visits/{id}/checkout` | any token | writes before/after OSA |
| `POST` | `/captures/presign` | any token | creates the capture row, returns a presigned PUT |
| `POST` | `/captures/{id}/commit` | any token | **requires `Idempotency-Key`**, returns 202 |
| `GET` | `/jobs/{id}` | any token | poll status |
| `GET` | `/captures/{id}/result` | any token | OSA, rows, findings, presigned image URL |
| `POST` | `/findings/{id}/verify` | any token | CONFIRMED → creates a task; REJECTED → reason |
| `GET` | `/evidence/{finding_id}` | any token | the image + boxes behind one finding |
| `GET` | `/visits/{id}/tasks` | any token | |
| `PATCH` | `/tasks/{id}` | any token | FIXED / BLOCKED |
| `POST` | `/sync/batch` | any token | offline drain, per-item results |
| `GET` | `/analytics/osa` | MANAGER · ADMIN · DATA | OSA trend |
| `GET` | `/analytics/risk-ranking` | MANAGER · ADMIN · DATA | stores by risk |
| `GET` | `/analytics/kpis` | MANAGER · ADMIN · DATA | headline numbers |
| `GET` | `/analytics/route-plan` | MANAGER · ADMIN · DATA | suggested route |
| `GET` | `/stores/{id}/history` | MANAGER · ADMIN · DATA | visit history + evidence |
| `GET` | `/model/health` | MANAGER · ADMIN · DATA | active version, all versions, override rate |
| `GET` | `/model/relabel-queue` | MANAGER · ADMIN · DATA | rejected + low-confidence findings. **Never returns who rejected** |
| `GET` | `/healthz` | public | includes `mlClient`, so you can see which client is live |

### The inference contract

[contracts/inference-v1.yaml](contracts/inference-v1.yaml) — served by the ML
service at `POST /internal/v1/infer`, plus `/internal/v1/models`,
`/internal/v1/healthz`, `/internal/v1/readyz`.

> **Coordinate space — read before touching anything.** Every bounding box
> crossing this boundary is in **absolute pixels of the original image**,
> top-left origin, x rightward, y downward. Never normalised to 0..1. Never YOLO
> centre-form. The ML service reverses its own letterbox padding before
> responding.

`test_contract_parity.py` (21 tests) fails if the Pydantic models and the
OpenAPI document ever drift apart, and asserts that `semantic_type` is the only
branchable field.

---

## The mock ML client

[backend/app/adapters/mock_ml_client.py](backend/app/adapters/mock_ml_client.py)
is **deterministic**: the same `image_uri` always yields byte-identical
detections, in every process, forever. That is what makes an integration test's
expected OSA score a fixed number rather than a range, and what lets a demo be
rehearsed.

It builds three rows of eight slots plus a price rail per row (present precisely
so the engine's exclusion of price tags is exercised) and picks a scenario from a
`_marker` token **anywhere in the URI**. The marker survives being embedded in a
date-partitioned object key, so scenarios are reachable through the real presign
flow, not just from unit tests.

| Marker in `shelfBayLabel` | Behaviour |
| :-- | :-- |
| `_full` | a well-stocked shelf, OSA 1.0 |
| `_gaps` | three gaps in the middle row |
| `_lowconf` | a gap the model only half-believes (0.42 — inside the 0.35–0.55 band) |
| `_unreadable` | 422 — job fails, rep told to retake |
| `_error` | 503 — transient, retried at 2s/8s/32s |
| `_slow` | 12 s delay, for timeout behaviour |
| *(none)* | default: 1 gap in row 1, 2 in row 2 → OSA 0.875, status LOW |

> ⚠️ **The seeded bay labels contain no markers.** [catalog.py](backend/app/api/v1/catalog.py)
> serves `A1 A2 A3 / B1 B2 / C1–C4 / D1 D2 / E1`, so **capturing through the UI
> always produces the `default` scenario.** To exercise the others from the app,
> add markers to the bay list:
>
> ```python
> ("cat-coffee", "กาแฟ", ["A1_gaps", "A2_full", "A3_lowconf"], 42),
> ```
>
> Otherwise they are reachable only via `make demo` or a direct API call.

---

## Frontend

Next.js 16 App Router · React 19 · Tailwind v4 · zustand · motion. No data
library: [useResource.ts](frontend/src/lib/api/useResource.ts) is ~60 lines and
does what this app needs.

### Routes

**Mobile — `/m`, the rep's day (S1–S13)**

| Route | Screen |
| :-- | :-- |
| `/m/login` | login, with quick-select demo accounts |
| `/m` | today's route, ordered by risk |
| `/m/store/[id]/checkin` | consent gate + GPS |
| `/m/store/[id]/category` | pick category and shelf bay |
| `/m/store/[id]/capture` | camera, or upload on desktop |
| `/m/store/[id]/processing` | upload → analyse → poll |
| `/m/store/[id]/result` | OSA score, boxes drawn over the photo |
| `/m/store/[id]/verify` | confirm or reject each gap |
| `/m/store/[id]/tasks` | replenishment tasks |
| `/m/store/[id]/compare` | after-photo, before/after |
| `/m/store/[id]/checkout` | close the visit |
| `/m/captures` | this session's photo log |
| `/m/sync` | the offline queue |

**Web — `/w`, manager and data team (W1–W6)**

| Route | Screen |
| :-- | :-- |
| `/w` | W1 — area overview: KPIs, OSA trend, heatmap |
| `/w/stores/[id]` | W2/W3 — store detail, visit history, evidence viewer |
| `/w/routes` | W4 — route planning |
| `/w/model-health` | W5 — active version, metrics, override rate |
| `/w/relabel` | W6 — the relabel queue |

### The data layer

One rule: **no component calls `fetch` directly.** Every request goes through
[client.ts](frontend/src/lib/api/client.ts), which owns the base URL, the bearer
token, the 15 s timeout, and error normalisation. The single sanctioned exception
is `uploadToStorage` — a presigned URL is signed for exactly one method, key and
content type, so attaching a bearer token or forcing a JSON content type would
invalidate the signature and fail with a mismatch that looks nothing like its
cause.

- **Token in `sessionStorage`, not `localStorage`** — a token that outlives the
  browser tab is a token nobody remembers is there. Expiry is stored alongside
  and checked on every read.
- **401 anywhere fires a `shelfeye:session-expired` event.** The layout guard
  listens and routes to login; the api layer stays free of routing.
- **`AuthGate` is the one place that decides whether a screen may render.** The
  failure mode of per-page checks is that the one page nobody thought about
  renders a row of failing requests instead of a login prompt.
- **Offline is not logged out.** If `/v1/me` fails with OFFLINE or TIMEOUT the
  gate carries on with the locally valid token. Blocking the app would strand a
  rep holding photos they cannot send — the exact failure the queue exists to
  prevent.

### Offline queue

[lib/offline/queue.ts](frontend/src/lib/offline/queue.ts) — hand-written
IndexedDB, one object store and four operations. IndexedDB because it is the
only browser store that takes Blobs, and a 2 MB photo has to survive the tab
being closed. Every queued operation carries the `Idempotency-Key` it will be
replayed with, so a drain interrupted halfway cannot double-count a capture.
Only OFFLINE and TIMEOUT failures are queued — a 403 or a 422 will fail again
just as hard in ten minutes.

---

## ML pipeline

### Dataset

[`roboflow-ngkro/shelf-product`](https://universe.roboflow.com/roboflow-ngkro/shelf-product/dataset/1)
v1 — 1,349 images, 45 classes, pinned by version and archive SHA.

The 108 MB archive is **not in git** (`model/*.zip` is ignored — committing it is
effectively irreversible without a history rewrite). Download it from Roboflow in
YOLOv11 format, place it at `model/shelf-product.v1i.yolov11.zip`, then:

```bash
make dataset      # extracts to model/data/{train,valid,test}
```

`model/artifacts/` is ignored too, so a fresh clone has no weights. **None of
this is needed for mock mode.**

> ⚠️ **These are European coffee aisles.** The source filenames name German
> retailers (Edeka, REWE, tegut). Lighting, shelf density and packaging differ
> substantially from Thai convenience and traditional-trade stores. Metrics on
> this dataset are a **capability proof, not a production-readiness signal** —
> that requires a held-out set of Thai pilot-store photographs, reported side by
> side. Every generated model card leads with this warning.

### Train, evaluate, export, serve

```bash
make train-smoke  # 2 epochs at imgsz 320 — proves the pipeline, measures s/epoch
make train        # full run, detached (hours)
make evaluate     # test split against the promotion gates
make export card  # ONNX opset 17 + model_card.md
make ml           # inference service on :8001
```

`model/configs/` holds one YAML per run, each carrying the reasoning behind its
numbers — including [yolo11n-640.yaml](model/configs/yolo11n-640.yaml), which
documents two failed attempts: batch 16 exhausted unified memory on a 16 GB M2
and throughput collapsed from 14 s/it to 119 s/it; batch 8 fixed that, and then
per-epoch validation became the bottleneck at 193 s/it.

### Promotion gates

The thresholds encode one asymmetry: a **missed gap** is unrecoverable revenue —
the rep has already left the store — while a **false gap** costs thirty seconds
of their time. The operating point is chosen for recall on the gap class.

| Gate | Threshold | Rationale |
| :-- | --: | :-- |
| `recall_empty_shelf` | ≥ 0.90 | a missed gap is unrecoverable; the rep has already left |
| `precision_empty_shelf` | ≥ 0.85 | below this, reps stop trusting alerts and adoption collapses |
| `map50_overall` | ≥ 0.85 | overall detection quality |

In this build the gate **reports rather than blocks**; wiring it into CI as a
hard gate is outstanding work.

### Where the models actually landed

Recorded honestly, gate failures included — a demo that rounded a failing recall
up to a passing one would be worse than useless.

| Artifact | imgsz | mAP@50 | Recall | Gap P | Gap R | Gates |
| :-- | --: | --: | --: | --: | --: | :-- |
| `shelf-product-v1` (yolo11n) | 640 | 0.373 | 0.471 | 0.466 | 0.411 | ❌ |
| `shelf-product-yolo11s-960` | 960 | 0.590 | 0.659 | 0.477 | 0.597 | ❌ |
| `shelf-product-yolo26l-960` | 960 | **0.907** | **0.904** | 0.748 | 0.742 | ❌ |

Overall detection is strong. **The gap class is the bottleneck** — 0.74 recall
against a 0.90 gate — which is exactly the metric the whole product depends on,
and exactly why the gate exists.

### The serving path

`s3://` URI → S3 reader (own credentials) → EXIF-correct load → letterbox →
ONNX Runtime → NMS with per-class thresholds → **un-letterbox back to original
pixels** → class map → `semantic_type` → contract response.

Serving installs from [requirements-serve.txt](model/requirements-serve.txt) —
ONNX Runtime only, no torch, no ultralytics, roughly an order of magnitude
smaller than a training image.

---

## Switching to the real model

```bash
# 1. get an artifact (train, or copy one in)
make train evaluate export card

# 2. record it in model_versions, with its real metrics
make seed          # reads model/artifacts/…/metrics.json — gate failures included

# 3. start the inference service
make ml            # :8001

# 4. the entire switch
sed -i '' 's/ML_CLIENT=mock/ML_CLIENT=http/' backend/.env
make stop api worker
```

Nothing else. If switching ever requires editing a file other than config, the
boundary has leaked and the fix belongs in
[ml_client.py](backend/app/adapters/ml_client.py) — not in the caller.

**Two things worth knowing about step 2.** `make seed` records the trained
artifact with **`is_active = False`**, deliberately: it fails every promotion
gate in its own metrics file, so nothing in this repo promotes it. `mock-v1`
stays the active row, which is what `/w/model-health` displays as
"activeVersion".

And that flag does **not** gate inference. Which model actually serves is
decided entirely by `ML_CLIENT` plus the ML service's own
`MODEL_ARTIFACT_DIR` / `MODEL_VERSION` environment — the API never consults
`model_versions` before inferring. `is_active` is reporting metadata for the
model-health screen. If you want the dashboard to agree with reality after
promoting a model for real, flip the flag yourself:

```bash
docker exec shelfeye-postgres psql -U shelfeye -d shelfeye -c \
  "update model_versions set is_active = (version = 'shelf-product-yolo26l-960');"
```

To point at a different artifact:

```bash
MODEL_ARTIFACT_DIR=$PWD/model/artifacts/shelf-product-yolo11s-960 make ml
```

Whatever `MODEL_VERSION` the service reports is stamped onto every `detections`,
`shelf_analyses` and `gap_findings` row it produces, so historical results stay
attributable no matter how often you switch.

---

## Testing

```bash
make test             # all four suites
make test-contracts   # 21
make test-backend     # 110 (25 unit + 85 integration)
make test-model       # 22
make check-boundary   # fails if the backend ever grows a CV dependency
make lint             # ruff check --fix + ruff format
```

| Suite | Count | Needs |
| :-- | --: | :-- |
| `contracts/` — Pydantic ↔ OpenAPI parity | 21 | nothing |
| `backend/tests/unit` — OSA engine, mock ML | 25 | nothing |
| `backend/tests/integration` — API, authz, prohibitions | 85 | `make infra migrate` |
| `model/tests` — class map, letterbox, decode | 22 | nothing |

Integration tests run Celery in **eager mode** against the compose stack, so a
full check-in-to-checkout path executes inline in the test process — no broker,
no worker, no running API server. The conftest sets `ML_CLIENT=mock` before the
app is imported, so your `backend/.env` is irrelevant to them — unless you have
exported `ML_CLIENT` in the shell, which wins.

`make check-boundary` greps both `backend/app` and `backend/requirements.txt` for
torch, ultralytics, opencv and tensorflow. It is the mechanical enforcement of
the architecture's central claim.

---

## Development guide

### Change an OSA threshold

Edit `backend/.env` (or the default in
[config.py](backend/app/core/config.py)) — **and bump `ANALYSIS_CONFIG_VERSION`**.
Every `shelf_analyses` row stamps the version that produced it, which is what
keeps a finding from three months ago explainable under the rules in force when
it was made. Then `make stop api worker`.

### Add an endpoint

1. Request/response models in [api/v1/schemas.py](backend/app/api/v1/schemas.py)
   — camelCase aliases on the wire.
2. A router module in `api/v1/`, registered in
   [main.py](backend/app/main.py). If the whole module is management-only,
   define one `require_roles(...)` guard at module level and apply it to every
   handler — as `analytics.py` and `model_health.py` do — so the next endpoint
   added there inherits the check rather than inventing its own.
3. Business logic goes in `services/` — pure where it can be. The HTTP layer
   holds no rules.
4. An integration test in `backend/tests/integration/`.
5. Frontend: a module in `lib/api/`, mapping wire → domain types from
   `types/index.ts`. Never `fetch` from a component.

### Add a database column

```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "what changed"
# read the generated file before running it
make migrate
```

Remember `detections` and `shelf_analyses` are append-only. If a change implies
updating historical rows, that is a signal the change is wrong.

### Add a mobile screen

Add a route under `frontend/src/app/m/`, wrap in `MobileShell`, read visit-scoped
state from `useDemo` (`lib/store.ts`). If the screen performs an action a rep
could take with no signal, route it through `tryEnqueue` so it lands in the
offline queue instead of failing.

### Retrain

Add a config to `model/configs/` **with a comment explaining why its numbers are
what they are** — every existing config does, and that is what makes the run log
readable a month later. Then `make train evaluate export card`, and `make seed`
to record the new version.

### Conventions

- **Python**: ruff, line length from [pyproject.toml](backend/pyproject.toml),
  `from __future__ import annotations` everywhere, `structlog` for logging (never
  `print`, never log a token).
- **TypeScript**: strict mode, `@/` path alias, all user-facing copy in Thai.
- **Comments explain *why*, never *what*.** The codebase is dense with rationale
  for decisions that look arbitrary — follow that; a comment restating the code
  is worse than none.
- **Commits**: `feat:`, `fix:`, `docs:`, `chore:`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| :-- | :-- | :-- |
| Every capture fails after ~40 s | `ML_CLIENT=http` with nothing on :8001 | set `ML_CLIENT=mock` in `backend/.env`, then `make stop api worker` |
| `.env` edit had no effect | `get_settings()` is `@lru_cache`d per process | `make stop api worker` — restart both, not just the API |
| Every store reads 100% OSA, "0 days since visit" | the dev database has hundreds of captures | `make reset-db` |
| Job stuck at QUEUED forever | worker not running, or Redis down | `make worker`; check `docker ps` for `shelfeye-redis` |
| `make demo` connection refused | API not running | `make api`, then `curl -s localhost:8000/healthz` |
| Upload 403 / signature mismatch | `S3_PUBLIC_ENDPOINT_URL` is not what the browser can reach | it must be the URL the *browser* resolves, not the one the API uses |
| App blank on a phone over the LAN | dev server rejecting the origin | use `npm run dev:mobile`; check `allowedDevOrigins` in `next.config.ts` |
| CORS error from the phone | `NEXT_PUBLIC_API_URL` was set to a LAN IP | unset it and let the Next rewrite proxy `/v1/*` |
| Camera button does nothing | not a secure context | HTTPS is required; on desktop use "อัปโหลดรูปแทน" |
| `make dataset` fails | the 108 MB zip is not in git | download it from Roboflow to `model/shelf-product.v1i.yolov11.zip` |
| `make ml` starts but `/readyz` is 503 | `MODEL_ARTIFACT_DIR` has no `best.onnx` | `make export`, or point at an artifact that has one |
| Port 5432 conflict | you are looking at the wrong postgres | this project uses **5433** |

Logs live in `backend/.logs/{api,worker}.log` and `model/.logs/ml.log`.
`devrun.py` deliberately stops only its own services — globbing `*.pid` would
also kill the ML service, which is how a "restart the backend" once turned into
an ML outage.

---

## What this system will not do

Enforced by
[test_prohibitions.py](backend/tests/integration/test_prohibitions.py), not by
convention.

- **No per-rep metrics.** No leaderboard, no per-rep score, no `GROUP BY
  user_id`. Aggregation is at store and area level only. *If the score is tied to
  an individual, reps photograph only flattering angles and the entire dataset
  becomes worthless.* A labour-rights constraint agreed at design stage, not a
  missing feature. A ticket asking for per-rep scoring should be escalated, not
  implemented.
- **No automated competitor-price response.** Price-tag data surfaces only in
  aggregate. No endpoint or job emits near-real-time competitor prices to a
  pricing system. Competition-law guardrail.
- **No face recognition.** No identification, matching, or embedding storage.
- **No exact unit counts.** Occlusion, stacked facings and promo signage make
  piece-counting unreliable; area-share metrics degrade gracefully instead.
- **An empty result is never a perfect shelf.** "No gaps found" and "nothing
  found at all" are different answers, and conflating them would poison every
  trend built on this data.

---

## Documentation

| Document | Contents |
| :-- | :-- |
| **[docs/running.md](docs/running.md)** | **คู่มือการรันโปรเจกต์** — setup, การใช้งานประจำวัน, ทดสอบบนมือถือ, แก้ปัญหา |
| [contracts/inference-v1.yaml](contracts/inference-v1.yaml) | the inference contract — normative |
| [docs/backend.md](docs/backend.md) · [docs/ui.md](docs/ui.md) | original requirements |
