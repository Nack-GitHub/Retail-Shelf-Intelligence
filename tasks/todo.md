# Task List: Frontend ↔ Backend Integration

> Plan: [plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md)
> Mode: **DEMO** · ⛔ no `git push` · ⛔ no deleting other containers (`stop` only)

Legend — scope: **XS** 1 file · **S** 1–2 · **M** 3–5 · **L** 5–8

---

## Phase 0 — Plan artifacts

### - [x] T0: Write the plan and this task list
**Scope:** XS · **Depends on:** None

---

## Phase 1 — Foundation: real auth

### - [ ] T1: `lib/api/` core + real login
**Description:** The fetch wrapper every request passes through — base URL, JWT attach, 401 handling, Thai error mapping — plus the login screen wired to `POST /v1/auth/login` and a route guard that bounces an expired session back to login.

**Acceptance:**
- [ ] `rep@shelfeye.demo` / `demo1234` returns a real JWT and lands on `/m`
- [ ] Wrong password shows the API's Thai message, not a generic failure
- [ ] Clearing the token and reloading `/m` redirects to `/m/login`
- [ ] Token lives in `sessionStorage` with an `expiresAt`; never written to the console (⛔5)

**Verify:** `npx tsc --noEmit` · `npx next lint` · browser network panel shows `Authorization: Bearer` on `/v1/me`
**Files:** `lib/api/{client,errors,auth}.ts` · `components/auth/AuthGate.tsx` · `app/m/login/page.tsx` · `app/{m,w}/layout.tsx`
**Depends on:** None · **Scope:** M

### ▣ Checkpoint A
- [ ] `tsc --noEmit`, `next lint`, `npm run build` clean
- [ ] Login works against the real API; 401 redirects

---

## Phase 2 — Mobile golden path

### - [ ] T2: Today's route + store detail
**Description:** New backend `stores.py` (`GET /v1/stores`, `GET /v1/stores/{id}`), and `/m` + check-in driven by `GET /v1/routes/today`. First screen to cross the ratio→percent boundary, so the conversion is proven here before 19 screens depend on it.

**Acceptance:**
- [ ] `/m` lists the 5 seeded stores ordered by real risk DESC, distance ASC
- [ ] A never-visited store renders "ยังไม่เคยตรวจ", **not** `0%`
- [ ] Loading / error / empty states all reachable

**Verify:** backend pytest for both new endpoints · `/m` ordering matches `make demo` step 2
**Files:** `backend/app/api/v1/stores.py` · `backend/app/main.py` · `lib/api/routes.ts` · `app/m/page.tsx` · `app/m/store/[id]/checkin/page.tsx`
**Depends on:** T1 · **Scope:** M

### - [ ] T3: Categories + real check-in
**Description:** New `catalog.py` serving `GET /v1/categories?storeId=` with `lastOsa` computed from real analyses, and check-in creating a real `visits` row.

**Acceptance:**
- [ ] Check-in inserts a `visits` row with the real `gpsMatch`
- [ ] GPS 5 km off is flagged, **not** blocked
- [ ] A `FORBIDDEN` store shows the API's Thai 403 instead of opening the camera

**Verify:** backend pytest · check in from the browser, confirm the row in `psql`
**Files:** `backend/app/api/v1/catalog.py` · `lib/api/{catalog,visits}.ts` · `lib/store.ts` · `app/m/store/[id]/{checkin,category}/page.tsx`
**Depends on:** T2 · **Scope:** M

### - [ ] T4: Capture flow — presign → PUT → commit → poll  ⚠️ highest risk
**Description:** Real upload straight to object storage and real job polling. `/processing` loses its fake timer.

**Acceptance:**
- [ ] The photo lands in MinIO and produces an `inference_jobs` row
- [ ] Committing twice with one Idempotency-Key yields one job
- [ ] A `_unreadable` bay shows "ภาพไม่ชัดหรือเสียหาย กรุณาถ่ายใหม่" and **no OSA** (⛔3)
- [ ] The `PUT` carries **no** `Authorization` header (⛔4)

