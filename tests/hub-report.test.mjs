import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderReport, reportCsv, presetRange, buckets } from '../hub/report.js';
import { reportJql } from '../src/customer-visibility.js';

const H = 3600000, D = 24 * H;
const at = (iso, plusMs = 0) => new Date(Date.parse(iso) + plusMs).toISOString();
const row = (key, o = {}) => ({ key, summary: `${key} summary`, status: 'Resolved', category: 'done', requestType: 'Email', split: 'Hardware', drill: 'Bluepad-50', created: '2026-10-05T09:00:00Z', resolved: '', sla: null, url: `/servicedesk/customer/portal/12/${key}`, ...o });

const data = {
  from: '2026-10-01', to: '2026-10-22',
  splitField: { id: 'cf1', name: 'Ticket Category' }, drillField: { id: 'cf2', name: 'Device Type' },
  created: [
    row('A', { status: 'Waiting for Support', category: 'indeterminate' }),
    row('B', { split: 'Crew', drill: '', created: '2026-10-06T09:00:00Z' }),
    row('C', { drill: 'Samsung A13', created: '2026-10-20T09:00:00Z', status: 'Sent to Hardware', category: 'indeterminate' }),
  ],
  resolved: [
    row('B', { split: 'Crew', drill: '', created: '2026-10-06T09:00:00Z', resolved: at('2026-10-06T09:00:00Z', 12 * H), sla: { state: 'met' } }),
    row('Z', { created: '2026-09-20T09:00:00Z', resolved: '2026-10-10T09:00:00Z', sla: { state: 'breached' } }),
  ],
};

test('totals cover raised, resolved, backlog, SLA and resolution time', () => {
  const t = buildReport(data).totals;
  assert.deepEqual([t.created, t.resolved, t.net, t.stillOpen], [3, 2, 1, 2]);
  assert.deepEqual([t.measured, t.met, t.breached, t.metPct], [2, 1, 1, 50]);
  assert.equal(t.medianMs, (12 * H + 20 * D) / 2);
});

test('breakdowns count raised and resolved per value, with SLA and average time', () => {
  const m = buildReport(data);
  const cat = m.breakdowns.find((b) => b.dim === 'split');
  assert.equal(cat.title, 'By Ticket Category');
  assert.deepEqual(cat.rows.map((r) => [r.value, r.created, r.resolved, r.metPct]), [['Hardware', 2, 1, 0], ['Crew', 1, 1, 100]]);
  const device = m.breakdowns.find((b) => b.dim === 'drill');
  assert.equal(device.rows.at(-1).value, 'Not set', 'Not set goes last');
  assert.ok(m.breakdowns.find((b) => b.dim === 'status').statusOnly);
});

test('filters narrow the whole report and drop their own breakdown', () => {
  const m = buildReport(data, { filters: [{ dim: 'split', value: 'Hardware' }] });
  assert.deepEqual([m.totals.created, m.totals.resolved], [2, 1]);
  assert.ok(!m.breakdowns.some((b) => b.dim === 'split'));
  assert.equal(buildReport(data, { filters: [{ dim: 'nonsense', value: 'x' }] }).totals.created, 3);
});

test('buckets are daily up to a month, weekly to four months, then monthly', () => {
  assert.equal(buckets('2026-10-01', '2026-10-22').length, 21);
  assert.equal(buckets('2026-07-01', '2026-10-01').length, 14);
  assert.equal(buckets('2025-11-01', '2026-11-01').length, 12);
  const m = buildReport(data);
  assert.equal(m.trend.reduce((n, b) => n + b.created, 0), 3);
  assert.equal(m.trend.reduce((n, b) => n + b.resolved, 0), 2);
});

test('preset ranges end tomorrow (exclusive) and last month is a whole month', () => {
  const now = Date.parse('2026-10-21T15:00:00Z');
  assert.deepEqual(presetRange('7d', now), { from: '2026-10-15', to: '2026-10-22' });
  assert.deepEqual(presetRange('last-month', now), { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(presetRange('this-month', now), { from: '2026-10-01', to: '2026-10-22' });
  assert.throws(() => presetRange('forever', now));
});

test('the report renders escaped, with no inline styles', () => {
  const evil = { ...data, created: [...data.created, row('X', { summary: '<img src=x onerror=alert(1)>', split: '<b>bad</b>' })] };
  const html = renderReport(buildReport(evil));
  assert.ok(!html.includes('<img src=x') && !html.includes('<b>bad</b>') && !html.includes('style='));
  for (const s of ['Raised vs resolved', 'By Ticket Category', 'By Device Type', 'Time to resolve', 'SLA performance', 'Resolved after SLA target']) assert.ok(html.includes(s), s);
});

test('CSV lists each request once and neutralises spreadsheet formulas', () => {
  const csv = reportCsv(buildReport({ ...data, created: [...data.created, row('F', { summary: '=HYPERLINK("x")' })] }));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Key,Summary,Request type,Ticket Category,Device Type,Status,Created,Resolved,Time to resolve (hours),SLA');
  assert.equal(lines.length, 1 + 5, 'A, B, C, F and Z once each');
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});

test('report JQL keeps the customer boundary and refuses long or bad ranges', () => {
  assert.equal(reportJql('acc-1', '10000', [], { field: 'resolved', from: '2026-10-01', to: '2026-10-22' }), 'project = 10000 AND (reporter = "acc-1") AND resolved >= "2026-10-01" AND resolved < "2026-10-22" ORDER BY resolved ASC');
  assert.throws(() => reportJql('acc-1', '10000', [], { field: 'created', from: '2024-01-01', to: '2026-01-01' }), /Invalid/);
  assert.throws(() => reportJql('acc-1', '10000', [], { field: 'created', from: '2026-10-22', to: '2026-10-01' }), /Invalid/);
  assert.throws(() => reportJql('acc-1', '10000', [], { field: 'created', from: '2026-10-01" OR 1=1', to: '2026-10-22' }), /Invalid/);
});
