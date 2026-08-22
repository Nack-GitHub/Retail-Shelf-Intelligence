# Task List: ShelfEye Backend + ML

> Plan: [tasks/plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md)
> Mode: **DEMO** · ⛔ no `git push` · ⛔ no deleting other containers

Legend — scope: **XS** 1 file · **S** 1–2 · **M** 3–5 · **L** 5–8

---

## Phase 1 — Foundation

### - [ ] T1: Repo skeleton + Docker Compose on non-conflicting ports
**Description:** Create the three-service directory layout, `.gitignore`, `Makefile`, and a compose file for postgres/redis/minio. Host ports are shifted so the running `postgres-hrm` container is untouched.

**Acceptance:**
- [ ] `contracts/`, `backend/`, `model/` skeletons exist
- [ ] `.gitignore` covers `model/data/`, `model/artifacts/`, `.venv/`, `.env`, `__pycache__/`, `.DS_Store`
- [ ] Compose maps postgres→5433, redis→6380, minio→9000/9001; project name `shelfeye`

**Verify:** `docker compose up -d postgres redis minio` → all healthy; `docker ps` still shows `postgres-hrm` running untouched
**Depends on:** None · **Scope:** M

### - [ ] T2: Contracts package — OpenAPI 3.1 + Pydantic models
**Description:** `contracts/inference-v1.yaml` plus `shelfeye_contracts` Pydantic models, installable by both services. Bbox fields document "absolute pixels, top-left origin" explicitly.

**Acceptance:**
- [ ] `InferRequest`, `InferResponse`, `Detection`, `BBox`, `SemanticType`, `InferErrorCode` defined
- [ ] YAML documents 200/422/503 plus `/models`, `/healthz`, `/readyz`
- [ ] `pip install -e ./contracts` works from a clean venv

**Verify:** `pytest contracts/tests -q` — parity test asserts every Pydantic field exists in the YAML schema and vice versa
**Depends on:** T1 · **Scope:** M

> ### ✅ Checkpoint A — Foundation
> - [ ] Compose stack healthy on shifted ports; no pre-existing container disturbed
> - [ ] Contracts package installs and its parity test passes

---

## Phase 2 — ML kickoff (long pole, starts early)

### - [ ] T3: ML scaffold, dataset extraction, class map
**Description:** `model/` venv and requirements, extract the zip to `model/data/`, rewrite `data.yaml` paths, and author `class_map.yaml` mapping all 45 classes to `SemanticType`.

**Acceptance:**
- [ ] `make dataset` is idempotent; `model/data/{train,valid,test}` populated (1147/138/67)
- [ ] `class_map.yaml`: id 19→GAP, 31→PRICE_TAG, 18→PROMO_TAG, other 42→PRODUCT
- [ ] Zip SHA256 + Roboflow version 1 recorded for the model card

**Verify:** `pytest model/tests/test_class_map.py -q` — asserts all 45 ids mapped, exactly one GAP class, counts match `data.yaml`
**Depends on:** T1 · **Scope:** M

### - [ ] T4: Training pipeline + smoke run (measure epoch time)
**Description:** `shelfeye_ml/training/train.py` driven by YAML configs, with augmentation tuned per SPEC §7.2 (**`flipud: 0.0` — shelves have fixed gravity**). Run `configs/smoke.yaml` to prove the pipeline and measure real seconds/epoch on this M2.

**Acceptance:**
- [ ] Smoke config (2 epochs, imgsz 320) completes and writes `artifacts/<run>/`
- [ ] Measured sec/epoch recorded; full-run `epochs`/`imgsz` chosen from it, not guessed
- [ ] Run manifest captures git SHA, dataset version, config

**Verify:** smoke run exits 0, `best.pt` exists, MPS confirmed active (or CPU fallback logged)
**Depends on:** T3 · **Scope:** M

### - [ ] T5: ⏳ Launch full training in background
**Description:** Kick off the real run with parameters chosen in T4. **Runs for hours while Phases 3–4 proceed.** Export ONNX opset 17 and write `model_card.md` when it lands.

**Acceptance:**
- [ ] Training launched detached; log tailable
- [ ] On completion: `best.pt`, `best.onnx`, `metrics.json`, `model_card.md`
- [ ] Model card leads with the **European-dataset domain-gap warning** and reports **per-class** precision/recall for `Empty Shelf` — never the mAP average alone

**Verify:** ONNX parity — same image through `.pt` and `.onnx` agrees within tolerance
**Depends on:** T4 · **Scope:** S (but hours of wall time)

> ### ✅ Checkpoint B — Training underway
> - [ ] Background training running and logging
> - [ ] Backend work can proceed with zero ML dependency

---

## Phase 3 — Backend foundation

