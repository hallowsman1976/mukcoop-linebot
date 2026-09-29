#!/usr/bin/env node
/**
 * prepare-import.js — แปลงไฟล์ทะเบียนสมาชิกเดิม (CSV) เป็นไฟล์พร้อมวางลงชีต Members
 *
 *   node tools/prepare-import.js import/members.csv [import/members-import.csv]
 *
 * - เลขประจำตัวประชาชนถูกแฮช (HMAC-SHA256 ด้วย ID_HASH_SALT) ที่เครื่องนี้ ไม่ส่งขึ้น Sheet
 * - ไฟล์ผลลัพธ์ "ไม่มีแถวหัวตาราง" เพื่อใช้ Import → Append to current sheet ได้เลย
 * - ID_HASH_SALT อ่านจาก .env ถ้ายังไม่มีจะสร้างให้และเขียนลง .env (ต้องนำไปตั้งใน Script Properties ด้วยค่าเดียวกัน)
 * - ไม่พิมพ์เลขประจำตัวประชาชนลงหน้าจอ แจ้งปัญหาเป็นเลขบรรทัดเท่านั้น
 * - ไม่พึ่งแพ็กเกจภายนอก ไฟล์ต้นทางเป็น CSV แบบ UTF-8 (Excel: Save As → CSV UTF-8)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

// หัวคอลัมน์ที่รู้จัก (เพิ่มชื่อที่ใช้จริงได้ที่นี่)
const ALIASES = {
  memberNo: ['เลขสมาชิก', 'รหัสสมาชิก', 'เลขทะเบียนสมาชิก', 'memberno', 'member_no', 'member no', 'member_id'],
  nationalId: ['เลขประจำตัวประชาชน', 'เลขบัตรประชาชน', 'เลขบัตร', 'เลขที่บัตรประชาชน', 'nationalid', 'national_id', 'idcard', 'id_card', 'citizen_id'],
  fullName: ['ชื่อ-นามสกุล', 'ชื่อ-สกุล', 'ชื่อสกุล', 'ชื่อ นามสกุล', 'ชื่อ', 'fullname', 'full_name', 'name'],
  phone: ['เบอร์โทร', 'เบอร์โทรศัพท์', 'โทรศัพท์', 'มือถือ', 'phone', 'tel', 'mobile'],
  group: ['กลุ่ม', 'ประเภทสมาชิก', 'สาขา', 'group'],
  tags: ['แท็ก', 'tags']
};

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).forEach(l => {
    const i = l.indexOf('=');
    if (i > 0) out[l.slice(0, i)] = l.slice(i + 1);
  });
  return out;
}

function getSalt() {
  const env = readEnv();
  if (env.ID_HASH_SALT) return { salt: env.ID_HASH_SALT, created: false };
  const salt = crypto.randomBytes(32).toString('hex');
  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(ENV_FILE, prefix + 'ID_HASH_SALT=' + salt + '\n');
  return { salt, created: true };
}

/** อ่าน CSV (RFC 4180 แบบย่อ: เครื่องหมายคำพูด, "" เป็น escape, ขึ้นบรรทัดใหม่ในช่องได้) */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

