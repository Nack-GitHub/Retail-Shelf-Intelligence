# Runbook — เทรนข้างนอก วิเคราะห์บน Mac

> คู่มือสั่งงานสำหรับแผนใน [ml-empty-shelf-recall-plan.md](ml-empty-shelf-recall-plan.md)
> เขียนขึ้นเพราะ MacBook M2 / RAM 16GB เทรน YOLO26l ได้แต่ช้ากว่าเครื่อง CUDA ~10 เท่า

---

## 0. แบ่งงานยังไง

| งาน | เครื่องไหน | ใช้เวลา |
|---|---|---|
| `make resplit` / `make resplit-cv` | **Mac หรือเครื่องนอกก็ได้** | < 1 วินาที |
| `make train-noerasing` / `train-baseline` / `train-recall` | **เครื่องนอก (CUDA)** | 1.5–2.5 ชม./run |
| `make train-cv` (5 folds) | **เครื่องนอก (CUDA)** | 8–12 ชม. |
| `make evaluate-holdout` | Mac ได้ | ~1 นาที |
| `make gap-diag` | Mac ได้ | ~1–2 นาที |
| `make aggregate-cv` | Mac ได้ | ทันที |

**หลักการ:** เครื่องนอกทำหน้าที่ *ผลิตน้ำหนักโมเดล* อย่างเดียว ส่วนการ *ตัดสินใจ* ทั้งหมดทำบน Mac
เพราะทุกอย่างที่ตัดสินใจได้เป็น inference รอบเดียวบนภาพ 204 รูป ซึ่งเบามาก

---

## 1. เตรียมเครื่องนอก

### 1.1 ตรวจเวอร์ชันก่อนอย่างอื่น ⚠️

```bash
python -c "import ultralytics; print(ultralytics.__version__)"
```

**ต้องได้ 8.4.0 ขึ้นไป** YOLO26 ใช้ end-to-end head ที่ไม่มีใน 8.3.x
ถ้าเวอร์ชันต่ำกว่านี้ weights จะโหลดได้แต่ postprocess ผิด — บน Mac เครื่องนี้ (ultralytics 8.3.40) โมเดลตัวเดิมวัดได้ mAP@50 = **0.419** แทนที่จะเป็น **0.9065** ที่บันทึกไว้ ตัวเลขจะดูเหมือนโมเดลพัง ทั้งที่โมเดลไม่ได้พัง

```bash
pip install -U "ultralytics>=8.4.0"
```

### 1.2 ติดตั้งจาก requirements

```bash
pip install -r model/requirements.txt
```

### 1.3 ตรวจว่า GPU มองเห็น

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

---

## 2. เตรียมข้อมูลบนเครื่องนอก

```bash
make dataset          # แตก shelf-product.v1i.yolov11.zip -> model/data/
make resplit          # สร้าง data/splits/holdout/{train,val,test}.txt + data.yaml
```

### ทำไมต้อง `make resplit` ซ้ำบนเครื่องนอก ไม่ copy ไฟล์ไป

ไฟล์ `.txt` เก็บ **absolute path** ของเครื่องที่สร้างมัน ก็อปข้ามเครื่องแล้วพังแน่นอน

**แต่ผลลัพธ์เหมือนกันเป๊ะทุกเครื่อง** เพราะ `resplit.py` เป็น deterministic ทั้งหมด — จัดกลุ่มเรียงตาม key, สุ่มด้วย `random.Random(seed=42)`, แล้ว deal แบบ greedy ไม่มีจุดไหนพึ่ง hash ordering หรือ filesystem order
รันบน Mac กับบน Linux ได้ split เดียวกันเสมอ ตราบใดที่ dataset เดียวกัน

ตัวเลขที่ควรเห็น (ยืนยันแล้วบน Mac):

```
[resplit] 1349 images in 1145 groups

=== holdout (seed 42) ===
  train      groups   792  images   942  boxes  36521  gaps  1416  recall CI +-0.016
  val        groups   177  images   203  boxes   8340  gaps   303  recall CI +-0.034
  test       groups   176  images   204  boxes   7657  gaps   301  recall CI +-0.034
```

ถ้าตัวเลขไม่ตรงนี้ แปลว่า dataset ไม่เหมือนกัน — **หยุดแล้วเช็คก่อนเทรน**

> `data/splits/` ไม่ควรเข้า git เพราะเป็น absolute path เฉพาะเครื่อง

---

## 3. ลำดับการเทรน — ทำตามลำดับนี้

