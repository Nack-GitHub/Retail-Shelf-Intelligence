# TODO: Front-end Navigation & Camera Lifecycle Hardening

แผน: [plan.md](plan.md) · สเปก: [../SPEC.md](../SPEC.md)

> กติกา: ห้าม `git push` · ห้ามเขียนรหัส task ลงในคอมเมนต์ในโค้ด
>
> **สถานะ: ทำครบทั้ง 14 task แล้ว** — E2E 39/39 ผ่าน · typecheck สะอาด ·
> build ผ่าน · lint ไม่มีปัญหาใหม่ · ยังไม่ push ตามที่ตกลง

---

## Phase 1 — Test harness

- [x] **Task 1: ติดตั้ง Playwright + API stub fixture + smoke test**
  - Acceptance:
    - `npm run test:e2e` รันได้จาก `frontend/` โดยไม่ต้องมี backend รันอยู่
    - fixture ตอบ `/v1/**` ครบพอให้เดิน flow ได้ตั้งแต่ login ถึง checkout
    - Chromium เปิดด้วย fake camera + auto-grant permission
  - Verify: `npm run test:e2e -- e2e/smoke.spec.ts` ผ่าน
  - Files: `package.json`, `playwright.config.ts`, `e2e/fixtures/api.ts`, `e2e/fixtures/test.ts`, `e2e/smoke.spec.ts`, `.gitignore`
  - Deps: None · Scope: M

**Checkpoint A** — `npm run test:e2e` เขียวโดยไม่ต้องพึ่ง backend

---

## Phase 2 — Camera lifecycle

- [x] **Task 2: เขียน failing test ของกล้อง**
  - Acceptance: test ครอบคลุมจอดำหลัง back, track ค้างหลัง unmount เร็ว, track ตายแล้วไม่ฟื้น, preview หายหลัง back, timer ของ compare
  - Verify: รันแล้ว **fail** บนโค้ดปัจจุบัน (ต้อง fail จริง ไม่ใช่ error ตอน setup)
  - Files: `e2e/camera-lifecycle.spec.ts`
  - Deps: 1 · Scope: S

- [x] **Task 3: `useCamera` — callback ref + generation token**
  - Acceptance:
    - element ส่งเข้า hook ผ่าน callback ref → attach ได้ไม่ว่า stream หรือ element มาก่อน
    - `getUserMedia` ที่ resolve หลังจากไม่มีเจ้าของแล้ว ต้อง `stop()` track ตัวเองและไม่เซ็ต state
    - caller ทั้งสองหน้า (capture, compare) ปรับตาม API ใหม่
  - Verify: test จอดำหลัง back + test unmount เร็วผ่าน · `npx tsc --noEmit` สะอาด
  - Files: `src/hooks/useCamera.ts`, `capture/page.tsx`, `compare/page.tsx`
  - Deps: 2 · Scope: M

- [x] **Task 4: `useCamera` — ฟื้นตัวเองเมื่อ track ตาย + `grab()` รอ metadata**
  - Acceptance:
    - ฟัง `track.ended` + `visibilitychange` + `pageshow` → ถ้ายัง active ให้เปิดใหม่อัตโนมัติ
    - มี backoff ไม่ให้ retry รัวเมื่อเปิดไม่ได้จริง
    - `grab()` รอ `videoWidth > 0` (มี timeout) และคืนข้อความไทยที่บอกสาเหตุได้
  - Verify: test track ตายแล้วฟื้น + test grab ทันทีหลัง live ผ่าน
  - Files: `src/hooks/useCamera.ts`
  - Deps: 3 · Scope: S

- [x] **Task 5: คงรูป preview ไว้ข้ามการออกจากหน้า**
  - Acceptance:
    - ถ่ายรูป → ไป `/m/captures` → back → ยังเห็น preview รูปเดิม ไม่ต้องถ่ายใหม่
    - state ใหม่ผูกกับ visit และถูกล้างเมื่อ `beginVisit` / `resetVisit`
    - เพิ่ม field ใหม่ใน `DemoState` เท่านั้น ไม่แก้ของเดิม
  - Verify: test preview คงอยู่ผ่าน · หน้าอื่นที่อ่าน store ยัง typecheck ผ่าน
  - Files: `src/lib/store.ts`, `capture/page.tsx`
  - Deps: 3 · Scope: M

- [x] **Task 6: เก็บกวาด timer ที่ไม่มี cleanup**
  - Acceptance: `setTimeout` ทุกตัวที่ navigate หรือแตะ store มี cleanup — โดยเฉพาะ shutter ของ compare ที่ mark ว่าถ่าย after แล้วทั้งที่ผู้ใช้ back ออกไป
  - Verify: test compare timer ผ่าน
  - Files: `compare/page.tsx`, `checkin/page.tsx`
  - Deps: 2 · Scope: S

