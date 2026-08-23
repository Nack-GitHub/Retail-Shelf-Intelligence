# Implementation Plan: เชื่อม Frontend เข้ากับ Backend API

> **ส่งมอบแล้ว** — เอกสารนี้เก็บไว้เป็นบันทึกว่าทำไมระบบถึงเป็นรูปนี้ ไม่ใช่งานที่ค้างอยู่
> วิธีรันระบบดูที่ [docs/running.md](../../running.md)

> Spec: [SPEC.md](SPEC.md) · Tasks: [todo.md](todo.md) · Mode: **DEMO** · ⛔ no `git push` · ⛔ never delete another project's containers (`docker compose stop` only)

## Context

The backend and ML services are finished and tested (95 tests green, golden path walks end to end via `make demo`). The frontend is a complete, polished demo that walks all 20 screens — **on fake data**. There is not one `fetch` call in `frontend/src/`; 22 files import from `lib/mock/` directly, and every action in `lib/store.ts` is a synchronous local mutation.

This plan connects the two. When it is done, a rep photographs a real shelf and sees the OSA score computed from *that photo* by the real pipeline, and `lib/mock/` is deleted.

Survey during planning confirmed SPEC §2: the mobile screens are nearly covered by existing endpoints, but the manager and data-team screens need **7 new endpoints**. This is not just wiring.

---

## Architecture Decisions

1. **`lib/api/client.ts` is the only file that knows the base URL or the token.** It mirrors [ml_client.py](../../../backend/app/adapters/ml_client.py) being the only file that knows the ML service exists. Components never call `fetch`.

2. **Unit conversion happens once, in the API mappers.** The API speaks ratios (`osaScore: 0.875`, `riskScore: 0.575`); the existing components render percentages (`74`, `87`). Rather than touch 20 screens, each `lib/api/*.ts` mapper converts ratio → percent at the boundary and returns the exact `types/index.ts` shapes the components already consume. **This is the single largest source of silent breakage in this work** — a missed conversion renders "OSA 0%" on a healthy shelf.

3. **No new dependencies, frontend or backend.** IndexedDB is written directly (~60 lines), `fetch` is native, and verification is by real backend tests plus driving the live UI in the browser. Per your call, and per "ไม่ต้อง over engineering".

4. **What the database cannot produce is not rendered.** Drift series, the SKU×day-of-week heatmap, and "ต้นทุนต่อการตรวจ" have no backing data. The API omits them; the UI omits the cards. `GET /v1/analytics/kpis` returns an array of only the KPIs it can compute, and `/w` renders whatever arrives. Two replacements *are* honestly computable and are used: weekly **rep-override rate** in place of drift, and **average in-store minutes** from closed visits in place of the invented `estMinutes`.

5. **No new tables.** Categories and areas follow the pattern already set by [sku_catalog.py](../../../backend/app/services/sku_catalog.py) — a documented demo stand-in constant, with the live numbers (`lastOsa`) computed from real `captures`/`shelf_analyses` rows. This keeps us clear of SPEC §10's "ask before changing the database schema".

6. **`model_versions` is seeded from the real artifact.** [model/artifacts/shelf-product-v1/metrics.json](../../../model/artifacts/shelf-product-v1/metrics.json) holds genuine numbers (gap-class recall **0.4113**, below the promotion gate). The model-health screen shows those, red. A demo that admits its model failed its gate is more credible than one showing invented 0.914.

7. **`ML_CLIENT=mock` stays the demo default** (SPEC §13 Q2) — the real model has not passed its gate. The flip remains one env var.

8. **The drawn shelf survives, outside `lib/mock/`.** `ShelfPhoto`/`SLOTS`/`ROWS` move to `components/shelf/PlaceholderShelf.tsx` as an explicit "no camera on this device" fallback; `IMAGE_W`/`IMAGE_H` become required props on `DetectionOverlay` and `CropView`. Real photos always win when present.

9. **The `StateSwitcher` demo toggles stay.** They are how a reviewer reaches the empty/failed states on demand. Real data drives the default state; the switcher overrides it.

---

## Dependency Graph

