# ShelfEye — Shelf Gap Detection & Replenishment

A field rep photographs a retail shelf and gets an on-shelf-availability (OSA)
score back **while still standing in front of it**, with each gap boxed,
labelled in Thai, and turned into a replenishment task.

> **Demo build.** Working end-to-end over production-hardened — see
> [docs/archive/plan.md](docs/archive/plan.md) for what was deliberately left out and why.

## Architecture

Two services that share exactly one thing: a contract.

```
┌────────────────────────────┐         ┌────────────────────────────┐
│  backend/  shelfeye-api    │         │  model/  shelfeye-ml       │
│                            │  HTTP   │                            │
│  auth · visits · captures  │ ──────► │  training pipeline         │
│  OSA rules · tasks         │ ◄────── │  ONNX inference service    │
│  analytics · storage       │  JSON   │  class map (in artifact)   │
│                            │         │                            │
│  ⛔ no torch/ultralytics   │         │  ⛔ never hears "store"    │
│  ⛔ never sees class names │         │  ⛔ never computes OSA     │
└────────────────────────────┘         └────────────────────────────┘
                    └──── contracts/ ────┘
                    OpenAPI 3.1 + Pydantic
```

**The measure of whether the separation worked:** going from fake detections to
the real model is one environment variable, `ML_CLIENT=mock` → `http`, with no
business-logic file touched.

### Why the boundary is drawn there

| Rule | Reason |
| :-- | :-- |
| Backend branches on `semantic_type`, never on a class name | The dataset's 45 class names change on every retrain. `Empty Shelf` hardcoded in a service would silently stop matching one day, and OSA would quietly read 100%. |
| OSA thresholds live in the backend, not the model | "Below 75% is critical" is a business decision trade marketing revisits monthly. It must never require a model release. |
| `detections` and `shelf_analyses` are append-only | A finding may be disputed commercially months later. Re-running inference inserts; it never overwrites. |
| Every derived row carries `model_version` | "Which model produced this result in May?" must always be answerable. |
| Bounding boxes are absolute pixels, everywhere | Mixed coordinate conventions produce boxes that look *almost* right — far worse than obviously wrong. |

## Quick start

Requires Docker and Python 3.12. Host ports are shifted off the defaults
(postgres **5433**, redis **6380**) so nothing already running is disturbed.

```bash
make setup          # both venvs + shared contracts package
make dataset        # extract the Roboflow dataset (1,349 images)
make infra          # postgres + redis + minio
make migrate seed   # schema + demo users and stores
make api worker     # API on :8000, Celery worker
make demo           # walk the golden path and print each step
```

Log in with `rep@shelfeye.demo` / `demo1234`. Other seeded roles:
`manager@`, `admin@`, `data@`, same password.

## The golden path

```
check-in → presign → PUT to storage → commit (202) → job → result
        → verify gap → task → after-photo → checkout
```

`make demo` walks exactly this and prints what a demo would show:

```
2. today's route  (risk DESC, distance ASC)
  HIGH   score=0.575    0.0km  ควิกช้อป อ่อนนุช 17
3. check-in  (GPS ~5km off: flagged, NOT blocked)
  visit 75b3a282  gpsMatch=False  status=OPEN
8. result
  osaScore=0.8750  status=LOW  rows=3  gapRatio=0.1250
    · ชั้นที่ 1 · ตำแหน่งซ้าย  ลาเต้ กระป๋อง 180ml (SKU-1002)
```

### Driving the mock without the model

`MockMLClient` is deterministic — the same image URI always yields identical
detections — and picks a scenario from the object key, which carries the shelf
bay label. Pass a `shelfBayLabel` containing:

| marker | behaviour |
| :-- | :-- |
| `_full` | a well-stocked shelf, OSA 1.0 |
| `_gaps` | three gaps in the middle row |
| `_lowconf` | a gap the model only half-believes |
| `_unreadable` | 422 — job fails, rep told to retake |
| `_error` | 503 — transient, retried |
| `_slow` | 12s delay |

## Switching to the real model

```bash
make train          # detached, ~2 hours on an M2
make evaluate       # test split against the promotion gates
make export card    # ONNX opset 17 + model_card.md
make ml             # inference service on :8001

# the entire switch:
sed -i '' 's/ML_CLIENT=mock/ML_CLIENT=http/' backend/.env && make stop api worker
```

## Testing

```bash
make test             # contracts + backend + model
make check-boundary   # fails if the backend ever grows a CV dependency
make lint
```

| Suite | Count | Needs |
| :-- | --: | :-- |
| `contracts/` — Pydantic ↔ OpenAPI parity | 21 | nothing |
| `backend/tests/unit` — OSA engine, mock ML | 25 | nothing |
| `backend/tests/integration` — API, prohibitions | 35 | `make infra migrate` |
| `model/tests` — class map, letterbox, decode | 20 | nothing |

The OSA engine's tests run in 0.1s with no services at all, because
[shelf_analysis.py](backend/app/services/shelf_analysis.py) is pure: no I/O,
no ORM, no framework import, no clock read.

## What this system will not do

These are enforced by tests in
[test_prohibitions.py](backend/tests/integration/test_prohibitions.py), not by
convention.

- **No per-rep metrics.** No leaderboard, no per-rep score, no `GROUP BY
  user_id`. Aggregation is at store and area level only. *If the score is tied
  to an individual, reps photograph only flattering angles and the entire
  dataset becomes worthless.* This is a labour-rights constraint agreed at
  design stage, not a missing feature.
- **No automated competitor-price response.** Price-tag data surfaces only in
  aggregate. No endpoint or job emits near-real-time competitor prices to a
  pricing system. Competition-law guardrail.
- **No face recognition.** No identification, matching, or embedding storage.
- **No exact unit counts.** Occlusion, stacked facings and promo signage make
  piece-counting unreliable; area-share metrics degrade gracefully instead.
- **An empty result is never a perfect shelf.** "No gaps found" and "nothing
  found at all" are different answers, and conflating them would poison every
  trend built on this data.

## Dataset and the domain gap

[`roboflow-ngkro/shelf-product`](https://universe.roboflow.com/roboflow-ngkro/shelf-product/dataset/1)
v1 — 1,349 images, 45 classes, pinned by version and archive SHA.

> ⚠️ **These are European coffee aisles.** The source filenames name German
> retailers (Edeka, REWE, tegut). Lighting, shelf density and packaging differ
> substantially from Thai convenience and traditional-trade stores. Metrics on
> this dataset are a **capability proof, not a production-readiness signal** —
> that requires a held-out set of Thai pilot-store photographs, reported side
> by side. Every generated model card leads with this warning.

## Documentation

| Document | Contents |
| :-- | :-- |
| [docs/archive/SPEC.md](docs/archive/SPEC.md) | Specification the build was delivered against — contract rules, schema, boundaries |
| [docs/archive/plan.md](docs/archive/plan.md) | Implementation plan, dependency graph, demo simplifications, outcome |
| [docs/archive/todo.md](docs/archive/todo.md) | The 18 tasks, all complete |
| [contracts/inference-v1.yaml](contracts/inference-v1.yaml) | The inference contract |
| [docs/backend.md](docs/backend.md) · [docs/ui.md](docs/ui.md) | Original requirements |
