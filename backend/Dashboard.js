/**
 * Dashboard.js — สรุปตัวเลขสำหรับเจ้าหน้าที่
 */

function apiDashboard_() {
  const members = readAll_('Members');
  const tickets = readAll_('Tickets');

  const count = (rows, field, value) => rows.filter(r => r[field] === value).length;

  // จำนวนเรื่องใหม่ต่อวัน ย้อนหลัง 14 วัน
  const byDay = {};
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const key = Utilities.formatDate(new Date(Date.now() - i * 86400000), TZ, 'yyyy-MM-dd');
    byDay[key] = 0;
    days.push(key);
  }
  tickets.forEach(t => {
    const key = Utilities.formatDate(new Date(t.CreatedAt), TZ, 'yyyy-MM-dd');
    if (key in byDay) byDay[key]++;
  });

  const resolved = tickets.filter(t => t.ResolvedAt);
  const avgHours = resolved.length
    ? resolved.reduce((s, t) => s + (new Date(t.ResolvedAt) - new Date(t.CreatedAt)), 0) / resolved.length / 3600000
    : 0;

  return {
    members: {
      total: members.length,
      active: count(members, 'Status', 'active'),
      imported: count(members, 'Status', 'imported'),
      pending: count(members, 'Status', 'pending'),
      inactive: count(members, 'Status', 'inactive')
    },
    tickets: {
      total: tickets.length,
      open: count(tickets, 'Status', 'open'),
      in_progress: count(tickets, 'Status', 'in_progress'),
      resolved: count(tickets, 'Status', 'resolved'),
      closed: count(tickets, 'Status', 'closed')
    },
    ticketsByDay: days.map(d => ({ date: d, count: byDay[d] })),
    avgResolveHours: Math.round(avgHours * 10) / 10
  };
}
