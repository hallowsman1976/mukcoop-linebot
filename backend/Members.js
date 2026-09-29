/**
 * Members.js — ทะเบียนสมาชิก/ลูกค้า
 * สถานะ: imported (นำเข้าจากทะเบียน ยังไม่ผูก LINE) → active → inactive
 * (pending = สถานะเดิมที่เจ้าหน้าที่ตั้งเองได้ ระบบลงทะเบียนใหม่ไม่สร้างแล้ว — ดู Register.js)
 */

// imported = อยู่ในทะเบียนที่นำเข้าแล้วแต่ยังไม่ผูก LINE (ไม่มี LineUserID)
const MEMBER_STATUSES = ['imported', 'pending', 'active', 'inactive'];

function str_(v, max, label, required) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (required && !s) throw new Error('กรุณากรอก' + label);
  if (s.length > max) throw new Error(label + 'ยาวเกิน ' + max + ' ตัวอักษร');
  return s;
}

function apiMe_(ctx) {
  return {
    identity: ctx.identity,
    member: ctx.member ? clean_(ctx.member) : null,
    staff: ctx.staff ? { name: ctx.staff.Name, role: ctx.staff.Role } : null
  };
}

/**
 * ลงทะเบียนครั้งแรก = จับคู่กับทะเบียนสมาชิกที่นำเข้าไว้ (เลขสมาชิก + เลขประจำตัวประชาชน) — ดู Register.js
 * สมาชิกที่ผูกแล้วใช้ route นี้แก้ชื่อ/เบอร์ของตัวเองได้ (เลขสมาชิกแก้ไม่ได้)
 */
function apiRegister_(ctx, p) {
  if (!ctx.member) return linkMemberByRoster_(ctx, p);

  const fullName = str_(p.fullName, 100, 'ชื่อ-นามสกุล', true);
  const phone = str_(p.phone, 15, 'เบอร์โทร', true).replace(/[\s-]/g, '');
  if (!/^0\d{8,9}$/.test(phone)) throw new Error('เบอร์โทรไม่ถูกต้อง (ตัวอย่าง 0812345678)');
  update_('Members', ctx.member._row, {
    DisplayName: ctx.identity.name, FullName: fullName, Phone: phone, UpdatedAt: new Date()
  });
  return { updated: true };
}

// ---------- เจ้าหน้าที่ ----------

const MEMBER_PAGE_MAX = 200;
const BULK_MAX = 2000;

function tagList_(tags) {
  return String(tags || '').split(/[,،，]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** คั่นด้วยจุลภาค ตัดช่องว่าง/ซ้ำ (ไม่สนตัวพิมพ์) คงตัวพิมพ์ของค่าที่เจอก่อน */
function normTags_(list) {
  const seen = {};
  const out = [];
  list.forEach(t => {
    const s = String(t).trim();
    const k = s.toLowerCase();
    if (s && !seen[k]) { seen[k] = true; out.push(s); }
  });
  return out.join(', ');
}

function splitTags_(s) {
  return String(s || '').split(/[,،，]/).map(x => x.trim()).filter(Boolean);
}

/** ตัวกรองสมาชิกที่ใช้ร่วมกันในรายการ / แก้หลายคน / ส่งออก */
function memberMatcher_(p) {
  const q = String(p.q || '').trim().toLowerCase();
  const status = p.status || '';
  const group = String(p.group || '').trim().toLowerCase();
  const tag = String(p.tag || '').trim().toLowerCase();
  return m =>
    (!status || m.Status === status) &&
    (!group || String(m.Group).trim().toLowerCase() === group) &&
    (!tag || tagList_(m.Tags).indexOf(tag) !== -1) &&
    (!q || [m.FullName, m.Phone, m.MemberNo, m.DisplayName, m.Group, m.Tags]
      .some(v => String(v).toLowerCase().indexOf(q) !== -1));
}

function byMemberNo_(a, b) {
  return String(a.MemberNo).localeCompare(String(b.MemberNo), 'th', { numeric: true });
}

function apiListMembers_(ctx, p) {
  const all = readAll_('Members');
  const matched = all.filter(memberMatcher_(p)).sort(byMemberNo_);
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), MEMBER_PAGE_MAX);
  const offset = Math.max(Number(p.offset) || 0, 0);
  const distinct = fn => {
    const seen = {};
    all.forEach(m => fn(m).forEach(v => { if (!seen[v.toLowerCase()]) seen[v.toLowerCase()] = v; }));
    return Object.keys(seen).map(k => seen[k]).sort((a, b) => a.localeCompare(b, 'th'));
  };
  return {
    total: matched.length,
    rows: matched.slice(offset, offset + limit).map(clean_),
    groups: distinct(m => (String(m.Group).trim() ? [String(m.Group).trim()] : [])),
    tags: distinct(m => splitTags_(m.Tags))
  };
}

