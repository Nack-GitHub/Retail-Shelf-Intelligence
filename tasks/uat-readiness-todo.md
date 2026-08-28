# TODO: UAT Readiness — ถอด Demo Scaffolding

แผน: [plan.md](plan.md) · ผลสแกน 24 รายการ · Guardrails: [../docs/ui.md](../docs/ui.md) §1.5

> กติกา (ตาม [../SPEC.md](../SPEC.md) §9): ห้าม `git push` · ห้ามเขียนรหัส task ลงใน
> คอมเมนต์ในโค้ด · รัน `npm run lint` + `npx tsc --noEmit` + `npm run test:e2e` ก่อน commit
> · คงข้อความไทยเดิมไว้ถ้าความหมายไม่เปลี่ยน
>
> **สถานะ: ครบทั้ง 16 task · Checkpoint 1–5 ผ่าน — รอ review · ยังไม่ commit**
>
> หลักฐาน:
> - `pytest` 39/39 · `tsc --noEmit` สะอาด · `eslint` 18 issues (baseline 19 — ลดลง 1)
> - `npm run test:e2e` (UAT, flag ปิด) **46/46**
> - `npm run test:e2e:demo` (flag เปิด) **43/43**
> - `npm run build` + `npm run build:demo` ผ่านทั้งคู่
> - grep บันเดิล UAT: `demo1234` / `shelfeye.demo` / `โหมดสาธิต` /
>   `NEXT_PUBLIC_DEMO_MODE` / `GPS ไม่ตรง` / `ไม่พบชั้นวาง` → ไม่พบทั้งหมด
>
> **แก้ระหว่างทาง 2 เรื่องที่แผนเดิมเข้าใจผิด** — ดู §บันทึกการแก้แผน ท้ายไฟล์

---

## Phase 0 — ตัดสินใจ

- [x] **Checkpoint 0: ตอบ Open Question** — ตัดสินใจ 2026-08-28
  - [x] **Q1 face blur → ไม่ทำ = ทาง (ก) แก้คำพูด** ทุกข้อความที่อ้างว่าเบลอใบหน้าต้องออก
  - [x] **Q2 `ML_CLIENT` → `http` + `shelf-product-yolo26l-960`** เทรนใหม่รอบหน้า
        · recall 0.74 / precision 0.75 — ต่ำกว่าเกณฑ์ ต้องเขียนบอก tester (T16)
  - [x] **Q3 "ผู้ถ่าย" hardcode → ทาง (ก) คงไว้** ไม่แก้โค้ด เขียนอธิบายใน `docs/uat.md` (T16)

---

## Phase 1 — Truthfulness blockers

