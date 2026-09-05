# แผนยกระดับ Recall ของคลาส `Empty Shelf` (YOLO26l) ให้ถึง 0.90+

> เอกสารวิเคราะห์ + ชุดทางเลือกให้ตัดสินใจ
> อ้างอิงจากไฟล์จริงใน repo ณ commit `f0faaa5` — วิเคราะห์เมื่อ 2026-09-04
> รันจริงที่ `model/artifacts/shelf-product-yolo26l-960/`

---

## 0. สรุปผู้บริหาร (อ่านแค่ส่วนนี้ก็พอ)

| สิ่งที่ตรวจพบ | ผลกระทบต่อ recall | ระดับความมั่นใจ |
|---|---|---|
| **Test set เล็กเกินกว่าจะวัด gate 0.90 ได้** (Empty Shelf แค่ 124 กล่อง) | วัดผิด/ตัดสินใจผิด | ★★★ ยืนยันแล้ว |
| **เทรนโดย `val: false`** → `patience: 25` ไม่ทำงาน, `best.pt` = epoch สุดท้าย ไม่ใช่ epoch ที่ดีที่สุด | −0.02 ถึง −0.08 | ★★★ ยืนยันแล้ว |
| **ภาพถูก Roboflow ย่อเป็น 640×640 แบบ "Stretch" มาแล้ว** แต่เทรนที่ `imgsz: 960` | เสีย compute 2.25× ฟรี + aspect บิดเบี้ยว | ★★★ ยืนยันแล้ว |
| **Label ของ Empty Shelf ไม่นิ่ง** — 17% เป็น polygon, ขนาดกล่องแกว่งจาก 47px ถึงเกือบเต็มภาพ | −0.05 ถึง −0.15 | ★★☆ หลักฐานแรง |
| **Class imbalance** — Empty Shelf 3.79% ของกล่องทั้งหมด | น้อยมาก (ไม่ใช่ต้นเหตุ) | ★★★ ยืนยันแล้ว |
| **ยังไม่ได้จูน operating point (conf threshold) แยกรายคลาส** | ได้ +0.05–0.12 แบบ "ฟรี" | ★★☆ |

**คำตอบสั้น ๆ ต่อ 3 คำถามของคุณ**

1. **Cross validation / split 60-20-20?** → **ต้องแก้ split แน่นอน แต่ไม่ใช่ 60-20-20** — แนะนำ **70/15/15 แบบ stratified ตามจำนวน gap ต่อภาพ** และทำ **5-fold CV เฉพาะตอนตัดสินใจ** (ไม่ใช่ทุกการทดลอง เพราะแพง 5 เท่า) เหตุผลอยู่ใน §2.1
2. **แก้ imbalance?** → **ไม่ใช่ต้นเหตุหลัก อย่าเสียเวลากับ focal loss / oversampling เป็นอย่างแรก** Empty Shelf เป็นคลาสที่ **มีข้อมูลมากเป็นอันดับ 4 จาก 45 คลาส** และคลาสที่ข้อมูลน้อยกว่า 5 เท่ายังได้ recall 1.0 ปัญหาคือ **ความยาก + label noise** ไม่ใช่ **ความถี่** เหตุผลใน §2.2
3. **จูน training?** → **ใช่ และมีของที่ให้ผลชัดโดยไม่ต้องเดา** เรียงตาม ROI ใน §2.3 + §4

**เส้นทางที่ผมแนะนำ:** Track A (ครึ่งวัน, ไม่ต้องเทรนใหม่) → Track B (เทรนใหม่ 1 รอบ) → ถ้ายังไม่ถึง 0.90 ให้ไป Track C (แก้ label) ซึ่ง ROI สูงสุดแต่ใช้แรงคนมากที่สุด ดู §4

---

## 1. สถานะปัจจุบัน (ตัวเลขจริง)

### 1.1 ผลลัพธ์โมเดล — `metrics.json` (split = test, imgsz 960)

```
overall   mAP@50 0.9065   mAP@50-95 0.7404   P 0.8715   R 0.9042
Empty Shelf   P 0.7480   R 0.7422   mAP@50 0.7473     ← ตัวที่ตกทั้งสอง gate

gates:
  [FAIL] recall_empty_shelf      0.7422 vs >= 0.90
  [FAIL] precision_empty_shelf   0.7480 vs >= 0.85
  [PASS] map50_overall           0.9065 vs >= 0.85
```

จุดที่ต้องสังเกต: **overall recall = 0.9042 แต่ Empty Shelf = 0.7422** ห่างกัน 0.16
แปลว่าโมเดลไม่ได้ "เทรนไม่พอ" โดยรวม — มันเก่งกับ SKU แต่ **แพ้เฉพาะคลาสนี้คลาสเดียว**
นี่เป็นหลักฐานสำคัญว่าต้นเหตุอยู่ที่ *นิยาม/คุณภาพของคลาสนี้* ไม่ใช่ที่ capacity ของโมเดลหรือจำนวน epoch

### 1.2 Dataset (นับจากไฟล์ label จริง)

| split | images | boxes | Empty Shelf boxes | % ของกล่องทั้งหมด | ภาพที่มี gap อย่างน้อย 1 |
|---|---|---|---|---|---|
| train | 1,146 | 44,617 | **1,691** | 3.79% | 574 (50.1%) |
| valid | 137 | 5,274 | **205** | 3.89% | 72 (52.6%) |
| test | 66 | 2,627 | **124** | 4.72% | 36 (54.5%) |

- อัตราส่วน split ปัจจุบัน ≈ **85 / 10 / 5** (ไม่ใช่ 70/20/10 ตามที่มักเข้าใจ)
- ตรวจ leakage แล้ว: ชื่อไฟล์ base **ไม่ซ้ำข้าม split เลย** (train∩valid = 0, train∩test = 0) ✅
- train ทั้ง 1,146 ภาพเป็นภาพต้นฉบับ ไม่มี Roboflow augmentation ซ้ำ ✅ (ดี — ไม่มี leakage จาก augment)
- ความหนาแน่น: median 42 กล่อง/ภาพ, max 99 → `max_det: 300` **ไม่ตัดอะไรทิ้ง** ✅ (ตัดข้อสงสัยนี้ออกได้)
- กล่อง Empty Shelf ซ้อนทับกันเอง IoU>0.1 แค่ 0.2% → **NMS `iou: 0.7` ไม่ใช่ปัญหา** ✅

### 1.3 เรขาคณิตของกล่อง `Empty Shelf`

วัดเป็น `sqrt(area)` ที่สเกล 960px:

| split | p10 | median | p90 | max (สัดส่วนพื้นที่ภาพ) | % ที่เป็น "small object" (<32px) |
|---|---|---|---|---|---|
| train | 47px | 75px | **389px** | 0.879 | 0.4% |
| test | 42px | 71px | **471px** | 0.483 | 0.8% |

**อ่านตารางนี้ให้ออก:** ปัญหา **ไม่ใช่ small object** (มีแค่ 0.4%) แต่เป็น **scale variance มหาศาล** — p90 ใหญ่กว่า p10 ถึง **8 เท่า** และกล่องใหญ่สุดกินพื้นที่เกือบทั้งภาพ

กล่องที่กิน 88% ของภาพแปลว่า annotator บางคนตีกรอบ **ทั้งชั้นวางที่ว่าง** เป็นกล่องเดียว ในขณะที่ median 75px คือ **ช่องว่างขนาดเท่ากล่องกาแฟใบเดียว** → **นิยามของคลาสไม่นิ่ง** ซึ่งเป็นสาเหตุอันดับหนึ่งของ recall ต่ำในงาน gap detection

Aspect ratio (w/h): p10 = 0.40, median = 0.68, p90 = 1.49 — แกว่ง 3.7 เท่า ยืนยันภาพเดียวกัน

---

## 2. วินิจฉัยเชิงลึก — เรียงตามผลกระทบ