function csvCell(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** ตรวจหลักสุดท้ายของเลขประจำตัวประชาชน (สูตรเดียวกับ backend/Register.js) */
function validNationalId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

function normPhone(v) {
  let p = String(v || '').replace(/[\s-]/g, '');
  if (/^[89]\d{8}$/.test(p) || /^[2-7]\d{7}$/.test(p)) p = '0' + p; // Excel ตัดเลข 0 นำหน้าทิ้ง
  return p;
}

function findColumns(header) {
  const norm = h => h.trim().toLowerCase();
  const idx = {};
  Object.keys(ALIASES).forEach(k => {
    idx[k] = header.findIndex(h => ALIASES[k].indexOf(norm(h)) !== -1);
  });
  return idx;
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('วิธีใช้: node tools/prepare-import.js <ไฟล์ทะเบียน.csv> [ไฟล์ผลลัพธ์.csv]');
    process.exit(1);
  }
  const outPath = output || path.join(path.dirname(input), 'members-import.csv');
  const rows = parseCsv(fs.readFileSync(input, 'utf8'));
  if (rows.length < 2) { console.error('ไฟล์ไม่มีข้อมูล'); process.exit(1); }

  const header = rows.shift();
  const col = findColumns(header);
  const missing = ['memberNo', 'nationalId', 'fullName'].filter(k => col[k] === -1);
  if (missing.length) {
    console.error('ไม่พบคอลัมน์ที่จำเป็น: ' + missing.join(', '));
    console.error('หัวคอลัมน์ในไฟล์: ' + header.map(h => JSON.stringify(h.trim())).join(', '));
    console.error('เปลี่ยนชื่อหัวคอลัมน์ให้ตรง หรือเพิ่มชื่อใน ALIASES ของสคริปต์นี้');
    process.exit(1);
  }

  const { salt, created } = getSalt();
  const now = new Date().toISOString();
  const seenNo = new Map();
  const seenId = new Set();
  const out = [];
  const problems = { badId: [], noMemberNo: [], dupNo: [], dupId: [], noName: [] };

  rows.forEach((r, i) => {
    const line = i + 2; // เลขบรรทัดในไฟล์ต้นทาง (รวมหัวตาราง)
    const get = k => (col[k] === -1 ? '' : String(r[col[k]] || '').trim());
    const memberNo = get('memberNo').toUpperCase();
    const nationalId = get('nationalId').replace(/[\s-]/g, '');
    if (!memberNo) return problems.noMemberNo.push(line);
    if (!get('fullName')) return problems.noName.push(line);
    if (!validNationalId(nationalId)) return problems.badId.push(line);
    if (seenNo.has(memberNo)) return problems.dupNo.push(line + ' (ซ้ำกับบรรทัด ' + seenNo.get(memberNo) + ')');
    if (seenId.has(nationalId)) return problems.dupId.push(line);
    seenNo.set(memberNo, line);
    seenId.add(nationalId);

    const idHash = crypto.createHmac('sha256', salt).update(nationalId).digest('hex');
    // ลำดับต้องตรง SCHEMA.Members ใน backend/Db.js:
    // MemberID, LineUserID, DisplayName, FullName, Phone, MemberNo, Status, Group, Tags, Following, Note, CreatedAt, UpdatedAt, IdHash
    out.push([
      'MI' + String(out.length + 1).padStart(5, '0'), '', '', get('fullName'), normPhone(get('phone')), memberNo,
      'imported', get('group'), get('tags'), 'FALSE', '', now, now, idHash
    ]);
  });

  fs.writeFileSync(outPath, out.map(r => r.map(csvCell).join(',')).join('\n') + '\n', 'utf8');

  console.log('อ่านทั้งหมด ' + rows.length + ' แถว → พร้อมนำเข้า ' + out.length + ' แถว');
  console.log('ไฟล์ผลลัพธ์ (ไม่มีเลขบัตร): ' + outPath);
  const labels = {
    badId: 'เลขประจำตัวประชาชนว่าง/ผิดรูปแบบ/หลักตรวจสอบไม่ผ่าน', noMemberNo: 'ไม่มีเลขสมาชิก', noName: 'ไม่มีชื่อ',
    dupNo: 'เลขสมาชิกซ้ำ', dupId: 'เลขประจำตัวประชาชนซ้ำ'
  };
  let bad = 0;
  Object.keys(problems).forEach(k => {
    if (!problems[k].length) return;
    bad += problems[k].length;
    console.error('⚠ ' + labels[k] + ' ' + problems[k].length + ' แถว — บรรทัดที่: ' + problems[k].slice(0, 30).join(', ') + (problems[k].length > 30 ? ' ...' : ''));
  });
  if (created) {
    console.log('\nสร้าง ID_HASH_SALT ใหม่และบันทึกใน .env แล้ว → ต้องเพิ่ม Script Property ชื่อ ID_HASH_SALT ด้วยค่าเดียวกัน');
    console.log('(เปิดค่าจาก .env ด้วยตัวเอง ห้ามส่งต่อหรือ commit) ห้ามเปลี่ยน salt ภายหลัง ไม่งั้นแฮชเดิมใช้ไม่ได้');
  }
  console.log('\nขั้นต่อไป: ตรวจไฟล์ผลลัพธ์ → วางลงชีต Members (ดู README หัวข้อ "นำเข้าสมาชิก") → ลบไฟล์ต้นฉบับที่มีเลขบัตร');
  if (bad) process.exit(2);
}

main();
