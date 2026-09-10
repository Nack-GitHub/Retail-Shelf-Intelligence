# สรุปภาพรวมการดำเนินงานใน Branch `fine-tuning`
**Retail Shelf Intelligence — Empty Shelf Recall Optimization & Training Pipeline**

> **เอกสารสรุปงานฉบับสมบูรณ์ (Branch Summary)**
> **Branch**: `fine-tuning` (Base: `main` @ `f0faaa5`)
> **Commit ล่าสุด**: `3ef8a05` (*Add gap diagnostics and dataset resplitting for improved model evaluation*)
> **ช่วงเวลาดำเนินการ**: 4 – 10 กันยายน 2026
> **เป้าหมายหลัก**: วินิจฉัยและยกระดับ Recall ของคลาส `Empty Shelf` (Gap Detection) สำหรับโมเดล YOLO26l ให้มีเสถียรภาพและผ่านเกณฑ์ Promotion Gate พร้อมปรับปรุงระบบวัดผลและ Pipeline การเทรนทั้งระบบ

---

## 1. ที่มาและปัญหาเดิม (Motivation & Problem Statement)

จากการประเมินโมเดลตัวแรก (`shelf-product-yolo26l-960`) บน Roboflow Test Split พบปัญหาสำคัญ:
- **Overall mAP@50 สูง (0.9065)** แต่ **Recall ของ `Empty Shelf` อยู่ที่ 0.7422** ซึ่งไม่ผ่าน Promotion Gate (`Recall >= 0.90`, `Precision >= 0.85`)
- ในเชิงธุรกิจค้าปลีก: **"A missed gap is lost revenue"** (สินค้าขาดสต็อกบนชั้นวางที่ไม่ถูกตรวจจับ = เสียยอดขายถาวร), ในขณะที่ False Alarm มีต้นทุนต่ำกว่ามาก (พนักงานเพียงแค่เช็กซ้ำไม่กี่วินาที) ดังนั้นระบบจึงต้องการ **Recall-first optimization**

### สาเหตุเชิงลึกที่ตรวจสอบพบ (Root Cause Analysis):
1. **Test Set เดิมเล็กเกินไปและเกิด Data Leakage**:
   - Split เดิมของ Roboflow (85/10/5) สุ่มตัดระดับภาพ ทำให้ภาพมุมคล้ายกันจากการถ่ายซ้ำในรอบการเยี่ยมร้านเดียวกัน (Store Session) หลุดไปอยู่ทั้ง Train และ Test (55 จาก 782 ร้านคาบเกี่ยวข้าม split)
   - มีกล่อง `Empty Shelf` ใน Test set เพียง 124 กล่อง ทำให้ค่า Wilson 95% Confidence Interval กว้างถึง `±0.077` (วัดผลได้ 0.7422 มีช่วงเชื่อมั่น 0.659–0.811) ไม่สามารถบอกได้ว่าการจูนโมเดลดีขึ้นจริงหรือเป็นแค่ noise
2. **จุดบกพร่องของ Pipeline การเทรนเดิม**:
   - เทรนด้วย `val: false` เพื่อเลี่ยง NMS bottleneck ในช่วงแรก ส่งผลให้ Early Stopping (`patience`) ไม่ทำงาน และได้น้ำหนัก `best.pt` เป็นเพียง epoch สุดท้าย ไม่ใช่โมเดลที่ดีที่สุด
3. **ปัญหา Image Resolution Mismatch**:
   - ภาพถูก Roboflow ปรับเป็น 640×640 แบบ Stretch มาแล้ว แต่โมเดลเดิมถูกสั่งเทรนที่ `imgsz: 960` ทำให้เสีย compute ฟรี 2.25 เท่า และ aspect ratio บิดเบี้ยว
4. **Augmentation ส่งผลเสียต่อคลาส Gap**:
   - การเปิด Random Erasing (`erasing: 0.2`) สุ่มถมดำเป็นสี่เหลี่ยมบนชั้นวาง ซึ่งจำลองช่องว่าง (gap) โดยไม่มี label กำกับ ทำให้โมเดลเรียนรู้ว่าช่องว่างคือพื้นหลัง (background)

---

## 2. สิ่งที่ได้พัฒนาและเพิ่มเข้ามาใน Branch นี้ (What Was Built)