### รอบที่ 1 — ablation ที่ถูกที่สุด (ทำก่อน)

```bash
make train-noerasing
```

เปลี่ยนตัวแปรเดียวจาก baseline: `erasing 0.2 -> 0.0`
สมมติฐาน: random erasing ป้ายสี่เหลี่ยมทึบลงบนชั้นวางโดย**ไม่เพิ่ม label** ซึ่งสำหรับ 44 คลาส SKU คือ occlusion ที่สมเหตุสมผล แต่สำหรับ `Empty Shelf` คือการสอนโมเดลว่า "ช่องว่าง = background" ประมาณ 20% ของทุก draw ตลอดทั้ง run

### รอบที่ 2 — control

```bash
make train-baseline
```

ต้องมีตัวนี้ ไม่งั้นเทียบอะไรไม่ได้เลย — artifact เดิม (`shelf-product-yolo26l-960`) **ใช้เทียบไม่ได้** เพราะคนละ split และไม่มี model selection

### รอบที่ 3 — full config

```bash
make train-recall
```

รันต่อเมื่อรู้แล้วว่า `erasing` มีผลหรือไม่ ไม่งั้นจะแยกไม่ออกว่า knob ไหนเป็นคนจ่าย

### รอบที่ 4 — cross validation (เฉพาะตอนจะ promote)

```bash
make train-cv FOLDS=5
```

8–12 ชม. อย่ารันตอนกำลังทดลอง — เก็บไว้ตอนจะสรุปตัวเลขให้ stakeholder

---

## 4. ตรวจก่อนปล่อยเทรนยาว (pre-flight)

ดู log 20 บรรทัดแรก ต้องเห็น:

```
[train] config=yolo26l-640-noerasing.yaml run=shelf-product-yolo26l-640-noerasing device=0 imgsz=640 epochs=150 data=.../data/splits/holdout/data.yaml
[train] validation starts at epoch 15 (patience=30)
```

| ต้องเห็น | ถ้าไม่เห็นแปลว่า |
|---|---|
| `device=0` | ไม่ได้ใช้ GPU — อย่าปล่อยไว้ |
| `validation starts at epoch 15` | val ไม่ทำงาน → `patience` ตายและ `best.pt` = epoch สุดท้าย |
| `data=.../splits/holdout/data.yaml` | ยังใช้ split เดิม 85/10/5 ที่วัดอะไรไม่ได้ |
| `imgsz=640` | ถ้าเป็น 960 บน dataset นี้คือ upscale เปล่า ๆ จ่ายแพงขึ้น 2.25 เท่า |

ถ้า GPU OOM: ลด `batch` ใน config จาก 12 → 8 → 4

---

## 5. หอบอะไรกลับมา

ต่อ 1 run ให้เอากลับ **ทั้งโฟลเดอร์** `model/artifacts/<run_name>/` แต่ถ้าเน็ตช้า เอาเท่านี้พอ:

| ไฟล์ | ขนาด | ทำไมต้องมี |
|---|---|---|
| `weights/best.pt` | ~51 MB | ต้องใช้รัน `gap-diag` บน Mac |
| `results.csv` | ~9 KB | ดูว่า loss ตันตอน epoch ไหน, early stop ทำงานไหม |
| `run_manifest.json` | ~1 KB | บันทึกว่า config/augment/git sha อะไรผลิตน้ำหนักตัวนี้ |
| `metrics.json` | ~6 KB | ถ้ารัน evaluate บนเครื่องนอกแล้ว |

> `best.pt` 51 MB **อย่า commit เข้า git** — ส่งผ่าน scp / cloud drive / `gh release` แทน
> ส่วน `results.csv` + `run_manifest.json` + `metrics.json` เล็กมาก commit ได้สบาย

---

## 6. กลับมาบน Mac — วิเคราะห์

### ⚠️ กับดักที่ต้องรู้ก่อน: อย่าเอาโมเดลเก่าไปวัดกับ split ใหม่

`make resplit` **สลับภาพใหม่ทั้งหมด** แปลว่าภาพ ~85% ที่อยู่ใน `data/splits/holdout/test.txt`
คือภาพที่โมเดลเก่า (`shelf-product-yolo26l-960`) **เคยเห็นตอนเทรน**

เอาโมเดลเก่าไปวัดกับ split ใหม่ = วัดกับข้อสอบที่เคยทำมาแล้ว ตัวเลขจะพุ่งขึ้นสวยงามและ**ผิดทั้งหมด**

