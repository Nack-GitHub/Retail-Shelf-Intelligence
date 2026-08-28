# Implementation Plan: Front-end Navigation & Camera Lifecycle Hardening

อ้างอิง: [../SPEC.md](../SPEC.md) · ขอบเขต `frontend/` เท่านั้น

## Overview

แก้สองเรื่องที่พัวพันกันแต่แก้แยกกันได้: (1) **camera lifecycle** ที่ทำให้กล้องเปิดไม่ติด
หลัง back และ (2) **เส้นทาง navigate/back** ที่ไม่มีใครนิยามไว้ที่เดียว ทั้งสองเรื่องถูก
พิสูจน์ด้วย Playwright E2E ที่เขียนให้ fail ก่อนแล้วค่อยแก้โค้ด

งานเรียงแบบ vertical slice: แต่ละ task จบด้วยแอปที่รันได้และ test ที่ผ่าน

## Architecture Decisions

### AD1 — E2E stub API ด้วย Playwright route interception ไม่ต้องรัน backend

`next.config.ts` rewrite `/v1/*` ไป `localhost:8000` การให้ E2E ต้องมี postgres +
redis + minio + API + worker ครบก่อนรัน จะทำให้ test ชุดนี้ไม่มีใครรัน สิ่งที่กำลัง
ทดสอบคือ navigation กับ camera lifecycle ของ front-end ไม่ใช่ API — จึง intercept
`**/v1/**` ด้วย `page.route()` แล้วตอบ fixture คงที่ ได้ test ที่ hermetic รันเร็ว
และ deterministic พอจะจับ race condition ได้

### AD2 — Flow guard เป็น "data + hook" ไม่ใช่ router wrapper

`steps.ts` เป็น plain object graph ที่ไม่ import React เลย → unit test ได้ตรง ๆ และ
`useFlow()` เป็นชั้นบางที่แปลง step graph เป็น `router.push/replace` ทางเลือกอื่นคือ
ครอบ router ทั้งตัว ซึ่งจะชนกับ `AuthGate` และ Next.js internals โดยไม่จำเป็น

### AD3 — Camera: callback ref + generation token

สาเหตุจริงของจอดำคือ effect ที่ผูกกับ `RefObject` ไม่ re-run ตอน element mount ทีหลัง
การเปลี่ยนเป็น callback ref ทำให้ React แจ้ง hook เองเมื่อ element เปลี่ยน — แก้ที่ราก
ไม่ใช่เพิ่ม `status` เข้า deps ซึ่งเป็นการเดาว่าอะไรจะเปลี่ยนก่อน

generation token (counter ที่เพิ่มทุกครั้งที่ start/stop) ทำให้ `getUserMedia` ที่
resolve ช้ากว่าการ unmount รู้ตัวว่าไม่มีเจ้าของแล้วและหยุด track ตัวเอง

### AD4 — preview state ย้ายเข้า zustand แบบ additive

`photo` / `shots` / `phase` ของหน้า capture เป็น local `useState` จึงหายทุกครั้งที่
ออกจากหน้า ย้ายเข้า `DemoState` โดย**เพิ่ม field ใหม่เท่านั้น ไม่แก้ field เดิม** เพื่อ
ไม่ให้หน้าอื่นที่อ่าน store อยู่พัง

### AD5 — คอมเมนต์ในโค้ดห้ามอ้างรหัส task

ทุกคอมเมนต์ต้องอธิบายเหตุผลจริงให้คนที่ไม่เคยเห็น SPEC เข้าใจได้เอง ห้ามมี `C1`,
`H9`, `task 3` ฯลฯ ในโค้ด (ข้อกำหนดจากเจ้าของงาน)

### AD6 — commit ในเครื่องได้ แต่ห้าม `git push`

## Task List

### Phase 1: Test harness

- [ ] Task 1: ติดตั้ง Playwright + API stub fixture + smoke test

### Checkpoint A
- [ ] `npm run test:e2e` รันได้และ smoke test ผ่านโดยไม่ต้องมี backend

### Phase 2: Camera lifecycle

