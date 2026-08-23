# SPEC: เชื่อม Frontend เข้ากับ Backend API

> **ส่งมอบแล้ว** — เอกสารนี้เก็บไว้เป็นบันทึกว่าทำไมระบบถึงเป็นรูปนี้ ไม่ใช่งานที่ค้างอยู่
> วิธีรันระบบดูที่ [docs/running.md](../../running.md)

> งานที่เสร็จแล้ว: [รอบก่อนหน้า](../backend-and-ml/SPEC.md) (backend + ML)
> Requirement เดิม: [docs/backend.md](../../backend.md) · [docs/ui.md](../../ui.md)
> สถานะ: **ส่งมอบแล้ว** · 2026-08-23

---

## 1. Objective

ตอนนี้ frontend เป็น demo ที่เดินได้ครบทุกจอด้วยข้อมูลปลอม — **ไม่มีการเรียก API แม้แต่จุดเดียว** ยืนยันแล้วว่าไม่มี `fetch`, `axios`, `NEXT_PUBLIC_API_URL` ในโค้ดเลย และ 22 ไฟล์ import จาก `lib/mock` โดยตรง

เป้าหมายคือทำให้ **ข้อมูลที่ผู้ใช้เห็นมาจากฐานข้อมูลจริง** ผ่าน API ที่สร้างไว้แล้ว โดยพนักงานถ่ายรูปชั้นวางจริง แล้วเห็นผล OSA จากรูปนั้นจริง

**ผู้ใช้:** พนักงานภาคสนาม (มือถือ) · ผู้จัดการเขต (เว็บ) · ทีมข้อมูล (เว็บ)

**นิยามว่าเสร็จ:** ลบโฟลเดอร์ `lib/mock/` ทิ้งได้แล้วแอปยังทำงานครบทุกจอ

---

## 2. ⚠️ สิ่งที่พบตอนสำรวจ — ต้องอ่านก่อน

ก่อนหน้านี้ผมประเมินไว้ว่า **2–3 วัน** โดยตั้งสมมติฐานว่า API ครอบคลุมทุกหน้าจอแล้ว **สมมติฐานนั้นผิด** — พอไล่ทีละ symbol พบว่าฝั่งเว็บผู้จัดการขาด endpoint เยอะ

### หน้าจอมือถือ (พนักงาน) — API ครอบคลุมเกือบครบ

| ข้อมูลที่หน้าจอใช้ | API ที่มีอยู่ |
| :-- | :-- |
| `STORES`, `getStore` | `GET /v1/routes/today` ✅ |
| `CURRENT_USER` | `GET /v1/me` ✅ |
| `CATEGORIES` (หมวด + ชั้น) | ❌ **ไม่มี** |
| `REJECT_REASONS`, `BLOCKED_REASONS` | ค่าคงที่ — เก็บไว้ฝั่ง frontend ได้ ✅ |
| `SLOTS`, `ROWS`, `IMAGE_W/H` | ใช้วาดชั้นวางจำลอง — เปลี่ยนเป็นรูปจริง |

### หน้าจอเว็บ (ผู้จัดการ) — ขาดเยอะ

| ข้อมูลที่หน้าจอใช้ | API ที่มีอยู่ |
| :-- | :-- |
| `OSA_TREND` | `GET /v1/analytics/osa` ✅ |
| `RISK_RANKING` | `GET /v1/analytics/risk-ranking` ✅ |
| `MANAGER_USER` | `GET /v1/me` ✅ |
| `KPIS` (การ์ด 4 ใบหน้าแรก) | ❌ **ไม่มี** |
| `AREAS` (ตัวเลือกพื้นที่) | ❌ **ไม่มี** |
| `getStore` (หน้ารายละเอียดร้าน) | ❌ **ไม่มี** `GET /stores/{id}` |
| `NEXT_WEEK_PLAN` (วางแผนเส้นทาง) | ❌ **ไม่มี** |
| `RELABEL_QUEUE` (คิวตรวจภาพ) | ❌ **ไม่มี** |
| `MODEL_METRICS`, `DRIFT_SERIES`, `MODEL_VERSIONS` | ❌ **ไม่มี** |

