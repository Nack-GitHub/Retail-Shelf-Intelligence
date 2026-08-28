# TODO: OSA Consistency — ให้ตัวเลข OSA ทุกหน้าจอพูดตรงกัน

แผน: [plan.md](plan.md) · ที่มา: อาการ "ปิดงานแล้วกลับมาหน้ารายการ แล้ว % OSA ไม่ตรง"

> กติกา (ตาม [../SPEC.md](../SPEC.md) §9): ห้าม `git push` · ห้ามเขียนรหัส task ลงใน
> คอมเมนต์ในโค้ด · รัน `npm run lint` + `npx tsc --noEmit` + `npm run test:e2e` +
> `pytest` ก่อน commit · คงข้อความไทยเดิมไว้ถ้าความหมายไม่เปลี่ยน
>
> **ห้ามแตะนิยามของตัวเลข** — เจ้าของงานยืนยัน 2026-08-28 ว่านิยามปัจจุบันถูกแล้ว
> รอบนี้แก้ได้แค่ ป้ายกำกับ · สี · จังหวะเวลา
>
> ไฟล์ของรอบ UAT ที่ยังไม่ commit ถูกเก็บไว้ที่ `tasks/uat-readiness-{plan,todo}.md`
> — ห้ามลบจนกว่ารอบนั้นจะถูก commit
>
> **สถานะ: ยังไม่เริ่ม 0/9**

---

## Phase 1 — เกณฑ์เดียว

