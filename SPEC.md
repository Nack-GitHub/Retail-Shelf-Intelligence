# SPEC: Front-end Navigation & Camera Lifecycle Hardening

> สถานะ: **ทำเสร็จแล้ว — รอ review** · ขอบเขต: `frontend/` เท่านั้น (ไม่แตะ backend / model)
>
> defect ระดับ C/H/M ทั้งหมดใน §5.2 แก้แล้วและมี Playwright คุมไว้ (39 tests)
> รายการที่เหลือให้ทำด้วยมือคือเช็คลิสต์บนมือถือจริงใน §8 ซึ่ง Chromium
> แทนไม่ได้ (bfcache และการยึดกล้องของ iOS Safari)
> เอกสารอ้างอิง: [docs/ui.md](docs/ui.md) §1.3 End-to-End Flow, §1.5 Guardrails

---

## 1. Objective

### 1.1 ปัญหาที่กำลังแก้

แอปพนักงานภาคสนาม (`/m/**`) เป็น Next.js App Router SPA ที่เก็บ state ของการเข้าร้าน
ทั้งหมดไว้ใน zustand store แบบ in-memory ผลคือ **เส้นทางไปกลับ (forward/back) ไม่ถูก
นิยามไว้ที่ไหนเลย** — แต่ละหน้าตัดสินใจเองว่าจะ `push` หรือ `replace` และปุ่มย้อนกลับ
ทุกหน้าเรียก `router.back()` ดิบ ๆ ซึ่งเป็น history back ของเบราว์เซอร์ ไม่ผูกกับ
ลำดับขั้นของ flow จริง

อาการที่ผู้ใช้เจอ:

1. กด navigate ไปหน้าอื่นแล้ว back กลับมา **ไม่ได้กลับไปหน้าที่ถูกต้อง** (บางครั้งเจอ
   หน้าขาว บางครั้งเจอหน้าที่ state ถูกล้างไปแล้ว บางครั้งโดนดันไปข้างหน้าเอง)
2. เปิดกล้อง → ถ่ายรูป → back กลับมา → **กล้องเปิดไม่ติด** (จอดำ หรือขึ้นว่า
   "กล้องถูกใช้งานโดยแอปอื่นอยู่") แบบไม่สม่ำเสมอ — ครั้งแรกติด ครั้งที่สองไม่ติด

### 1.2 ผู้ใช้เป้าหมาย

พนักงานภาคสนาม (field rep) ใช้ mobile web บนมือถือจริงผ่าน https ยืนอยู่หน้าชั้นวาง
ในร้าน มือข้างหนึ่งถือของ อีกข้างถือมือถือ — ทุกครั้งที่กล้องไม่ติดคือการยืนรอกลางร้าน
และทุกครั้งที่ back ไปผิดหน้าคือการเดินงานซ้ำ

### 1.3 นิยามของ "เสร็จ"

- เส้นทางไปกลับทุกเส้นถูกนิยามไว้ **ที่เดียว** และ back จากทุกหน้าไปยังหน้าที่ถูกต้อง
  ตาม flow ใน [docs/ui.md](docs/ui.md) §1.3
- ไม่มีหน้าใดใน `/m/**` ที่ render เป็นหน้าขาว ไม่ว่าจะเข้าถึงด้วยวิธีใด
- กล้องเปิดติดทุกครั้งที่กลับเข้าหน้าที่ใช้กล้อง และรูปที่ถ่ายค้างไว้ไม่หาย
- มี Playwright E2E ที่จับ regression ของทั้งสองเรื่องได้จริง

### 1.4 นอกขอบเขต

- Web dashboard `/w/**` (แก้เฉพาะ `login → /w` ที่เป็นเส้นทางร่วม)
- การเปลี่ยน zustand เป็น React Query / server state
- On-device face blur (`capture.ts` — `faceBlur.method: "NOT_WIRED"`)
- Backend, model, contracts

---

## 2. Tech Stack

| ส่วน | ของที่ใช้ | เวอร์ชัน |
| :-- | :-- | :-- |
| Framework | Next.js App Router | 16.3.2 |
| Runtime | React | 19.2.8 |
| State | zustand | ^5.0.15 |
| Animation | motion (`motion/react`) | ^13.1.1 |
| Styling | Tailwind CSS | ^4 (`@tailwindcss/postcss`) |
| Language | TypeScript strict | ^5, target ES2017 |
| Lint | eslint-config-next (core-web-vitals + typescript) | 16.3.2 |
| E2E (จะเพิ่ม) | @playwright/test | latest |

> ⚠️ `frontend/AGENTS.md` เตือนว่า Next.js เวอร์ชันนี้มี breaking change จากที่โมเดลรู้
> — ก่อนเขียนโค้ดที่แตะ router/navigation ให้อ่าน `frontend/node_modules/next/dist/docs/`
> ก่อนเสมอ

---

## 3. Commands

รันจาก `frontend/` :

