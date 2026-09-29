/**
 * Messaging.js — ส่งข้อความ/ประกาศหาสมาชิก
 * ใช้ multicast (ครั้งละ ≤500 คน) เฉพาะสมาชิก active ที่ผูก LINE แล้วและยังติดตามบัญชีอยู่
 * ทุกครั้งที่ส่งกินโควตาข้อความรายเดือนของ LINE OA ตามจำนวนผู้รับ จึงบังคับให้ดูตัวอย่างจำนวนก่อน (confirm)
 *
 * audience = { group: 'ชื่อกลุ่ม' (ว่าง = ทุกกลุ่ม), tags: ['แท็ก', ...], tagMode: 'any' | 'all' }
 * รับรูปแบบเก่า { type: 'all'|'group'|'tag', value } ได้ด้วย (แปลงให้อัตโนมัติ)
 */

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function normAudience_(a) {
  a = a || {};
  let group = a.group;
  let tags = a.tags;
  if (a.type === 'group' && a.value) group = a.value;
  if (a.type === 'tag' && a.value) tags = [a.value];
  tags = Array.isArray(tags) ? tags : splitTags_(tags);
  return {
    group: String(group || '').trim(),
    tags: tags.map(t => String(t).trim()).filter(Boolean),
    tagMode: a.tagMode === 'all' ? 'all' : 'any'
  };
}

/** สมาชิกตรงกับกลุ่ม/แท็กที่เลือกหรือไม่ (ยังไม่ดูว่าส่งถึงได้หรือไม่) */
function segmentMatcher_(aud) {
  const group = aud.group.toLowerCase();
  const wanted = aud.tags.map(t => t.toLowerCase());
  return m => {
    if (group && String(m.Group).trim().toLowerCase() !== group) return false;
    if (!wanted.length) return true;
    const have = tagList_(m.Tags);
    return aud.tagMode === 'all' ? wanted.every(t => have.indexOf(t) !== -1) : wanted.some(t => have.indexOf(t) !== -1);
  };
}

function memberFollowing_(m) {
  return !(m.Following === false || String(m.Following).toUpperCase() === 'FALSE');
}

function isReachable_(m) {
  return m.Status === 'active' && !!String(m.LineUserID) && memberFollowing_(m);
}

function resolveAudience_(audience) {
  const match = segmentMatcher_(normAudience_(audience));
  return readAll_('Members').filter(m => isReachable_(m) && match(m));
}

function describeAudience_(aud) {
  const parts = [];
  parts.push(aud.group ? 'กลุ่ม ' + aud.group : 'ทุกกลุ่ม');
  if (aud.tags.length) parts.push('แท็ก ' + aud.tags.join(aud.tagMode === 'all' ? ' และ ' : ' หรือ '));
  return parts.join(' · ');
}

/** ตัวเลือกกลุ่ม/แท็กสำหรับหน้าส่งประกาศ พร้อมจำนวนคนที่ส่งถึงได้จริง */
function apiAudienceOptions_() {
  const reachable = readAll_('Members').filter(isReachable_);
  const count = pick => {
    const seen = {};
    reachable.forEach(m => pick(m).forEach(v => {
      const k = v.toLowerCase();
      if (!seen[k]) seen[k] = { name: v, count: 0 };
      seen[k].count++;
    }));
    return Object.keys(seen).map(k => seen[k]).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  };
  return {
    total: reachable.length,
    groups: count(m => (String(m.Group).trim() ? [String(m.Group).trim()] : [])),
    tags: count(m => splitTags_(m.Tags))
  };
}

function apiAudiencePreview_(ctx, p) {
  const aud = normAudience_(p.audience);
  const matched = readAll_('Members').filter(segmentMatcher_(aud));
  const linked = matched.filter(m => String(m.LineUserID));
  const active = linked.filter(m => m.Status === 'active');
  const reachable = active.filter(memberFollowing_);
  let quota = null;
  try { quota = getQuota_(); } catch (err) { Logger.log('[audience] quota failed: ' + err.message); }
  return {
    count: reachable.length,
    description: describeAudience_(aud),
    breakdown: {
      matched: matched.length,
      notLinked: matched.length - linked.length,
      notActive: linked.length - active.length,
      notFollowing: active.length - reachable.length
    },
    quota: quota
  };
}