```
lib/api/client.ts + errors.ts + auth.ts          ← everything blocks on this
        │
        ├── routes.ts ──── /m (route) ──── /m/store/[id]/checkin
        │       └── backend: stores.py (NEW)
        │
        ├── catalog: GET /v1/categories (NEW) ──── /category
        │
        ├── visits.ts ──── check-in ──┐
        │                             ├── captures.ts: presign→PUT→commit→poll ──── /capture, /processing
        │                             │        └── result (+imageUrl) ──── /result  ← hardest
        │                             │                └── findings.ts ──── /verify
        │                             │                        └── tasks.ts ──── /tasks
        │                             └────────────────────────── checkout ──── /checkout, /compare
        │
        ├── analytics.ts: kpis (NEW), areas (NEW), osa, risk-ranking, route-plan (NEW)
        │        └── /w, /w/stores/[id], /w/routes
        │
        ├── model.ts: model/health (NEW), model/relabel-queue (NEW)
        │        └── /w/model-health, /w/relabel
        │
        └── offline/queue.ts ──── sync.ts ──── /m/sync
                 │
                 └── delete lib/mock/  ← last, once nothing imports it
```

---

## Task List

Legend — scope: **XS** 1 file · **S** 1–2 · **M** 3–5 · **L** 5–8

### Phase 0 — Plan artifacts

**T0** — Write `tasks/plan.md` (this document) and `tasks/todo.md` (the checklist below), matching the format of the archived [plan รอบก่อนหน้า](../backend-and-ml/plan.md). **XS**

---

### Phase 1 — Foundation: real auth

**T1: `lib/api/` core + real login** · **M** · depends: none

Create `client.ts` (base URL, `Authorization` header, 401 → clear token + throw, JSON/204 handling), `errors.ts` (`ApiError` with Thai `userMessage` per status), `auth.ts` (`login`, `me`, token get/set/clear).

Token lives in `sessionStorage` with an explicit `expiresAt` alongside it, checked before every attach; never logged (⛔5). Login screen swaps รหัสพนักงาน/PIN for email/password prefilled with `rep@shelfeye.demo`. An `AuthGate` client component in `app/m/layout.tsx` and `app/w/layout.tsx` redirects to `/m/login` when there is no valid token.

- Files: `lib/api/{client,errors,auth}.ts`, `app/m/login/page.tsx`, `app/m/layout.tsx`, `app/w/layout.tsx`, `components/auth/AuthGate.tsx`
- **Accept:** login with `rep@shelfeye.demo`/`demo1234` returns a real JWT and lands on `/m`; wrong password shows the Thai error from the API; deleting the token from sessionStorage and reloading `/m` redirects to login.
- **Verify:** `npx tsc --noEmit` · `npx next lint` · drive login in the browser, confirm `Authorization: Bearer` on `/v1/me` in the network panel and **no token string in the console**.

### ▣ Checkpoint A — after T1
- [ ] `tsc --noEmit`, `next lint`, `npm run build` all clean
- [ ] Real login works; 401 redirects; token never printed

---

### Phase 2 — Mobile golden path (SPEC §12 steps 2–6)

**T2: Today's route + store detail** · **M** · depends: T1

Backend: new `app/api/v1/stores.py` — `GET /v1/stores` and `GET /v1/stores/{id}` returning `StoreOut` plus the risk fields, registered in `main.py`. Frontend: `lib/api/routes.ts` calling `/v1/routes/today?lat&lng` (browser geolocation, falling back to the Bangkok default already in the endpoint signature), mapping ratio→percent, and driving `/m` and `/m/store/[id]/checkin`.

- Files: `backend/app/api/v1/stores.py`, `backend/app/main.py`, `lib/api/routes.ts`, `app/m/page.tsx`, `app/m/store/[id]/checkin/page.tsx`
- **Accept:** `/m` lists the 5 seeded stores ordered by real `riskScore` DESC then distance; `lastOsa`/`daysSinceLastVisit` read `null` correctly on a never-visited store (renders "ยังไม่เคยตรวจ", **not** `0%`); loading/error/empty all present.
- **Verify:** backend pytest for the two new endpoints · browser: `/m` matches `make demo` step 2 ordering.

**T3: Categories + real check-in** · **M** · depends: T2

