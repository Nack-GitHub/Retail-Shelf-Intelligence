# Implementation Plan: ShelfEye Backend API + ML Model

> Spec: [SPEC.md](SPEC.md) · Requirements: [backend.md](../backend.md)
> Mode: **DEMO** — working end-to-end over polished. Created 2026-08-22.

## Overview

Build `shelfeye-api` (backend/) and `shelfeye-ml` (model/) as two isolated services joined only by `contracts/`. The golden path a demo must show: **rep checks in → photographs a shelf → gets an OSA score with gap boxes drawn on it → confirms a gap → gets a task → fixes it → checks out.** Everything else is supporting cast.

Model training is the long pole (hours), so it is **launched in the background in Phase 2** and runs while the entire backend is built against `MockMLClient`. The last real task is flipping one env var.

---

## Architecture Decisions

1. **Two services, one contract.** `backend/` never imports a CV library; `model/` never learns the words "store" or "OSA". The only shared code is `contracts/`. This is the point of the whole exercise — verified by a grep in CI, not by discipline.
2. **`semantic_type` is the only field the backend branches on.** Raw class names (`Empty Shelf`, `FM Bohne`) never leave the ML service. The class map ships inside the model artifact.
3. **The OSA engine is a pure module, built early.** No DB, no HTTP, no framework. It is the highest-risk logic in the system and it needs zero infrastructure to test, so it is built and fixtured before the API that calls it.
4. **Train in the background, build against the mock.** `MockMLClient` is not a testing afterthought, it is what unblocks all backend work. Training starts in Phase 2 and finishes around Phase 6.
5. **Non-default host ports throughout** — Postgres 5433, Redis 6380, MinIO 9000/9001, API 8000, ML 8001. Your `postgres-hrm` container owns 5432 and stays untouched.

### Demo-grade simplifications (cut from SPEC.md)

Per "ไม่ต้อง over engineering — นี่คือ demo ไม่ใช่ production", the following are deliberately dropped. Each is a *production* concern that adds moving parts without changing what the demo shows.

| Cut | SPEC § | Replaced with |
| :-- | :-- | :-- |
| Monthly partitioning of `detections` | 6.1 | Plain table + `(capture_id)` index |
| Circuit breaker on the ML service | 6.3 | Bounded retries only |
| Two Celery queues (high/low) | 6.3 | One queue |
| Dead-letter queue + admin requeue | 6.3 | Job marked `FAILED` with `error_code`, visible via `GET /v1/jobs/{id}` |
| Celery beat scheduler | 6.3 | Cut — no scheduled jobs remain once PDPA is deferred |
| Refresh tokens | 2 | Single 8-hour access token |
| `mypy --strict` | 3 | `ruff check` + `ruff format` only |
| Prometheus metrics / p95 SLO alerting | 6.3 | `structlog` JSON with timings |
| MLflow tracking server | 7.2 | `metrics.json` + `model_card.md` per run |
| TensorRT export, YOLO11s variant | 7.2 | ONNX opset 17, YOLO11n only |
| 50 ms opportunistic request batching | 7.5 | One request, one forward pass |
| Last-3-versions model registry | 7.5 | Active model only; pinned `model_version` returns 501 |
| testcontainers, schemathesis, locust | 10 | Compose stack + one Pydantic↔YAML parity test |

**Not cut** — these stay because the demo is about them: the contract boundary, append-only detections with `model_version`, the pure OSA engine and its 6 fixtures, deterministic `MockMLClient`, the `ML_CLIENT` env flip, presigned upload (bytes never touch the API), the async job flow the frontend's Processing screen polls, JWT + RBAC, and the absolute prohibition on per-rep metrics.

---

## Dependency Graph

```
T1 repo skeleton + compose
 │
 ├─ T2 contracts/ (OpenAPI + Pydantic)  ─────────────────┐
 │   │                                                    │
 │   ├─ T3 ML scaffold + dataset + class_map              │
 │   │   └─ T4 training pipeline + smoke run              │
 │   │       └─ T5 ⏳ FULL TRAINING (background, hours) ──┼──┐
 │   │                                                    │  │
 │   └─ T6 backend scaffold (config, logging, /healthz)   │  │
 │       └─ T7 schema + migration + seed                  │  │
 │           ├─ T8  auth (JWT + RBAC)                     │  │
 │           ├─ T9  ⭐ OSA engine (pure, no deps)          │  │
 │           ├─ T10 MockMLClient + MinIO storage ─────────┘  │
 │           │   └─ T11 routes/today + visits                │
 │           │       └─ T12 ⭐ capture → job → result         │
 │           │           └─ T13 verify → task → checkout     │
 │           │               └─ T14 analytics                │
 │           │                                                │
 │           └───────────────────────────────────────────────┤
 │                                                            │
 └─ T15 inference service (needs T2 + T5 weights) ───────────┘
     └─ T16 🔀 flip ML_CLIENT=mock → http
         └─ T17 integration test of golden path
             └─ T18 review fixes + ship checklist
```

