# คู่มือ: Deploy ขึ้น Netlify และตั้งค่า LINE LIFF

เอกสารนี้ครอบคลุมเฉพาะ Frontend (โฟลเดอร์ `frontend/`) และ LIFF
ส่วน Backend (Apps Script) ดู [README.md](../README.md) หัวข้อ "ติดตั้ง"

## ภาพรวมลำดับการทำงาน

LIFF ต้องมี Endpoint URL ก่อน แต่ Netlify ต้องมี LIFF ID ใน `config.js` ก่อน จึงทำเป็นวงกลม 2 รอบ:

1. Deploy Netlify ครั้งแรก เพื่อให้ได้โดเมน
2. สร้าง LIFF (ใส่โดเมนเป็น Endpoint) เพื่อให้ได้ LIFF ID
3. ใส่ LIFF ID ใน `config.js` แล้ว Deploy Netlify อีกครั้ง

## เตรียมของก่อนเริ่ม

| สิ่งที่ต้องมี | ได้จากไหน |
|---|---|
| Web App URL ของ Apps Script (ลงท้าย `/exec`) | `clasp deployments` หรือ Apps Script → Deploy → Manage deployments |
| LINE Login channel (อยู่ใน Provider เดียวกับ Messaging API) | LINE Developers Console |
| บัญชี Netlify | https://app.netlify.com |

> ต้องเป็น **LINE Login channel** เท่านั้นถึงจะเพิ่ม LIFF ได้ Messaging API channel ไม่มีแท็บ LIFF
> และต้องอยู่ Provider เดียวกัน ไม่งั้น userId จะไม่ตรงกัน

---

## ส่วนที่ 1: Deploy ขึ้น Netlify

โปรเจกต์มี [netlify.toml](../netlify.toml) ตั้ง `publish = "frontend"` ไว้แล้ว และไม่ต้อง build

### วิธี A: ลากวาง (ง่ายสุด เหมาะกับทำครั้งแรก)

1. เข้า https://app.netlify.com → **Add new site** → **Deploy manually**
2. ลากโฟลเดอร์ `frontend` (ทั้งโฟลเดอร์) วางลงในกรอบ
3. รอสักครู่ จะได้โดเมนแบบ `https://ชื่อสุ่ม.netlify.app`
4. (แนะนำ) **Site configuration → Change site name** ตั้งชื่อให้จำง่าย เช่น `coop-linebot`
   ได้โดเมน `https://coop-linebot.netlify.app`

### วิธี B: Netlify CLI

```bash
npm i -g netlify-cli
netlify login
cd D:/Sniper/งานสหกรณ์/Web-App/LineBot-CRM
netlify deploy --prod --dir=frontend
```

ครั้งแรกจะถามให้สร้างไซต์ใหม่ ตอบ **Create & configure a new project**
ครั้งต่อไปใช้คำสั่ง `netlify deploy --prod --dir=frontend` เหมือนเดิม

### วิธี C: ต่อกับ Git (Deploy อัตโนมัติเมื่อ push)

ตอนนี้โปรเจกต์ยังไม่ใช่ git repo ถ้าจะใช้วิธีนี้ต้อง `git init` และ push ขึ้น GitHub ก่อน
แล้วที่ Netlify เลือก **Import from Git** ตั้ง Publish directory = `frontend`, Build command เว้นว่าง

### ตรวจว่า Deploy ผ่าน

เปิด `https://<โดเมน>/` ควรเห็นหน้าเว็บ (ถ้ายังไม่ตั้ง LIFF ID จะขึ้นข้อความ "ยังไม่ได้ตั้งค่า LIFF ID" ถือว่าปกติ)
และเปิด `https://<โดเมน>/admin/` ต้องขึ้นหน้าเจ้าหน้าที่

---

## ส่วนที่ 2: ตั้งค่า LINE LIFF

### 2.1 สร้าง LIFF ทั้ง 2 ตัว

1. เข้า https://developers.line.biz/console/
2. เลือก Provider → เลือก **LINE Login channel** (ถ้ายังไม่มี ให้ Create a new channel → LINE Login)
3. เปิดแท็บ **LIFF** → **Add**

สร้างตัวที่ 1: **หน้าสมาชิก**

| ช่อง | ค่า |
|---|---|
| LIFF app name | `สมาชิก` |
| Size | **Full** |
| Endpoint URL | `https://<โดเมน netlify>/` (ลงท้าย `/`) |
| Scope | ติ๊ก **profile** และ **openid** |
| Bot link feature | ปิด หรือ On (Normal) ตามต้องการ |

สร้างตัวที่ 2: **หน้าเจ้าหน้าที่**

| ช่อง | ค่า |
|---|---|
| LIFF app name | `เจ้าหน้าที่` |
| Size | **Full** |
| Endpoint URL | `https://<โดเมน netlify>/admin/` (ลงท้าย `/`) |
| Scope | **profile** และ **openid** |

หลังกด Add จะได้ **LIFF ID** (รูปแบบ `1234567890-AbCdEfGh`) จดทั้ง 2 ตัวไว้

> **openid ต้องติ๊กเสมอ** ระบบใช้ `liff.getIDToken()` ยืนยันตัวตนกับ backend ถ้าไม่ติ๊กจะ login ไม่ผ่าน

