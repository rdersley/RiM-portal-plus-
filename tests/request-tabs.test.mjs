import test from 'node:test';
import assert from 'node:assert/strict';
import { checkJqlFragment, normalizeRequestTabs, validateRequestTabs, tabJql, MAX_TABS } from '../src/request-tabs.js';

test('tab JQL must be balanced so it cannot escape the customer boundary', () => {
  assert.equal(checkJqlFragment(' priority = High '), 'priority = High');
  assert.equal(checkJqlFragment('summary ~ "a (b"'), 'summary ~ "a (b"', 'brackets inside quotes are ignored');
  assert.equal(checkJqlFragment(''), '');
  for (const bad of ['x = 1) OR (project = OTHER', 'x = 1) OR project = OTHER OR (y = 2', '(x = 1', 'summary ~ "open', 'x = 1 ORDER BY created']) {
    assert.throws(() => checkJqlFragment(bad), Error, bad);
  }
  assert.equal(checkJqlFragment('summary ~ "order by me"'), 'summary ~ "order by me"');
});

test('tabs are tidied, capped and given ids', () => {
  const tabs = normalizeRequestTabs([
    { title: '  Hardware   requests  ', jql: 'cf[10445] = Hardware', counters: [{ name: 'Open', jql: 'statusCategory != Done' }, { name: '', jql: 'x = 1' }, { name: 'Bad id', id: 'a b', jql: 'y = 2' }], columns: ['priority', { id: 'priority' }, { id: 'bad id' }, { id: 'customfield_10411', name: 'Device Type' }] },
    {},
  ]);
  assert.equal(tabs[0].title, 'Hardware requests');
  assert.deepEqual(tabs[0].counters.map((c) => [c.id, c.name]), [['c1', 'Open'], ['c3', 'Bad id']]);
  assert.deepEqual(tabs[0].columns.map((c) => c.id), ['priority', 'customfield_10411']);
  assert.equal(tabs[1].title, 'Tab 2');
  assert.equal(normalizeRequestTabs(Array.from({ length: 15 }, () => ({}))).length, MAX_TABS);
});

test('validation names the tab and counter at fault', () => {
  assert.throws(() => validateRequestTabs(normalizeRequestTabs([{ title: 'HW', jql: 'a = 1)' }])), /Tab "HW"/);
  assert.throws(() => validateRequestTabs(normalizeRequestTabs([{ title: 'HW', counters: [{ name: 'Mine', jql: '(a = 1' }] }])), /Counter "Mine" in tab "HW"/);
  assert.doesNotThrow(() => validateRequestTabs(normalizeRequestTabs([{ title: 'HW', jql: 'a = 1', counters: [{ name: 'Open', jql: 'statusCategory != Done' }] }])));
});

test('tab and counter JQL are added inside the customer boundary', () => {
  const tab = { jql: 'cf[10445] = Hardware' }, counter = { jql: 'statusCategory != Done' };
  assert.equal(tabJql('acc-1', '10000', [{ name: 'Ryanair' }], { tab, counter }), 'project = 10000 AND (reporter = "acc-1" OR organizations in ("Ryanair")) AND (cf[10445] = Hardware) AND (statusCategory != Done) ORDER BY created DESC');
  assert.equal(tabJql('acc-1', '10000', [], { tab: { jql: '' } }), 'project = 10000 AND (reporter = "acc-1") ORDER BY created DESC');
  assert.throws(() => tabJql('acc-1', '10000', [], { tab: { jql: 'a = 1) OR (b = 2' } }), /not set up/);
  assert.throws(() => tabJql('acc-1', '10000', [], { tab, order: 'summary; DROP' }), /order/);
});