### 2.1 [ต้นเหตุ #1] Test set เล็กเกินกว่าจะ "รู้" ว่าผ่าน gate หรือยัง

Empty Shelf ใน test มี **124 instances**

Wilson 95% CI:

| ค่าที่วัดได้ | n | ช่วงความเชื่อมั่น 95% |
|---|---|---|
| recall = 0.7422 | 124 | **0.659 – 0.811** |
| recall = 0.90 (สมมติทำได้) | 124 | 0.835 – 0.941 |
| recall = 0.90 | 329 (valid+test) | 0.863 – 0.928 |
| recall = 0.90 | 2,020 (ทุก fold รวมกัน) | **0.886 – 0.912** |

จำนวน instance ที่ต้องมีเพื่อวัด recall 0.90 ให้แม่น:
- ±0.05 → ต้องมี **138** instances (ตอนนี้มี 124 — เฉียดฉิว)
- ±0.03 → ต้องมี **384** instances (ตอนนี้ขาดอยู่ **3 เท่า**)

**หลักฐานยืนยันเพิ่มเติมว่า test เล็กเกินไป** — ดู per-class ใน `metrics.json`:
- `Espresso SArt`: P = 1.0, R = **0.0**, mAP@50 = **0.995** ← ตัวเลขชุดนี้เป็นไปไม่ได้ในทางสถิติถ้า n ใหญ่พอ (มี GT แค่ **2 กล่อง** ใน test)
- `Espresso MArt`: P = 0.29, R = 1.0, mAP@50 = 0.33 (มี GT **1 กล่อง**)

> **บทสรุป:** ตอนนี้คุณกำลังจูนโมเดลโดยดูมาตรวัดที่มี noise ±0.08
> ถ้าเทรนใหม่แล้ว recall ขยับจาก 0.74 → 0.81 คุณ**ไม่สามารถบอกได้**ว่าดีขึ้นจริงหรือแค่โชคดี
> **ต้องแก้เรื่องนี้ก่อนทำอย่างอื่น** ไม่งั้นทุกการทดลองต่อจากนี้เชื่อถือไม่ได้

**ตอบคำถามข้อ 1 เรื่อง 60/20/20 โดยตรง:**

60/20/20 จะให้ test ≈ 270 ภาพ ≈ 490 gap instances → CI แคบลงเหลือ ±0.026 ✅
**แต่** จะเหลือ train แค่ ~810 ภาพ (ลดจาก 1,146 = **−29%**) ซึ่งอันตรายเพราะคลาสหางยาวอย่าง `Espresso SArt` มี 47 กล่องใน train อยู่แล้ว ตัด 29% เหลือ ~33 → คลาสนั้นพังแน่นอน

| ทางเลือก split | train img | test gap inst. | CI ครึ่งช่วง | ความเห็น |
|---|---|---|---|---|
| ปัจจุบัน 85/10/5 | 1,146 | 124 | ±0.077 | ❌ วัดไม่ได้ |
| **70/15/15 (แนะนำ)** | 944 | ~300 | ±0.034 | ✅ สมดุลที่สุด |
| 60/20/20 | 810 | ~400 | ±0.029 | ⚠️ วัดดีขึ้นแต่ train หด 29% |
| **5-fold CV (แนะนำสำหรับตัดสินใจ)** | 1,079/fold | 2,020 รวม | **±0.013** | ✅ แม่นสุด แต่แพง 5× |

**สิ่งที่ผมแนะนำจริง ๆ: ใช้ทั้งสองแบบ แต่คนละหน้าที่**
- **ระหว่างทดลอง (จูน hyperparameter):** ใช้ 70/15/15 แบบ **stratified ตามจำนวน gap ต่อภาพ** (bin: 0 gap / 1–2 / 3–5 / 6+) — ถูกและเร็ว รันได้วันละหลายรอบ
- **ตอนจะ promote โมเดลขึ้น production:** รัน **5-fold CV** ครั้งเดียว → ได้ recall เฉลี่ย ± SD ข้าม fold ซึ่งเป็นตัวเลขที่กล้าเอาไปคุยกับ stakeholder ได้จริง และ **SD ข้าม fold จะบอกคุณด้วยว่า dataset นี้ noisy แค่ไหน** (ถ้า SD > 0.05 แปลว่าปัญหาอยู่ที่ label ไม่ใช่โมเดล — ดู §2.4)

⚠️ **สำคัญมาก:** เวลา re-split ต้องแบ่งด้วย **group key = ร้าน + วันที่ถ่าย** ไม่ใช่สุ่มระดับภาพ
ชื่อไฟล์เป็นรูปแบบ `20052618_Depotbesuch_REWE-Hamburg-Kieler-Strasse-101_Raja-Kumar_Nachher-Foto_220945.jpg`
→ ภาพจากชั้นวางเดียวกัน/ร้านเดียวกัน/รอบเดียวกัน มีหลายรูปและ **คล้ายกันมาก**
ถ้าสุ่มระดับภาพ ภาพชั้นเดียวกันจะไปอยู่ทั้ง train และ test → **recall ที่วัดได้จะสูงเกินจริง**
Roboflow split เดิมอาจมีปัญหานี้อยู่แล้ว (ตรวจไม่ได้จากชื่อไฟล์อย่างเดียว) — **ต้องแบ่งด้วย `GroupKFold` เท่านั้น**

---

### 2.2 [ตอบคำถามข้อ 2] Imbalance — **ไม่ใช่ต้นเหตุ อย่าเพิ่งไปแก้**

ข้อมูลจริงจาก train split:

| อันดับ | คลาส | จำนวนกล่อง | recall บน test |
|---|---|---|---|
| 1 | Price | 8,517 | 0.964 |
| 2 | Discount Price | 3,613 | 0.969 |
| 3 | FM Gemahlen | 2,704 | 0.979 |
| **4** | **Empty Shelf** | **1,691** | **0.742** ⚠️ |
| … | … | … | … |
| 42 | AB Bohne | 314 | **1.000** |
| 44 | Espresso MArt | 114 | 1.000 |
| 45 | Espresso SArt | 47 | 0.000 (n=2, ไม่มีความหมาย) |

**อ่านตารางนี้:**
- Empty Shelf มีข้อมูล **มากเป็นอันดับ 4 จาก 45 คลาส** — มากกว่าค่ามัธยฐานของ dataset หลายเท่า
- `AB Bohne` มีข้อมูล **น้อยกว่า Empty Shelf 5.4 เท่า** แต่ recall = **1.000**
- ไม่มีคลาสไหนเลยที่มี 0 กล่องในทุก split ✅

> **ข้อสรุป: ถ้า imbalance เป็นต้นเหตุ AB Bohne (314 กล่อง) ต้องแย่กว่า Empty Shelf (1,691 กล่อง)**
> **แต่มันได้ recall 1.0 → สมมติฐาน imbalance ตกไป**

**สิ่งที่เป็นต้นเหตุจริง ๆ คือ "ความยากของคลาส" (hard class) ไม่ใช่ "ความหายากของคลาส" (rare class)**

ทำไม Empty Shelf ถึงยากกว่า SKU ทุกตัว:

| SKU (เช่น AB Bohne) | Empty Shelf |
|---|---|
| มี texture, สี, โลโก้ ชัดเจน | เป็น **negative space** — ไม่มี texture ของตัวเอง |
| ขอบเขตกล่องชัด = ขอบซองกาแฟ | ขอบเขตคือ "ที่ที่ไม่มีของ" ซึ่งกำหนดโดย**บริบทรอบข้าง**เท่านั้น |
| ขนาดคงที่ (ซองกาแฟขนาดเดียว) | ขนาดแกว่ง **8 เท่า** (p10 47px → p90 389px) |
| นิยามไม่กำกวม | "ช่องว่าง 1 ช่อง" กับ "ทั้งชั้นว่าง" นับยังไง? ขึ้นกับคนตีกรอบ |
| แยกจาก background ง่าย | **หน้าตาเหมือน background** (ผนังชั้น, ตะแกรง, เงา) |