### 2.2 ใส่ค่าใน config.js

แก้ [frontend/assets/config.js](../frontend/assets/config.js):

```js
window.APP_CONFIG = {
  API_BASE: 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec',
  LIFF_ID_MEMBER: '<LIFF ID สมาชิก>',
  LIFF_ID_ADMIN: '<LIFF ID เจ้าหน้าที่>'
};
```

ข้อควรระวังเรื่อง `API_BASE`: ตอนนี้ไฟล์ชี้ไปที่ deployment `AKfycbxqW3TZ…` (@1)
ซึ่งเป็นตัวเก่า ก่อนแก้ต้องตัดสินใจว่าจะใช้ตัวไหน:

- ใช้ URL เดิม: อัปเดตโค้ดใน deployment เดิมด้วย
  `clasp deploy -i AKfycbxqW3TZueeuGVbX6Tx9TO80EJ6aGV_v7UITqRrnQGnJGNPLL86hNuHh7vhmLVWXrZxY -d "update"`
- ใช้ deployment ใหม่ (@2): เปลี่ยน `API_BASE` เป็น URL ของ `AKfycbx2jUqCuMAvGCzNqk4Jvb2E5V9ae0-…`

จากนั้น **Deploy Netlify อีกครั้ง** (ส่วนที่ 1) ให้ `config.js` ใหม่ขึ้นไป

### 2.3 ตั้งค่าที่ฝั่ง Apps Script

Project Settings → Script properties:

| Key | ค่า |
|---|---|
| `LINE_LOGIN_CHANNEL_ID` | Channel ID ของ **LINE Login channel** (แท็บ Basic settings) |
| `LIFF_MEMBER_URL` | `https://liff.line.me/<LIFF ID สมาชิก>` |

ระวังอย่าสลับกับ Channel ID ของ Messaging API แล้วรัน `checkConfig` เพื่อตรวจว่าค่าครบ

### 2.4 เปิดใช้งาน Channel

ในหน้า LINE Login channel เปลี่ยนสถานะจาก **Developing** เป็น **Published**
ถ้ายังเป็น Developing จะมีแค่ผู้ที่ถูกเพิ่มเป็น Admin/Tester ของ channel เท่านั้นที่เปิด LIFF ได้

### 2.5 ผูกกับ Rich Menu / ข้อความ

ลิงก์เปิดหน้าสมาชิก: `https://liff.line.me/<LIFF ID สมาชิก>`
ลิงก์เปิดหน้าเจ้าหน้าที่: `https://liff.line.me/<LIFF ID เจ้าหน้าที่>`

ใช้ลิงก์รูปแบบนี้ใน Rich Menu หรือส่งในแชต ห้ามใช้ URL ของ Netlify ตรง ๆ เพราะจะไม่ได้ context ของ LINE

---

## ทดสอบ

1. เปิดลิงก์ `https://liff.line.me/<LIFF ID สมาชิก>` จากมือถือ (ในแอป LINE)
2. ควรเด้งหน้า login ของ LINE ครั้งแรก แล้วกลับมาที่หน้าลงทะเบียน
3. เปิดหน้าเจ้าหน้าที่ด้วยบัญชีแอดมิน (`BOOTSTRAP_ADMIN_USER_ID`) ต้องเข้าได้
4. ดูรายการตรวจทั้งหมดที่ [TEST-CHECKLIST.md](TEST-CHECKLIST.md)

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| "ยังไม่ได้ตั้งค่า LIFF ID ใน assets/config.js" | ยังไม่ได้แก้ `config.js` หรือยังไม่ได้ Deploy Netlify ซ้ำ |
| "ยังไม่ได้ตั้งค่า API_BASE" | `API_BASE` ยังเป็นค่า `YOUR_...` หรือว่าง |
| หน้าขาวหรือค้างที่ `liff.init` | Endpoint URL ของ LIFF ไม่ตรงโดเมนจริง หรือลืม `/` ท้าย URL |
| login แล้ววนกลับหน้า login | ไม่ได้ติ๊ก **openid** หรือ `LINE_LOGIN_CHANNEL_ID` ผิด (ไปใส่ของ Messaging API) |
| เรียก API แล้ว error `AUTH` | ID token ตรวจไม่ผ่าน ตรวจ `LINE_LOGIN_CHANNEL_ID` ให้ตรงกับ channel ที่สร้าง LIFF |
| เรียก API แล้ว CORS / เจอหน้า Google login | Web App ต้องตั้ง Who has access = **Anyone** และใช้ URL `/exec` (ไม่ใช่ `/dev`) |
| แก้ `config.js` แล้วหน้าไม่เปลี่ยน | Netlify ยังไม่ได้ Deploy ใหม่ หรือเบราว์เซอร์ cache ลอง Clear cache ใน LINE |
| คนอื่นเปิด LIFF ไม่ได้ | LINE Login channel ยังเป็น Developing ให้เปลี่ยนเป็น Published |
| เปลี่ยนโดเมน Netlify | ต้องกลับไปแก้ Endpoint URL ของ LIFF ทั้ง 2 ตัวให้ตรง |