**สรุป: ต้องเพิ่ม endpoint ฝั่ง backend อีก 7 ตัว** ไม่ใช่แค่ต่อสายอย่างเดียว ประมาณการจึงขยับเป็น **4–6 วัน**

---

## 3. Scope

### อยู่ในขอบเขต

1. **ชั้น data ใหม่** — `lib/api/` ทำหน้าที่คุยกับ backend, จัดการ token, แปลง error
2. **7 endpoint ใหม่ฝั่ง backend** ตามตารางข้างบน
3. **`lib/store.ts` เปลี่ยนเป็น async** — ตอนนี้มี `async` อยู่ **0 ตัว** ทุก action เป็น sync mutation
4. **Flow ถ่ายภาพจริง** — presign → PUT → commit → poll → result
5. **แสดงรูปถ่ายจริง** พร้อมวาด bbox ทับ
6. **Auth จริง** — login เก็บ JWT, แนบทุก request, หมดอายุแล้วเด้งกลับ
7. **Offline queue จริง** — คิวลง IndexedDB, ส่ง `POST /v1/sync/batch` เมื่อกลับมาออนไลน์

### ไม่อยู่ในขอบเขต (เลื่อน ไม่ใช่ยกเลิก)

| เลื่อน | เหตุผล |
| :-- | :-- |
| เทรนโมเดลใหม่ให้ผ่าน gate | งานฝั่ง ML ต้องใช้ GPU — ดู [plan รอบก่อนหน้า](../backend-and-ml/plan.md) |
| PDPA (retention, blur, audit) | เลื่อนไว้ตั้งแต่รอบก่อน คอลัมน์ยังอยู่ครบ |
| Evidence PDF export | Sprint 5 |
| Push notification | หน้าจอ poll ทุก 500ms อยู่แล้ว |

---

## 4. Tech Stack

**ไม่เพิ่ม dependency ใหม่** — ทุกอย่างทำได้ด้วยของที่มีอยู่

```
Next.js 16 (App Router) + React + TypeScript   มีอยู่แล้ว
zustand                                        มีอยู่แล้ว — ขยายเป็น async
fetch (ของ browser เอง)                        ไม่ต้องลง axios
IndexedDB (ผ่าน idb-keyval หรือเขียนเอง)       สำหรับ offline queue
Tailwind + motion/react                        มีอยู่แล้ว
```

> ถ้าต้องเพิ่ม dependency ให้ถามก่อนเสมอ ตอนนี้ยังไม่เห็นความจำเป็น

**ฝั่ง backend** ใช้ของเดิมทั้งหมด: FastAPI, SQLAlchemy 2 async, Pydantic v2

---

## 5. Commands

```bash
# ── เปิดระบบทั้งหมด ──────────────────────────────────────────
make infra                    # postgres 5433 · redis 6380 · minio 9000
make migrate seed
make api worker               # API :8000
make ml                       # ML :8001 (ถ้าจะใช้โมเดลจริง)
cd frontend && npm run dev    # :3000

# ── ทดสอบ ──────────────────────────────────────────────────
make test                     # backend + model + contracts
cd frontend && npx tsc --noEmit
cd frontend && npx next lint
cd frontend && npm run build
cd frontend && npm run test:e2e      # ใหม่ — Playwright

# ── ตรวจว่างานเสร็จจริง ─────────────────────────────────────
cd frontend && grep -rn "lib/mock" src/ | grep -v "^src/lib/mock/"
#   ต้องไม่เจออะไรเลย = ไม่มีจอไหนพึ่ง mock อีก
```

---

## 6. Project Structure

