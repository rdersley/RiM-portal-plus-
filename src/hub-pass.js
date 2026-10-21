// Service Hub handover. Portal+ (where JSM has already signed the customer in)
// issues a short-lived, single-use pass naming the verified account; the hub
// checks it and starts its own session. The hub's data calls back to Portal+
// are signed the same way, so Portal+ can apply the usual customer boundary.
// Shared by the Forge app and the hub server, so it uses node:crypto only.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const PASS_TTL_MS = 60 * 1000;
export const REQUEST_SKEW_MS = 2 * 60 * 1000;
const MIN_SECRET = 32;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
const mac = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET) throw new Error('Service Hub secret is not configured.');
  return secret;
}

// Signs claims as "<base64url json>.<hmac>". `kind` stops a pass being used as a session and vice versa.
export function signToken(kind, claims, secret) {
  const body = b64(JSON.stringify({ ...claims, kind }));
  return `${body}.${mac(requireSecret(secret), body)}`;
}

export function verifyToken(kind, token, secret, now = Date.now()) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined || !same(sig, mac(requireSecret(secret), body))) throw new Error('Invalid sign-in link.');
  let claims;
  try { claims = JSON.parse(unb64(body)); } catch (_) { throw new Error('Invalid sign-in link.'); }
  if (claims?.kind !== kind) throw new Error('Invalid sign-in link.');
  if (!Number.isFinite(claims.exp) || claims.exp < now) throw new Error('This sign-in link has expired. Open the Service Hub from the portal again.');
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(String(claims.acc || '')) || !/^\d{1,18}$/.test(String(claims.pid || ''))) throw new Error('Invalid sign-in link.');
  return claims;
}

export function createPass({ accountId, projectId, location = '', api = '' }, secret, now = Date.now()) {
  return signToken('pass', { v: 1, acc: String(accountId), pid: String(projectId), loc: String(location).slice(0, 500), api: String(api).slice(0, 500), exp: now + PASS_TTL_MS, nonce: randomUUID() }, secret);
}

// Hub -> Portal+ data calls: the raw body is signed with a timestamp, and Portal+ rejects stale or altered requests.
export function signRequest(payload, secret, now = Date.now()) {
  const body = JSON.stringify({ ...payload, ts: now });
  return { body, signature: mac(requireSecret(secret), body) };
}

export function verifyRequest(body, signature, secret, now = Date.now()) {
  if (!signature || !same(signature, mac(requireSecret(secret), String(body || '')))) throw new Error('Bad signature.');
  const payload = JSON.parse(body);
  if (!Number.isFinite(payload?.ts) || Math.abs(now - payload.ts) > REQUEST_SKEW_MS) throw new Error('Stale request.');
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(String(payload.acc || '')) || !/^\d{1,18}$/.test(String(payload.pid || ''))) throw new Error('Bad claims.');
  return payload;
}
