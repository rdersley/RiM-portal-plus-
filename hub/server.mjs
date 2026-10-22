// Retail inMotion Service Hub — proof of concept.
// Customers arrive from Portal+ with a single-use pass (JSM has already signed
// them in), get an 8-hour hub session, and the hub fetches their data from the
// Portal+ web trigger with signed requests. The hub holds no Jira credentials.
//   HUB_SECRET=... node hub/server.mjs      (or put HUB_SECRET in hub/.env)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyToken, signToken, signRequest } from '../src/hub-pass.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
if (existsSync(join(here, '.env'))) {
  for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const SECRET = process.env.HUB_SECRET || '';
const PORT = Number(process.env.PORT || 4820);
const SECURE = process.env.HUB_SECURE_COOKIE === 'true';
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'rim_hub';
if (SECRET.length < 32) { console.error('HUB_SECRET (32+ characters) is required.'); process.exit(1); }

// Passes are single use: remember each nonce until it would have expired anyway.
const usedNonces = new Map();
const rememberNonce = (nonce, exp) => {
  const now = Date.now();
  for (const [n, e] of usedNonces) if (e < now) usedNonces.delete(n);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, exp);
  return true;
};

// Portal+ web trigger URLs are on Atlassian's Forge domain; refuse anything else.
const forgeApi = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && /\.atlassian-dev\.net$|\.atlassian\.net$/.test(u.hostname) ? u.toString() : ''; } catch (_) { return ''; } };
const portalHome = (loc) => { try { const u = new URL(loc); return /\.atlassian\.net$/.test(u.hostname) ? u.toString() : ''; } catch (_) { return ''; } };

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const session = (req) => { try { return verifyToken('session', cookies(req)[COOKIE], SECRET); } catch (_) { return null; } };
const setCookie = (value, maxAgeS) => `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${SECURE ? '; Secure' : ''}`;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const send = (res, status, body, type = 'text/html; charset=utf-8', extra = {}) => { res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra }); res.end(body); };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/kit.css"><link rel="stylesheet" href="/assets/portal.css"><link rel="stylesheet" href="/assets/hub.css"></head><body class="expanded live-on hub">${body}</body></html>`;
const signedOut = (message, portal = '') => page('Retail inMotion Service Hub', `<main class="hub-signin"><div class="hub-signin-card"><span class="hub-logo">R</span><h1>Retail inMotion Service Hub</h1><p>${esc(message)}</p>${portal ? `<a class="primary-button" href="${esc(portal)}">Go to the portal</a>` : '<p class="hub-muted">Sign in to the Retail inMotion portal and choose <strong>Service Hub</strong>.</p>'}</div></main>`);

