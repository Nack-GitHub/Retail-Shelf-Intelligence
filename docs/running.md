# คู่มือการรันโปรเจกต์

ทุกคำสั่งรันจาก **root ของโปรเจกต์** เว้นแต่จะระบุไว้เป็นอย่างอื่น

---

## 1. สิ่งที่ต้องมีก่อน

| | เวอร์ชัน | ใช้ทำอะไร |
| :-- | :-- | :-- |
| Docker | รุ่นใดก็ได้ที่มี `docker compose` | postgres · redis · minio |
| Python | 3.12 | backend และ ML |
| Node | 20 ขึ้นไป | frontend |

พอร์ตทั้งหมดถูกเลื่อนออกจากค่ามาตรฐานโดยตั้งใจ เพื่อไม่ให้ชนกับอย่างอื่นที่รันอยู่บนเครื่อง

| บริการ | พอร์ต | หมายเหตุ |
| :-- | --: | :-- |
| postgres | **5433** | ค่ามาตรฐาน 5432 ถูกเลี่ยงไว้ |
| redis | **6380** | ค่ามาตรฐาน 6379 ถูกเลี่ยงไว้ |
| minio | 9000 · 9001 | 9001 คือหน้าเว็บคอนโซล |
| API | 8000 | |
| ML service | 8001 | รันเฉพาะตอนใช้โมเดลจริง |
| frontend | 3000 | |

---

## 2. ติดตั้งครั้งแรก

```bash
make setup          # สร้าง venv สองชุด + ติดตั้ง contracts package
make dataset        # แตกไฟล์ dataset (1,349 ภาพ)
make infra          # postgres + redis + minio
make migrate seed   # สร้าง schema + ข้อมูลตั้งต้น + ประวัติการเข้าร้าน
cd frontend && npm install
```

`make dataset` ต้องรันก่อน `make seed` เสมอ เพราะ seed ใช้ภาพจริงจาก dataset
เป็นประวัติการเข้าร้าน ถ้ายังไม่ได้แตกไฟล์ `make seed` จะหยุดพร้อมบอกให้รันคำสั่งนี้ก่อน

### ชื่อสินค้าที่ระบบบอกให้เติม

`backend/app/services/planogram.json` คือรายการ SKU ที่ระบบใช้ตั้งชื่อช่องว่างที่ตรวจเจอ
สร้างจาก 42 คลาสประเภทสินค้าใน class map ของ artifact ด้วย

```bash
make planogram
```

commit ไฟล์ผลลัพธ์ไว้ในรีโป และรันใหม่เมื่อเทรนด้วยรายการคลาสชุดอื่น
`priority` กับ `facings` คำนวณจากความถี่จริงใน label ไม่ได้ตั้งเอง

การค้นหาเป็นแบบ**ตามตำแหน่ง** ไม่ได้อ่านคลาสที่โมเดลตรวจเจอ — planogram จริง
ก็ทำงานแบบนี้ คือบอกว่าช่องนี้*ควรมี*อะไร ไม่ใช่ว่าตอนนี้มีอะไรอยู่

### หมวดชั้นวางที่ถ่ายได้

มี 5 หมวดในระบบ แต่**ถ่ายได้หมวดเดียวคือกาแฟ** เพราะ dataset ทั้งชุดเป็นชั้นกาแฟ
ถ่ายชั้นนมแล้วผลจะออกมาเป็นสินค้ากาแฟ อีก 4 หมวดยังแสดงอยู่บนหน้าจอแต่กดไม่ได้
พร้อมข้อความบอกเหตุผล — ลบทิ้งไปเลยจะเท่ากับบอกว่าร้านไม่มีชั้นพวกนั้น ซึ่งไม่จริง

`make setup` จะคัดลอก `backend/.env.example` เป็น `backend/.env` ให้อัตโนมัติ
ค่าเริ่มต้นใช้งานได้ทันทีสำหรับการพัฒนาบนเครื่อง

---

## 3. รันงานประจำวัน