```
Dev (desktop):     npm run dev
Dev (มือถือจริง):   npm run dev:mobile      # next dev --experimental-https -H 0.0.0.0
Build:             npm run build
Start (prod):      npm run start
Lint:              npm run lint
Typecheck:         npx tsc --noEmit
E2E (จะเพิ่ม):      npm run test:e2e
E2E headed:        npm run test:e2e -- --headed
E2E ไฟล์เดียว:      npm run test:e2e -- e2e/camera-lifecycle.spec.ts
```

รันจาก repo root (backend ที่ front-end ต้องพึ่ง):

```
Infra:             make infra
Migrate + seed:    make migrate && make seed
API:               make api
```

> `npm run dev:mobile` จำเป็นสำหรับทดสอบกล้องบนมือถือจริง เพราะ `getUserMedia`
> ทำงานเฉพาะใน secure context (`useCamera.ts:65`) และ `next.config.ts` มี
> `allowedDevOrigins` เตรียมไว้แล้วสำหรับ LAN / tunnel

---

## 4. Project Structure

โครงที่มีอยู่ (ไม่เปลี่ยน):

```
frontend/src/app/m/            → mobile field-rep screens (S1–S13)
frontend/src/app/w/            → web manager screens (W1–W6)
frontend/src/components/mobile → MobileShell, Chrome (header/bottom bar/scroll)
frontend/src/components/auth   → AuthGate
frontend/src/hooks             → useCamera
frontend/src/lib/store.ts      → zustand visit state
frontend/src/lib/api           → API client + per-resource modules
frontend/src/lib/offline       → IndexedDB queue
```

ของใหม่ที่ spec นี้เพิ่ม:

```
frontend/src/lib/flow/steps.ts      → นิยาม flow เดียวของทั้งแอป (step graph)
frontend/src/lib/flow/useFlow.ts    → hook: next() / back() / guard สำหรับหน้าปัจจุบัน
frontend/src/hooks/useCamera.ts     → (แก้ไข) lifecycle contract ใหม่
frontend/e2e/                       → Playwright specs
frontend/e2e/fixtures/              → helper: login, seed visit state, fake camera
frontend/playwright.config.ts       → config + webServer
```

---

## 5. การวิเคราะห์สถานะปัจจุบัน

### 5.1 Navigation graph ที่โค้ดทำอยู่ตอนนี้

```
/m/login ──push──▶ /m ──push──▶ /m/store/[id]/checkin
                                      │
                          push (setTimeout 700ms, ไม่มี cleanup)
                                      ▼
                               .../category ──push──▶ .../capture
                                                          │
                                                    push (ใช้ภาพนี้)
                                                          ▼
                                                   .../processing
                                              ┌───────────┴───────────┐
                                       replace (สำเร็จ)         replace (ล้มเหลว)
                                              ▼                       ▼
                                        .../result           .../capture | /m/sync | .../category
                                    ┌─────────┴─────────┐
                              push (ถ่ายใหม่)      push (ตรวจสอบ)
                                    ▼                   ▼
                              .../capture          .../verify ──push──▶ .../tasks
                                                                          │
                                                              ┌───────────┴──────────┐
                                                          push (เทียบ)          push (จบ)
                                                              ▼                    ▼
                                                        .../compare ──push──▶ .../checkout
                                                                                   │
                                                            resetVisit() + push ("/m")
                                                                                   ▼
                                                                                  /m

ทางแยกที่ไม่อยู่ใน flow: /m/captures, /m/sync (เข้าด้วย <Link> จาก capture/result)
ปุ่มย้อนกลับทุกหน้า: MobileHeader → router.back()  (Chrome.tsx:24) — history ดิบ
```

**ข้อสังเกตเชิงโครงสร้าง:** ไม่มีที่ไหนในโค้ดที่รู้ว่า flow ทั้งหมดหน้าตาเป็นอย่างไร
ลำดับขั้นเดียวที่เขียนไว้คือ array `STEPS` ใน `MobileShell.tsx:11-24` ซึ่งใช้แค่
ตัดสินทิศทาง animation เท่านั้น ไม่ได้ใช้ตัดสินเส้นทางจริง

### 5.2 Defect register

ความรุนแรง: **C** = Critical (ผู้ใช้ทำงานต่อไม่ได้) · **H** = High · **M** = Medium · **L** = Low

#### กลุ่ม A — Camera lifecycle

