// "Who can see Portal+" for a project: everyone who can use the portal, or only
// a chosen list of people (for example while piloting Portal+ on the live site).
// Checked on the server for every portal call, so people who aren't on the list
// get nothing from Portal+ and see the JSM portal as normal.
export const MAX_VISIBLE_PEOPLE = 200;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;

export function normalizeVisibility(value) {
  const mode = value?.mode === 'selected' ? 'selected' : 'everyone';
  const seen = new Set();
  const accounts = (Array.isArray(value?.accounts) ? value.accounts : [])
    .map((a) => ({ accountId: String(a?.accountId || '').trim(), displayName: String(a?.displayName || '').trim().slice(0, 120) }))
    .filter((a) => ACCOUNT_ID.test(a.accountId) && !seen.has(a.accountId) && seen.add(a.accountId))
    .slice(0, MAX_VISIBLE_PEOPLE);
  return { mode, accounts };
}

export function validateVisibility(value) {
  const v = normalizeVisibility(value);
  if (v.mode === 'selected' && !v.accounts.length) throw new Error('Add at least one person who can see Portal+, or choose Everyone.');
  return v;
}

export function canSeePortal(visibility, accountId) {
  const v = normalizeVisibility(visibility);
  if (v.mode !== 'selected') return true;
  return Boolean(accountId) && v.accounts.some((a) => a.accountId === String(accountId));
}
