/**
 * AutoReply.js — ตอบอัตโนมัติด้วยคีย์เวิร์ด (กฎเก็บในชีต AutoReplies แก้ได้จากหน้าเจ้าหน้าที่)
 *
 * ใช้ reply token ตอบ จึงไม่กินโควตาข้อความ (ต่างจาก push/multicast)
 * ลำดับการตอบ: คำสั่งในตัว "สถานะ/ติดตาม" (Main.js) → กฎตามลำดับความสำคัญ → กฎ fallback → ข้อความ default
 *
 * MatchType: contains = ข้อความมีคำนี้อยู่ | exact = ข้อความตรงทั้งข้อความ | fallback = ไม่ตรงกฎใดเลย (มีได้ 1 กฎ)
 * ตัวแปรในข้อความตอบ: {{name}} = ชื่อสมาชิก, {{link}} = ลิงก์หน้าสมาชิก
 */

const AUTO_MATCH_TYPES = ['contains', 'exact', 'fallback'];
const AUTO_RULES_MAX = 100;
const AUTO_CACHE_KEY = 'autoreply_rules_v1';
const AUTO_CACHE_SECONDS = 300;
const AUTO_RESERVED = /สถานะ|ติดตาม/; // ถูกจับโดยคำสั่งในตัวก่อนถึงกฎเสมอ
const AUTO_DEFAULT_REPLY = 'พิมพ์ "สถานะ" เพื่อดูเรื่องที่แจ้งไว้ หรือ "แจ้งเรื่อง" เพื่อเปิดหน้าสมาชิก';

