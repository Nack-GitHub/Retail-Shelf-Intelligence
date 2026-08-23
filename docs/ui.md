# UX Flow Spec & UI Generation Prompt

## ShelfEye — Shelf Gap Detection & Replenishment Alert (Candidate 1)

**เอกสารนี้มี 2 ส่วน:** (1) UX Flow Specification สำหรับอ่านทำความเข้าใจและใช้ในการนำเสนอ (2) Prompt สำหรับสั่ง AI UI Tool ให้สร้างหน้าจอ

---

# ส่วนที่ 1: UX Flow Specification

## 1.1 หลักการออกแบบ (Design Principles)

| หลักการ                            | เหตุผลที่มาจาก Business Case                                                                                         |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| **Speed over completeness**        | คุณค่าของระบบอยู่ที่ "พนักงานยังยืนอยู่หน้าชั้นวางตอนได้รับผลลัพธ์" — ถ้าผลออกช้ากว่า 10 วินาที มูลค่าหายไปเกินครึ่ง |
| **One-thumb, one-hand**            | พนักงานถือมือถือมือเดียว อีกมือถือของ/ดันรถเข็น ปุ่มหลักต้องอยู่ครึ่งล่างของจอ                                       |
| **Offline-first**                  | ร้านโชห่วยหลายแห่งสัญญาณแย่ ต้องถ่ายและคิวงานไว้ได้ แล้ว sync ทีหลัง                                                 |
| **Human verify, not human bypass** | ปุ่ม "ไม่ใช่" ต้องเข้าถึงง่ายเท่ากับปุ่ม "ยืนยัน" — ห้ามออกแบบให้การยอมรับ AI ง่ายกว่าการคัดค้าน                     |
| **No individual scoring anywhere** | ไม่มีหน้าจอไหนแสดงคะแนน/อันดับรายบุคคล เพื่อไม่ให้เครื่องมือช่วยงานกลายเป็นเครื่องมือลงโทษ                           |
| **Evidence-first**                 | ทุกตัวเลขในแดชบอร์ดต้องกดเข้าไปดูภาพต้นทางได้ภายใน 2 คลิก                                                            |

## 1.2 ผู้ใช้ 3 กลุ่ม (Actors)

| Actor                                   | อุปกรณ์      | สิ่งที่ต้องการภายใน 5 วินาทีแรกที่เปิดแอป            |
| :-------------------------------------- | :----------- | :--------------------------------------------------- |
| **Field Rep** (พนักงานขาย/Merchandiser) | Mobile       | "วันนี้ต้องไปร้านไหน และตอนนี้ต้องทำอะไรที่ร้านนี้"  |
| **Area Manager**                        | Web / Tablet | "พื้นที่ของฉัน OSA เท่าไร ร้านไหนแย่สุด"             |
| **Data / Product Owner**                | Web          | "โมเดลยังแม่นอยู่ไหม อัตราการตีกลับสูงขึ้นหรือเปล่า" |

## 1.3 End-to-End Flow

