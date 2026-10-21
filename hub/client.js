// Service Hub page: the Portal+ live dashboard at full browser width, with the
// same drill-down. Data comes from the hub server (/api/*), never from Jira directly.
import { buildLiveModel, renderLiveDashboard, renderDrill } from '../static/portal/src/live-dashboard.js';

const REFRESH_MS = 120000;
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let model = null, drill = [], portal = '', loading = false;

async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/'; throw new Error('Signed out'); }
  if (!r.ok) throw new Error(data.error || `The Service Hub could not load (${r.status}).`);
  return data;
}

// Request links from Portal+ are portal paths; open them on the customer's own portal site.
const requestUrl = (url) => { try { return portal ? new URL(url, portal).toString() : ''; } catch (_) { return ''; } };

function paint() {
  const host = $('live-dashboard');
  if (!model) return;
  host.innerHTML = drill.length ? renderDrill(model, drill) : renderLiveDashboard(model, { refreshSeconds: REFRESH_MS / 1000 });
  const go = (filters) => { drill = filters; paint(); host.scrollIntoView({ block: 'start' }); };
  host.querySelector('.live-refresh')?.addEventListener('click', refresh);
  host.querySelector('.live-back')?.addEventListener('click', () => go(drill.slice(0, -1)));
  host.querySelectorAll('.live-crumb').forEach((b) => { b.onclick = () => go(drill.slice(0, Number(b.dataset.depth) || 0)); });
  host.querySelectorAll('.live-bar-row').forEach((b) => { b.onclick = () => go([...drill, { dim: b.dataset.dim, value: b.dataset.value }]); });
  host.querySelectorAll('[data-key]').forEach((b) => { b.onclick = () => { const u = requestUrl(b.dataset.url); if (u) window.open(u, '_blank', 'noopener'); }; });
  // KPI tiles filter My Requests in the portal; in the hub they are read-only for now.
  host.querySelectorAll('[data-kpi]').forEach((b) => { b.disabled = true; });
}

async function refresh() {
  if (loading) return;
  loading = true;
  try { model = buildLiveModel(await api('/api/live')); paint(); }
  catch (e) { if (!model) $('live-dashboard').innerHTML = `<div class="message error"><strong>The live dashboard could not load</strong><span>${esc(e.message)}</span></div>`; }
  finally { loading = false; }
}

(async () => {
  try {
    const s = await api('/api/session');
    portal = s.portal || '';
    $('hub-heading').textContent = s.heading || 'Service dashboard';
    $('hub-subtitle').textContent = s.intro || '';
    document.title = `${s.heading || 'Service dashboard'} · Retail inMotion Service Hub`;
    if (portal) { const a = $('hub-portal'); a.href = portal; a.hidden = false; }
  } catch (e) {
    $('live-dashboard').innerHTML = `<div class="message error"><strong>Access unavailable</strong><span>${esc(e.message)}</span></div>`;
    return;
  }
  await refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
})();
