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
  // Without a status mapping, statuses that mention the customer count as waiting on them, and the rest as with the team.
  const mapped = (mapping.awaitingCustomer || []).length || (mapping.awaitingSupport || []).length;
  const onCustomer = (r) => (mapped ? inMapping(r, mapping.awaitingCustomer) : /customer|client|your reply|waiting for you/i.test(r.status || ''));
  const waitingOnYou = open.filter(onCustomer);
  const waitingOnSupport = mapped ? open.filter((r) => inMapping(r, mapping.awaitingSupport)) : open.filter((r) => !onCustomer(r));
  const resolvedSince = (ms) => rows.filter((r) => time(r.resolved) && time(r.resolved) >= now - ms);

  const thisWeek = weekStart(now);
  const counted = (n, fallback) => (Number.isFinite(n) ? n : fallback);
  const serverWeeks = Array.isArray(data.weekly) && data.weekly.length ? data.weekly : null;
  const trend = serverWeeks ? serverWeeks.map((w) => {
    const start = time(w.start + 'T00:00:00Z'), end = start + 7 * DAY;
    return {
      start,
      label: new Date(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      created: counted(w.created, rows.filter((r) => time(r.created) >= start && time(r.created) < end).length),
      resolved: counted(w.resolved, rows.filter((r) => time(r.resolved) >= start && time(r.resolved) < end).length),
    };
  }) : Array.from({ length: weeks }, (_, i) => {
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
    truncated: Boolean(data.openTruncated ?? data.truncated),
    cap: data.openCap || data.cap || rows.length,
    total: rows.length,
    splitName: data.splitField?.name || '',
    drillName: data.drillField?.name || '',
    // Open requests kept for drill-down (click a bar to break it down further).
    openRows: open.map((r) => ({ ...brief(r), created: r.created, status: r.status || '', type: r.requestType || '', split: r.split || '', drill: r.drill || '', waiting: onCustomer(r), sla: r.sla || null })),
    kpis: {
      open: counted(data.openTotal, open.length),
      waitingOnYou: waitingOnYou.length,
      waitingOnSupport: waitingOnSupport.length,
      breached: open.filter((r) => r.sla?.state === 'breached').length,
      atRisk: open.filter((r) => r.sla?.atRisk).length,
      resolvedThisWeek: serverWeeks ? trend[trend.length - 1].resolved : rows.filter((r) => time(r.resolved) >= thisWeek).length,
      createdThisWeek: serverWeeks ? trend[trend.length - 1].created : rows.filter((r) => time(r.created) >= thisWeek).length,
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

// Bars are buttons: clicking one drills into that value (data-dim / data-value).
function bars(rows, dim) {
  if (!rows.length) return '<p class="live-empty">Nothing open.</p>';
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<ul class="live-bars">${rows.map(([label, n]) => `<li><button type="button" class="live-bar-row" data-dim="${esc(dim)}" data-value="${esc(label)}" title="Break down ${esc(label)}"><span class="live-bar-label">${esc(label)}</span><svg class="live-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="live-bar-track" width="100" height="10" rx="5"/><rect class="live-bar-fill" width="${Math.max(3, Math.round((n / max) * 100))}" height="10" rx="5"/></svg><strong>${n}</strong></button></li>`).join('')}</ul>`;
}

const DIM_VALUE = { status: (r) => r.status, split: (r) => r.split, type: (r) => r.type, drill: (r) => r.drill };
const dimLabel = (model, dim) => ({ status: 'status', type: 'request type', split: model.splitName, drill: model.drillName }[dim] || dim);
const dimOn = (model, dim) => Boolean(DIM_VALUE[dim]) && (dim === 'split' ? Boolean(model.splitName) : dim === 'drill' ? Boolean(model.drillName) : true);

// The open requests matching every drill filter ([{dim, value}]), with breakdowns by
// each dimension not already filtered on — the drill-down field first.
export function buildDrill(model, filters = []) {
  const valid = filters.filter((f) => dimOn(model, f.dim));
  const rows = model.openRows.filter((r) => valid.every((f) => (DIM_VALUE[f.dim](r) || 'Not set') === f.value));
  const used = new Set(valid.map((f) => f.dim));
  const breakdowns = ['drill', 'split', 'status', 'type'].filter((dim) => dimOn(model, dim) && !used.has(dim)).map((dim) => ({ dim, title: `By ${dimLabel(model, dim)}`, rows: countBy(rows, DIM_VALUE[dim]) }));
  return {
    filters: valid,
    count: rows.length,
    waitingOnYou: rows.filter((r) => r.waiting).length,
    breached: rows.filter((r) => r.sla?.state === 'breached').length,
    atRisk: rows.filter((r) => r.sla?.atRisk).length,
    breakdowns,
    requests: [...rows].sort((a, b) => time(a.created) - time(b.created)).slice(0, 100),
  };
}

export function renderDrill(model, filters) {
  const d = buildDrill(model, filters);
  const crumbs = [`<button type="button" class="live-crumb" data-depth="0">All open requests</button>`, ...d.filters.map((f, i) => `<button type="button" class="live-crumb" data-depth="${i + 1}" ${i === d.filters.length - 1 ? 'aria-current="page"' : ''}>${esc(f.value)}</button>`)].join('<span aria-hidden="true">›</span>');
  const stat = (label, n, tone = '') => `<div class="live-kpi static ${tone}"><span>${esc(label)}</span><strong>${n}</strong></div>`;
  return `<div class="live-head"><div><span class="eyebrow">Live service dashboard · breakdown</span><nav class="live-crumbs" aria-label="Breakdown">${crumbs}</nav><p>${d.filters.map((f) => `${esc(dimLabel(model, f.dim))}: ${esc(f.value)}`).join(' · ')}${model.truncated ? ` · from your ${model.cap.toLocaleString()} oldest open requests` : ''}</p></div><button type="button" class="page-button live-back">Back</button></div>
<div class="live-kpis drill">
${stat('Open requests', d.count)}${stat('Waiting on you', d.waitingOnYou, d.waitingOnYou ? 'warn' : '')}${stat('SLA breached', d.breached, d.breached ? 'bad' : 'good')}${stat('SLA at risk', d.atRisk, d.atRisk ? 'warn' : 'good')}
</div>
<div class="live-grid">
${d.breakdowns.map((b) => `<article class="live-card"><h4>${esc(b.title)}</h4>${bars(b.rows, b.dim)}</article>`).join('')}
<article class="live-card live-wide"><h4>Requests${d.count > d.requests.length ? ` · oldest ${d.requests.length} of ${d.count}` : ''}</h4>${list(d.requests, 'No open requests.', (r) => [r.status, r.drill && !d.filters.some((f) => f.dim === 'drill') ? r.drill : '', `${r.ageDays} d old`].filter(Boolean).join(' · '))}</article>
</div>`;
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
  return `<div class="live-head"><div><span class="eyebrow">Live service dashboard</span><h3>Your service at a glance</h3><p>Updated ${esc(updated)} · refreshes every ${Math.round(refreshSeconds / 60)} minutes · click a bar to break it down${model.truncated ? ` · breakdowns use your ${model.cap.toLocaleString()} oldest open requests` : ''}</p></div><button type="button" class="page-button live-refresh">Refresh</button></div>
<div class="live-kpis">
${kpi('open', 'Open requests', k.open, `${k.createdThisWeek} raised this week`)}
${kpi('awaiting-you', 'Waiting on you', k.waitingOnYou, 'Need your reply', k.waitingOnYou ? 'warn' : '')}
${kpi('awaiting-support', 'With our team', k.waitingOnSupport, 'Being worked on')}
${kpi('breached', 'SLA breached', k.breached, 'Open and past target', k.breached ? 'bad' : 'good')}
${kpi('at-risk', 'SLA at risk', k.atRisk, 'Under 25% of time left', k.atRisk ? 'warn' : 'good')}
${kpi('resolved', 'Resolved this week', k.resolvedThisWeek, 'Since Monday', 'good')}
</div>
<div class="live-grid">
<article class="live-card"><h4>Open by status</h4>${bars(model.byStatus, 'status')}</article>
${model.splitName ? `<article class="live-card"><h4>Open by ${esc(model.splitName)}</h4>${bars(model.bySplit, 'split')}</article>` : ''}
<article class="live-card"><h4>Open by request type</h4>${bars(model.byType, 'type')}</article>
<article class="live-card live-wide"><h4>Created vs resolved · last ${model.trend.length} weeks</h4>${trendChart(model.trend)}</article>
<article class="live-card live-sla"><h4>Service levels</h4><div class="live-sla-figure"><strong>${model.sla.metPct == null ? '—' : `${model.sla.metPct}%`}</strong><span>of SLAs met · last 90 days${model.sla.measured ? ` (${model.sla.met} of ${model.sla.measured})` : ''}</span></div><div class="live-sla-figure"><strong>${model.sla.avgResolutionMs == null ? '—' : esc(formatDuration(model.sla.avgResolutionMs))}</strong><span>average time to resolve · last 30 days${model.sla.resolved30 ? ` (${model.sla.resolved30} resolved)` : ''}</span></div></article>
<article class="live-card"><h4>Waiting on you</h4>${list(model.waitingList, 'Nothing is waiting on you.', (r) => `${r.ageDays} d old · ${r.status}`)}</article>
<article class="live-card"><h4>Oldest open requests</h4>${list(model.oldestOpen, 'No open requests.', (r) => `${r.ageDays} d old · ${r.status}`)}</article>
<article class="live-card"><h4>Recently updated</h4>${list(model.recentlyUpdated, 'No recent activity.', (r) => `${ago(r.updated, now)} · ${r.status}`)}</article>
</div>`;
}
