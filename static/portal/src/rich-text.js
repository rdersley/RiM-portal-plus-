// Formatted text for content blocks. Everything is escaped first; only these
// are then recognised: paragraphs, "- " bullet lists, **bold**, *italic* and
// [label](https://… or /servicedesk/…) links. No HTML from admins ever reaches the page.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAFE_URL = /^(https:\/\/[^\s/\\"']+(\/[^\s"']*)?|\/(servicedesk|wiki|helpcenter|jira)\/[^\s"']*)$/i;

function inline(text) {
  // Links first, on the escaped text, so labels and URLs cannot carry markup.
  return esc(text)
    .replace(/\[([^\]]{1,120})\]\(([^)\s]{1,500})\)/g, (all, label, url) => {
      const raw = url.replace(/&amp;/g, '&');
      return SAFE_URL.test(raw) ? `<a href="${esc(raw)}" data-rich-link="${esc(raw)}">${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
}

export function renderRichText(source) {
  const blocks = String(source ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
