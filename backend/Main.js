/**
 * Main.js — จุดเข้า Web App: เป็นทั้ง REST API (frontend ภายนอกเรียกผ่าน fetch) และ LINE webhook
 *
 * ข้อควรรู้: Apps Script อ่าน HTTP header ของคำขอไม่ได้ จึงตรวจ x-line-signature ไม่ได้
 * ใช้ query parameter ลับแทน: ตั้ง Webhook URL เป็น <exec URL>?wh=<WEBHOOK_TOKEN>
 */

// action → { level: ระดับสิทธิ์ขั้นต่ำ, fn }
// fn ต้องห่อเป็น arrow function เพราะ Apps Script โหลดไฟล์ตามลำดับชื่อ (Main.js มาก่อน Members.js)
// การอ้างฟังก์ชันตรง ๆ ตอนโหลดจะเป็น ReferenceError
const ROUTES_ = {
  me: { level: 'user', fn: (c, p) => apiMe_(c, p) },
  register: { level: 'user', fn: (c, p) => apiRegister_(c, p) },

  createTicket: { level: 'member', fn: (c, p) => apiCreateTicket_(c, p) },
  myTickets: { level: 'member', fn: (c, p) => apiMyTickets_(c, p) },
  ticketDetail: { level: 'member', fn: (c, p) => apiTicketDetail_(c, p) },
  addComment: { level: 'member', fn: (c, p) => apiAddComment_(c, p) },

  dashboard: { level: 'staff', fn: (c, p) => apiDashboard_(c, p) },
  listMembers: { level: 'staff', fn: (c, p) => apiListMembers_(c, p) },
  memberDetail: { level: 'staff', fn: (c, p) => apiMemberDetail_(c, p) },
  updateMember: { level: 'staff', fn: (c, p) => apiUpdateMember_(c, p) },
  bulkUpdateMembers: { level: 'staff', fn: (c, p) => apiBulkUpdateMembers_(c, p) },
  listTickets: { level: 'staff', fn: (c, p) => apiListTickets_(c, p) },
  updateTicket: { level: 'staff', fn: (c, p) => apiUpdateTicket_(c, p) },
  listAutoReplies: { level: 'staff', fn: (c, p) => apiListAutoReplies_(c, p) },
  testAutoReply: { level: 'staff', fn: (c, p) => apiTestAutoReply_(c, p) },
  audienceOptions: { level: 'staff', fn: (c, p) => apiAudienceOptions_(c, p) },
  audiencePreview: { level: 'staff', fn: (c, p) => apiAudiencePreview_(c, p) },
  listBroadcasts: { level: 'staff', fn: (c, p) => apiListBroadcasts_(c, p) },

  richMenuStatus: { level: 'admin', fn: (c, p) => apiRichMenuStatus_(c, p) },
  saveRichMenus: { level: 'admin', fn: (c, p) => apiSaveRichMenus_(c, p) },
  syncRichMenus: { level: 'admin', fn: (c, p) => apiSyncRichMenus_(c, p) },
  backupStatus: { level: 'admin', fn: (c, p) => apiBackupStatus_(c, p) },
  backupNow: { level: 'admin', fn: (c, p) => apiBackupNow_(c, p) },
  saveAutoReply: { level: 'admin', fn: (c, p) => apiSaveAutoReply_(c, p) },
  exportMembers: { level: 'admin', fn: (c, p) => apiExportMembers_(c, p) },
  importMemberLabels: { level: 'admin', fn: (c, p) => apiImportMemberLabels_(c, p) },
  sendBroadcast: { level: 'admin', fn: (c, p) => apiSendBroadcast_(c, p) },
  listStaff: { level: 'admin', fn: (c, p) => apiListStaff_(c, p) },
  setStaff: { level: 'admin', fn: (c, p) => apiSetStaff_(c, p) }
};

// staff เรียก route ระดับ member (เช่น ticketDetail, addComment) ได้โดยไม่ต้องเป็นสมาชิก
const STAFF_OK_ON_MEMBER_ROUTES_ = ['ticketDetail', 'addComment'];

