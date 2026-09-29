// แก้ค่าเหล่านี้หลัง deploy Apps Script และสร้าง LIFF แล้ว (ไม่ใช่ความลับ — ค่าพวกนี้เห็นได้ฝั่ง client อยู่แล้ว)
window.APP_CONFIG = {
  API_BASE: 'https://script.google.com/macros/s/AKfycbxqW3TZueeuGVbX6Tx9TO80EJ6aGV_v7UITqRrnQGnJGNPLL86hNuHh7vhmLVWXrZxY/exec',   // URL ที่ลงท้าย /exec
  LIFF_ID_MEMBER: 'YOUR_MEMBER_LIFF_ID',      // LIFF ของหน้าสมาชิก (Endpoint = https://<โดเมน>/)
  LIFF_ID_ADMIN: 'YOUR_ADMIN_LIFF_ID'         // LIFF ของหน้าเจ้าหน้าที่ (Endpoint = https://<โดเมน>/admin/)
};