**เทคนิคแก้ imbalance ที่ *ควร* ใช้ (และที่ *ไม่ควร*)**

| เทคนิค | ควรใช้? | เหตุผล |
|---|---|---|
| Oversample ภาพที่มี gap | ❌ ไม่ | 50.1% ของภาพ train มี gap อยู่แล้ว — oversample แทบไม่เปลี่ยนอะไร แถมทำให้ over-fit ภาพเดิม |
| Focal loss / class weight | ⚠️ ทีหลัง | Ultralytics ไม่มี per-class weight ในตัว ต้องแก้ `v8DetectionLoss` — แรงเยอะ ผลน้อย ลองเป็นอันท้าย ๆ |
| เพิ่ม `cls` loss gain (0.5 → 0.7–1.0) | ✅ ลองได้ | ถูกและเร็ว บังคับให้โมเดลสนใจ classification มากขึ้นเทียบกับ localization |
| **Copy-paste augmentation ของ gap** | ✅✅ **ควรลอง** | สังเคราะห์ gap เพิ่มโดยแปะ patch "ชั้นว่าง" ทับตำแหน่งที่มีสินค้า — เพิ่ม instance จริงโดยไม่ต้องถ่ายรูปใหม่ ตรงกับปัญหาที่สุด |
| **แยกเป็น binary gap detector ต่างหาก** | ✅✅ **ควรลอง** | ตัดปัญหา imbalance ทิ้งทั้งหมด (2 คลาส แทน 45) ดู Track D |
| Mosaic (มีอยู่แล้ว = 1.0) | ✅ คงไว้ | ช่วย scale variance ซึ่งเป็นปัญหาจริงของคลาสนี้ |

---

### 2.3 [ต้นเหตุ #2] การตั้งค่าเทรนที่ผิดพลาดชัดเจน — แก้ได้ทันที

#### (ก) `val: false` ทำให้ไม่มี model selection เลย ⚠️ **นี่คือบั๊กที่ต้องแก้ก่อนอย่างอื่น**

`model/configs/yolo26l-960.yaml`:
```yaml
patience: 25
val: false     # ← ตัวปัญหา
```

หลักฐานจาก `artifacts/shelf-product-yolo26l-960/results.csv` — คอลัมน์ metric **เป็น 0 ทุกแถวยกเว้นแถวสุดท้าย**:
```
96,8250.13,0.77334,0.32672,0.00311,0,0,0,0,0,0,0,...
97,8320.16,0.77081,0.32343,0.00299,0,0,0,0,0,0,0,...
98,8390.15,0.77009,0.33275,0.00309,0,0,0,0,0,0,0,...
99,8460.59,0.77139,0.32876,0.00299,0,0,0,0,0,0,0,...
100,8540.24,0.77097,0.33735,0.00303,0.89354,0.91343,0.90826,0.73939,...   ← มี metric แค่แถวนี้
```

ผลที่ตามมา:
1. **`patience: 25` ไม่ทำงานเลย** — early stopping ต้องใช้ validation fitness ที่ไม่เคยถูกคำนวณ
2. **`best.pt` = epoch สุดท้าย (epoch 100)** ไม่ใช่ epoch ที่ generalize ดีที่สุด — คุณอาจมีโมเดลที่ดีกว่านี้อยู่ที่ epoch 60–80 แต่มันถูกทับไปแล้ว
3. **มองไม่เห็น overfitting** — จาก results.csv, `box_loss` ราบที่ ~0.771 ตั้งแต่ epoch 96 และ LR ลดเหลือ 4e-6 → โมเดลหยุดเรียนไปแล้วหลาย epoch แต่ยังเทรนต่อจนครบ 100 (เสียเวลาฟรี ~20 นาที และเสี่ยง memorize)

comment ใน `train.py` อธิบายว่าปิด val เพราะ NMS ช้า (193 วิ/iteration):
```python
# Per-epoch validation is disabled deliberately. An early-epoch model
# emits a flood of low-confidence boxes across 45 classes, and NMS at
# the validation confidence floor (0.001) then costs MORE than the
# training epoch itself...
```
**เหตุผลนี้ถูกต้อง แต่ทางแก้ผิด** ปัญหา NMS ระเบิดเกิดเฉพาะ **epoch ต้น ๆ** เท่านั้น พอ epoch ~10 โมเดลเริ่มมั่นใจ NMS ก็เร็วปกติ

ทางแก้ที่ถูก — เลือกอย่างใดอย่างหนึ่ง:
- **ทางที่ดีที่สุด:** ใช้ callback เปิด val หลัง epoch 15 (โค้ดใน §6.1)
- **ทางที่ง่ายที่สุด:** `val: true` + ยกพื้น conf ตอน val (`conf: 0.01` แทน 0.001) → NMS เร็วขึ้น 10–50 เท่า, mAP เพี้ยนนิดเดียวแต่ยังใช้จัดอันดับ epoch ได้ถูก
- **ทางที่หยาบแต่ได้ผล:** `val: true` + `fraction` ของ valid หรือใช้ `save_period: 10` แล้วมา validate ทีหลังทีละ checkpoint

#### (ข) เทรนที่ 960px ทั้งที่ต้นทางเป็น 640×640 — เสีย compute ฟรี 2.25 เท่า

`data/README.roboflow.txt` ระบุชัด:
```
The following pre-processing was applied to each image:
* Auto-orientation of pixel data (with EXIF-orientation stripping)
* Resize to 640x640 (Stretch)
```

ตรวจไฟล์จริง (สุ่ม 300 ภาพจาก train) → **ทุกภาพเป็น 640×640 ทั้งหมด 100%**

ผลที่ตามมา 2 ข้อ:

1. **`imgsz: 960` คือการ upscale 640 → 960 ด้วย interpolation** ไม่มี pixel ใหม่เกิดขึ้น ได้แค่ค่า compute × 2.25 (8,540 วินาที ≈ 2.4 ชม. สำหรับ 100 epoch) โดย**ไม่มีข้อมูลเพิ่ม** — งบก้อนนี้เอาไปทำอย่างอื่นคุ้มกว่ามาก
   *(ข้อยกเว้น: การ upscale ยังช่วยได้บ้างเพราะเพิ่มความละเอียดของ feature map / stride ที่มีต่อวัตถุ แต่ผลน้อยกว่าการมี pixel จริงมาก)*

2. **"Stretch" ทำให้ aspect ratio บิดเบี้ยว** ← อันนี้ร้ายกว่า
   ภาพชั้นวางจากมือถือมักเป็น 4:3 หรือ 3:4 การบีบเป็น 1:1 ทำให้สัดส่วนภาพเปลี่ยนไม่เท่ากันในแต่ละภาพ
   คลาสที่พึ่ง **texture** (SKU) ทนต่อการบิดนี้ได้ดี — โลโก้บิดนิดหน่อยยังจำได้
   แต่คลาสที่พึ่ง **geometry ล้วน ๆ** อย่าง Empty Shelf ("สี่เหลี่ยมว่างระหว่างสินค้า") **โดนเต็ม ๆ** เพราะสัดส่วนคือ signal เกือบทั้งหมดที่มันมี
   → อธิบายได้ว่าทำไม aspect ratio ของ GT ถึงแกว่ง 3.7 เท่า (p10 0.40 → p90 1.49)

**ทางแก้ ROI สูงสุดข้อเดียว:** re-export dataset จาก Roboflow ใหม่ด้วย
- `Resize: Fit within 1280×1280` (letterbox, **ไม่ใช่ stretch**) หรือ
- `Resize: None` (ส่งภาพต้นฉบับ แล้วให้ Ultralytics letterbox เอง — ดีที่สุด)