| # | ระดับ | ที่ | อาการ / สาเหตุ |
| :-- | :-- | :-- | :-- |
| **C1** | C | [useCamera.ts:102-109](frontend/src/hooks/useCamera.ts:102) + [capture/page.tsx:142](frontend/src/app/m/store/[id]/capture/page.tsx:142) | **จอกล้องดำแบบสุ่ม.** effect ที่ attach `srcObject` มี deps `[stream, videoRef]` — `videoRef` เป็น ref object ที่ identity ไม่เปลี่ยน ดังนั้น effect ไม่ re-run เมื่อ `<video>` เพิ่ง mount ทีหลัง. หน้า capture มี early-return `if (!store \|\| !cat) return <LoadingBlock/>` ที่ line 142 ซึ่งขึ้นกับ API fetch — ถ้า `getUserMedia` resolve **ก่อน** fetch เสร็จ (กรณีที่ permission ถูก grant ไว้แล้ว = ทุกครั้งที่ back กลับเข้ามา) `<video>` จะ mount หลัง effect ทำงานไปแล้ว และ **`srcObject` จะไม่ถูกเซ็ตเลย** → จอดำ. ครั้งแรกไม่เจอเพราะมี permission prompt คั่นให้ fetch ชนะ — ตรงกับอาการ "ครั้งแรกติด back มาแล้วไม่ติด" |
| **C2** | C | [useCamera.ts:74-98, 111-122](frontend/src/hooks/useCamera.ts:74) | **"กล้องถูกใช้งานโดยแอปอื่นอยู่".** ถ้า unmount ระหว่าง `getUserMedia` ยัง pending, cleanup เรียก `stop()` ขณะ `streamRef.current` ยัง `null` (ไม่มีอะไรให้หยุด) พอ promise resolve ทีหลัง บรรทัด 84-86 เซ็ต `streamRef.current = next` บน component ที่ตายแล้ว → **track ค้างเปิดตลอดไป ไม่มีใครหยุดได้** ครั้งถัดไปที่เรียก `getUserMedia` ชน `NotReadableError` → status `IN_USE` |
| **H3** | H | [useCamera.ts](frontend/src/hooks/useCamera.ts) (ทั้งไฟล์) | **ไม่มี `visibilitychange` / `pageshow` handler ที่ไหนเลยในโปรเจกต์** (grep ยืนยัน) เมื่อสลับไปแอปอื่น ล็อกจอ หรือกลับมาจาก bfcache — iOS Safari / Chrome Android จะ end video track เอง แต่ hook ไม่รู้ |
| **H4** | H | [useCamera.ts:84-86](frontend/src/hooks/useCamera.ts:84) | ไม่มี `track.addEventListener("ended", …)` → เมื่อ track ตาย `status` ยังค้างเป็น `READY`, `isLive` ยัง `true`, UI ยังขึ้น "พร้อมถ่าย · …" แต่ภาพดำ **และไม่มีปุ่มให้กดแก้** (ปุ่ม "ขอสิทธิ์กล้องอีกครั้ง" แสดงเฉพาะเมื่อมี `camMessage` ซึ่งไม่มีในสถานะ READY) |
| **M5** | M | [useCamera.ts:127](frontend/src/hooks/useCamera.ts:127) | `grab()` คืน `null` ทันทีถ้า `el.videoWidth === 0` (metadata ยังไม่มา) → caller โยน `Error("grab failed")` → ผู้ใช้เห็น "ถ่ายภาพไม่สำเร็จ ลองอีกครั้ง" โดยไม่มีเหตุผล |
| **M6** | M | [capture/page.tsx:61,143](frontend/src/app/m/store/[id]/capture/page.tsx:61) + [store.ts:112-136](frontend/src/lib/store.ts:112) | `active: consent` — `consent` ถูกล้างเป็น `false` โดย `beginVisit()` ทุกครั้งที่เปิดร้านจาก route list ([m/page.tsx:49](frontend/src/app/m/page.tsx:49)) ถ้า back ออกไป `/m` แล้วกดร้านเดิมซ้ำ visit ถูก reset → เข้า `/capture` เจอ ConsentGate ทั้งที่เพิ่งเช็คอินไป |
| **M7** | M | [compare/page.tsx:92,95](frontend/src/app/m/store/[id]/compare/page.tsx:92) | `window.setTimeout(markAfterCaptured, 420)` ไม่มี cleanup → ถ้า back ออกจากหน้าใน 420ms store ถูก mutate เป็น `afterCaptured: true` ทั้งที่ยังไม่ได้ถ่าย → กลับเข้ามาอีกทีกล้องไม่เปิด (`active: !afterCaptured`) |

#### กลุ่ม B — Navigation / back