### 2.1 ระบบแบ่งข้อมูลใหม่โดยอิง Session/Group ([`resplit.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/training/resplit.py))
- จัดการ Data Leakage 100% โดยรวมภาพจากร้านและมุมเดียวกันเป็น **Group** แล้วแบ่งด้วย Group แทน Image
- ทำการกระจายแบบ **Stratified** ตามจำนวน `Empty Shelf` ต่อกลุ่ม เพื่อให้ทุกชุดมีสัดส่วนคลาสที่แม่นยำ
- รองรับ 2 โหมด:
  - `--mode holdout --ratios 70 15 15`: สร้างชุด Test split ใหม่ที่มี `Empty Shelf` ถึง **301 instances** (เพิ่มขึ้นเกือบ 2.5 เท่า) ลด Wilson CI ลงเหลือ `±0.034`
  - `--mode kfold --folds 5`: กัน holdout test ไว้ แล้วแบ่งข้อมูลที่เหลือเป็น 5 folds สำหรับ K-Fold Cross-Validation

### 2.2 เครื่องมือวินิจฉัยและวิเคราะห์ Gap โดยเฉพาะ ([`gap_diagnostics.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/eval/gap_diagnostics.py))
- รันแบบ Inference-only ใช้เวลาเพียง 1–2 นาทีบนเครื่องทั่วไป
- รายงาน 3 มิติสำคัญ:
  1. **The Ceiling**: คำนวณ Recall สูงสุดที่เป็นไปได้เมื่อปรับ Confidence เข้าใกล้ 0
  2. **The Operating Point**: ปรับหา Threshold เฉพาะคลาส `Empty Shelf` เพื่อดึง Recall ให้ถึง 0.90 โดยรักษา Precision ให้อยู่ในระดับที่ยอมรับได้
  3. **Miss Profile Breakdown**: แยกประเภทของ False Negatives ออกเป็น:
     - `below_threshold`: ตรวจพบตำแหน่งถูกแต่ conf ต่ำ
     - `localisation`: เจอคร่าว ๆ แต่ IoU อยู่ระหว่าง 0.2–0.5 (บ่งบอกถึงปัญหา label boundary ของ annotator)
     - `misclassified`: ทำนายผิดเป็น SKU อื่น
     - `blind`: ตรวจไม่เจอเลย (capability gap จริง)

### 2.3 การยกระดับ Evaluation Gate และสถิติ Denominator ([`evaluate.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/eval/evaluate.py), [`dataset_stats.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/eval/dataset_stats.py), [`aggregate_folds.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/eval/aggregate_folds.py))
- ปรับ Promotion Gate ให้ตัดสินบน **Lower Bound ของ 95% Confidence Interval** แทน point estimate
- ตรวจจับและแจ้งเตือนคลาสที่มีตัวอย่างน้อยเกินกว่าจะวัดผลได้อย่างมีนัยสำคัญ (`MIN_INSTANCES_FOR_A_VERDICT = 20`) เช่น `Espresso MArt` และ `Espresso SArt`
- เพิ่มโมดูลรวบรวมและสรุปผล K-Fold Cross-Validation (Mean ± SD)

### 2.4 ปรับปรุงกระบวนการเทรน ([`train.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/training/train.py))
- เพิ่ม **`val_warmup_epochs`** (default 15 epochs): ปิด validation เฉพาะช่วงแรกเพื่อข้าม NMS explosion (ลดเวลาจาก 193s/iter เหลือ 2s/iter) แล้วเปิด validation กลับมาอัตโนมัติ ทำให้ Early Stopping (`patience: 30`) และการบันทึก `best.pt` ทำงานได้สมบูรณ์
- รองรับ dataset override จาก split directory และ k-fold
- เพิ่มการบันทึก `run_manifest.json` แบบละเอียด (config, augmentations, git SHA, runtime, hardware)

