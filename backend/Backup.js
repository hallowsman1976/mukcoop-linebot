/**
 * Backup.js — สำรองฐานข้อมูล (Google Sheet) รายวัน
 *
 * ทุกวันคัดลอกทั้งไฟล์ไปโฟลเดอร์ "LineBot-CRM Backups" ใน Drive ของเจ้าของสคริปต์ เก็บย้อนหลัง 30 วัน
 * ไฟล์ที่เกินอายุถูกย้ายไปถังขยะของ Drive (กู้คืนได้อีก 30 วัน) และจะไม่ลบจนเหลือน้อยกว่า BACKUP_MIN_KEEP ชุดล่าสุด
 * เผื่อ trigger หยุดทำงานแล้วชุดเก่าถูกลบจนไม่เหลืออะไร
 * ไฟล์สำรองมีข้อมูลส่วนบุคคลเหมือนไฟล์จริง ห้ามแชร์โฟลเดอร์นี้กับใคร
 *
 * ตั้งค่าครั้งเดียว: รัน installBackupTrigger จาก Apps Script editor (ต้องอนุญาตสิทธิ์ Drive และ Triggers)
 */

const BACKUP_FOLDER_NAME = 'LineBot-CRM Backups';
const BACKUP_PREFIX = 'LineBot-CRM Backup ';
const BACKUP_KEEP_DAYS = 30;
const BACKUP_MIN_KEEP = 7;
const BACKUP_HOUR = 2; // 02:00 ตามเขตเวลาใน appsscript.json (Asia/Bangkok)

function backupFolder_() {
  const id = PROPS.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { Logger.log('[backup] folder ' + id + ' ใช้ไม่ได้ สร้างใหม่: ' + err.message); }
  }
  const folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  PROPS.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

function backupFiles_(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) out.push(f);
  }
  return out.sort((a, b) => b.getDateCreated() - a.getDateCreated()); // ใหม่สุดก่อน
}

/** ย้ายชุดสำรองที่เกินอายุไปถังขยะ (เหลือชุดล่าสุดอย่างน้อย BACKUP_MIN_KEEP ชุดเสมอ) คืนจำนวนที่ลบ */
function pruneBackups_(folder) {
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400000;
  let removed = 0;
  backupFiles_(folder).forEach((f, i) => {
    if (i >= BACKUP_MIN_KEEP && f.getDateCreated().getTime() < cutoff) {
      f.setTrashed(true);
      removed++;
    }
  });
  return removed;
}

function backupNow_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่');
  try {
    const folder = backupFolder_();
    const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm');
    const copy = DriveApp.getFileById(prop_('SPREADSHEET_ID')).makeCopy(BACKUP_PREFIX + stamp, folder);
    const removed = pruneBackups_(folder);
    return { name: copy.getName(), removed: removed, total: backupFiles_(folder).length };
  } finally {
    lock.releaseLock();
  }
}

/** ฟังก์ชันที่ trigger รายวันเรียก: ล้มเหลวแล้วแจ้งเจ้าหน้าที่ทาง LINE และบันทึก Audit */
function backupNow() {
  try {
    const r = backupNow_();
    Logger.log('backup ok: ' + JSON.stringify(r));
    audit_('system', 'backup', r.name, 'kept=' + r.total + ' pruned=' + r.removed);
  } catch (err) {
    Logger.log('[backup] FAILED: ' + (err.stack || err));
    try { notifyStaff_('⚠ สำรองข้อมูลรายวันล้มเหลว\n' + String(err.message).slice(0, 200) + '\nกรุณาแจ้งผู้ดูแลระบบ'); } catch (e) { /* ไม่ให้ error ซ้อน */ }
    throw err;
  }
}

/** รันครั้งเดียวจาก editor: ตั้ง trigger รายวัน (รันซ้ำได้ ไม่สร้างซ้ำ) แล้วสำรองทันที 1 ครั้ง */
function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(BACKUP_HOUR).create();
  backupNow();
  Logger.log('ตั้ง trigger สำรองข้อมูลทุกวันเวลา ' + BACKUP_HOUR + ':00 แล้ว');
}

function hasBackupTrigger_() {
  return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'backupNow');
}

/** ตรวจสถานะจาก editor: log เวลาสำรองล่าสุด จำนวนชุด และ trigger */
function checkBackup() {
  const s = backupStatus_();
  Logger.log('trigger: ' + (s.triggerInstalled ? 'มี' : 'ไม่มี ⚠ รัน installBackupTrigger') + ' | ชุดสำรอง: ' + s.count +
    ' | ล่าสุด: ' + (s.lastAt || 'ยังไม่เคยสำรอง ⚠') + (s.stale ? ' ⚠ เก่ากว่า 2 วัน' : ''));
}

function backupStatus_() {
  const files = backupFiles_(backupFolder_());
  const last = files.length ? files[0].getDateCreated() : null;
  return {
    triggerInstalled: hasBackupTrigger_(),
    count: files.length,
    lastAt: last ? last.toISOString() : '',
    stale: !last || Date.now() - last.getTime() > 2 * 86400000,
    keepDays: BACKUP_KEEP_DAYS
  };
}

// ---------- API (admin) ----------

function apiBackupStatus_() {
  return backupStatus_();
}

function apiBackupNow_(ctx) {
  const r = backupNow_();
  audit_(actorName_(ctx), 'backupManual', r.name, 'kept=' + r.total + ' pruned=' + r.removed);
  return r;
}