function apiSendBroadcast_(ctx, p) {
  const title = str_(p.title, 100, 'หัวข้อ', true);
  const text = str_(p.text, 4500, 'ข้อความ', true);
  const body = '📢 ' + title + '\n\n' + text;

  // ส่งทดสอบถึงตัวเองเท่านั้น (กิน 1 ข้อความ ไม่บันทึกในประวัติการส่ง)
  if (p.testOnly === true) {
    if (!pushText_(ctx.identity.userId, '🧪 [ทดสอบ] ' + body)) {
      throw new Error('ส่งทดสอบไม่สำเร็จ (บัญชี LINE ของคุณต้องเป็นเพื่อนกับ OA นี้และไม่ได้บล็อก)');
    }
    audit_(actorName_(ctx), 'broadcastTest', title, '');
    return { test: true, sent: 1 };
  }

  if (p.confirm !== true) throw new Error('กรุณายืนยันการส่งก่อน');
  const aud = normAudience_(p.audience);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('กำลังส่งประกาศอื่นอยู่ กรุณารอสักครู่แล้วลองใหม่');
  try {
    const audienceJson = JSON.stringify(aud);

    // กันส่งซ้ำโดยไม่ตั้งใจ (กดซ้ำ/เปิดสองหน้าจอ)
    if (p.allowDuplicate !== true) {
      const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
      const dup = readAll_('Broadcasts').some(b => b.Title === title && b.Text === text &&
        b.Audience === audienceJson && new Date(b.SentAt).getTime() > cutoff);
      if (dup) throw new Error('เพิ่งส่งประกาศนี้ให้กลุ่มเดียวกันไปเมื่อสักครู่ หากต้องการส่งซ้ำจริง ให้แก้ข้อความหรือรอ 10 นาที');
    }

    const recipients = resolveAudience_(aud);
    if (!recipients.length) throw new Error('ไม่มีผู้รับตามเงื่อนไขที่เลือก');

    // กันส่งเกินโควตาที่เหลือ (ตรวจได้เมื่อเป็นแผนแบบจำกัดโควตา)
    const quota = getQuota_();
    if (quota.remaining !== null && recipients.length > quota.remaining) {
      throw new Error('โควตาข้อความเหลือ ' + quota.remaining + ' แต่ต้องส่ง ' + recipients.length + ' คน');
    }

    // ผู้ส่งต้องเห็นจำนวนที่ยืนยันตรงกับที่จะส่งจริง (กันกลุ่มเปลี่ยนระหว่างรอกดยืนยัน)
    if (p.expectedCount !== undefined && Number(p.expectedCount) !== recipients.length) {
      throw new Error('จำนวนผู้รับเปลี่ยนจาก ' + p.expectedCount + ' เป็น ' + recipients.length + ' คน กรุณาตรวจจำนวนใหม่แล้วยืนยันอีกครั้ง');
    }

    const sent = multicastText_(recipients.map(m => String(m.LineUserID)), body);

    append_('Broadcasts', {
      BroadcastID: nextId_('B'), Title: title, Text: text, Audience: audienceJson,
      Recipients: sent, SentBy: actorName_(ctx), SentAt: new Date()
    });
    audit_(actorName_(ctx), 'broadcast', title, describeAudience_(aud) + ' sent=' + sent + '/' + recipients.length);
    return { sent: sent, targeted: recipients.length };
  } finally {
    lock.releaseLock();
  }
}

function apiListBroadcasts_() {
  return readAll_('Broadcasts')
    .sort((a, b) => new Date(b.SentAt) - new Date(a.SentAt))
    .slice(0, 50)
    .map(b => {
      const c = clean_(b);
      try { c.AudienceText = describeAudience_(normAudience_(JSON.parse(b.Audience))); } catch (err) { c.AudienceText = ''; }
      return c;
    });
}
