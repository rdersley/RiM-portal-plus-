// Service Hub page: a read-only reporting site. "Live" is the Portal+ live
// dashboard at full width with drill-down; "Reports" covers any date range.
// Raising and replying stay in the JSM portal. Data comes only from /api/*.
import { buildLiveModel, renderLiveDashboard, renderDrill } from '../static/portal/src/live-dashboard.js';
import { buildReport, renderReport, reportCsv, presetRange } from './report.js';

const REFRESH_MS = 120000;
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let session = {}, model = null, drill = [], portal = '', loading = false;
let reportData = null, reportFilters = [];

async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/'; throw new Error('Signed out'); }
  if (!r.ok) throw new Error(data.error || `The Service Hub could not load (${r.status}).`);
  return data;
}

// Request links from Portal+ are portal paths; open them on the customer's own portal site.
const openRequest = (url) => { try { if (portal) window.open(new URL(url, portal).toString(), '_blank', 'noopener'); } catch (_) {} };
const bindRequests = (host) => host.querySelectorAll('[data-key]').forEach((b) => { b.onclick = () => openRequest(b.dataset.url); });

// ---- Live ----
function paintLive() {
  const host = $('live-dashboard');
  if (!model) return;
  host.innerHTML = drill.length ? renderDrill(model, drill) : renderLiveDashboard(model, { refreshSeconds: REFRESH_MS / 1000 });
  const go = (filters) => { drill = filters; paintLive(); host.scrollIntoView({ block: 'start' }); };
  host.querySelector('.live-refresh')?.addEventListener('click', refreshLive);
  host.querySelector('.live-back')?.addEventListener('click', () => go(drill.slice(0, -1)));
  host.querySelectorAll('.live-crumb').forEach((b) => { b.onclick = () => go(drill.slice(0, Number(b.dataset.depth) || 0)); });
  host.querySelectorAll('.live-bar-row').forEach((b) => { b.onclick = () => go([...drill, { dim: b.dataset.dim, value: b.dataset.value }]); });
  bindRequests(host);
  // KPI tiles filter My Requests inside the portal; here they are read-only.
  host.querySelectorAll('[data-kpi]').forEach((b) => { b.disabled = true; });
}

async function refreshLive() {
  if (loading) return;
  loading = true;
  try {
    const data = await api('/api/live');
    if (data.enabled === false) { $('live-dashboard').innerHTML = '<div class="message">The live dashboard is not switched on for your service. See Reports.</div>'; return; }
    model = buildLiveModel(data); paintLive();
  } catch (e) { if (!model) $('live-dashboard').innerHTML = `<div class="message error"><strong>The live dashboard could not load</strong><span>${esc(e.message)}</span></div>`; }
  finally { loading = false; }
}

// ---- Reports ----
function paintReport() {
  const host = $('report-body');
  if (!reportData) return;
  const m = buildReport({ ...reportData, splitField: session.splitField, drillField: session.drillField }, { filters: reportFilters });
  host.innerHTML = renderReport(m);
  host.querySelectorAll('.hub-filter').forEach((b) => { b.onclick = () => { reportFilters = [...reportFilters, { dim: b.dataset.dim, value: b.dataset.value }]; paintReport(); host.scrollIntoView({ block: 'start' }); }; });
  host.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => { reportFilters = b.dataset.remove === 'all' ? [] : reportFilters.filter((_, i) => String(i) !== b.dataset.remove); paintReport(); }; });
  host.querySelector('.hub-export')?.addEventListener('click', () => {
    const blob = new Blob(['﻿' + reportCsv(m)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `service-report-${m.from}-to-${m.to}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  bindRequests(host);
}

function chosenRange() {
  const preset = $('report-preset').value;
  if (preset !== 'custom') return presetRange(preset);
  const from = $('report-from').value, toInclusive = $('report-to').value;
  if (!from || !toInclusive) throw new Error('Choose a start and end date.');
  const to = new Date(Date.parse(toInclusive + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  if (to <= from) throw new Error('The end date must be on or after the start date.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new Error('Choose a period of up to a year.');
  return { from, to };
}

async function loadReport() {
  const host = $('report-body');
  let range;
  try { range = chosenRange(); } catch (e) { host.innerHTML = `<div class="message error"><span>${esc(e.message)}</span></div>`; return; }
  host.innerHTML = '<div class="message">Building your report…</div>';
  try { reportData = await api(`/api/report?from=${range.from}&to=${range.to}`); reportFilters = []; paintReport(); }
  catch (e) { host.innerHTML = `<div class="message error"><strong>The report could not load</strong><span>${esc(e.message)}</span></div>`; }
}

function setupReports() {
  const preset = $('report-preset');
  preset.onchange = () => document.querySelectorAll('.hub-custom').forEach((el) => { el.hidden = preset.value !== 'custom'; });
  $('report-range').onsubmit = (e) => { e.preventDefault(); loadReport(); };
  document.querySelector('.hub-print').onclick = () => window.print();
}

// ---- Navigation ----
function show(view) {
  const reports = view === 'reports';
  $('live-dashboard').hidden = reports;
  $('reports').hidden = !reports;
  document.querySelectorAll('.hub-nav [data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  if (reports && !reportData) loadReport();
}

(async () => {
  try {
    session = await api('/api/session');
    portal = session.portal || '';
    $('hub-heading').textContent = session.heading || 'Service dashboard';
    $('hub-subtitle').textContent = session.intro || '';
    document.title = `${session.heading || 'Service dashboard'} · Retail inMotion Service Hub`;
    if (portal) { const a = $('hub-portal'); a.href = portal; a.target = '_blank'; a.rel = 'noopener'; a.hidden = false; }
  } catch (e) {
    $('live-dashboard').innerHTML = `<div class="message error"><strong>Access unavailable</strong><span>${esc(e.message)}</span></div>`;
    return;
  }
  setupReports();
  window.addEventListener('hashchange', () => show(location.hash === '#reports' ? 'reports' : 'live'));
  show(location.hash === '#reports' ? 'reports' : 'live');
  await refreshLive();
  setInterval(() => { if (document.visibilityState === 'visible' && $('reports').hidden) refreshLive(); }, REFRESH_MS);
})();
