# Backend Architecture & Developer Prompts

## ShelfEye — Shelf Gap Detection & Replenishment (Candidate 1)

**Dataset ที่ใช้:** [`roboflow-ngkro/shelf-product`](https://universe.roboflow.com/roboflow-ngkro/shelf-product) — 1,349 ภาพ, 45 คลาส (SKU กาแฟ + `Empty Shelf`, `Price`, `Discount Price`), pretrained mAP@50 = 90.5%

---

## 0. หลักการแยกระบบ (อ่านก่อนเริ่มงาน)

ระบบแบ่งเป็น **2 repo อิสระ** ที่คุยกันผ่าน **สัญญาเดียว (Inference Contract)** เท่านั้น

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  REPO A: shelfeye-api    │         │  REPO B: shelfeye-ml     │
│  (Backend Team)          │         │  (ML Team)               │
│                          │         │                          │
│  • Auth / Visit / Task   │  HTTP   │  • Training pipeline     │
│  • Business rules (OSA)  │ ──────► │  • Model registry        │
│  • Storage / Queue       │ ◄────── │  • Inference server      │
│  • Analytics / Evidence  │  JSON   │  • Eval & promote gate   │
│                          │         │                          │
│  ❌ ห้าม import torch    │         │  ❌ ห้ามรู้จัก store/user │
│  ❌ ห้ามรู้ชื่อคลาสโมเดล │         │  ❌ ห้ามคำนวณ OSA        │
└──────────────────────────┘         └──────────────────────────┘
```

### กฎเหล็ก 4 ข้อของการแยก

1. **Backend ไม่มีโค้ด ML แม้แต่บรรทัดเดียว** — ไม่มี `torch`, `ultralytics`, `opencv` ใน `requirements.txt` ของ repo A ถ้าต้องแก้โมเดล ต้องไม่ deploy backend ใหม่
2. **ML service ไม่รู้จักคำว่า "ร้าน" หรือ "OSA"** — รับ image URI คืน bounding boxes จบ ไม่มี business logic
3. **การคำนวณ OSA และ threshold อยู่ฝั่ง Backend** — เพราะ "ต่ำกว่า 75% ถือว่าวิกฤต" คือ _กฎธุรกิจ_ ที่ฝ่ายการตลาดจะขอเปลี่ยนเดือนละครั้ง ไม่ควรต้อง retrain โมเดลเพื่อเปลี่ยนตัวเลขนี้
4. **ทุก detection record ต้องผูกกับ `model_version`** — เพื่อให้ตอบคำถาม Governance ได้ว่า "ผลตรวจเมื่อ 3 เดือนก่อนมาจากโมเดลตัวไหน" และเมื่อ promote โมเดลใหม่ ผลเก่าต้องไม่ถูกเขียนทับ

### สิ่งที่ต้องทำเป็นอันดับแรกสุด

ให้ทั้งสองทีม **ตกลง Inference Contract ก่อน** แล้วฝั่ง Backend สร้าง **Mock ML Service** ทันที เพื่อให้ทั้งสองทีมทำงานคู่ขนานได้โดยไม่ต้องรอกัน

---

# ส่วนที่ 1: Inference Contract (สัญญาระหว่าง 2 ทีม)

> **Prompt C1 — ให้ทั้งสองทีมใช้ร่วมกัน**

```
Create a shared interface contract package that BOTH the backend service
and the ML service depend on. This is the ONLY coupling point between the
two repositories.

Deliverables:
1. An OpenAPI 3.1 spec file `contracts/inference-v1.yaml`
2. Pydantic models generated from it, published as a small installable
   package `shelfeye-contracts`
3. A mock server implementing the contract with deterministic fake data

## THE CONTRACT

POST /internal/v1/infer
Request:
{
  "image_uri": "s3://shelfeye-raw/2026/08/22/cap_01J8X...jpg",
  "request_id": "uuid",
  "model_version": "shelf-product-v3"   // optional; omit = use active model
}

Response 200:
{
  "request_id": "uuid",
  "model_version": "shelf-product-v3",
  "model_sha": "a1b2c3d4",
  "inference_ms": 340,
  "image_width": 1920,
  "image_height": 1080,
  "detections": [
    {
      "detection_id": "uuid",
      "class_id": 19,
      "class_name": "Empty Shelf",
      "semantic_type": "GAP",        // PRODUCT | GAP | PRICE_TAG | PROMO_TAG
      "bbox": {"x": 120, "y": 340, "w": 88, "h": 210},   // absolute pixels
      "confidence": 0.87
    }
  ]
}

Response 422: image unreadable / no shelf detected
Response 503: model not loaded / warming up

GET /internal/v1/models      → list available model versions + active one
GET /internal/v1/healthz     → liveness
GET /internal/v1/readyz      → model loaded and warm

## CRITICAL DESIGN RULE
The `semantic_type` field is the ONLY thing the backend is allowed to
branch on. The backend must NEVER hardcode a raw `class_name` such as
"Empty Shelf" or "FM Bohne" in its business logic, because the training
dataset's 45 class names will change every time the model is retrained on
new SKUs. The ML service owns the mapping from class_name to semantic_type
and ships it inside the model artifact.

Bounding boxes are ALWAYS absolute pixels in the original image
coordinate space, top-left origin. Never normalized. Never YOLO format.
Document this explicitly in the spec — it is the single most common
integration bug in this kind of system.
```

---

# ส่วนที่ 2: Backend API Prompts (REPO A)

## Prompt B1 — Scaffolding & Architecture

```
Set up a production-grade Python backend service named `shelfeye-api`.

## STACK
- FastAPI + Uvicorn, Python 3.12
- PostgreSQL 16 (SQLAlchemy 2.x async + Alembic migrations)
- Redis + Celery for the async job pipeline
- MinIO / S3 for image object storage
- Docker Compose for local dev (api, worker, postgres, redis, minio, mock-ml)

## LAYERED ARCHITECTURE — enforce this strictly
  app/
    api/v1/          # FastAPI routers — HTTP only, no business logic
    services/        # business logic (pure, testable, no FastAPI imports)
    domain/          # entities, value objects, enums
    repositories/    # data access, one per aggregate
    adapters/        # ml_client, storage_client, notification_client
    workers/         # celery tasks
    core/            # config, security, logging, exceptions

## HARD CONSTRAINTS
- `requirements.txt` MUST NOT contain torch, ultralytics, opencv,
  tensorflow, or any CV library. All inference happens over HTTP to the
  ML service via `adapters/ml_client.py`.
- `adapters/ml_client.py` is the ONLY file allowed to know the ML service
  exists. It depends on the `shelfeye-contracts` package.
- Include a `MockMLClient` implementation selected by env var
  `ML_CLIENT=mock`, so the whole backend can be developed and tested with
  zero ML infrastructure running.
- Structured JSON logging with a `request_id` propagated end-to-end,
  including into the ML service call.
- Config via pydantic-settings, all business thresholds are config values,
  never literals in code.
```

## Prompt B2 — Data Model & Migrations

```
Design the PostgreSQL schema and Alembic migrations for shelfeye-api.

## TABLES

users(id, email, hashed_password, role[REP|MANAGER|ADMIN|DATA],
      area_id, created_at, is_active)

stores(id, external_code, name, chain, store_format[HYPER|SUPER|CVS|TRAD],
       area_id, lat, lng, photo_policy[ALLOWED|RESTRICTED|FORBIDDEN],
       created_at)

visits(id, store_id, user_id, checked_in_at, checked_out_at,
       gps_lat, gps_lng, gps_match BOOLEAN,
       photo_consent_confirmed BOOLEAN NOT NULL,
       osa_before NUMERIC, osa_after NUMERIC, status)

captures(id, visit_id, category, shelf_bay_label,
         object_key, image_width, image_height,
         phase[BEFORE|AFTER],
         face_blur_applied BOOLEAN NOT NULL,
         face_blur_count INT,
         captured_at, device_info JSONB,
         client_idempotency_key UNIQUE,
         retention_expires_at TIMESTAMPTZ NOT NULL)

inference_jobs(id, capture_id, status[QUEUED|RUNNING|DONE|FAILED],
               model_version, attempts, error_code, error_detail,
               queued_at, started_at, finished_at, inference_ms)

detections(id, capture_id, model_version, class_id, class_name,
           semantic_type, bbox_x, bbox_y, bbox_w, bbox_h,
           confidence, shelf_row_index)

shelf_analyses(id, capture_id, model_version, row_count,
               total_shelf_area, gap_area, gap_ratio, osa_score,
               status[OK|LOW|CRITICAL], config_version, computed_at)

gap_findings(id, capture_id, detection_id, shelf_row_index,
             position_label, confidence, is_low_confidence,
             verification_status[PENDING|CONFIRMED|REJECTED],
             rejected_reason, verified_by, verified_at)

tasks(id, visit_id, gap_finding_id, sku_code, priority,
      status[OPEN|FIXED|BLOCKED], blocked_reason,
      after_capture_id, completed_at)

replenishment_requests(id, store_id, sku_code, source_task_id,
                       quantity_hint, status, created_at)

model_versions(id, version, sha, source_dataset, dataset_version,
               metrics JSONB, promoted_at, promoted_by, is_active,
               model_card_uri)

audit_log(id, actor_id, actor_role, action, entity_type, entity_id,
          before JSONB, after JSONB, ip, created_at)

## RULES
- `detections` and `shelf_analyses` are APPEND-ONLY. Re-running inference
  with a new model version inserts new rows; it NEVER updates or deletes
  old ones. Findings must remain reproducible for contract disputes.
- Partition `detections` by month — one shelf photo can produce 200+ rows
  and this table will dominate storage.
- Index: captures(visit_id), detections(capture_id),
  gap_findings(verification_status) WHERE status='PENDING',
  visits(store_id, checked_in_at DESC), stores using GIST(lat,lng).
- `captures.retention_expires_at` defaults to captured_at + 90 days
  (config-driven) — this drives the PDPA deletion job.
- Add a CHECK constraint: a visit cannot have captures unless
  photo_consent_confirmed = true.
```

## Prompt B3 — Core API Endpoints

```
Implement the REST API for shelfeye-api. All endpoints under /v1.
JWT auth with refresh tokens, role-based access control.

## FIELD REP ENDPOINTS

GET  /v1/routes/today
     → stores assigned today, sorted by (risk_score DESC, distance ASC).
       Response includes last_osa, days_since_last_visit, risk_band.

POST /v1/visits
     Body: {store_id, gps_lat, gps_lng, photo_consent_confirmed}
     → 201 with visit_id.
     ⚠️ REJECT with 422 if photo_consent_confirmed is false.
     ⚠️ REJECT with 403 if store.photo_policy = FORBIDDEN.
     Set gps_match = distance(gps, store) < 150m. Do NOT block on a GPS
     mismatch — reps legitimately stand outside sometimes — but flag it
     on the record for the evidence trail.

POST /v1/captures/presign
     Body: {visit_id, category, shelf_bay_label, phase, content_type}
     → {capture_id, upload_url, object_key, expires_in}
     Presigned PUT direct to object storage. The image bytes must NEVER
     pass through the API process.

POST /v1/captures/{capture_id}/commit
     Headers: Idempotency-Key (required)
     Body: {image_width, image_height, face_blur_applied,
            face_blur_count, captured_at, device_info}
     → 202 Accepted {job_id}
     ⚠️ REJECT with 422 if face_blur_applied = false. The mobile client is
       required to blur faces on-device before upload. If a legacy client
       cannot, the server must run a fallback blur job and record that it
       did — but it must never store an unblurred image as the canonical
       asset.
     Enqueues the inference job and returns immediately.

GET  /v1/jobs/{job_id}
     → {status, progress_hint, result_url?}  (client polls every 500ms)

GET  /v1/captures/{capture_id}/result
     → {osa_score, status, gap_ratio, row_count,
        detections: [...], gap_findings: [...], model_version,
        low_confidence_count}

POST /v1/findings/{finding_id}/verify
     Body: {verdict: CONFIRMED|REJECTED, reason?}
     → creates tasks for CONFIRMED findings; pushes REJECTED findings into
       the relabel queue. Writes to audit_log. Idempotent.

GET  /v1/visits/{visit_id}/tasks
PATCH /v1/tasks/{task_id}
     Body: {status: FIXED|BLOCKED, blocked_reason?, after_capture_id?}
     If blocked_reason = OUT_OF_BACKSTOCK → auto-create a
     replenishment_request.

POST /v1/visits/{visit_id}/checkout
     → computes osa_after from AFTER-phase captures, closes the visit,
       returns the summary payload.

POST /v1/sync/batch
     Offline queue drain. Accepts an array of operations, each with its own
     Idempotency-Key. Processes them in order, returns per-item success or
     failure. Must be safe to call repeatedly with the same payload.

## MANAGER ENDPOINTS

GET /v1/analytics/osa?scope=area|store&area_id=&store_id=&from=&to=&granularity=
GET /v1/analytics/risk-ranking?area_id=
GET /v1/stores/{store_id}/history
GET /v1/evidence/{finding_id}   → signed URL + metadata + overlay data
POST /v1/findings/{finding_id}/dispute

## ⛔ ABSOLUTE PROHIBITION
Do NOT implement ANY endpoint that aggregates, ranks, or scores metrics by
`user_id`. There must be no /v1/analytics/reps, no per-rep leaderboard, no
rep performance field in any response schema. Aggregation is permitted at
STORE and AREA level only. If a future ticket requests per-rep scoring,
escalate it rather than implementing it — this is a labour-rights
constraint agreed at the design stage, not a missing feature.
Reason: if the score is tied to individual performance, reps will
photograph only flattering angles and the entire dataset becomes worthless.
```

## Prompt B4 — Async Inference Pipeline

```
Implement the asynchronous analysis pipeline in shelfeye-api using Celery.

## FLOW
capture committed
  → enqueue `analyze_capture(capture_id)`
  → worker resolves the image object key to a URI
  → calls MLClient.infer(image_uri, request_id)
  → persists raw detections (append-only)
  → runs ShelfAnalysisService (pure business logic, see prompt B5)
  → persists shelf_analysis + gap_findings
  → marks job DONE and publishes a push notification to the device

## RESILIENCE REQUIREMENTS
- Retries: 3 attempts, exponential backoff (2s, 8s, 32s), only on 5xx or
  timeout. A 422 from the ML service is NOT retryable — mark the job
  FAILED with error_code=UNREADABLE_IMAGE and surface a user-facing
  message telling the rep to retake the photo.
- Timeout: 15s per inference call, hard.
- Circuit breaker on the ML service: after 5 consecutive failures, open the
  circuit for 60s and fail fast with a clear error rather than queueing
  thousands of doomed jobs.
- Dead-letter queue for jobs that exhaust retries, with an admin endpoint
  to inspect and requeue.
- The queue must handle burst load: reps start their routes at roughly the
  same hour, so expect ~70% of the day's volume in a 3-hour window.
  Configure worker concurrency and a separate high-priority queue for
  captures belonging to an ACTIVE visit (the rep is standing there waiting)
  versus a low-priority queue for offline batch syncs (nobody is waiting).

## OBSERVABILITY
Emit metrics: job_queue_depth, inference_latency_p50/p95/p99,
end_to_end_latency (commit → result available), ml_error_rate by code.
The p95 of end_to_end_latency is the single most important operational
metric in this system — the product only creates value if the rep gets
the result while still standing in front of the shelf. Alert if p95 > 10s.
```

## Prompt B5 — OSA Business Rules Engine

```
Implement `services/shelf_analysis.py` — a PURE function module with no I/O,
no database, no HTTP. Input: a list of detections + a config object.
Output: a ShelfAnalysis value object. It must be fully unit-testable with
fixture JSON and must contain zero framework imports.

## ALGORITHM

Step 1 — Filter
  Keep detections where confidence >= config.min_confidence (default 0.35).
  Flag detections between 0.35 and config.low_confidence_threshold (0.55)
  as is_low_confidence = true.

Step 2 — Row clustering
  Group detections into shelf rows by the y-coordinate of each box centre.
  Use 1-D agglomerative clustering with a distance threshold of
  config.row_tolerance_ratio (default 0.6) × median box height.
  Sort rows top to bottom, assign shelf_row_index starting at 1.
  Rationale: a shelf photo is a grid, and the vertical gaps between rows
  are far larger than the vertical jitter within a row.

Step 3 — Per-row metrics
  For each row:
    product_area = Σ area of detections where semantic_type = PRODUCT
    gap_area     = Σ area of detections where semantic_type = GAP
    row_gap_ratio = gap_area / (product_area + gap_area)
  Ignore PRICE_TAG and PROMO_TAG detections in all area math.

Step 4 — Image-level OSA
  gap_ratio = Σ gap_area / Σ (product_area + gap_area)
  osa_score = 1 - gap_ratio
  status = CRITICAL if osa_score < config.critical_threshold (0.75)
           LOW      if osa_score < config.low_threshold (0.90)
           OK       otherwise

Step 5 — Gap findings
  Emit one finding per GAP detection, with a human-readable position_label
  derived from the row index and horizontal thirds:
  e.g. "ชั้นที่ 2 · ตำแหน่งซ้าย" / "ชั้นที่ 3 · ตำแหน่งกลาง".
  Findings whose source detection is_low_confidence must be marked so the
  UI can render them as "ต้องตรวจสอบ" instead of asserting them as fact.

## WHY THIS LIVES IN THE BACKEND, NOT THE MODEL
Every threshold above is a business decision that trade marketing will
want to change without a model release. Store them in a versioned config
table and stamp `config_version` onto every shelf_analysis row so historic
results remain explainable.

## MEASUREMENT CAVEAT TO ENCODE
Do not attempt to report an exact unit count of products. Occlusion,
stacked facings and promotional signage make piece-counting unreliable.
Report area-share metrics (gap_ratio, osa_score) which degrade gracefully
under occlusion. If a future requirement asks for exact piece counts,
push back with this rationale.

## TESTS REQUIRED
Fixtures for: a full shelf (osa=1.0), a shelf with one large gap,
a badly tilted photo where rows overlap, an image with only price tags,
an empty detection list, and a single-row close-up shot.
```

## Prompt B6 — PDPA, Retention & Audit

```
Implement the compliance layer for shelfeye-api.

## IMAGE RETENTION
- Nightly Celery beat job deletes objects where
  retention_expires_at < now(), then nulls the object_key while KEEPING
  the derived detections and analyses. Rationale: the numeric findings
  must survive for trend analysis, but the raw photograph — which contains
  bystanders' faces and competitor pricing — must not be hoarded.
- Retention period is config-driven per store chain, because some retail
  partners contractually require shorter windows.
- Deletion must be logged to audit_log with a count, and must be idempotent.

## FACE BLUR ENFORCEMENT
- `face_blur_applied` is a NOT NULL column and a 422 gate on commit.
- Add a server-side verification sampler: 2% of uploads are queued to a
  `verify_blur` task that calls a face-detection endpoint on the ML
  service; if unblurred faces are found, raise a compliance alert and
  quarantine the object. This catches a broken or tampered mobile build.
- The system must expose NO endpoint that performs face recognition,
  identification, or matching. Detection-for-blurring only.

## AUDIT TRAIL
Write to audit_log for: visit check-in with consent flag, every finding
verification and its reason, every dispute, every model promotion, every
retention deletion batch, and every export of evidence.
Audit rows are append-only; revoke UPDATE and DELETE at the database
role level rather than relying on application discipline.

## EVIDENCE EXPORT
GET /v1/evidence/{finding_id}/export produces a PDF containing the photo,
the detection overlay, timestamp, store code, GPS, and the model_version
that produced the finding. This artifact is used in commercial
negotiations with retail partners, so it must be reproducible: exporting
the same finding twice must yield identical content regardless of what
model is active today.

## ⛔ COMPETITION LAW GUARDRAIL
Price-tag data captured from competitor products may be exposed only
through aggregate market-level analytics endpoints. Do NOT build any
endpoint, webhook, or scheduled job that emits near-real-time competitor
price changes to a pricing system. Automated price response to an
individual competitor's shelf price is out of scope by legal design.
```

## Prompt B7 — Contract Tests & Mock ML

```
Build the testing infrastructure that lets the backend team ship without
the ML team.

1. `MockMLClient` — returns deterministic detections generated from a seed
   derived from the image URI, so the same input always yields the same
   output. Include fixture scenarios selectable by filename convention:
   *_full.jpg (no gaps), *_gaps.jpg (3 gaps), *_lowconf.jpg,
   *_unreadable.jpg (422), *_slow.jpg (12s delay), *_error.jpg (503).

2. Contract tests (schemathesis or pact) that run against BOTH the mock and
   the real ML service in CI. If the ML team changes a response field, the
   backend build must fail loudly rather than silently producing nulls.

3. Integration tests over the full pipeline with testcontainers
   (postgres + redis + minio), covering the golden path:
   check-in → presign → commit → job → result → verify → task → checkout.

4. Load test (locust) simulating the morning burst: 200 reps each
   committing 8 captures within a 30-minute window. Assert p95 end-to-end
   latency stays under 10 seconds.
```

---

# ส่วนที่ 3: ML Service Prompts (REPO B)

## Prompt M1 — Training Pipeline

```
Build a reproducible training pipeline in a repository named `shelfeye-ml`,
entirely separate from the backend service.

## DATASET
Source: Roboflow Universe project `roboflow-ngkro/shelf-product`
- 1,349 images of real retail coffee shelves
- 45 classes covering individual coffee SKUs plus the operationally
  important classes: `Empty Shelf`, `Price`, `Discount Price`
- A published baseline exists at mAP@50 = 90.5%, precision 88.2%,
  recall 90.5% — treat this as the bar to beat, not as your result.

Pull it with the Roboflow SDK, pin the dataset version explicitly, and
record the version hash in the model card. Never train against "latest".

## CLASS MAPPING — the most important design decision in this repo
Ship a `class_map.yaml` INSIDE the model artifact that maps every raw
class name to a stable `semantic_type` consumed by the backend:

  Empty Shelf              -> GAP
  Price                    -> PRICE_TAG
  Discount Price           -> PROMO_TAG
  <all 42 remaining SKUs>  -> PRODUCT

The backend must never see the raw SKU names in its business logic. When
the SKU list changes, only this file and the model change; the backend
does not redeploy.

## TRAINING
- Ultralytics YOLO11n as baseline, YOLO11s as the accuracy variant.
- Image size 960 (shelf photos are dense with small objects; 640 loses
  the thin gap regions between facings).
- Augmentation tuned for the actual failure modes: heavy brightness and
  contrast jitter, mild perspective warp, motion blur, and JPEG
  compression artifacts. Do NOT use vertical flip — shelves have a
  fixed gravity orientation and flipping teaches nothing real.
- Handle class imbalance: `Empty Shelf` is far rarer than product classes.
  Apply class weighting or oversample gap-containing images, and always
  report per-class metrics, never the mAP average alone.

## OUTPUTS
- Weights exported to ONNX (opset 17) and TensorRT
- `model_card.md`: dataset version, class map, per-class metrics,
  known limitations, training date, git SHA
- Everything registered to MLflow with the dataset version as a tag
```

## Prompt M2 — Evaluation & Promotion Gate

```
Implement an automated evaluation and promotion gate. A model may only be
promoted to `active` if it passes EVERY gate below. Wire this into CI so
promotion is a pipeline decision, not a human clicking a button.

## GATES
- Recall on class `Empty Shelf` >= 0.90
    Rationale: a missed gap is lost revenue that can never be recovered,
    and the rep has already walked away. A false alarm merely costs a few
    seconds of the rep's attention. These errors are NOT symmetric —
    optimise the operating point for recall on GAP, then maximise
    precision subject to that constraint.
- Precision on class `Empty Shelf` >= 0.85
    Rationale: below this, reps stop trusting the alerts within weeks and
    adoption collapses, which destroys the entire project's value.
- Overall mAP@50 >= 0.85
- p95 inference latency <= 400ms at the target image size on the
  deployment hardware
- No per-class recall regression greater than 5 points versus the
  currently active model, evaluated on a FROZEN holdout set that is never
  used for training or hyperparameter search

## SLICE EVALUATION — report separately, do not average away
Report metrics broken down by: bright vs dim lighting, straight-on vs
angled shots, dense vs sparse shelves, and top vs bottom shelf rows.
A model that performs well on average but fails on dim traditional-trade
stores is a model that fails in Thailand.

## DOMAIN GAP — state this prominently in every model card
The shelf-product dataset is European coffee aisles. Lighting, shelf
density, packaging design and store format differ substantially from Thai
convenience and traditional-trade stores. Metrics on this dataset are a
capability proof, NOT a production readiness signal. Production promotion
additionally requires a held-out set of at least 300 photographs taken in
Thai pilot stores, and the model card must report both numbers side by
side so nobody mistakes one for the other.
```

## Prompt M3 — Inference Service

```
Build the inference service in `shelfeye-ml` that implements the contract
from `contracts/inference-v1.yaml`. This is a thin serving layer around
the model artifact — it holds no business logic and no knowledge of the
domain.

## REQUIREMENTS
- FastAPI wrapper over ONNX Runtime (GPU when available, CPU fallback)
- Load the active model at startup; /readyz returns 503 until warm.
  Run a warm-up inference on a dummy tensor at boot so the first real
  request from a waiting rep is not the one that pays the JIT cost.
- Support model_version pinning in the request so the backend can
  reproduce an old finding for a contract dispute. Keep the last 3
  promoted versions loadable.
- Read the image from the object-store URI directly. The backend must
  never send image bytes in the request body.
- Convert all outputs to absolute pixel coordinates before responding, and
  attach semantic_type from the artifact's class_map.yaml.
- Batch opportunistically: if multiple requests arrive within a 50ms
  window, batch them into one forward pass. This roughly triples
  throughput during the morning burst without hurting single-request
  latency.
- Return 422 with a specific error_code when the image is unreadable or
  contains no detectable shelf structure, so the backend can tell the rep
  to retake the photo rather than silently reporting OSA = 100%.
  ⚠️ An image where the model finds nothing must NEVER be reported as a
  perfect shelf. Distinguish "no gaps found" from "nothing found at all".

## ALSO EXPOSE
POST /internal/v1/detect-faces  — bounding boxes only, used by the
backend's blur-verification sampler. This endpoint returns coordinates
and nothing else: no embeddings, no identity, no matching, no persistence.
```

## Prompt M4 — Feedback Loop & Retraining

```
Implement the active-learning loop that closes the gap between production
and training.

## INGESTION
The backend exposes a read-only feed of two things:
1. Findings rejected by reps, with the rejection reason
2. Detections flagged is_low_confidence

Consume this feed on a schedule into a relabel queue in Label Studio.
Rejection reasons are training signal, not noise: "มีของแต่ถูกบัง"
(occlusion false positive) and "เป็นพื้นที่ว่างปกติ" (shelf edge
misread as a gap) are two distinct failure modes that need different
fixes — the first wants more occluded-shelf training data, the second
wants better negative examples of structural shelf voids.

## PRIORITISATION
Rank the relabel queue by (rejection_rate_by_store_format DESC,
confidence closest to the decision threshold). Labelling budget is the
scarcest resource in this project; spend it where the model is most
confused, not on images that are already easy.

## RETRAINING CADENCE
- Scheduled monthly, plus triggered whenever the rolling 7-day rejection
  rate exceeds 15%, or whenever a packaging change is registered.
- Every retrain must pass the full Prompt M2 gate before promotion.
- Promotion writes a new row to the backend's model_versions table via an
  admin API call. It never mutates existing detections.

## DRIFT MONITORING
Track weekly: confidence distribution shift, detections-per-image
distribution, and rejection rate by store format. Alert when any drifts
more than 2 standard deviations from the trailing 8-week baseline.
Packaging redesigns and new SKU launches are the expected cause — when
the alert fires, the first question to ask is "what changed on the shelf",
not "what broke in the model".
```

---

# ส่วนที่ 4: ลำดับการทำงาน (Delivery Order)

| Sprint | Backend (Repo A)                         | ML (Repo B)                        | จุดบรรจบ                                         |
| :----: | :--------------------------------------- | :--------------------------------- | :----------------------------------------------- |
| **1**  | C1 contract + B1 scaffolding + B2 schema | C1 contract + M1 training pipeline | ตกลง contract แล้วแยกกันวิ่ง                     |
| **2**  | B3 core API + Mock ML                    | M1 เทรน baseline + M2 eval gate    | Backend เดโมได้ครบ flow ด้วย mock                |
| **3**  | B4 pipeline + B5 OSA engine              | M3 inference service               | **เปลี่ยนจาก mock → ของจริง (1 บรรทัด env var)** |
| **4**  | B6 PDPA/audit + B7 tests                 | M2 slice eval + model card         | E2E test + load test ผ่าน                        |
| **5**  | Analytics + evidence export              | M4 feedback loop                   | นำร่องร้านจริง 3–5 ร้าน                          |

> **ตัวชี้วัดว่าการแยกระบบสำเร็จ:** ในสัปดาห์ที่ 3 การเปลี่ยนจาก Mock ML ไปเป็น ML Service ตัวจริง ต้องใช้การแก้แค่ค่า environment variable ตัวเดียว โดยไม่แตะโค้ด business logic แม้แต่บรรทัดเดียว ถ้าต้องแก้มากกว่านั้น แปลว่าขอบเขตรั่ว และควรย้อนกลับไปแก้ที่ `adapters/ml_client.py`
