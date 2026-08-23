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

### - [x] T1: `lib/api/` core + real login
**Description:** The fetch wrapper every request passes through — base URL, JWT attach, 401 handling, Thai error mapping — plus the login screen wired to `POST /v1/auth/login` and a route guard that bounces an expired session back to login.

**Acceptance:**
- [x] `rep@shelfeye.demo` / `demo1234` returns a real JWT and lands on `/m`
- [x] Wrong password shows the API's Thai message ("อีเมลหรือรหัสผ่านไม่ถูกต้อง"), not a generic failure
- [x] Clearing the token and reloading `/m` redirects to `/m/login`
- [x] Token lives in `sessionStorage` with an `expiresAt`; never written to the console (⛔5)

**Verify:** `npx tsc --noEmit` · `npx next lint` · browser network panel shows `Authorization: Bearer` on `/v1/me`
**Files:** `lib/api/{client,errors,auth}.ts` · `components/auth/AuthGate.tsx` · `app/m/login/page.tsx` · `app/{m,w}/layout.tsx`
**Depends on:** None · **Scope:** M

### ▣ Checkpoint A
- [x] `tsc --noEmit`, `next lint`, `npm run build` clean
- [x] Login works against the real API; 401 redirects

---

## Phase 2 — Mobile golden path

### - [x] T2: Today's route + store detail
**Description:** New backend `stores.py` (`GET /v1/stores`, `GET /v1/stores/{id}`), and `/m` + check-in driven by `GET /v1/routes/today`. First screen to cross the ratio→percent boundary, so the conversion is proven here before 19 screens depend on it.

**Acceptance:**
- [x] `/m` lists the 5 seeded stores ordered by real risk DESC, distance ASC
- [x] A never-visited store renders "ยังไม่เคยตรวจ", **not** `0%` (backend test uses its own fixture store)
- [x] Loading / error / empty states all reachable via `useResource` + `AsyncState`
- [x] Fixed en route: `last_osa` used `MAX(osa_score)` — the best score ever, not the latest — so every store read 100%

**Verify:** backend pytest for both new endpoints · `/m` ordering matches `make demo` step 2
**Files:** `backend/app/api/v1/stores.py` · `backend/app/main.py` · `lib/api/routes.ts` · `app/m/page.tsx` · `app/m/store/[id]/checkin/page.tsx`
**Depends on:** T1 · **Scope:** M

### - [x] T3: Categories + real check-in
**Description:** New `catalog.py` serving `GET /v1/categories?storeId=` with `lastOsa` computed from real analyses, and check-in creating a real `visits` row.

**Acceptance:**
- [x] Check-in inserts a `visits` row with the real `gpsMatch`
- [x] GPS 5 km off is flagged, **not** blocked (browser check-in wrote `gps_match=f`, still OPEN)
- [x] A `FORBIDDEN` store shows the API's Thai 403 instead of opening the camera
- [x] Fixed en route: FastAPI's English `detail` ("Not Found") was reaching users; only Thai detail is shown now
- [x] Public query params standardised on camelCase to match the responses

**Verify:** backend pytest · check in from the browser, confirm the row in `psql`
**Files:** `backend/app/api/v1/catalog.py` · `lib/api/{catalog,visits}.ts` · `lib/store.ts` · `app/m/store/[id]/{checkin,category}/page.tsx`
**Depends on:** T2 · **Scope:** M

### - [x] T4: Capture flow — presign → PUT → commit → poll  ⚠️ highest risk
**Description:** Real upload straight to object storage and real job polling. `/processing` loses its fake timer.

**Acceptance:**
- [x] The photo lands in MinIO and produces an `inference_jobs` row (verified in psql: real object_key, DONE, osa 0.875)
- [x] Committing twice with one Idempotency-Key yields one job (`test_capture_commit_is_idempotent`)
- [x] A `_unreadable` bay shows "ภาพไม่ชัดหรือเสียหาย กรุณาถ่ายใหม่" and **no OSA** — the result endpoint 404s, so there is nothing to show (⛔3)
- [x] The `PUT` carries **no** `Authorization` header — only `content-type` (⛔4)
- [x] MinIO CORS allows browser PUTs from :3000 out of the box; no compose change needed

**Verify:** browser network panel · MinIO console shows the object · walk the `_unreadable` path by hand
**Files:** `lib/api/captures.ts` · `lib/store.ts` · `app/m/store/[id]/{capture,processing}/page.tsx`
**Depends on:** T3 · **Scope:** M

### - [x] T5: Real result screen — real photo, real boxes
**Description:** Add `imageUrl` (presigned GET) to `ShelfAnalysisOut`; `/result` renders the real analysis with boxes drawn over the actual photograph.

