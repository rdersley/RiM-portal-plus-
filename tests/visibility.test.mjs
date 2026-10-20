import test from 'node:test';
import assert from 'node:assert/strict';
import { canSeePortal, normalizeVisibility, validateVisibility, MAX_VISIBLE_PEOPLE } from '../src/visibility.js';

test('everyone is the default and lets anyone through', () => {
  assert.deepEqual(normalizeVisibility(undefined), { mode: 'everyone', accounts: [] });
  assert.equal(canSeePortal(undefined, 'anyone'), true);
  assert.equal(canSeePortal({ mode: 'nonsense' }, 'anyone'), true);
});

test('selected people only, and never an anonymous caller', () => {
  const v = { mode: 'selected', accounts: [{ accountId: '557058:abc', displayName: 'Alice' }] };
  assert.equal(canSeePortal(v, '557058:abc'), true);
  assert.equal(canSeePortal(v, 'someone-else'), false);
  assert.equal(canSeePortal(v, ''), false);
  assert.equal(canSeePortal(v, undefined), false);
});

test('the list is cleaned, de-duplicated and capped', () => {
  const v = normalizeVisibility({ mode: 'selected', accounts: [
    { accountId: 'a1', displayName: 'A' }, { accountId: 'a1', displayName: 'Dup' }, { accountId: 'bad id!' }, { accountId: '' }, null,
  ] });
  assert.deepEqual(v.accounts, [{ accountId: 'a1', displayName: 'A' }]);
  const many = normalizeVisibility({ mode: 'selected', accounts: Array.from({ length: 300 }, (_, i) => ({ accountId: `u${i}` })) });
  assert.equal(many.accounts.length, MAX_VISIBLE_PEOPLE);
});

test('"Only selected people" needs at least one person', () => {
  assert.throws(() => validateVisibility({ mode: 'selected', accounts: [] }), /at least one person/);
  assert.deepEqual(validateVisibility({ mode: 'everyone' }).mode, 'everyone');
});