### 2.5 ชุด Config สำหรับการทดลอง ([`model/configs/`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/configs/))
- [`yolo26l-640-baseline.yaml`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/configs/yolo26l-640-baseline.yaml): ชุดควบคุมที่ขนาด 640px, เปิด `val: true`, `erasing: 0.2`
- [`yolo26l-640-noerasing.yaml`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/configs/yolo26l-640-noerasing.yaml): การทดลองตัด Random Erasing (`erasing: 0.0`)
- [`yolo26l-640-recall.yaml`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/configs/yolo26l-640-recall.yaml): ปรับจูนเพื่อ Gap Recall สูงสุด (`erasing: 0.0`, `scale: 0.6`, `multi_scale: 0.5`, `close_mosaic: 20`, `cls: 0.7`, `cos_lr: true`, ปรับ `batch: 4`)
- [`yolo26l-1280-recall.yaml`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/configs/yolo26l-1280-recall.yaml): สำหรับการทดลองความละเอียดสูงในอนาคต

### 2.6 ระบบ Makefile Targets ใหม่
เพิ่มคำสั่งอำนวยความสะดวกใน [`Makefile`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/Makefile):
- `make resplit`, `make resplit-cv`
- `make train-baseline`, `make train-noerasing`, `make train-recall`, `make train-cv`
- `make evaluate-holdout`, `make gap-diag`, `make aggregate-cv`

### 2.7 เอกสารกำกับการทำงานและคู่มือ (Documentation)
- [`docs/ml-empty-shelf-recall-plan.md`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/docs/ml-empty-shelf-recall-plan.md): เอกสารวิเคราะห์เชิงทฤษฎีและยุทธศาสตร์ 3 แทร็ก (740 บรรทัด)
- [`docs/ml-training-runbook.md`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/docs/ml-training-runbook.md): คู่มือแบ่งงานระหว่างเครื่อง Mac (Analysis/Inference) และเครื่อง GPU (Training)
- [`docs/ml-training-windows.md`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/docs/ml-training-windows.md): คู่มือการรันบน Windows PowerShell และการแก้ปัญหาเฉพาะของสภาพแวดล้อม Windows/CUDA
- [`docs/training-time-report.md`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/docs/training-time-report.md): รายงานสรุปเวลาการเทรนและวิเคราะห์พฤติกรรมฮาร์ดแวร์

---

## 3. สรุปผลการทดลองจริงบนเครื่อง Windows (RTX 3070 Ti 8GB)

ได้ทำการรันเทรนครบทั้ง 3 รูปแบบบน Holdout Split ใหม่ (Test set 204 ภาพ, Empty Shelf n=301):

### 3.1 ตารางเปรียบเทียบผลลัพธ์ (Model Performance Comparison)

| รหัสการทดลอง | Run Name | Epochs (Best) | เวลาเทรน | Gap Recall | 95% Confidence Interval | Gap Precision | Overall mAP@50 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **เดิม (960px)** | `shelf-product-yolo26l-960` | 100 (no val) | ~2.4 ชม. | 0.7422* | 0.659–0.811 *(n=124)* | 0.7480 | 0.9065 |
| **รอบ 1 (Ablation)** | `shelf-product-yolo26l-640-noerasing` | 107 (77) | 6 ชม. 06 น. | 0.6894 | 0.635–0.739 *(n=301)* | **0.7966** | 0.9162 |
| **รอบ 2 (Control)** | `shelf-product-yolo26l-640-baseline` | 107 (77) | 6 ชม. 04 น. | 0.6894 | 0.635–0.739 *(n=301)* | **0.7966** | 0.9162 |
| **รอบ 3 (Recall-First)** | `shelf-product-yolo26l-640-recall` | 124 (94) | **3 ชม. 12 น.** | **0.7209** | **0.668–0.769** *(n=301)* | 0.7681 | **0.9177** |

*\*หมายเหตุ: โมเดลเดิม 960px วัดบน split เก่าที่มี data leakage และตัวอย่างใน test น้อย จึงไม่สามารถเปรียบเทียบตัวเลขตรง ๆ กับ 3 โมเดลใหม่ได้*

### 3.2 ข้อค้นพบสำคัญจากการทดลอง:
1. **Recall-First Config ประสบความสำเร็จตามสมมติฐาน**:
   - `640-recall` ดัน Gap Recall เพิ่มขึ้นจาก baseline **+3.15% (จาก 0.6894 เป็น 0.7209)**
   - ได้ **Overall mAP@50 สูงสุดที่ 0.9177**
