// Admin preview: an admin's unsaved settings, stored briefly under a random
// token that the settings page (which Jira only opens for project admins)
// creates. Portal+ shows a preview only for that token, before it expires, to
// the same signed-in user — so customers can't open one, even by faking the
// modal context. No user-consent APIs are involved.
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const previewKey = (projectId, token) => `portalplus:preview:${projectId}:${token}`;
export const validPreviewToken = (token) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(token || ''));
export const previewUsable = (record, accountId, now = Date.now()) => Boolean(record?.config) && Number(record.expires) > now && Boolean(accountId) && record.accountId === accountId;