annotation ทั้งหมดยังใช้ได้เหมือนเดิมเพราะ YOLO format เก็บพิกัดแบบ normalized (0–1) — **ไม่ต้อง label ใหม่แม้แต่กล่องเดียว** นี่คือ "ของฟรี" ที่ใหญ่ที่สุดในเอกสารนี้

#### (ค) รายการ hyperparameter ที่ควรปรับ (พร้อมเหตุผล)

จาก `artifacts/shelf-product-yolo26l-960/args.yaml`:

| พารามิเตอร์ | ค่าปัจจุบัน | แนะนำ | เหตุผลเฉพาะกับ Empty Shelf |
|---|---|---|---|
| `val` | `false` | **`true`** (หลัง epoch 15) | ไม่งั้นไม่มี model selection เลย — **ข้อสำคัญที่สุด** |
| `imgsz` | 960 | **640** (จนกว่าจะ re-export) | ต้นทาง 640 อยู่แล้ว ประหยัด 2.25× เอาเวลาไปเทรนหลาย config แทน |
| `batch` | 4 | **8–16** | batch 4 ทำให้ BN statistics แกว่ง (`nbs=64` ชดเชยแค่ gradient ไม่ชดเชย BN) |
| `close_mosaic` | 10 | **20** | mosaic บิดบริบทของ "ช่องว่าง" — 20 epoch สุดท้ายบนภาพจริงช่วยให้ localize gap แม่นขึ้น |
| `scale` | 0.4 | **0.5–0.6** | scale variance ของ gap สูง 8 เท่า → augment สเกลให้กว้างขึ้นตรงกับปัญหา |
| `multi_scale` | 0.0 | **0.5** | เหตุผลเดียวกัน — ให้โมเดลเห็น gap ทุกสเกล |
| `cls` (loss gain) | 0.5 | **0.7** | ดัน classification ให้แรงขึ้น (Empty Shelf แพ้ที่ classification ไม่ใช่ localization — ดูหลักฐาน §2.4) |
| `erasing` | 0.2 | **0.1** | ⚠️ random erasing **สร้าง "ช่องว่างปลอม" ที่ไม่มี label** → สอนโมเดลว่าช่องว่างบางอันไม่ใช่ gap = ทำร้าย recall โดยตรง |
| `mixup` | 0.0 | **0.0** (คงไว้) | mixup ทำให้ภาพชั้นวางซ้อนกันจนอ่านไม่ออก ไม่เหมาะกับงานนี้ |
| `copy_paste` | 0.0 | **0.1–0.3** (ถ้าเปลี่ยนเป็น seg dataset ได้) | ดู §2.2 — วิธีเพิ่ม gap instance ที่ตรงจุดที่สุด |
| `epochs` | 100 | **150 + patience 30** | เมื่อเปิด val แล้ว early stopping จะตัดเองตอนอิ่ม ไม่ต้องกลัวเทรนเกิน |
| `cos_lr` | false | **true** | LR ปลายทางลงนุ่มกว่า ช่วยให้ converge นิ่งขึ้นในรอบท้าย |

> 🔴 **`erasing: 0.2` คือสิ่งที่ผมสงสัยมากที่สุดในลิสต์นี้**
> comment ใน `train.py` บอกว่าใส่ไว้แทน "occlusion จากลูกค้า/รถเข็น" ซึ่งสมเหตุสมผลสำหรับ SKU
> แต่สำหรับคลาส `Empty Shelf` มันคือการ **สร้างพื้นที่ว่างสี่เหลี่ยมขึ้นมาแบบสุ่มโดยไม่มี label**
> โมเดลจึงถูกสอนว่า "สี่เหลี่ยมว่าง ๆ บนชั้น = background" ซึ่งตรงข้ามกับสิ่งที่เราต้องการเป๊ะ ๆ
> **การทดลองที่ถูกที่สุดและอาจให้ผลมากที่สุดคือ: ตั้ง `erasing: 0.0` แล้วเทรนใหม่ 1 รอบ**

---

### 2.4 [ต้นเหตุ #3] Label noise — ROI สูงสุด แต่ต้องใช้แรงคน

#### หลักฐาน (ก): 17% ของ label เป็น polygon ไม่ใช่ box

นับจากไฟล์ label จริง:

| split | box (5 fields) | polygon (>5 fields) | Empty Shelf ที่เป็น polygon |
|---|---|---|---|
| train | 36,693 | 7,924 (17.8%) | **286 / 1,691 (16.9%)** |
| test | 2,125 | 502 (19.1%) | **31 / 124 (25.0%)** |

Ultralytics เตือนเองตอน val:
```
WARNING ⚠️ Box and segment counts should be equal, but got len(segments) = 1503,
len(boxes) = 2627. ... To avoid this please supply either a detect or segment dataset
```

polygon ที่พบส่วนใหญ่เป็น `poly(11)` = 5 จุด = **quad ที่หมุน** ซึ่งเกิดจาก annotator ใช้เครื่องมือ polygon ตีกรอบชั้นวางที่ถ่ายเอียง

ปัญหา: การแปลง polygon เอียง → axis-aligned bbox ทำให้กล่อง **ใหญ่กว่าวัตถุจริงอย่างมีนัยสำคัญ** (quad เอียง 20° ทำให้ AABB โตขึ้น ~25–40% ของพื้นที่)
→ วัตถุประเภทเดียวกันมี GT box ขนาดต่างกันขึ้นกับ **เครื่องมือที่ annotator เลือกใช้**
→ ที่ IoU 0.5 การทำนายที่ "ถูกจริง" อาจถูกนับเป็น miss เพราะ GT พองผิดปกติ
→ **กินไปตรง ๆ จาก recall**

**หมายเหตุ:** `shelfeye_ml/training/prepare_dataset.py` มีฟังก์ชัน `sanitize_label_file()` ที่แปลง polygon → AABB อยู่แล้ว **แต่ไฟล์ label บนดิสก์ยังเป็น polygon อยู่** เพราะ `train.py` เรียก `prepare_dataset()` เฉพาะเมื่อ `data.yaml` ยังไม่มี:
```python
if not DATA_YAML.exists():
    prepare_dataset()
```
ผลลัพธ์สุดท้ายเหมือนกัน (Ultralytics ทำ AABB conversion เองด้วยสูตรเดียวกัน) จึงไม่ใช่บั๊กด้านตัวเลข — **แต่แปลว่า sanitizer ไม่ได้ช่วยแก้ปัญหาที่แท้จริง** เพราะปัญหาอยู่ที่ *ทำไมถึงมี polygon เอียงตั้งแต่แรก* ไม่ใช่ที่ format

#### หลักฐาน (ข): นิยามคลาสไม่นิ่ง

| | ค่า |
|---|---|
| กล่อง Empty Shelf ที่เล็กที่สุด | 0.00004 ของพื้นที่ภาพ (≈ 6px @960) |
| median | 0.0061 (≈ 75px) |
| p90 | 0.16+ (≈ 389px) |
| **ใหญ่ที่สุด** | **0.879 ของพื้นที่ภาพ** |

กล่องเดียวที่กิน 88% ของภาพ = annotator ตีกรอบ **"ชั้นว่างทั้งชั้น"** เป็นกล่องเดียว
ในขณะที่ median = **"ช่องว่างขนาดกล่องกาแฟ 1 ใบ"**

ทั้งสองอย่างนี้ถูก label เป็นคลาสเดียวกัน คือ `19: Empty Shelf`

**นี่คือปัญหา ill-defined class ไม่ใช่ปัญหาโมเดล** ไม่มีสถาปัตยกรรมไหนเรียนรู้ฟังก์ชันที่ input เดียวกันแมปไป output ต่างกันได้ ต่อให้เทรน 1,000 epoch ก็ตาม

#### หลักฐาน (ค): precision กับ recall ตกพร้อมกัน = สัญญาณของ label noise

```
Empty Shelf:  P 0.7480   R 0.7422   mAP@50 0.7473
```

ทั้งสามค่าเกาะกลุ่มกันที่ ~0.745 อย่างน่าสงสัย