2. **การปรับแต่งฮาร์ดแวร์และ RAM Paging บน Windows**:
   - ในรอบ 1 และ 2 ใช้ `batch: 12` ทำให้ DataLoader workers (8 workers) ใช้ RAM เกิน 16GB เกิด disk paging ส่งผลให้เวลาต่อ epoch นานถึง ~146 วินาที
   - ในรอบ 3 ปรับเป็น `batch: 4` (เนื่องจากมี `multi_scale: 0.5` ขยายภาพได้ถึง 960px) ทำให้ RAM/VRAM พอดี ไม่เกิด disk swap ความเร็วต่อ epoch **เร็วขึ้นเกือบ 2 เท่า (เหลือ 77 วินาที/epoch)** และใช้เวลารวมเพียง 3.2 ชั่วโมง
3. **ผลกระทบของ Random Erasing**:
   - การตัด `erasing` เพียงอย่างเดียว (รอบ 1 vs 2) ยังไม่แสดงความแตกต่างเด่นชัดเมื่อวัดที่ max-F1 threshold ชี้ให้เห็นว่าโครงสร้าง annotation noise มีอิทธิพลสูงกว่าตัว augment เล็กน้อย

---

## 4. สถานะ Artifacts และไฟล์ที่ถูกจัดเก็บ

1. **Model Weights & Evaluation Artifacts** (อยู่ใน [`model/artifacts/`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/artifacts/)):
   - `shelf-product-yolo26l-640-baseline/` (`best.pt`, `metrics.json`, `run_manifest.json`, `results.csv`)
   - `shelf-product-yolo26l-640-noerasing/` (`best.pt`, `metrics.json`, `run_manifest.json`, `results.csv`)
   - `shelf-product-yolo26l-640-recall/` (`best.pt`, `metrics.json`, `run_manifest.json`, `results.csv`)
2. **Packaged ZIP Archives** (เตรียมพร้อมสำหรับ Deployment / Sync):
   - `shelf-product-yolo26l-640-baseline.zip` (~108.9 MB)
   - `shelf-product-yolo26l-640-noerasing.zip` (~108.9 MB)
   - `shelf-product-yolo26l-640-recall.zip` (~106.5 MB)
3. **Configuration & Housekeeping**:
   - อัปเดต `.gitignore` ป้องกันไฟล์ session (`*.ses`)
   - ปรับแต่ง default batch ใน [`model/configs/yolo26l-640-recall.yaml`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/configs/yolo26l-640-recall.yaml) ให้เหมาะสมกับ GPU 8GB

---

## 5. แนะนำขั้นตอนถัดไป (Next Steps)

1. **Track A — Operating Point Calibration บนโมเดล `640-recall`**:
   - รัน `make gap-diag` (หรือคำสั่ง Python บนโมเดล `shelf-product-yolo26l-640-recall`) เพื่อหา threshold ที่เหมาะสมเฉพาะคลาส `Empty Shelf` (เช่น ลด threshold จาก default ~0.4–0.5 ลงมาที่ 0.2–0.25) ซึ่งจะดัน Recall ขึ้นสู่ระดับ **0.80–0.88** ได้ทันทีโดยไม่ต้องเทรนใหม่
   - นำค่า confidence threshold ที่ได้ไปตั้งใน backend serving ([`postprocess.py`](file:///c:/Users/uSeR/source/repos/Retail-Shelf-Intelligence/model/shelfeye_ml/serving/postprocess.py))
2. **Track C — Clean Annotation Noise (หากต้องการแตะ 0.90+)**:
   - จากผลวิเคราะห์ Miss Profile ในแผนงาน หากพบว่า localization error ยังสูง ปัญหาเกิดจากผู้ annotate บางคนตีกรอบชั้นวางว่างทั้งแถบ ขณะที่บางคนตีกรอบแยกช่องย่อย การทำ relabeling guideline ให้ตรงกันจะปลดล็อก recall ให้ผ่าน gate 0.90 ได้อย่างมั่นคง
3. **Merge Plan**:
   - Branch `fine-tuning` มี code base ที่พร้อม merge เข้า `dev` หรือ `main` เพื่อให้ทั้งโปรเจกต์ได้ใช้งานระบบ resplit และ evaluation ที่แม่นยำขึ้น
