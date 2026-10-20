import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveModel, renderLiveDashboard, isOpen } from '../static/portal/src/live-dashboard.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const d = (days) => new Date(NOW - days * 86400000).toISOString();
const row = (key, o = {}) => ({ key, summary: `${key} summary`, status: 'Waiting for Support', statusId: '10', category: 'indeterminate', requestType: 'Email', created: d(2), updated: d(1), resolved: '', split: 'DUB', sla: null, url: '', ...o });

const data = {
  generatedAt: new Date(NOW).toISOString(),
  statusMapping: { awaitingCustomer: ['20'], awaitingSupport: ['10'] },
  splitField: { id: 'customfield_station', name: 'Station' },
  rows: [
    row('SD-1', { created: d(40) }),
    row('SD-2', { statusId: '20', status: 'Waiting for Customer', split: 'STN', sla: { state: 'running', atRisk: true } }),
    row('SD-3', { split: '', sla: { state: 'breached', atRisk: false } }),
    row('SD-4', { category: 'done', status: 'Resolved', resolved: d(1), created: d(3), sla: { state: 'met' } }),
    row('SD-5', { category: 'done', status: 'Resolved', resolved: d(10), created: d(12), sla: { state: 'breached' } }),
  ],
};

test('open/closed uses the status category, falling back to the status name', () => {
  assert.equal(isOpen({ category: 'done', status: 'Waiting' }), false);
  assert.equal(isOpen({ category: '', status: 'Resolved' }), false);
  assert.equal(isOpen({ status: 'In progress' }), true);
});

test('KPIs count every visible request, not just the first page', () => {
  const m = buildLiveModel(data, { now: NOW });
  assert.deepEqual(m.kpis, { open: 3, waitingOnYou: 1, waitingOnSupport: 2, breached: 1, atRisk: 1, resolvedThisWeek: 1, createdThisWeek: m.kpis.createdThisWeek });
  assert.deepEqual(m.bySplit, [['DUB', 1], ['STN', 1], ['Not set', 1]]);
  assert.deepEqual(m.byStatus, [['Waiting for Support', 2], ['Waiting for Customer', 1]]);
});

test('SLA performance and resolution time come from resolved requests', () => {
  const m = buildLiveModel(data, { now: NOW });
  assert.equal(m.sla.measured, 2);
  assert.equal(m.sla.metPct, 50);
  assert.equal(m.sla.resolved30, 2);
  assert.equal(Math.round(m.sla.avgResolutionMs / 86400000), 2);
});

test('attention lists are ordered oldest first, and the trend covers 8 weeks', () => {
  const m = buildLiveModel(data, { now: NOW });
  assert.equal(m.oldestOpen[0].key, 'SD-1');
  assert.equal(m.oldestOpen[0].ageDays, 40);
  assert.deepEqual(m.waitingList.map((r) => r.key), ['SD-2']);
  assert.equal(m.trend.length, 8);
  assert.equal(m.trend.reduce((n, w) => n + w.created, 0), 5);
});

test('the dashboard renders escaped text and every section', () => {
  const evil = { ...data, rows: [...data.rows, row('SD-6', { summary: '<img src=x onerror=alert(1)>' })] };
  const html = renderLiveDashboard(buildLiveModel(evil, { now: NOW }), { now: NOW });
  assert.ok(!html.includes('<img src=x'));
  for (const s of ['Open by status', 'Open by Station', 'Open by request type', 'Created vs resolved', 'Service levels', 'Waiting on you', 'Oldest open requests', 'Recently updated']) assert.ok(html.includes(s), s);
});