function normText_(s) {
  return String(s === undefined || s === null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function splitKeywords_(s) {
  const seen = {};
  return String(s || '').split(/[,،，\n]/).map(normText_).filter(k => {
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

/** กฎที่เปิดใช้งาน พร้อมคีย์เวิร์ดที่ normalize แล้ว (cache 5 นาที และล้างทุกครั้งที่บันทึก) */
function loadAutoRules_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(AUTO_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const rules = readAll_('AutoReplies').filter(r => truthy_(r.Active)).map(r => ({
    id: r.RuleID, name: r.Name, type: r.MatchType, reply: String(r.Reply), priority: Number(r.Priority) || 0,
    keywords: splitKeywords_(r.Keywords)
  }));
  try { cache.put(AUTO_CACHE_KEY, JSON.stringify(rules), AUTO_CACHE_SECONDS); } catch (err) { /* ใหญ่เกินแคช: อ่านจากชีตทุกครั้ง */ }
  return rules;
}

function matchAutoReply_(text) {
  const msg = normText_(text);
  if (!msg) return null;
  const rules = loadAutoRules_();
  const longest = r => r.keywords.reduce((n, k) => Math.max(n, k.length), 0);
  const ordered = rules.filter(r => r.type !== 'fallback').sort((a, b) =>
    b.priority - a.priority || (a.type === 'exact' ? 0 : 1) - (b.type === 'exact' ? 0 : 1) || longest(b) - longest(a));
  const hit = ordered.find(r => r.keywords.some(k => (r.type === 'exact' ? msg === k : msg.indexOf(k) !== -1)));
  return hit || rules.find(r => r.type === 'fallback') || null;
}

function renderAutoReply_(rule, member) {
  const reply = rule ? rule.reply : AUTO_DEFAULT_REPLY;
  return reply
    .replace(/\{\{\s*name\s*\}\}/g, member && member.FullName ? member.FullName : 'สมาชิก')
    .replace(/\{\{\s*link\s*\}\}/g, registerLink_());
}

/** เรียกจาก webhook เมื่อสมาชิกพิมพ์ข้อความ (แชตส่วนตัวเท่านั้น) */
function handleAutoReply_(ev, userId, text) {
  const rule = matchAutoReply_(text);
  replyText_(ev.replyToken, renderAutoReply_(rule, findMember_(userId)));
}

// ---------- ข้อมูลเริ่มต้น ----------

/** สร้างกฎตั้งต้นถ้าชีตยังว่าง (เรียกจาก setupSchema รันซ้ำได้ปลอดภัย) */
function seedAutoReplies_() {
  if (readAll_('AutoReplies').length) return;
  const now = new Date();
  [
    { Name: 'เปิดหน้าสมาชิก', Keywords: 'สมัคร, ลงทะเบียน, แจ้งเรื่อง, เมนู', MatchType: 'contains', Priority: 0,
      Reply: 'สวัสดี {{name}}\nเปิดหน้าสมาชิกได้ที่\n{{link}}' },
    { Name: 'ข้อความอื่น ๆ (fallback)', Keywords: '', MatchType: 'fallback', Priority: 0, Reply: AUTO_DEFAULT_REPLY }
  ].forEach(r => append_('AutoReplies', Object.assign({
    RuleID: nextId_('R'), Active: true, UpdatedAt: now, UpdatedBy: 'system'
  }, r)));
}

// ---------- API ----------

function apiListAutoReplies_() {
  return readAll_('AutoReplies')
    .sort((a, b) => (Number(b.Priority) || 0) - (Number(a.Priority) || 0) || String(a.RuleID).localeCompare(String(b.RuleID)))
    .map(clean_);
}

/** เพิ่ม/แก้กฎ (ระบุ ruleId = แก้) — เฉพาะ admin */
function apiSaveAutoReply_(ctx, p) {
  const name = str_(p.name, 60, 'ชื่อกฎ', true);
  const type = String(p.matchType || '');
  if (AUTO_MATCH_TYPES.indexOf(type) === -1) throw new Error('ประเภทการจับคู่ไม่ถูกต้อง');
  const reply = str_(p.reply, 2000, 'ข้อความตอบ', true);
  const priority = Math.max(-100, Math.min(100, Math.round(Number(p.priority) || 0)));
  const active = p.active === false ? false : true;

  let keywords = '';
  if (type !== 'fallback') {
    const list = splitKeywords_(p.keywords);
    if (!list.length) throw new Error('กรุณากรอกคำสำคัญอย่างน้อย 1 คำ');
    if (list.length > 20) throw new Error('คำสำคัญได้ไม่เกิน 20 คำ');
    list.forEach(k => {
      if (k.length > 50) throw new Error('คำสำคัญ "' + k.slice(0, 10) + '…" ยาวเกิน 50 ตัวอักษร');
      if (type === 'contains' && k.length < 2) throw new Error('คำสำคัญแบบ "มีคำนี้" ต้องยาวอย่างน้อย 2 ตัวอักษร (สั้นไปจะตรงกับเกือบทุกข้อความ)');
      if (AUTO_RESERVED.test(k)) throw new Error('คำว่า "สถานะ" และ "ติดตาม" ใช้สำหรับดูสถานะเรื่องที่แจ้ง ใช้เป็นคำสำคัญไม่ได้');
    });
    keywords = list.join(', ');
  }

  const all = readAll_('AutoReplies');
  const existing = p.ruleId ? all.find(r => r.RuleID === p.ruleId) : null;
  if (p.ruleId && !existing) throw new Error('ไม่พบกฎที่ต้องการแก้');
  if (type === 'fallback' && all.some(r => r.MatchType === 'fallback' && (!existing || r.RuleID !== existing.RuleID))) {
    throw new Error('มีกฎ fallback อยู่แล้ว ให้แก้ของเดิมแทน');
  }
  if (!existing && all.length >= AUTO_RULES_MAX) throw new Error('มีกฎครบ ' + AUTO_RULES_MAX + ' ข้อแล้ว');

  const row = { Name: name, Keywords: keywords, MatchType: type, Reply: reply, Priority: priority, Active: active,
    UpdatedAt: new Date(), UpdatedBy: actorName_(ctx) };
  let id;
  if (existing) { update_('AutoReplies', existing._row, row); id = existing.RuleID; }
  else { id = nextId_('R'); append_('AutoReplies', Object.assign({ RuleID: id }, row)); }

  CacheService.getScriptCache().remove(AUTO_CACHE_KEY);
  audit_(actorName_(ctx), existing ? 'updateAutoReply' : 'createAutoReply', id, name + ' active=' + active);
  return { saved: true, ruleId: id };
}

/** ทดสอบว่าข้อความหนึ่งจะถูกตอบด้วยกฎไหน (ไม่ส่งข้อความจริง ไม่กินโควตา) */
function apiTestAutoReply_(ctx, p) {
  const text = str_(p.text, 500, 'ข้อความทดสอบ', true);
  if (AUTO_RESERVED.test(text)) return { rule: 'คำสั่งในตัว (ดูสถานะเรื่องที่แจ้ง)', reply: '(ระบบจะแสดงสรุปสถานะเรื่องของสมาชิกคนนั้น)' };
  const rule = matchAutoReply_(text);
  return { rule: rule ? rule.name : 'ข้อความ default (ไม่มีกฎ fallback)', reply: renderAutoReply_(rule, ctx.member) };
}
