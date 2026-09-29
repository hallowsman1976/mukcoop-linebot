/* หน้าเจ้าหน้าที่: Dashboard / เรื่องแจ้ง / สมาชิก / ส่งประกาศ / เจ้าหน้าที่ (admin) */

const app = document.getElementById('app');
let me = null;
let tab = 'dashboard';
const filters = { tickets: { status: '', q: '' }, members: { status: '', q: '', group: '', tag: '', offset: 0 } };

async function main() {
  if (!(await startLiff(window.APP_CONFIG.LIFF_ID_ADMIN))) return;
  me = await api('me');
  if (!me.staff) return mount(app, el('div', { class: 'center' }, 'บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่'));
  render();
}

function render() {
  const tabDefs = [['dashboard', 'ภาพรวม'], ['tickets', 'เรื่องแจ้ง'], ['members', 'สมาชิก'], ['broadcast', 'ส่งประกาศ'], ['autoreply', 'ตอบอัตโนมัติ']];
  if (me.staff.role === 'admin') tabDefs.push(['richmenu', 'Rich menu'], ['staff', 'เจ้าหน้าที่']);

  const body = el('div', {});
  mount(app,
    el('div', { class: 'row between' }, el('h1', {}, 'ระบบจัดการสมาชิก'), el('span', { class: 'muted' }, me.staff.name + ' (' + me.staff.role + ')')),
    el('div', { class: 'tabs', role: 'tablist' }, tabDefs.map(([id, label]) =>
      el('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; render(); } }, label))),
    body);
  ({ dashboard: viewDashboard, tickets: viewTickets, members: viewMembers, broadcast: viewBroadcast, autoreply: viewAutoReply, richmenu: viewRichMenu, staff: viewStaff })[tab](body);
}

function loading(c) { mount(c, el('div', { class: 'center' }, 'กำลังโหลด...')); }
function failed(c, err) { mount(c, el('div', { class: 'center' }, err.message)); }
function field(label, input) { return el('div', {}, el('label', {}, label), input); }

function openDialog(...children) {
  const dlg = el('dialog', {});
  const close = () => { dlg.close(); dlg.remove(); };
  mount(dlg, el('div', { class: 'stack' }, children.map(c => (typeof c === 'function' ? c(close) : c))));
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

// ---------- Dashboard ----------
async function viewDashboard(c) {
  loading(c);
  let d;
  try { d = await api('dashboard'); } catch (err) { return failed(c, err); }
  const stat = (n, label) => el('div', { class: 'stat' }, el('div', { class: 'n' }, n), el('div', { class: 'muted' }, label));
  const max = Math.max(1, ...d.ticketsByDay.map(x => x.count));
  mount(c,
    el('div', { class: 'grid' }, stat(d.members.active, 'สมาชิกที่ใช้งาน'), stat(d.members.imported, 'ยังไม่ผูก LINE'), stat(d.members.pending, 'รออนุมัติ'),
      stat(d.tickets.open, 'เรื่องใหม่'), stat(d.tickets.in_progress, 'กำลังดำเนินการ'),
      stat(d.avgResolveHours + ' ชม.', 'เวลาแก้เฉลี่ย')),
    el('div', { class: 'card' }, el('h2', {}, 'เรื่องแจ้งใหม่ 14 วันล่าสุด'),
      el('div', { class: 'bars', role: 'img', 'aria-label': 'กราฟแท่งจำนวนเรื่องแจ้งต่อวัน' },
        d.ticketsByDay.map(x => el('div', { class: 'bar', title: x.date + ': ' + x.count, style: 'height:' + Math.round(x.count / max * 100) + '%' }))),
      el('div', { class: 'bars-x' }, d.ticketsByDay.map(x => el('span', {}, x.date.slice(8))))));
}

// ---------- Tickets ----------
async function viewTickets(c) {
  const f = filters.tickets;
  const list = el('div', {});
  const load = async () => {
    loading(list);
    try {
      const rows = await api('listTickets', f);
      mount(list, rows.length ? rows.map(t => el('button', { class: 'item', onclick: () => ticketDialog(t.TicketID, load) },
        el('div', { class: 'row between' }, el('span', { class: 'title' }, t.Subject),
          el('span', { class: 'row' }, t.Priority === 'high' ? badge('ด่วน', 'high') : null, badge(STATUS_TH[t.Status], t.Status))),
        el('div', { class: 'muted' }, t.TicketID + ' · ' + t.MemberName + ' · ' + t.Category + ' · ' + fmtDate(t.UpdatedAt))))
        : el('div', { class: 'center' }, 'ไม่พบเรื่อง'));
    } catch (err) { failed(list, err); }
  };
  const q = el('input', { value: f.q, placeholder: 'ค้นหา เลขที่/หัวข้อ/ชื่อ' });
  q.addEventListener('change', () => { f.q = q.value; load(); });
  mount(c, el('div', { class: 'row', style: 'margin-bottom:12px' },
    selectEl([['', 'ทุกสถานะ'], ...Object.entries(STATUS_TH)], f.status, v => { f.status = v; load(); }), q), list);
  load();
}

async function ticketDialog(ticketId, reload) {
  let data;
  try { data = await api('ticketDetail', { ticketId }); } catch (err) { return toast(err.message, true); }
  const t = data.ticket;
  const status = selectEl(Object.entries(STATUS_TH), t.Status);
  const priority = selectEl(Object.entries(PRIORITY_TH), t.Priority);
  const assigned = el('input', { value: t.AssignedTo, maxlength: 100, placeholder: 'ชื่อผู้รับผิดชอบ' });
  const note = el('textarea', { maxlength: 1000, placeholder: 'ข้อความถึงสมาชิก (ส่งเข้า LINE ของเขาด้วย)' });
  openDialog(
    el('div', {}, el('h2', {}, t.Subject),
      el('div', { class: 'muted' }, t.TicketID + ' · ' + (data.member ? data.member.name + ' ' + data.member.phone : '') + ' · ' + fmtDate(t.CreatedAt))),
    el('p', {}, t.Detail),
    el('div', {}, data.logs.map(l => el('div', { class: 'log ' + l.ActorType },
      el('div', { class: 'who' }, l.ActorName + ' · ' + fmtDate(l.CreatedAt)), el('div', {}, l.Note)))),
    el('div', { class: 'row' }, field('สถานะ', status), field('ความสำคัญ', priority)),
    field('ผู้รับผิดชอบ', assigned), note,
    close => {
      const save = el('button', {}, 'บันทึก');
      save.addEventListener('click', () => guarded(save, async () => {
        await api('updateTicket', { ticketId, status: status.value, priority: priority.value, assignedTo: assigned.value, note: note.value });
        toast('บันทึกแล้ว'); close(); reload();
      }));
      return el('div', { class: 'row' }, save, el('button', { class: 'ghost', onclick: close }, 'ปิด'));
    });
}

// ---------- Members ----------
const MEMBER_PAGE = 50;
const memberSel = { ids: new Set(), allMatching: false };

function memberFilterParams() {
  const f = filters.members;
  return { q: f.q, status: f.status, group: f.group, tag: f.tag };
}

function downloadCsv(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }); // BOM ให้ Excel อ่านภาษาไทยถูก
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** อ่าน CSV แบบย่อ (เครื่องหมายคำพูด, "" escape) */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

async function viewMembers(c) {
  const f = filters.members;
  const isAdmin = me.staff.role === 'admin';
  const list = el('div', {});
  const bar = el('div', { class: 'row', style: 'margin:8px 0' });
  const pager = el('div', { class: 'row between', style: 'margin-top:12px' });
  let data = { total: 0, rows: [], groups: [], tags: [] };

  const selectedCount = () => (memberSel.allMatching ? data.total : memberSel.ids.size);

  const renderBar = () => {
    const n = selectedCount();
    const pageIds = data.rows.map(m => m.MemberID);
    const allOnPage = pageIds.length > 0 && pageIds.every(id => memberSel.ids.has(id));
    const selPage = el('button', { class: 'ghost' }, allOnPage ? 'ยกเลิกเลือกหน้านี้' : 'เลือกทั้งหน้านี้');
    selPage.addEventListener('click', () => {
      memberSel.allMatching = false;
      pageIds.forEach(id => (allOnPage ? memberSel.ids.delete(id) : memberSel.ids.add(id)));
      renderList();
    });
    const selAll = el('button', { class: 'ghost' }, 'เลือกทั้งหมดที่ตรงตัวกรอง (' + data.total + ')');
    selAll.addEventListener('click', () => { memberSel.allMatching = true; memberSel.ids.clear(); renderList(); });
    const clear = el('button', { class: 'ghost' }, 'ล้างที่เลือก');
    clear.addEventListener('click', () => { memberSel.allMatching = false; memberSel.ids.clear(); renderList(); });
    const bulk = el('button', {}, 'แก้ที่เลือก (' + n + ')');
    bulk.disabled = n === 0;
    bulk.addEventListener('click', () => bulkDialog(n, load));
    const items = [selPage, selAll];
    if (n) items.push(clear, bulk);
    if (isAdmin) {
      const exp = el('button', { class: 'ghost' }, 'ส่งออก CSV');
      exp.addEventListener('click', () => guarded(exp, async () => {
        if (!confirm('ส่งออกข้อมูลสมาชิก ' + data.total + ' คนตามตัวกรองนี้? การส่งออกจะถูกบันทึกในประวัติการใช้งาน')) return;
        const r = await api('exportMembers', memberFilterParams());
        downloadCsv('members-' + new Date().toISOString().slice(0, 10) + '.csv', r.csv);
        toast('ส่งออก ' + r.count + ' คนแล้ว (ถ้าไม่ดาวน์โหลด ให้เปิดหน้านี้ในเบราว์เซอร์ภายนอก)');
      }));
      const imp = el('button', { class: 'ghost' }, 'นำเข้ากลุ่ม/แท็ก CSV');
      imp.addEventListener('click', () => importLabelsDialog(load));
      items.push(exp, imp);
    }
    mount(bar, items);
  };

  const renderList = () => {
    renderBar();
    mount(list, data.rows.length ? data.rows.map(m => {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', 'aria-label': 'เลือก ' + m.FullName });
      cb.checked = memberSel.allMatching || memberSel.ids.has(m.MemberID);
      cb.disabled = memberSel.allMatching;
      cb.addEventListener('change', () => {
        if (cb.checked) memberSel.ids.add(m.MemberID); else memberSel.ids.delete(m.MemberID);
        renderBar();
      });
      return el('div', { class: 'row', style: 'flex-wrap:nowrap' }, cb,
        el('button', { class: 'item', onclick: () => memberDialog(m, load) },
          el('div', { class: 'row between' }, el('span', { class: 'title' }, m.FullName), badge(MEMBER_STATUS_TH[m.Status], m.Status)),
          el('div', { class: 'muted' }, [m.MemberNo && 'เลขสมาชิก ' + m.MemberNo, m.Phone, m.Group, m.Tags].filter(Boolean).join(' · '))));
    }) : el('div', { class: 'center' }, 'ไม่พบสมาชิก'));

    const from = data.total ? f.offset + 1 : 0;
    const to = Math.min(f.offset + MEMBER_PAGE, data.total);
    const prev = el('button', { class: 'ghost' }, '← ก่อนหน้า');
    prev.disabled = f.offset === 0;
    prev.addEventListener('click', () => { f.offset = Math.max(0, f.offset - MEMBER_PAGE); load(); });
    const next = el('button', { class: 'ghost' }, 'ถัดไป →');
    next.disabled = to >= data.total;
    next.addEventListener('click', () => { f.offset += MEMBER_PAGE; load(); });
    mount(pager, prev, el('span', { class: 'muted' }, from + '–' + to + ' จาก ' + data.total + ' คน'), next);
  };

  const load = async () => {
    loading(list);
    try {
      data = await api('listMembers', Object.assign(memberFilterParams(), { limit: MEMBER_PAGE, offset: f.offset }));
      if (f.offset > 0 && !data.rows.length) { f.offset = 0; return load(); }
      renderFilters();
      renderList();
    } catch (err) { failed(list, err); }
  };

  const filterRow = el('div', { class: 'row', style: 'margin-bottom:8px' });
  const renderFilters = () => {
    const reset = () => { f.offset = 0; memberSel.allMatching = false; memberSel.ids.clear(); };
    const q = el('input', { value: f.q, placeholder: 'ค้นหา ชื่อ/เบอร์/เลขสมาชิก/กลุ่ม/แท็ก' });
    q.addEventListener('change', () => { f.q = q.value; reset(); load(); });
    mount(filterRow,
      selectEl([['', 'ทุกสถานะ'], ...Object.entries(MEMBER_STATUS_TH)], f.status, v => { f.status = v; reset(); load(); }),
      selectEl([['', 'ทุกกลุ่ม'], ...data.groups.map(g => [g, g])], f.group, v => { f.group = v; reset(); load(); }),
      selectEl([['', 'ทุกแท็ก'], ...data.tags.map(t => [t, t])], f.tag, v => { f.tag = v; reset(); load(); }),
      q);
  };

  mount(c, filterRow, bar, list, pager);
  load();
}

function bulkDialog(count, reload) {
  const addTags = el('input', { placeholder: 'เช่น ผู้กู้, ผู้สูงอายุ (คั่นด้วยจุลภาค)', maxlength: 200 });
  const removeTags = el('input', { placeholder: 'แท็กที่จะเอาออก', maxlength: 200 });
  const group = el('input', { placeholder: 'ปล่อยว่าง = ไม่เปลี่ยนกลุ่ม', maxlength: 50 });
  const status = selectEl([['', 'ไม่เปลี่ยนสถานะ'], ['active', 'ใช้งานอยู่'], ['inactive', 'ปิดใช้งาน']], '');
  openDialog(
    el('div', {}, el('h2', {}, 'แก้ข้อมูลหลายคน'), el('div', { class: 'muted' }, 'จะแก้สมาชิก ' + count + ' คน')),
    field('เพิ่มแท็ก', addTags), field('เอาแท็กออก', removeTags), field('ย้ายไปกลุ่ม', group), field('สถานะ', status),
    close => {
      const save = el('button', {}, 'ยืนยันแก้ ' + count + ' คน');
      save.addEventListener('click', () => guarded(save, async () => {
        const params = { addTags: addTags.value, removeTags: removeTags.value, group: group.value, status: status.value };
        if (memberSel.allMatching) params.filter = memberFilterParams(); else params.memberIds = [...memberSel.ids];
        const r = await api('bulkUpdateMembers', params);
        toast('แก้แล้ว ' + r.updated + ' คน' + (r.skipped ? ' | ข้าม ' + r.skipped + ' คน (แท็กยาวเกิน 200 ตัวอักษร)' : '') + (r.statusSkipped ? ' | ไม่ได้เปลี่ยนสถานะ ' + r.statusSkipped + ' คน (ยังไม่ผูก LINE)' : ''));
        memberSel.allMatching = false; memberSel.ids.clear();
        close(); reload();
      }));
      return el('div', { class: 'row' }, save, el('button', { class: 'ghost', onclick: close }, 'ยกเลิก'));
    });
}

function importLabelsDialog(reload) {
  const file = el('input', { type: 'file', accept: '.csv,text/csv' });
  const info = el('div', { class: 'muted' }, 'ไฟล์ CSV (UTF-8) ต้องมีคอลัมน์ "เลขสมาชิก" และอย่างน้อยหนึ่งใน "กลุ่ม" / "แท็ก" ค่ากลุ่ม/แท็กจะเขียนทับของเดิมเฉพาะแถวที่มีค่า (สมาชิกใหม่ต้องนำเข้าผ่าน tools/prepare-import.js)');
  const summary = el('div', {});
  let rows = null;
  file.addEventListener('change', async () => {
    rows = null;
    if (!file.files[0]) return mount(summary);
    const table = parseCsv(await file.files[0].text());
    const head = (table.shift() || []).map(h => h.trim().toLowerCase());
    const col = names => head.findIndex(h => names.indexOf(h) !== -1);
    const iNo = col(['เลขสมาชิก', 'memberno', 'member_no']);
    const iGroup = col(['กลุ่ม', 'group']);
    const iTags = col(['แท็ก', 'tags']);
    if (iNo === -1 || (iGroup === -1 && iTags === -1)) {
      return mount(summary, el('div', { class: 'muted' }, 'ไม่พบคอลัมน์ที่ต้องมี (เลขสมาชิก + กลุ่ม/แท็ก)'));
    }
    rows = table.map(r => ({ memberNo: r[iNo] || '', group: iGroup === -1 ? '' : (r[iGroup] || ''), tags: iTags === -1 ? '' : (r[iTags] || '') }));
    mount(summary, el('div', {}, 'พบ ' + rows.length + ' แถวในไฟล์'));
  });
  openDialog(el('h2', {}, 'นำเข้ากลุ่ม/แท็กจาก CSV'), info, file, summary, close => {
    const go = el('button', {}, 'นำเข้า');
    go.addEventListener('click', () => guarded(go, async () => {
      if (!rows || !rows.length) throw new Error('กรุณาเลือกไฟล์ที่ถูกต้องก่อน');
      const r = await api('importMemberLabels', { rows });
      toast('อัปเดต ' + r.updated + ' คน' + (r.notFound ? ' | ไม่พบเลขสมาชิก ' + r.notFound + ' แถว (เช่น ' + r.notFoundSample.slice(0, 5).join(', ') + ')' : ''));
      close(); reload();
    }));
    return el('div', { class: 'row' }, go, el('button', { class: 'ghost', onclick: close }, 'ยกเลิก'));
  });
}

function memberDialog(m, reload) {
  const status = selectEl(Object.entries(MEMBER_STATUS_TH), m.Status);
  const memberNo = el('input', { value: m.MemberNo, maxlength: 30 });
  const group = el('input', { value: m.Group, maxlength: 50, placeholder: 'เช่น สมาชิกสามัญ' });
  const tags = el('input', { value: m.Tags, maxlength: 200, placeholder: 'คั่นด้วยจุลภาค เช่น vip, กรุงเทพ' });
  const note = el('textarea', { maxlength: 500 }); note.value = m.Note || '';
  const history = el('div', { class: 'muted' }, 'กำลังโหลดประวัติเรื่องที่แจ้ง...');
  const linked = !!String(m.LineUserID);

  api('memberDetail', { memberId: m.MemberID }).then(d => {
    mount(history, d.tickets.length
      ? d.tickets.map(t => el('div', { class: 'row between' },
        el('span', {}, t.TicketID + ' · ' + t.Subject), badge(STATUS_TH[t.Status], t.Status)))
      : 'ยังไม่เคยแจ้งเรื่อง');
  }).catch(err => mount(history, err.message));

  openDialog(
    el('div', {}, el('h2', {}, m.FullName),
      el('div', { class: 'muted' }, [m.Phone, linked ? 'ผูก LINE แล้ว' : 'ยังไม่ผูก LINE', 'สร้างเมื่อ ' + fmtDate(m.CreatedAt)].filter(Boolean).join(' · '))),
    field('สถานะ', status), field('เลขสมาชิก', memberNo), field('กลุ่ม', group), field('แท็ก', tags), field('หมายเหตุภายใน', note),
    el('div', {}, el('label', {}, 'เรื่องที่เคยแจ้ง'), history),
    close => {
      const save = el('button', {}, 'บันทึก');
      save.addEventListener('click', () => guarded(save, async () => {
        await api('updateMember', { memberId: m.MemberID, status: status.value, memberNo: memberNo.value, group: group.value, tags: tags.value, note: note.value });
        toast('บันทึกแล้ว'); close(); reload();
      }));
      return el('div', { class: 'row' }, save, el('button', { class: 'ghost', onclick: close }, 'ปิด'));
    });
}

// ---------- Broadcast ----------
async function viewBroadcast(c) {
  loading(c);
  let opts;
  try { opts = await api('audienceOptions'); } catch (err) { return failed(c, err); }
  const isAdmin = me.staff.role === 'admin';

  const group = selectEl([['', 'ทุกกลุ่ม (' + opts.total + ' คน)'], ...opts.groups.map(g => [g.name, g.name + ' (' + g.count + ')'])], '');
  const tagMode = selectEl([['any', 'มีแท็กใดแท็กหนึ่ง'], ['all', 'มีครบทุกแท็กที่เลือก']], 'any');
  const tagBoxes = opts.tags.map(t => {
    const cb = el('input', { type: 'checkbox', value: t.name, style: 'width:auto' });
    cb.addEventListener('change', invalidate);
    return { cb, node: el('label', { style: 'display:inline-flex;gap:6px;align-items:center;margin:0 12px 6px 0;color:inherit' }, cb, t.name + ' (' + t.count + ')') };
  });
  const title = el('input', { maxlength: 100, placeholder: 'หัวข้อประกาศ' });
  const text = el('textarea', { maxlength: 4500, placeholder: 'ข้อความ' });
  const info = el('div', { class: 'muted', role: 'status' }, 'กด "ตรวจจำนวนผู้รับ" ก่อนส่ง');

  const audience = () => ({
    group: group.value,
    tags: tagBoxes.filter(t => t.cb.checked).map(t => t.cb.value),
    tagMode: tagMode.value
  });
  function invalidate() { info.textContent = 'เปลี่ยนเงื่อนไขแล้ว กด "ตรวจจำนวนผู้รับ" ใหม่'; }
  group.addEventListener('change', invalidate);
  tagMode.addEventListener('change', invalidate);

  const runPreview = async () => {
    const r = await api('audiencePreview', { audience: audience() });
    const b = r.breakdown;
    const excluded = [b.notLinked && b.notLinked + ' คนยังไม่ผูก LINE', b.notActive && b.notActive + ' คนไม่ใช่สถานะใช้งาน',
      b.notFollowing && b.notFollowing + ' คนเลิกติดตาม/บล็อก OA'].filter(Boolean);
    info.textContent = r.description + ' → ส่งถึง ' + r.count + ' คน' +
      (excluded.length ? ' (ไม่นับ: ' + excluded.join(', ') + ')' : '') +
      (r.quota && r.quota.remaining !== null ? ' · โควตาเดือนนี้เหลือ ' + r.quota.remaining + ' จาก ' + r.quota.limit : '');
    return r;
  };

  const preview = el('button', { class: 'ghost' }, 'ตรวจจำนวนผู้รับ');
  preview.addEventListener('click', () => guarded(preview, runPreview));

  const test = el('button', { class: 'ghost' }, 'ส่งทดสอบถึงตัวเอง');
  test.addEventListener('click', () => guarded(test, async () => {
    await api('sendBroadcast', { title: title.value, text: text.value, testOnly: true });
    toast('ส่งทดสอบถึงคุณแล้ว ตรวจใน LINE');
  }));

  const send = el('button', {}, 'ส่งประกาศ');
  send.addEventListener('click', () => guarded(send, async () => {
    const r = await runPreview();
    if (!r.count) throw new Error('ไม่มีผู้รับตามเงื่อนไขที่เลือก');
    if (!confirm('ส่งถึง ' + r.count + ' คน\n(' + r.description + ')\nกินโควตา ' + r.count + ' ข้อความ ยืนยันหรือไม่?')) return;
    const out = await api('sendBroadcast', { title: title.value, text: text.value, audience: audience(), confirm: true, expectedCount: r.count });
    toast('ส่งแล้ว ' + out.sent + ' จาก ' + out.targeted + ' คน');
    title.value = ''; text.value = '';
    history_();
  }));

  const hist = el('div', {});
  const history_ = async () => {
    try {
      const rows = await api('listBroadcasts');
      mount(hist, el('h2', {}, 'ประวัติการส่ง'), rows.length ? rows.map(b => el('div', { class: 'card' },
        el('div', { class: 'title' }, b.Title),
        el('div', { class: 'muted' }, [fmtDate(b.SentAt), b.Recipients + ' คน', b.AudienceText, 'โดย ' + b.SentBy].filter(Boolean).join(' · '))))
        : el('div', { class: 'muted' }, 'ยังไม่เคยส่ง'));
    } catch (err) { failed(hist, err); }
  };

  mount(c, el('div', { class: 'card stack' }, el('h2', {}, 'ส่งประกาศ'),
    el('div', { class: 'muted' }, 'ส่งถึงเฉพาะสมาชิกที่ใช้งานอยู่ ผูก LINE แล้ว และยังติดตาม OA (ตัวเลขในวงเล็บคือจำนวนที่ส่งถึงได้จริง)'),
    field('กลุ่ม', group),
    opts.tags.length ? el('div', {}, el('label', {}, 'แท็ก (ไม่เลือก = ไม่กรองด้วยแท็ก)'), el('div', {}, tagBoxes.map(t => t.node))) : null,
    opts.tags.length ? field('เงื่อนไขแท็ก', tagMode) : null,
    field('หัวข้อ', title), field('ข้อความ', text), info,
    el('div', { class: 'row' }, preview, isAdmin ? [test, send] : el('span', { class: 'muted' }, 'เฉพาะผู้ดูแลระบบที่ส่งได้'))), hist);
  history_();
}

// ---------- Auto-reply ----------
const MATCH_TYPE_TH = { contains: 'มีคำนี้อยู่ในข้อความ', exact: 'ตรงทั้งข้อความ', fallback: 'ไม่ตรงกฎใดเลย (fallback)' };

async function viewAutoReply(c) {
  loading(c);
  let rules;
  try { rules = await api('listAutoReplies'); } catch (err) { return failed(c, err); }
  const isAdmin = me.staff.role === 'admin';
  const reload = () => viewAutoReply(c);

  const testInput = el('input', { maxlength: 500, placeholder: 'พิมพ์ข้อความที่สมาชิกอาจส่งมา เช่น สมัครสมาชิก' });
  const testOut = el('div', { class: 'muted', role: 'status' });
  const testBtn = el('button', { class: 'ghost' }, 'ทดสอบ');
  testBtn.addEventListener('click', () => guarded(testBtn, async () => {
    const r = await api('testAutoReply', { text: testInput.value });
    mount(testOut, el('div', {}, 'กฎที่ตอบ: ' + r.rule), el('div', { style: 'white-space:pre-wrap;margin-top:6px' }, r.reply));
  }));

  const ruleCard = r => el('div', { class: 'card stack' },
    el('div', { class: 'row between' }, el('span', { class: 'title' }, r.Name),
      badge(truthyCell(r.Active) ? 'เปิดใช้งาน' : 'ปิดอยู่', truthyCell(r.Active) ? 'active' : 'inactive')),
    el('div', { class: 'muted' }, MATCH_TYPE_TH[r.MatchType] + (r.Keywords ? ': ' + r.Keywords : '') + ' · ลำดับ ' + (r.Priority || 0)),
    el('div', { style: 'white-space:pre-wrap' }, r.Reply),
    isAdmin ? el('div', { class: 'row' },
      el('button', { class: 'ghost small', onclick: () => ruleDialog(r, reload) }, 'แก้ไข'),
      el('button', { class: 'ghost small', onclick: e => guarded(e.target, async () => {
        await api('saveAutoReply', ruleParams(r, { active: !truthyCell(r.Active) }));
        reload();
      }) }, truthyCell(r.Active) ? 'ปิดกฎนี้' : 'เปิดกฎนี้')) : null);

  mount(c,
    el('div', { class: 'card stack' }, el('h2', {}, 'ทดสอบข้อความ'),
      el('div', { class: 'muted' }, 'ดูว่าข้อความหนึ่งจะถูกตอบด้วยกฎไหน โดยไม่ส่งข้อความจริง'),
      el('div', { class: 'row' }, testInput, testBtn), testOut),
    el('div', { class: 'row between', style: 'margin:12px 0' }, el('h2', {}, 'กฎตอบอัตโนมัติ (' + rules.length + ')'),
      isAdmin ? el('button', { onclick: () => ruleDialog(null, reload) }, '+ เพิ่มกฎ') : el('span', { class: 'muted' }, 'เฉพาะผู้ดูแลระบบที่แก้ได้')),
    el('div', { class: 'muted', style: 'margin-bottom:8px' }, 'ตอบผ่าน reply จึงไม่กินโควตาข้อความ · คำว่า "สถานะ" และ "ติดตาม" ใช้ดูสถานะเรื่องที่แจ้ง (ตั้งเป็นคำสำคัญไม่ได้)'),
    rules.map(ruleCard));
}

function truthyCell(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function ruleParams(r, over) {
  return Object.assign({ ruleId: r.RuleID, name: r.Name, matchType: r.MatchType, keywords: r.Keywords, reply: r.Reply, priority: r.Priority, active: truthyCell(r.Active) }, over || {});
}

function ruleDialog(r, reload) {
  const name = el('input', { value: r ? r.Name : '', maxlength: 60, placeholder: 'เช่น ถามเวลาทำการ' });
  const type = selectEl(Object.entries(MATCH_TYPE_TH), r ? r.MatchType : 'contains');
  const keywords = el('textarea', { placeholder: 'คั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่ เช่น เวลาทำการ, เปิดกี่โมง', maxlength: 1000, style: 'min-height:70px' });
  keywords.value = r ? r.Keywords : '';
  const reply = el('textarea', { maxlength: 2000, placeholder: 'ข้อความที่จะตอบ ใช้ {{name}} = ชื่อสมาชิก, {{link}} = ลิงก์หน้าสมาชิก' });
  reply.value = r ? r.Reply : '';
  const priority = el('input', { type: 'number', min: -100, max: 100, value: r ? r.Priority || 0 : 0 });
  const active = selectEl([['1', 'เปิดใช้งาน'], ['0', 'ปิด']], !r || truthyCell(r.Active) ? '1' : '0');
  const kwField = field('คำสำคัญ', keywords);
  const syncType = () => { kwField.style.display = type.value === 'fallback' ? 'none' : ''; };
  type.addEventListener('change', syncType);
  syncType();
  openDialog(el('h2', {}, r ? 'แก้กฎ' : 'เพิ่มกฎ'), field('ชื่อกฎ', name), field('วิธีจับคู่', type), kwField,
    field('ข้อความตอบ', reply), field('ลำดับความสำคัญ (มาก = ตรวจก่อน)', priority), field('สถานะ', active),
    close => {
      const save = el('button', {}, 'บันทึก');
      save.addEventListener('click', () => guarded(save, async () => {
        await api('saveAutoReply', { ruleId: r ? r.RuleID : undefined, name: name.value, matchType: type.value,
          keywords: keywords.value, reply: reply.value, priority: priority.value, active: active.value === '1' });
        toast('บันทึกแล้ว'); close(); reload();
      }));
      return el('div', { class: 'row' }, save, el('button', { class: 'ghost', onclick: close }, 'ยกเลิก'));
    });
}

// ---------- Rich menu (admin) ----------
async function viewRichMenu(c) {
  loading(c);
  let st;
  try { st = await api('richMenuStatus'); } catch (err) { return failed(c, err); }

  const options = [['', '(ไม่ใช้)'], ...st.menus.map(m => [m.id, m.name + (m.id === st.defaultId ? ' · เมนูเริ่มต้นตอนนี้' : '')])];
  const guest = selectEl(options, st.assigned.guest);
  const member = selectEl(options, st.assigned.member);
  const staff = selectEl(options, st.assigned.staff);

  const save = el('button', {}, 'บันทึกการใช้เมนู');
  save.addEventListener('click', () => guarded(save, async () => {
    if (guest.value && guest.value !== st.defaultId &&
        !confirm('เมนูของคนที่ยังไม่ลงทะเบียนจะถูกตั้งเป็นเมนูเริ่มต้นของ OA ทุกคนที่ไม่มีเมนูเฉพาะจะเห็นเมนูนี้ทันที ยืนยันหรือไม่?')) return;
    await api('saveRichMenus', { guest: guest.value, member: member.value, staff: staff.value });
    toast('บันทึกแล้ว');
    viewRichMenu(c);
  }));

  const sync = el('button', { class: 'ghost' }, 'ซิงค์เมนูให้ทุกคนตอนนี้');
  sync.addEventListener('click', () => guarded(sync, async () => {
    if (!confirm('จะผูกเมนูสมาชิก/เจ้าหน้าที่ให้ทุกคนที่ผูก LINE แล้ว และยกเลิกเมนูของคนที่ไม่ใช่สมาชิกใช้งาน (ไม่กินโควตาข้อความ) ยืนยันหรือไม่?')) return;
    const r = await api('syncRichMenus', { confirm: true });
    toast('สั่งผูกเมนู ' + r.linked + ' คน · ยกเลิก ' + r.unlinked + ' คน (LINE ประมวลผลภายในไม่กี่นาที)');
  }));

  mount(c,
    el('div', { class: 'card stack' }, el('h2', {}, 'Rich menu ตามสถานะสมาชิก'),
      el('div', { class: 'muted' }, 'ผู้ใช้จะเห็นเมนูต่างกันตามสถานะ: ยังไม่ลงทะเบียน (เมนูเริ่มต้น) · สมาชิกที่ใช้งานอยู่ · เจ้าหน้าที่ ระบบสลับให้อัตโนมัติเมื่อลงทะเบียน/เปลี่ยนสถานะ/แก้สิทธิ์เจ้าหน้าที่'),
      st.menus.length ? null : el('div', { class: 'card' }, 'ยังไม่มี rich menu ใน OA นี้ ต้องสร้างผ่าน Messaging API (เช่น MCP line-bot) เมนูที่สร้างใน LINE OA Manager ใช้กับระบบนี้ไม่ได้'),
      field('คนที่ยังไม่ลงทะเบียน (เมนูเริ่มต้นของ OA)', guest),
      field('สมาชิกที่ใช้งานอยู่', member),
      field('เจ้าหน้าที่/ผู้ดูแลระบบ', staff),
      el('div', { class: 'row' }, save, sync)));
}

// ---------- Staff (admin) ----------
async function viewStaff(c) {
  loading(c);
  let rows;
  try { rows = await api('listStaff'); } catch (err) { return failed(c, err); }
  const userId = el('input', { placeholder: 'LINE User ID (ขึ้นต้นด้วย U)' });
  const name = el('input', { placeholder: 'ชื่อ', maxlength: 100 });
  const role = selectEl([['staff', 'เจ้าหน้าที่'], ['admin', 'ผู้ดูแลระบบ']], 'staff');
  const add = el('button', {}, 'เพิ่ม');
  add.addEventListener('click', () => guarded(add, async () => {
    await api('setStaff', { userId: userId.value, name: name.value, role: role.value, active: true });
    toast('บันทึกแล้ว'); viewStaff(c);
  }));
  mount(c, rows.map(s => el('div', { class: 'item row between' },
    el('span', {}, el('span', { class: 'title' }, s.name), el('div', { class: 'muted' }, s.userId.slice(0, 8) + '… · ' + s.role)),
    el('button', { class: 'ghost small', onclick: e => guarded(e.target, async () => {
      await api('setStaff', { userId: s.userId, name: s.name, role: s.role, active: !s.active });
      viewStaff(c);
    }) }, s.active ? 'ปิดสิทธิ์' : 'เปิดสิทธิ์'))),
    el('div', { class: 'card stack' }, el('h2', {}, 'เพิ่มเจ้าหน้าที่'), field('LINE User ID', userId), field('ชื่อ', name), field('สิทธิ์', role), add),
    backupCard());
}

function backupCard() {
  const body = el('div', { class: 'muted' }, 'กำลังโหลด...');
  const load = async () => {
    try {
      const s = await api('backupStatus');
      const now = el('button', { class: 'ghost' }, 'สำรองตอนนี้');
      now.addEventListener('click', () => guarded(now, async () => {
        const r = await api('backupNow');
        toast('สำรองแล้ว: ' + r.name);
        load();
      }));
      mount(body,
        el('div', {}, s.lastAt ? 'สำรองล่าสุด ' + fmtDate(s.lastAt) + ' · มี ' + s.count + ' ชุด (เก็บย้อนหลัง ' + s.keepDays + ' วัน)' : 'ยังไม่เคยสำรองข้อมูล'),
        s.triggerInstalled ? null : el('div', { class: 'card' }, '⚠ ยังไม่ได้ตั้งสำรองอัตโนมัติรายวัน: รันฟังก์ชัน installBackupTrigger ใน Apps Script'),
        s.stale && s.triggerInstalled ? el('div', { class: 'card' }, '⚠ สำรองล่าสุดเก่ากว่า 2 วัน ตรวจ trigger และ Execution log') : null,
        now);
    } catch (err) { mount(body, err.message); }
  };
  load();
  return el('div', { class: 'card stack' }, el('h2', {}, 'ข้อมูลสำรอง'), body);
}

main().catch(err => mount(app, el('div', { class: 'center' }, 'เกิดข้อผิดพลาด: ' + err.message)));
