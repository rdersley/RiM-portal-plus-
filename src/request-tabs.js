// Request tabs: admin-defined views of My Requests, each with its own JQL,
// up to three counters and its own columns. Tab and counter JQL can only
// narrow what a customer sees: they are added inside the customer boundary as
// "AND (...)", and must be balanced so they cannot close that group early.
import { customerJql } from './customer-visibility.js';

export const MAX_TABS = 10;
export const MAX_COUNTERS = 3;
export const MAX_TAB_COLUMNS = 8;
export const MAX_JQL = 1000;
export const DEFAULT_COUNTERS = Object.freeze([
  { name: 'Open', jql: 'statusCategory != Done' },
  { name: 'Resolved', jql: 'statusCategory = Done' },
]);
// System fields a tab may show as columns, alongside the project's customer fields.
export const SYSTEM_COLUMNS = Object.freeze([
  { id: 'priority', name: 'Priority' },
  { id: 'duedate', name: 'Due date' },
  { id: 'assignee', name: 'Assignee' },
  { id: 'components', name: 'Components' },
  { id: 'labels', name: 'Labels' },
]);

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const idOk = (v) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(v || ''));

// Returns the trimmed fragment, or throws with a reason the admin can act on.
export function checkJqlFragment(jql, label = 'JQL') {
  const s = String(jql ?? '').trim();
  if (!s) return '';
  if (s.length > MAX_JQL) throw new Error(`${label} is longer than ${MAX_JQL} characters.`);
  let depth = 0, quote = '', outside = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; outside += ' '; continue; }
    if (c === '(') depth += 1;
    if (c === ')') { depth -= 1; if (depth < 0) throw new Error(`${label} has a ")" without a matching "(".`); }
    outside += c;
  }
  if (quote) throw new Error(`${label} has an unclosed quote.`);
  if (depth !== 0) throw new Error(`${label} has unbalanced brackets.`);
  if (/\border\s+by\b/i.test(outside)) throw new Error(`${label} can't include ORDER BY.`);
  return s;
}

const safeJql = (jql) => { try { return checkJqlFragment(jql); } catch (_) { return null; } };

export function normalizeRequestTabs(tabs = []) {
  return (Array.isArray(tabs) ? tabs : []).slice(0, MAX_TABS).map((t, i) => {
    const jql = String(t?.jql ?? '').trim().slice(0, MAX_JQL);
    const counters = (Array.isArray(t?.counters) ? t.counters : []).slice(0, MAX_COUNTERS)
      .map((c, j) => ({ id: idOk(c?.id) ? String(c.id) : `c${j + 1}`, name: text(c?.name, 24), jql: String(c?.jql ?? '').trim().slice(0, MAX_JQL) }))
      .filter((c) => c.name && c.jql);
    const columns = (Array.isArray(t?.columns) ? t.columns : []).filter((c) => idOk(c?.id || c))
      .map((c) => ({ id: String(c.id || c), name: text(c.name || c.id || c, 60) }))
      .filter((c, k, a) => a.findIndex((x) => x.id === c.id) === k).slice(0, MAX_TAB_COLUMNS);
    return { id: idOk(t?.id) ? String(t.id) : `tab-${i + 1}`, title: text(t?.title, 24) || `Tab ${i + 1}`, jql, counters, columns };
  });
}

// Throws on the first problem, naming the tab and counter, so the admin can fix it.
export function validateRequestTabs(tabs = []) {
  const ids = new Set();
  for (const t of tabs) {
    if (ids.has(t.id)) throw new Error(`Two request tabs share the id "${t.id}".`);
    ids.add(t.id);
    checkJqlFragment(t.jql, `Tab "${t.title}" JQL`);
    for (const c of t.counters) {
      if (!c.jql) throw new Error(`Counter "${c.name}" in tab "${t.title}" needs JQL.`);
      checkJqlFragment(c.jql, `Counter "${c.name}" in tab "${t.title}"`);
    }
  }
  return tabs;
}

// The customer's own boundary, then the tab, then (optionally) a counter.
export function tabJql(accountId, projectId, orgs = [], { scope = null, tab, counter = null, order = 'created DESC' } = {}) {
  const parts = [tab?.jql, counter?.jql].map((j) => (j ? safeJql(j) : ''));
  if (parts.some((p) => p === null)) throw new Error('This request tab is not set up correctly.');
  const extra = parts.filter(Boolean).map((p) => ` AND (${p})`).join('');
  if (!/^(created|updated) (ASC|DESC)$/.test(order)) throw new Error('Unknown order.');
  return customerJql(accountId, projectId, orgs, { scope }).replace(/ ORDER BY created DESC$/, `${extra} ORDER BY ${order}`);
}