Backend: new `app/api/v1/catalog.py` — `GET /v1/categories?storeId=` returning `{id, name, bays[], skuCount, lastOsa}`, with the catalog itself a documented constant (same posture as `sku_catalog.py`) and `lastOsa` computed per category from `shelf_analyses` joined through `captures.category` for that store, `null` when never photographed. Frontend: `lib/api/visits.ts` `POST /v1/visits` on "เริ่มตรวจชั้นวาง", storing the real `visitId` in the zustand store; the GPS banner reads the API's real `gpsMatch`.

- Files: `backend/app/api/v1/catalog.py`, `backend/app/main.py`, `lib/api/{catalog,visits}.ts`, `lib/store.ts`, `app/m/store/[id]/{checkin,category}/page.tsx`
- **Accept:** check-in creates a real `visits` row; a store 5km off flags `gpsMatch=false` and is **not blocked**; a `FORBIDDEN` store surfaces the API's Thai 403 instead of opening the camera.
- **Verify:** backend pytest · browser: check in, then `psql` shows the row.

**T4: The capture flow — presign → PUT → commit → poll** · **M** · depends: T3 · **highest risk**

`lib/api/captures.ts`: `presign()`, `uploadToStorage()` (raw `PUT` to the presigned URL — **not** through `client.ts`, since that would attach our JWT to S3 and force `Content-Type: application/json`), `commit()` with the `Idempotency-Key` already minted by [capture.ts](../../../frontend/src/lib/capture.ts), and `pollJob()` at 500ms with a hard timeout.

`/processing` replaces its fake timer with real job polling. `FAILED` renders `job.userMessage` from the API and routes to retake — **never** an OSA number (⛔3).

- Files: `lib/api/captures.ts`, `lib/store.ts`, `app/m/store/[id]/{capture,processing}/page.tsx`
- **Accept:** a photo taken on the phone lands in MinIO and produces a real `inference_jobs` row; committing twice with one key yields one job; bay label `A2_unreadable` shows "ภาพไม่ชัดหรือเสียหาย กรุณาถ่ายใหม่" and no score.
- **Verify:** browser network panel shows `PUT` direct to `:9000` with **no `Authorization` header** · MinIO console shows the object · `_unreadable` path checked by hand.

**T5: Real result screen — real photo, real boxes** · **M** · depends: T4

Backend: add `imageUrl` (presigned GET, via the existing `get_storage().presign_get`) to `ShelfAnalysisOut` — additive, so no existing consumer breaks. Frontend: `/result` renders the analysis from `GET /v1/captures/{id}/result`; `CaptureFrame` prefers the local blob for instant paint and swaps to the signed URL; `DetectionOverlay` takes `imageWidth`/`imageHeight` as required props (it already accepts them) and drops its `lib/mock` import. Delete the "กรอบจำลอง · ยังไม่ต่อโมเดล" badge.

- Files: `backend/app/api/v1/{schemas,captures}.py`, `lib/api/captures.ts`, `app/m/store/[id]/result/page.tsx`, `components/shelf/{DetectionOverlay,CaptureFrame,CropView}.tsx`
- **Accept:** boxes land on the right pixels of the real photo at any resolution; `modelVersion` shown is the one from the DB row; filter chips still branch on `semanticType` only (⛔2).
- **Verify:** screenshot the overlay on a real phone photo · `grep -rn 'className ===' frontend/src/components/shelf/` returns nothing.

**T6: verify → task → checkout** · **M** · depends: T5

`lib/api/findings.ts` (`POST /v1/findings/{id}/verify`), `lib/api/tasks.ts` (`GET /v1/visits/{id}/tasks`, `PATCH /v1/tasks/{id}`), checkout via `POST /v1/visits/{id}/checkout`. `lib/store.ts` actions become async and delegate; `buildTasks()` is deleted — the server creates tasks on CONFIRMED. `useOsaAfter()` is replaced by the API's real `osaAfter`.

- Files: `lib/api/{findings,tasks}.ts`, `lib/store.ts`, `app/m/store/[id]/{verify,tasks,compare,checkout}/page.tsx`
- **Accept:** CONFIRMED creates one `tasks` row (idempotent on double-tap); REJECTED with a reason deletes any task; `OUT_OF_BACKSTOCK` raises a real `replenishment_requests` row; checkout returns real `osaBefore`/`osaAfter`.
- **Verify:** backend `test_golden_path.py` and `test_review_findings.py` still green · walk the whole flow in the browser and check the rows in `psql`.