**Verify:** browser network panel · MinIO console shows the object · walk the `_unreadable` path by hand
**Files:** `lib/api/captures.ts` · `lib/store.ts` · `app/m/store/[id]/{capture,processing}/page.tsx`
**Depends on:** T3 · **Scope:** M

### - [ ] T5: Real result screen — real photo, real boxes
**Description:** Add `imageUrl` (presigned GET) to `ShelfAnalysisOut`; `/result` renders the real analysis with boxes drawn over the actual photograph.

**Acceptance:**
- [ ] Boxes land on the correct pixels at any capture resolution
- [ ] `modelVersion` comes from the DB row
- [ ] Filters still branch on `semanticType` only (⛔2)
- [ ] The "กรอบจำลอง · ยังไม่ต่อโมเดล" badge is gone

**Verify:** screenshot the overlay on a real photo · `grep -rn 'className ===' frontend/src/components/shelf/` → nothing
**Files:** `backend/app/api/v1/{schemas,captures}.py` · `lib/api/captures.ts` · `app/m/store/[id]/result/page.tsx` · `components/shelf/{DetectionOverlay,CaptureFrame,CropView}.tsx`
**Depends on:** T4 · **Scope:** M

### - [ ] T6: verify → task → checkout
**Description:** Verification, tasks and checkout all go to the server. `buildTasks()` is deleted — the API creates tasks on CONFIRMED.

**Acceptance:**
- [ ] CONFIRMED creates exactly one `tasks` row, idempotent on double-tap
- [ ] REJECTED with a reason removes any task already created
- [ ] `OUT_OF_BACKSTOCK` raises a real `replenishment_requests` row
- [ ] Checkout returns real `osaBefore` / `osaAfter`

**Verify:** `test_golden_path.py` + `test_review_findings.py` green · walk the flow, confirm rows in `psql`
**Files:** `lib/api/{findings,tasks}.ts` · `lib/store.ts` · `app/m/store/[id]/{verify,tasks,compare,checkout}/page.tsx`
**Depends on:** T5 · **Scope:** M

### ▣ Checkpoint B
- [ ] Golden path end to end on real data
- [ ] `make test` green · `tsc --noEmit` · `next lint` · `npm run build` clean
- [ ] A bad photo says "ถ่ายใหม่" and shows no OSA

---

## Phase 3 — Manager web

### - [ ] T7: KPIs + areas + dashboard
**Description:** `GET /v1/analytics/kpis` (only the computable KPIs), `GET /v1/areas`, and `/w` wired to those plus the existing OSA-trend and risk-ranking endpoints.

**Acceptance:**
- [ ] Three KPI cards, not four — "ต้นทุนต่อการตรวจ" is absent, not invented
- [ ] Trend buckets by real week from `shelf_analyses`
- [ ] A rep token gets 403 on every analytics endpoint

**Verify:** backend pytest incl. a no-`userId`-in-response assertion (⛔1) · browser check of `/w`
**Files:** `backend/app/api/v1/{analytics,areas}.py` · `lib/api/analytics.ts` · `app/w/page.tsx` · `components/web/WebShell.tsx`
**Depends on:** T1 · **Scope:** M

### - [ ] T8: Store detail
**Description:** `/w/stores/[id]` from `GET /v1/stores/{id}` + the existing `/stores/{id}/history` + store-scoped OSA trend. The SKU×day heatmap card is removed (no backing data).

**Acceptance:**
- [ ] Timeline rows are real visits with real before/after OSA
- [ ] A store with no history shows the empty state, not a flat-zero chart
- [ ] `EvidenceViewer` opens a real capture

**Verify:** browser check against `psql` rows
**Files:** `app/w/stores/[id]/page.tsx` · `components/web/EvidenceViewer.tsx` · `lib/api/analytics.ts`
**Depends on:** T2, T7 · **Scope:** M

### - [ ] T9: Route plan
**Description:** `GET /v1/analytics/route-plan` — store-level risk ordering with `avgVisitMinutes` from closed visits, `null` when never visited.

**Acceptance:**
- [ ] Ordering matches `risk_score` DESC
- [ ] `avgVisitMinutes` renders "—" when null, never a fabricated estimate
- [ ] Drag-to-reorder still works client-side