- ถ้าโมเดล **"ระวังเกินไป"** → P สูง (0.9+), R ต่ำ → แก้ด้วยการลด threshold ก็จบ
- ถ้าโมเดล **"มั่วเกินไป"** → P ต่ำ, R สูง → แก้ด้วยการเพิ่ม threshold ก็จบ
- ถ้า **ทั้งคู่ตกเท่า ๆ กัน** → โมเดล *"ไม่รู้ว่าคำตอบที่ถูกคืออะไร"* — และนั่นแปลว่า **ตัว label เองไม่สอดคล้องกัน** ไม่ใช่ threshold ผิด

> เทียบกับคลาส SKU ที่สุขภาพดี: `Colombia BBBohne` P 0.937 / R 1.000 — ต่างกันชัดเจน

#### หลักฐาน (ง): กล่อง Empty Shelf **ไม่ค่อยซ้อนทับกัน** → ตัดสมมติฐาน NMS ทิ้ง

จากทั้ง dataset: Empty–Empty pairs ที่ IoU > 0.1 มีแค่ **0.2%** (7 จาก 2,848 คู่ ใน train)
→ NMS `iou: 0.7` **ไม่ได้กินกล่อง gap ที่อยู่ติดกันทิ้ง** — ตัดสมมติฐานนี้ออกได้ ✅
→ ยิ่งชี้กลับไปที่ label noise + ความยากของคลาสมากขึ้น

#### สิ่งที่ต้องทำ: เขียน Annotation Guideline แล้ว re-label

ตัวอย่าง guideline ที่ต้องตัดสินใจ (คุณต้องเลือกแล้ว fix ให้ตายตัว):

```
=== Empty Shelf — Annotation Guideline v1 ===

หน่วยของ 1 กล่อง = "1 facing slot ที่ควรมีสินค้าแต่ไม่มี"
   ✅ ชั้นว่าง 3 ช่องติดกัน → ตี 3 กล่อง (ไม่ใช่กล่องเดียว)
   ✅ ความสูงกล่อง = จากพื้นชั้นถึงใต้ชั้นถัดไป (ไม่ใช่แค่ส่วนที่เห็นว่าง)
   ✅ ความกว้าง = ความกว้างของ 1 facing ตาม planogram

ไม่ตีกรอบเมื่อ:
   ❌ ช่องว่างแคบกว่า 50% ของความกว้างสินค้า (= ช่องไฟระหว่างสินค้า ไม่ใช่ gap)
   ❌ พื้นที่นอกโซนสินค้า (ทางเดิน, พื้น, เพดาน, ชั้นที่ไม่ใช่ category นี้)
   ❌ ชั้นที่ถูกบังจนมองไม่เห็นว่ามีของหรือเปล่า → ข้ามภาพนั้นไปเลย

ใช้เครื่องมือ:
   ⚠️ ใช้ Bounding Box เท่านั้น — ห้ามใช้ Polygon tool
      (polygon เอียงถูกแปลงเป็น AABB ที่พองกว่าจริง 25–40%)
```

**วิธีตรวจว่า guideline ปัจจุบันแย่แค่ไหนก่อนลงแรง (ใช้เวลา 2 ชม.):**
สุ่ม 30 ภาพจาก train ที่มี gap ให้คน 2 คน label แยกกันโดยไม่เห็นกัน แล้ววัด **inter-annotator agreement** (mAP ของ annotator A เทียบ B เป็น GT)
- ถ้า agreement < 0.85 → **นี่คือ ceiling ของโมเดลคุณ** โมเดลจะเก่งกว่ามนุษย์ที่สร้าง label ไม่ได้ → ต้อง re-label เท่านั้น ไม่มีทางอื่น
- ถ้า agreement > 0.92 → label ไม่ใช่ปัญหาหลัก → ทุ่มไปที่ Track A/B แทน

**ผมเดาว่าจะได้ประมาณ 0.75–0.85** จากหลักฐาน ง/ค ข้างบน — และถ้าเป็นจริง **นี่คือคำอธิบายเกือบทั้งหมดของช่องว่าง 0.74 → 0.90**

---

### 2.5 [ต้นเหตุ #4] ยังไม่ได้เลือก operating point — ของฟรีที่ยังไม่ได้เก็บ

ตัวเลข `recall 0.7422` ใน `metrics.json` มาจาก `metrics.box.r` ของ Ultralytics ซึ่งเป็นค่าที่จุด **max-F1** — คือจุดที่ balance P กับ R เท่า ๆ กัน

**แต่ business logic ของโปรเจกต์นี้ระบุชัดว่าไม่ควร balance!** จาก `shelfeye_ml/eval/evaluate.py`:
```python
"""A MISSED GAP is lost revenue that can never be recovered — the rep has
already walked away. A FALSE ALARM costs a few seconds of their attention."""
```

ถ้า error ไม่สมมาตร **ก็ไม่ควรเลือกจุด max-F1** — ควรเลือกจุด **"conf ที่ต่ำที่สุดที่ยังรักษา precision ≥ 0.85"** แล้วอ่าน recall ตรงนั้น

สิ่งที่ต้องทำ (ครึ่งชั่วโมง ไม่ต้องเทรนใหม่):
1. ดึง `Recall|Confidence` และ `Precision|Confidence` curve ของ class 19 ออกมา (สคริปต์ใน §6.2)
2. หา conf ที่ให้ R ≥ 0.90 แล้วดูว่า P เหลือเท่าไหร่
3. ถ้า **R = 0.90 ไปไม่ถึงเลยไม่ว่า conf จะต่ำแค่ไหน** → ยืนยันว่าเป็นปัญหาโมเดล/data ต้องไป Track B/C
4. ถ้า **ถึงได้ แต่ P ตกเหลือ 0.5** → เป็นปัญหา precision ที่แก้ด้วย post-processing ได้ (เช่น กรอง gap ที่ไม่อยู่ในโซนชั้นวาง)

จากนั้น **ส่ง per-class threshold ไปกับ artifact** — โมเดลตัวเดียวใช้ conf ต่ำสำหรับ class 19 และ conf ปกติสำหรับ SKU:
```yaml
# เพิ่มใน class_map.yaml
inference:
  default_conf: 0.25
  per_class_conf:
    19: 0.10    # Empty Shelf — ปรับให้ recall เป็นหลักตามที่ evaluate.py ระบุ
```
วิธีนี้ต้องแก้แค่ `model/shelfeye_ml/serving/app.py` ไม่กี่บรรทัด และ **ไม่ต้องเทรนใหม่เลย**

⚠️ **ข้อควรระวังที่พบระหว่างวิเคราะห์:** `model/.venv` ติดตั้ง **ultralytics 8.3.40** แต่ `model/requirements.txt` ระบุ `ultralytics>=8.4.0`
8.3.40 ออกก่อน YOLO26 — เมื่อรัน `model.val()` ด้วย weights YOLO26 บน venv นี้จะได้ mAP@50 = 0.419 (แทนที่จะเป็น 0.9065 ที่บันทึกไว้) เพราะ postprocessing ไม่ตรงกับ end2end head
**ต้อง `pip install -U "ultralytics>=8.4.0"` ก่อนวัดอะไรก็ตาม** ไม่งั้นตัวเลขทั้งหมดใช้ไม่ได้

---

## 3. สรุปสมมติฐานทั้งหมด — ตัดออกไปแล้วอะไรบ้าง

