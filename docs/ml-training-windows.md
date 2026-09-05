# เทรนบนเครื่อง Windows — คำสั่งที่ต้องรัน

> Quick reference สำหรับลงมือทำ ทุกคำสั่งรันจากโฟลเดอร์ `model\` บน **PowerShell**
> เหตุผลเบื้องหลังค่าที่ตั้งไว้ทุกตัว → [ml-empty-shelf-recall-plan.md](ml-empty-shelf-recall-plan.md)
> ภาพรวม workflow + วิธีแปลผล → [ml-training-runbook.md](ml-training-runbook.md)

## ทำไมไม่ใช้ `make`

Makefile ในโปรเจกต์ใช้ path แบบ Unix (`.venv/bin/python`) ซึ่งบน Windows คือ `.venv\Scripts\python.exe`
และ target `train-cv` ใช้ `for k in $(seq ...)` ของ bash ซึ่ง PowerShell ไม่รู้จัก

เอกสารนี้จึงเป็นคำสั่ง Python ตรง ๆ ทั้งหมด **ใช้ `make` เฉพาะบน Mac**

---

## 0. เตรียมเครื่อง (ครั้งเดียว)

```bash
git pull
```

```bash
.\.venv\Scripts\Activate.ps1
```

```bash
pip install -U "ultralytics>=8.4.0" -r requirements.txt
```

### ⚠️ ตรวจ 2 อย่างนี้ก่อน อย่าข้าม

```bash
python -c "import ultralytics, torch; print(ultralytics.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

ต้องได้ **`8.4.x` ขึ้นไป** + `True` + ชื่อการ์ด

YOLO26 ใช้ end-to-end head ที่ไม่มีใน 8.3.x — ถ้าเวอร์ชันต่ำกว่านี้ weights จะโหลดได้ แต่ postprocess ผิด
(บน Mac ที่มี ultralytics 8.3.40 โมเดลตัวเดิมวัดได้ mAP@50 = **0.419** แทนที่จะเป็น **0.9065** ที่บันทึกไว้ — ดูเหมือนโมเดลพัง ทั้งที่ไม่ได้พัง)

### ตั้ง PYTHONPATH ทุกครั้งที่เปิด terminal ใหม่

```bash
$env:PYTHONPATH="."
```

---

## 1. เตรียมข้อมูล

```bash
python -m shelfeye_ml.training.prepare_dataset
```

```bash
python -m shelfeye_ml.training.resplit --mode holdout --ratios 70 15 15
```

### ต้องได้ตัวเลขนี้เป๊ะ ๆ

```
[resplit] 1349 images in 1145 groups

=== holdout (seed 42) ===
  train      groups   792  images   942  boxes  36521  gaps  1416  recall CI +-0.016
  val        groups   177  images   203  boxes   8340  gaps   303  recall CI +-0.034
  test       groups   176  images   204  boxes   7657  gaps   301  recall CI +-0.034
```

`resplit` เป็น deterministic ทั้งหมด (จัดกลุ่มเรียงตาม key → `random.Random(42)` → deal แบบ greedy)
รันบน Mac กับ Windows ได้ split เดียวกันเสมอ ตราบใดที่ dataset ชุดเดียวกัน

**ถ้าตัวเลขไม่ตรง = dataset คนละชุด → หยุดก่อน อย่าเทรน**

> ⛔ ก็อปโฟลเดอร์ `data/splits/` จาก Mac มาใช้ไม่ได้ — ไฟล์ `.txt` เก็บ **absolute path** ของเครื่องที่สร้างมัน
> ต้องรัน `resplit` บนเครื่อง Windows เอง (ใช้เวลาไม่ถึงวินาที)

---

## 2. เทรน 3 รอบ ตามลำดับนี้

### รอบที่ 1 — ablation `erasing` (ทำก่อน)

ถูกที่สุดและให้ข้อมูลมากที่สุดต่อเวลาที่ใช้ เปลี่ยนตัวแปรเดียวจาก baseline คือ `erasing 0.2 → 0.0`