- [x] **Task 1: รวมเกณฑ์ OSA ของ frontend ไว้ที่ `lib/osa.ts` ที่เดียว**

  ตอนนี้ frontend มีเกณฑ์ซ้อนกันสองชุดและไม่มีชุดไหนตรงกับ backend:
  `osaStatusOf` ใช้ OK≥90 / LOW≥70 ([Badge.tsx:73-75](../frontend/src/components/ui/Badge.tsx#L73-L75))
  ส่วนสีแถบใช้ 90/75 คัดลอกอยู่ 4 ไฟล์ ขณะที่ backend ใช้
  `critical_threshold = 0.75` / `low_threshold = 0.90` ([config.py:77-78](../backend/app/core/config.py#L77-L78))
  ผลคือชั้นวางที่ได้ 72% ขึ้น CRITICAL ในหน้าผล (ใช้ `status` จาก server) แต่ขึ้น LOW
  ในหน้าเช็คเอาต์ (คำนวณเอง)

  - Acceptance:
    - [x] มีไฟล์ `frontend/src/lib/osa.ts` ที่ export `OSA_THRESHOLDS`, `osaStatusOf`,
          `osaTone` และเป็น **ที่เดียว** ในฝั่ง frontend ที่มีตัวเลขเกณฑ์
    - [x] ค่าใน `OSA_THRESHOLDS` ตรงกับ backend (critical 75, low 90) พร้อมคอมเมนต์
          ชี้ว่า source of truth อยู่ที่ `backend/app/core/config.py`
    - [x] `osaStatusOf` ถูกย้ายออกจาก [Badge.tsx](../frontend/src/components/ui/Badge.tsx)
          และผู้เรียกทั้งสามจุดชี้มาที่ `lib/osa.ts`
          ([checkout:139](../frontend/src/app/m/store/[id]/checkout/page.tsx#L139) ·
          [compare:409](../frontend/src/app/m/store/[id]/compare/page.tsx#L409) ·
          [w/stores:96](../frontend/src/app/w/stores/[id]/page.tsx#L96))
    - [x] หน้าไหนที่ server ส่ง `status` มาให้แล้วยังใช้ของ server ต่อไป ไม่คำนวณซ้ำ
    - [x] `osaTone(osa)` ถูก export ไว้พร้อมใช้ แต่ผู้เรียกยังไม่เปลี่ยนในงานนี้ (Task 2)
  - Verify:
    - [x] `grep -rn "osaStatusOf" frontend/src` → นิยามอยู่ใน `lib/osa.ts` ที่เดียว
    - [x] `grep -rn ">= 70 ?" frontend/src` → ไม่พบ
    - [x] `npx tsc --noEmit` สะอาด · `npm run lint` ≤ baseline 18 issues
    - [x] e2e `osa-consistency.spec.ts`: ค่า 72% ขึ้น "วิกฤต" ไม่ใช่ "ต่ำ"
          (พิสูจน์แล้วว่าแดงกับเกณฑ์เดิม 70 และเขียวกับ 75)
  - Dependencies: None
  - Files: `frontend/src/lib/osa.ts` (ใหม่), `frontend/src/components/ui/Badge.tsx`,
    `frontend/src/app/m/store/[id]/checkout/page.tsx`,
    `frontend/src/app/m/store/[id]/compare/page.tsx`,
    `frontend/src/app/w/stores/[id]/page.tsx`
  - Scope: **S**

- [x] **Task 2: ให้สีแถบ OSA ทั้ง 4 จุดใช้เกณฑ์เดียวกับสถานะ**

  สีแถบถูกคัดลอกเป็น ternary `>= 90 ? ok : >= 75 ? warn : danger` อยู่ 4 ไฟล์ ค่าบังเอิญ
  ตรงกับ backend แต่ไม่มีอะไรบังคับให้ตรงต่อไป และมันคือเกณฑ์ชุดที่สองที่ทำให้สีกับ pill
  เล่าคนละเรื่องในช่วง 70–75% มาแล้ว

  - Acceptance:
    - [x] ทั้ง 4 จุดเรียก `osaTone(...)` จาก `lib/osa.ts`
          ([m/page:218](../frontend/src/app/m/page.tsx#L218) ·
          [category:123](../frontend/src/app/m/store/[id]/category/page.tsx#L123) ·
          [w/page:281](../frontend/src/app/w/page.tsx#L281) ·
          [w/routes:143](../frontend/src/app/w/routes/page.tsx#L143))
    - [x] สีที่แสดงจริงไม่เปลี่ยนสำหรับค่าที่ ≥75 หรือ ≥90 (เกณฑ์เดิมตรงกับ backend อยู่แล้ว)
  - Verify:
    - [x] `grep -rn ">= 90 ?\|>= 75 ?" frontend/src` → ไม่พบนอก `lib/osa.ts`
    - [x] `npx tsc --noEmit` สะอาด · `npm run lint` ≤ 18
    - [x] `npm run test:e2e` ผ่าน
  - Dependencies: Task 1
  - Files: `frontend/src/app/m/page.tsx`,
    `frontend/src/app/m/store/[id]/category/page.tsx`,
    `frontend/src/app/w/page.tsx`, `frontend/src/app/w/routes/page.tsx`
  - Scope: **S**

- [x] **Task 3: contract test กันเกณฑ์ frontend/backend drift**

  เกณฑ์สองฝั่งเพี้ยนกันได้เงียบ ๆ มาแล้วครั้งหนึ่ง การ mirror ค่าอย่างเดียวไม่พอ
  ต้องมีอะไรที่แดงเมื่อฝั่งใดฝั่งหนึ่งขยับ

  - Acceptance:
    - [x] มี `backend/tests/unit/test_osa_thresholds_contract.py` ที่อ่าน
          `frontend/src/lib/osa.ts` แล้วเทียบกับ `settings.critical_threshold` /
          `settings.low_threshold` (คูณ 100)
    - [x] ข้อความ assert บอกชื่อไฟล์ทั้งสองฝั่งและค่าที่ไม่ตรง ไม่ใช่แค่ `assert a == b`
    - [x] test หาไฟล์เจอโดยไม่ขึ้นกับ cwd ที่รัน pytest
    - [x] ถ้าหาไฟล์ frontend ไม่เจอให้ fail ไม่ใช่ skip เงียบ ๆ
  - Verify:
    - [x] `pytest backend/tests/unit/test_osa_thresholds_contract.py` เขียว
    - [x] แก้ `critical_threshold` เป็น 0.70 ชั่วคราว → test แดง แล้วแก้กลับ
  - Dependencies: Task 1
  - Files: `backend/tests/unit/test_osa_thresholds_contract.py` (ใหม่)
  - Scope: **XS**

### Checkpoint 1
- [ ] `npx tsc --noEmit` สะอาด · `npm run lint` ≤ 18 · `pytest` เขียวทั้งชุด
- [ ] พิสูจน์แล้วว่า Task 3 แดงจริงเมื่อ config ขยับ

---

## Phase 2 — เช็คเอาต์ไม่แซงงานวิเคราะห์

- [x] **Task 4: ปิดปุ่ม "สรุปและเช็คเอาต์" ระหว่างอัปโหลดภาพ AFTER**

  หน้า compare ยิง `void uploadAfter(p)` แบบไม่รอผล
  ([compare:113](../frontend/src/app/m/store/[id]/compare/page.tsx#L113)) แต่ปุ่มไปเช็คเอาต์
  ([compare:427](../frontend/src/app/m/store/[id]/compare/page.tsx#L427)) ไม่ได้ถูก disable
  ตาม `uploading` เลย รีบกดได้ทันทีทั้งที่ภาพยังไม่ถึง worker

  - Acceptance:
    - [x] ปุ่มถูก disable ขณะ `uploading === true` และมีข้อความบอกว่ากำลังทำอะไรอยู่
          (ใช้ข้อความเดิม "กำลังส่งภาพหลังเติมของไปวิเคราะห์…" ที่มีอยู่แล้วที่
          [compare:389](../frontend/src/app/m/store/[id]/compare/page.tsx#L389))
    - [x] อัปโหลดล้มเหลว → ปุ่มกลับมากดได้ และ error เดิมยังแสดงตามปกติ
    - [x] ไม่มีภาพ AFTER เลย → ปุ่มกดได้เหมือนเดิม ไม่มีการบล็อกเพิ่ม
  - Verify:
    - [x] `npx tsc --noEmit` สะอาด
    - [x] manual: ถ่าย AFTER แล้วรีบกดปุ่มทันที → กดไม่ได้จนกว่าจะอัปโหลดเสร็จ
    - [x] `npm run test:e2e` ผ่าน (เช็คว่า flow เดิมที่ไม่ถ่าย AFTER ไม่ถูกบล็อก)
  - Dependencies: None
  - Files: `frontend/src/app/m/store/[id]/compare/page.tsx`
  - Scope: **S**

- [x] **Task 5: `analysisPending` ใน `CheckoutResponse`**

  Task 4 ปิดช่องฝั่ง UI แต่ไม่ปิดช่องจริง: อัปโหลดเสร็จไม่ได้แปลว่าวิเคราะห์เสร็จ
  งานเป็น Celery job ([captures.py:144-149](../backend/app/api/v1/captures.py#L144-L149))
  ส่วน checkout ยิง `AVG(osa_score)` ทันที ([visits.py:75-81](../backend/app/api/v1/visits.py#L75-L81))
  client จึงต้องรู้ว่า "ค่าที่ได้ไปนี้ยังไม่ครบ"

  - Acceptance:
    - [x] `CheckoutResponse` มีฟิลด์ `analysis_pending: bool` — true เมื่อมี `InferenceJob`
          สถานะ QUEUED หรือ RUNNING ของ capture ใน visit นี้
    - [x] visit ยังถูกปิดตามปกติเสมอ แม้มี job ค้าง (ตาม AD2 — ห้ามให้ server รอ job)
    - [x] เรียก checkout ซ้ำหลัง job เสร็จ → `osa_after` ได้ค่า และ `checked_out_at`
          **ไม่ขยับ** จากครั้งแรก
    - [x] ไม่มีภาพ AFTER และไม่มี job ค้าง → `analysis_pending=false`, `osa_after=null`
          เหมือนเดิมทุกประการ
  - Verify:
    - [x] integration test ครอบ 3 เคส: มี job ค้าง / เรียกซ้ำหลัง job เสร็จ / ไม่มีภาพ AFTER
    - [x] `pytest` เขียวทั้งชุด (39 เดิมต้องไม่แดง)
  - Dependencies: None
  - Files: `backend/app/api/v1/visits.py`, `backend/app/api/v1/schemas.py`,
    `backend/tests/integration/test_golden_path.py`
  - Scope: **S**

- [x] **Task 6: หน้าเช็คเอาต์รอผลวิเคราะห์แล้วยิง checkout ซ้ำ**

  อาการที่ผู้ใช้เห็นคือหน้าเช็คเอาต์ประกาศ "ยังไม่ได้ถ่ายภาพหลังเติมของ"
  ([checkout:120](../frontend/src/app/m/store/[id]/checkout/page.tsx#L120)) ทั้งที่เพิ่งถ่ายไป
  แล้วพอกลับมาหน้ารายการกลับมีเลขใหม่ ต้องแยกให้ออกระหว่าง "ไม่มีภาพ AFTER" กับ
  "มีภาพแต่ยังวิเคราะห์ไม่เสร็จ"

  ระวัง: `closeOutVisit` จำผลไว้ (`if (checkout) return checkout` ที่
  [store.ts:294](../frontend/src/lib/store.ts#L294)) การยิงซ้ำต้องมีทางบังคับ ไม่ใช่
  ล้าง state ทิ้งทั้งก้อน — และต้องไม่ทำให้ queue offline ได้ CHECKOUT ซ้ำสองรายการ

  - Acceptance:
    - [x] `closeOutVisit` รับทางบังคับยิงใหม่ (เช่น `{ refresh: true }`) ที่ข้าม memo
          โดยไม่แตะ state อื่นของ visit
    - [x] `analysisPending=true` → หน้าจอแสดงสถานะกำลังวิเคราะห์ ไม่ใช่ข้อความว่าไม่มีภาพ
    - [x] เมื่องานเสร็จ (poll ผ่าน `pollJob` เดิม) ยิง checkout ซ้ำหนึ่งครั้งแล้วแสดง
          `osaAfter` ที่ได้
    - [x] ครบ timeout แล้วยังไม่เสร็จ → ปิดหน้าตามปกติพร้อมข้อความว่าค่าจะปรากฏในหน้าเว็บ
          ภายหลัง (ตาม Open Question 2 ในแผน)
    - [x] เคสไม่มีภาพ AFTER จริง ๆ ยังใช้ข้อความไทยเดิมทุกตัวอักษร
    - [x] offline: พฤติกรรม enqueue เดิมไม่เปลี่ยน และไม่เกิดรายการซ้ำ
  - Verify:
    - [x] `npx tsc --noEmit` สะอาด · `npm run lint` ≤ 18
    - [x] `npm run test:e2e` + `npm run test:e2e:demo` ผ่านทั้งคู่
    - [x] manual: ถ่าย AFTER → กดเช็คเอาต์ทันที → ไม่เห็นข้อความ "ยังไม่ได้ถ่ายภาพ
          หลังเติมของ" เลยสักเฟรม และเลขที่ขึ้นตรงกับที่การ์ดหน้ารายการแสดงหลังกลับออกมา
  - Dependencies: Task 5
  - Files: `frontend/src/lib/store.ts`, `frontend/src/lib/api/visits.ts`,
    `frontend/src/app/m/store/[id]/checkout/page.tsx`
  - Scope: **M**

### Checkpoint 2
- [ ] integration test ของ Task 5 เขียวครบ 3 เคส
- [ ] manual สองรอบ: ถ่าย AFTER แล้วรีบกด / ไม่ถ่าย AFTER เลย → ทั้งสองรอบเลขที่หน้า
      เช็คเอาต์กับการ์ดหน้ารายการเล่าเรื่องเดียวกัน
- [ ] review กับเจ้าของงานก่อนเข้า Phase 3

---

## Phase 3 — การ์ดบอกที่มาของเลข

- [ ] **Task 7: ส่ง `lastOsaPhase` / `lastOsaCategory` / `lastOsaAt` ออกมาจาก API**

  `last_osa` คือแถววิเคราะห์ล่าสุดของร้าน ไม่กรองเฟส ไม่กรองหมวด ไม่กรอง visit
  ([store_risk.py:63-68](../backend/app/repositories/store_risk.py#L63-L68)) — นิยามนี้
  **ถูกแล้วและห้ามแก้** แต่ UI ต้องรู้ว่าเลขที่ได้มาจากไหนถึงจะเขียนป้ายให้ตรงได้
  แถวที่ต้องการถูก DISTINCT ON เลือกไว้อยู่แล้ว เพิ่มแค่คอลัมน์ที่ select ออกมา

  - Acceptance:
    - [ ] `StoreRisk` มี `last_osa_phase` ("BEFORE"/"AFTER"), `last_osa_category`,
          `last_osa_at` — เป็น `None` ทั้งหมดใน `NEVER_MEASURED`
    - [ ] ค่าที่ได้มาจาก **แถวเดียวกัน** กับ `last_osa` ไม่ใช่ query แยก
    - [ ] `StoreRiskOut` (จึงรวม `RouteStopOut`) และ rows ของ `analytics/risk-ranking`
          ส่งสามฟิลด์นี้ออกไป
    - [ ] `last_osa` ตัวเลขเดิมไม่เปลี่ยนแม้แต่ร้านเดียว และลำดับการเรียงไม่เปลี่ยน
  - Verify:
    - [ ] integration test: ร้านที่ภาพล่าสุดเป็น AFTER → `lastOsaPhase == "AFTER"`
    - [ ] integration test: ร้านที่ไม่เคยตรวจ → ทั้งสามฟิลด์เป็น null
    - [ ] `pytest` เขียวทั้งชุด
  - Dependencies: None
  - Files: `backend/app/repositories/store_risk.py`, `backend/app/api/v1/schemas.py`,
    `backend/app/api/v1/stores.py`, `backend/app/api/v1/routes.py`,
    `backend/app/api/v1/analytics.py`, `backend/tests/integration/test_stores.py`
  - Scope: **M**

- [ ] **Task 8: ป้ายกำกับที่มาของ OSA บน 4 จอ**

  การ์ดหน้ารายการเขียน "OSA ครั้งก่อน" ([m/page:215](../frontend/src/app/m/page.tsx#L215))
  ทั้งที่หลังตรวจเสร็จมันคือเลขของ *ครั้งนี้* และอาจเป็นเลข **ก่อน** เติมของ หรือเป็นของ
  ชั้นวางอื่นในร้านเดียวกัน

  - Acceptance:
    - [ ] `Store` (types) และ `toStore` รับสามฟิลด์ใหม่ผ่าน `lib/api/routes.ts`
    - [ ] มี helper เดียว (ใน `lib/osa.ts`) ที่แปลง phase/category/at → ป้ายภาษาไทย
    - [ ] ป้ายบอกเฟสได้ถูกต้อง: BEFORE → สื่อว่าเป็นค่าก่อนเติมของ · AFTER → หลังเติมของ
    - [ ] ไม่มีหน้าไหนเรียกเลขของการตรวจครั้งล่าสุดว่า "ครั้งก่อน" อีก
    - [ ] ชื่อหมวดชั้นวางแสดงเมื่อร้านนั้นมีมากกว่าหนึ่งหมวด (ตาม Open Question 1)
    - [ ] ร้านที่ไม่เคยตรวจยังใช้ข้อความเดิม "ยังไม่เคยตรวจชั้นวางที่ร้านนี้"
  - Verify:
    - [ ] `grep -rn "OSA ครั้งก่อน" frontend/src` → ไม่พบ
    - [ ] `npx tsc --noEmit` สะอาด · `npm run lint` ≤ 18
    - [ ] `npm run test:e2e` + `npm run test:e2e:demo` ผ่านทั้งคู่
    - [ ] manual: การ์ดร้านที่เพิ่งตรวจเสร็จโดยไม่ถ่าย AFTER อ่านแล้วเข้าใจได้ว่าเลขนี้
          คือค่าก่อนเติมของ ไม่ใช่ผลงานที่ยังไม่ขยับ
  - Dependencies: Task 8, Task 1, Task 2
  - Files: `frontend/src/types/index.ts`, `frontend/src/lib/api/routes.ts`,
    `frontend/src/lib/osa.ts`, `frontend/src/app/m/page.tsx`,
    `frontend/src/app/w/routes/page.tsx`, `frontend/src/app/w/page.tsx`,
    `frontend/src/app/w/stores/[id]/page.tsx`
  - Scope: **M**

- [ ] **Task 9: บันทึกนิยาม OSA ทั้ง 5 ตัวไว้ให้คนอ่านได้**

  ทั้งทีมและ tester ต้องอ่านได้จากที่เดียวว่า OSA แต่ละที่คือเลขอะไร ไม่งั้นจะมีรายงาน
  "ตัวเลขไม่ตรง" ซ้ำเดิมทุกรอบ

  - Acceptance:
    - [ ] [docs/ui.md](../docs/ui.md) มีหัวข้อ OSA ที่ระบุครบทั้ง 5 นิยาม พร้อมชี้ไฟล์ต้นทาง
    - [ ] [docs/uat.md](../docs/uat.md) เขียนให้ tester ว่า **ติ๊ก task ว่าเติมแล้วไม่ทำให้
          OSA ขยับ** ต้องถ่ายภาพหลังเติมของเท่านั้น
    - [ ] บันทึกว่าเกณฑ์สถานะคือ 75/90 และเคยเพี้ยนเป็น 70 ที่ frontend มาก่อน
  - Verify:
    - [ ] อ่านทวนแล้วตรงกับพฤติกรรมหลัง Task 1–8 จริง ไม่ใช่ตรงกับแผน
  - Dependencies: Task 1–8
  - Files: `docs/ui.md`, `docs/uat.md`
  - Scope: **S**

### Checkpoint 3 (ปิดรอบ)
- [ ] `pytest` เขียวทั้งชุด · `npx tsc --noEmit` สะอาด · `npm run lint` ≤ 18
- [ ] `npm run test:e2e` และ `npm run test:e2e:demo` ผ่านทั้งคู่
- [ ] `npm run build` + `npm run build:demo` ผ่านทั้งคู่
- [ ] `grep -rn "osaStatusOf\|>= 90 ?" frontend/src` → เหลือเฉพาะใน `lib/osa.ts`
- [ ] review กับเจ้าของงาน · ยังไม่ commit จนกว่าจะผ่าน review