### ▣ Checkpoint B — after T2–T6
- [ ] Golden path runs end to end on real data, mobile
- [ ] `make test` green (backend + model + contracts)
- [ ] `tsc --noEmit`, `next lint`, `npm run build` clean
- [ ] Bad photo says "ถ่ายใหม่" and shows no OSA

---

### Phase 3 — Manager web (SPEC §12 step 7)

**T7: KPIs + areas + dashboard** · **M** · depends: T1

Backend, into the existing `analytics.py` (which carries the per-rep prohibition header): `GET /v1/analytics/kpis` returning only computable entries — `osa` (avg `osa_score` over the window), `ttr` (`gap_findings.created_at` → `tasks.completed_at`), `visits` (count this week). `cost` is omitted, deliberately. New `GET /v1/areas` = `SELECT DISTINCT area_id FROM stores` plus a display-name constant.

Frontend `/w`: KPI cards render from the array, so an absent KPI simply is not drawn; OSA trend from `/v1/analytics/osa`; risk table from `/v1/analytics/risk-ranking`; `WebShell` area picker and user chip from `/v1/areas` and `/v1/me`.

- Files: `backend/app/api/v1/{analytics,areas}.py`, `lib/api/analytics.ts`, `app/w/page.tsx`, `components/web/WebShell.tsx`
- **Accept:** three KPI cards, not four; trend buckets by real week; a rep token gets 403 on all of them.
- **Verify:** backend pytest incl. a no-`userId`-in-response assertion · browser check of `/w`.

**T8: Store detail** · **M** · depends: T2, T7

`/w/stores/[id]` from `GET /v1/stores/{id}` + the **existing** `GET /v1/stores/{id}/history` (visit timeline with before/after OSA and gap counts) + `/v1/analytics/osa?scope=store`. The OOS heatmap card and `EvidenceViewer`'s mock analysis are removed; `EvidenceViewer` opens a real capture by id.

- Files: `app/w/stores/[id]/page.tsx`, `components/web/EvidenceViewer.tsx`, `lib/api/analytics.ts`
- **Accept:** timeline rows are real visits; a store with no history shows the empty state, not a flat-zero chart.

**T9: Route plan** · **S** · depends: T7

`GET /v1/analytics/route-plan` — store-level risk ordering reusing `risk_score`/`risk_band`, with `avgVisitMinutes` computed from closed visits (`null` when never visited, rendered "—"). Drag-to-reorder stays client-side.

- Files: `backend/app/api/v1/analytics.py`, `lib/api/analytics.ts`, `app/w/routes/page.tsx`

### ▣ Checkpoint C — after T7–T9
- [ ] All three manager screens on real data, no invented numbers
- [ ] Rep role is 403 everywhere under `/w`

---

### Phase 4 — Data team (SPEC §12 step 8)

**T10: Model health** · **M** · depends: T7

Seed `model_versions` from the real `model/artifacts/shelf-product-v1/metrics.json` + `artifact.json` (sha), plus the `mock-v1` row the demo actually runs on. New `app/api/v1/model_health.py` — `GET /v1/model/health` returning the active version, the version list, real gap-class precision/recall/mAP, and a **weekly rep-override rate** series from `gap_findings` (REJECTED ÷ total per week) in place of drift.

The drift card becomes the override-rate card; the metric cards show the true, gate-failing numbers.

- Files: `backend/app/api/v1/model_health.py`, `backend/app/db/seed.py`, `backend/app/main.py`, `lib/api/model.ts`, `app/w/model-health/page.tsx`
- **Accept:** recall reads **0.4113** against target 0.90, in red; override rate is computed, never hardcoded.

**T11: Relabel queue** · **M** · depends: T10

`GET /v1/model/relabel-queue` — `gap_findings` that are `REJECTED` or `is_low_confidence`, with capture image (presigned), bbox, store name, category, timestamp, and the rejection reason. ⛔ **`verified_by` must not appear in the response, the query, or the schema.**

- Files: `backend/app/api/v1/model_health.py`, `backend/tests/integration/test_prohibitions.py`, `lib/api/model.ts`, `app/w/relabel/page.tsx`
- **Accept:** the queue reflects real findings from the golden path; a new prohibition test asserts no `verifiedBy`/`userId`/`repName` in the payload.

