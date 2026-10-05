# Production Deployment Checklist

## Server

- Ubuntu Server 22.04/24.04 LTS
- CPU อย่างน้อย 2 vCPU, RAM 2–4 GB, Disk 20 GB
- Docker Engine และ Docker Compose Plugin
- DNS และ HTTPS Certificate

## Security

- เปลี่ยน `ADMIN_EMAIL`, `ADMIN_PASSWORD` และ `SESSION_SECRET`
- ห้าม Commit หรือส่งไฟล์ `.env` เข้า Git
- เปิดรับจากภายนอกเฉพาะ TCP 443
- Port 3000 ให้รับเฉพาะ localhost หรือ Internal Network
- ตั้ง Nginx `client_max_body_size 15m`
- จำกัดสิทธิ์อ่านโฟลเดอร์ Source Code และ `data`
- สำรองข้อมูลก่อนอัปเดตทุกครั้ง

## Reverse Proxy

ตัวอย่าง Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name pcu-dashboard.example.go.th;

    client_max_body_size 15m;
    proxy_read_timeout 60s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## Backup

- สำรองโฟลเดอร์ `data` อย่างน้อยวันละ 1 ครั้ง
- เก็บ Backup แยกจากเครื่อง Application
- ทดสอบ Restore อย่างน้อยทุก 3 เดือน
- กำหนด Retention ตามนโยบายองค์กร

## Verification

- `/healthz` ตอบ `200 OK`
- ผู้ใช้ทั่วไปดู Dashboard และข้อมูลย้อนหลังได้
- ผู้ใช้ทั่วไปอัปโหลด CSV ไม่ได้
- Admin Login และ Logout ได้
- Admin อัปโหลด CSV ได้ไม่เกิน 10 MB
- อัปโหลดเดือนใหม่แล้วเดือนเก่ายังคงอยู่
- อัปโหลดเดือนเดิมแล้วแทนที่เฉพาะเดือนนั้น
- Restart Container แล้วข้อมูลยังอยู่