**Critical path:** T1 → T2 → T3 → T4 → T5(⏳ background) → T15 → T16 → T17 → T18
**Runs in parallel with training:** T6 → T7 → T8/T9/T10 → T11 → T12 → T13 → T14

---

## Phases

### Phase 1 — Foundation (T1, T2)
Repo skeleton, docker compose on safe ports, and the contract both services compile against. Nothing works yet but the boundary exists.

### Phase 2 — ML kickoff (T3, T4, T5)
Dataset extracted, class map written, training pipeline verified by a 2-epoch smoke run, then **the real run launched in the background**. Deliberately early: it is the only task measured in hours, and everything downstream of it is unblocked by the mock.

### Phase 3 — Backend foundation (T6, T7)
Scaffolding, schema, one migration, seed data aligned with the frontend's mock store list.

### Phase 4 — Vertical slices (T8–T14)
Each task is one complete working path, built in the order a rep experiences them. T9 (the OSA engine) jumps the queue because it is pure and risky.

### Phase 5 — Real model (T15, T16)
Inference service over the trained ONNX, then the one-line flip that proves the separation held.

### Phase 6 — Verify and ship (T17, T18)
Golden-path integration test, review, fix, ship checklist.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| :-- | :-- | :-- |
| Training takes far longer than estimated on M2 | **High** — blocks T15/T16 | T4 smoke run measures real seconds/epoch *before* committing; epochs and `imgsz` are chosen from that measurement, not guessed. Backend is fully demoable on the mock regardless. |
| Disk at 93% (30 GiB free) | **High** — torch ~2.5 GB + images ~1.5 GB + artifacts | Check free space before torch install; ONNX-only export; no TensorRT; `model/data/` and `artifacts/` gitignored |
| Port 5432 taken by `postgres-hrm` | Med | All host ports shifted (5433/6380/9000/9001). No existing container is stopped or removed. |
| MPS backend flakiness in ultralytics | Med | Smoke run catches it in minutes; documented CPU fallback at reduced `imgsz` |
| Contract drift between the two services | Med | `contracts/` is a single installed package + a parity test; ML service response validated against the same Pydantic models the backend consumes |
| Trained model detects nothing on a shelf photo | Med | 422 `NO_SHELF_DETECTED` path is built and tested with the mock long before real weights exist — the "empty ≠ perfect shelf" rule is fixtured in T9 |
| Scope creep back toward production hardening | Med | The cut table above is the contract with myself; anything on it needs an explicit ask |

---

## Constraints (standing, from the user)

- ⛔ **Never `git push`.** Local commits only.
- ⛔ **Never delete another Docker container or volume.** Stopping is permitted; nothing outside this project's compose stack gets touched.
- ⛔ No per-rep analytics, no automated competitor-price response, no face recognition (SPEC §8.4).
- ✅ Demo-grade. When in doubt, choose the version with fewer moving parts.

## Open Questions

Carried from SPEC.md §12, resolved by defaulting so the build is not blocked:

1. **Beat mAP@50 90.5%?** → Treated as *not* a gate for the demo. The eval script reports against the thresholds; falling short is recorded in the model card, not a build failure.
2. **First admin user** → seed script (`make seed`), credentials in `.env.example`.
3. **Store master data** → generated to match [frontend/src/lib/mock/data.ts](../../frontend/src/lib/mock/data.ts) so the real API and the current UI line up.
4. **Push notification** → no-op adapter behind an interface; the frontend polls anyway.
5. **MLflow** → cut (see table above).


---

## Outcome (2026-08-23)

All 18 tasks complete. 110 tests green, lint clean, boundary check passing.

### Trained model — the gates fail, and that is the correct result

| Gate | Threshold | Measured | |
| :-- | --: | --: | :-- |
| Recall `Empty Shelf` | 0.90 | 0.4113 | ❌ |
| Precision `Empty Shelf` | 0.85 | 0.4655 | ❌ |
| Overall mAP@50 | 0.85 | 0.3729 | ❌ |

20 epochs of YOLO11n at imgsz 640 on an M2, against a published baseline of
90.5% mAP@50 that used far more compute. **The pipeline is correct; the model
is under-trained.** Verified concretely: on a test photograph with two
ground-truth `Empty Shelf` boxes the model found none at conf 0.25 and one at
conf 0.05, so the API reported OSA 1.0 for a shelf that genuinely has gaps.
Lowering the operating point does not rescue it — recall must come from
training.

The promotion gate catching this is the system working as designed.

### What to do next

1. **Train longer on better hardware.** 100+ epochs on a CUDA GPU at imgsz 960,
   which is what the spec originally called for and what this M2 could not
   afford. Oversample gap-containing images to address the class imbalance.
2. **Then re-run `make evaluate`.** Promotion should be gated on the result,
   not on a human deciding the number looks good enough.
3. **Only then trust the OSA figure from the real model.** Until the gates
   pass, `ML_CLIENT=mock` is the honest way to demo the product, because a
   deterministic mock does not silently claim a shelf is full when it is not.
