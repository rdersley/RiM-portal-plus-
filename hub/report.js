// Service Hub reports: turns the requests created and resolved in a date range
// into totals, a trend, breakdowns, resolution-time bands and SLA over time, and
// renders them. Pure functions (no DOM or network), so they can be unit-tested.
import { formatDuration } from '../static/portal/src/module-renderers.js';

const DAY = 86400000;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export const DIMS = {
  split: { label: (f) => f.splitName, value: (r) => r.split },
  drill: { label: (f) => f.drillName, value: (r) => r.drill },
  type: { label: () => 'request type', value: (r) => r.requestType },
  status: { label: () => 'current status', value: (r) => r.status },
};
const dimOn = (fields, dim) => Boolean(DIMS[dim]) && (dim === 'split' ? Boolean(fields.splitName) : dim === 'drill' ? Boolean(fields.drillName) : true);
const valueOf = (dim, r) => DIMS[dim].value(r) || 'Not set';

// Preset ranges, as [from, to) in UTC days. `to` is exclusive (tomorrow for "up to today").
export function presetRange(preset, now = Date.now()) {
  const today = Date.parse(isoDay(now) + 'T00:00:00Z'), tomorrow = today + DAY, d = new Date(today);
  const monthStart = (y, m) => Date.UTC(y, m, 1);
  switch (preset) {
    case '7d': return { from: isoDay(tomorrow - 7 * DAY), to: isoDay(tomorrow) };
    case '30d': return { from: isoDay(tomorrow - 30 * DAY), to: isoDay(tomorrow) };
    case '90d': return { from: isoDay(tomorrow - 90 * DAY), to: isoDay(tomorrow) };
    case 'this-month': return { from: isoDay(monthStart(d.getUTCFullYear(), d.getUTCMonth())), to: isoDay(tomorrow) };
    case 'last-month': return { from: isoDay(monthStart(d.getUTCFullYear(), d.getUTCMonth() - 1)), to: isoDay(monthStart(d.getUTCFullYear(), d.getUTCMonth())) };
    case '12m': return { from: isoDay(monthStart(d.getUTCFullYear() - 1, d.getUTCMonth() + 1)), to: isoDay(tomorrow) };
    default: throw new Error('Unknown range.');
  }
}

