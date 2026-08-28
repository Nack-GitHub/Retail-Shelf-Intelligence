# Implementation Plan: UAT Readiness — ถอด Demo Scaffolding ออกจาก ShelfEye

ขอบเขต: `frontend/` เป็นหลัก + `backend/.env*` และ seed · อ้างอิงผลสแกน 24 รายการ
· Guardrails: [docs/ui.md](../docs/ui.md) §1.5

> ⚠️ ไฟล์นี้เขียนทับแผนของรอบ "Navigation & Camera Lifecycle" ที่เสร็จแล้ว
> ของเดิมกู้ได้ที่ `git show fa6fb25:tasks/plan.md` และ `git show fa6fb25:tasks/todo.md`
> **ควร archive ไป `docs/archive/nav-and-camera/` เมื่อเช็คลิสต์มือถือจริงใน
> [SPEC.md](../SPEC.md) §8 ผ่านครบ** — ตอนนี้ยังไม่ผ่าน จึงยังไม่ย้าย

---

## Overview

แอปถูกสร้างเป็น demo ก่อน แล้วค่อยต่อ API จริงทีหลัง ผลคือมี scaffolding ของยุค demo
ค้างอยู่ 3 ประเภทที่ปนกัน และ **ต้องแยกวิธีจัดการคนละแบบ**:

| ประเภท | คืออะไร | ทำอย่างไร |
| :-- | :-- | :-- |
| **A — เครื่องมือสาธิต** | ของที่ตั้งใจทำให้ reviewer เดินดูได้ (StateSwitcher, บัญชีด่วน, หน้า `/`) | **gate** หลัง flag ไม่ลบ |
| **B — คำโกหก** | UI ที่พูดไม่ตรงกับสิ่งที่ระบบทำ (ตัวเลขปลอม, ปุ่มตาย, คำสัญญาความเป็นส่วนตัว) | **แก้** ผิดทั้งใน demo และ UAT |
| **C — ต้องตัดสินใจ** | face blur, ML client, ผู้ถ่ายใน evidence | **ถามเจ้าของงานก่อน** |

หัวใจของแผนคือ **อย่ารวบ A กับ B เป็นงานเดียวกัน** — การซ่อน B ไว้หลัง flag คือการ
เก็บคำโกหกไว้ในโหมด demo ซึ่งเป็นโหมดที่เอาไปโชว์ลูกค้า

งานเรียงแบบ vertical slice: แต่ละ task จบด้วยแอปที่ build ผ่าน E2E เขียว และมี test
คุมสิ่งที่เพิ่งแก้

---

## Architecture Decisions

### AD1 — flag เดียว `NEXT_PUBLIC_DEMO_MODE` และต้อง **หายไปจาก bundle** ไม่ใช่แค่ซ่อน

สร้าง `src/lib/demo.ts`:

```ts
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
```

Next.js inline ค่า `NEXT_PUBLIC_*` ตอน build ดังนั้น `{DEMO_MODE && <StateSwitcher/>}`
จะถูก dead-code elimination ตัดทิ้งทั้งก้อนใน build ที่ไม่ได้ตั้ง flag