| # | ระดับ | ที่ | อาการ / สาเหตุ |
| :-- | :-- | :-- | :-- |
| **C8** | C | [checkin/page.tsx:64](frontend/src/app/m/store/[id]/checkin/page.tsx:64) | `window.setTimeout(() => router.push(…/category), 700)` **ไม่มี cleanup** — ถ้าผู้ใช้กด back ใน 700ms จะโดนดันกลับไปหน้า category อยู่ดี ("กดกลับแล้วมันเด้งไปข้างหน้าเอง") |
| **H9** | H | [verify/page.tsx:36](frontend/src/app/m/store/[id]/verify/page.tsx:36) | `if (!analysis \|\| findings.length === 0) return null;` → **หน้าขาวล้วนภายใน shell** เกิดทุกครั้งที่ back จาก `/tasks` หลัง reload หรือ deep link ขัดกับหลักการใน [useResource.ts:18-21](frontend/src/lib/api/useResource.ts:18) ที่เขียนไว้เองว่า "หน้าจอเปล่าที่ไม่อธิบายอะไรคือบั๊ก" |
| **H10** | H | [checkout/page.tsx:79-80](frontend/src/app/m/store/[id]/checkout/page.tsx:79) | `resetVisit()` แล้ว `router.push("/m")` → back กลับมา `/checkout` เจอหน้าสรุปเปล่า และ `useEffect` line 44 เรียก `closeOutVisit()` ใหม่ด้วย `visitId: null` → คืน `null` เงียบ ๆ |
| **H11** | H | [login/page.tsx:41](frontend/src/app/m/login/page.tsx:41) + [m/page.tsx:71](frontend/src/app/m/page.tsx:71) | login ใช้ `router.push` → back หลังล็อกอินสำเร็จกลับไปหน้า login ซึ่ง [AuthGate.tsx:89-91](frontend/src/components/auth/AuthGate.tsx:89) ปล่อยผ่านเสมอ → เห็นฟอร์มล็อกอินทั้งที่ล็อกอินอยู่. logout ก็ `push` เช่นกัน → back กลับเข้าแอปหลัง logout |
| **M12** | M | [result/page.tsx:57,254](frontend/src/app/m/store/[id]/result/page.tsx:254) | "ถ่ายใหม่" ใช้ `push(/capture)` (แต่ fallback บรรทัด 69 ใช้ `replace`) → history บวมเป็น result→capture→result→capture… และ back จาก capture เจอ result เก่าที่ยังโชว์ผลของภาพที่ทิ้งไปแล้ว |
| **M13** | M | [checkin/page.tsx:43-71](frontend/src/app/m/store/[id]/checkin/page.tsx:43) | ไม่มี guard "เช็คอินไปแล้ว" — back เข้ามาหน้านี้อีกครั้งได้ (local `view` reset เป็น `"BEFORE"`) และกดเช็คอินซ้ำ → ยิง `POST` เปิด visit ใหม่ทับของเดิม |
| **M14** | M | [Chrome.tsx:24](frontend/src/components/mobile/Chrome.tsx:24) | `const back = onBack ?? (() => router.back())` และ **ไม่มีหน้าไหนส่ง `onBack` เลย** → ปุ่มย้อนกลับทุกหน้าเป็น history back ดิบ ซึ่งจะไปไหนขึ้นกับว่าเดินมาทางไหน ไม่ใช่ว่า flow ควรถอยไปไหน |
| **M15** | M | [MobileShell.tsx:26-32](frontend/src/components/mobile/MobileShell.tsx:26) | `stepIndex()` คืน `1` เป็น fallback สำหรับทุก path ที่ไม่รู้จัก → `/m/captures` และ path อื่นถูกมองว่าเป็นระดับเดียวกับ `/m` ทำให้ animation เลื่อนผิดทิศ และ `STEPS` array นี้เป็น "flow definition ผี" ที่ไม่ตรงกับเส้นทางจริง |
| **M16** | M | [Chrome.tsx:97-116](frontend/src/components/mobile/Chrome.tsx:97) + [MobileShell.tsx:106-114](frontend/src/components/mobile/MobileShell.tsx:106) | scroll อยู่ใน inner container (`<main class="overflow-y-auto">`) ไม่ใช่ window → **scroll restoration ของเบราว์เซอร์ใช้ไม่ได้** และ `motion.div key={pathname}` บังคับ remount ทุกครั้ง → back กลับมาหน้า tasks/result ยาว ๆ เด้งบนสุดเสมอ |
| **L17** | L | หลายไฟล์ | **guard เมื่อเข้าหน้าลึกโดยไม่มี state ไม่สม่ำเสมอ**: `processing` มี fallback ([:137](frontend/src/app/m/store/[id]/processing/page.tsx:137)), `result` มี ([:62](frontend/src/app/m/store/[id]/result/page.tsx:62)), `verify` คืนหน้าขาว, `tasks` โหลดเงียบ ๆ, `compare` เปิดกล้องทั้งที่ไม่มี visit, `checkout` ยิง API ด้วย `visitId: null` |
| **L18** | L | [AuthGate.tsx:64-79](frontend/src/components/auth/AuthGate.tsx:64) | `router.replace(LOGIN_PATH)` ถูกเรียกใน effect ที่มี deps `[isLoginScreen, pathname, refresh, router, user]` — re-run ทุกครั้งที่เปลี่ยนหน้า ทำให้เมื่อ token หมดอายุกลางทาง เกิด replace ซ้อนกันได้หลายครั้ง |

---

## 6. Design ที่ต้องการ

### 6.1 Flow guard กลาง — "หนึ่งที่รู้ทั้ง flow"

สร้าง `frontend/src/lib/flow/steps.ts` เป็น **แหล่งความจริงเดียว** ของเส้นทาง
ทุกหน้าใน `/m/**` เลิกตัดสินใจ `push`/`replace`/`back()` ด้วยตัวเอง