| โมเดล | ต้องวัดกับ | คำสั่ง |
|---|---|---|
| เทรนก่อน resplit (`yolo26l-960`) | **split เดิม** `data/data.yaml` | `make gap-diag` (ค่า default) |
| เทรนหลัง resplit (`640-*`) | `data/splits/holdout/data.yaml` | ต้องใส่ `DATA=` เอง |

Makefile ตั้ง `DATA ?= data/data.yaml` ไว้เป็น default เพราะเหตุผลนี้ — ค่า default ปลอดภัยเสมอ

### 6.0 ดูจุดยืนของโมเดลปัจจุบันก่อน (ยังไม่ต้องเทรนอะไร)

```bash
make gap-diag
```

ใช้ค่า default ทั้งหมด = โมเดล 960 ตัวเดิม วัดกับ split เดิม (124 gap instances)
n น้อยแต่**สะอาด** — และมันจะบอก "เพดาน" ของโมเดลปัจจุบันทันที ซึ่งเป็นข้อมูลที่ตัดสินใจได้มากที่สุดต่อเวลาที่ใช้

### 6.1 หลังเทรนรอบใหม่เสร็จ

```bash
make gap-diag RUN=shelf-product-yolo26l-640-noerasing IMGSZ=640 \
              DATA=data/splits/holdout/data.yaml
```

จะได้ 3 อย่างที่ `model.val()` บอกไม่ได้:

### 6.2 เพดาน (ceiling)

```
CEILING  recall at conf->0: 0.xxxx  [95% CI ...]
```

คือ recall สูงสุดที่เป็นไปได้ ถ้ายอมรับทุกกล่องที่โมเดลพ่นออกมา

| ถ้าเพดาน | แปลว่า | ทำอะไรต่อ |
|---|---|---|
| **≥ 0.93** | โมเดลเห็น gap หมดแล้ว แค่ threshold ตั้งผิด | จบที่การตั้ง `GAP_CONF_THRESHOLD` ไม่ต้องเทรนอีก |
| **0.85–0.93** | ใกล้แล้ว | จูน config ต่อ (Track B) |
| **< 0.85** | โมเดล**มองไม่เห็น** gap พวกนั้นเลย | ปรับ threshold ยังไงก็ไม่ช่วย → ต้องแก้ data (Track C) |

### 6.3 operating point

```
OPERATING POINTS
  max-F1 (what val() reports)          conf x.xxx  P x.xxx  R x.xxx
  recall-first, P>=0.85                conf x.xxx  P x.xxx  R x.xxx   <- เอาค่านี้
  cheapest conf reaching R>=0.90       conf x.xxx  P x.xxx  R x.xxx
```

ค่า `recall-first` เอาไปใส่ serving ได้เลย — **ระบบรองรับอยู่แล้ว** ไม่ต้องแก้โค้ด:

```bash
GAP_CONF_THRESHOLD=0.12 make ml
```

(`model/shelfeye_ml/serving/app.py:39` อ่านจาก env และส่งต่อเป็น per-class threshold ผ่าน `decode()` ซึ่งมีเทสต์คุมอยู่แล้วที่ `test_decode_supports_per_class_thresholds`)

### 6.4 สาเหตุที่ miss — ตัวนี้คือตัวตัดสินใจ

```
MISS PROFILE (at conf 0.xxx)
  detected          xxx
  below_threshold   xxx      -> ลด threshold ได้ recall ฟรี
  localisation      xxx      -> label ขัดกันเอง ต้อง re-label
  misclassified     xxx      -> สับสนกับคลาสอื่น ดู misclassified_as
  blind             xxx      -> มองไม่เห็นจริง ต้องเพิ่ม data/resolution
```

**นี่คือจุดที่แผนทั้งหมดขึ้นกับผลลัพธ์**

| ถ้าตัวไหนเยอะสุด | สาเหตุจริง | ลงแรงตรงไหน |
|---|---|---|
| `below_threshold` | ตั้ง threshold ผิด | แก้ 1 บรรทัด จบ |
| `localisation` | **annotation ขัดกันเอง** | Track C — re-label เท่านั้นที่ยกเพดานได้ |
| `misclassified` | คลาสทับซ้อนกัน | ดูว่าไปโดนคลาสไหน แล้วแก้ guideline |
| `blind` | ข้อมูลไม่พอ / ความละเอียดไม่พอ | re-export 1280 + เก็บภาพเคสยากเพิ่ม |

