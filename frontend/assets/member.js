/* หน้าสมาชิก (LIFF): ลงทะเบียน → แจ้งเรื่อง → ติดตามเรื่อง */

const app = document.getElementById('app');
const CATEGORIES = ['ทั่วไป', 'การเงิน/บัญชี', 'ข้อมูลสมาชิก', 'สวัสดิการ', 'ข้อเสนอแนะ', 'อื่น ๆ'];
let me = null;
let tab = 'new';

async function main() {
  if (!(await startLiff(window.APP_CONFIG.LIFF_ID_MEMBER))) return;
  me = await api('me');
  render();
}

function render() {
  if (!me.member) return mount(app, header(), registerForm());
  if (me.member.Status !== 'active') return mount(app, header(), pendingCard());

  const tabs = el('div', { class: 'tabs', role: 'tablist' },
    [['new', 'แจ้งเรื่องใหม่'], ['mine', 'เรื่องของฉัน'], ['profile', 'ข้อมูลของฉัน']].map(([id, label]) =>
      el('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; render(); } }, label)));

  const body = el('div', {});
  mount(app, header(), tabs, body);
  if (tab === 'new') newTicketForm(body);
  else if (tab === 'mine') myTickets(body);
  else mount(body, registerForm(true));
}

function header() {
  return el('div', { class: 'card row' },
    el('div', {}, el('h1', {}, 'สวัสดี ' + (me.member ? me.member.FullName : me.identity.name)),
      el('div', { class: 'muted' }, me.member ? 'เลขสมาชิก ' + (me.member.MemberNo || '-') : 'ยังไม่ได้ลงทะเบียน')));
}

function pendingCard() {
  return el('div', { class: 'card' }, el('h2', {}, 'รอเจ้าหน้าที่อนุมัติ'),
    el('p', { class: 'muted' }, 'ส่งข้อมูลลงทะเบียนแล้ว เมื่ออนุมัติเสร็จระบบจะแจ้งเตือนทาง LINE'));
}

function field(label, input) {
  return el('div', {}, el('label', {}, label), input);
}

function registerForm(editing) {
  if (!editing) return linkForm();
  const m = me.member || {};
  const fullName = el('input', { value: m.FullName || '', autocomplete: 'name', maxlength: 100 });
  const phone = el('input', { value: m.Phone || '', inputmode: 'tel', autocomplete: 'tel', maxlength: 15, placeholder: '0812345678' });
  const btn = el('button', {}, 'บันทึกข้อมูล');
  btn.addEventListener('click', () => guarded(btn, async () => {
    await api('register', { fullName: fullName.value, phone: phone.value });
    toast('บันทึกแล้ว');
    me = await api('me');
    render();
  }));
  return el('div', { class: 'card stack' },
    el('h2', {}, 'ข้อมูลของฉัน'),
    el('div', { class: 'muted' }, 'เลขสมาชิก ' + (m.MemberNo || '-') + ' (แก้ไขไม่ได้ หากไม่ถูกต้องติดต่อเจ้าหน้าที่)'),
    field('ชื่อ-นามสกุล', fullName), field('เบอร์โทร', phone), btn);
}

/** ลงทะเบียนครั้งแรก: จับคู่กับทะเบียนสมาชิกด้วยเลขสมาชิก + เลขประจำตัวประชาชน */
function linkForm() {
  const memberNo = el('input', { maxlength: 30, autocomplete: 'off', placeholder: 'เลขสมาชิกสหกรณ์' });
  const nationalId = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 17, placeholder: 'เลข 13 หลัก' });
  const consent = el('input', { type: 'checkbox', id: 'consent' });
  const btn = el('button', {}, 'ลงทะเบียน');
  btn.addEventListener('click', () => guarded(btn, async () => {
    await api('register', { memberNo: memberNo.value, nationalId: nationalId.value, consent: consent.checked });
    nationalId.value = '';
    toast('ลงทะเบียนสำเร็จ');
    me = await api('me');
    render();
  }));
  return el('div', { class: 'card stack' },
    el('h2', {}, 'ลงทะเบียนสมาชิก'),
    el('p', { class: 'muted' }, 'กรอกเลขสมาชิกและเลขประจำตัวประชาชนเพื่อยืนยันตัวตนกับทะเบียนสมาชิกของสหกรณ์'),
    field('เลขสมาชิก', memberNo), field('เลขประจำตัวประชาชน 13 หลัก', nationalId),
    el('div', { class: 'row' }, consent,
      el('label', { for: 'consent' }, 'ข้าพเจ้ายินยอมให้สหกรณ์เก็บและใช้ข้อมูลส่วนบุคคล (ชื่อ เบอร์โทร บัญชี LINE) เพื่อการติดต่อและให้บริการสมาชิก เลขประจำตัวประชาชนใช้ยืนยันตัวตนเท่านั้น และไม่ถูกจัดเก็บ')),
    btn);
}

function newTicketForm(container) {
  const category = selectEl(CATEGORIES.map(c => [c, c]), CATEGORIES[0]);
  const subject = el('input', { maxlength: 120, placeholder: 'สรุปเรื่องสั้น ๆ' });
  const detail = el('textarea', { maxlength: 2000, placeholder: 'อธิบายรายละเอียด' });
  const btn = el('button', {}, 'ส่งเรื่อง');
  btn.addEventListener('click', () => guarded(btn, async () => {
    const r = await api('createTicket', { category: category.value, subject: subject.value, detail: detail.value });
    toast('ส่งเรื่องแล้ว เลขที่ ' + r.ticketId);
    tab = 'mine';
    render();
  }));
  mount(container, el('div', { class: 'card stack' }, el('h2', {}, 'แจ้งเรื่องใหม่'),
    field('หมวดหมู่', category), field('หัวข้อ', subject), field('รายละเอียด', detail), btn));
}

async function myTickets(container) {
  mount(container, el('div', { class: 'center' }, 'กำลังโหลด...'));
  const list = await api('myTickets').catch(err => { toast(err.message, true); return []; });
  if (!list.length) return mount(container, el('div', { class: 'center' }, 'ยังไม่มีเรื่องที่แจ้งไว้'));
  mount(container, list.map(t => el('button', { class: 'item', onclick: () => ticketDialog(t.TicketID) },
    el('div', { class: 'row between' }, el('span', { class: 'title' }, t.Subject), badge(STATUS_TH[t.Status], t.Status)),
    el('div', { class: 'muted' }, t.TicketID + ' · ' + fmtDate(t.UpdatedAt)))));
}

async function ticketDialog(ticketId) {
  let data;
  try { data = await api('ticketDetail', { ticketId }); } catch (err) { return toast(err.message, true); }
  const t = data.ticket;
  const dlg = el('dialog', {});
  const note = el('textarea', { maxlength: 1000, placeholder: 'พิมพ์ข้อความถึงเจ้าหน้าที่' });
  const send = el('button', {}, 'ส่งข้อความ');
  send.addEventListener('click', () => guarded(send, async () => {
    await api('addComment', { ticketId, note: note.value });
    dlg.close(); dlg.remove();
    ticketDialog(ticketId);
  }));
  const close = el('button', { class: 'ghost', onclick: () => { dlg.close(); dlg.remove(); } }, 'ปิด');

  mount(dlg, el('div', { class: 'stack' },
    el('div', {}, el('h2', {}, t.Subject), el('div', { class: 'muted' }, t.TicketID + ' · ' + t.Category + ' · ' + fmtDate(t.CreatedAt)), badge(STATUS_TH[t.Status], t.Status)),
    el('p', {}, t.Detail),
    el('div', {}, data.logs.map(l => el('div', { class: 'log ' + l.ActorType },
      el('div', { class: 'who' }, l.ActorName + ' · ' + fmtDate(l.CreatedAt)), el('div', {}, l.Note)))),
    t.Status === 'closed' ? null : [note, send],
    close));
  document.body.append(dlg);
  dlg.showModal();
}

main().catch(err => mount(app, el('div', { class: 'center' }, 'เกิดข้อผิดพลาด: ' + err.message)));