| สมมติฐาน | สถานะ | หลักฐาน |
|---|---|---|
| Small object เกินไป | ❌ **ตัดออก** | มี small object แค่ 0.4% (median 75px @960) |
| `max_det: 300` ตัดกล่องทิ้ง | ❌ **ตัดออก** | สูงสุด 99 กล่อง/ภาพ |
| NMS `iou: 0.7` กิน gap ที่ติดกัน | ❌ **ตัดออก** | gap ซ้อนกัน IoU>0.1 แค่ 0.2% |
| Data leakage ทำให้ตัวเลขเพี้ยน | ❌ **ตัดออก** (ระดับชื่อไฟล์) | train∩valid = 0, train∩test = 0 |
| Class imbalance | ⚠️ **มีจริงแต่ไม่ใช่ต้นเหตุ** | อันดับ 4/45; คลาสที่น้อยกว่า 5 เท่าได้ R=1.0 |
| Model capacity ไม่พอ | ❌ **น่าจะตัดออก** | overall R = 0.904; แพ้เฉพาะคลาสเดียว |
| **Test set เล็กเกินไป** | ✅ **ยืนยัน** | n=124, CI ±0.077 |
| **`val: false` → ไม่มี model selection** | ✅ **ยืนยัน** | results.csv มี metric แค่แถวสุดท้าย |
| **imgsz 960 บนภาพ 640 (stretched)** | ✅ **ยืนยัน** | README.roboflow + ตรวจไฟล์จริง 300 ภาพ |
| **Label noise / นิยามคลาสไม่นิ่ง** | ✅ **หลักฐานแรง** | polygon 17%, ขนาดแกว่ง 8×, P≈R≈mAP≈0.745 |
| **`erasing: 0.2` สร้าง gap ปลอมไม่มี label** | ✅ **หลักฐานเชิงเหตุผล** | ต้องทดลองยืนยัน (ถูกและเร็ว) |
| **ยังไม่ได้จูน operating point** | ✅ **ยืนยัน** | ใช้ค่า max-F1 ทั้งที่ business ต้องการ recall-first |

---

## 4. ทางเลือก — เลือกได้ 4 Track

### 🅰️ Track A — เก็บของฟรี (ครึ่งวัน, ไม่ต้องเทรนใหม่)

| # | สิ่งที่ทำ | เวลา | คาดว่าได้ |
|---|---|---|---|
| A1 | อัป `ultralytics>=8.4.0` ใน venv ก่อน (ไม่งั้นวัดอะไรก็ผิด) | 10 นาที | — (บังคับ) |
| A2 | รวม valid+test เป็น eval set เดียว (329 gap instances) เพื่อลด noise ของมาตรวัด | 30 นาที | CI แคบลง 0.077 → 0.034 |
| A3 | หาจุด operating point ของ class 19 จาก PR curve แล้วตั้ง per-class conf | 1 ชม. | **+0.05 – 0.12 recall** |
| A4 | ลอง TTA ตอน inference (`model.val(augment=True)`) | 30 นาที | +0.01 – 0.03 (ช้าลง 3×) |
| A5 | สวีป `imgsz` ตอน inference (640 / 800 / 960 / 1280) | 1 ชม. | +0.00 – 0.03 |
| A6 | สวีป NMS `iou` (0.5 / 0.6 / 0.7) | 30 นาที | +0.00 – 0.01 |

**คาดการณ์:** recall 0.74 → **0.80–0.85** โดยแลกกับ precision ที่ตกลง
**ข้อดี:** ถูก เร็ว ไม่มีความเสี่ยง — และ **A3 จะบอกคุณทันทีว่าโมเดลตัวนี้มีเพดานที่เท่าไหร่**
**ข้อเสีย:** เกือบแน่นอนว่าไปไม่ถึง 0.90 และ precision จะตกต่ำกว่า gate 0.85

> **ทำ Track A ก่อนเสมอ** เพราะ A3 คือการทดลองที่ให้ข้อมูลมากที่สุดต่อเวลาที่ใช้:
> ถ้า max recall (ที่ conf → 0) **ยังไม่ถึง 0.90** แปลว่าโมเดลนี้ *ไม่เห็น* gap เหล่านั้นเลย ไม่ว่าจะปรับ threshold ยังไง → ต้องไป Track C แน่นอน

---

### 🅱️ Track B — จูน training ให้ถูกต้อง (1–2 วัน, เทรนใหม่ 2–3 รอบ)

**B0 (ต้องทำก่อน): เปิด validation กลับมา** — ไม่มีข้อนี้ ข้ออื่นวัดไม่ได้ทั้งหมด

**B1: Ablation ที่ถูกที่สุดและอาจได้ผลมากที่สุด — `erasing: 0.0`**
เทรน 1 รอบที่ 640px (ใช้เวลา ~1 ชม. แทน 2.4 ชม.) เปลี่ยนแค่ตัวแปรเดียว
ถ้า recall ของ Empty Shelf ขยับขึ้น = ยืนยันสมมติฐาน §2.3(ค)

**B2: config ใหม่แบบเต็ม** (ไฟล์พร้อมใช้ใน §6.3)
```yaml
run_name: shelf-product-yolo26l-640-recall
model: yolo26l.pt
imgsz: 640            # ตรงกับ resolution จริงของ dataset
epochs: 150
batch: 12
patience: 30
val: true             # ← สำคัญที่สุด
cos_lr: true
close_mosaic: 20
erasing: 0.0          # ← เลิกสร้าง gap ปลอม
scale: 0.6
multi_scale: 0.5
cls: 0.7
```

**B3: re-export dataset ที่ 1280 letterbox แล้วเทรนที่ 1024–1280**
ต้องเข้า Roboflow ไป export version ใหม่ — **ไม่ต้อง label ใหม่** เพราะพิกัดเป็น normalized
นี่คือการเพิ่ม "ข้อมูลจริง" ครั้งเดียวที่ไม่ต้องถ่ายรูปเพิ่ม

**คาดการณ์:** recall 0.74 → **0.82–0.88**
**ข้อดี:** แก้ปัญหาเชิงระบบ ทำให้ทุกการทดลองหลังจากนี้เชื่อถือได้
**ข้อเสีย:** ยังอาจไม่ถึง 0.90 ถ้า label noise เป็นตัวจำกัดจริงตามที่วิเคราะห์ไว้

---

### 🅲 Track C — แก้ dataset (3–7 วัน) — **ROI สูงสุด แต่ต้องใช้แรงคน**

| # | สิ่งที่ทำ | เวลา |
|---|---|---|
| C1 | วัด inter-annotator agreement บน 30 ภาพ (เพื่อรู้ ceiling ก่อนลงแรง) | 2 ชม. |
| C2 | เขียน Annotation Guideline v1 ให้ `Empty Shelf` (ร่างอยู่ใน §2.4) | 2 ชม. |
| C3 | Re-label เฉพาะ Empty Shelf ทั้ง 2,020 กล่อง ตาม guideline (ไม่ต้องแตะ 44 คลาสที่เหลือ) | 2–4 วัน |
| C4 | เปลี่ยน polygon → box ทั้งหมด, ห้ามใช้ polygon tool ต่อไป | รวมอยู่ใน C3 |
| C5 | Re-split **70/15/15 แบบ GroupKFold ตามร้าน+วันถ่าย** + stratify ตามจำนวน gap/ภาพ | 3 ชม. |
| C6 | เก็บภาพเพิ่มเน้นเคสยาก: ชั้นว่างทั้งชั้น, ว่างบางส่วน, มีเงา, ถ่ายเอียง | 1–2 วัน |

**คาดการณ์:** recall → **0.90–0.95** ✅
**ข้อดี:** เป็นทางเดียวที่แก้เพดานจริง และช่วยทุกโมเดลในอนาคตด้วย
**ข้อเสีย:** แพงที่สุดในแง่แรงคน, ต้องมีคนที่เข้าใจ retail domain มาตัดสินนิยาม

> ถ้า C1 ให้ agreement < 0.85 → **ข้าม Track A/B ไปทำ C เลย** เพราะ A/B จะแค่ไล่ตาม noise

---

### 🅳 Track D — เปลี่ยนวิธีคิด (1–2 สัปดาห์) — สำหรับตอนที่ A/B/C ยังไม่พอ

