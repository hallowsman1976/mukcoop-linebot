/**
 * RichMenu.js — สลับ rich menu ตามสถานะผู้ใช้
 *
 *   guest  = เมนูเริ่มต้นของ OA (คนที่ยังไม่ลงทะเบียน/ปิดใช้งาน เห็นเมนูนี้อัตโนมัติ)
 *   member = ผูกรายบุคคลเมื่อเป็นสมาชิก active
 *   staff  = ผูกรายบุคคลเมื่อเป็นเจ้าหน้าที่/แอดมินที่เปิดสิทธิ์อยู่ (สำคัญกว่า member)
 *
 * ID ของเมนูเก็บใน Script Properties: RICHMENU_GUEST / RICHMENU_MEMBER / RICHMENU_STAFF
 * ถ้ายังไม่ตั้งค่าเมนู member/staff ฟีเจอร์นี้จะไม่ทำอะไรเลย (ไม่กระทบระบบเดิม)
 * เมนูต้องสร้างผ่าน Messaging API (เช่น MCP line-bot) เมนูที่สร้างใน OA Manager ผูกผ่าน API ไม่ได้
 * การผูก/ยกเลิกเมนูไม่กินโควตาข้อความ และความล้มเหลวจะถูกบันทึกใน log เท่านั้น ไม่ทำให้งานหลักพัง
 */

const RICHMENU_PROPS = { guest: 'RICHMENU_GUEST', member: 'RICHMENU_MEMBER', staff: 'RICHMENU_STAFF' };

function richMenuIds_() {
  return {
    guest: PROPS.getProperty(RICHMENU_PROPS.guest) || '',
    member: PROPS.getProperty(RICHMENU_PROPS.member) || '',
    staff: PROPS.getProperty(RICHMENU_PROPS.staff) || ''
  };
}

function richMenuEnabled_(ids) {
  return !!(ids.member || ids.staff);
}

/** เมนูที่ผู้ใช้ควรเห็น: id ของ staff/member หรือ '' = ไม่ผูก (ใช้เมนูเริ่มต้น) */
function targetRichMenu_(ids, isStaff, isMember) {
  if (isStaff && ids.staff) return ids.staff;
  if (isMember && ids.member) return ids.member;
  return '';
}

function roleSets_() {
  const staff = {};
  readAll_('Staff').forEach(s => { if (truthy_(s.Active) && s.LineUserID) staff[String(s.LineUserID)] = true; });
  const member = {};
  const linked = [];
  readAll_('Members').forEach(m => {
    const id = String(m.LineUserID);
    if (!id) return;
    linked.push(id);
    if (m.Status === 'active') member[id] = true;
  });
  return { staff: staff, member: member, linked: linked };
}

/** ผูกเมนูให้ผู้ใช้คนเดียวทันที (เรียกหลังลงทะเบียน/เปลี่ยนสถานะ/แก้สิทธิ์เจ้าหน้าที่) */
function applyRichMenu_(userId) {
  try {
    const ids = richMenuIds_();
    if (!userId || !richMenuEnabled_(ids)) return;
    const roles = roleSets_();
    const id = targetRichMenu_(ids, !!roles.staff[userId], !!roles.member[userId]);
    if (id) callLine_('post', '/user/' + encodeURIComponent(userId) + '/richmenu/' + id);
    else callLine_('delete', '/user/' + encodeURIComponent(userId) + '/richmenu');
  } catch (err) {
    Logger.log('[applyRichMenu_] ' + userId + ': ' + err.message);
  }
}

/** ผูก/ยกเลิกเมนูให้หลายคนพร้อมกัน (bulk API ของ LINE ทำงานแบบ async) คืนจำนวนที่สั่งผูก/ยกเลิก */
function syncRichMenus_(userIds) {
  const ids = richMenuIds_();
  const roles = roleSets_();
  const want = {};
  const unlink = [];
  let total = 0;
  const seen = {};
  userIds.forEach(u => {
    u = String(u);
    if (!u || seen[u]) return;
    seen[u] = true;
    const id = targetRichMenu_(ids, !!roles.staff[u], !!roles.member[u]);
    if (id) (want[id] = want[id] || []).push(u); else unlink.push(u);
    total++;
  });
  let linked = 0;
  let unlinked = 0;
  Object.keys(want).forEach(menuId => {
    for (let i = 0; i < want[menuId].length; i += 500) {
      const chunk = want[menuId].slice(i, i + 500);
      callLine_('post', '/richmenu/bulk/link', { richMenuId: menuId, userIds: chunk });
      linked += chunk.length;
    }
  });
  for (let i = 0; i < unlink.length; i += 500) {
    const chunk = unlink.slice(i, i + 500);
    callLine_('post', '/richmenu/bulk/unlink', { userIds: chunk });
    unlinked += chunk.length;
  }
  return { total: total, linked: linked, unlinked: unlinked };
}

/** ซิงค์ทุกคนที่ผูก LINE แล้ว (สมาชิก + เจ้าหน้าที่) */
function syncAllRichMenus_() {
  if (!richMenuEnabled_(richMenuIds_())) throw new Error('ยังไม่ได้ตั้งค่าเมนูสมาชิก/เจ้าหน้าที่');
  const roles = roleSets_();
  return syncRichMenus_(roles.linked.concat(Object.keys(roles.staff)));
}

/** รันจาก Apps Script editor ได้โดยตรง */
function syncAllRichMenus() {
  Logger.log(JSON.stringify(syncAllRichMenus_()));
}

// ---------- API (admin) ----------

function listRichMenus_() {
  const res = callLine_('get', '/richmenu/list');
  return (res.richmenus || []).map(m => ({ id: m.richMenuId, name: m.name, chatBarText: m.chatBarText }));
}

function apiRichMenuStatus_() {
  const menus = listRichMenus_();
  let defaultId = '';
  try { defaultId = callLine_('get', '/user/all/richmenu').richMenuId || ''; } catch (err) { /* ไม่มีเมนูเริ่มต้น */ }
  return { menus: menus, assigned: richMenuIds_(), defaultId: defaultId };
}

/** บันทึกว่าเมนูไหนใช้กับบทบาทไหน; เลือก guest = ตั้งเป็นเมนูเริ่มต้นของ OA (ทุกคนที่ไม่มีเมนูรายบุคคลจะเห็นเมนูนี้) */
function apiSaveRichMenus_(ctx, p) {
  const known = {};
  listRichMenus_().forEach(m => { known[m.id] = true; });
  const chosen = {};
  Object.keys(RICHMENU_PROPS).forEach(role => {
    const id = String(p[role] || '').trim();
    if (id && !known[id]) throw new Error('ไม่พบเมนูที่เลือกใน LINE (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่');
    chosen[role] = id;
  });
  const before = richMenuIds_();
  Object.keys(RICHMENU_PROPS).forEach(role => {
    if (chosen[role]) PROPS.setProperty(RICHMENU_PROPS[role], chosen[role]);
    else PROPS.deleteProperty(RICHMENU_PROPS[role]);
  });
  if (chosen.guest && chosen.guest !== before.guest) callLine_('post', '/user/all/richmenu/' + chosen.guest);
  audit_(actorName_(ctx), 'saveRichMenus', '', JSON.stringify(chosen));
  return { saved: true };
}

function apiSyncRichMenus_(ctx, p) {
  if (p.confirm !== true) throw new Error('กรุณายืนยันก่อนซิงค์');
  const r = syncAllRichMenus_();
  audit_(actorName_(ctx), 'syncRichMenus', '', JSON.stringify(r));
  return r;
}
