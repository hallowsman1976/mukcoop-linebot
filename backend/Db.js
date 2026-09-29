/**
 * Db.js — Google Sheets เป็นฐานข้อมูล
 * แต่ละชีตคือหนึ่งตาราง แถวแรกคือ header แล้ว map เป็น object ตอนอ่าน/เขียน
 */

const PROPS = PropertiesService.getScriptProperties();
const TZ = 'Asia/Bangkok';

const SCHEMA = {
  Members: ['MemberID', 'LineUserID', 'DisplayName', 'FullName', 'Phone', 'MemberNo', 'Status',
    'Group', 'Tags', 'Following', 'Note', 'CreatedAt', 'UpdatedAt', 'IdHash'],
  Tickets: ['TicketID', 'MemberID', 'LineUserID', 'Category', 'Subject', 'Detail', 'Status',
    'Priority', 'AssignedTo', 'CreatedAt', 'UpdatedAt', 'ResolvedAt'],
  TicketLogs: ['LogID', 'TicketID', 'ActorType', 'ActorName', 'Note', 'Status', 'CreatedAt'],
  Staff: ['LineUserID', 'Name', 'Role', 'Active', 'CreatedAt'],
  Broadcasts: ['BroadcastID', 'Title', 'Text', 'Audience', 'Recipients', 'SentBy', 'SentAt'],
  Audit: ['Timestamp', 'Actor', 'Action', 'Target', 'Detail'],
  AutoReplies: ['RuleID', 'Name', 'Keywords', 'MatchType', 'Reply', 'Priority', 'Active', 'UpdatedAt', 'UpdatedBy']
};

// คอลัมน์ที่ต้องเป็นข้อความเสมอ (กันเลข 0 นำหน้าของเบอร์โทร/เลขสมาชิกหาย)
const TEXT_COLUMNS = {
  Members: ['LineUserID', 'Phone', 'MemberNo'],
  Tickets: ['LineUserID'],
  Staff: ['LineUserID']
};

let ssCache_ = null;

function prop_(key, required) {
  const v = PROPS.getProperty(key);
  if (required !== false && !v) {
    Logger.log('[prop_] missing script property: ' + key);
    throw new Error('ระบบยังตั้งค่าไม่ครบ (' + key + ') กรุณาติดต่อผู้ดูแลระบบ');
  }
  return v;
}

function getSS_() {
  if (!ssCache_) ssCache_ = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  return ssCache_;
}

function sheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name + ' (รัน setupSchema ก่อน)');
  return sh;
}

/**
 * รันครั้งเดียวหลัง deploy (และรันซ้ำได้ปลอดภัยเมื่อเพิ่มคอลัมน์ใน SCHEMA)
 * - ไม่มี SPREADSHEET_ID → สร้าง Spreadsheet ใหม่ให้
 * - สร้างชีตที่ขาด และเติมคอลัมน์ที่ขาดต่อท้าย header
 */
function setupSchema() {
  let id = PROPS.getProperty('SPREADSHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('LineBot-CRM Database');
    PROPS.setProperty('SPREADSHEET_ID', ss.getId());
    Logger.log('Created spreadsheet: ' + ss.getUrl());
  }
  ssCache_ = ss;

  Object.keys(SCHEMA).forEach(name => {
    const wanted = SCHEMA[name];
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);

    const lastCol = sh.getLastColumn();
    const existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].filter(String) : [];
    const missing = wanted.filter(h => existing.indexOf(h) === -1);
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
    const headers = existing.concat(missing);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f5e9');
    sh.setFrozenRows(1);

    (TEXT_COLUMNS[name] || []).forEach(col => {
      const idx = headers.indexOf(col);
      if (idx !== -1) sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  seedAutoReplies_();

  // ลบชีตเริ่มต้นที่ว่างเปล่า
  ['Sheet1', 'ชีต1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  Logger.log('Schema ready. Spreadsheet: ' + ss.getUrl());
}

/** ตรวจว่า Script Properties ครบและไม่สลับกัน (log แค่ความยาว/ตัวอักษรแรก ไม่ log ค่าเต็ม) */
function checkConfig() {
  ['SPREADSHEET_ID', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_LOGIN_CHANNEL_ID', 'WEBHOOK_TOKEN',
    'BOOTSTRAP_ADMIN_USER_ID', 'LIFF_MEMBER_URL', 'ID_HASH_SALT'].forEach(k => {
    const v = PROPS.getProperty(k);
    Logger.log(k + ': ' + (v ? 'len=' + v.length + ' first=' + v.charAt(0) : 'MISSING'));
  });
}

// ---------- CRUD helpers ----------

function readAll_(name) {
  const sh = sheet_(name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();
  const headers = values.shift();
  return values.map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, c) => { o[h] = r[c]; });
    return o;
  });
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function append_(name, obj) {
  const sh = sheet_(name);
  const row = headers_(sh).map(h => (obj[h] === undefined ? '' : obj[h]));
  sh.appendRow(row);
  return obj;
}

/** อัปเดตแถวเดียว (ตาราง data ไม่มี merged cells จึงเขียนทั้งแถวครั้งเดียวได้) */
function update_(name, rowNumber, patch) {
  const sh = sheet_(name);
  const headers = headers_(sh);
  const range = sh.getRange(rowNumber, 1, 1, headers.length);
  const row = range.getValues()[0];
  headers.forEach((h, i) => { if (patch[h] !== undefined) row[i] = patch[h]; });
  range.setValues([row]);
}

/**
 * แก้หลายแถวพร้อมกัน: patches = [{ row, patch }] เขียนทีละคอลัมน์ (setValues ครั้งเดียวต่อคอลัมน์)
 * เร็วกว่า update_ วนทีละแถวมาก และไม่แตะคอลัมน์ที่ไม่ได้แก้
 */
function bulkPatch_(name, patches) {
  if (!patches.length) return 0;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่');
  try {
    const sh = sheet_(name);
    const headers = headers_(sh);
    const lastRow = sh.getLastRow();
    const cols = {};
    patches.forEach(p => Object.keys(p.patch).forEach(k => {
      const i = headers.indexOf(k);
      if (i !== -1) cols[i] = true;
    }));
    Object.keys(cols).forEach(ci => {
      const col = Number(ci) + 1;
      const key = headers[col - 1];
      const range = sh.getRange(2, col, lastRow - 1, 1);
      const vals = range.getValues();
      patches.forEach(p => { if (p.patch[key] !== undefined) vals[p.row - 2][0] = p.patch[key]; });
      range.setValues(vals);
    });
    return patches.length;
  } finally {
    lock.releaseLock();
  }
}

function clean_(o) {
  const c = {};
  Object.keys(o).forEach(k => { if (k !== '_row' && k !== 'IdHash') c[k] = o[k]; });
  return c;
}

/** ID อ่านง่าย เช่น T260929-001 (นับต่อวัน ใส่ lock กันเลขซ้ำ) */
function nextId_(prefix) {
  const day = Utilities.formatDate(new Date(), TZ, 'yyMMdd');
  const key = 'SEQ_' + prefix + day;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่');
  try {
    const n = Number(PROPS.getProperty(key) || 0) + 1;
    PROPS.setProperty(key, String(n));
    return prefix + day + '-' + ('000' + n).slice(-3);
  } finally {
    lock.releaseLock();
  }
}

function audit_(actor, action, target, detail) {
  try {
    append_('Audit', {
      Timestamp: new Date(), Actor: actor, Action: action, Target: target || '',
      Detail: detail ? String(detail).slice(0, 500) : ''
    });
  } catch (err) {
    Logger.log('[audit_] failed: ' + err);
  }
}

function truthy_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}
