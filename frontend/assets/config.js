// แก้ค่าเหล่านี้หลัง deploy Apps Script และสร้าง LIFF แล้ว (ไม่ใช่ความลับ — ค่าพวกนี้เห็นได้ฝั่ง client อยู่แล้ว)
window.APP_CONFIG = {
  API_BASE: 'https://script.google.com/macros/s/AKfycbwa6uPjnlZ52q-8h1OJVaxVb54MrQbsHFMonTgla9F9OWqLkhwoNkbCWAVUKVN73Y5ZeQ/exec',   // URL ที่ลงท้าย /exec
  LIFF_ID_MEMBER: '2011633554-SwCDAWbu',      // LIFF ของหน้าสมาชิก (Endpoint = https://<โดเมน>/)
  LIFF_ID_ADMIN: '2011633554-EBQikvN6'         // LIFF ของหน้าเจ้าหน้าที่ (Endpoint = https://<โดเมน>/admin/)
};