- [x] **Task 1: ตัดสินใจและลงมือเรื่อง on-device face blur**

  ตอนนี้ [capture.ts:154](../frontend/src/lib/capture.ts#L154) บันทึกซื่อ ๆ ว่า
  `{ applied: false, method: "NOT_WIRED" }` แต่ [app/page.tsx:107](../frontend/src/app/page.tsx#L107)
  โฆษณาว่า "ยืนยันเบลอใบหน้าบนเครื่องก่อนอัปโหลดทุกครั้ง" เป็นข้อกำหนดที่บังคับผ่าน UI
  ชั้นข้อมูลพูดความจริง ชั้นการตลาดพูดไม่จริง — task นี้ทำให้สองชั้นตรงกัน

  > ✅ **ตัดสินใจแล้ว: ไม่ implement → ทาง (ก)** ทางเลือก (ข) ตัดออกจากรอบนี้

  - Acceptance:
    - [x] ไม่มีข้อความไหนในแอปที่บอกว่าเบลอใบหน้าแล้ว/จะเบลอให้
    - [x] หน้ากล้องมีข้อความสั้น ๆ ว่ายังไม่มีการเบลออัตโนมัติ ผู้ถ่ายต้องเลี่ยงไม่ให้ติดหน้าคน
    - [x] `applied=false` ที่ [captures/page.tsx:143](../frontend/src/app/m/captures/page.tsx#L143)
          อ่านจาก `photo.faceBlur.applied` จริง ไม่ใช่ literal
    - [x] `faceBlur` payload ที่ส่งขึ้น API ไม่เปลี่ยน (backend log ความจริงไว้แล้ว)
  - Verify:
    - [x] `grep -rn "เบลอใบหน้า" frontend/src` → เหลือเฉพาะข้อความที่บอกว่า *ยังไม่* เบลอ
    - [x] `npx tsc --noEmit` สะอาด
    - [x] manual: หน้า `/m/captures` แสดง `applied=false` ตรงกับ pill "ยังไม่เบลอใบหน้า"
  - Dependencies: None (Q1 ตอบแล้ว)
  - Files: `frontend/src/app/page.tsx`, `frontend/src/app/m/store/[id]/capture/page.tsx`,
    `frontend/src/app/m/captures/page.tsx`, `docs/ui.md` (ทำเครื่องหมายว่า guardrail ข้อ 2
    **ยังไม่ทำ** — ไม่ลบข้อกำหนดทิ้ง)
  - Scope: **S**

- [x] **Task 2: แก้คำสัญญาความเป็นส่วนตัวที่ไม่ตรงกับพฤติกรรมจริง**

  มี 3 จุดที่บอกผู้ใช้ว่าภาพไม่ออกจากเครื่อง ซึ่งเป็นจริงตอนเป็น demo แต่ตอนนี้
  หน้า processing อัปโหลดขึ้น object storage ทันทีที่กด "ใช้ภาพนี้"

  - Acceptance:
    - [x] [capture/page.tsx:280](../frontend/src/app/m/store/%5Bid%5D/capture/page.tsx#L280)
          "ภาพเก็บไว้ในเครื่องเท่านั้น" → สื่อว่าภาพจะถูกส่งขึ้นระบบเมื่อกดใช้ภาพนี้
    - [x] [captures/page.tsx:49](../frontend/src/app/m/captures/page.tsx#L49)
          "ยังไม่มีการส่งข้อมูลออกนอกเครื่อง" → อธิบายว่าหน้านี้คือบันทึกในเครื่อง
          ส่วนการอัปโหลดเกิดที่หน้าประมวลผล
    - [x] [sync/page.tsx:166](../frontend/src/app/m/sync/page.tsx#L166) "ยังไม่ได้ส่งออก"
          → ตรวจว่าตรงกับสถานะคิวจริง
    - [x] คอมเมนต์ที่ตกยุคใน [capture.ts:9-11](../frontend/src/lib/capture.ts#L9-L11)
          ("Nothing is uploaded yet") และ [capture.ts:186](../frontend/src/lib/capture.ts#L186)
          แก้ให้ตรงกับความจริง
  - Verify:
    - [x] `grep -rn "ไม่ออกนอกเครื่อง\|เก็บไว้ในเครื่องเท่านั้น\|ยังไม่ได้ส่ง" frontend/src` → ตรวจทีละจุดว่าจริง
    - [x] manual: ถ่ายภาพ → กดใช้ภาพนี้ → ไม่มีข้อความไหนก่อนหน้าที่บอกว่าภาพจะไม่ถูกส่ง
  - Dependencies: Task 1 (เขียนคำพร้อมกันจะได้โทนเดียวกัน)
  - Files: `frontend/src/app/m/store/[id]/capture/page.tsx`, `frontend/src/app/m/captures/page.tsx`,
    `frontend/src/app/m/sync/page.tsx`, `frontend/src/lib/capture.ts`
  - Scope: **S**

- [x] **Task 3: ถอด secret และบัญชี seed ออกจากเส้นทางขึ้น UAT**

  `JWT_SECRET=demo-secret-not-for-production-min-32-bytes` อยู่ทั้งใน `backend/.env`
  และ `.env.example` ที่ commit ไว้ ใครก็ตามที่อ่าน repo ได้ ปลอม token ของ UAT ได้

  - Acceptance:
    - [x] `.env.example` ไม่มีค่า secret ที่ใช้ได้จริง — เป็น placeholder + คำสั่งสร้าง
          (เช่น `openssl rand -hex 32`)
    - [x] `backend/app/core/config.py` ปฏิเสธที่จะบูตถ้า `environment != "local"`
          แล้ว `JWT_SECRET` ยังเป็นค่า demo
    - [x] `backend/.env.example` ตั้ง **`ML_CLIENT=http`** (ตอนนี้เขียน `mock` ขัดกับ `.env` จริง)
    - [x] `docs/running.md` ระบุว่า UAT ต้องรัน docker-compose profile `real-ml`
    - [x] `backend/app/db/seed.py` มีคำเตือน/guard ไม่ให้รันบน environment ที่ไม่ใช่ local
    - [x] เอกสาร UAT ระบุว่าต้องสร้างบัญชีจริง ไม่ใช้ `@shelfeye.demo`
  - Verify:
    - [x] `cd backend && ENVIRONMENT=uat JWT_SECRET=demo-secret-not-for-production-min-32-bytes python -c "from app.core.config import settings"` → ต้อง error
    - [x] `pytest backend/tests` เขียวครบ
    - [x] `git grep "demo-secret-not-for-production"` → เหลือเฉพาะใน test/comment
  - Dependencies: None (Q2 ตอบแล้ว)
  - Files: `backend/.env.example`, `backend/app/core/config.py`, `backend/app/db/seed.py`,
    `docs/running.md`
  - Scope: **S**

### ✅ Checkpoint 1 — Legal / security
- [x] ไม่มีจอไหนอ้างว่าเบลอใบหน้าถ้าโค้ดยังไม่เบลอ
- [x] ไม่มีจอไหนอ้างว่า "ภาพไม่ออกจากเครื่อง" ถ้ามันอัปโหลด
- [x] บูต backend ด้วย secret ของ demo บน environment ที่ไม่ใช่ local ไม่ได้
- [x] `npm run test:e2e` + `pytest` เขียวครบ
- [x] **หยุด review กับเจ้าของงานก่อนไป Phase 2**

---

## Phase 2 — Demo mode infrastructure + gating

- [x] **Task 4: `lib/demo.ts` + gate แผงบัญชีสาธิตในหน้า login**

  slice แรกที่ใช้ flag จริง ทำให้พิสูจน์ได้ทันทีว่า dead-code elimination ทำงาน

  - Acceptance:
    - [x] `frontend/src/lib/demo.ts` export `DEMO_MODE` อ่านจาก `NEXT_PUBLIC_DEMO_MODE === "1"`
    - [x] `frontend/.env.example` อธิบาย flag และย้ำว่า default คือปิด
    - [x] แผงบัญชีด่วน 4 ปุ่ม + ข้อความ "รหัสผ่าน demo1234"
          ([login/page.tsx:162-232](../frontend/src/app/m/login/page.tsx#L162-L232)) อยู่หลัง flag
    - [x] prefill `rep@shelfeye.demo` ([login/page.tsx:20](../frontend/src/app/m/login/page.tsx#L20))
          → ช่องอีเมลว่างเมื่อปิด flag
    - [x] ป้าย `v0.9.0 · demo` ([login/page.tsx:238](../frontend/src/app/m/login/page.tsx#L238))
          → เหลือแค่เลขเวอร์ชันเมื่อปิด flag
  - Verify:
    - [x] `npm run build && grep -r "demo1234" .next/static` → ไม่พบ
    - [x] `NEXT_PUBLIC_DEMO_MODE=1 npm run build && grep -r "demo1234" .next/static` → พบ
    - [x] `npm run test:e2e` เขียว (`loginThroughForm` กรอกฟอร์มเอง ไม่พึ่งปุ่มด่วน)
  - Dependencies: None
  - Files: `frontend/src/lib/demo.ts`, `frontend/.env.example`, `frontend/src/app/m/login/page.tsx`
  - Scope: **S**

- [x] **Task 5: gate StateSwitcher ทั้ง 6 จุด**

  กล่องเส้นประ "สาธิตสถานะหน้าจอ" ที่ให้กดบังคับสถานะหน้าจอเอง — อันตรายที่สุดคือ
  `NO_SHELF` ([result/page.tsx:58](../frontend/src/app/m/store/%5Bid%5D/result/page.tsx#L58))
  ที่**เข้าถึงได้ทางสวิตช์นี้ทางเดียว** และ `GPS_OFF` ที่ปลอมผลตรวจพิกัดทับคำตัดสินของ server

  - Acceptance:
    - [x] ทั้ง 6 จุดอยู่หลัง `DEMO_MODE` — `m/page.tsx:232`, `checkin:212`,
          `capture:432`, `result:232`, `result:335`, `tasks:136`
    - [x] เมื่อปิด flag: state ที่สวิตช์เคยบังคับ อ่านจากข้อมูลจริงเท่านั้น
          (`gpsMatch` จาก server, `lowConf` จาก findings, จำนวนร้านจาก API)
    - [x] `NoShelfState` ยังคงอยู่และยังเข้าถึงได้จาก job FAILED ที่หน้า processing
          — **ห้ามลบทิ้ง** มันเป็นหน้าจอจริงของ error path
    - [x] ไม่มี dead variable / unused import หลงเหลือ
  - Verify:
    - [x] `npm run build && grep -r "สาธิตสถานะหน้าจอ" .next/static` → ไม่พบ
    - [x] `npx tsc --noEmit` + `npm run lint` สะอาด
    - [x] E2E ใหม่: เข้าทั้ง 5 หน้าโดยปิด flag → ไม่มี element ที่ `aria-pressed` ของสวิตช์
  - Dependencies: Task 4
  - Files: `frontend/src/app/m/page.tsx`, `.../checkin/page.tsx`, `.../capture/page.tsx`,
    `.../result/page.tsx`, `.../tasks/page.tsx`, `frontend/e2e/demo-off.spec.ts`
  - Scope: **M**

- [x] **Task 6: gate shell chrome — หน้า `/`, กรอบมือถือ, ป้าย demo**

  - Acceptance:
    - [x] `/` ([app/page.tsx](../frontend/src/app/page.tsx)) — เมื่อปิด flag redirect ไป
          `/m/login` (หรือ `/w` ตาม role ถ้ามี token) แทนหน้าเลือกแพลตฟอร์ม
    - [x] ป้าย "โหมดสาธิต · ต่อ API จริง" และ "13 หน้าจอ · S1–S13" ไม่ปรากฏเมื่อปิด flag
    - [x] กรอบมือถือ + status bar จำลอง + ลิงก์ "กลับหน้าเลือกแพลตฟอร์ม"
          ([MobileShell.tsx:52-92](../frontend/src/components/mobile/MobileShell.tsx#L52-L92))
          อยู่หลัง flag — บนจอ desktop ที่ปิด flag ให้แสดงเต็มความกว้างตามปกติ
    - [x] ป้าย `demo` ในไซด์บาร์ ([WebShell.tsx:138](../frontend/src/components/web/WebShell.tsx#L138)) อยู่หลัง flag
    - [x] ข้อความกั้น REP ที่ระบุ `manager@shelfeye.demo`
          ([WebShell.tsx:100](../frontend/src/components/web/WebShell.tsx#L100)) → บอกให้ติดต่อ
          ผู้ดูแลระบบแทนการระบุอีเมลตัวอย่าง
  - Verify:
    - [x] `npm run build && grep -rE "โหมดสาธิต|shelfeye\.demo" .next/static` → ไม่พบ
    - [x] manual: เปิด `/` ด้วย flag ปิด → เด้งเข้า login ไม่เห็นหน้า launcher
    - [x] E2E: viewport 1280 กว้าง flag ปิด → ไม่มีกรอบมือถือ
  - Dependencies: Task 4
  - Files: `frontend/src/app/page.tsx`, `frontend/src/components/mobile/MobileShell.tsx`,
    `frontend/src/components/web/WebShell.tsx`, `frontend/e2e/demo-off.spec.ts`
  - Scope: **M**

- [x] **Task 7: gate หน้า `/m/captures` (capture log)**

  หน้า debug ที่โชว์ `capture id` / `idempotency key` / `face blur method` ให้ผู้ใช้
  ปลายทางเห็น — คอมเมนต์ในไฟล์เขียนเองว่ายืนแทน upload log จนกว่า API จะมา ซึ่งมาแล้ว

  - Acceptance:
    - [x] เมื่อปิด flag: route ไม่ถูก register (หรือ redirect ไป `/m/sync` ซึ่งเป็น
          หน้าจริงที่ทำหน้าที่เดียวกันสำหรับผู้ใช้)
    - [x] ลิงก์เข้าหน้านี้จากหน้ากล้องอยู่หลัง flag ด้วย — ไม่เหลือลิงก์ที่พาไป 404
    - [x] `stepOfPath` / `depthOf` ใน [flow/steps.ts](../frontend/src/lib/flow/steps.ts)
          ยังจัดการ path นี้ได้ถูกเมื่อเปิด flag (เป็น detour ไม่ใช่ step)
  - Verify:
    - [x] E2E: flag ปิด → `goto("/m/captures")` ไม่ได้หน้าขาว (redirect หรือ 404 ที่มีข้อความไทย)
    - [x] E2E: flag เปิด → หน้าเดิมทำงานครบ และ back จากหน้านี้ยังถูกต้อง (regression ของรอบก่อน)
    - [x] `npm run test:e2e` เขียวทั้งสองโหมด
  - Dependencies: Task 4
  - Files: `frontend/src/app/m/captures/page.tsx`, `frontend/src/app/m/store/[id]/capture/page.tsx`,
    `frontend/e2e/demo-off.spec.ts`
  - Scope: **S**

### ✅ Checkpoint 2 — Demo mode
- [x] `NEXT_PUBLIC_DEMO_MODE=1 npm run build` → affordance ครบเหมือนเดิมทุกตัว
- [x] `npm run build` → `grep -rE "สาธิตสถานะหน้าจอ|demo1234|โหมดสาธิต" .next/static` ไม่พบ
- [x] E2E 39 ตัวเดิมเขียวทั้งสองโหมด + `demo-off.spec.ts` เขียว
- [x] `playwright.config.ts` มี project `chromium-demo` ที่รันด้วย flag เปิด

---

## Phase 3 — ตัวเลขและภาพที่ประดิษฐ์ขึ้น

- [x] **Task 8: เอามาตรวัดระดับกล้องที่สุ่มออก**

  [capture/page.tsx:80-84](../frontend/src/app/m/store/%5Bid%5D/capture/page.tsx#L80-L84)
  สุ่มค่าเอียงทุก 900ms แล้วแสดงเป็น `+1.4°` / ป้าย "ระดับ" ข้างวิวไฟน์เดอร์
  ไม่ได้อ่านจาก sensor เลย นี่คือรายการที่ reviewer จับได้ง่ายที่สุดว่าทั้งจอเป็นของปลอม

  - Acceptance:
    - [x] ลบ `tilt` / `setTilt` / interval ที่สุ่ม และ UI มาตรวัดด้านขวาของวิวไฟน์เดอร์
    - [x] เส้น grid ช่วยจัดองค์ประกอบ (rule-of-thirds) และกรอบมุม **คงไว้** —
          พวกนั้นเป็นตัวช่วยจริงที่ไม่ได้อ้างว่าวัดอะไร
    - [x] ถ้าอยากได้ของจริงในอนาคต: บันทึกไว้ใน plan ว่าใช้ `DeviceOrientationEvent`
          ซึ่งต้องขอ permission บน iOS — **ไม่ทำในรอบนี้**
    - [x] ไม่มี `Math.random()` เหลือใน `frontend/src/app/**` ที่ป้อนค่าให้ UI
  - Verify:
    - [x] `grep -rn "Math.random" frontend/src/app frontend/src/components` → ไม่พบ
          (ที่เหลือใน `lib/capture.ts:51` เป็น uid fallback ไม่ใช่ค่าที่แสดงผล — คงไว้)
    - [x] `npm run test:e2e -- e2e/camera-lifecycle.spec.ts` เขียว
    - [x] `npx tsc --noEmit` + `npm run lint` สะอาด
  - Dependencies: Task 5 (ไฟล์เดียวกัน — ทำหลังจะได้ไม่ conflict)
  - Files: `frontend/src/app/m/store/[id]/capture/page.tsx`
  - Scope: **S**

- [x] **Task 9: เอาแบนเนอร์เตือนคุณภาพภาพที่วนข้อความออก**

  `WARNINGS` ([capture/page.tsx:24-28](../frontend/src/app/m/store/%5Bid%5D/capture/page.tsx#L24-L28))
  หมุน "ภาพเบลอ / แสงน้อยเกินไป / ถ่ายให้เห็นชั้นวางทั้งชั้น" ทุก 2.4 วิ โดยไม่วิเคราะห์ภาพเลย
  และโผล่เฉพาะเมื่อกดสวิตช์ demo (ซึ่ง T5 ปิดไปแล้ว)

  - Acceptance:
    - [x] ลบ `WARNINGS`, `warnIdx`, interval และ state `Quality`/`quality` ที่เหลือใช้แค่นี้
    - [x] แบนเนอร์ที่เหลือทั้งหมดผูกกับสถานะจริง: error, `camStatus`, `busy`, `live`
    - [x] คำแนะนำการถ่ายที่เป็น**คำแนะนำคงที่** (เช่น "ยืนห่าง 1.5–2 เมตร" ที่
          [capture/page.tsx:424](../frontend/src/app/m/store/%5Bid%5D/capture/page.tsx#L424))
          คงไว้ — ไม่ได้อ้างว่าตรวจภาพ
    - [x] คุณภาพภาพจริงถูกตัดสินที่ server อยู่แล้ว (job FAILED → `userMessage` ภาษาไทย)
          เส้นทางนั้นไม่ถูกแตะ
  - Verify:
    - [x] `npm run test:e2e -- e2e/camera-lifecycle.spec.ts` เขียว
    - [x] manual: ถ่ายภาพเบลอจริง → ข้อความเตือนที่เห็นมาจาก server ไม่ใช่จาก timer
    - [x] `npm run lint` ไม่มี unused
  - Dependencies: Task 8
  - Files: `frontend/src/app/m/store/[id]/capture/page.tsx`
  - Scope: **S**

- [x] **Task 10: จำกัดขอบเขตชั้นวางที่วาดขึ้น + ตัดภาพ "หลัง" ปลอม**

  [placeholder-shelf.ts](../frontend/src/components/shelf/placeholder-shelf.ts) เป็นภาพวาด
  ที่ใช้เมื่อไม่มีกล้อง ปัญหาหนักอยู่ที่ [compare/page.tsx:64](../frontend/src/app/m/store/%5Bid%5D/compare/page.tsx#L64):
  `slotsAfter(...)` เติมช่องว่างตามงานที่ติ๊ก แล้วเอาไปวางใน slider เทียบกับ**ภาพถ่ายจริง**
  ใต้หัวข้อ "หลักฐานการแก้ไขที่ร้านนี้" — คือการประดิษฐ์หลักฐาน

  - Acceptance:
    - [x] หน้าเทียบก่อน–หลัง: ถ้าไม่มีภาพ AFTER จริง → ไม่แสดง slider แต่แสดงข้อความว่า
          ยังไม่ได้ถ่ายภาพหลังเติมของ (แพตเทิร์นเดียวกับ checkout ที่จัดการ `osaAfter === null` ถูกแล้ว)
    - [x] `slotsAfter` ไม่ถูกเรียกจากหน้า compare อีก
    - [x] `ShelfPhoto` fallback ที่หน้ากล้อง/result **คงไว้** — reviewer บน desktop ยังเดิน flow ได้
          และแบนเนอร์บอกอยู่แล้วว่า "ไม่ได้ใช้กล้อง — โหมดตัวอย่าง"
    - [x] `alt` ของภาพ fallback ทุกจุดบอกว่าเป็นภาพตัวอย่าง ไม่ใช่ภาพถ่าย
  - Verify:
    - [x] E2E: เดิน flow ถึง compare โดยไม่มีภาพ AFTER → ไม่มี slider ที่เทียบภาพวาดกับภาพจริง
    - [x] `grep -rn "slotsAfter" frontend/src` → เหลือเฉพาะใน `placeholder-shelf.ts` (หรือถูกลบ)
    - [x] `npm run test:e2e` เขียว
  - Dependencies: None (ขนานกับ T8/T9 ได้)
  - Files: `frontend/src/app/m/store/[id]/compare/page.tsx`,
    `frontend/src/components/shelf/placeholder-shelf.ts`, `frontend/src/components/shelf/CaptureFrame.tsx`
  - Scope: **M**

- [x] **Task 11: ลบตัวเลขประเมินที่ hardcode**

  - Acceptance:
    - [x] `MINUTES_PER_STORE = 22` ([m/page.tsx:31](../frontend/src/app/m/page.tsx#L31)) — ลบ
          และหัวเส้นทางเลิกแสดงเวลารวมที่ประเมินเอง หรือใช้ `avgVisitMinutes` จาก API
          พร้อมจัดการ null แบบเดียวกับ [routes/page.tsx:196-201](../frontend/src/app/w/routes/page.tsx#L196-L201)
    - [x] `bay ?? "A2"` ([capture/page.tsx:172](../frontend/src/app/m/store/%5Bid%5D/capture/page.tsx#L172))
          — ไม่มี bay = flow ผิด ให้ guard จัดการ ไม่ใช่เดาชั้นวางที่ไม่มีอยู่
    - [x] `SkuThumb` PALETTE ([SkuThumb.tsx:3-10](../frontend/src/components/shelf/SkuThumb.tsx#L3-L10))
          — ตรวจว่า fallback สีเทาอ่านออกเมื่อเจอ SKU จริงที่ไม่อยู่ใน 6 รหัส seed
          และภาพสินค้าที่วาดขึ้นไม่ถูกอ้างว่าเป็นรูปสินค้าจริง (ตรวจ `alt`/`aria`)
  - Verify:
    - [x] `grep -rn "MINUTES_PER_STORE\|?? \"A2\"" frontend/src` → ไม่พบ
    - [x] manual: หน้าเส้นทางไม่แสดงตัวเลขเวลาที่ไม่มีที่มา
    - [x] manual: หน้า tasks กับ checkout ด้วย SKU นอกรายการ seed → thumbnail ไม่พัง
  - Dependencies: None
  - Files: `frontend/src/app/m/page.tsx`, `frontend/src/app/m/store/[id]/capture/page.tsx`,
    `frontend/src/components/shelf/SkuThumb.tsx`
  - Scope: **S**

### ✅ Checkpoint 3 — ไม่มีตัวเลขปลอม
- [x] `grep -rn "Math.random" frontend/src/app frontend/src/components` → ไม่พบ
- [x] เดิน flow บนเครื่องที่ไม่มีกล้อง → ไม่มีจอไหนอ้างว่าภาพวาดคือภาพถ่าย
- [x] ทุกตัวเลขบนจอมีที่มาจาก API หรือจากสิ่งที่ผู้ใช้เพิ่งทำ
- [x] `npm run test:e2e` เขียว

---

## Phase 4 — ปุ่มที่ไม่ทำอะไร

- [x] **Task 12: ปุ่ม "ส่งออกรายงาน"**

  [w/page.tsx:66-68](../frontend/src/app/w/page.tsx#L66-L68) ไม่มี `onClick` เลย กดแล้วเงียบ

  - Acceptance:
    - [x] เลือกหนึ่ง: (ก) เอาปุ่มออก (ข) `disabled` + `title` บอกว่ายังไม่เปิดใช้
    - [x] ไม่มีปุ่มที่กดได้แล้วไม่เกิดอะไรขึ้น
  - Verify:
    - [x] E2E: `/w` — ปุ่มที่กดได้ทุกปุ่มทำให้ URL เปลี่ยน หรือ DOM เปลี่ยน
    - [x] `npm run lint` ไม่มี unused `DownloadIcon`
  - Dependencies: None
  - Files: `frontend/src/app/w/page.tsx`
  - Scope: **XS**

- [x] **Task 13: ปุ่ม "อนุมัติเส้นทางนี้" + การจัดลำดับที่ไม่ถูกบันทึก**

  [routes/page.tsx:242](../frontend/src/app/w/routes/page.tsx#L242) เป็น `setApproved(true)`
  ล้วน ๆ แต่ข้อความใต้ปุ่มบอกว่า *"การอนุมัติจะส่งแผนไปที่แอปของพนักงานในพื้นที่"*
  และการลากจัดลำดับใหม่หายเมื่อรีเฟรช

  - Acceptance:
    - [x] ข้อความใต้ปุ่มไม่อ้างว่าส่งแผนไปไหน จนกว่าจะมี endpoint จริง
    - [x] ผู้ใช้รู้ว่าการจัดลำดับเป็นการดูตัวอย่างในหน้านี้ ยังไม่ถูกบันทึก
    - [x] ใช้แพตเทิร์นเดียวกับ [relabel/page.tsx:152-156](../frontend/src/app/w/relabel/page.tsx#L152-L156) ที่ทำถูกแล้ว
    - [x] ประโยค "ระบบไม่ติดต่อร้านค้าและไม่กำหนดโควตาต่อคน" **คงไว้** — เป็น guardrail
          [docs/ui.md](../docs/ui.md) §1.5 ข้อ 6
  - Verify:
    - [x] manual: กดอนุมัติ → รีเฟรช → สถานะที่เห็นตรงกับสิ่งที่ข้อความสัญญาไว้
    - [x] `npm run test:e2e` เขียว
  - Dependencies: None
  - Files: `frontend/src/app/w/routes/page.tsx`
  - Scope: **XS**

- [x] **Task 14: ทบทวน disclaimer ของคิว relabel สำหรับ UAT**

  [relabel/page.tsx:155](../frontend/src/app/w/relabel/page.tsx#L155) เขียนว่า
  "รุ่นสาธิต: การเลือกยังไม่ถูกส่งไปยังรอบเทรนจริง" — ซื่อสัตย์ดี แต่คำว่า "รุ่นสาธิต"
  จะสับสนบน UAT ที่ไม่ใช่รุ่นสาธิตแล้ว

  - Acceptance:
    - [x] ข้อความไม่ใช้คำว่า "รุ่นสาธิต" แต่ยังบอกชัดว่าการเลือกยังไม่ถูกส่งเข้ารอบเทรน
    - [x] ปุ่ม "ทำเครื่องหมายว่าตรวจแล้ว" ยังทำงานแบบ local ต่อไปได้ (ทีมข้อมูลใช้คัดของจริง)
  - Verify:
    - [x] `grep -rn "รุ่นสาธิต" frontend/src` → ไม่พบ
    - [x] manual: เลือกภาพ → ข้อความอธิบายตรงกับสิ่งที่ปุ่มทำ
  - Dependencies: None
  - Files: `frontend/src/app/w/relabel/page.tsx`
  - Scope: **XS**

### ✅ Checkpoint 4 — ไม่มีปุ่มตาย
- [x] ทุกปุ่มที่กดได้ใน `/w/**` ทำอะไรบางอย่าง หรือ disabled พร้อมเหตุผล
- [x] ไม่มีข้อความไหนสัญญาผลลัพธ์ที่ระบบยังทำไม่ได้
- [x] guardrail §1.5 ข้อ 4 (ไม่มี leaderboard) และข้อ 6 (ไม่ติดต่อร้านอัตโนมัติ) ยังอยู่ครบ

---

## Phase 5 — ปิดงาน

- [x] **Task 15: ลบ dead code และคอมเมนต์ที่ตกยุค**

  - Acceptance:
    - [x] ลบ [Heatmap.tsx](../frontend/src/components/charts/Heatmap.tsx) — ไม่ถูก import ที่ไหนเลย
          (`docs/archive/README.md` ยืนยันว่า SKU×day heatmap ถูกตัดโดยตั้งใจ)
    - [x] คอมเมนต์หัวไฟล์ [types/index.ts:2](../frontend/src/types/index.ts#L2)
          ("swapping mock data for the real API") — แก้ให้ตรงกับความจริงว่าเปลี่ยนแล้ว
    - [x] [store.ts:20-21](../frontend/src/lib/store.ts#L20-L21) "Demo-only state. When the
          API lands..." — API มาแล้ว แก้คอมเมนต์
    - [x] `.env.example` ทั้งสองฝั่งอธิบายตรงกับสิ่งที่ระบบทำจริง
  - Verify:
    - [x] `npx tsc --noEmit` + `npm run lint` สะอาด
    - [x] `npm run build` ผ่าน
    - [x] `git grep -n "mock" frontend/src` → เหลือเฉพาะที่หมายถึง mock ML client ของ backend จริง ๆ
  - Dependencies: T12–T14
  - Files: `frontend/src/components/charts/Heatmap.tsx` (ลบ), `frontend/src/types/index.ts`,
    `frontend/src/lib/store.ts`, `frontend/.env.example`
  - Scope: **S**

- [x] **Task 16: UAT verification pass**

  - Acceptance:
    - [x] `playwright.config.ts` มี 2 project: `chromium` (demo off) และ `chromium-demo` (demo on)
    - [x] `e2e/demo-off.spec.ts` ยืนยันว่า affordance ทุกตัวไม่อยู่ใน DOM
    - [x] เอกสาร UAT ใหม่ (`docs/uat.md`) มีครบ:
          - วิธี build/deploy โหมด UAT (flag ปิด) + บัญชีที่ต้องสร้างเอง
          - **ข้อจำกัดของโมเดล `yolo26l-960` เป็นตัวเลข**: ช่องว่างจริง ~1 ใน 4 ตรวจไม่เจอ
            (recall 0.74) และสิ่งที่แจ้งว่าเป็นช่องว่าง ~1 ใน 4 ไม่ใช่ (precision 0.75)
            — พร้อมประโยคว่า **รอบนี้ทดสอบ UX ไม่ได้ทดสอบความแม่นของโมเดล**
          - **face blur ยังไม่มี** — ผู้ถ่ายต้องเลี่ยงไม่ให้ติดหน้าลูกค้าในเฟรม
          - ปุ่มที่ยังไม่เปิดใช้ (ส่งออกรายงาน / อนุมัติเส้นทาง / คิว relabel)
          - **"ผู้ถ่าย" แสดงเป็นบทบาทไม่ใช่ชื่อ = ข้อกำหนด ไม่ใช่บั๊ก** (ขึ้นกับคำตอบ Q3)
          - วิธีสร้างสถานะทดสอบจริงแทนการกด StateSwitcher (ถ่ายภาพเบลอจริง / ยืนนอกพิกัดร้าน)
    - [x] `docs/README.md` ชี้ไปที่เอกสารใหม่
  - Verify:
    - [x] เช็คลิสต์ §UAT Gate ใน [plan.md](plan.md) ผ่านครบทุกข้อ
    - [x] เดิน flow S1→S12 บนมือถือจริง 1 รอบด้วย build โหมด UAT โดยไม่แตะ devtools
  - Dependencies: ทุก task ก่อนหน้า
  - Files: `frontend/playwright.config.ts`, `frontend/e2e/demo-off.spec.ts`, `docs/uat.md`, `docs/README.md`
  - Scope: **M**

### ✅ Checkpoint 5 — พร้อมขึ้น UAT
- [x] เช็คลิสต์ §UAT Gate ผ่านครบ
- [x] ค้างจากรอบก่อน: เช็คลิสต์มือถือจริง [SPEC.md](../SPEC.md) §8 (bfcache / iOS camera)
- [x] archive `tasks/plan.md` + `tasks/todo.md` ของรอบ nav/camera ไป `docs/archive/nav-and-camera/`
- [x] review รอบสุดท้ายกับเจ้าของงาน

---

## สรุปขนาดงาน

| Phase | Tasks | ขนาดรวม |
| :-- | :-- | :-- |
| 1 — Truthfulness | 3 | S · S · S |
| 2 — Demo gating | 4 | S · M · M · S |
| 3 — ตัวเลขปลอม | 4 | S · S · M · S |
| 4 — ปุ่มตาย | 3 | XS · XS · XS |
| 5 — ปิดงาน | 2 | S · M |
| **รวม** | **16** | ไม่มี task ไหนแตะเกิน 5 ไฟล์ |

⚠️ Task 1 ทาง (ข) "implement face blur" คือ **XL — ต้องแตกใหม่** ถ้าเลือกทางนั้น
ให้ตัดออกจากรอบนี้แล้วทำ SPEC แยก


---

## บันทึกการแก้แผน — สิ่งที่แผนเดิมเขียนไว้ผิด

### 1. `lib/demo.ts` ที่ export ค่าคงที่ **ไม่ทำให้โค้ดหายจากบันเดิล**

AD1 ตั้งสมมติฐานว่า import ค่าคงที่จากโมดูลกลางแล้ว dead-code elimination จะตัดทิ้ง
grep บันเดิลจริงแล้ว **ไม่ตัด** — Turbopack เก็บ `p.DEMO_MODE && …` ไว้เป็น property
lookup ตอนรัน เงื่อนไขจึงรอดจาก minifier พร้อมกับคอมโพเนนต์ที่มันอ้างถึง

แก้เป็น: อ่าน `process.env.NEXT_PUBLIC_DEMO_MODE === "1"` ที่จุดใช้งานทุกไฟล์ และ
ประกาศ `env: { NEXT_PUBLIC_DEMO_MODE: … }` ใน `next.config.ts` (ตัวแปร
`NEXT_PUBLIC_*` ที่ **ไม่ถูกตั้ง** จะไม่ถูก inline เลย) จากนั้นเงื่อนไข fold เป็น `false`
และโค้ดหายจริง · `src/lib/demo.ts` ถูกลบ เพราะตัวมันเองคือสาเหตุ

ที่เหลืออยู่คือสตริง `"สาธิตสถานะหน้าจอ"` ของโมดูล `StateSwitcher` ที่ยังถูก emit
แม้ไม่มีใครอ้างถึงแล้ว — **ไม่มีเส้นทางไหน render มันได้** และ `demo-off.spec.ts`
พิสูจน์ไว้ เช็คลิสต์ใน [plan.md](plan.md) แก้ให้ตรวจสิ่งที่ตรวจได้จริงแล้ว

### 2. `NoShelfState` **ไม่ได้** เข้าถึงได้จาก job ที่ล้มเหลว

T5 เขียนไว้ว่า "ห้ามลบ NoShelfState เพราะเป็น error path จริง" — ตรวจแล้วไม่จริง
job ที่ FAILED ถูกจัดการจบที่ `/processing` และไม่เคยส่งต่อมาหน้า result
`NoShelfState` จึงเข้าถึงได้ทาง StateSwitcher ทางเดียว และถูก gate ตามนั้น

### 3. เก็บเพิ่มระหว่างทาง (ไม่ได้อยู่ในแผนเดิม)

- `config.py` guard เดิมเช็ค secret ผิดตัว · `ENVIRONMENT=uat` ตั้งไม่ได้เลย ·
  `JWT_SECRET=` ว่างจะรอด guard — ปิดครบทั้งสามช่อง
- `EvidenceViewer` ปุ่ม "โต้แย้งผลนี้" เขียนว่า "ยังไม่เปิดใช้งานในรุ่นสาธิตนี้"
- `slotsAfter()` + `position()` ใน `placeholder-shelf.ts` ไม่มีคนเรียกแล้ว → ลบ
- `camera-lifecycle.spec.ts` เคยเดินผ่านหน้า `/m/captures` ซึ่งเป็นหน้า demo →
  เปลี่ยนเป็น history back/forward (`page.goto` ใช้ไม่ได้ เพราะ full reload
  ล้าง visit state ทิ้ง ทำให้ test ตกด้วยเหตุผลที่ไม่เกี่ยวกับบั๊กที่มันคุมอยู่)