เปิดสามอย่างนี้แล้วใช้งานได้เลย

```bash
make infra                    # ถ้ายังไม่ได้เปิด
make api worker               # API :8000 + Celery worker (รันแบบ detached)
cd frontend && npm run dev    # :3000
```

เปิด <http://localhost:3000> แล้วเลือกแพลตฟอร์ม

### บัญชีสำหรับเข้าระบบ

รหัสผ่านเดียวกันหมด: `demo1234`

| อีเมล | บทบาท | เข้าไปเจอ |
| :-- | :-- | :-- |
| `rep@shelfeye.demo` | พนักงานภาคสนาม | แอปมือถือ `/m` |
| `manager@shelfeye.demo` | ผู้จัดการพื้นที่ | แดชบอร์ด `/w` |
| `data@shelfeye.demo` | ทีมข้อมูล | แดชบอร์ด `/w` |
| `admin@shelfeye.demo` | ผู้ดูแลระบบ | แดชบอร์ด `/w` |

ระบบพาไปหน้าที่ตรงกับบทบาทให้เอง — พนักงานที่ถูกส่งไปหน้าแดชบอร์ดจะเห็นแต่ 403
และผู้จัดการที่ถูกส่งไปหน้าเส้นทางจะเห็นวันว่างเปล่า

### หยุดการทำงาน

```bash
make stop           # หยุด API, worker และ ML service (เป็น process บนเครื่อง)
make infra-stop     # docker compose stop — หยุดเฉพาะ container ของโปรเจกต์นี้
```

> `make infra-stop` ใช้ `stop` ไม่ใช่ `down` จึงไม่ลบ container และไม่แตะของโปรเจกต์อื่นบนเครื่อง

---

## 4. เดิน golden path

### แบบสคริปต์ (เร็วที่สุด ใช้ตรวจว่าระบบยังดีอยู่)

```bash
make demo
```

พิมพ์ทุกขั้นตอนออกมา ตั้งแต่ login → เส้นทาง → เช็คอิน → presign → PUT →
commit → poll → ผลลัพธ์ พร้อมยืนยันว่า Idempotency-Key ทำงาน

### แบบเดินจริงบนหน้าจอ

1. เข้าด้วย `rep@shelfeye.demo`
2. เลือกร้านจากเส้นทาง → เช็คอิน (ต้องติ๊กยืนยันว่าได้รับอนุญาตถ่ายภาพก่อน)
3. เลือกหมวดและชั้นวาง → เปิดกล้อง
4. ถ่ายภาพ (หรือกด **อัปโหลดรูปแทน** ถ้าเครื่องไม่มีกล้อง)
5. รอผล → เห็น OSA พร้อมกรอบทับบนรูปที่เพิ่งถ่าย
6. ยืนยันช่องว่างทีละจุด → เกิดรายการที่ต้องทำ
7. ปิดงาน → ถ่ายภาพหลังเติมของ → เช็คเอาต์

จากนั้นเข้าด้วย `manager@shelfeye.demo` เพื่อดูผลเดียวกันจากฝั่งผู้จัดการ
กด **ดูหลักฐาน** ในตารางร้าน จะเปิดรูปต้นฉบับพร้อมกรอบที่โมเดลวาดไว้

---

## 5. ทดสอบด้วยกล้องจริงบนมือถือ

กล้องต้องการ secure context มือถือจึงต้องเข้าถึง dev server ผ่าน HTTPS

```bash
cd frontend && npm run dev:mobile     # เสิร์ฟบน LAN พร้อม --experimental-https
```

`next.config.ts` อนุญาต origin ของ LAN และ tunnel (cloudflared, ngrok) ไว้แล้ว