```
╔═ PHASE 0: PLAN ══════════════════════════════════════════════╗
  S1 Login → S2 Today's Route (ร้านเรียงตามระยะทาง+ความเสี่ยง)
      ↓ เลือกร้าน
  S3 Store Check-in  ── GPS verify + ยืนยันว่าได้รับอนุญาตให้ถ่ายภาพ
╚══════════════════════════════════════════════════════════════╝
                            ↓
╔═ PHASE 1: CAPTURE ═══════════════════════════════════════════╗
  S4 เลือกหมวด/ชั้นวางที่จะตรวจ (เช่น กาแฟ / นม / ขนม)
      ↓
  S5 Camera + Guide Overlay
      ├─ กรอบนำถ่าย + ตัววัดความเอียง (tilt) + ระยะห่างที่แนะนำ
      ├─ Real-time warning: "ภาพเบลอ" / "แสงน้อย" / "ถ่ายไม่ครบชั้น"
      └─ On-device face blur → แสดง chip "🔒 เบลอใบหน้าแล้ว 2 จุด"
      ↓
  S6 Preview → [ถ่ายใหม่] หรือ [ใช้ภาพนี้]
╚══════════════════════════════════════════════════════════════╝
                            ↓
╔═ PHASE 2: PROCESS ═══════════════════════════════════════════╗
  S7 Processing (เป้าหมาย < 10 วินาที)
      ├─ มีเน็ต    → ส่ง server inference
      └─ ไม่มีเน็ต → รันโมเดลบนเครื่อง (โหมดเร็ว) + เข้าคิว sync
╚══════════════════════════════════════════════════════════════╝
                            ↓
╔═ PHASE 3: RESULT & VERIFY  ★ หัวใจของระบบ ═══════════════════╗
  S8 Result Overlay
      ├─ ภาพชั้นวาง + กล่องสี: 🟢 มีสินค้า  🟡 เกือบหมด  🔴 ช่องว่าง
      ├─ Summary card: OSA 78% | ช่องว่าง 6 จุด | สถานะ ⚠️ Low
      └─ กล่องที่ confidence ต่ำ → เส้นประ + ป้าย "ต้องตรวจสอบ"
      ↓
  S9 Verify Gaps (ทีละจุด หรือ bulk)
      ├─ [✓ ใช่ ขาดจริง]  → เข้า Task List
      └─ [✗ ไม่ใช่]       → เลือกเหตุผล (มีของแต่ถูกบัง / ไม่ใช่สินค้าเรา / อื่นๆ)
                            → บันทึกเข้า Feedback Queue เพื่อ retrain
╚══════════════════════════════════════════════════════════════╝
                            ↓
╔═ PHASE 4: ACTION  ★ จุดที่เกิดมูลค่าจริง ════════════════════╗
  S10 Task List "ต้องทำที่ร้านนี้" (เรียงตามความสำคัญของ SKU)
      ├─ [เติมของแล้ว] → S11 ถ่ายภาพ After → เทียบ Before/After → ปิดงาน
      └─ [เติมไม่ได้]  → เลือกเหตุผล: ของหมดหลังร้าน / ร้านไม่อนุญาต / ยกเลิกขาย
                        → ถ้า "ของหมดหลังร้าน" → ส่ง Replenishment Request
      ↓
  S12 Check-out Summary: OSA ก่อน → หลัง | เวลาที่ใช้ | งานที่ค้าง
╚══════════════════════════════════════════════════════════════╝
                            ↓
╔═ PHASE 5: MANAGE (Web) ══════════════════════════════════════╗
  W1 Dashboard: OSA รายพื้นที่ + เทรนด์ + ร้านเสี่ยงสูงสุด 10 อันดับ
  W2 Store Detail: ประวัติ OSA ของร้าน + SKU ที่ขาดซ้ำ ๆ
  W3 Evidence Viewer: ภาพ + เวลา + พิกัด (สำหรับทีมเจรจา)
  W4 Route Planning: จัดลำดับร้านสัปดาห์หน้าตามความเสี่ยง (ระดับร้าน)
╚══════════════════════════════════════════════════════════════╝
                            ↓
╔═ PHASE 6: FEEDBACK LOOP (Back office) ═══════════════════════╗
  W5 Model Health: mAP/Recall ปัจจุบัน | Override Rate | Drift Alert
  W6 Relabel Queue: ภาพ confidence ต่ำ + ภาพที่ถูกตีกลับ → retrain
                            ↓  (วนกลับไปปรับปรุงโมเดลที่ใช้ใน Phase 2)
╚══════════════════════════════════════════════════════════════╝
```

## 1.4 Screen Inventory

### Mobile (Field Rep)

| ID  | Screen                  | สถานะที่ต้องออกแบบ (States)                   |
| :-- | :---------------------- | :-------------------------------------------- |
| S1  | Login                   | default / error / offline                     |
| S2  | Today's Route           | มีร้าน / ไม่มีร้าน / กำลัง sync               |
| S3  | Store Check-in          | ก่อนเช็คอิน / GPS ไม่ตรง / เช็คอินแล้ว        |
| S4  | Select Category & Shelf | —                                             |
| S5  | Camera Capture          | พร้อมถ่าย / เตือนคุณภาพ / กำลังเบลอใบหน้า     |
| S6  | Photo Preview           | —                                             |
| S7  | Processing              | กำลังประมวลผล / ล้มเหลว → retry / โหมดออฟไลน์ |
| S8  | Result Overlay          | ปกติ / low confidence / ไม่พบชั้นวางในภาพ     |
| S9  | Verify Gap              | ยังไม่ยืนยัน / ยืนยันแล้ว / ตีกลับแล้ว        |
| S10 | Action Task List        | มีงาน / ไม่มีงาน (OSA 100%)                   |
| S11 | After Photo & Compare   | —                                             |
| S12 | Check-out Summary       | —                                             |
| S13 | Offline Sync Queue      | รอ sync / sync สำเร็จ / sync ล้มเหลว          |

