/**
 * Register.js — ลงทะเบียนโดยจับคู่กับทะเบียนสมาชิกที่นำเข้าไว้ล่วงหน้า
 *
 * ทะเบียนเดิมถูกนำเข้าเป็นแถวใน Members (Status = imported, LineUserID ว่าง) พร้อม IdHash
 * ผู้ใช้กรอก เลขสมาชิก + เลขประจำตัวประชาชน → ถ้าแฮชตรง แถวนั้นผูกกับ LINE userId ที่ verify แล้วและเป็น active ทันที
 *
 * เลขประจำตัวประชาชนไม่ถูกเก็บลง Sheet หรือ log ที่ใดเลย เก็บเฉพาะ HMAC-SHA256 โดยใช้ ID_HASH_SALT
 * (Script Property — อย่าเก็บ salt ไว้ใน Sheet) สคริปต์ฝั่งเครื่อง tools/prepare-import.js คำนวณแฮชด้วยสูตรเดียวกัน
 */

const REG_MAX_FAIL_PER_USER = 5;
const REG_MAX_FAIL_PER_MEMBERNO = 10;
const REG_LOCK_SECONDS = 1800; // 30 นาที (นับจากครั้งที่ผิดล่าสุด)

const REG_NO_MATCH_MSG = 'ข้อมูลไม่ตรงกับทะเบียนสมาชิก กรุณาตรวจสอบอีกครั้ง หากยังไม่ได้ กรุณาติดต่อเจ้าหน้าที่';

function normMemberNo_(v) {
  return String(v === undefined || v === null ? '' : v).trim().toUpperCase();
}

/** ตรวจรูปแบบเลขประจำตัวประชาชน 13 หลัก + หลักตรวจสอบ (คืนเลขล้วน หรือ throw) */
function normalizeNationalId_(v) {
  const id = String(v === undefined || v === null ? '' : v).replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(id)) throw new Error('เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id.charAt(i)) * (13 - i);
  if ((11 - (sum % 11)) % 10 !== Number(id.charAt(12))) throw new Error('เลขประจำตัวประชาชนไม่ถูกต้อง');
  return id;
}

