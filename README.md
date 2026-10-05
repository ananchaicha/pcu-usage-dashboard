# Dashboard การใช้งานระบบแพลตฟอร์มกลาง รพ.สต. — Portable Server

ชุด Source Code สำหรับติดตั้งบน Linux Server โดยไม่ผูกกับ ChatGPT Sites

## ความสามารถ

- Dashboard เปิดดูได้โดยไม่ต้อง Login
- Admin Login ด้วยอีเมลและรหัสผ่านที่กำหนดบน Server
- เฉพาะ Admin สามารถอัปโหลด CSV และส่งออกผลกรอง
- เก็บ CSV แยกตามเดือนและเรียกดูย้อนหลังได้
- ข้อมูลอยู่ใน `data/datasets` ซึ่งผูกกับพื้นที่ถาวรของ Server
- มี Health Check ที่ `/healthz`
- ไม่ต้องติดตั้งฐานข้อมูล

## ติดตั้งด้วย Docker Compose

ต้องมี Docker Engine และ Docker Compose Plugin

```bash
cp .env.example .env
```

แก้ไข `.env` โดยกำหนดอย่างน้อย:

```env
ADMIN_EMAIL=your-admin@example.go.th
ADMIN_PASSWORD=รหัสผ่านที่คาดเดายากอย่างน้อย 12 ตัวอักษร
SESSION_SECRET=ค่าสุ่มความยาวอย่างน้อย 32 ตัวอักษร
```

สร้าง `SESSION_SECRET` บน Linux ได้ด้วย:

```bash
openssl rand -hex 32
```

เริ่มระบบ:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/healthz
```

ระบบรับการเชื่อมต่อเฉพาะ `127.0.0.1:3000` ให้ติดตั้ง Nginx หรือ Reverse Proxy ด้านหน้าและเปิดใช้งาน HTTPS

## การเก็บและสำรองข้อมูล

- CSV: `data/datasets/YYYY-MM.csv`
- Metadata: `data/datasets/YYYY-MM.json`
- สำรองโฟลเดอร์ `data` ทั้งหมด
- ก่อน Restore ให้หยุด Container แล้วนำโฟลเดอร์ `data` กลับมาวางตำแหน่งเดิม

## อัปเดตระบบ

```bash
docker compose down
docker compose up -d --build
```

คำสั่งนี้ไม่ลบข้อมูลใน `data` ห้ามใช้คำสั่งที่ลบโฟลเดอร์ดังกล่าวหากยังไม่ได้สำรองข้อมูล

## ทดสอบ Source Code

ใช้ Node.js 20 ขึ้นไป:

```bash
npm test
```

## Production Checklist

ดูรายละเอียดใน `DEPLOYMENT-CHECKLIST.md`