### Web (Manager & Data Team)

| ID  | Screen          | องค์ประกอบหลัก                                             |
| :-- | :-------------- | :--------------------------------------------------------- |
| W1  | Area Dashboard  | OSA gauge, trend line, ตารางร้านเสี่ยงสูง, filter ช่วงเวลา |
| W2  | Store Detail    | timeline การเข้าร้าน, SKU ที่ขาดซ้ำ, before/after          |
| W3  | Evidence Viewer | ภาพขนาดใหญ่ + metadata + ปุ่ม export                       |
| W4  | Route Planning  | รายชื่อร้านเรียงตามความเสี่ยง + ปุ่มอนุมัติเส้นทาง         |
| W5  | Model Health    | metric cards, drift chart, override rate                   |
| W6  | Relabel Queue   | grid ภาพรอตรวจ + ปุ่มส่งเข้า retrain                       |

## 1.5 Guardrails ที่ต้องบังคับผ่าน UI

1. **หน้า S3** ต้องมี checkbox "ได้รับอนุญาตจากร้านให้ถ่ายภาพแล้ว" — ถ้าไม่ติ๊ก กล้องเปิดไม่ได้
2. **หน้า S5** ต้องแสดง chip ยืนยันว่าเบลอใบหน้าเรียบร้อยก่อนอัปโหลดเสมอ (PDPA transparency)
3. **หน้า S9** ปุ่ม "ไม่ใช่" ต้องมีขนาดและน้ำหนักทางสายตาเท่ากับปุ่ม "ใช่"
4. **W1–W4** ห้ามมี leaderboard หรือคะแนนรายบุคคลของพนักงานเด็ดขาด
5. **W1** ทุกตัวเลขต้องกดเข้าไปเห็นภาพหลักฐานได้ และต้องมีปุ่ม "โต้แย้งผลนี้"
6. **ห้ามมี** ปุ่มใดที่ให้ระบบส่งข้อความหรือดำเนินการกับร้านค้าโดยอัตโนมัติ

---

# ส่วนที่ 2: Prompt สำหรับสั่ง UI

> **หมายเหตุ:** เขียน prompt เป็นภาษาอังกฤษเพราะ AI UI tool (v0, Figma Make, Claude Design, Lovable) ให้ผลลัพธ์ดีกว่า แต่ระบุชัดว่า **UI copy ทั้งหมดต้องเป็นภาษาไทย** พร้อมแนบ string ไทยไว้ให้แล้ว

## 2.1 Master Prompt (ใช้เปิดงาน — สร้าง Design System + Mobile Flow)

