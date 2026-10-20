// Live dashboard (full screen): turns the customer's visible requests into
// KPIs, breakdowns, trends, SLA performance and attention lists, and renders
// them. Pure functions, so they can be unit-tested without Forge.
import { formatDuration } from './module-renderers.js';

const DAY = 86400000;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
const CLOSED_WORDS = ['closed', 'resolved', 'done', 'cancelled', 'canceled'];

export function isOpen(row) {
  if (row?.category) return row.category !== 'done';
  const s = String(row?.status || '').toLowerCase();
  return !CLOSED_WORDS.some((w) => s.includes(w));
}

const inMapping = (row, ids) => {
  const set = new Set((ids || []).map(String));
  return set.has(String(row.statusId)) || set.has(String(row.status));
};

const countBy = (rows, key) => {
  const map = new Map();
  for (const r of rows) { const k = key(r) || 'Not set'; map.set(k, (map.get(k) || 0) + 1); }
  return [...map].sort((a, b) => (a[0] === 'Not set') - (b[0] === 'Not set') || b[1] - a[1] || a[0].localeCompare(b[0]));
};

// Monday 00:00 (local) of the week containing t.
const weekStart = (t) => { const d = new Date(t); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); return d.getTime() - day * DAY; };

export function buildLiveModel(data = {}, { now = Date.now(), weeks = 8 } = {}) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const mapping = data.statusMapping || {};
  const open = rows.filter(isOpen);
  const waitingOnYou = open.filter((r) => inMapping(r, mapping.awaitingCustomer));
  const waitingOnSupport = open.filter((r) => inMapping(r, mapping.awaitingSupport));
  const resolvedSince = (ms) => rows.filter((r) => time(r.resolved) && time(r.resolved) >= now - ms);

  const thisWeek = weekStart(now);
  const trend = Array.from({ length: weeks }, (_, i) => {
    const start = thisWeek - (weeks - 1 - i) * 7 * DAY, end = start + 7 * DAY;
    return {
      start,
      label: new Date(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      created: rows.filter((r) => time(r.created) >= start && time(r.created) < end).length,
      resolved: rows.filter((r) => time(r.resolved) >= start && time(r.resolved) < end).length,
    };
  });

  const recentSla = resolvedSince(90 * DAY).filter((r) => r.sla && (r.sla.state === 'met' || r.sla.state === 'breached'));
  const met = recentSla.filter((r) => r.sla.state === 'met').length;
  const resolved30 = resolvedSince(30 * DAY).filter((r) => time(r.created));
  const avgResolutionMs = resolved30.length ? resolved30.reduce((n, r) => n + (time(r.resolved) - time(r.created)), 0) / resolved30.length : null;

  const age = (r) => Math.max(0, Math.floor((now - time(r.created)) / DAY));
  const brief = (r) => ({ key: r.key, summary: r.summary, status: r.status, url: r.url || '', ageDays: age(r), updated: r.updated });

  return {
    generatedAt: data.generatedAt || new Date(now).toISOString(),
    truncated: Boolean(data.truncated),
    cap: data.cap || rows.length,
    total: rows.length,
    splitName: data.splitField?.name || '',
    kpis: {
      open: open.length,
      waitingOnYou: waitingOnYou.length,
      waitingOnSupport: waitingOnSupport.length,
      breached: open.filter((r) => r.sla?.state === 'breached').length,
      atRisk: open.filter((r) => r.sla?.atRisk).length,
      resolvedThisWeek: rows.filter((r) => time(r.resolved) >= thisWeek).length,
      createdThisWeek: rows.filter((r) => time(r.created) >= thisWeek).length,
    },
    byStatus: countBy(open, (r) => r.status),
    bySplit: data.splitField ? countBy(open, (r) => r.split) : [],
    byType: countBy(open, (r) => r.requestType).slice(0, 8),
    trend,
    sla: { measured: recentSla.length, met, metPct: recentSla.length ? Math.round((met / recentSla.length) * 100) : null, avgResolutionMs, resolved30: resolved30.length },
    oldestOpen: [...open].sort((a, b) => time(a.created) - time(b.created)).slice(0, 8).map(brief),
    waitingList: [...waitingOnYou].sort((a, b) => time(a.created) - time(b.created)).slice(0, 6).map(brief),
    recentlyUpdated: [...rows].sort((a, b) => time(b.updated) - time(a.updated)).slice(0, 8).map(brief),
  };
}

