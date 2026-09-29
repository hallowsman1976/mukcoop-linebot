/**
 * Tickets.js — แจ้งเรื่อง/ติดตามงาน
 * สถานะ: open → in_progress → resolved → closed
 */

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const TICKET_PRIORITIES = ['low', 'normal', 'high'];
const STATUS_TH = { open: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ', resolved: 'แก้ไขแล้ว', closed: 'ปิดเรื่อง' };

function addLog_(ticketId, actorType, actorName, note, status) {
  append_('TicketLogs', {
    LogID: Utilities.getUuid(), TicketID: ticketId, ActorType: actorType, ActorName: actorName,
    Note: note, Status: status || '', CreatedAt: new Date()
  });
}

function findTicket_(ticketId) {
  const t = readAll_('Tickets').find(x => x.TicketID === ticketId);
  if (!t) throw new Error('ไม่พบเรื่องที่ระบุ');
  return t;
}

/** สมาชิกเห็นได้เฉพาะเรื่องของตัวเอง เจ้าหน้าที่เห็นได้ทั้งหมด */
function assertCanView_(ctx, t) {
  if (ctx.staff) return;
  if (!ctx.member || String(t.LineUserID) !== String(ctx.identity.userId)) throw new Error('ไม่มีสิทธิ์ดูเรื่องนี้');
}

function apiCreateTicket_(ctx, p) {
  const subject = str_(p.subject, 120, 'หัวข้อ', true);
  const detail = str_(p.detail, 2000, 'รายละเอียด', true);
  const category = str_(p.category, 50, 'หมวดหมู่', false) || 'ทั่วไป';

  const ticket = {
    TicketID: nextId_('T'), MemberID: ctx.member.MemberID, LineUserID: ctx.identity.userId,
    Category: category, Subject: subject, Detail: detail, Status: 'open', Priority: 'normal',
    AssignedTo: '', CreatedAt: new Date(), UpdatedAt: new Date(), ResolvedAt: ''
  };
  append_('Tickets', ticket);
  addLog_(ticket.TicketID, 'member', ctx.member.FullName, 'สร้างเรื่อง', 'open');
  notifyStaff_('🆕 เรื่องใหม่ ' + ticket.TicketID + '\n' + ctx.member.FullName + ': ' + subject);
  return { ticketId: ticket.TicketID };
}

function apiMyTickets_(ctx) {
  return readAll_('Tickets')
    .filter(t => String(t.LineUserID) === String(ctx.identity.userId))
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
    .slice(0, 100)
    .map(clean_);
}

function apiTicketDetail_(ctx, p) {
  const t = findTicket_(p.ticketId);
  assertCanView_(ctx, t);
  const logs = readAll_('TicketLogs')
    .filter(l => l.TicketID === t.TicketID)
    .sort((a, b) => new Date(a.CreatedAt) - new Date(b.CreatedAt))
    .map(clean_);
  const member = readAll_('Members').find(m => m.MemberID === t.MemberID);
  return {
    ticket: clean_(t),
    logs: logs,
    member: ctx.staff && member ? { name: member.FullName, phone: member.Phone, memberNo: member.MemberNo } : null
  };
}

function apiAddComment_(ctx, p) {
  const t = findTicket_(p.ticketId);
  assertCanView_(ctx, t);
  if (t.Status === 'closed') throw new Error('เรื่องนี้ปิดแล้ว หากมีปัญหาเพิ่มเติมกรุณาแจ้งเรื่องใหม่');
  const note = str_(p.note, 1000, 'ข้อความ', true);

  const isStaff = !!ctx.staff;
  addLog_(t.TicketID, isStaff ? 'staff' : 'member', actorName_(ctx), note, '');
  update_('Tickets', t._row, { UpdatedAt: new Date() });

  if (isStaff) {
    pushText_(t.LineUserID, '💬 เจ้าหน้าที่ตอบเรื่อง ' + t.TicketID + '\n' + note);
  } else {
    notifyStaff_('💬 สมาชิกตอบเรื่อง ' + t.TicketID + '\n' + note);
  }
  return { added: true };
}

// ---------- เจ้าหน้าที่ ----------

function apiListTickets_(ctx, p) {
  const q = String(p.q || '').trim().toLowerCase();
  const members = {};
  readAll_('Members').forEach(m => { members[m.MemberID] = m.FullName; });

  return readAll_('Tickets')
    .filter(t => !p.status || t.Status === p.status)
    .filter(t => !q || [t.TicketID, t.Subject, t.Category, members[t.MemberID]]
      .some(v => String(v || '').toLowerCase().indexOf(q) !== -1))
    .sort((a, b) => new Date(b.UpdatedAt) - new Date(a.UpdatedAt))
    .slice(0, 300)
    .map(t => Object.assign(clean_(t), { MemberName: members[t.MemberID] || '' }));
}

function apiUpdateTicket_(ctx, p) {
  const t = findTicket_(p.ticketId);
  const patch = { UpdatedAt: new Date() };

  if (p.status !== undefined) {
    if (TICKET_STATUSES.indexOf(p.status) === -1) throw new Error('สถานะไม่ถูกต้อง');
    patch.Status = p.status;
    if (p.status === 'resolved' && !t.ResolvedAt) patch.ResolvedAt = new Date();
  }
  if (p.priority !== undefined) {
    if (TICKET_PRIORITIES.indexOf(p.priority) === -1) throw new Error('ระดับความสำคัญไม่ถูกต้อง');
    patch.Priority = p.priority;
  }
  if (p.assignedTo !== undefined) patch.AssignedTo = str_(p.assignedTo, 100, 'ผู้รับผิดชอบ', false);

  const note = str_(p.note, 1000, 'หมายเหตุ', false);
  update_('Tickets', t._row, patch);

  const statusChanged = patch.Status && patch.Status !== t.Status;
  if (statusChanged || note) {
    addLog_(t.TicketID, 'staff', actorName_(ctx), note || ('เปลี่ยนสถานะเป็น ' + STATUS_TH[patch.Status]), patch.Status || '');
  }
  if (statusChanged) {
    pushText_(t.LineUserID, '📌 เรื่อง ' + t.TicketID + ' "' + t.Subject + '"\nสถานะ: ' + STATUS_TH[patch.Status] + (note ? '\n' + note : ''));
  } else if (note) {
    pushText_(t.LineUserID, '💬 เจ้าหน้าที่ตอบเรื่อง ' + t.TicketID + '\n' + note);
  }
  audit_(actorName_(ctx), 'updateTicket', t.TicketID, JSON.stringify(patch));
  return { updated: true };
}
