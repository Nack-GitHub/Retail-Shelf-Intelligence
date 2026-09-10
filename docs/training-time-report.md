# รายงานเวลาและผลการเทรนโมเดล (Training Time & Benchmark Report)

รายงานสรุปเวลาการเทรนโมเดล YOLO26L บนสภาพแวดล้อม **Windows (NVIDIA GeForce RTX 3070 Ti 8GB)** ตามขั้นตอนใน [ml-training-windows.md](ml-training-windows.md)

---

## 1. สรุปเวลาทั้งหมด (Total Time Summary)

- **เวลารวมการเทรน (Pure Compute Time)**: **15 ชั่วโมง 23 นาที 42 วินาที** (55,422.3 วินาที / ~15.4 ชั่วโมง)
- **ช่วงเวลาการทำงานจริง (Wall-clock Span)**: 2026-09-05 21:38 ถึง 2026-09-06 23:14 (~25.6 ชั่วโมง รวมการประเมินผล test split และช่วงเวลาระหว่างรอบ)

---

## 2. รายละเอียดเวลาการเทรนแยกตามแต่ละรอบ (Per-Run Breakdown)

| รอบการทดลอง | Run Name | Epochs ที่รัน | เวลาที่ใช้ (วินาที) | เวลาที่ใช้ (ชม. : นาที : วินาที) | เฉลี่ยต่อ Epoch | การตั้งค่า Batch / Overrides |
|---|---|:---:|:---:|:---:|:---:|---|
| **รอบที่ 1 (Ablation)** | `shelf-product-yolo26l-640-noerasing` | 107 (early stop @ 77) | 22,013.0 s | **6 ชม. 06 นาที 53 วินาที** | 146.8 s/epoch | `batch: 12`, `erasing: 0.0` |
| **รอบที่ 2 (Control)** | `shelf-product-yolo26l-640-baseline` | 107 (early stop @ 77) | 21,854.5 s | **6 ชม. 04 นาที 14 วินาที** | 145.7 s/epoch | `batch: 12`, `erasing: 0.2` (default) |
| **รอบที่ 3 (Recall-First)** | `shelf-product-yolo26l-640-recall` | 124 (early stop @ 94) | 11,554.8 s | **3 ชม. 12 นาที 35 วินาที** | 77.0 s/epoch | `batch: 4`, multi-scale, cls 0.7, cos_lr |
| **รวมทั้งหมด** | **3 Runs** | **338 Epochs** | **55,422.3 s** | **15 ชม. 23 นาที 42 วินาที** | **163.9 s/epoch เฉลี่ย** | |

*หมายเหตุ: แต่ละรอบใช้เวลา evaluate บน test split (204 ภาพ) เพิ่มเติมอีกประมาณ 5–10 วินาที*

---

## 3. ตารางเปรียบเทียบผลลัพธ์และประสิทธิภาพ (Model Metrics & Performance)

วัดผลบน `holdout test split` (204 ภาพ, Empty Shelf n=301):

| run | เวลาที่ใช้ | gap recall | 95% CI | gap precision | overall mAP@50 | epoch ที่หยุด |
|---|---|:---:|:---:|:---:|:---:|:---:|
| `yolo26l-960` (เดิม) | ~2.4 ชม. | 0.7422 | 0.659–0.811 | 0.7480 | 0.9065 | 100 (ไม่มี early stop) |
| **`640-baseline`** | **6.07 ชม.** | **0.6894** | **0.635–0.739** | **0.7966** | **0.9162** | 107 (best: 77) |
| **`640-noerasing`** | **6.11 ชม.** | **0.6894** | **0.635–0.739** | **0.7966** | **0.9162** | 107 (best: 77) |
| **`640-recall`** | **3.21 ชม.** | **0.7209** | **0.668–0.769** | **0.7681** | **0.9177** | 124 (best: 94) |

---

## 4. ข้อสังเกตเชิงลึกด้านฮาร์ดแวร์และสปีด (Hardware & Optimization Notes)

1. **ทำไมรอบที่ 3 ถึงเทรนเร็วกว่ารอบ 1 และ 2 เกือบเท่าตัว (77s vs 146s ต่อ epoch)?**
   - ในรอบ 1 และ 2 ใช้ `batch: 12` ซึ่งทำให้ DataLoader workers บน Windows (8 workers) ใช้ RAM เครื่องเกือบเต็ม 16GB จนระบบต้องทำ paging กับ disk
   - ในรอบที่ 3 เมื่อปรับเป็น `batch: 4` (เนื่องจาก `multi_scale: 0.5` ปรับภาพสูงสุดถึง 960px) ทำให้การจอง RAM และ VRAM พอดีกับเครื่อง ไม่เกิด disk paging ทำให้ DataLoader ส่ง batch ให้ GPU RTX 3070 Ti ได้ต่อเนื่อง ความเร็วต่อ epoch จึงเพิ่มขึ้นเกือบ 2 เท่า (จาก 146s เหลือ 77s)
2. **ความคุ้มค่าของการตั้งค่าในรอบที่ 3 (`640-recall`)**:
   - ได้ **Gap Recall เพิ่มขึ้นชัดเจนจาก 0.6894 เป็น 0.7209 (+3.15%)**
   - ได้ **Overall mAP@50 สูงสุดที่ 0.9177**
   - ใช้เวลาเทรนน้อยที่สุดในบรรดาทุกการทดลอง

---

## 5. แหล่งอ้างอิง Artifacts แต่ละรอบ

- **Run 1 (`noerasing`)**: `model/artifacts/shelf-product-yolo26l-640-noerasing/`
  - `run_manifest.json` (elapsed: 22,013.0s)
  - `metrics.json`
  - `results.csv`
- **Run 2 (`baseline`)**: `model/artifacts/shelf-product-yolo26l-640-baseline/`
  - `run_manifest.json` (elapsed: 21,854.5s)
  - `metrics.json`
  - `results.csv`
- **Run 3 (`recall`)**: `model/artifacts/shelf-product-yolo26l-640-recall/`
  - `run_manifest.json` (elapsed: 11,554.8s)
  - `metrics.json`
  - `results.csv`