function idHash_(nationalId) {
  const bytes = Utilities.computeHmacSha256Signature(nationalId, prop_('ID_HASH_SALT'));
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- ล็อกเมื่อกรอกผิดหลายครั้ง (เก็บใน CacheService ตามเวลา 30 นาที) ----------

function failKeys_(userId, memberNo) {
  return { user: 'regfail_u_' + userId, memberNo: 'regfail_m_' + Utilities.base64EncodeWebSafe(memberNo) };
}

function assertNotLocked_(userId, memberNo) {
  const cache = CacheService.getScriptCache();
  const k = failKeys_(userId, memberNo);
  if (Number(cache.get(k.user) || 0) >= REG_MAX_FAIL_PER_USER ||
      Number(cache.get(k.memberNo) || 0) >= REG_MAX_FAIL_PER_MEMBERNO) {
    audit_(userId, 'registerLocked', memberNo, '');
    throw new Error('กรอกข้อมูลผิดหลายครั้ง กรุณาลองใหม่อีกครั้งใน 30 นาที หรือติดต่อเจ้าหน้าที่');
  }
}

function recordFailure_(userId, memberNo, reason) {
  const cache = CacheService.getScriptCache();
  const k = failKeys_(userId, memberNo);
  cache.put(k.user, String(Number(cache.get(k.user) || 0) + 1), REG_LOCK_SECONDS);
  cache.put(k.memberNo, String(Number(cache.get(k.memberNo) || 0) + 1), REG_LOCK_SECONDS);
  audit_(userId, 'registerFail', memberNo, reason); // ห้ามใส่เลขบัตรที่กรอกมา
}

// ---------- จับคู่ ----------

function linkMemberByRoster_(ctx, p) {
  const userId = ctx.identity.userId;
  if (p.consent !== true) throw new Error('กรุณายอมรับการเก็บและใช้ข้อมูลส่วนบุคคลก่อนลงทะเบียน');
  const memberNo = normMemberNo_(str_(p.memberNo, 30, 'เลขสมาชิก', true));
  const nationalId = normalizeNationalId_(p.nationalId);
  assertNotLocked_(userId, memberNo);

  // lock กันสองบัญชี LINE แย่งผูกแถวเดียวกันพร้อมกัน
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่');
  try {
    const row = readAll_('Members').find(m =>
      normMemberNo_(m.MemberNo) === memberNo && m.Status === 'imported' && !String(m.LineUserID));
    // เทียบแฮชเสมอแม้ไม่พบแถว เพื่อไม่ให้เวลาตอบต่างกันจนรู้ว่าเลขสมาชิกมีอยู่
    const hash = idHash_(nationalId);
    if (!row || !row.IdHash || !safeEqual_(row.IdHash, hash)) {
      recordFailure_(userId, memberNo, row ? 'mismatch' : 'no-roster');
      throw new Error(REG_NO_MATCH_MSG);
    }

    update_('Members', row._row, {
      LineUserID: userId, DisplayName: ctx.identity.name, Status: 'active',
      Following: isFollowing_(userId), UpdatedAt: new Date()
    });
    const cache = CacheService.getScriptCache();
    const k = failKeys_(userId, memberNo);
    cache.remove(k.user);
    cache.remove(k.memberNo);
    audit_(userId, 'registerLinked', row.MemberID, 'consent=1');
  } finally {
    lock.releaseLock();
  }
  applyRichMenu_(userId);
  pushText_(userId, '✅ ลงทะเบียนสำเร็จ\nสามารถแจ้งเรื่องและติดตามสถานะผ่านเมนูได้เลย');
  return { linked: true };
}

/** ผู้ใช้เป็นเพื่อนกับ OA และไม่ได้บล็อกอยู่หรือไม่ (get profile สำเร็จ = ส่งข้อความหาได้) */
function isFollowing_(userId) {
  try {
    callLine_('get', '/profile/' + encodeURIComponent(userId));
    return true;
  } catch (err) {
    return false;
  }
}

// ---------- เครื่องมือผู้ดูแล (รันจาก Apps Script editor) ----------

/** ตรวจผลหลังวางไฟล์นำเข้าลง Members: log เฉพาะจำนวน ไม่ log ข้อมูลส่วนบุคคล */
function verifyImport() {
  const rows = readAll_('Members');
  const imported = rows.filter(m => m.Status === 'imported');
  const seen = {};
  const dupes = [];
  imported.forEach(m => {
    const k = normMemberNo_(m.MemberNo);
    if (seen[k]) dupes.push(k); else seen[k] = true;
  });
  const noHash = imported.filter(m => !m.IdHash || String(m.IdHash).length !== 64).length;
  const noNo = imported.filter(m => !normMemberNo_(m.MemberNo)).length;
  const phoneLost0 = imported.filter(m => m.Phone && !/^0/.test(String(m.Phone))).length;
  Logger.log('Members ทั้งหมด: ' + rows.length + ' | imported: ' + imported.length);
  Logger.log('imported ที่ IdHash ผิดรูปแบบ/ว่าง: ' + noHash + ' | ไม่มีเลขสมาชิก: ' + noNo);
  Logger.log('เลขสมาชิกซ้ำ: ' + dupes.length + (dupes.length ? ' (' + dupes.slice(0, 10).join(', ') + ')' : ''));
  Logger.log('เบอร์โทรที่ไม่ขึ้นต้นด้วย 0 (เลข 0 อาจหายตอนนำเข้า): ' + phoneLost0);
  Logger.log(!noHash && !noNo && !dupes.length && !phoneLost0 ? 'ผ่าน ✅' : 'มีปัญหา ⚠ ตรวจตามรายการข้างบน');
}