```ts
// frontend/src/lib/flow/steps.ts
import type { DemoState } from "@/lib/store";

export type StepId =
  | "LOGIN" | "ROUTE" | "CHECKIN" | "CATEGORY" | "CAPTURE"
  | "PROCESSING" | "RESULT" | "VERIFY" | "TASKS" | "COMPARE" | "CHECKOUT";

export interface Step {
  id: StepId;
  /** path จริง; storeId มาจาก flow context ไม่ใช่ useParams กระจัดกระจาย */
  path: (storeId: string | null) => string;
  /** เข้าหน้านี้ได้ไหมด้วย state ปัจจุบัน — false = เข้าไม่ได้ */
  canEnter: (s: DemoState) => boolean;
  /** ถ้า canEnter เป็น false ให้ redirect ไป step ไหน */
  fallback: StepId;
  /** back จากหน้านี้ควรไป step ไหน — ไม่ใช่ history.back() */
  back: StepId | null;
  /** true = ไม่ควรค้างอยู่ใน history (ไปต่อด้วย replace เสมอ) */
  transient?: boolean;
  /** true = จบ flow แล้ว back ต้องไม่ย้อนเข้ามาได้อีก */
  terminal?: boolean;
}
```

**ตารางเส้นทางที่ต้องบังคับ** (ตาม [docs/ui.md](docs/ui.md) §1.3):

| Step | path | เข้าได้เมื่อ | ไปต่อด้วย | back ไปที่ |
| :-- | :-- | :-- | :-- | :-- |
| LOGIN | `/m/login` | เสมอ | **replace** → ROUTE | — (ออกจากแอป) |
| ROUTE | `/m` | มี token | push → CHECKIN | — |
| CHECKIN | `…/checkin` | มี `storeId` | **replace** → CATEGORY | ROUTE |
| CATEGORY | `…/category` | มี `visitId` | push → CAPTURE | ROUTE |
| CAPTURE | `…/capture` | มี `visitId` + `categoryId` + `consent` | **replace** → PROCESSING | CATEGORY |
| PROCESSING | `…/processing` | มี `photo` | **replace** → RESULT | CATEGORY |
| RESULT | `…/result` | มี `analysis` | push → VERIFY · **replace** → CAPTURE (ถ่ายใหม่) | CATEGORY |
| VERIFY | `…/verify` | มี `findings.length > 0` | push → TASKS | RESULT |
| TASKS | `…/tasks` | มี `visitId` | push → COMPARE · push → CHECKOUT | VERIFY |
| COMPARE | `…/compare` | มี `visitId` | **replace** → CHECKOUT | TASKS |
| CHECKOUT | `…/checkout` | มี `visitId` | **replace** → ROUTE (`terminal`) | ROUTE |

หมายเหตุการออกแบบ:

- **CHECKIN → CATEGORY เป็น replace** เพราะเช็คอินสำเร็จแล้วย้อนกลับไปเช็คอินซ้ำไม่ได้
  (แก้ M13 ที่ระดับ flow ไม่ใช่ระดับหน้า)
- **PROCESSING เป็น `transient`** — ไม่มีวันค้างใน history ทั้งขาไปและขากลับ
- **CHECKOUT เป็น `terminal`** — `goNext()` ต้อง `replace("/m")` (แก้ H10)
- `/m/captures`, `/m/sync` เป็น **detour** ไม่ใช่ step: เข้าด้วย push และ back
  กลับมาที่หน้าเดิมด้วย history ปกติ — แต่หน้าเดิมต้อง restore state ได้ (ดู §6.2 CL5)

`useFlow()` hook ให้ทุกหน้าใช้:

```ts
const flow = useFlow("CAPTURE");
flow.go("PROCESSING");   // เลือก push/replace ให้เองตามตาราง
flow.back();             // ไป step ที่กำหนด ไม่ใช่ router.back()
// flow.guard เป็น element ที่ต้อง render แทนเนื้อหาถ้า canEnter เป็น false
```

`MobileHeader` รับ `onBack` จาก `flow.back` เสมอ (แก้ M14) และ `MobileShell`
คำนวณทิศทาง animation จาก `StepId` แทน array `STEPS` ที่ซ้ำซ้อน (แก้ M15)

**Guard ที่หายไปต้องกลายเป็นหน้าจอที่อธิบายตัวเอง ไม่ใช่ `return null`** — ใช้
component เดียว (`<FlowGuardBlock step={…} />`) ที่บอกว่าทำไมเข้าไม่ได้ + ปุ่มไป
`fallback` (แก้ H9, L17)

### 6.2 Camera lifecycle contract

`useCamera` ต้องรับประกัน 6 ข้อนี้:

| # | ข้อผูกพัน | แก้ defect |
| :-- | :-- | :-- |
| **CL1** | การ attach `srcObject` ต้องเกิดเมื่อ *ทั้ง* stream และ element พร้อม ไม่ว่าอันไหนมาก่อน → เปลี่ยนจาก `RefObject` เป็น **callback ref** (หรือเก็บ element ไว้ใน state) เพื่อให้ effect re-run เมื่อ element เปลี่ยน | C1 |
| **CL2** | `start()` ต้องมี **generation token**; ถ้า generation เปลี่ยน (unmount / `active` เป็น false / start ซ้อน) ระหว่างรอ `getUserMedia` ให้ `stream.getTracks().forEach(t => t.stop())` ทันทีที่ resolve และไม่เซ็ต state ใด ๆ | C2 |
| **CL3** | ต้องฟัง `track.onended` + `document.visibilitychange` + `window.pageshow` — เมื่อกลับมาแล้ว `active` เป็น true แต่ track ตาย ให้ `start()` ใหม่**อัตโนมัติ** | H3, H4 |
| **CL4** | `grab()` ต้องรอ `loadedmetadata` / `videoWidth > 0` ก่อน (มี timeout) และถ้าล้มเหลวจริงต้องคืน error code ที่แปลเป็นข้อความไทยที่บอกสาเหตุได้ | M5 |
| **CL5** | รูปที่ถ่ายค้างไว้ (`photo`, `shots`, `phase`) ต้อง**รอดจากการออกจากหน้าและกลับมา** → ย้ายจาก local `useState` ไปไว้ใน zustand store ผูกกับ `visitId` | ข้อกำหนดจากผู้ใช้ |
| **CL6** | หน้าที่ใช้กล้องห้ามมี early-return ที่ซ่อน `<video>` หลังจาก stream พร้อมแล้ว — ถ้าจำเป็นต้องมี ให้ overlay ทับแทนการ unmount (แบบเดียวกับที่ [capture/page.tsx:182-185](frontend/src/app/m/store/[id]/capture/page.tsx:182) ทำถูกอยู่แล้วสำหรับ preview) | C1 |

**พฤติกรรมที่ตกลงไว้:** กลับเข้าหน้ากล้อง (back หรือสลับแอปกลับมา) → **เปิดกล้องใหม่
อัตโนมัติ** และ **ถ้ามีรูปที่ถ่ายค้างอยู่ ให้ยังคงแสดง preview นั้น** ผู้ใช้ไม่ต้อง
ถ่ายใหม่และไม่ต้องกดปุ่มใด ๆ

`setTimeout` ทุกตัวที่ทำให้เกิด side effect ข้ามหน้า (navigate หรือ mutate store) ต้อง
มี cleanup — บังคับผ่าน helper เดียว (แก้ C8, M7)

### 6.3 Scroll restoration

`Scroll` (`Chrome.tsx`) ต้องจำตำแหน่ง scroll ต่อ `StepId` และคืนค่าตอน back
(sessionStorage หรือ in-memory map) เพราะ scroll อยู่ใน inner container ที่เบราว์เซอร์
restore ให้ไม่ได้ (แก้ M16)

---

## 7. Code Style

ยึดตามที่โค้ดเดิมทำอยู่แล้ว — คอมเมนต์เป็นภาษาอังกฤษอธิบาย **ทำไม** ไม่ใช่ **อะไร**,
ข้อความ UI เป็นภาษาไทย, TypeScript strict, ไม่มี `any`

```ts
/* Real device camera. Prefers the rear lens, streams into a <video> the
   caller owns, and grabs a still by drawing the current frame to a canvas.

   The element arrives through a callback ref rather than a RefObject: the
   stream and the element become available in either order, and an effect
   keyed on a RefObject never re-runs when the element finally mounts —
   which is a black viewfinder that only appears on the second visit. */
export function useCamera({ active, aspect = 16 / 9 }: UseCameraOptions) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const generation = useRef(0);

  const start = useCallback(async () => {
    const mine = ++generation.current;
    const next = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    // Unmounted (or superseded) while the prompt was open: this stream has
    // no owner, and leaving it running holds the camera hardware until the
    // tab dies — the next getUserMedia then fails with NotReadableError.
    if (mine !== generation.current) {
      next.getTracks().forEach((t) => t.stop());
      return;
    }
    // …
  }, []);

  return { videoRef: setEl, status, isLive, grab, retry: start };
}
```

กฎเพิ่มเติมสำหรับงานนี้:

- ห้ามเรียก `router.push` / `router.replace` / `router.back` ตรง ๆ ในไฟล์ใต้
  `src/app/m/**` — ต้องผ่าน `useFlow()` (ยกเว้น `AuthGate` และ detour link)
- `setTimeout` ที่ navigate หรือ mutate store ต้อง clear ใน cleanup เสมอ
- ห้าม `return null` เป็น state ของหน้าจอ — ใช้ `<FlowGuardBlock/>` ที่อธิบายได้
- ข้อความไทยทุกข้อความต้องบอก **สิ่งที่ผู้ใช้ทำได้ต่อ** ไม่ใช่แค่บอกว่าพัง

---

## 8. Testing Strategy

**Framework:** Playwright (`@playwright/test`) · ไฟล์อยู่ที่ `frontend/e2e/`

`playwright.config.ts`:

```ts
use: {
  baseURL: "http://localhost:3000",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",   // กล้องปลอมที่ Chromium ป้อนให้
      "--use-fake-ui-for-media-stream",       // auto-grant permission
    ],
  },
},
webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
```

> กล้องปลอมของ Chromium ทำให้ทดสอบ C1/C2/H3/H4 ได้จริง เพราะเป็น MediaStream track
> ที่ `stop()` และ `ended` ทำงานเหมือนของจริง

### Test suites

