import test from 'node:test';
import assert from 'node:assert/strict';
import { previewKey, validPreviewToken, previewUsable } from '../src/preview.js';

test('preview tokens are random v4 UUIDs and records are bound to one user and expire', () => {
  assert.ok(validPreviewToken('3f2c1a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b'));
  for (const bad of ['', 'abc', '3f2c1a9e-8b7d-1c6e-9a1b-2c3d4e5f6a7b', '../x']) assert.equal(validPreviewToken(bad), false, bad);
  assert.equal(previewKey('10000', 't'), 'portalplus:preview:10000:t');
  const rec = { accountId: 'alice', expires: 2000, config: {} };
  assert.equal(previewUsable(rec, 'alice', 1000), true);
  assert.equal(previewUsable(rec, 'bob', 1000), false);
  assert.equal(previewUsable(rec, 'alice', 3000), false);
  assert.equal(previewUsable({ ...rec, config: null }, 'alice', 1000), false);
});
