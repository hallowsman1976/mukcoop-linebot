/* ตัวช่วยร่วมของหน้าสมาชิกและหน้าเจ้าหน้าที่: LIFF login, เรียก API, สร้าง DOM แบบปลอดภัย (ไม่ใช้ innerHTML กับข้อมูลผู้ใช้) */

const STATUS_TH = { open: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ', resolved: 'แก้ไขแล้ว', closed: 'ปิดเรื่อง' };
const MEMBER_STATUS_TH = { imported: 'ยังไม่ผูก LINE', pending: 'รออนุมัติ', active: 'ใช้งานอยู่', inactive: 'ปิดใช้งาน' };
const PRIORITY_TH = { low: 'ต่ำ', normal: 'ปกติ', high: 'สูง' };

/** el('div', {class:'x', onclick: fn}, 'text', childEl) */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach(c => {
    if (c === null || c === undefined || c === false) return;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return node;
}

function mount(container, ...children) {
  container.replaceChildren(...children.flat().filter(Boolean));
}

function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? '-' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

function badge(text, kind) {
  return el('span', { class: 'badge ' + (kind || '') }, text);
}

let toastTimer = null;
function toast(msg, isError) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

/** เริ่ม LIFF; ถ้ายังไม่ login จะพาไป login แล้วกลับมา (คืน false = กำลัง redirect) */
async function startLiff(liffId) {
  if (!liffId || liffId.startsWith('YOUR_')) throw new Error('ยังไม่ได้ตั้งค่า LIFF ID ใน assets/config.js');
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return false; }
  return true;
}

/** เรียก backend; ส่ง idToken ทุกครั้งเพื่อให้ server verify กับ LINE */
async function api(action, params) {
  const base = window.APP_CONFIG.API_BASE;
  if (!base || base.startsWith('YOUR_')) throw new Error('ยังไม่ได้ตั้งค่า API_BASE ใน assets/config.js');

  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // เลี่ยง CORS preflight ที่ Apps Script ไม่รองรับ
    body: JSON.stringify({ action, idToken: liff.getIDToken(), params: params || {} })
  });
  const out = await res.json();
  if (!out.ok) {
    if (out.code === 'AUTH') { liff.logout(); liff.login({ redirectUri: window.location.href }); }
    throw new Error(out.message || 'เกิดข้อผิดพลาด');
  }
  return out.data;
}

/** ห่อการกดปุ่มที่เรียก API: กันกดซ้ำ + แจ้ง error เป็น toast */
async function guarded(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); }
  catch (err) { toast(err.message, true); }
  finally { if (button) button.disabled = false; }
}

function selectEl(options, value, onchange) {
  const s = el('select', { onchange: onchange ? e => onchange(e.target.value) : null },
    options.map(([v, label]) => el('option', { value: v }, label)));
  s.value = value;
  return s;
}