/** รายละเอียดสมาชิก + เรื่องที่เคยแจ้ง */
function apiMemberDetail_(ctx, p) {
  const m = readAll_('Members').find(x => x.MemberID === p.memberId);
  if (!m) throw new Error('ไม่พบสมาชิก');
  const tickets = readAll_('Tickets')
    .filter(t => t.MemberID === m.MemberID)
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
    .slice(0, 30)
    .map(clean_);
  return { member: clean_(m), linked: !!String(m.LineUserID), tickets: tickets };
}

function apiUpdateMember_(ctx, p) {
  const all = readAll_('Members');
  const m = all.find(x => x.MemberID === p.memberId);
  if (!m) throw new Error('ไม่พบสมาชิก');

  const patch = { UpdatedAt: new Date() };
  if (p.status !== undefined) {
    if (MEMBER_STATUSES.indexOf(p.status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    if ((p.status === 'active' || p.status === 'pending') && !String(m.LineUserID)) {
      throw new Error('สมาชิกคนนี้ยังไม่ได้ผูกบัญชี LINE จึงตั้งเป็นสถานะนี้ไม่ได้ (ให้สมาชิกลงทะเบียนเอง)');
    }
    patch.Status = p.status;
  }
  if (p.group !== undefined) patch.Group = str_(p.group, 50, 'กลุ่ม', false);
  if (p.tags !== undefined) patch.Tags = str_(normTags_(splitTags_(p.tags)), 200, 'แท็ก', false);
  if (p.memberNo !== undefined) {
    const no = normMemberNo_(str_(p.memberNo, 30, 'เลขสมาชิก', true));
    if (all.some(x => x.MemberID !== m.MemberID && normMemberNo_(x.MemberNo) === no)) {
      throw new Error('เลขสมาชิก ' + no + ' ซ้ำกับสมาชิกคนอื่น');
    }
    patch.MemberNo = no;
  }
  if (p.note !== undefined) patch.Note = str_(p.note, 500, 'หมายเหตุ', false);

  update_('Members', m._row, patch);
  audit_(actorName_(ctx), 'updateMember', m.MemberID, JSON.stringify(patch));

  if (patch.Status && patch.Status !== m.Status && String(m.LineUserID)) applyRichMenu_(String(m.LineUserID));
  if (patch.Status === 'active' && m.Status !== 'active') {
    pushText_(m.LineUserID, '✅ บัญชีสมาชิกของคุณได้รับการอนุมัติแล้ว\nสามารถแจ้งเรื่องและติดตามสถานะผ่านเมนูได้เลย');
  }
  return { updated: true };
}

/**
 * แก้หลายคนพร้อมกัน: ระบุ memberIds หรือ filter (ชุดเดียวกับ listMembers)
 * ทำได้: addTags / removeTags / group (ย้ายกลุ่ม) / status (active|inactive)
 */
function apiBulkUpdateMembers_(ctx, p) {
  const addTags = splitTags_(Array.isArray(p.addTags) ? p.addTags.join(',') : p.addTags);
  const removeTags = splitTags_(Array.isArray(p.removeTags) ? p.removeTags.join(',') : p.removeTags).map(t => t.toLowerCase());
  const hasGroup = p.group !== undefined && p.group !== null && String(p.group).trim() !== '';
  const group = hasGroup ? str_(p.group, 50, 'กลุ่ม', false) : '';
  const status = p.status || '';
  if (status && ['active', 'inactive'].indexOf(status) === -1) throw new Error('แก้สถานะหลายคนได้เฉพาะ ใช้งาน/ปิดใช้งาน');
  if (!addTags.length && !removeTags.length && !hasGroup && !status) throw new Error('ยังไม่ได้เลือกสิ่งที่จะแก้');

  let targets;
  if (Array.isArray(p.memberIds)) {
    const ids = {};
    p.memberIds.forEach(id => { ids[String(id)] = true; });
    targets = readAll_('Members').filter(m => ids[m.MemberID]);
  } else if (p.filter) {
    targets = readAll_('Members').filter(memberMatcher_(p.filter));
  } else {
    throw new Error('ยังไม่ได้เลือกสมาชิก');
  }
  if (!targets.length) throw new Error('ไม่พบสมาชิกตามที่เลือก');
  if (targets.length > BULK_MAX) throw new Error('เลือกได้ครั้งละไม่เกิน ' + BULK_MAX + ' คน');

  let skipped = 0;
  let statusSkipped = 0;
  const statusChanged = []; // LINE userId ของคนที่เปลี่ยนสถานะ (ต้องซิงค์ rich menu)
  const now = new Date();
  const patches = [];
  targets.forEach(m => {
    const patch = { UpdatedAt: now };
    if (addTags.length || removeTags.length) {
      const kept = splitTags_(m.Tags).filter(t => removeTags.indexOf(t.toLowerCase()) === -1);
      patch.Tags = normTags_(kept.concat(addTags));
      if (patch.Tags.length > 200) { skipped++; return; }
    }
    if (hasGroup) patch.Group = group;
    if (status) {
      if (status === 'active' && !String(m.LineUserID)) statusSkipped++; // ยังไม่ผูก LINE: ข้ามเฉพาะสถานะ
      else patch.Status = status;
    }
    if (patch.Status && patch.Status !== m.Status && String(m.LineUserID)) statusChanged.push(String(m.LineUserID));
    patches.push({ row: m._row, patch: patch });
  });

  bulkPatch_('Members', patches);
  if (statusChanged.length && richMenuEnabled_(richMenuIds_())) {
    try { syncRichMenus_(statusChanged); } catch (err) { Logger.log('[bulk richmenu] ' + err.message); }
  }
  audit_(actorName_(ctx), 'bulkUpdateMembers', patches.length + ' คน',
    JSON.stringify({ addTags: addTags, removeTags: removeTags, group: hasGroup ? group : undefined, status: status || undefined, skipped: skipped, statusSkipped: statusSkipped }));
  return { updated: patches.length, skipped: skipped, statusSkipped: statusSkipped };
}

/** นำเข้ากลุ่ม/แท็กจากไฟล์ CSV โดยอ้างเลขสมาชิก (ไม่นำเข้าเลขบัตร — สมาชิกใหม่ต้องนำเข้าผ่าน tools/prepare-import.js) */
function apiImportMemberLabels_(ctx, p) {
  const rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw new Error('ไม่มีข้อมูลให้นำเข้า');
  if (rows.length > BULK_MAX) throw new Error('นำเข้าได้ครั้งละไม่เกิน ' + BULK_MAX + ' แถว');

  const byNo = {};
  readAll_('Members').forEach(m => { const k = normMemberNo_(m.MemberNo); if (k) byNo[k] = m; });
  const now = new Date();
  const patches = [];
  const notFound = [];
  const seen = {};
  rows.forEach(r => {
    const no = normMemberNo_(r.memberNo);
    const m = byNo[no];
    if (!m) { notFound.push(no || '(ว่าง)'); return; }
    if (seen[no]) return; // แถวซ้ำใช้แถวแรก
    seen[no] = true;
    const patch = { UpdatedAt: now };
    if (String(r.group || '').trim()) patch.Group = str_(r.group, 50, 'กลุ่ม', false);
    if (String(r.tags || '').trim()) patch.Tags = str_(normTags_(splitTags_(r.tags)), 200, 'แท็ก', false);
    if (patch.Group === undefined && patch.Tags === undefined) return;
    patches.push({ row: m._row, patch: patch });
  });

  bulkPatch_('Members', patches);
  audit_(actorName_(ctx), 'importMemberLabels', patches.length + ' คน', 'notFound=' + notFound.length);
  return { updated: patches.length, notFound: notFound.length, notFoundSample: notFound.slice(0, 20) };
}

/** ส่งออกสมาชิกเป็น CSV — เฉพาะ admin และบันทึก Audit ทุกครั้ง (ไม่รวม IdHash/LineUserID) */
function apiExportMembers_(ctx, p) {
  const rows = readAll_('Members').filter(memberMatcher_(p || {})).sort(byMemberNo_);
  const cols = [['เลขสมาชิก', 'MemberNo'], ['ชื่อ-นามสกุล', 'FullName'], ['เบอร์โทร', 'Phone'], ['สถานะ', 'Status'],
    ['กลุ่ม', 'Group'], ['แท็ก', 'Tags'], ['ติดตาม OA', 'Following'], ['ผูก LINE แล้ว', 'LineUserID']];
  const cell = (k, m) => {
    let v = m[k];
    if (k === 'LineUserID') v = String(v) ? 'ใช่' : 'ไม่';
    else if (k === 'Following') v = truthy_(v) ? 'ใช่' : 'ไม่';
    v = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // กัน CSV/สูตรแทรกเมื่อเปิดใน Excel
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const lines = [cols.map(c => '"' + c[0] + '"').join(',')]
    .concat(rows.map(m => cols.map(c => cell(c[1], m)).join(',')));
  audit_(actorName_(ctx), 'exportMembers', rows.length + ' คน', JSON.stringify(p || {}));
  return { count: rows.length, csv: lines.join('\r\n') };
}

/** เพิ่ม/แก้เจ้าหน้าที่ — เฉพาะ admin */
function apiSetStaff_(ctx, p) {
  const userId = str_(p.userId, 50, 'LINE User ID', true);
  const role = p.role === 'admin' ? 'admin' : 'staff';
  const existing = readAll_('Staff').find(s => String(s.LineUserID) === userId);
  const active = p.active === false ? false : true;
  if (existing) {
    update_('Staff', existing._row, { Name: str_(p.name, 100, 'ชื่อ', false) || existing.Name, Role: role, Active: active });
  } else {
    append_('Staff', { LineUserID: userId, Name: str_(p.name, 100, 'ชื่อ', true), Role: role, Active: active, CreatedAt: new Date() });
  }
  audit_(actorName_(ctx), 'setStaff', userId, role + '/' + active);
  applyRichMenu_(userId);
  return { saved: true };
}

function apiListStaff_(ctx) {
  return readAll_('Staff').map(s => ({ userId: String(s.LineUserID), name: s.Name, role: s.Role, active: truthy_(s.Active) }));
}