### - [ ] T6: Backend scaffold — config, logging, health
**Description:** FastAPI app, layered package structure, `pydantic-settings` config, `structlog` JSON logging with `request_id` middleware, `/healthz`. `requirements.txt` contains **no CV library**.

**Acceptance:**
- [ ] `GET /healthz` → 200 with version
- [ ] Every log line carries `request_id`
- [ ] All thresholds live in `core/config.py`; no numeric business literal elsewhere

**Verify:** `grep -rE 'torch|ultralytics|cv2|tensorflow' backend/app backend/requirements.txt` → **no matches**
**Depends on:** T2 · **Scope:** M

### - [ ] T7: Schema, migration, seed
**Description:** SQLAlchemy 2.x async models for all 13 tables, one initial Alembic migration, and a seed script producing the admin user plus stores/categories matching the frontend's mock.

**Acceptance:**
- [ ] `alembic upgrade head` succeeds on an empty DB
- [ ] `detections`/`shelf_analyses` carry `model_version`; no UPDATE/DELETE path exists in their repositories
- [ ] Compliance columns present but **nullable, ungated** (PDPA deferred)
- [ ] `make seed` creates admin + stores whose ids/names match `frontend/src/lib/mock/data.ts`

**Verify:** `alembic upgrade head && alembic downgrade base && alembic upgrade head` round-trips clean
**Depends on:** T6 · **Scope:** L

> ### ✅ Checkpoint C — Backend foundation
> - [ ] Migration round-trips; seed populates; `/healthz` green; no CV imports

---

## Phase 4 — Vertical slices

### - [ ] T8: Auth — login, JWT, RBAC
**Description:** `POST /v1/auth/login`, `GET /v1/me`, bearer dependency, role guard for `REP|MANAGER|ADMIN|DATA`.

**Acceptance:**
- [ ] Login returns an 8h access token; bad credentials → 401
- [ ] A `REP` token is rejected from a `MANAGER`-only route with 403

**Verify:** `pytest backend/tests/integration/test_auth.py -q`
**Depends on:** T7 · **Scope:** S

### - [ ] T9: ⭐ OSA rules engine (pure) + 6 fixtures
**Description:** `services/shelf_analysis.py` — filter, row-cluster, per-row and image-level metrics, gap findings with Thai position labels. **Zero I/O, zero framework imports, zero clock reads.** Built before its callers because it is the riskiest logic and needs no infrastructure.

**Acceptance:**
- [ ] All 6 fixtures pass: full shelf · one large gap · tilted overlapping rows · price tags only · **empty list** · single-row close-up
- [ ] Empty/filtered-out detections raise `NoShelfDetectedError` — **never `osa=1.0`**
- [ ] `PRICE_TAG`/`PROMO_TAG` excluded from all area math
- [ ] Every threshold read from `AnalysisConfig`; `config_version` stamped on output

**Verify:** `pytest backend/tests/unit/test_shelf_analysis.py -q` with **no services running**; `grep -E 'fastapi|sqlalchemy|celery' backend/app/services/shelf_analysis.py` → no matches
**Depends on:** T6 · **Scope:** M

### - [ ] T10: MockMLClient + MinIO storage adapter
**Description:** `MLClient` protocol with `MockMLClient` (seeded by `sha256(image_uri)`) and `HttpMLClient`, selected by `ML_CLIENT`. Storage adapter issues presigned PUT/GET.

**Acceptance:**
- [ ] Filename scenarios work: `*_full` · `*_gaps` · `*_lowconf` · `*_unreadable`→422 · `*_slow`→12s · `*_error`→503
- [ ] Same `image_uri` yields byte-identical detections across processes
- [ ] `adapters/ml_client.py` is the only backend file naming the ML service

**Verify:** `pytest backend/tests/unit/test_mock_ml.py -q` — determinism asserted across a subprocess boundary
**Depends on:** T6 · **Scope:** M

### - [ ] T11: Route + visit check-in slice
**Description:** `GET /v1/routes/today` (sorted risk DESC, distance ASC) and `POST /v1/visits`.

**Acceptance:**
- [ ] Route response carries `lastOsa`, `daysSinceLastVisit`, `riskBand` in **camelCase**
- [ ] GPS mismatch sets `gpsMatch=false` but **does not block** check-in
- [ ] `store.photoPolicy=FORBIDDEN` → 403

**Verify:** `pytest backend/tests/integration/test_visits.py -q`
**Depends on:** T8 · **Scope:** M

### - [ ] T12: ⭐ Capture → job → result (the golden path)
**Description:** `POST /v1/captures/presign` → direct PUT to MinIO → `POST /v1/captures/{id}/commit` (Idempotency-Key, 202) → Celery `analyze_capture` → detections + analysis + findings persisted → `GET /v1/jobs/{id}` → `GET /v1/captures/{id}/result`.

