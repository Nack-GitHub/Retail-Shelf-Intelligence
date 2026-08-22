# ShelfEye — Frontend

Front end for the shelf gap detection & replenishment flow described in
[`../ui.md`](../ui.md). Two surfaces, one design system, all copy in Thai.

**Demo only — no API calls.** Every screen runs on local mock data so the
whole flow is clickable end to end. The backend is a separate piece of work.

## Run

```bash
npm run dev --prefix frontend
```

Open <http://localhost:3000> and pick a platform.

| Command | What it does |
| :-- | :-- |
| `npm run dev` | Dev server (Turbopack) on :3000 |
| `npm run dev:mobile` | Same, over HTTPS on the LAN — needed for the camera on a phone |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |

### Testing the camera on a real phone

`getUserMedia` only exists in a **secure context**. `http://localhost` counts,
so the camera works on the laptop straight away — but a phone reaching the dev
server over the LAN (`http://192.168.x.x:3000`) gets no camera at all. The app
detects this and says so rather than reporting a permission failure.

```bash
npm run dev:mobile --prefix frontend
```

Then open `https://<your-mac-lan-ip>:3000` on the phone and accept the
self-signed certificate warning.

**`allowedDevOrigins` is required for either route.** The dev server rejects
`/_next/*` requests from origins it does not recognise, and the failure is
quiet in the worst way: the page HTML returns 200 while every JS chunk 403s,
so the app comes up blank with no obvious error. `next.config.ts` already
allows `*.trycloudflare.com`, the ngrok hosts, and private LAN ranges. Add
your own host there if you tunnel through something else — and restart the
dev server, since config changes are not hot-reloaded. The first run may ask to install a local
certificate authority. If the phone refuses the certificate outright (iOS is
strict), put a tunnel in front of the plain dev server instead —
`cloudflared tunnel --url http://localhost:3000` — and use the https URL it
prints.

## Routes

Each platform gets its own route tree; they share tokens and primitives but
nothing about their layout.

### `/m/*` — Field rep, mobile web

Renders full-bleed on a phone. On desktop it renders inside a 390×844 device
frame so the demo reads correctly on a laptop.

| Route | Spec | Screen |
| :-- | :-- | :-- |
| `/m/login` | S1 | Login (default / error / offline) |
| `/m` | S2 | Today's route (list / empty / syncing) |
| `/m/store/[id]/checkin` | S3 | Check-in + mandatory photo consent |
| `/m/store/[id]/category` | S4 | Pick category & shelf bay |
| `/m/store/[id]/capture` | S5, S6 | Camera + quality guidance, then preview |
| `/m/store/[id]/processing` | S7 | Analysing (online / offline / failed) |
| `/m/store/[id]/result` | S8 | **Hero:** detections over the photo + OSA |
| `/m/store/[id]/verify` | S9 | Verify each gap — one at a time or as a list |
| `/m/store/[id]/tasks` | S10 | Task list, swipe or tap to close |
| `/m/store/[id]/compare` | S11 | After photo + before/after slider |
| `/m/store/[id]/checkout` | S12 | Check-out summary |
| `/m/sync` | S13 | Offline sync queue |
| `/m/captures` | — | Local intake log for every photo taken or uploaded |

### `/w/*` — Area manager & data team, desktop web

| Route | Spec | Screen |
| :-- | :-- | :-- |
| `/w` | W1 | Area dashboard — KPIs, OSA trend, risk table |
| `/w/stores/[id]` | W2 | Store detail — history, OOS heatmap, evidence timeline |
| (modal on W2) | W3 | Evidence viewer — overlay toggle, metadata, export |
| `/w/routes` | W4 | Route planning — drag to reorder, approve |
| `/w/model-health` | W5 | Recall / precision / override rate / drift |
| `/w/relabel` | W6 | Relabel queue — select images, send to retrain |

Screens with more than one state carry a dashed **“สาธิตสถานะหน้าจอ”**
switcher so every state in the spec can be inspected without faking network
or data conditions. Remove `StateSwitcher` when the API lands.

## Structure

```
src/
  app/            routes only — each page owns its layout and local state
  components/
    ui/           Button, Card, Badge, Sheet, Progress, Controls, Logo
    mobile/       MobileShell (device frame + page transitions), Chrome, MapSnippet
    web/          WebShell (sidebar + page header), EvidenceViewer
    shelf/        ShelfPhoto, DetectionOverlay, CropView, SkuThumb
    charts/       LineChart, Sparkline, Heatmap (hand-rolled SVG)
  lib/
    mock/         shelf geometry, stores, analytics — the future API surface
    store.ts      demo state (zustand)
    motion.ts     shared easings and variants
  types/          domain types mirroring the backend contract
```

### Photos: camera, upload, and the intake log

`src/lib/capture.ts` is the single door every image enters through, whether it
came from the device camera or a file the rep picked:

```ts
intakePhoto(blob | File, "CAMERA" | "UPLOAD", "BEFORE" | "AFTER") → CapturedPhoto
```