**Acceptance:**
- [x] Boxes land on the correct pixels at any capture resolution — verified: viewBox 1920×1080 matches the detection space, every box inside it
- [x] `modelVersion` comes from the DB row (`mock-v1`)
- [x] Filters still branch on `semanticType` only (⛔2)
- [x] The "กรอบจำลอง · ยังไม่ต่อโมเดล" badge is gone
- [x] Fixed en route: the result reported the client's claimed image size while the boxes were computed against the size the model decoded — boxes landed *almost* right

**Verify:** screenshot the overlay on a real photo · `grep -rn 'className ===' frontend/src/components/shelf/` → nothing
**Files:** `backend/app/api/v1/{schemas,captures}.py` · `lib/api/captures.ts` · `app/m/store/[id]/result/page.tsx` · `components/shelf/{DetectionOverlay,CaptureFrame,CropView}.tsx`
**Depends on:** T4 · **Scope:** M

### - [x] T6: verify → task → checkout
**Description:** Verification, tasks and checkout all go to the server. `buildTasks()` is deleted — the API creates tasks on CONFIRMED.

**Acceptance:**
- [x] CONFIRMED creates exactly one `tasks` row, idempotent on double-tap (3 confirms → 3 tasks, 68→71)
- [x] REJECTED with a reason removes any task already created (server-side, covered by `test_review_findings.py`)
- [x] `OUT_OF_BACKSTOCK` raises a real `replenishment_requests` row (23→24)
- [x] Checkout returns real `osaBefore` / `osaAfter` — both 0.875 from the BEFORE and AFTER analyses
- [x] The AFTER photo is now actually uploaded, which is what makes `osa_after` a measurement
- [x] Removed the client-side OSA estimate: it assumed every fixed task restored its full share, read high, and disagreed with the manager's dashboard

**Verify:** `test_golden_path.py` + `test_review_findings.py` green · walk the flow, confirm rows in `psql`
**Files:** `lib/api/{findings,tasks}.ts` · `lib/store.ts` · `app/m/store/[id]/{verify,tasks,compare,checkout}/page.tsx`
**Depends on:** T5 · **Scope:** M

### ▣ Checkpoint B
- [x] Golden path end to end on real data — login → route → check-in → category → photo → OSA 88% with boxes → 3 confirms → 3 tasks → 2 fixed + 1 blocked → after-photo → checkout 88%→88%
- [x] `make test` green (83) · `tsc --noEmit` · `next lint` · `npm run build` clean
- [x] A bad photo says "ถ่ายใหม่" and shows no OSA

---

## Phase 3 — Manager web

### - [x] T7: KPIs + areas + dashboard
**Description:** `GET /v1/analytics/kpis` (only the computable KPIs), `GET /v1/areas`, and `/w` wired to those plus the existing OSA-trend and risk-ranking endpoints.

**Acceptance:**
- [x] Three KPI cards, not four — "ต้นทุนต่อการตรวจ" is absent, not invented
- [x] Trend buckets by real week from `shelf_analyses`; under two buckets the chart says so instead of drawing a line through one point
- [x] A rep token gets 403 on every analytics endpoint — verified in the browser, Thai message shown
- [x] KPI deltas compare the preceding window of equal length; `null` when there is no earlier window, so no chip is drawn
- [x] Dropped the per-store OSA-delta column: not computed, and not worth a second query for a demo

**Verify:** backend pytest incl. a no-`userId`-in-response assertion (⛔1) · browser check of `/w`
**Files:** `backend/app/api/v1/{analytics,areas}.py` · `lib/api/analytics.ts` · `app/w/page.tsx` · `components/web/WebShell.tsx`
**Depends on:** T1 · **Scope:** M

### - [x] T8: Store detail
**Description:** `/w/stores/[id]` from `GET /v1/stores/{id}` + the existing `/stores/{id}/history` + store-scoped OSA trend. The SKU×day heatmap card is removed (no backing data).

**Acceptance:**
- [x] Timeline rows are real visits with real before/after OSA, gap counts, and an open-visit pill
- [x] A store with no history shows the empty state, not a flat-zero chart
- [x] `EvidenceViewer` opens a real capture — presigned MinIO photo, boxes in the correct 1920×1080 space, model version from the DB
- [x] Evidence metadata shows the capturer's ROLE, never their identity (⛔1)
- [x] SKU×day heatmap dropped: no backing data
- [x] `GET /v1/stores/{id}/history` now carries the captures behind each visit — a number a manager cannot open back to the photograph is a claim, not evidence

**Verify:** browser check against `psql` rows
**Files:** `app/w/stores/[id]/page.tsx` · `components/web/EvidenceViewer.tsx` · `lib/api/analytics.ts`
**Depends on:** T2, T7 · **Scope:** M

