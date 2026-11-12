import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContentBlocks, activeBlocks, MAX_BLOCKS } from '../src/content-blocks.js';
import { renderRichText } from '../static/portal/src/rich-text.js';

test('blocks keep only known types, safe links and real content', () => {
  const blocks = normalizeContentBlocks([
    { type: 'banner', title: ' Planned  maintenance ', text: 'Saturday 2am', buttonLabel: 'Details', buttonUrl: 'javascript:alert(1)', tone: 'neon' },
    { type: 'links', title: 'Useful', items: [{ label: 'Status', url: 'https://status.example.com' }, { label: 'Bad', url: 'http://plain.example.com' }, { label: '', url: 'https://x.example.com' }] },
    { type: 'faq', items: [{ question: 'How?', answer: 'Like this' }, { question: 'Empty' }] },
    { type: 'contact', name: 'Service desk', email: 'help@example.com', phone: '+353 1 234 <script>' },
    { type: 'script', body: 'x' },
    { type: 'text', title: '', body: '' },
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ['banner', 'links', 'faq', 'contact']);
  assert.equal(blocks[0].title, 'Planned maintenance');
  assert.equal(blocks[0].buttonUrl, '');
  assert.equal(blocks[0].tone, 'brand');
  assert.deepEqual(blocks[1].items.map((i) => i.label), ['Status']);
  assert.equal(blocks[2].items.length, 1);
  assert.equal(blocks[3].phone, '+353 1 234 ');
  assert.equal(normalizeContentBlocks(Array.from({ length: 20 }, () => ({ type: 'text', body: 'x' }))).length, MAX_BLOCKS);
});

test('scheduled blocks show only between their dates (inclusive)', () => {
  const blocks = normalizeContentBlocks([
    { id: 'always', type: 'text', body: 'a' },
    { id: 'future', type: 'text', body: 'b', showFrom: '2026-12-01' },
    { id: 'window', type: 'text', body: 'c', showFrom: '2026-11-10', showUntil: '2026-11-12' },
    { id: 'bad-range', type: 'text', body: 'd', showFrom: '2026-11-12', showUntil: '2026-11-01' },
  ]);
  assert.equal(blocks[3].showUntil, '', 'an end before the start is dropped');
  assert.deepEqual(activeBlocks(blocks, Date.parse('2026-11-12T23:00:00Z')).map((b) => b.id), ['always', 'window', 'bad-range']);
  assert.deepEqual(activeBlocks(blocks, Date.parse('2026-11-13T00:00:00Z')).map((b) => b.id), ['always', 'bad-range']);
});

test('formatted text escapes everything and allows only safe formatting', () => {
  assert.equal(renderRichText('Hello **there** and *you*\nsecond line'), '<p>Hello <strong>there</strong> and <em>you</em><br>second line</p>');
  assert.equal(renderRichText('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(renderRichText('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(renderRichText('[Status](https://status.example.com/a?b=1&c=2)'), '<p><a href="https://status.example.com/a?b=1&amp;c=2" data-rich-link="https://status.example.com/a?b=1&amp;c=2">Status</a></p>');
  assert.equal(renderRichText('[Bad](javascript:void0)'), '<p>Bad</p>');
  assert.ok(!renderRichText('[Bad](javascript:alert(1))').includes('<a'), 'never becomes a link');
  assert.equal(renderRichText('[x"onmouseover=alert(1)](https://a.example.com)'), '<p><a href="https://a.example.com" data-rich-link="https://a.example.com">x&quot;onmouseover=alert(1)</a></p>');
  assert.equal(renderRichText('[Raise](/servicedesk/customer/portal/2)'), '<p><a href="/servicedesk/customer/portal/2" data-rich-link="/servicedesk/customer/portal/2">Raise</a></p>');
  assert.equal(renderRichText(''), '');
});
