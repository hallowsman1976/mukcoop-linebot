/**
 * Line.js — เรียก LINE Messaging API
 */

const LINE_API = 'https://api.line.me/v2/bot';

function callLine_(method, path, payload) {
  const res = UrlFetchApp.fetch(LINE_API + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) {
    Logger.log('[callLine_] ' + method + ' ' + path + ' -> ' + code + ' ' + text);
    throw new Error('ส่งข้อความผ่าน LINE ไม่สำเร็จ (HTTP ' + code + ')');
  }
  return text ? JSON.parse(text) : {};
}

function textMsg_(text) {
  return { type: 'text', text: String(text).slice(0, 5000) };
}

function replyText_(replyToken, text) {
  callLine_('post', '/message/reply', { replyToken: replyToken, messages: [textMsg_(text)] });
}

/** แจ้งเตือนรายบุคคล — ล้มเหลวได้โดยไม่ทำให้งานหลักพัง */
function pushText_(userId, text) {
  if (!userId) return false;
  try {
    callLine_('post', '/message/push', { to: userId, messages: [textMsg_(text)] });
    return true;
  } catch (err) {
    Logger.log('[pushText_] ' + userId + ': ' + err.message);
    return false;
  }
}

/** ส่งหลายคนทีละไม่เกิน 500 (ขีดจำกัดของ multicast) คืนจำนวนที่ส่งสำเร็จ */
function multicastText_(userIds, text) {
  let sent = 0;
  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    try {
      callLine_('post', '/message/multicast', { to: chunk, messages: [textMsg_(text)] });
      sent += chunk.length;
    } catch (err) {
      Logger.log('[multicastText_] chunk ' + i + ' failed: ' + err.message);
    }
  }
  return sent;
}

function getQuota_() {
  const quota = callLine_('get', '/message/quota');
  const usage = callLine_('get', '/message/quota/consumption');
  const limited = quota.type === 'limited' ? Number(quota.value) : null;
  return {
    limit: limited,
    used: Number(usage.totalUsage || 0),
    remaining: limited === null ? null : limited - Number(usage.totalUsage || 0)
  };
}

function notifyStaff_(text) {
  const ids = readAll_('Staff').filter(s => truthy_(s.Active) && s.LineUserID).map(s => String(s.LineUserID));
  if (ids.length) multicastText_(ids, text);
}