```
You are a senior product designer. Design a mobile-first field-force
application called "ShelfEye" for FMCG sales representatives in Thailand.

## CONTEXT
Sales reps visit retail stores, photograph product shelves with their phone,
and an on-device computer-vision model detects empty gaps on the shelf.
The rep must be able to see the result and fix the shelf WHILE STILL
STANDING IN FRONT OF IT. Speed and one-handed operation are everything.

## USERS
- Primary: Field sales rep, age 25–45, uses the app 15–40 times per day,
  often one-handed, in bright or dim store lighting, sometimes offline.
- Secondary: Area manager on desktop web.

## DESIGN SYSTEM
- Style: clean utility software, not consumer-playful. High contrast for
  bright store lighting. Generous 48px+ tap targets. Bottom-anchored
  primary actions (thumb zone).
- Typography: Noto Sans Thai / IBM Plex Sans Thai. Base 16px, never below 14px.
- Color tokens:
    --bg:        #FFFFFF
    --surface:   #F5F7FA
    --text:      #101828
    --muted:     #667085
    --primary:   #1B6FE8   (brand blue, actions)
    --ok:        #12B76A   (product detected / in stock)
    --warn:      #F79009   (almost empty)
    --danger:    #D92D20   (gap / out of stock)
    --uncertain: #667085   (low confidence — dashed border)
- Radius 12px, subtle shadows only, no gradients, no glassmorphism.
- ALL user-facing text must be in THAI (strings provided below).

## SCREENS TO DESIGN (mobile, 390x844)

1. TODAY'S ROUTE — list of stores to visit today. Each card shows store name,
   distance, last OSA %, and a risk badge (สูง/กลาง/ต่ำ). Sticky header with
   date and a sync-status indicator. Empty state included.

2. STORE CHECK-IN — store name, map snippet, GPS match indicator
   ("อยู่ในพื้นที่ร้าน ✓"), and a MANDATORY checkbox
   "ได้รับอนุญาตจากร้านให้ถ่ายภาพแล้ว". The primary button
   "เริ่มตรวจชั้นวาง" stays disabled until the checkbox is ticked.

3. CAMERA CAPTURE — full-bleed camera view with:
   - a translucent framing guide rectangle
   - a tilt/level indicator at the edge
   - a real-time quality banner at top that can show one of:
     "ภาพเบลอ ถือให้นิ่ง" / "แสงน้อยเกินไป" / "ถ่ายให้เห็นชั้นวางทั้งชั้น"
   - a small privacy chip bottom-left: "🔒 เบลอใบหน้าอัตโนมัติ"
   - large shutter button, gallery thumbnail strip of shots already taken

4. PROCESSING — lightweight full-screen state with a progress ring,
   elapsed seconds counter, and text "กำลังวิเคราะห์ชั้นวาง...".
   Include an offline variant: "ไม่มีสัญญาณ — วิเคราะห์บนเครื่อง".

5. RESULT OVERLAY  ★ HERO SCREEN ★
   - The shelf photo fills the top 55% with detection boxes drawn on it:
     green = product, amber = almost empty, red = gap,
     grey dashed = low confidence.
   - Below it a summary card: a big OSA percentage (e.g. "OSA 78%"),
     a status pill (ปกติ / ⚠️ ต่ำ / 🔴 วิกฤต), and counts
     "ช่องว่าง 6 จุด · เกือบหมด 3 จุด".
   - A horizontally scrollable chip row to filter which boxes are highlighted.
   - Bottom bar: primary "ตรวจสอบทีละจุด", secondary "ถ่ายใหม่".

6. VERIFY GAP — one detected gap at a time: zoomed crop of that region,
   its position label ("ชั้นที่ 2 · ตำแหน่งซ้าย"), confidence bar, and
   TWO EQUALLY WEIGHTED buttons side by side:
   "✓ ใช่ ขาดจริง"  and  "✗ ไม่ใช่".
   Tapping "ไม่ใช่" opens a bottom sheet with reasons:
   "มีของแต่ถูกบัง" / "ไม่ใช่สินค้าของเรา" / "เป็นพื้นที่ว่างปกติ" / "อื่น ๆ".
   Show a progress indicator "จุดที่ 3 จาก 6".
   ⚠️ CRITICAL: the two buttons must have identical size and visual weight.
   Do NOT make the confirm button more prominent than the reject button.

7. ACTION TASK LIST — checklist of confirmed gaps to fix, sorted by
   SKU priority. Each row: SKU thumbnail, name, shelf position, and a
   swipe/tap action. Two outcomes per task:
   "เติมของแล้ว" (→ asks for an after-photo) or
   "เติมไม่ได้" (→ bottom sheet: "ของหมดหลังร้าน" / "ร้านไม่อนุญาต" /
   "ร้านเลิกขายสินค้านี้").

8. BEFORE / AFTER COMPARE — side-by-side or slider comparison of the two
   photos with the OSA delta shown prominently: "OSA 78% → 96%".

9. CHECK-OUT SUMMARY — time spent in store, gaps found, gaps fixed,
   items escalated to supply chain, and a primary button "ไปร้านถัดไป".

10. OFFLINE SYNC QUEUE — list of pending uploads with per-item status
    (รอส่ง / กำลังส่ง / ส่งไม่สำเร็จ) and a "ส่งทั้งหมด" button.

## HARD CONSTRAINTS — DO NOT VIOLATE
- NEVER show any per-person score, ranking, leaderboard, or performance
  rating for the sales rep anywhere in the app. Scores exist only at
  STORE and AREA level.
- The reject button in Verify Gap must never be visually de-emphasized.
- Every AI result must be traceable back to the source photo.
- No dark patterns, no gamification badges, no streaks.

## DELIVERABLE
Produce all 10 screens with realistic Thai content (no lorem ipsum),
plus the primary interaction states listed for each screen.
```