### ▣ Checkpoint D — after T10–T11
- [ ] Data-team screens real; prohibition tests cover the two new endpoints

---

### Phase 5 — Offline, then deletion (SPEC §12 steps 9–10)

**T12: Offline queue + sync** · **M** · depends: T6

`lib/offline/queue.ts` — a small hand-written IndexedDB wrapper storing `{idempotencyKey, kind, payload, blob?, attempts}`. `lib/offline/useOnline.ts` wraps `navigator.onLine` + online/offline events, replacing the store's simulated `online` flag (the demo toggle stays as an override). On reconnect the queue **replays the real endpoints** — safe because they are idempotent by key — then posts the batch to `POST /v1/sync/batch` as the acknowledgement ledger, which is exactly what that endpoint documents itself as.

- Files: `lib/offline/{queue,useOnline}.ts`, `lib/api/sync.ts`, `lib/store.ts`, `app/m/sync/page.tsx`, `app/m/captures/page.tsx`
- **Accept:** capture with the network cut → item queued with its blob → restore network → uploads, analyses, and **no duplicate rows** in `captures` or `tasks`.
- **Verify:** by hand with devtools offline mode, then row counts in `psql` before and after.

**T13: Delete `lib/mock/`** · **M** · depends: T2–T12

Move the drawn shelf to `components/shelf/PlaceholderShelf.tsx`; move `REJECT_REASONS`/`BLOCKED_REASONS` (real constants, not mock data) to `lib/constants.ts`; delete `lib/mock/`.

- **Accept:** `grep -rn "lib/mock" frontend/src/` returns nothing; `npm run build` passes with the directory gone.

**T14: Final sweep** · **S** · depends: T13

Backend prohibition tests for every new endpoint (no `user_id` in any response), `make test`, `make check-boundary`, `make lint`, and a full manual walk of all 20 screens confirming loading/error/empty on each.

### ▣ Checkpoint E — complete
- [ ] Every SPEC §11 success criterion met except the two Playwright-dependent ones (E2E suite, by your call, replaced with the documented manual walk)
- [ ] `make test` · `make check-boundary` · `tsc --noEmit` · `next lint` · `npm run build` all green

---

## Risks

| Risk | Impact | Mitigation |
| :-- | :-- | :-- |
| **Ratio vs percent mismatch** — API `0.875`, UI expects `87.5` | **High** — renders "OSA 0%" on a healthy shelf, and nobody notices until the demo | Convert in one place per resource, in the `lib/api/*` mapper. Assert the converted value in T2's verification, before 19 more screens depend on it. |
| Presigned `PUT` sent through `client.ts` | High — S3 rejects the JWT/JSON content-type; upload silently fails | `uploadToStorage()` deliberately uses bare `fetch`, documented as the one sanctioned exception |
| CORS from MinIO to `localhost:3000` | Medium — blocks all uploads from the browser | Test in T4 first thing; MinIO needs a CORS rule, added to the `minio-init` compose service if so |
| `null` OSA from never-visited stores | Medium — `null` rendered as `0%` reads as a catastrophic shelf | Types keep `lastOsa: number \| null`; every render site handles null explicitly (T2 acceptance) |
| Screens deep-linked without a visit (`/result` direct) | Low | The mock's `if (!analysis) finishCapture()` self-heal disappears; replaced with a "เริ่มการตรวจใหม่" empty state |
| Camera needs HTTPS on a phone | Low | Already solved — `npm run dev:mobile` and `allowedDevOrigins` are in place |

## Out of Scope

Unchanged from SPEC §3: model retraining to pass the gate, PDPA enforcement, evidence PDF export, push notifications. Added by your decisions: Playwright/Vitest suites, and the four cards with no backing data.

---

## Verification

```bash
# stack
make infra && make migrate seed && make api worker
cd frontend && npm run dev

# gates
make test && make check-boundary && make lint
cd frontend && npx tsc --noEmit && npx next lint && npm run build

# the definition of done
cd frontend && grep -rn "lib/mock" src/          # must print nothing
```

End-to-end proof is the golden path driven in the real UI — login → route → check-in → category → photograph → result with boxes on the real photo → confirm → task → checkout — cross-checked against the rows in `psql` and against `backend/scripts/demo_golden_path.py`, plus the three failure paths: `_unreadable` photo, expired token, and offline-then-reconnect.
