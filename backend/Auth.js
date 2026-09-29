/**
 * Auth.js — ยืนยันตัวตนด้วย LINE ID token (จาก liff.getIDToken()) แล้วหา role จากชีต Staff/Members
 * ฝั่ง client ห้ามส่ง userId มาเอง เพราะปลอมได้ ต้องส่ง idToken ให้ server verify กับ LINE ทุกครั้ง
 */

function verifyIdToken_(idToken) {
  if (!idToken) throw authError_('กรุณาเข้าสู่ระบบผ่าน LINE ก่อน');

  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  const key = 'idt_' + Utilities.base64EncodeWebSafe(digest);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: prop_('LINE_LOGIN_CHANNEL_ID') },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('[verifyIdToken_] ' + res.getResponseCode() + ' ' + res.getContentText());
    throw authError_('เซสชัน LINE หมดอายุ กรุณาเปิดหน้านี้ใหม่อีกครั้ง');
  }
  const p = JSON.parse(res.getContentText());
  const identity = { userId: p.sub, name: p.name || '', picture: p.picture || '' };
  const ttl = Math.max(10, Math.min(300, Number(p.exp) - Math.floor(Date.now() / 1000)));
  cache.put(key, JSON.stringify(identity), ttl);
  return identity;
}

function authError_(msg) {
  const e = new Error(msg);
  e.code = 'AUTH';
  return e;
}

function findMember_(userId) {
  return readAll_('Members').find(m => String(m.LineUserID) === String(userId)) || null;
}

function findStaff_(identity) {
  const rows = readAll_('Staff');
  let staff = rows.find(s => String(s.LineUserID) === String(identity.userId));

  // บัญชีแอดมินคนแรก: ตั้งผ่าน Script Property BOOTSTRAP_ADMIN_USER_ID แล้วเพิ่มลงชีต Staff ให้อัตโนมัติ
  if (!staff && identity.userId === prop_('BOOTSTRAP_ADMIN_USER_ID', false)) {
    staff = { LineUserID: identity.userId, Name: identity.name || 'Admin', Role: 'admin', Active: true, CreatedAt: new Date() };
    append_('Staff', staff);
    applyRichMenu_(identity.userId);
  }
  if (!staff || !truthy_(staff.Active)) return null;
  return staff;
}

/** สร้าง context ของคำขอ: ใคร เป็นสมาชิกไหม เป็นเจ้าหน้าที่ไหม */
function buildContext_(idToken) {
  const identity = verifyIdToken_(idToken);
  return { identity: identity, member: findMember_(identity.userId), staff: findStaff_(identity) };
}

/** ตรวจสิทธิ์ตามระดับที่ route ต้องการ: user < member < staff < admin */
function requireLevel_(ctx, level) {
  if (level === 'user') return;
  if (level === 'member') {
    if (!ctx.member) throw new Error('กรุณาลงทะเบียนสมาชิกก่อนใช้งาน');
    if (ctx.member.Status !== 'active') throw new Error('บัญชีของคุณอยู่ระหว่างรอเจ้าหน้าที่อนุมัติ');
    return;
  }
  if (!ctx.staff) throw new Error('ไม่มีสิทธิ์เข้าถึง (เฉพาะเจ้าหน้าที่)');
  if (level === 'admin' && ctx.staff.Role !== 'admin') throw new Error('ไม่มีสิทธิ์ (เฉพาะผู้ดูแลระบบ)');
}

function actorName_(ctx) {
  if (ctx.staff) return ctx.staff.Name || ctx.identity.name;
  if (ctx.member) return ctx.member.FullName || ctx.identity.name;
  return ctx.identity.name;
}