> ผมคาดว่า `localisation` จะเยอะ จากหลักฐานใน §2.4 ของเอกสารแผน (polygon 17%, ขนาดกล่องแกว่ง 8 เท่า, P≈R≈mAP≈0.745)
> **ถ้าออกมาแบบนั้นจริง ให้ข้ามการจูน hyperparameter ไปทำ Track C เลย** — จูนต่อคือไล่ตาม noise

### 6.5 ผ่าน gate หรือยัง

```bash
make evaluate-holdout RUN=shelf-product-yolo26l-640-noerasing IMGSZ=640
```

gate เวอร์ชันใหม่ตัดสินที่ **ขอบล่างของ 95% CI** ไม่ใช่ค่ากลาง:

```
[FAIL] recall_empty_shelf   0.9000 [95% CI 0.863-0.928, n=301] vs >= 0.9
```

อ่านว่า: วัดได้ 0.90 พอดี แต่ข้อมูลยังสอดคล้องกับความจริงที่ 0.863 อยู่ → ยัง promote ไม่ได้
ต้องได้ราว **0.93+** บน n=301 ถึงจะมั่นใจว่าเกิน 0.90 จริง

---

## 7. ตารางเทียบผล (กรอกเองระหว่างทดลอง)

| run | gap recall | 95% CI | gap precision | overall mAP@50 | epoch ที่หยุด | หมายเหตุ |
|---|---|---|---|---|---|---|
| `yolo26l-960` (เดิม) | 0.7422 | 0.659–0.811 | 0.7480 | 0.9065 | 100 (ไม่มี early stop) | คนละ split เทียบตรง ๆ ไม่ได้ |
| `640-baseline` | | | | | | control |
| `640-noerasing` | | | | | | Δ จาก baseline = ผลของ `erasing` |
| `640-recall` | | | | | | |
| `640-recall` 5-fold | mean ± SD | pooled CI | | | | ตัวเลขที่เอาไปคุยได้ |

---

## 8. ทางเลือกเครื่องนอก

| ตัวเลือก | ราคา | เวลา/run (640px, 150ep) | หมายเหตุ |
|---|---|---|---|
| **Windows CUDA box ที่มีอยู่** | ฟรี | ~1.5–2.5 ชม. | ดีที่สุด — พิสูจน์แล้วว่าเทรน YOLO26 ได้ |
| RunPod / Vast.ai RTX 4090 | ~$0.35/ชม. | ~1–1.5 ชม. | ≈ $0.50/run |
| Colab Pro (L4 / A100) | ~$10/เดือน | ~1–1.5 ชม. | ระวัง session timeout ตอนรัน CV |
| Kaggle (T4 ×2) | ฟรี 30 ชม./สัปดาห์ | ~3–4 ชม. | ช้ากว่าแต่ไม่เสียเงิน |

### Colab / RunPod — คำสั่งชุดเดียว

```bash
git clone <repo> && cd Retail-Shelf-Intelligence
pip install -U "ultralytics>=8.4.0"
pip install -r model/requirements.txt

make dataset
make resplit

cd model
PYTHONPATH=. python -m shelfeye_ml.training.train --config configs/yolo26l-640-noerasing.yaml
PYTHONPATH=. python -m shelfeye_ml.eval.evaluate \
  --weights artifacts/shelf-product-yolo26l-640-noerasing/weights/best.pt \
  --data data/splits/holdout/data.yaml --split test --imgsz 640
```

⚠️ Colab: ถ้ารัน CV ให้แยกทีละ fold ด้วย `--fold N` แล้วเซฟ artifact ลง Drive ทุก fold
session หลุดกลางทางแล้วต้องเริ่มใหม่หมดจะเจ็บมาก

---

## 9. เอกสารที่เกี่ยวข้อง

- [ml-training-windows.md](ml-training-windows.md) — **คำสั่งพร้อมรันบนเครื่อง Windows** (ไม่ใช้ `make`)
- [ml-empty-shelf-recall-plan.md](ml-empty-shelf-recall-plan.md) — การวิเคราะห์และเหตุผลเบื้องหลังทุกค่าที่ตั้งไว้
- `model/configs/yolo26l-640-*.yaml` — comment ในไฟล์อธิบายว่าแต่ละ override แก้ปัญหาอะไร
- `model/shelfeye_ml/eval/gap_diagnostics.py` — docstring อธิบายนิยามของ miss แต่ละประเภท