function doGet() {
  return json_({ ok: true, data: { service: 'LineBot-CRM', time: new Date().toISOString() } });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, message: 'รูปแบบคำขอไม่ถูกต้อง' });
  }
  if (body && Array.isArray(body.events)) return handleWebhook_(e, body);
  return json_(handleApi_(body));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleApi_(body) {
  try {
    const route = ROUTES_[body && body.action];
    if (!route) throw new Error('ไม่รู้จักคำสั่ง');

    const ctx = buildContext_(body.idToken);
    if (STAFF_OK_ON_MEMBER_ROUTES_.indexOf(body.action) !== -1 && ctx.staff) {
      // เจ้าหน้าที่ผ่านได้เลย
    } else {
      requireLevel_(ctx, route.level);
    }
    return { ok: true, data: route.fn(ctx, body.params || {}) };
  } catch (err) {
    Logger.log('[api ' + (body && body.action) + '] ' + (err.stack || err));
    return { ok: false, code: err.code || '', message: translateError_(err) };
  }
}

function translateError_(err) {
  const msg = String(err.message || err);
  if (msg.indexOf('ข้อผิดพลาดของบริการ') !== -1 || msg.indexOf('Service Spreadsheets') !== -1) {
    return 'ระบบฐานข้อมูลขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง';
  }
  if (msg.indexOf('Exceeded maximum execution time') !== -1) return 'ประมวลผลนานเกินกำหนด กรุณาลองใหม่';
  return msg;
}

// ---------- LINE webhook ----------

function handleWebhook_(e, body) {
  const ok = ContentService.createTextOutput('OK');
  if (String(e.parameter.wh || '') !== String(prop_('WEBHOOK_TOKEN'))) {
    Logger.log('[webhook] rejected: bad token');
    return ok;
  }
  body.events.forEach(ev => {
    try {
      processLineEvent_(ev);
    } catch (err) {
      Logger.log('[webhook] event ' + ev.type + ' failed: ' + (err.stack || err));
    }
  });
  return ok;
}

function processLineEvent_(ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId) return;

  if (ev.type === 'follow') {
    const m = findMember_(userId);
    if (m) update_('Members', m._row, { Following: true, UpdatedAt: new Date() });
    replyText_(ev.replyToken, 'ยินดีต้อนรับ 🙏\n' + (m ? 'พิมพ์ "สถานะ" เพื่อดูเรื่องที่แจ้งไว้' : 'ลงทะเบียนสมาชิกได้ที่\n' + registerLink_()));
    return;
  }

  if (ev.type === 'unfollow') {
    const m = findMember_(userId);
    if (m) update_('Members', m._row, { Following: false, UpdatedAt: new Date() });
    return;
  }

  if (ev.type === 'message' && ev.message.type === 'text') {
    const text = ev.message.text.trim();
    if (/สถานะ|ติดตาม/.test(text)) return replyText_(ev.replyToken, statusSummary_(userId));
    // กฎตอบอัตโนมัติอยู่ใน AutoReply.js (ตอบเฉพาะแชตส่วนตัว ไม่ตอบในกลุ่ม/ห้องแชต)
    if (ev.source.type === 'user') handleAutoReply_(ev, userId, text);
  }
}

function registerLink_() {
  return prop_('LIFF_MEMBER_URL', false) || '(ยังไม่ได้ตั้งค่าลิงก์)';
}

function statusSummary_(userId) {
  const open = readAll_('Tickets')
    .filter(t => String(t.LineUserID) === String(userId) && t.Status !== 'closed')
    .sort((a, b) => new Date(b.UpdatedAt) - new Date(a.UpdatedAt))
    .slice(0, 5);
  if (!open.length) return 'ไม่มีเรื่องที่ค้างอยู่ครับ/ค่ะ';
  return open.map(t => t.TicketID + ' ' + t.Subject + '\n→ ' + STATUS_TH[t.Status]).join('\n\n');
}