```bash
python -m shelfeye_ml.training.train --config configs/yolo26l-640-noerasing.yaml
```

```bash
python -m shelfeye_ml.eval.evaluate --weights artifacts/shelf-product-yolo26l-640-noerasing/weights/best.pt --data data/splits/holdout/data.yaml --split test --imgsz 640
```

### รอบที่ 2 — control

```bash
python -m shelfeye_ml.training.train --config configs/yolo26l-640-baseline.yaml
```

```bash
python -m shelfeye_ml.eval.evaluate --weights artifacts/shelf-product-yolo26l-640-baseline/weights/best.pt --data data/splits/holdout/data.yaml --split test --imgsz 640
```

ต้องมีตัวนี้ ไม่งั้นเทียบอะไรไม่ได้เลย — artifact เดิม `shelf-product-yolo26l-960` **ใช้เป็น baseline ไม่ได้** เพราะคนละ split และไม่มี model selection (เทรนด้วย `val: false`)

### รอบที่ 3 — full config

```bash
python -m shelfeye_ml.training.train --config configs/yolo26l-640-recall.yaml
```

```bash
python -m shelfeye_ml.eval.evaluate --weights artifacts/shelf-product-yolo26l-640-recall/weights/best.pt --data data/splits/holdout/data.yaml --split test --imgsz 640
```

---

## 3. Pre-flight — ดู log 2 บรรทัดแรกก่อนปล่อยทิ้งไว้

```
[train] config=yolo26l-640-noerasing.yaml run=shelf-product-yolo26l-640-noerasing device=0 imgsz=640 epochs=150 data=...\data\splits\holdout\data.yaml
[train] validation starts at epoch 15 (patience=30)
```

| ต้องเห็น | ถ้าไม่เห็นแปลว่า |
|---|---|
| `device=0` | ไม่ได้ใช้ GPU — อย่าปล่อยไว้ |
| `validation starts at epoch 15` | val ไม่ทำงาน → `patience` ตาย และ `best.pt` = epoch สุดท้าย ไม่ใช่ epoch ที่ดีที่สุด |
| `data=...\splits\holdout\data.yaml` | ยังใช้ split เดิม 85/10/5 ที่วัดอะไรไม่ได้ (gap แค่ 124 ตัว, CI ±0.077) |
| `imgsz=640` | ถ้าเป็น 960 บน dataset นี้คือ upscale เปล่า ๆ จ่ายแพงขึ้น 2.25 เท่าโดยไม่ได้ข้อมูลเพิ่ม |

---

## 4. เวลาที่ใช้

| งาน | เวลาโดยประมาณ |
|---|---|
| 1 run (640px, 150 epochs, batch 12) | 1.5–2.5 ชม. |
| **ครบ 3 runs** | **5–7 ชม.** |
| 5-fold CV (ยังไม่ต้องทำตอนนี้) | 8–12 ชม. |

ฐานคำนวณ: run เดิม 100 epochs @960 batch 4 ใช้ 8,540 วินาที = 2.4 ชม. → ที่ 640px ถูกลง 2.25 เท่า, 150 epochs แพงขึ้น 1.5 เท่า, แต่ early stopping (`patience: 30`) น่าจะตัดก่อนครบ 150

---

## 5. หอบอะไรกลับมา Mac