## 2.2 Follow-up Prompt A — Web Dashboard

```
Now design the desktop web companion (1440x900) for the Area Manager,
using the exact same design tokens and Thai-language copy.

1. AREA DASHBOARD — top row of KPI cards: OSA เฉลี่ย (%),
   เวลาเฉลี่ยจากตรวจพบถึงเติมของสำเร็จ, จำนวนร้านที่ตรวจสัปดาห์นี้,
   ต้นทุนต่อการตรวจหนึ่งร้าน. Below: an OSA trend line chart over 12 weeks,
   and a table "ร้านที่ต้องเข้าดูแลก่อน" with columns
   ร้าน / OSA / จำนวน SKU ที่ขาดซ้ำ / ตรวจครั้งล่าสุด / ระดับความเสี่ยง.
   Every row is clickable through to store detail.

2. STORE DETAIL — store header, OSA history sparkline, a heatmap of which
   SKUs go out of stock most often by day of week, and a photo evidence
   timeline. Include a visible "โต้แย้งผลนี้" button on every finding.

3. EVIDENCE VIEWER — a modal with the full-resolution photo, detection
   overlay toggle, metadata panel (ร้าน / วันเวลา / พิกัด / ผู้ถ่าย-role only,
   not a performance rating), and an export-to-PDF action for negotiation use.

4. MODEL HEALTH — cards for Recall ของคลาส empty, Precision,
   อัตราการตีกลับจากพนักงาน (%), and a drift chart over time with a
   threshold line. Include an alert banner state when drift exceeds threshold.

Same hard constraint: no individual-level performance metrics for reps.
```

## 2.3 Follow-up Prompt B — สั่งทำ Flow Diagram (ถ้าต้องการภาพ flow สำหรับสไลด์)

```
Create a clean end-to-end user flow diagram for the ShelfEye app,
formatted for a presentation slide (16:9, light background).

Show 6 horizontal swimlanes labelled in Thai:
วางแผน → ถ่ายภาพ → ประมวลผล → ตรวจสอบผล → ลงมือแก้ไข → สรุปผล

Nodes to include in order:
เลือกร้าน → เช็คอิน+ขออนุญาต → ถ่ายภาพชั้นวาง → เบลอใบหน้าบนเครื่อง →
วิเคราะห์ด้วย AI → แสดงผล OSA + จุดที่ขาด → พนักงานยืนยัน/ตีกลับ →
รายการงานที่ต้องทำ → เติมของ + ถ่ายภาพ After → เช็คเอาต์ →
แดชบอร์ดผู้จัดการ

Use three distinct node styles and add a legend:
- solid blue = automated by AI
- outlined = human action
- amber dashed = human decision point / override

Add a dotted feedback arrow from "พนักงานยืนยัน/ตีกลับ" looping back to
"วิเคราะห์ด้วย AI" labelled "ข้อมูลตีกลับ → เทรนโมเดลใหม่".

Keep it minimal: no icons-heavy clutter, max 2 accent colors,
readable when projected.
```

## 2.4 เคล็ดลับการใช้ prompt เหล่านี้

| สถานการณ์                           | วิธีใช้                                                                                                                  |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **UI ออกมาสวยแต่ไม่ตรง flow**       | ส่ง Master Prompt ทีละหน้าจอ แทนที่จะส่งทั้ง 10 หน้าพร้อมกัน                                                             |
| **ตัวหนังสือไทยเพี้ยน/ตกขอบ**       | เพิ่มบรรทัด `Thai text is 15–20% wider than English — allow text wrapping and do not fix container heights.`             |
| **AI ทำปุ่ม "ไม่ใช่" เล็กกว่าเสมอ** | เป็นอคติของโมเดลที่มักเน้น primary action — ต้องย้ำซ้ำ และตรวจทุกครั้งก่อนรับงาน                                         |
| **ต้องการ prototype กดได้จริง**     | เพิ่มท้าย prompt: `Build this as a working React prototype with mock data and clickable navigation between all screens.` |