**Verify:** backend pytest · browser check of `/w/routes`
**Files:** `backend/app/api/v1/analytics.py` · `lib/api/analytics.ts` · `app/w/routes/page.tsx`
**Depends on:** T7 · **Scope:** S

### ▣ Checkpoint C
- [ ] All three manager screens on real data, no invented numbers
- [ ] Rep role is 403 everywhere under `/w`

---

## Phase 4 — Data team

### - [ ] T10: Model health
**Description:** Seed `model_versions` from the real artifact metrics, and serve `GET /v1/model/health` with the true gate-failing numbers plus a weekly rep-override rate in place of drift.

**Acceptance:**
- [ ] Gap-class recall reads **0.4113** against target 0.90, in red
- [ ] Override rate is computed from `gap_findings`, never hardcoded
- [ ] Version list comes from the `model_versions` table

**Verify:** backend pytest · browser check of `/w/model-health`
**Files:** `backend/app/api/v1/model_health.py` · `backend/app/db/seed.py` · `backend/app/main.py` · `lib/api/model.ts` · `app/w/model-health/page.tsx`
**Depends on:** T7 · **Scope:** M

### - [ ] T11: Relabel queue
**Description:** `GET /v1/model/relabel-queue` — rejected and low-confidence findings with image, bbox and reason. ⛔ **never who rejected it.**

**Acceptance:**
- [ ] Queue reflects real findings produced by the golden path
- [ ] Response contains no `verifiedBy` / `userId` / `repName` — asserted by a new prohibition test
- [ ] Image and bbox render in the review pane

**Verify:** new test in `test_prohibitions.py` · browser check of `/w/relabel`
**Files:** `backend/app/api/v1/model_health.py` · `backend/tests/integration/test_prohibitions.py` · `lib/api/model.ts` · `app/w/relabel/page.tsx`
**Depends on:** T10 · **Scope:** M

### ▣ Checkpoint D
- [ ] Data-team screens real; prohibition tests cover both new endpoints

---

## Phase 5 — Offline, then deletion

### - [ ] T12: Offline queue + sync
**Description:** A hand-written IndexedDB queue (no new dependency), real online detection, and a drain that replays the idempotent endpoints then acknowledges via `POST /v1/sync/batch`.

**Acceptance:**
- [ ] Capturing offline queues the item **with its blob**
- [ ] Reconnecting uploads, analyses, and clears the queue
- [ ] **No duplicate rows** in `captures` or `tasks` after a replayed batch

**Verify:** devtools offline mode by hand · row counts in `psql` before and after
**Files:** `lib/offline/{queue,useOnline}.ts` · `lib/api/sync.ts` · `lib/store.ts` · `app/m/sync/page.tsx` · `app/m/captures/page.tsx`
**Depends on:** T6 · **Scope:** M

### - [ ] T13: Delete `lib/mock/`
**Description:** Move the drawn shelf to `components/shelf/PlaceholderShelf.tsx` and the reason lists to `lib/constants.ts`, then delete the directory.

**Acceptance:**
- [ ] `grep -rn "lib/mock" frontend/src/` prints nothing
- [ ] `npm run build` passes with the directory gone
- [ ] A machine with no camera can still walk the whole flow

**Verify:** the grep, then a clean build
**Files:** `components/shelf/PlaceholderShelf.tsx` · `lib/constants.ts` · delete `lib/mock/`
**Depends on:** T2–T12 · **Scope:** M

### - [ ] T14: Final sweep
**Description:** Prohibition coverage for every new endpoint, all gates green, and a walk of all 20 screens checking loading / error / empty on each.

**Acceptance:**
- [ ] No new endpoint returns any per-individual field (⛔1)
- [ ] Every screen that loads data has all three states
- [ ] All SPEC §11 criteria met except the two Playwright-dependent ones

**Verify:** `make test` · `make check-boundary` · `make lint` · `tsc --noEmit` · `next lint` · `npm run build`
**Depends on:** T13 · **Scope:** S

### ▣ Checkpoint E — complete
- [ ] Every gate green, every screen real