```
frontend/src/
├── lib/
│   ├── api/                    ← ใหม่ ทั้งหมด
│   │   ├── client.ts           # fetch wrapper: baseUrl, JWT, error, retry
│   │   ├── errors.ts           # ApiError + ข้อความภาษาไทยสำหรับผู้ใช้
│   │   ├── auth.ts             # login, me, เก็บ/ลบ token
│   │   ├── routes.ts           # routes/today, stores/{id}
│   │   ├── visits.ts           # visits, checkout
│   │   ├── captures.ts         # presign, upload, commit, poll, result
│   │   ├── findings.ts         # verify, evidence
│   │   ├── tasks.ts            # list, patch
│   │   ├── analytics.ts        # kpis, osa, risk-ranking, areas
│   │   ├── model.ts            # model health, relabel queue
│   │   └── sync.ts             # batch drain
│   ├── offline/                ← ใหม่
│   │   ├── queue.ts            # IndexedDB queue
│   │   └── useOnline.ts        # ตรวจสถานะเครือข่าย
│   ├── store.ts                ← รื้อเป็น async
│   └── mock/                   ← ลบทิ้งเมื่อจบงาน
├── types/index.ts              ← ตรงกับ API อยู่แล้ว แทบไม่ต้องแตะ
└── app/, components/           ← แก้เท่าที่จำเป็น

backend/app/api/v1/
├── analytics.py                ← เพิ่ม kpis, areas
├── stores.py                   ← ใหม่: GET /stores, GET /stores/{id}
├── catalog.py                  ← ใหม่: GET /categories
└── model_health.py             ← ใหม่: model versions, drift, relabel queue
```

---

## 7. Endpoint ที่ต้องเพิ่ม

ทุกตัวเป็น **camelCase** ตาม `/v1` เดิม และ**ห้ามมีข้อมูลรายบุคคล**

| Endpoint | ใช้ที่ | หมายเหตุ |
| :-- | :-- | :-- |
| `GET /v1/categories` | เลือกหมวด/ชั้น (มือถือ) | คืน `{id, name, bays[], skuCount, lastOsa}` |
| `GET /v1/stores` · `GET /v1/stores/{id}` | รายละเอียดร้าน | มี `/routes/today` แล้วแต่ต้องดูร้านเดี่ยวได้ |
| `GET /v1/analytics/kpis` | การ์ด 4 ใบหน้าแรก | OSA เฉลี่ย, เวลาเติมของ, ร้านที่ตรวจ, ต้นทุน/ร้าน |
| `GET /v1/areas` | ตัวเลือกพื้นที่ | |
| `GET /v1/analytics/route-plan` | วางแผนเส้นทาง | เรียงตามความเสี่ยง **ระดับร้าน** |
| `GET /v1/model/health` | สุขภาพโมเดล | อ่านจากตาราง `model_versions` + `metrics.json` |
| `GET /v1/model/relabel-queue` | คิวตรวจภาพ | findings ที่ถูกตีกลับ + ที่ confidence ต่ำ |

> ⛔ `GET /v1/model/relabel-queue` คืนภาพกับเหตุผลที่ถูกตีกลับ **ห้ามคืนว่าใครเป็นคนตีกลับ** เพราะจะกลายเป็นข้อมูลรายบุคคลทางอ้อม

---

## 8. Code Style

```ts
// lib/api/client.ts
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** ทุก request ผ่านที่นี่ที่เดียว
 *
 *  มีที่เดียวที่รู้จัก base URL, ที่แนบ token, และที่แปลง HTTP error
 *  เป็นข้อความภาษาไทย — component ไม่ต้องรู้เรื่องพวกนี้เลย */
export async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");

  const token = auth ? getToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...rest, headers });

  if (res.status === 401) {
    // token หมดอายุ — ล้างแล้วให้ผู้ใช้ล็อกอินใหม่ ดีกว่าปล่อยให้เห็นจอว่าง
    clearToken();
    throw new ApiError("UNAUTHORIZED", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  }
  if (!res.ok) throw await ApiError.fromResponse(res);

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
```

**กฎ:**
- `lib/api/client.ts` เป็นไฟล์**เดียว**ที่รู้จัก base URL และ token — เหมือนที่ `adapters/ml_client.py` เป็นไฟล์เดียวที่รู้จัก ML service
- Component **ห้ามเรียก `fetch` ตรงๆ** ต้องผ่าน `lib/api/*`
- ข้อความ error ที่ผู้ใช้เห็นต้องเป็น**ภาษาไทย** และบอกว่าต้องทำอะไรต่อ ไม่ใช่แค่บอกว่าพัง
- ทุก state ที่โหลดจาก API ต้องมี 3 สถานะเสมอ: **กำลังโหลด / ผิดพลาด / ว่าง** — จอว่างเปล่าโดยไม่บอกอะไรคือ bug