ถ้ามือถือกับ API อยู่คนละเครื่อง ต้องบอก frontend ว่า API อยู่ที่ไหน เพราะมือถือ
resolve `localhost` ไม่ได้

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://192.168.1.42:8000
```

ดู [frontend/.env.example](../frontend/.env.example) ประกอบ

---

## 6. ล้างข้อมูลเดโม

```bash
make reset-db
```

ฐานข้อมูลสำหรับพัฒนาจะสะสมข้อมูลจากทุกครั้งที่รันเทสต์ พอมี capture ไม่กี่ร้อยรายการ
ทุกร้านจะอ่านเป็น OSA 100% และ "เข้าล่าสุด 0 วันก่อน" การจัดอันดับความเสี่ยงจะแบนราบ
จนเดโมไม่เหลืออะไรให้ดู คำสั่งนี้ drop แล้วสร้าง schema ใหม่พร้อม seed
และแตะเฉพาะฐานข้อมูลของโปรเจกต์นี้

`make reset-db` เรียก `make seed` ต่อให้เอง ซึ่งรวม `make seed-history` อยู่แล้ว
จึงได้ประวัติ 15 การเข้าร้านจากภาพจริงใน dataset กลับมาครบ — OSA trend 12 สัปดาห์
KPI ที่เทียบกับช่วงก่อนหน้าได้ และการจัดอันดับความเสี่ยงที่มีทั้ง HIGH / MEDIUM / LOW

`make seed-history` จะพิมพ์ตารางความเสี่ยงของทั้ง 5 ร้านออกมาหลังเสร็จ ควรอ่านตารางนั้น
ก่อนเริ่มเดโม ไม่ใช่ไปเจอตัวเลขที่ไม่คาดคิดตอนนำเสนอ

ภาพในประวัติมาจาก `train/` กับ `valid/` เท่านั้น — `test/` 66 ภาพถูกกันไว้ให้ถ่ายสด
ตอนนำเสนอ เพราะเป็นชุดเดียวที่โมเดลไม่เคยเห็น

---

## 7. การจำลองการทำงานแบบไม่มีสัญญาณ

คิวออฟไลน์เก็บงานลง IndexedDB พร้อมไฟล์ภาพ แล้วส่งเองเมื่อกลับมาออนไลน์

วิธีทดสอบที่ตรงกับของจริงที่สุดคือหยุด API ไปเลย ไม่ใช่ใช้ offline mode ของ devtools
เพราะ devtools จะตัด HMR ของ Next ไปด้วย

```bash
# 1. เช็คอินและเปิดกล้องตามปกติ (ยัง online อยู่)
# 2. หยุด API
cd backend && python3 devrun.py stop

# 3. ถ่ายภาพ / ยืนยันช่องว่าง / ปิดงาน — ทุกอย่างเข้าคิว
# 4. เปิด API กลับมา
cd backend && python3 devrun.py api && python3 devrun.py worker

# 5. เปิดหน้าไหนก็ได้ในแอปมือถือ คิวจะส่งเอง
```

ดูคิวได้ที่หน้า `/m/sync` และตรวจว่าไม่มีข้อมูลซ้ำได้ด้วย

```bash
docker exec shelfeye-postgres psql -U shelfeye -d shelfeye -c "SELECT count(*) FROM captures;"
```

---

## 8. เทสต์และการตรวจคุณภาพ

```bash
make test             # contracts (21) + backend (110) + model (20)
make check-boundary   # ล้มถ้า backend เผลอมี dependency ฝั่ง CV
make lint             # ruff check + format

cd frontend
npx tsc --noEmit
npx next lint
npm run build
```

`make test` ฝั่ง backend ต้องมี `make infra migrate` ก่อน ส่วน contracts และ model
รันได้โดยไม่ต้องมีบริการอะไรเลย

> frontend ไม่มี test framework โดยตั้งใจ — ตกลงกันไว้ว่าไม่เพิ่ม dependency
> การตรวจฝั่งนี้ใช้การเดินจริงบนหน้าจอแทน

---

## 9. สลับไปใช้โมเดลจริง

ค่าเริ่มต้นคือ `ML_CLIENT=mock` เพราะโมเดลที่เทรนไว้ **ไม่ผ่านเกณฑ์** ทั้งสามข้อ
(recall ของคลาสช่องว่างอยู่ที่ 0.4113 เทียบเกณฑ์ 0.9) — ดูได้จากหน้า
`/w/model-health` ซึ่งแสดงตัวเลขจริงพร้อมเหตุผลของแต่ละเกณฑ์

ถ้าจะสลับจริง

```bash
make train          # รันเบื้องหลัง ~2 ชม. บน M2
make evaluate       # ประเมินกับ test split เทียบเกณฑ์
make export card    # ONNX opset 17 + model_card.md
make ml             # inference service :8001