**Checkpoint B** — `e2e/camera-lifecycle.spec.ts` เขียวทั้งไฟล์ · lint + typecheck สะอาด

---

## Phase 3 — Flow guard

- [x] **Task 7: เขียน failing test ของ navigation + deep link**
  - Acceptance: ครอบคลุม back ทุก step, back ระหว่าง 700ms หลังเช็คอิน, login/logout back, checkout back, หน้าขาวของ verify, deep link ทั้ง 9 step
  - Verify: รันแล้ว fail บนโค้ดปัจจุบัน
  - Files: `e2e/nav-back.spec.ts`, `e2e/deep-link-guards.spec.ts`
  - Deps: 1 · Scope: M

- [x] **Task 8: flow step graph + `useFlow()` + `FlowGuardBlock`**
  - Acceptance:
    - `steps.ts` ไม่ import React — นิยาม path / canEnter / fallback / back / transient / terminal ครบ 11 step ตามตาราง SPEC §6.1
    - `useFlow(stepId)` คืน `go()`, `back()`, `guard`
    - `FlowGuardBlock` แสดงเหตุผลภาษาไทย + ปุ่มไป fallback — ไม่มี `return null`
  - Verify: `npx tsc --noEmit` สะอาด · หน้าเดิมยังทำงานได้ (ยังไม่ย้าย)
  - Files: `src/lib/flow/steps.ts`, `src/lib/flow/useFlow.ts`, `src/components/mobile/FlowGuardBlock.tsx`
  - Deps: 7 · Scope: M

- [x] **Task 9: ย้ายหน้าต้นทางมาใช้ `useFlow`**
  - Acceptance: login, `/m`, checkin, category เลิกเรียก router ตรง ๆ · login/logout ใช้ replace · timeout ของ checkin ยกเลิกได้ · เช็คอินซ้ำไม่ได้
  - Verify: test login/logout back + test checkin 700ms ผ่าน
  - Files: `login/page.tsx`, `m/page.tsx`, `checkin/page.tsx`, `category/page.tsx`
  - Deps: 8 · Scope: M

- [x] **Task 10: ย้ายหน้าปลายทางมาใช้ `useFlow`**
  - Acceptance: capture, processing, result, verify, tasks, compare, checkout ใช้ `useFlow` ทั้งหมด · verify ไม่คืนหน้าขาว · checkout เป็น terminal
  - Verify: test back ทุก step + test checkout back ผ่าน
  - Files: 7 หน้าใต้ `src/app/m/store/[id]/`
  - Deps: 8 · Scope: L (แตกย่อยตอนทำถ้าเกิน 5 ไฟล์ต่อรอบ)

- [x] **Task 11: `MobileHeader` back ของ flow + ทิศ animation จาก step**
  - Acceptance: ทุกหน้าส่ง `onBack` จาก flow · `MobileShell` เลิกใช้ `STEPS` array ที่ซ้ำซ้อน · path ที่ไม่รู้จักไม่ถูกมองว่าเป็นระดับเดียวกับหน้าแรก
  - Verify: test ทิศทาง + back ทุก step ผ่าน
  - Files: `Chrome.tsx`, `MobileShell.tsx`
  - Deps: 9, 10 · Scope: S

**Checkpoint C** — nav + deep-link suite เขียว · ไม่มี `router.push/replace/back` เหลือใน `src/app/m/**`

---

## Phase 4 — Polish

- [x] **Task 12: scroll restoration ของ inner container**
  - Acceptance: scroll ลงท้าย `/tasks` → ไปหน้าอื่น → back → กลับมาที่ตำแหน่งเดิม
  - Verify: test scroll ผ่าน
  - Files: `Chrome.tsx`, `src/lib/flow/useFlow.ts`
  - Deps: 11 · Scope: S

- [x] **Task 13: logout/login ฝั่ง web ใช้ replace**
  - Acceptance: ปุ่มออกจากระบบทั้งใน `WebShell` (2 จุด) ใช้ replace · back หลัง logout ไม่กลับเข้าแอป
  - Verify: test logout ฝั่ง web ผ่าน · ไม่ทับ UI ที่เจ้าของงานเพิ่งเพิ่ม
  - Files: `WebShell.tsx`
  - Deps: 9 · Scope: XS

- [x] **Task 14: ปิดงาน**
  - Acceptance: ทุก gate ผ่าน · เช็คลิสต์มือถือจริงเขียนไว้ให้เจ้าของงานเดินเอง
  - Verify: `npm run lint` · `npx tsc --noEmit` · `npm run test:e2e` · `npm run build`
  - Files: `SPEC.md` (อัปเดตสถานะ), `tasks/todo.md`
  - Deps: ทั้งหมด · Scope: XS

**Checkpoint D** — พร้อมส่ง review