ต่อ 1 run เอา 4 ไฟล์นี้จาก `model\artifacts\<run_name>\`:

| ไฟล์ | ขนาด | ทำไมต้องมี |
|---|---|---|
| `weights\best.pt` | ~51 MB | ต้องใช้รัน `make gap-diag` บน Mac |
| `metrics.json` | ~6 KB | ผล gate + 95% CI + จำนวน instance |
| `results.csv` | ~9 KB | ดูว่า early stopping ตัดที่ epoch ไหน, loss ตันเมื่อไหร่ |
| `run_manifest.json` | ~1 KB | บันทึกว่า config / augment / git sha ไหนผลิตน้ำหนักตัวนี้ |

- `best.pt` **อย่า commit เข้า git** (`model/artifacts/` ถูก gitignore อยู่แล้ว) — ส่งผ่าน scp / cloud drive
- อีก 3 ไฟล์เล็กมาก commit ได้สบาย

---

## 6. ตารางกรอกผล

| run | gap recall | 95% CI | gap precision | overall mAP@50 | epoch ที่หยุด |
|---|---|---|---|---|---|
| `yolo26l-960` (เดิม) | 0.7422 | 0.659–0.811 | 0.7480 | 0.9065 | 100 (ไม่มี early stop) |
| `640-baseline` | | | | | |
| `640-noerasing` | | | | | |
| `640-recall` | | | | | |

`640-noerasing` − `640-baseline` = ผลของ `erasing` เพียว ๆ

> `yolo26l-960` อยู่คนละ split เอามาเทียบตรง ๆ ไม่ได้ ใส่ไว้เป็นจุดอ้างอิงเฉย ๆ

---

## 7. แก้ปัญหาที่เจอบ่อยบน Windows

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `Activate.ps1 cannot be loaded` | PowerShell execution policy | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| `ModuleNotFoundError: shelfeye_ml` | ลืมตั้ง PYTHONPATH | `$env:PYTHONPATH="."` (ต้องตั้งใหม่ทุก terminal) |
| `CUDA out of memory` | batch ใหญ่ไป | แก้ `batch: 12` ใน config เป็น `8` แล้ว `4` |
| mAP ต่ำผิดปกติ (~0.4) | ultralytics < 8.4 | `pip install -U "ultralytics>=8.4.0"` |
| `resplit` ได้ตัวเลขไม่ตรง | dataset คนละชุด | รัน `prepare_dataset` ใหม่ / เช็ค zip |
| เทรนช้าผิดปกติ | ตกไปใช้ CPU | เช็ค `device=0` ใน log บรรทัดแรก |

---

## 8. ยังไม่ต้องทำตอนนี้: 5-fold CV

```bash
python -m shelfeye_ml.training.resplit --mode kfold --folds 5
```

แล้ววน `--fold 0` ถึง `--fold 4` ทีละอัน (PowerShell ต้องเขียน loop เอง — `make train-cv` เป็น bash)

ใช้ 8–12 ชม. **เก็บไว้ตอนจะสรุปตัวเลขให้ stakeholder เท่านั้น** อย่ารันระหว่างกำลังทดลอง

---

## 💡 ก่อนไปเทรน ลองรันบน Mac ก่อน 2 นาที

```bash
make gap-diag
```

ค่า default ล้วน = วัดโมเดล 960 ตัวเดิมกับ split เดิม (สะอาด ไม่มี contamination)
มันจะบอก **เพดาน recall** ของโมเดลปัจจุบัน — คือ recall สูงสุดที่เป็นไปได้ถ้ายอมรับทุกกล่องที่โมเดลพ่นออกมา

| เพดาน | แปลว่า | ควรทำ |
|---|---|---|
| **≥ 0.93** | โมเดลเห็น gap หมดแล้ว แค่ threshold ตั้งผิด | ตั้ง `GAP_CONF_THRESHOLD` จบ ไม่ต้องเทรน |
| **0.85–0.93** | ใกล้แล้ว | เทรน 3 รอบตามเอกสารนี้ |
| **< 0.85** | โมเดล**มองไม่เห็น** gap พวกนั้นเลย | เทรนยังไงก็ไม่ถึง 0.90 → ไป Track C (แก้ label) |

**ถ้าเพดาน < 0.85 จะได้ไม่ต้องเสียเวลา 7 ชม. ไปฟรี ๆ**

> ⚠️ `gap_diagnostics.py` ยังไม่เคยรันสำเร็จสักครั้ง ผ่านแค่ syntax check — ถ้ารันแล้วพัง แจ้งได้