**`e2e/nav-back.spec.ts`** — เส้นทางไปกลับ

| Test | พิสูจน์ |
| :-- | :-- |
| back จากทุก step ไปยัง step ที่ตารางใน §6.1 กำหนด (parametrised ทั้ง 11 step) | flow guard |
| กด back ระหว่าง 700ms หลังเช็คอิน → อยู่ที่ `/m` ไม่ใช่ `/category` | C8 |
| login สำเร็จ → back → ยังอยู่ `/m` ไม่ใช่หน้า login | H11 |
| logout → back → ยังอยู่หน้า login | H11 |
| จบ checkout → back → อยู่ `/m` และหน้าสรุปไม่กลับมาว่างเปล่า | H10 |
| result → "ถ่ายใหม่" → back → ไม่เจอ result เก่า | M12 |
| back เข้า `/tasks` → `/verify` → **ต้องไม่ใช่หน้าขาว** (มี heading ที่อ่านออก) | H9 |
| scroll ลงท้าย `/tasks` → เข้า `/compare` → back → ตำแหน่ง scroll เดิม | M16 |

**`e2e/camera-lifecycle.spec.ts`** — กล้อง

| Test | พิสูจน์ |
| :-- | :-- |
| เข้า `/capture` ครั้งแรก → `video.readyState >= 2` และ `srcObject !== null` | baseline |
| capture → `/m/captures` → back → กล้องกลับมา live ภายใน 3 วิ | C1 |
| ถ่ายรูป → ไป `/m/captures` → back → **รูปที่ถ่ายยังอยู่ใน preview** | CL5 |
| เข้า `/capture` แล้ว navigate ออกทันที (< 100ms) แล้วกลับเข้ามา → ไม่มี `IN_USE` และกล้อง live | C2 |
| จำลอง `track.stop()` จากภายนอก → hook ต้องรู้ตัวและ restart (หรือแสดงปุ่มแก้) | H4 |
| จำลอง `visibilitychange` (hidden → visible) หลัง track ตาย → กล้องกลับมาเอง | H3 |
| `grab()` ทันทีหลังกล้อง live → ได้ blob ไม่ใช่ error | M5 |
| compare: กดชัตเตอร์แล้ว back ภายใน 420ms → `afterCaptured` ยังเป็น false | M7 |

**`e2e/deep-link-guards.spec.ts`** — เข้าหน้าลึกตรง ๆ / reload

| Test | พิสูจน์ |
| :-- | :-- |
| เข้า `/m/store/{id}/{step}` ตรง ๆ ทั้ง 9 step โดยไม่มี visit → **ทุกหน้าต้องมีข้อความอธิบาย + ปุ่มไปต่อ ไม่มีหน้าขาว** | H9, L17 |
| reload กลางแต่ละ step → redirect ไป `fallback` ที่ถูกต้อง | flow guard |
| เข้า `/capture` โดยไม่มี consent → ConsentGate ไม่ใช่กล้องดำ | M6 |

### Coverage expectation

ไม่ตั้งเป้าเป็น % — ตั้งเป้าเป็น **defect register**: ทุกรายการระดับ C และ H ใน §5.2
ต้องมี test อย่างน้อย 1 ตัวที่ fail บนโค้ดปัจจุบันและ pass หลังแก้ (Prove-It pattern)

**เช็คลิสต์บนมือถือจริง** (Playwright แทนไม่ได้ — bfcache และ track suspension
ของ iOS Safari ไม่มีใน Chromium headless):

- [ ] iOS Safari: เปิดกล้อง → สลับไปแอปอื่น 30 วิ → กลับมา → กล้องกลับมาเอง
- [ ] iOS Safari: เปิดกล้อง → ล็อกจอ → ปลดล็อก → กล้องกลับมาเอง
- [ ] Android Chrome: back gesture จากทุก step → ไปหน้าที่ถูกต้อง
- [ ] Android Chrome: ถ่ายรูป → back → forward → รูปยังอยู่
- [ ] ทั้งสองเครื่อง: เดินครบ flow S1→S12 ครั้งเดียวจบ ไม่มีหน้าขาว

---

## 9. Boundaries

### Always do

- ผ่าน `useFlow()` ทุกครั้งที่จะเปลี่ยนหน้าใน `/m/**`
- clear `setTimeout` / `setInterval` ทุกตัวใน cleanup
- อ่าน `frontend/node_modules/next/dist/docs/` ก่อนแตะ API ของ router (ตาม `AGENTS.md`)
- รัน `npm run lint` + `npx tsc --noEmit` + `npm run test:e2e` ก่อน commit
- เขียน test ที่ fail ก่อน แล้วค่อยแก้โค้ด (สำหรับทุก defect ระดับ C/H)
- คงข้อความไทยเดิมไว้ถ้าความหมายไม่เปลี่ยน

### Ask first

- เปลี่ยน shape ของ `DemoState` ใน `store.ts` (มีหลายหน้าพึ่งอยู่)
- เพิ่ม dependency ใหม่ใด ๆ นอกจาก `@playwright/test`
- persist state ลง sessionStorage / localStorage (มีนัยด้าน PDPA เพราะ `photoLog`
  ถือ blob ของภาพในร้าน)