- [ ] Task 2: เขียน failing test ของกล้อง
- [ ] Task 3: แก้ `useCamera` — callback ref + generation token
- [ ] Task 4: `useCamera` — track ended / visibility recovery / grab รอ metadata
- [ ] Task 5: คงรูป preview ไว้ข้ามการออกจากหน้า
- [ ] Task 6: เก็บกวาด timer ที่ไม่มี cleanup

### Checkpoint B
- [ ] `e2e/camera-lifecycle.spec.ts` ผ่านทั้งไฟล์
- [ ] `npm run lint` + `npx tsc --noEmit` ไม่มี error ใหม่

### Phase 3: Flow guard

- [ ] Task 7: เขียน failing test ของ navigation + deep link
- [ ] Task 8: สร้าง flow step graph + `useFlow()` + `FlowGuardBlock`
- [ ] Task 9: ย้ายหน้าต้นทาง (login, route, checkin, category) มาใช้ `useFlow`
- [ ] Task 10: ย้ายหน้าปลายทาง (capture → checkout) มาใช้ `useFlow`
- [ ] Task 11: `MobileHeader` ใช้ back ของ flow + `MobileShell` คิดทิศจาก step

### Checkpoint C
- [ ] `e2e/nav-back.spec.ts` + `e2e/deep-link-guards.spec.ts` ผ่านทั้งสองไฟล์
- [ ] ไม่มี `router.push/replace/back` เหลือใน `src/app/m/**`

### Phase 4: Polish

- [ ] Task 12: scroll restoration ของ inner container
- [ ] Task 13: logout/login ฝั่ง web ใช้ replace
- [ ] Task 14: ปิดงาน — เช็คลิสต์มือถือจริง + รันทุก gate

### Checkpoint D
- [ ] ทุก success criteria ใน SPEC §10 ผ่าน
- [ ] พร้อม review

## Risks and Mitigations

| Risk | Impact | Mitigation |
| :-- | :-- | :-- |
| Playwright fake camera ไม่จำลอง track suspension แบบ iOS Safari | High | test ระดับ unit ยิง `track.stop()` + `visibilitychange` เอง และมีเช็คลิสต์มือถือจริงใน SPEC §8 ที่ไม่มีอะไรมาแทนได้ |
| แก้ 11 หน้าให้ใช้ `useFlow` พร้อมกันแล้วพังทั้งแอป | High | แบ่งเป็น Task 9/10 และ `useFlow` รองรับหน้าที่ยังไม่ย้ายได้ (ค่อย ๆ ย้าย ไม่ big bang) |
| แก้ `DemoState` แล้วหน้าอื่นพัง | Med | เพิ่ม field ใหม่เท่านั้น ไม่แก้/ลบของเดิม (AD4) และ typecheck จับได้ |
| มี uncommitted work ของเจ้าของงานค้างอยู่ 3 ไฟล์ | Med | อ่าน diff แล้วแก้ทับเฉพาะบรรทัด `router.push` ที่เกี่ยวข้อง ไม่แตะ UI ที่เขาเพิ่ง|เพิ่ม |
| E2E stub ทำให้พลาดบั๊กที่เกิดจาก API จริง | Low | ขอบเขตงานนี้คือ front-end routing/camera ตามที่ SPEC §1.4 ระบุ |

## Open Questions

ตอบไปแล้วทั้งหมดตามที่เจ้าของงานให้อำนาจตัดสินใจ:

1. RESULT back → **CATEGORY** (result มีปุ่ม "ถ่ายใหม่" ของตัวเองแล้ว)
2. VERIFY → TASKS ใช้ **push** (rep กลับไปแก้คำตัดสินได้)
3. **ยังไม่ persist** ลง sessionStorage — flow guard อย่างเดียวก่อน เลี่ยงประเด็น PDPA
   ของ `photoLog` ที่ถือ blob รูปในร้าน
4. `/m/captures`, `/m/sync` **คงเป็น route แยก** (เป็น S13 ใน docs/ui.md)
5. `/w/**` แก้เฉพาะ logout/login ที่ใช้ `push` (Task 13)
