import test from 'node:test';
import assert from 'node:assert/strict';
import { createPass, verifyToken, signToken, signRequest, verifyRequest, PASS_TTL_MS } from '../src/hub-pass.js';

const SECRET = 'x'.repeat(48);
const NOW = Date.parse('2026-10-21T10:00:00Z');
const who = { accountId: '557058:abc-123', projectId: '10000', location: 'https://site/helpcenter/Ryanair/', api: 'https://x.hello.atlassian-dev.net/t' };

test('a pass names the verified account and expires after a minute', () => {
  const claims = verifyToken('pass', createPass(who, SECRET, NOW), SECRET, NOW + 1000);
  assert.equal(claims.acc, who.accountId);
  assert.equal(claims.pid, '10000');
  assert.ok(claims.nonce);
  assert.throws(() => verifyToken('pass', createPass(who, SECRET, NOW), SECRET, NOW + PASS_TTL_MS + 1), /expired/);
});

test('altered, wrongly signed or wrong-kind tokens are rejected', () => {
  const pass = createPass(who, SECRET, NOW);
  const [body, sig] = pass.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), acc: 'someone-else' })).toString('base64url');
  assert.throws(() => verifyToken('pass', `${forged}.${sig}`, SECRET, NOW), /Invalid/);
  assert.throws(() => verifyToken('pass', pass, 'y'.repeat(48), NOW), /Invalid/);
  assert.throws(() => verifyToken('session', pass, SECRET, NOW), /Invalid/);
  assert.throws(() => verifyToken('pass', `${pass}.extra`, SECRET, NOW), /Invalid/);
  assert.throws(() => verifyToken('pass', signToken('pass', { acc: 'a"b', pid: '1', exp: NOW + 1000 }, SECRET), SECRET, NOW), /Invalid/);
});

test('nothing is signed or accepted without a strong secret', () => {
  assert.throws(() => createPass(who, '', NOW), /not configured/);
  assert.throws(() => verifyToken('pass', 'a.b', 'short', NOW), /not configured/);
});

test('hub data requests must be signed and fresh', () => {
  const { body, signature } = signRequest({ op: 'live', acc: who.accountId, pid: '10000', loc: '' }, SECRET, NOW);
  assert.equal(verifyRequest(body, signature, SECRET, NOW + 1000).op, 'live');
  assert.throws(() => verifyRequest(body.replace('live', 'xxxx'), signature, SECRET, NOW), /signature/);
  assert.throws(() => verifyRequest(body, signature, SECRET, NOW + 3 * 60 * 1000), /Stale/);
  assert.throws(() => verifyRequest(body, '', SECRET, NOW), /signature/);
});