---

## 9. Testing Strategy

| ระดับ | ที่อยู่ | ครอบคลุม |
| :-- | :-- | :-- |
| Unit | `frontend/src/lib/**/*.test.ts` | client แนบ token, แปลง error, offline queue |
| Component | `frontend/src/components/**` | สถานะ loading/error/empty |
| E2E | `frontend/e2e/` | เดิน golden path จริงผ่าน API จริง |
| Backend | `backend/tests/` | endpoint ใหม่ 7 ตัว + ข้อห้ามเดิม |

**E2E ที่ต้องมี** (Playwright ยิงใส่ระบบจริง):
1. login → route → check-in → ถ่ายรูป → เห็นผล → ยืนยัน → task → checkout
2. ถ่ายรูปที่อ่านไม่ออก → เห็นข้อความ "ถ่ายใหม่" ไม่ใช่ OSA 100%
3. ตัดเน็ตกลางคัน → เข้าคิว → ต่อเน็ต → ซิงก์สำเร็จ ไม่มีข้อมูลซ้ำ
4. token หมดอายุ → เด้งไปหน้า login

**เทสต์ฝั่ง backend ที่ต้องเพิ่ม:** endpoint ใหม่ทุกตัวต้องมีเทสต์ยืนยันว่า**ไม่มี `user_id` ในผลลัพธ์**

---

## 10. Boundaries

### ทำเสมอ
- ทุก request ผ่าน `lib/api/client.ts`
- ทุกจอที่โหลดข้อมูลมีสถานะ loading / error / empty ครบ
- Error ที่ผู้ใช้เห็นเป็นภาษาไทยและบอกทางออก
- `npx tsc --noEmit` + `next lint` + `npm run build` ผ่านก่อน commit
- endpoint ใหม่ทุกตัวมีเทสต์ + คงข้อห้ามเดิมไว้ทั้งหมด

### ถามก่อน
- เพิ่ม dependency ใดๆ ทั้ง frontend และ backend
- แก้ `contracts/inference-v1.yaml`
- แก้ schema ฐานข้อมูล
- เปลี่ยนรูปแบบ response ของ endpoint ที่มีอยู่แล้ว

### ⛔ ห้ามเด็ดขาด
1. **ห้ามมีตัวเลขรายบุคคล** ทั้งใน API และบนจอ ไม่มี leaderboard ไม่มีคะแนนพนักงาน ไม่มี `GROUP BY user_id` — รวมถึง relabel queue ที่ห้ามบอกว่าใครตีกลับ
2. **ห้าม branch บน `className`** ให้ใช้ `semanticType` เท่านั้น (เพิ่งแก้ไปตอนเอา ALMOST ออก อย่าให้กลับมาอีก)
3. **ห้ามให้ผลว่างกลายเป็นชั้นเต็ม** — job `FAILED` ต้องขึ้นข้อความให้ถ่ายใหม่ ห้ามแสดง OSA
4. **ห้ามส่งรูปผ่าน API** ต้อง PUT ตรงเข้า object storage ด้วย presigned URL
5. **ห้ามเก็บ JWT ใน localStorage แบบไม่มีวันหมดอายุ** และห้าม log token ลง console
6. **ห้ามมีปุ่มที่ระบบส่งข้อความหรือทำอะไรกับร้านค้าอัตโนมัติ** (ข้อ 6 ใน [docs/ui.md](../../ui.md))
7. **ห้ามเอาข้อมูลราคาคู่แข่งออกทาง endpoint ใดๆ ที่ไม่ใช่ค่ารวม**

---

## 11. Success Criteria