sed -i '' 's/ML_CLIENT=mock/ML_CLIENT=http/' backend/.env
make stop && make api worker
```

การสลับทั้งหมดคือ environment variable ตัวเดียว ไม่ต้องแก้ไฟล์ business logic แม้แต่ไฟล์เดียว

---

## 10. เมื่อมีปัญหา

### `address already in use` ตอนสั่ง `make api`

มี process เก่าถือพอร์ต 8000 อยู่ มักเกิดเมื่อ pid file ถูกเขียนทับ

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN     # หา PID
kill -TERM <pid>
make api
```

### แก้โค้ด backend แล้วผลลัพธ์ไม่เปลี่ยน

Celery worker เป็นคนละ process กับ API และไม่ reload เอง โค้ดใน
`services/analysis_pipeline.py` รันอยู่ใน worker

```bash
cd backend && python3 devrun.py stop && python3 devrun.py api && python3 devrun.py worker
```

### หน้าเว็บขึ้น "โหลดข้อมูลไม่สำเร็จ / ไม่พบข้อมูลที่ต้องการ"

มักแปลว่า API ยังไม่ได้ restart หลังเพิ่ม endpoint ใหม่ ตรวจก่อนว่า API ตอบอยู่

```bash
curl -s http://localhost:8000/healthz
```

### เบราว์เซอร์อัปโหลดรูปไม่ได้

ตรวจว่า MinIO ยอมรับ preflight จาก `:3000`

```bash
curl -i -X OPTIONS 'http://localhost:9000/shelfeye-raw/x.jpg' \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: PUT'
```

ต้องได้ `204` พร้อม `Access-Control-Allow-Origin`

> bucket ถูกตั้งเป็น **private** โดยตั้งใจ การเปิด `mc anonymous set download`
> จะทำให้รูปชั้นวางทุกใบเปิดสาธารณะ และทำให้ presigned URL ไม่มีความหมาย

### เปิดกล้องไม่ได้บนเดสก์ท็อป

ปกติ — หน้าถ่ายภาพจะมีปุ่ม **อัปโหลดรูปแทน** ให้ ขั้นตอนที่เหลือเหมือนกันทุกอย่าง

### ตัวเลขบนแดชบอร์ดดูแปลก ๆ ทุกร้านเป็น 100%

ฐานข้อมูลสะสมข้อมูลเทสต์ไว้ → `make reset-db` แล้ว `make demo`

---

## 11. โครงสร้างโปรเจกต์

```
backend/     FastAPI + Celery + SQLAlchemy   ไม่มี dependency ฝั่ง CV เด็ดขาด
model/       training + ONNX inference       ไม่รู้จักคำว่า "ร้าน" หรือ "OSA"
contracts/   OpenAPI 3.1 + Pydantic          สิ่งเดียวที่สองฝั่งใช้ร่วมกัน
frontend/    Next.js 16                      คุยกับ API เท่านั้น ไม่คุยกับ ML
docs/        เอกสาร                          archive/ คืองานที่เสร็จแล้ว
```

ฝั่ง frontend ทุก request ผ่าน `src/lib/api/client.ts` ที่เดียว — เป็นไฟล์เดียว
ที่รู้จัก base URL และถือ token ยกเว้นการ PUT ไฟล์ภาพขึ้น object storage
ที่ต้องเลี่ยงไป เพราะ presigned URL ถูกเซ็นมาสำหรับ method และ content type
ที่เจาะจงไว้แล้ว