**D1: แยกเป็น 2 โมเดล**
```
Model 1: SKU detector — 44 คลาส (ไม่มี Empty Shelf)     → conf 0.25 (precision-first)
Model 2: Gap detector — 1 คลาส (single_cls: true)      → conf 0.10 (recall-first)
```
ข้อดี:
- ตัดปัญหา imbalance ทิ้งทั้งหมด — 1 คลาส ไม่มีอะไรให้ imbalance
- จูน threshold / augmentation / imgsz แยกกันได้อิสระ (SKU ต้องการ texture, gap ต้องการ geometry)
- **`erasing`/`mosaic` ตั้งค่าคนละแบบได้** ซึ่งแก้ปัญหา §2.3(ค) โดยตรง
- โมเดล gap ใช้ backbone เล็ก (yolo26s/n) ได้เพราะงานง่ายกว่า → เร็วกว่า
ข้อเสีย: inference cost ×2, ต้องแก้ serving + `class_map.yaml` contract

**D2: Geometric post-processing — หา gap จาก "ที่ที่ไม่มีสินค้า"**
แทนที่จะ detect ช่องว่างตรง ๆ ให้:
1. detect ชั้นวาง (shelf line) จากแถวของ price tag — **`Price` มี 8,517 กล่องและ recall 0.964 = signal ที่แข็งแรงที่สุดใน dataset**
2. project กล่องสินค้าที่ detect ได้ลงบนแต่ละ shelf line
3. ช่วงบน shelf line ที่ไม่มีสินค้าปิด **แต่มี price tag อยู่ข้างใต้** = gap (มีป้ายราคา = ควรมีสินค้าตรงนั้น)

ข้อดี: recall สูงมาก เพราะอาศัยคลาสที่โมเดลเก่งที่สุด (Price 0.964) แทนคลาสที่แย่ที่สุด (Empty Shelf 0.742)
เข้ากับ planogram logic ที่มีอยู่แล้วใน `backend/app/services/planogram.json`
ข้อเสีย: เป็น rule-based ต้องจูนเยอะ, พังถ้าป้ายราคาถูกบัง

**D3: Ensemble + WBF (Weighted Box Fusion)**
รวมผลจาก yolo26l + yolo11s (มีอยู่แล้วทั้งคู่ใน `artifacts/`) ด้วย WBF
recall ขึ้นแน่นอนเพราะ union ของสองโมเดล — แต่ precision ตกและ inference cost ×2

---

## 5. ตารางเปรียบเทียบให้เลือก

| Track | แรงที่ใช้ | recall คาดหวัง | precision จะเป็นยังไง | ความเสี่ยง | เมื่อไหร่ควรเลือก |
|---|---|---|---|---|---|
| **A** เก็บของฟรี | 0.5 วัน | 0.80–0.85 | ↓ ตกเหลือ 0.60–0.75 | ต่ำมาก | **ทำก่อนเสมอ** — ให้ข้อมูลว่าเพดานอยู่ไหน |
| **B** จูน training | 1–2 วัน | 0.82–0.88 | → คงเดิม/ดีขึ้น | ต่ำ | ทำต่อจาก A เสมอ |
| **C** แก้ dataset | 3–7 วัน | **0.90–0.95** ✅ | ↑ ดีขึ้นด้วย | ปานกลาง (ต้องมีคน label) | ถ้าอยากผ่าน gate จริง |
| **D1** แยก 2 โมเดล | 1 สัปดาห์ | 0.88–0.93 | ควบคุมแยกได้ | ปานกลาง (แก้ contract) | ถ้า A+B+C ยังไม่ถึง |
| **D2** geometric | 1–2 สัปดาห์ | 0.90+ | สูง | สูง (rule-based เปราะ) | ถ้าอยากได้ระบบที่แข็งแรงระยะยาว |
| **D3** ensemble | 2 วัน | +0.03–0.06 | ↓ | ต่ำ | เอาไว้บีบคะแนนตอนท้าย |

---

## 6. แผนที่ผมแนะนำ (เรียงตามลำดับ พร้อมจุดตัดสินใจ)

```
┌─ สัปดาห์ที่ 1 ─────────────────────────────────────────────┐
│ วันที่ 1 เช้า   A1  อัป ultralytics >= 8.4.0                │
│                A2  รวม valid+test เป็น eval set (329 inst) │
│ วันที่ 1 บ่าย   A3  พล็อต PR curve ของ class 19             │
│                                                             │
│         🔻 จุดตัดสินใจที่ 1 — max recall (conf→0) เท่าไหร่?  │
│            ≥ 0.93  → เป็นปัญหา threshold ล้วน จบที่ A3      │
│            0.85–0.93 → ไปต่อ Track B                        │
│            < 0.85  → ข้ามไป C1 ทันที (โมเดลมองไม่เห็นจริง)  │
│                                                             │
│ วันที่ 2      C1  วัด inter-annotator agreement 30 ภาพ      │
│                                                             │
│         🔻 จุดตัดสินใจที่ 2 — agreement เท่าไหร่?            │
│            < 0.85 → label คือเพดาน ทุ่มไป Track C เต็มตัว   │
│            ≥ 0.92 → label ไม่ใช่ปัญหา ทุ่มไป Track B        │
│                                                             │
│ วันที่ 3      B0+B1  เปิด val + ablation erasing 0.0 @640px │
│ วันที่ 4–5    B2    เทรน config ใหม่เต็มรูปแบบ + วัดผล      │
└─────────────────────────────────────────────────────────────┘

┌─ สัปดาห์ที่ 2 ─────────────────────────────────────────────┐
│ B3  re-export Roboflow ที่ 1280 letterbox (ไม่ต้อง label ใหม่)│
│ C2+C3  Annotation guideline + re-label เฉพาะ Empty Shelf    │
│ C5  re-split 70/15/15 แบบ GroupKFold ตามร้าน               │
│ เทรนใหม่ → รัน 5-fold CV → รายงาน recall ± SD               │
└─────────────────────────────────────────────────────────────┘
```

**ถ้าให้เลือกทำได้อย่างเดียว** → **C3 (re-label Empty Shelf ตาม guideline ที่นิ่ง)**
เพราะหลักฐานทั้งหมดใน §2.4 ชี้ตรงกันว่า ceiling ปัจจุบันมาจาก label ไม่ใช่โมเดล
และตราบใดที่ ceiling ยังอยู่ที่เดิม การจูน hyperparameter ทุกอย่างก็แค่ไล่ตาม noise

**ถ้ามีเวลาแค่ 1 วัน** → **A3 + B1** (operating point + `erasing: 0.0`) — ถูกที่สุด ให้ข้อมูลมากที่สุด

---

## 7. โค้ดที่ใช้ได้จริง

### 7.1 เปิด validation หลัง epoch 15 (แก้ปัญหา NMS ช้าโดยไม่เสีย model selection)

`model/shelfeye_ml/training/train.py`:

```python
WARMUP_NO_VAL_EPOCHS = 15

def _enable_val_after_warmup(trainer):
    """
    ปิด val ช่วง epoch ต้นที่โมเดลยังพ่นกล่อง low-conf เป็นพัน (NMS ระเบิด)
    แล้วเปิดกลับหลัง epoch 15 เพื่อให้ patience/best.pt ทำงานได้จริง
    """
    trainer.args.val = trainer.epoch >= WARMUP_NO_VAL_EPOCHS

model = YOLO(cfg["model"])
model.add_callback("on_train_epoch_start", _enable_val_after_warmup)
model.train(..., val=True, patience=cfg["patience"])
```

### 7.2 หา operating point ของ `Empty Shelf` (Track A3)