- [ ] `grep -rn "lib/mock" frontend/src/ | grep -v "^src/lib/mock/"` → ไม่เจออะไรเลย
- [ ] ลบโฟลเดอร์ `lib/mock/` แล้ว `npm run build` ยังผ่าน
- [ ] Login ด้วย `rep@shelfeye.demo` ได้ token จริง และ 401 เด้งกลับหน้า login
- [ ] หน้า route แสดงร้านจากฐานข้อมูล เรียงตามความเสี่ยงจริง
- [ ] ถ่ายรูปจริงจากมือถือ → เห็นรูปนั้นบนจอผล พร้อมกรอบ bbox ตรงตำแหน่ง
- [ ] ยืนยัน gap → เกิด task จริงในฐานข้อมูล → checkout คำนวณ OSA ก่อน/หลังจริง
- [ ] ถ่ายรูปเสียแล้วขึ้น "ถ่ายใหม่" ไม่ใช่ OSA 100%
- [ ] ตัดเน็ต → เข้าคิว → ต่อเน็ต → ซิงก์แล้วไม่มีข้อมูลซ้ำ
- [ ] หน้าเว็บทั้ง 6 จอแสดงข้อมูลจริงครบ
- [ ] ไม่มี endpoint หรือ field ใดที่มีข้อมูลรายบุคคล (มีเทสต์ยืนยัน)
- [ ] E2E ทั้ง 4 เคสผ่าน

---

## 12. ลำดับการทำงาน

ทำเป็นชั้นๆ ให้เห็นผลเร็วก่อน แต่ละขั้นจบแล้วระบบต้องยังใช้งานได้

| ขั้น | งาน | เห็นผลอะไร |
| --: | :-- | :-- |
| 1 | `lib/api/client.ts` + auth + `GET /me` | login จริงได้ |
| 2 | route + stores (+ `GET /stores/{id}`) | หน้าแรกมือถือใช้ข้อมูลจริง |
| 3 | `GET /categories` + visit check-in | เข้าร้านจริงได้ |
| 4 | **flow ถ่ายภาพ** presign→PUT→commit→poll→result | จอผลใช้ข้อมูลจริง — ขั้นที่ยากที่สุด |
| 5 | แสดงรูปถ่ายจริง + วาด bbox | เห็นรูปจริงแทนภาพจำลอง |
| 6 | verify → task → checkout | ครบ golden path |
| 7 | KPIs, areas, route-plan | หน้าเว็บผู้จัดการใช้ข้อมูลจริง |
| 8 | model health + relabel queue | หน้าทีมข้อมูลใช้ข้อมูลจริง |
| 9 | offline queue + sync จริง | ตัดเน็ตแล้วไม่หาย |
| 10 | ลบ `lib/mock/` + E2E | จบงาน |

---

## 13. คำถามที่ต้องตัดสินใจ

ผมตั้งค่าเริ่มต้นไว้ให้แล้วเพื่อไม่ให้งานติด แต่ถ้าเห็นต่างบอกได้

1. **รูปบนจอผล** → เริ่มต้น: **แสดงรูปถ่ายจริง** ดึง signed URL จาก API แล้ววาด bbox ทับ (`DetectionOverlay` รับ props อยู่แล้ว แก้แค่ `IMAGE_W/H` ให้เป็น props) ทางเลือกคือเก็บภาพจำลองไว้ก่อน ซึ่งเร็วกว่าแต่ผู้ชม demo จะสังเกตว่ารูปไม่ตรงกับที่ถ่าย
2. **ML client ตอน demo** → เริ่มต้น: **`mock`** เพราะโมเดลจริงยังไม่ผ่าน gate (recall 0.41 รายงาน OSA 1.0 ทั้งที่มี gap) แต่ทำให้สลับเป็น `http` ได้ด้วย env var เดียวเหมือนเดิม
3. **KPI 4 ตัว** (`เวลาเฉลี่ยจากตรวจพบถึงเติมของสำเร็จ`, `ต้นทุนต่อการตรวจ`) → คำนวณจากข้อมูลจริงได้แค่บางตัว "ต้นทุนต่อการตรวจ" ไม่มีข้อมูลต้นทุนในระบบเลย เริ่มต้น: **คืนเฉพาะตัวที่คำนวณได้จริง** แล้วซ่อนการ์ดที่ไม่มีข้อมูล ดีกว่าโชว์ตัวเลขที่แต่งขึ้น
4. **กล้องมือถือ** → `lib/capture.ts` มีอยู่แล้วและย่อรูปเหลือ 1920px เริ่มต้น: **ใช้ของเดิม** ไม่แตะ