**ทำไมต้องหายจริง ไม่ใช่แค่ `hidden`:** StateSwitcher บังคับหน้าจอ "ไม่พบชั้นวาง" และ
"GPS ไม่ตรง" ได้ ถ้ามันยังอยู่ใน bundle ใครก็ตามที่เปิด devtools บน UAT ก็ปลอมหน้าจอ
เหล่านั้นได้ — และหน้า `NO_SHELF` ที่ [result/page.tsx:58](../frontend/src/app/m/store/%5Bid%5D/result/page.tsx#L58)
**ไม่มีทางเข้าถึงด้วยวิธีอื่นเลย** มันมีอยู่เพื่อสวิตช์นี้อย่างเดียว

**Default = OFF.** build ที่ไม่ตั้งอะไรเลยคือ build ที่ปลอดภัย ต้องออกแรงเพื่อได้ demo
ไม่ใช่ต้องออกแรงเพื่อได้ของจริง

### AD2 — คำโกหก (ประเภท B) แก้ตรง ๆ ไม่แตะ flag

`Math.random()` ที่ขับมาตรวัดระดับกล้อง ผิดพอ ๆ กันในงาน demo — reviewer ที่เอียงมือถือ
แล้วเห็นตัวเลของศาไม่ขยับตามคือคนที่จับได้ว่าทั้งจอเป็นของปลอม เช่นเดียวกับปุ่ม
"ส่งออกรายงาน" ที่กดแล้วเงียบ

กฎ: **ถ้าเอาออกจากโหมด demo แล้ว demo ยังน่าเชื่อขึ้น = แก้ ไม่ใช่ gate**

### AD3 — ของที่ยังไม่มีจริง ให้ UI พูดว่ายังไม่มี

มี 3 ทางเลือกเสมอ: (1) ทำให้เสร็จ (2) เอา UI ออก (3) ให้ UI บอกตรง ๆ ว่ายังไม่มี
ทางที่ห้ามคือ (4) ปล่อยให้ UI พูดว่ามีแล้ว หน้า relabel ทำถูกอยู่แล้วที่
[relabel/page.tsx:155](../frontend/src/app/w/relabel/page.tsx#L155) — ใช้เป็นแบบ

### AD4 — E2E รันด้วย demo OFF และเพิ่ม suite ที่พิสูจน์ว่ามันหายจริง

39 test เดิมไม่ได้พึ่ง StateSwitcher เลย (ตรวจแล้ว) และ `loginThroughForm` กรอกฟอร์มเอง
ไม่ได้กดปุ่มบัญชีด่วน จึงไม่พังเมื่อปิด flag เพิ่ม `e2e/demo-off.spec.ts` ที่ยืนยันว่า
affordance ทุกตัว **ไม่มีอยู่ใน DOM** และเพิ่ม project `chromium-demo` ที่รันด้วย flag เปิด
เพื่อกันไม่ให้โหมด demo พังเงียบ ๆ

### AD5 — ไม่เปลี่ยนชื่อ `useDemo` → out of scope

`useDemo` / `DemoState` ถือ state ของ visit จริง (visitId, findings, tasks จาก server)
ชื่อมันตกยุคแต่**ไม่ใช่ demo artifact** การเปลี่ยนชื่อแตะ 13 ไฟล์ 82 จุด โดยผู้ใช้ไม่เห็น
อะไรต่างเลย และทำให้ diff ของงานนี้อ่านไม่ออกว่าอะไรคือการแก้จริง — แยกไปทำรอบหลัง

### AD6 — ตัวเลข hardcode ที่ "ประเมินไว้" ให้ลบทิ้ง ไม่ใช่หาค่าที่ดีกว่า

`MINUTES_PER_STORE = 22` มีของจริงอยู่แล้ว: `avgVisitMinutes` ที่ API ส่งมาให้หน้า
วางแผนเส้นทาง ([analytics.ts:95](../frontend/src/lib/api/analytics.ts#L95)) และหน้านั้น
จัดการ null ถูกต้องแล้วด้วยการเขียนว่า "จาก N/M ร้านที่มีข้อมูล" ใช้แพตเทิร์นเดียวกัน
ส่วน `bay ?? "A2"` ไม่ต้องหาค่า default — ถ้าไม่มี bay แปลว่า flow ผิด ให้ guard จัดการ

---

## Dependency Graph

```
T1 face blur (ตัดสินใจ)  ──┐
T3 secrets ────────────────┼──► ไม่ขึ้นกับใคร ทำขนานได้
T2 privacy copy ───────────┘        │
                                    │ (T2 ต้องรู้ผล T1 ก่อนเขียนคำ)
T4 lib/demo.ts + login ──┬──► T5 StateSwitcher
                         ├──► T6 shell chrome
                         └──► T7 capture log
                                    │
T8 tilt ─┬── T9 quality banner ─────┤  (แตะไฟล์ capture/page.tsx ร่วมกัน → เรียงกัน)
T10 placeholder shelf ──────────────┤
T11 hardcoded estimates ────────────┤
T12/13/14 dead controls ────────────┤  (คนละไฟล์ ขนานได้)
                                    ▼
                              T15 cleanup ──► T16 UAT verification
```

**ขนานได้:** T3 กับ T4 · T12/T13/T14 · T10 กับ T11
**ต้องเรียง:** T4 ก่อน T5–T7 (ทุกตัวใช้ `DEMO_MODE`) · T8 ก่อน T9 (ไฟล์เดียวกัน)
**บล็อกทุกอย่าง:** Checkpoint 0 — ถ้ายังไม่ตอบเรื่อง face blur กับ ML client
งานที่เหลือทำได้แต่ปล่อยขึ้น UAT ไม่ได้

---

## Task List

### Phase 0: ตัดสินใจ (ไม่มีโค้ด)

- [ ] **Checkpoint 0** — 3 คำถามที่ต้องตอบก่อน (ดู §Open Questions)

### Phase 1: Truthfulness blockers — ทำก่อนเพราะเสี่ยงสุดและอาจล้มแผน

- [ ] Task 1: ตัดสินใจและลงมือเรื่อง on-device face blur
- [ ] Task 2: แก้คำสัญญาความเป็นส่วนตัวที่ไม่ตรงกับพฤติกรรมจริง
- [ ] Task 3: ถอด secret และบัญชี seed ออกจากเส้นทางขึ้น UAT

### Checkpoint 1: Legal / security
- [ ] ไม่มีจอไหนอ้างว่าเบลอใบหน้าถ้าโค้ดยังไม่เบลอ
- [ ] ไม่มีจอไหนอ้างว่า "ภาพไม่ออกจากเครื่อง" ถ้ามันอัปโหลด
- [ ] `JWT_SECRET` ของ UAT ไม่ใช่ค่าที่อยู่ใน git
- [ ] **review กับเจ้าของงานก่อนไป Phase 2**

### Phase 2: Demo mode infrastructure + gating (ประเภท A)

- [ ] Task 4: `lib/demo.ts` + gate แผงบัญชีสาธิตในหน้า login
- [ ] Task 5: gate StateSwitcher ทั้ง 6 จุด
- [ ] Task 6: gate shell chrome — หน้า `/`, กรอบมือถือ, ป้าย demo
- [ ] Task 7: gate หน้า `/m/captures` (capture log)

### Checkpoint 2: Demo mode
- [ ] `NEXT_PUBLIC_DEMO_MODE=1 npm run build` → เห็น affordance ครบเหมือนเดิม
- [ ] `npm run build` (ไม่ตั้ง flag) → grep bundle ไม่เจอ "สาธิตสถานะหน้าจอ"
- [ ] E2E 39 ตัวเดิมเขียวทั้งสองโหมด

### Phase 3: ตัวเลขและภาพที่ประดิษฐ์ขึ้น (ประเภท B)

- [ ] Task 8: เอามาตรวัดระดับกล้องที่สุ่มด้วย `Math.random()` ออก
- [ ] Task 9: เอาแบนเนอร์เตือนคุณภาพภาพที่วนข้อความออก
- [ ] Task 10: จำกัดขอบเขตชั้นวางที่วาดขึ้น + ตัดภาพ "หลัง" ปลอมในหน้าเทียบ
- [ ] Task 11: ลบตัวเลขประเมินที่ hardcode

### Checkpoint 3: ไม่มีตัวเลขปลอม
- [ ] `grep -rn "Math.random" frontend/src/app` ไม่เหลือจุดที่ป้อนค่าให้ UI
- [ ] เดิน flow บนเครื่องที่ไม่มีกล้อง → ไม่เห็นภาพชั้นวางที่อ้างว่าเป็นภาพถ่าย

### Phase 4: ปุ่มที่ไม่ทำอะไร (ประเภท B)

- [ ] Task 12: ปุ่ม "ส่งออกรายงาน"
- [ ] Task 13: ปุ่ม "อนุมัติเส้นทางนี้" + การจัดลำดับที่ไม่ถูกบันทึก
- [ ] Task 14: ทบทวน disclaimer ของคิว relabel สำหรับ UAT

### Checkpoint 4: ไม่มีปุ่มตาย
- [ ] ทุกปุ่มใน `/w/**` มี handler หรือมีคำอธิบายว่ายังไม่พร้อม

### Phase 5: ปิดงาน

- [ ] Task 15: ลบ dead code และคอมเมนต์ที่ตกยุค
- [ ] Task 16: UAT verification pass

### Checkpoint 5: พร้อมขึ้น UAT
- [ ] เช็คลิสต์ §UAT Gate ผ่านครบ

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| :-- | :-- | :-- |
| **ไม่มีโมเดลเวอร์ชันไหนผ่าน promotion gate เลย** — ตัวที่ดีสุด `yolo26l-960` ได้ recall 0.74 (ต้อง ≥0.90), precision 0.75 (ต้อง ≥0.85) | **สูงมาก** | นี่คือ Open Question #2 UAT จะรันบนโมเดลที่สอบตกเกณฑ์ตัวเอง หรือรันบน mock ที่ปลอม 100% — ต้องเลือกและต้องบอก UAT tester ให้รู้ตัว หน้า model-health โชว์แบนเนอร์แดงอยู่แล้วซึ่งเป็นเรื่องดี **ห้ามปิดแบนเนอร์นั้น** |
| ปิด demo mode แล้ว UAT tester ติดตรงที่เคยกดข้ามด้วย StateSwitcher | กลาง | ก่อน Phase 2 จบ ต้องมี UAT script ที่บอกวิธีสร้างสถานะจริง (ถ่ายภาพเบลอจริง / ยืนนอกพิกัดร้าน) — เขียนใน T16 |
| ตัด `MINUTES_PER_STORE` แล้วหัวหน้าจอเส้นทางว่างเปล่า | ต่ำ | ใช้แพตเทิร์นเดียวกับหน้า route planning ที่จัดการ null ถูกแล้ว |
| แก้ face blur ให้ทำงานจริงบานปลาย (ต้องมี detector ใน browser) | สูง | T1 ตั้งใจให้ทางเลือก "แก้คำพูด" เป็น default — การ implement เป็นงานคนละรอบ |
| เขียนทับ `tasks/plan.md` ของรอบก่อนที่ยังรอ review §8 | ต่ำ | committed ที่ fa6fb25 กู้ได้ · archive เมื่อ §8 ผ่าน |
| Dead-code elimination ไม่ตัดจริงตามที่คาด | กลาง | Checkpoint 2 บังคับ grep ใน `.next/static` เป็นการพิสูจน์ ไม่ใช่ความเชื่อ |

---

## Open Questions — ต้องตอบก่อน Checkpoint 0 ผ่าน

### ✅ Q1 — On-device face blur — **ตอบแล้ว: ไม่ทำ → ทาง (ก) แก้คำพูด**

> ตัดสินใจ 2026-08-28: ไม่ implement face blur ในรอบนี้ ดังนั้น **ทุกข้อความที่อ้างว่า
> เบลอใบหน้าต้องถูกเอาออก** — การไม่ทำโดยที่ยังโฆษณาว่าทำคือทาง (ค) ซึ่งเป็นทางที่แย่ที่สุด
> `faceBlur.method: "NOT_WIRED"` ในชั้นข้อมูลไม่ต้องแก้ มันพูดความจริงอยู่แล้ว
> [docs/ui.md](../docs/ui.md) §1.5 ข้อ 2 ต้องถูกทำเครื่องหมายว่า **ยังไม่ทำ** ไม่ใช่ลบทิ้ง

<details><summary>บริบทเดิมของคำถาม</summary>

[docs/ui.md](../docs/ui.md) §1.5 ข้อ 2 บอกว่าเป็น guardrail ระดับสเปก
("หน้า S5 ต้องแสดง chip ยืนยันว่าเบลอใบหน้าเรียบร้อยก่อนอัปโหลดเสมอ — PDPA
transparency") แต่ [capture.ts:154](../frontend/src/lib/capture.ts#L154) เขียนว่า
`method: "NOT_WIRED"` และ [SPEC.md](../SPEC.md) §1.4 ตัดออกนอกขอบเขตรอบที่แล้ว

ตอนนี้ [app/page.tsx:107](../frontend/src/app/page.tsx#L107) โฆษณาว่าทำแล้ว

- **(ก) แก้คำพูด** — เอาข้อโฆษณาออก และให้หน้า capture บอกตรง ๆ ว่ายังไม่เบลอ
  อัตโนมัติ ผู้ถ่ายต้องเลี่ยงไม่ให้ติดหน้าคน · เล็ก · **แนะนำสำหรับ UAT**
- **(ข) implement** — ต้องเลือก detector ที่รันใน browser ได้ เป็นงานคนละรอบ
- **(ค) ปล่อยไว้** — ❌ ถ้า UAT ถ่ายในร้านจริงที่มีลูกค้าอยู่ในเฟรม นี่คือความเสี่ยง PDPA
  บวกกับเอกสารที่อ้างว่าคุ้มครองแล้ว

</details>

**ผลที่ตามมาที่ต้องบอก UAT tester:** ภาพที่ถ่ายในร้านจะขึ้นระบบโดยไม่มีการเบลอหน้าคน
ต้องมีคำแนะนำให้ผู้ถ่ายเลี่ยงไม่ให้ติดลูกค้าในเฟรม (เขียนใน `docs/uat.md` — T16)

### ✅ Q2 — `ML_CLIENT` — **ตอบแล้ว: `http` + `yolo26l-960`**

> ตัดสินใจ 2026-08-28: ใช้ `shelf-product-yolo26l-960` ไปก่อน เทรนใหม่รอบหน้า
>
> โมเดลนี้ผ่าน gate เดียวจากสาม: mAP@0.5 = 0.9065 ✅ · recall ช่องว่าง = 0.7422 ❌ (ต้อง ≥0.90)
> · precision ช่องว่าง = 0.7480 ❌ (ต้อง ≥0.85)
>
> แปลเป็นภาษาคน: **ช่องว่างจริงประมาณ 1 ใน 4 จะตรวจไม่เจอ** และ **สิ่งที่แจ้งว่าเป็นช่องว่าง
> ประมาณ 1 ใน 4 จะไม่ใช่** UAT tester ต้องรู้ตัวเลขสองตัวนี้ก่อนเริ่มทดสอบ ไม่งั้นจะแจ้งเป็น
> bug รายจุดนับร้อยใบ ทั้งที่เป็นข้อจำกัดที่รู้อยู่แล้วของโมเดลรุ่นนี้
>
> **ห้ามปิดแบนเนอร์แดง** ในหน้า model-health ที่บอกว่าเกณฑ์ยังไม่ผ่าน — มันกำลังพูดความจริง
> และเป็นสิ่งเดียวในระบบที่บอกเรื่องนี้กับผู้ใช้
>
> สิ่งที่ UAT รอบนี้ทดสอบได้: UX ทั้ง flow, การอัปโหลด, offline queue, การยืนยัน/ตีกลับผล,
> checkout, dashboard **สิ่งที่ทดสอบไม่ได้: ความแม่นของโมเดล**

<details><summary>บริบทเดิมของคำถาม</summary>

`backend/.env` ตั้ง `http` แต่ `docs/archive/README.md` เขียนว่า *"records the
promotion gates the trained model fails, which is why `ML_CLIENT` stays on mock"*
— เอกสารกับ env ขัดกัน และ artifact ทั้ง 3 ตัวสอบตก

- **(ก) `http` + โมเดล yolo26l-960** — ตรวจจับจากภาพจริง แต่ต่ำกว่าเกณฑ์ที่ตั้งเอง
  UAT ต้องรู้ว่ากำลังทดสอบ UX ไม่ใช่ความแม่นของโมเดล · **แนะนำ**
- **(ข) `mock`** — ❌ detection ผูกกับ*ชื่อไฟล์* ไม่ได้ดูภาพเลย ผลคือ UAT ที่ทดสอบ
  อะไรไม่ได้เลยนอกจากปุ่ม
- ไม่ว่าเลือกอะไร: `.env.example` ที่ยังเขียน `ML_CLIENT=mock` ต้องแก้ (T3)

</details>

**ผลที่ตามมา:** `.env.example` ต้องตั้ง `ML_CLIENT=http` (T3) · docker-compose ต้องรัน
profile `real-ml` · `docs/archive/README.md` ที่เขียนว่า *"which is why ML_CLIENT stays on
mock"* ตกยุคแล้ว ต้องแก้ (T15)

### ✅ Q3 — "ผู้ถ่าย: พนักงานภาคสนาม" — **ตอบแล้ว: ทาง (ก) คงพฤติกรรมไว้**

> ตัดสินใจ 2026-08-28: ไม่แก้โค้ด · เพิ่มบรรทัดใน `docs/uat.md` (T16) ว่าการแสดง
> "ผู้ถ่าย" เป็นบทบาทไม่ใช่ชื่อ คือ**ข้อกำหนดตาม [docs/ui.md](../docs/ui.md) §1.5 ข้อ 4
> ไม่ใช่ข้อมูลขาด** — tester ไม่ต้องแจ้งเป็น defect

[EvidenceViewer.tsx:226](../frontend/src/components/web/EvidenceViewer.tsx#L226)
hardcode ไว้ ซึ่ง**ตั้งใจ** — [docs/ui.md](../docs/ui.md) §1.5 ข้อ 4 ห้ามผูกตัวเลขกับ
พนักงานรายคน และ backend มี `test_prohibitions.py` บังคับไว้

คำถามคือ UAT reviewer จะอ่านว่าเป็น bug หรือไม่ — เสนอให้คงพฤติกรรมไว้ (ห้ามแก้)
แต่เพิ่มบรรทัดในเอกสาร UAT ว่านี่คือข้อกำหนด ไม่ใช่ข้อมูลขาด

---

## UAT Gate — เช็คลิสต์สุดท้าย

```
□ npm run build ไม่ตั้ง flag → grep -r "demo1234" .next/static            → ไม่พบ
□ npm run build ไม่ตั้ง flag → grep -r "shelfeye.demo" .next/static       → ไม่พบ
□ npm run build ไม่ตั้ง flag → grep -r "โหมดสาธิต" .next/static           → ไม่พบ
□ npm run build ไม่ตั้ง flag → grep -r "NEXT_PUBLIC_DEMO_MODE" .next/static → ไม่พบ
   (เงื่อนไขทุกจุดถูก fold เป็นค่าคงที่ — ที่เหลือเป็นโมดูลที่ไม่มีใครเรียก ไม่ใช่ปุ่มที่กดได้)
□ npm run test:e2e (demo off)                                            → เขียวครบ
□ npm run test:e2e --project=chromium-demo (demo on)                     → เขียวครบ
□ npx tsc --noEmit                                                       → สะอาด
□ npm run lint                                                           → ไม่มี error ใหม่
□ JWT_SECRET ของ UAT ไม่ตรงกับค่าใน git
□ ไม่ได้ seed บัญชี @shelfeye.demo ลงฐานข้อมูล UAT (หรือเปลี่ยนรหัสแล้ว)
□ ML_CLIENT ที่ UAT รัน = ค่าที่ตอบใน Q2 และ tester รับทราบข้อจำกัดของโมเดล
□ เดิน flow S1→S12 บนมือถือจริง 1 รอบ โดยไม่แตะ devtools → จบได้
□ ค้างจากรอบก่อน: เช็คลิสต์มือถือจริง SPEC.md §8 (bfcache / iOS camera)
```

---

## นอกขอบเขตรอบนี้

- เปลี่ยนชื่อ `useDemo` / `DemoState` (AD5)
- implement face blur จริง (ถ้า Q1 ตอบ (ก))
- เทรนโมเดลใหม่ให้ผ่าน promotion gate
- ทำ endpoint จริงให้ export report / route approval / relabel — รอบนี้แค่ทำให้ UI
  พูดตรงกับความจริงว่ายังไม่มี
- `/w/**` นอกเหนือจากรายการที่ระบุใน T12–T14