It decodes the image, resizes the long edge down to 1920 px, re-encodes to
JPEG, mints the `Idempotency-Key` the commit endpoint will need, records
device info, and logs the whole record to the console. **Nothing is uploaded.**
When the API lands, this is the one function that also POSTs the blob — the
`POST /v1/captures/presign` → `PUT` to object storage pair goes here.

`src/hooks/useCamera.ts` drives the real camera: rear lens by preference,
streamed into a `<video>` the page owns, with a still grabbed by drawing the
current frame to a canvas. The still is centre-cropped to the same 16:9 region
the viewfinder displays, so what the rep frames is what gets saved. Permission
denial, no camera, camera busy, and insecure-context are each reported
separately, because the fix differs for each.

Every intake — including shots the rep discards — is listed at
**`/m/captures`** with its thumbnail, source, before/after dimensions and byte
size, processing time, capture id, idempotency key, and face-blur status. That
page exists because a console is unreadable on the phone that took the photo.
The log lives in memory for the tab, so a hard refresh clears it.

**Face blur is not implemented.** The spec requires on-device blurring before
upload and the flow has the step, but there is no face detector wired up, so
every record honestly carries `faceBlur.applied = false`, method `NOT_WIRED`,
and the log page flags it. The blur belongs in `intakePhoto`, between the
canvas draw and the encode — that line is marked in the file. Do not ship
without it.

### The stand-in shelf

When no camera is available — a desktop reviewer, a denied permission — the
flow still runs on a drawn shelf. `lib/mock/shelf.ts` describes that shelf
once: every slot, its size, and whether it holds product, is nearly empty, or
is a gap. `ShelfPhoto` draws the array as a photo-like SVG and
`buildDetections()` derives the bounding boxes from the same array, so an
overlay box can never drift away from the thing it points at. `CaptureFrame`
picks between a real photo and this stand-in.

Coordinates follow the inference contract in [`../backend.md`](../backend.md):
absolute pixels, top-left origin, never normalised. When a real photo is
present, `buildAnalysis({width, height})` rescales the mock boxes into that
photo's pixel space, so the overlay maths is already what the model will need.
The boxes cannot line up with real products until a model exists, so the
result screen labels them **"กรอบจำลอง · ยังไม่ต่อโมเดล"** on any real capture.

## Wiring up the API later

The seam is `src/lib/mock/` plus `src/lib/store.ts`. Components read domain
types from `src/types`, which already mirror the contract, so swapping mock
data for real endpoints should be a data-layer change:

| Mock | Replaces |
| :-- | :-- |
| `STORES`, `CATEGORIES` | `GET /v1/routes/today` |
| `buildAnalysis()` | `GET /v1/captures/{id}/result` |
| `intakePhoto()` in `capture.ts` | `POST /v1/captures/presign` + `PUT` to storage + `POST /v1/captures/{id}/commit` |
| `verify()` in `store.ts` | `POST /v1/findings/{id}/verify` |
| `setTask()` in `store.ts` | `PATCH /v1/tasks/{id}` |
| `KPIS`, `OSA_TREND`, `RISK_RANKING` | `GET /v1/analytics/*` |
| `MODEL_METRICS`, `DRIFT_SERIES` | model health endpoints |

Add a server-state library (React Query or SWR) at that point and keep
`store.ts` for UI concerns only.

## Guardrails enforced in the UI

These are product requirements from the spec, not stylistic choices — check
them on every change:

1. **S3** — the camera cannot be opened until “ได้รับอนุญาตจากร้านให้ถ่ายภาพแล้ว”
   is ticked. The primary button stays disabled.
2. **S5** — opening `/m/store/[id]/capture` without a recorded consent shows a
   gate instead of a viewfinder; the camera is never even requested. Face blur
   is still outstanding (see above) and every capture record says so.
3. **S9** — “✗ ไม่ใช่” and “✓ ใช่ ขาดจริง” share identical geometry, border
   weight and type. Neither is styled as the preferred answer. See the comment
   above `VerdictButton`.
4. **W1–W6** — no leaderboard, ranking or score for an individual rep exists
   anywhere. Aggregation is store and area level only; evidence records the
   capturer's *role*, never their identity or performance.
5. **W1/W2** — every number reaches its source photo within two clicks, and
   every finding carries a “โต้แย้งผลนี้” action.
6. No control anywhere sends a message to a store or acts on a store
   automatically.

## Accessibility & motion

- 48px+ tap targets on all primary mobile actions, bottom-anchored for
  one-handed use.
- Visible focus rings everywhere; bottom sheets and the evidence modal trap
  focus, close on Escape and restore focus on exit.
- State is never carried by colour alone — risk, OSA and sync status all pair
  a colour with a dot and a word.
- Only `transform` and `opacity` are animated. Entering uses ease-out,
  leaving uses ease-in, and everything collapses under
  `prefers-reduced-motion: reduce`.