### - [x] T9: Route plan
**Description:** `GET /v1/analytics/route-plan` — store-level risk ordering with `avgVisitMinutes` from closed visits, `null` when never visited.

**Acceptance:**
- [x] Ordering matches `risk_score` DESC
- [x] `avgVisitMinutes` renders "—" when null, never a fabricated estimate
- [x] Drag-to-reorder still works client-side
- [x] "Sort by distance" replaced with "by staleness": a weekly plan has no current position to measure distance from
- [x] Fixed: coverage read 0% and warned about excluded high-risk stores when there were none

**Verify:** backend pytest · browser check of `/w/routes`
**Files:** `backend/app/api/v1/analytics.py` · `lib/api/analytics.ts` · `app/w/routes/page.tsx`
**Depends on:** T7 · **Scope:** S

### ▣ Checkpoint C
- [x] All three manager screens on real data, no invented numbers
- [x] Rep role is 403 everywhere under `/w`

---

## Phase 4 — Data team

### - [x] T10: Model health
**Description:** Seed `model_versions` from the real artifact metrics, and serve `GET /v1/model/health` with the true gate-failing numbers plus a weekly rep-override rate in place of drift.

**Acceptance:**
- [x] Gap-class recall reads **0.4113** against target 0.90, in red — all three gates fail, with their rationales
- [x] Override rate is computed from `gap_findings` (38.5% this week, from 143 reviewed), never hardcoded
- [x] Version list comes from `model_versions`, seeded from the real artifact SHA `24931c2b`
- [x] Drift chart removed: drift needs a reference distribution this system does not store

**Verify:** backend pytest · browser check of `/w/model-health`
**Files:** `backend/app/api/v1/model_health.py` · `backend/app/db/seed.py` · `backend/app/main.py` · `lib/api/model.ts` · `app/w/model-health/page.tsx`
**Depends on:** T7 · **Scope:** M

### - [x] T11: Relabel queue
**Description:** `GET /v1/model/relabel-queue` — rejected and low-confidence findings with image, bbox and reason. ⛔ **never who rejected it.**

**Acceptance:**
- [x] Queue reflects real findings produced by the golden path (55 real rejections)
- [x] Response contains no `verifiedBy` / `userId` / `repName` — asserted by `test_model_health.py`, and re-checked against the rendered DOM
- [x] Image and bbox render in the review pane, cropped from the real presigned capture
- [x] "Send to next training round" relabelled: it is a local mark, and the screen says so rather than claiming a submission that does not happen

**Verify:** new test in `test_prohibitions.py` · browser check of `/w/relabel`
**Files:** `backend/app/api/v1/model_health.py` · `backend/tests/integration/test_prohibitions.py` · `lib/api/model.ts` · `app/w/relabel/page.tsx`
**Depends on:** T10 · **Scope:** M

### ▣ Checkpoint D
- [x] Data-team screens real; prohibition tests cover both new endpoints

---

## Phase 5 — Offline, then deletion

### - [x] T12: Offline queue + sync
**Description:** A hand-written IndexedDB queue (no new dependency), real online detection, and a drain that replays the idempotent endpoints then acknowledges via `POST /v1/sync/batch`.

**Acceptance:**
- [x] Capturing offline queues the item **with its blob** (55 KB JPEG in IndexedDB, status PENDING)
- [x] Reconnecting drains automatically — no button press needed — and the item goes DONE
- [x] **No duplicate rows**: captures went 500 → 501, one job, analysed to DONE
- [x] Fixed en route: `AuthGate` treated a network failure as an auth failure and blocked the whole app the moment signal dropped — the exact failure the queue exists to prevent
- [x] Deleted the simulated online toggle and fake sync list; connectivity now comes from `navigator.onLine`

**Verify:** devtools offline mode by hand · row counts in `psql` before and after
**Files:** `lib/offline/{queue,useOnline}.ts` · `lib/api/sync.ts` · `lib/store.ts` · `app/m/sync/page.tsx` · `app/m/captures/page.tsx`
**Depends on:** T6 · **Scope:** M

### - [x] T13: Delete `lib/mock/`
**Description:** Move the drawn shelf to `components/shelf/PlaceholderShelf.tsx` and the reason lists to `lib/constants.ts`, then delete the directory.

**Acceptance:**
- [x] `grep -rn "lib/mock" frontend/src/` prints nothing but one comment explaining the deletion
- [x] `npm run build` passes with the directory gone
- [x] A machine with no camera can still walk the whole flow — the drawn shelf moved to `components/shelf/placeholder-shelf.ts`
- [x] `REJECT_REASONS` / `BLOCKED_REASONS` moved to `lib/constants.ts`: they are the closed sets the API validates against, not mock data

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