```python
# scripts/find_gap_threshold.py — ต้องใช้ ultralytics >= 8.4.0
import numpy as np
from ultralytics import YOLO

GAP_ID = 19
model = YOLO("artifacts/shelf-product-yolo26l-960/weights/best.pt")
res = model.val(data="data/data.yaml", split="test", imgsz=960, plots=False)

curves = {f"{yl}|{xl}": (np.asarray(x), np.asarray(y))
          for x, y, xl, yl in res.box.curves_results}
row = list(res.box.ap_class_index).index(GAP_ID)
conf, r = curves["Recall|Confidence"]
_,    p = curves["Precision|Confidence"]
r, p = r[row], p[row]

print(f"max recall ที่เป็นไปได้ (conf->0): {r.max():.4f}")

ok = np.where(r >= 0.90)[0]
if len(ok):
    i = ok.max()
    print(f"R>=0.90 ที่ conf<={conf[i]:.4f}  ->  precision {p[i]:.4f}")
else:
    print("R=0.90 ไปไม่ถึงที่ conf ใด ๆ  ->  ต้องแก้ที่ data/model ไม่ใช่ threshold")

# จุดที่ recall สูงสุดโดยยังรักษา precision gate 0.85 (ตรงกับ business logic)
ok85 = np.where(p >= 0.85)[0]
if len(ok85):
    i = ok85[np.argmax(r[ok85])]
    print(f"recall-first ภายใต้ P>=0.85:  conf={conf[i]:.3f}  P={p[i]:.3f}  R={r[i]:.3f}")
```

### 7.3 Config ใหม่ — `model/configs/yolo26l-640-recall.yaml`

```yaml
# แก้ 3 ต้นเหตุพร้อมกัน: ไม่มี model selection, upscale เปล่า ๆ, gap ปลอมจาก erasing
run_name: shelf-product-yolo26l-640-recall
model: yolo26l.pt
imgsz: 640          # dataset เป็น 640x640 อยู่แล้ว — 960 คือ upscale เปล่า ๆ
epochs: 150
batch: 12           # จาก 4 — BN statistics นิ่งขึ้น
patience: 30
val: true           # ← สำคัญที่สุด: patience/best.pt จะทำงานจริง
workers: 4
seed: 42
cos_lr: true
close_mosaic: 20    # 20 epoch สุดท้ายเห็นภาพจริงไม่ผ่าน mosaic
```

และใน `train.py` ให้ override `AUGMENT` สำหรับ run นี้:
```python
AUGMENT_RECALL = {**AUGMENT,
    "erasing": 0.0,   # เลิกสร้าง "ช่องว่างไม่มี label" ที่สอนโมเดลว่า gap = background
    "scale": 0.6,     # scale variance ของ gap สูงถึง 8 เท่า
}
```

### 7.4 Re-split แบบ GroupKFold (ป้องกัน leakage ระดับร้าน) — Track C5

```python
# scripts/resplit_grouped.py
import re, shutil
from pathlib import Path
from collections import defaultdict
from sklearn.model_selection import GroupShuffleSplit

DATA = Path("model/data")

def group_key(fname: str) -> str:
    """ภาพจากชั้นเดียวกัน/ร้านเดียวกัน/รอบเดียวกัน ต้องอยู่ split เดียวกันเสมอ
    20052618_Depotbesuch_REWE-Hamburg-Kieler-Strasse-101_Raja-Kumar_...jpg
    -> 20052618_REWE-Hamburg-Kieler-Strasse-101
    """
    base = re.sub(r"_jpg\.rf\.[0-9a-f]+\.jpg$", "", fname)
    parts = base.split("_")
    return f"{parts[0]}_{parts[2] if len(parts) > 2 else ''}"

files, groups, strata = [], [], []
for split in ("train", "valid", "test"):
    for img in (DATA / split / "images").iterdir():
        lbl = DATA / split / "labels" / (img.stem + ".txt")
        n_gap = sum(1 for line in lbl.read_text().splitlines()
                    if line.split() and line.split()[0] == "19")
        files.append((img, lbl))
        groups.append(group_key(img.name))
        strata.append(min(n_gap, 6))          # bin: 0,1,2,3,4,5,6+

print(f"{len(files)} ภาพ, {len(set(groups))} กลุ่ม (ร้าน+รอบ)")
# แบ่ง 70/15/15 ด้วย GroupShuffleSplit สองชั้น แล้ว copy ไฟล์ตาม split ใหม่
```

### 7.5 5-fold CV (ตอนจะ promote โมเดล) — เขียนเป็น Makefile target

```makefile
train-cv: ## เทรน 5-fold CV แล้วรายงาน recall ของ Empty Shelf เฉลี่ย +- SD
	@for k in 0 1 2 3 4; do \
	  cd $(MODEL) && .venv/bin/python -m shelfeye_ml.training.train \
	    --config configs/yolo26l-640-recall.yaml --fold $$k ; \
	done
	cd $(MODEL) && .venv/bin/python -m shelfeye_ml.eval.aggregate_folds
```

---

## 8. เกณฑ์วัดผลที่ต้องเปลี่ยนด้วย

ตอนนี้ `evaluate.py` รายงาน recall เป็นตัวเลขเดี่ยว ๆ ซึ่งซ่อน uncertainty ไว้ทั้งหมด
แนะนำให้เพิ่ม 3 อย่าง:

1. **Wilson 95% CI ติดไปกับทุก gate** — `0.7422 [0.659–0.811], n=124`
   gate ควรผ่านเมื่อ **ขอบล่างของ CI ≥ threshold** ไม่ใช่แค่ค่ากลาง
   *(ด้วยเกณฑ์นี้ ต่อให้วัดได้ 0.90 พอดีบน n=124 ก็ยังไม่ผ่าน เพราะขอบล่าง = 0.835 — เป็นเหตุผลเชิงสถิติที่แข็งแรงว่าทำไมต้องขยาย test set)*

2. **แยก recall ตามขนาดกล่อง** — เพราะ scale variance คือหนึ่งในต้นเหตุ
   `recall@small (<64px) / medium (64–256px) / large (>256px)`
   ถ้า recall ตกเฉพาะ large → ยืนยันสมมติฐาน "ตีกรอบทั้งชั้น" ใน §2.4

3. **นับ instance ที่วัดจริง ๆ ในรายงานเสมอ** — คลาสที่มี GT < 20 กล่องควรมีป้าย `insufficient_data` แทนที่จะรายงาน recall
   (`Espresso SArt` ที่รายงาน R = 0.0 จาก 2 กล่อง กำลังทำให้ overall recall เพี้ยนอยู่ตอนนี้)

---

## ภาคผนวก — ที่มาของตัวเลขทุกตัวในเอกสารนี้

| ตัวเลข | มาจาก |
|---|---|
| metric ของโมเดล | `model/artifacts/shelf-product-yolo26l-960/metrics.json` |
| จำนวนกล่อง/คลาส/ขนาดกล่อง | นับตรงจาก `model/data/{train,valid,test}/labels/*.txt` |
| polygon vs box | นับจำนวน field ต่อบรรทัดในไฟล์ label |
| ขนาดภาพ 640×640 | `PIL.Image.open()` สุ่ม 300 ภาพจาก train + `data/README.roboflow.txt` |
| ไม่มี leakage | เทียบ base filename ข้าม split ด้วย `comm -12` |
| curve ของ training | `model/artifacts/shelf-product-yolo26l-960/results.csv` |
| hyperparameter ที่ใช้จริง | `model/artifacts/shelf-product-yolo26l-960/args.yaml` |
| Wilson CI | คำนวณเอง (z = 1.96) |

**ข้อจำกัดของการวิเคราะห์นี้:** ผมรัน `model.val()` ซ้ำบนเครื่องนี้ไม่ได้อย่างเชื่อถือได้ เพราะ `model/.venv` มี ultralytics 8.3.40 ซึ่งเก่ากว่า YOLO26 (`requirements.txt` ระบุ `>=8.4.0`) — รันแล้วได้ mAP@50 = 0.419 แทน 0.9065
ดังนั้น **PR curve ของ class 19 (§7.2) ยังไม่ได้วัดจริง** และเป็นการทดลองแรกที่คุณควรรัน เพราะมันจะบอกทันทีว่าเพดานของโมเดลตัวนี้อยู่ตรงไหน
