// Content blocks: banners, formatted text, link cards, FAQs and contact cards
// that admins add to an experience's home page, optionally scheduled. Stored as
// plain fields (never HTML); the portal escapes everything and renders a small,
// fixed set of formatting.
import { safeTabUrl } from './companion-menu.js';

export const MAX_BLOCKS = 12;
export const MAX_ITEMS = 12;
export const BLOCK_TYPES = Object.freeze(['banner', 'text', 'links', 'faq', 'contact']);
export const TONES = Object.freeze(['brand', 'info', 'success', 'warning']);

const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const para = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const idOk = (v) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(v || ''));

function blockBody(b) {
  switch (b.type) {
    case 'banner': return { title: line(b.title, 100), text: para(b.text, 400), buttonLabel: line(b.buttonLabel, 40), buttonUrl: safeTabUrl(b.buttonUrl), tone: TONES.includes(b.tone) ? b.tone : 'brand' };
    case 'text': return { title: line(b.title, 100), body: para(b.body, 4000) };
    case 'links': return { title: line(b.title, 100), items: (Array.isArray(b.items) ? b.items : []).map((i) => ({ label: line(i?.label, 60), description: line(i?.description, 160), url: safeTabUrl(i?.url) })).filter((i) => i.label && i.url).slice(0, MAX_ITEMS) };
    case 'faq': return { title: line(b.title, 100), items: (Array.isArray(b.items) ? b.items : []).map((i) => ({ question: line(i?.question, 200), answer: para(i?.answer, 2000) })).filter((i) => i.question && i.answer).slice(0, MAX_ITEMS) };
    case 'contact': return { title: line(b.title, 100), name: line(b.name, 80), role: line(b.role, 80), email: /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,}$/.test(String(b.email || '').trim()) ? String(b.email).trim() : '', phone: line(b.phone, 40).replace(/[^0-9+()\-. ]/g, ''), hours: line(b.hours, 120), url: safeTabUrl(b.url) };
    default: return null;
  }
}

const hasContent = (b) => (b.type === 'links' || b.type === 'faq' ? b.items.length > 0 : b.type === 'contact' ? Boolean(b.name || b.email || b.phone || b.url) : b.type === 'banner' ? Boolean(b.title || b.text) : Boolean(b.title || b.body));

export function normalizeContentBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).filter((b) => BLOCK_TYPES.includes(b?.type)).slice(0, MAX_BLOCKS).map((b, i) => {
    const from = day(b.showFrom), until = day(b.showUntil);
    return { id: idOk(b.id) ? String(b.id) : `block-${i + 1}`, type: b.type, ...blockBody(b), showFrom: from, showUntil: until && (!from || until >= from) ? until : '' };
  }).filter(hasContent);
}

// Blocks to show today. Dates are whole days, inclusive, in UTC.
export function activeBlocks(blocks = [], now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  return (Array.isArray(blocks) ? blocks : []).filter((b) => (!b.showFrom || b.showFrom <= today) && (!b.showUntil || b.showUntil >= today));
}