// Calls the Portal+ web trigger for this session's customer.
async function portalPlus(s, op, extra = {}) {
  const { body, signature } = signRequest({ ...extra, op, acc: s.acc, pid: s.pid, loc: s.loc }, SECRET);
  const r = await fetch(s.api, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature': signature }, body, signal: AbortSignal.timeout(30000) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// Reports: requests raised and resolved in the range, fetched page by page from
// Portal+ (each page re-checks access) and cached briefly per customer and range.
const REPORT_CAP = 3000, REPORT_CACHE_MS = 5 * 60 * 1000, reportCache = new Map();
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
async function reportRows(s, field, from, to) {
  const rows = [];
  let token = '';
  do {
    const { status, data } = await portalPlus(s, 'report', { field, from, to, token });
    if (status !== 200) return { status, data };
    rows.push(...(data.rows || []));
    token = data.next || '';
  } while (token && rows.length < REPORT_CAP);
  return { status: 200, rows: rows.slice(0, REPORT_CAP), truncated: Boolean(token) };
}
async function report(s, from, to) {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return { status: 400, data: { error: 'Choose a valid date range.' } };
  const key = `${s.acc}|${s.pid}|${from}|${to}`, hit = reportCache.get(key);
  if (hit && hit.at > Date.now() - REPORT_CACHE_MS) return { status: 200, data: hit.data };
  const [created, resolved] = await Promise.all([reportRows(s, 'created', from, to), reportRows(s, 'resolved', from, to)]);
  for (const part of [created, resolved]) if (part.status !== 200) return part;
  const data = { from, to, cap: REPORT_CAP, created: created.rows, resolved: resolved.rows, createdTruncated: created.truncated, resolvedTruncated: resolved.truncated, generatedAt: new Date().toISOString() };
  for (const [k, v] of reportCache) if (v.at < Date.now() - REPORT_CACHE_MS) reportCache.delete(k);
  reportCache.set(key, { at: Date.now(), data });
  return { status: 200, data };
}

const ASSETS = {
  '/assets/kit.css': ['static/portal/dist/retailinmotion-ui.css', 'text/css'],
  '/assets/portal.css': ['static/portal/dist/styles.css', 'text/css'],
  '/assets/hub.css': ['hub/hub.css', 'text/css'],
  '/assets/hub.js': ['hub/dist/hub.js', 'text/javascript'],
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && ASSETS[url.pathname]) {
      const [file, type] = ASSETS[url.pathname];
      return send(res, 200, readFileSync(join(root, file)), `${type}; charset=utf-8`, { 'Cache-Control': 'no-cache' });
    }
    if (req.method === 'GET' && url.pathname === '/auth') {
      let claims;
      try { claims = verifyToken('pass', url.searchParams.get('pass'), SECRET); } catch (e) { return send(res, 401, signedOut(e.message)); }
      if (!rememberNonce(claims.nonce, claims.exp)) return send(res, 401, signedOut('This sign-in link has already been used. Open the Service Hub from the portal again.', portalHome(claims.loc)));
      const api = forgeApi(claims.api);
      if (!api) return send(res, 400, signedOut('This sign-in link is not valid.'));
      const token = signToken('session', { acc: claims.acc, pid: claims.pid, loc: claims.loc, api, exp: Date.now() + SESSION_MS }, SECRET);
      return send(res, 303, '', 'text/plain', { Location: '/', 'Set-Cookie': setCookie(token, SESSION_MS / 1000) });
    }
    if (req.method === 'POST' && url.pathname === '/signout') {
      const s = session(req);
      return send(res, 303, '', 'text/plain', { Location: s ? `/signed-out?portal=${encodeURIComponent(portalHome(s.loc))}` : '/signed-out', 'Set-Cookie': setCookie('', 0) });
    }
    if (req.method === 'GET' && url.pathname === '/signed-out') return send(res, 200, signedOut('You have signed out of the Service Hub.', portalHome(url.searchParams.get('portal') || '')));
    const s = session(req);
    if (url.pathname.startsWith('/api/')) {
      if (!s) return send(res, 401, JSON.stringify({ error: 'Your session has ended. Open the Service Hub from the portal again.' }), 'application/json');
      // Same-origin only: a state-free GET API, but refuse cross-site callers anyway.
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, '{}', 'application/json');
      if (url.pathname === '/api/report' && req.method === 'GET') {
        const { status, data } = await report(s, url.searchParams.get('from') || '', url.searchParams.get('to') || '');
        return send(res, status, JSON.stringify(data), 'application/json');
      }
      const op = { '/api/session': 'session', '/api/live': 'live' }[url.pathname];
      if (!op || req.method !== 'GET') return send(res, 404, '{}', 'application/json');
      const { status, data } = await portalPlus(s, op);
      if (op === 'session' && status === 200) data.portal = portalHome(s.loc);
      return send(res, status, JSON.stringify(data), 'application/json');
    }
    if (req.method === 'GET' && url.pathname === '/') {
      if (!s) return send(res, 200, signedOut('Please open the Service Hub from your Retail inMotion portal.'));
      return send(res, 200, page('Retail inMotion Service Hub', readFileSync(join(here, 'app.html'), 'utf8')));
    }
    return send(res, 404, signedOut('Page not found.'));
  } catch (e) {
    console.error(e);
    return send(res, 500, signedOut('Something went wrong. Please try again.'));
  }
}).listen(PORT, () => console.log(`Service Hub on http://localhost:${PORT}`));
