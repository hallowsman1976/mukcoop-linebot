#!/usr/bin/env node
/**
 * make-test-roster.js — สร้างทะเบียนสมาชิก "ปลอม" สำหรับทดสอบ (เลขบัตรปลอมที่หลักตรวจสอบถูกต้อง)
 *
 *   node tools/make-test-roster.js [จำนวน=6] [ไฟล์ผลลัพธ์=import/test-roster.csv]
 *
 * ใช้ทดสอบตาม docs/TEST-CHECKLIST.md: ป้อนไฟล์นี้ให้ tools/prepare-import.js แล้วนำเข้าชีต Members
 * ตารางเลขสมาชิก/เลขบัตรทดสอบถูกพิมพ์ออกหน้าจอเพื่อใช้กรอกตอนทดสอบลงทะเบียน (เป็นข้อมูลปลอมล้วน ไม่ใช่ข้อมูลจริง)
 * ห้ามใช้กับข้อมูลสมาชิกจริง และก่อนเปิดใช้งานจริงให้ลบแถวทดสอบออกจากชีต Members
 */
const fs = require('fs');
const path = require('path');

const count = Math.max(1, Number(process.argv[2]) || 6);
const out = process.argv[3] || path.join(__dirname, '..', 'import', 'test-roster.csv');

function fakeNationalId(seed) {
  const d = String(1101700000000 + seed * 7919).slice(0, 12).split('').map(Number);
  const sum = d.reduce((a, x, i) => a + x * (13 - i), 0);
  return d.join('') + ((11 - (sum % 11)) % 10);
}

const groups = ['สามัญ', 'สามัญ', 'สมทบ', 'สามัญ', 'สมทบ', 'สามัญ'];
const rows = ['เลขสมาชิก,ชื่อ-นามสกุล,เลขบัตรประชาชน,โทรศัพท์,กลุ่ม'];
const shown = [];
for (let i = 1; i <= count; i++) {
  const no = 'TEST' + String(i).padStart(3, '0');
  const id = fakeNationalId(i);
  rows.push([no, 'ทดสอบ ระบบ' + i, id, '08000000' + String(i).padStart(2, '0'), groups[(i - 1) % groups.length]].join(','));
  shown.push(no + '   ' + id);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, rows.join('\n') + '\n', 'utf8');
console.log('สร้าง ' + count + ' แถวที่ ' + out + '\n\nเลขสมาชิก  เลขบัตร (ปลอม) — จดไว้ใช้ทดสอบ\n' + shown.join('\n'));
console.log('\nถัดไป: node tools/prepare-import.js ' + out + ' import/test-import.csv');