- เปลี่ยนพฤติกรรมของ `AuthGate` (มีคอมเมนต์อธิบายเจตนาไว้ชัดที่ [:49-57](frontend/src/components/auth/AuthGate.tsx:49))
- แตะ `/w/**` เกินกว่าเส้นทาง `login → /w`

### Never do

- ลบ guardrail ตาม [docs/ui.md](docs/ui.md) §1.5 — โดยเฉพาะข้อ 1: **ไม่มี consent =
  กล้องเปิดไม่ได้** ห้ามแก้ C1/M6 ด้วยการเอา consent gate ออก
- ทำให้ `justCaptured` / `analysis` ค้างข้ามภาพ — คอมเมนต์ที่ [store.ts:158-159](frontend/src/lib/store.ts:158)
  อธิบายไว้แล้วว่าทำไมการโชว์ OSA เก่าทับภาพใหม่ถึงอันตราย
- แสดงตัวเลข OSA เมื่อ job ล้มเหลว ([processing/page.tsx:19-21](frontend/src/app/m/store/[id]/processing/page.tsx:19))
- commit `.env` หรือ certificate ใน `frontend/certificates/`
- แก้ปัญหากล้องด้วยการเรียก `getUserMedia` ซ้ำ ๆ ใน loop โดยไม่มี backoff

---

## 10. Success Criteria

ทดสอบได้ทุกข้อ:

1. `npm run test:e2e` ผ่านทั้งหมด และทุก defect ระดับ **C/H** ใน §5.2 มี test ที่
   พิสูจน์ได้ว่า fail บน `main` และ pass หลังแก้
2. `grep -rn "router\.\(push\|replace\|back\)" frontend/src/app/m` คืนผลเฉพาะใน
   `useFlow.ts` และ detour link ที่ระบุไว้เท่านั้น
3. เข้า URL ตรง ๆ ทั้ง 11 step โดยไม่มี state → **ไม่มีหน้าไหนขาวเปล่า** ทุกหน้ามี
   ข้อความอธิบายภาษาไทย + ปุ่มไปต่อ
4. back จากทุก step ไปยังปลายทางตามตาราง §6.1 ครบ 100%
5. บนมือถือจริง (iOS Safari + Android Chrome): เข้า-ออกหน้ากล้อง 10 ครั้งติด
   กล้องติดครบ 10 ครั้ง และรูปที่ถ่ายค้างไว้ไม่หายสักครั้ง
6. สลับไปแอปอื่น 30 วินาทีแล้วกลับมา → กล้องกลับมาเองโดยผู้ใช้ไม่ต้องกดอะไร
7. `npm run lint` และ `npx tsc --noEmit` ไม่มี error ใหม่
8. `npm run build` ผ่าน

---

## 11. Open Questions

1. **RESULT → back ควรไป CATEGORY หรือ CAPTURE?** ตาราง §6.1 เลือก CATEGORY
   (เพราะ processing ถูก replace ทิ้ง และ result มีปุ่ม "ถ่ายใหม่" ของตัวเองอยู่แล้ว)
   — ถ้าอยากให้ back = ถ่ายใหม่ ให้เปลี่ยนเป็น CAPTURE
2. **VERIFY → TASKS ใช้ push (ย้อนกลับไปแก้คำตัดสินได้) หรือ replace (ตัดสินแล้วจบ)?**
   spec นี้เลือก push เพราะการตัดสินเป็นของ rep และ store รองรับการแก้อยู่แล้ว
3. **persist visit state ลง sessionStorage หรือไม่?** คำตอบตอนนี้คือ "ยังไม่ทำ"
   (flow guard อย่างเดียว) แต่ถ้า reload กลางร้านเกิดบ่อยจริง ควรทำ — ติดเรื่อง PDPA
   ของ `photoLog` ที่ถือ blob รูปในร้าน
4. **`/m/captures` และ `/m/sync` ควรเป็น modal/sheet แทน route แยกไหม?** จะตัดปัญหา
   back ทั้งหมวดออกไปเลย แต่เปลี่ยน UX จากที่ [docs/ui.md](docs/ui.md) §1.4 ระบุไว้ (S13)
5. **จำเป็นต้องแก้ `/w/**` ด้วยไหม?** ยังไม่ได้ตรวจ WebShell เชิงลึก — มี
   `router.push("/m/login")` อยู่ 2 จุด ([WebShell.tsx:107,203](frontend/src/components/web/WebShell.tsx:107))
   ที่มีปัญหาแบบเดียวกับ H11

---

## 12. หลังจาก approve spec นี้

```
/plan     → แตกเป็น task ที่ verify ได้ทีละใบ (tasks/plan.md + tasks/todo.md)
/build    → ลงมือทีละ task พร้อม test
```

ลำดับที่แนะนำ: **C1 → C2 → C8** (ผู้ใช้ทำงานต่อไม่ได้) → ตั้ง Playwright →
flow guard → H/M ที่เหลือ