**Acceptance:**
- [ ] Image bytes never pass through the API process
- [ ] Commit is idempotent — replaying the key returns the same `jobId`, creates no second job
- [ ] ML 422 → job `FAILED`/`UNREADABLE_IMAGE`, **no retry**; 503 → 3 retries at 2/8/32s
- [ ] Result payload matches `ShelfAnalysis` in `frontend/src/types/index.ts` field-for-field

**Verify:** `pytest backend/tests/integration/test_capture_pipeline.py -q` — asserts both the happy path and the two error paths
**Depends on:** T9, T10, T11 · **Scope:** L

### - [ ] T13: Verify → task → checkout slice
**Description:** `POST /v1/findings/{id}/verify`, `GET /v1/visits/{id}/tasks`, `PATCH /v1/tasks/{id}`, `POST /v1/visits/{id}/checkout`, `POST /v1/sync/batch`.

**Acceptance:**
- [ ] `CONFIRMED` creates a task; `REJECTED` records the reason; both write `audit_log`; verify is idempotent
- [ ] `blockedReason=OUT_OF_BACKSTOCK` auto-creates a `replenishment_request`
- [ ] Checkout computes `osaAfter` from AFTER-phase captures and closes the visit
- [ ] `sync/batch` is safe to replay with an identical payload

**Verify:** `pytest backend/tests/integration/test_verify_tasks.py -q`
**Depends on:** T12 · **Scope:** L

### - [ ] T14: Manager analytics (read-only)
**Description:** `GET /v1/analytics/osa`, `/analytics/risk-ranking`, `/stores/{id}/history`, `/evidence/{finding_id}`.

**Acceptance:**
- [ ] Aggregation at **STORE and AREA level only**
- [ ] ⛔ **No `user_id` in any GROUP BY, no per-rep field in any response** — asserted by a test
- [ ] Evidence returns a signed URL + overlay data (PDF export stays out of scope)

**Verify:** `pytest backend/tests/integration/test_analytics.py -q` including the no-per-rep grep test
**Depends on:** T13 · **Scope:** M

> ### ✅ Checkpoint D — Backend complete on mock
> - [ ] Golden path passes end-to-end with `ML_CLIENT=mock`
> - [ ] Full suite green; ruff clean
> - [ ] No CV import, no raw class name, no per-rep aggregation anywhere

---

## Phase 5 — Real model

### - [ ] T15: Inference service over trained ONNX
**Description:** FastAPI + ONNX Runtime implementing the contract. Warm-up inference at boot; `/readyz` 503 until warm. Reads the image from the object-store URI. Converts to **absolute pixels** and attaches `semantic_type` from the artifact's class map.

**Acceptance:**
- [ ] `POST /internal/v1/infer` conforms to `inference-v1.yaml`
- [ ] Letterbox coordinates correctly reversed to original image space
- [ ] Nothing detected → **422 `NO_SHELF_DETECTED`**, never a perfect shelf
- [ ] `/readyz` 503 before warm-up completes, 200 after

**Verify:** `pytest model/tests/test_serving.py -q`; response validated against the shared Pydantic models
**Depends on:** T5, T2 · **Scope:** L

### - [ ] T16: 🔀 The flip — `ML_CLIENT=mock` → `http`
**Description:** Point the backend at the real service. **The measure of success for the whole separation exercise: this must be an env var and nothing else.**

**Acceptance:**
- [ ] Golden path passes against real inference with **zero business-logic files changed**
- [ ] `git diff` for the flip touches only `.env` / compose
- [ ] A real shelf photo returns a plausible OSA score with drawable boxes

**Verify:** run the golden path under both profiles; diff the changed file list
**Depends on:** T15, T12 · **Scope:** XS

> ### ✅ Checkpoint E — Real model wired
> - [ ] One env var was the entire change

---

## Phase 6 — Verify and ship

### - [ ] T17: Golden-path integration test + full suite
**Description:** One test walking check-in → presign → commit → job → result → verify → task → after-capture → checkout, plus the full suite and lint.

**Acceptance:**
- [ ] Golden path green under `ML_CLIENT=mock`
- [ ] `ruff check` clean; services/ coverage ≥ 90%

**Verify:** `make test`
**Depends on:** T14 · **Scope:** M

### - [ ] T18: Review, fix, ship checklist
**Description:** Five-axis review, fix what it finds (**loop back to build if needed**), then the ship checklist. Local commits only.

**Acceptance:**
- [ ] All 12 SPEC §11 success criteria checked
- [ ] `README.md` documents run-from-scratch in the demo order
- [ ] Review findings fixed or explicitly deferred with a reason
- [ ] ⛔ **Nothing pushed**; ⛔ no foreign container removed

**Verify:** `make test` green after fixes; `git log` shows local commits and `git status` shows no push
**Depends on:** T17, T16 · **Scope:** M

> ### ✅ Checkpoint F — Done
> - [ ] Demo runnable from a clean checkout with documented commands