// Daily up to a month, weekly up to ~4 months, monthly beyond.
export function buckets(from, to) {
  const start = time(from + 'T00:00:00Z'), end = time(to + 'T00:00:00Z'), days = (end - start) / DAY;
  const out = [];
  if (days <= 31) for (let t = start; t < end; t += DAY) out.push({ start: t, end: t + DAY, label: new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
  else if (days <= 120) for (let t = start; t < end; t += 7 * DAY) out.push({ start: t, end: Math.min(end, t + 7 * DAY), label: new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
  else {
    let d = new Date(start);
    while (d.getTime() < end) {
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      out.push({ start: d.getTime(), end: Math.min(end, next), label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
      d = new Date(next);
    }
  }
  return out;
}

const BANDS = [['Under 1 day', 0, DAY], ['1–3 days', DAY, 3 * DAY], ['3–7 days', 3 * DAY, 7 * DAY], ['7–30 days', 7 * DAY, 30 * DAY], ['Over 30 days', 30 * DAY, Infinity]];
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const resolution = (r) => (time(r.resolved) && time(r.created) ? Math.max(0, time(r.resolved) - time(r.created)) : null);
const slaDone = (rows) => rows.filter((r) => r.sla && (r.sla.state === 'met' || r.sla.state === 'breached'));

export function buildReport(data = {}, { filters = [] } = {}) {
  const fields = { splitName: data.splitField?.name || '', drillName: data.drillField?.name || '' };
  const valid = filters.filter((f) => dimOn(fields, f.dim));
  const keep = (r) => valid.every((f) => valueOf(f.dim, r) === f.value);
  const created = (data.created || []).filter(keep), resolved = (data.resolved || []).filter(keep);
  const times = resolved.map(resolution).filter((x) => x != null);
  const sla = slaDone(resolved), met = sla.filter((r) => r.sla.state === 'met').length;

  const used = new Set(valid.map((f) => f.dim));
  const breakdowns = ['split', 'drill', 'type', 'status'].filter((d) => dimOn(fields, d) && !used.has(d)).map((dim) => {
    const map = new Map();
    const at = (k) => { if (!map.has(k)) map.set(k, { value: k, created: 0, resolved: 0, times: [], met: 0, measured: 0 }); return map.get(k); };
    for (const r of created) at(valueOf(dim, r)).created++;
    // Current status only makes sense for what was raised; resolved requests are all closed.
    if (dim !== 'status') for (const r of resolved) { const e = at(valueOf(dim, r)); e.resolved++; const t = resolution(r); if (t != null) e.times.push(t); if (r.sla?.state === 'met' || r.sla?.state === 'breached') { e.measured++; if (r.sla.state === 'met') e.met++; } }
    const rows = [...map.values()].map((e) => ({ value: e.value, created: e.created, resolved: e.resolved, metPct: pct(e.met, e.measured), measured: e.measured, avgMs: e.times.length ? e.times.reduce((a, b) => a + b, 0) / e.times.length : null }))
      .sort((a, b) => (a.value === 'Not set') - (b.value === 'Not set') || (b.created + b.resolved) - (a.created + a.resolved) || a.value.localeCompare(b.value));
    return { dim, title: `By ${DIMS[dim].label(fields)}`, rows, statusOnly: dim === 'status' };
  });

  const bs = buckets(data.from, data.to);
  const inB = (t, b) => t >= b.start && t < b.end;
  const trend = bs.map((b) => ({ label: b.label, start: b.start, created: created.filter((r) => inB(time(r.created), b)).length, resolved: resolved.filter((r) => inB(time(r.resolved), b)).length, met: sla.filter((r) => inB(time(r.resolved), b) && r.sla.state === 'met').length, breached: sla.filter((r) => inB(time(r.resolved), b) && r.sla.state === 'breached').length }));

  return {
    from: data.from, to: data.to, fields, filters: valid,
    truncated: Boolean(data.createdTruncated || data.resolvedTruncated), cap: data.cap || 0,
    totals: {
      created: created.length, resolved: resolved.length, net: created.length - resolved.length,
      stillOpen: created.filter((r) => r.category !== 'done' && !time(r.resolved)).length,
      measured: sla.length, met, breached: sla.length - met, metPct: pct(met, sla.length),
      avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null, medianMs: median(times), p90Ms: quantile(times, 0.9),
    },
    trend, breakdowns,
    bands: BANDS.map(([label, lo, hi]) => ({ label, count: times.filter((t) => t >= lo && t < hi).length })),
    breachedList: resolved.filter((r) => r.sla?.state === 'breached').sort((a, b) => time(b.resolved) - time(a.resolved)).slice(0, 25),
    created, resolved,
  };
}

const dur = (ms) => (ms == null ? '—' : esc(formatDuration(ms)));
const bar = (n, max) => `<svg class="live-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="live-bar-track" width="100" height="10" rx="5"/><rect class="live-bar-fill" width="${n ? Math.max(3, Math.round((n / Math.max(1, max)) * 100)) : 0}" height="10" rx="5"/></svg>`;

function trendChart(trend) {
  const max = Math.max(1, ...trend.flatMap((w) => [w.created, w.resolved]));
  const W = 900, H = 200, pad = 24, slot = (W - pad) / Math.max(1, trend.length), bw = Math.max(2, Math.min(18, slot / 3));
  const y = (n) => H - 22 - (n / max) * (H - 40);
  const every = Math.ceil(trend.length / 14);
  const cols = trend.map((w, i) => {
    const x = pad + i * slot + slot / 2;
    return `<g><rect class="live-col created" x="${(x - bw - 1).toFixed(1)}" y="${y(w.created).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - 22 - y(w.created)).toFixed(1)}"><title>${esc(w.label)}: ${w.created} created</title></rect><rect class="live-col resolved" x="${(x + 1).toFixed(1)}" y="${y(w.resolved).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - 22 - y(w.resolved)).toFixed(1)}"><title>${esc(w.label)}: ${w.resolved} resolved</title></rect>${i % every === 0 ? `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(w.label)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="live-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Requests created and resolved"><line x1="${pad}" x2="${W}" y1="${H - 22}" y2="${H - 22}" class="live-axis"/>${cols}</svg><div class="live-legend"><span><i class="created"></i>Created</span><span><i class="resolved"></i>Resolved</span></div>`;
}

function slaChart(trend) {
  const W = 900, H = 160, pad = 24, slot = (W - pad) / Math.max(1, trend.length), bw = Math.max(3, Math.min(30, slot * 0.6));
  const max = Math.max(1, ...trend.map((w) => w.met + w.breached));
  const every = Math.ceil(trend.length / 14);
  const cols = trend.map((w, i) => {
    const x = pad + i * slot + slot / 2, total = w.met + w.breached, h = (n) => (n / max) * (H - 40);
    const yMet = H - 22 - h(w.met), yBr = yMet - h(w.breached);
    return `<g><rect class="hub-sla-met" x="${(x - bw / 2).toFixed(1)}" y="${yMet.toFixed(1)}" width="${bw.toFixed(1)}" height="${h(w.met).toFixed(1)}"><title>${esc(w.label)}: ${w.met} met</title></rect><rect class="hub-sla-breached" x="${(x - bw / 2).toFixed(1)}" y="${yBr.toFixed(1)}" width="${bw.toFixed(1)}" height="${h(w.breached).toFixed(1)}"><title>${esc(w.label)}: ${w.breached} breached${total ? ` (${pct(w.met, total)}% met)` : ''}</title></rect>${i % every === 0 ? `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(w.label)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="live-trend hub-sla-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="SLAs met and breached"><line x1="${pad}" x2="${W}" y1="${H - 22}" y2="${H - 22}" class="live-axis"/>${cols}</svg><div class="live-legend"><span><i class="hub-met"></i>Met</span><span><i class="hub-breached"></i>Breached</span></div>`;
}

function breakdownTable(b) {
  const max = Math.max(1, ...b.rows.map((r) => r.created));
  const head = b.statusOnly ? '<th>Requests raised</th>' : '<th>Raised</th><th>Resolved</th><th>SLA met</th><th>Avg. time to resolve</th>';
  const body = b.rows.map((r) => `<tr><td><button type="button" class="hub-filter" data-dim="${esc(b.dim)}" data-value="${esc(r.value)}" title="Filter the report by ${esc(r.value)}">${esc(r.value)}</button></td><td class="hub-bar-cell">${bar(r.created, max)}<strong>${r.created}</strong></td>${b.statusOnly ? '' : `<td>${r.resolved}</td><td>${r.metPct == null ? '—' : `${r.metPct}%`}</td><td>${dur(r.avgMs)}</td>`}</tr>`).join('');
  return `<article class="live-card hub-breakdown"><h4>${esc(b.title)}</h4>${b.rows.length ? `<div class="hub-table-wrap"><table class="hub-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="live-empty">No requests in this period.</p>'}</article>`;
}

const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function renderReport(m) {
  const t = m.totals, lastDay = isoDay(time(m.to + 'T00:00:00Z') - DAY);
  const tile = (label, value, hint, tone = '') => `<div class="live-kpi static ${tone}"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(hint)}</small></div>`;
  const chips = m.filters.length ? `<div class="hub-chips">${m.filters.map((f, i) => `<button type="button" class="hub-chip" data-remove="${i}" title="Remove filter">${esc(DIMS[f.dim].label(m.fields))}: ${esc(f.value)} ×</button>`).join('')}<button type="button" class="hub-chip clear" data-remove="all">Clear filters</button></div>` : '';
  const maxBand = Math.max(1, ...m.bands.map((b) => b.count));
  return `<div class="live-head"><div><span class="eyebrow">Report</span><h3>${esc(fmtDay(m.from))} – ${esc(fmtDay(lastDay))}</h3><p>Requests raised and resolved in this period${m.truncated ? ` · based on the first ${m.cap.toLocaleString()} of each` : ''}. Click a value to filter the whole report.</p></div><button type="button" class="page-button hub-export">Export CSV</button></div>
${chips}
<div class="live-kpis">
${tile('Raised', t.created, `${t.stillOpen} still open`)}
${tile('Resolved', t.resolved, t.net > 0 ? `Backlog up ${t.net}` : t.net < 0 ? `Backlog down ${-t.net}` : 'Backlog unchanged', t.net > 0 ? 'warn' : 'good')}
${tile('SLAs met', t.metPct == null ? '—' : `${t.metPct}%`, t.measured ? `${t.met} of ${t.measured}` : 'No SLAs measured', t.metPct == null ? '' : t.metPct >= 95 ? 'good' : t.metPct >= 85 ? 'warn' : 'bad')}
${tile('SLAs breached', t.breached, 'Resolved after target', t.breached ? 'bad' : 'good')}
${tile('Average time to resolve', dur(t.avgMs), `Median ${t.medianMs == null ? '—' : formatDuration(t.medianMs)}`)}
${tile('90% resolved within', dur(t.p90Ms), 'of resolved requests')}
</div>
<div class="live-grid">
<article class="live-card live-full"><h4>Raised vs resolved</h4>${trendChart(m.trend)}</article>
${m.breakdowns.map(breakdownTable).join('')}
<article class="live-card"><h4>Time to resolve</h4><ul class="live-bars">${m.bands.map((b) => `<li><span class="live-bar-row static"><span class="live-bar-label">${esc(b.label)}</span>${bar(b.count, maxBand)}<strong>${b.count}</strong></span></li>`).join('')}</ul></article>
<article class="live-card live-wide"><h4>SLA performance</h4>${slaChart(m.trend)}</article>
<article class="live-card live-full"><h4>Resolved after SLA target${m.breachedList.length ? ` · latest ${m.breachedList.length}` : ''}</h4>${m.breachedList.length ? `<ul class="live-list">${m.breachedList.map((r) => `<li><button type="button" class="live-item" data-key="${esc(r.key)}" data-url="${esc(r.url)}"><span class="live-item-key">${esc(r.key)}</span><span class="live-item-summary">${esc(r.summary)}</span><span class="live-item-meta">${esc([r.requestType, r.drill || r.split, `resolved in ${formatDuration(resolution(r) || 0)}`].filter(Boolean).join(' · '))}</span></button></li>`).join('')}</ul>` : '<p class="live-empty">No SLA breaches in this period.</p>'}</article>
</div>`;
}

// CSV of the requests behind the report (both lists, each request once).
export function reportCsv(m) {
  const cell = (v) => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const seen = new Map();
  for (const r of [...m.created, ...m.resolved]) seen.set(r.key, r);
  const head = ['Key', 'Summary', 'Request type', m.fields.splitName, m.fields.drillName, 'Status', 'Created', 'Resolved', 'Time to resolve (hours)', 'SLA'].filter((h) => h !== '');
  const rows = [...seen.values()].map((r) => { const t = resolution(r); return [r.key, r.summary, r.requestType, ...(m.fields.splitName ? [r.split] : []), ...(m.fields.drillName ? [r.drill] : []), r.status, r.created, r.resolved, t == null ? '' : (t / 3600000).toFixed(1), r.sla?.state || '']; });
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