function bars(rows, total) {
  if (!rows.length) return '<p class="live-empty">Nothing open.</p>';
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<ul class="live-bars">${rows.map(([label, n]) => `<li><span class="live-bar-label" title="${esc(label)}">${esc(label)}</span><span class="live-bar-track"><span class="live-bar-fill" style="width:${Math.max(4, Math.round((n / max) * 100))}%"></span></span><strong>${n}</strong></li>`).join('')}</ul>${total ? '' : ''}`;
}

function trendChart(trend) {
  const max = Math.max(1, ...trend.flatMap((w) => [w.created, w.resolved]));
  const W = 900, H = 200, pad = 24, slot = (W - pad) / trend.length, bw = Math.min(18, slot / 3);
  const y = (n) => H - 22 - (n / max) * (H - 40);
  const cols = trend.map((w, i) => {
    const x = pad + i * slot + slot / 2;
    return `<g><rect class="live-col created" x="${(x - bw - 1).toFixed(1)}" y="${y(w.created).toFixed(1)}" width="${bw}" height="${(H - 22 - y(w.created)).toFixed(1)}"><title>${esc(w.label)}: ${w.created} created</title></rect><rect class="live-col resolved" x="${(x + 1).toFixed(1)}" y="${y(w.resolved).toFixed(1)}" width="${bw}" height="${(H - 22 - y(w.resolved)).toFixed(1)}"><title>${esc(w.label)}: ${w.resolved} resolved</title></rect><text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(w.label)}</text></g>`;
  }).join('');
  return `<svg class="live-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Requests created and resolved per week"><line x1="${pad}" x2="${W}" y1="${H - 22}" y2="${H - 22}" class="live-axis"/>${cols}</svg><div class="live-legend"><span><i class="created"></i>Created</span><span><i class="resolved"></i>Resolved</span></div>`;
}

function list(items, empty, meta) {
  if (!items.length) return `<p class="live-empty">${esc(empty)}</p>`;
  return `<ul class="live-list">${items.map((r) => `<li><button type="button" class="live-item" data-key="${esc(r.key)}" data-url="${esc(r.url)}"><span class="live-item-key">${esc(r.key)}</span><span class="live-item-summary">${esc(r.summary)}</span><span class="live-item-meta">${esc(meta(r))}</span></button></li>`).join('')}</ul>`;
}

const ago = (iso, now) => { const m = Math.max(0, Math.round((now - time(iso)) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export function renderLiveDashboard(model, { now = Date.now(), refreshSeconds = 120 } = {}) {
  const k = model.kpis;
  const kpi = (id, label, value, hint, tone = '') => `<button type="button" class="live-kpi ${tone}" data-kpi="${id}"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(hint)}</small></button>`;
  const updated = new Date(model.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `<div class="live-head"><div><span class="eyebrow">Live service dashboard</span><h3>Your service at a glance</h3><p>Updated ${esc(updated)} · refreshes every ${Math.round(refreshSeconds / 60)} minutes${model.truncated ? ` · based on your latest ${model.cap.toLocaleString()} requests` : ''}</p></div><button type="button" class="page-button live-refresh">Refresh</button></div>
<div class="live-kpis">
${kpi('open', 'Open requests', k.open, `${k.createdThisWeek} raised this week`)}
${kpi('awaiting-you', 'Waiting on you', k.waitingOnYou, 'Need your reply', k.waitingOnYou ? 'warn' : '')}
${kpi('awaiting-support', 'With our team', k.waitingOnSupport, 'Being worked on')}
${kpi('breached', 'SLA breached', k.breached, 'Open and past target', k.breached ? 'bad' : 'good')}
${kpi('at-risk', 'SLA at risk', k.atRisk, 'Under 25% of time left', k.atRisk ? 'warn' : 'good')}
${kpi('resolved', 'Resolved this week', k.resolvedThisWeek, 'Since Monday', 'good')}
</div>
<div class="live-grid">
<article class="live-card"><h4>Open by status</h4>${bars(model.byStatus)}</article>
${model.splitName ? `<article class="live-card"><h4>Open by ${esc(model.splitName)}</h4>${bars(model.bySplit)}</article>` : ''}
<article class="live-card"><h4>Open by request type</h4>${bars(model.byType)}</article>
<article class="live-card live-wide"><h4>Created vs resolved · last ${model.trend.length} weeks</h4>${trendChart(model.trend)}</article>
<article class="live-card live-sla"><h4>Service levels</h4><div class="live-sla-figure"><strong>${model.sla.metPct == null ? '—' : `${model.sla.metPct}%`}</strong><span>of SLAs met · last 90 days${model.sla.measured ? ` (${model.sla.met} of ${model.sla.measured})` : ''}</span></div><div class="live-sla-figure"><strong>${model.sla.avgResolutionMs == null ? '—' : esc(formatDuration(model.sla.avgResolutionMs))}</strong><span>average time to resolve · last 30 days${model.sla.resolved30 ? ` (${model.sla.resolved30} resolved)` : ''}</span></div></article>
<article class="live-card"><h4>Waiting on you</h4>${list(model.waitingList, 'Nothing is waiting on you.', (r) => `${r.ageDays} d old · ${r.status}`)}</article>
<article class="live-card"><h4>Oldest open requests</h4>${list(model.oldestOpen, 'No open requests.', (r) => `${r.ageDays} d old · ${r.status}`)}</article>
<article class="live-card"><h4>Recently updated</h4>${list(model.recentlyUpdated, 'No recent activity.', (r) => `${ago(r.updated, now)} · ${r.status}`)}</article>
</div>`;
}
