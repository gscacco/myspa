import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';
import { applySnippetEdit, findSnippetSpan } from '../../loom/js/snippet-source.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

test('snippet spans identify only exact executable fences and reject stale source', () => {
  const body = 'Before\n\n~~~cljs\nexample\n~~~\n\n~~~cljs loom\n(a b) c\n~~~\n\nAfter';
  const span = findSnippetSpan(body, 0);
  assert.equal(body.slice(span.start, span.end), '(a b) c');
  assert.equal(findSnippetSpan(body, 1), null);
  assert.equal(applySnippetEdit(body, body, span, '(a b c)'), body.replace('(a b) c', '(a b c)'));
  assert.throws(() => applySnippetEdit(body, body + ' changed', span, '(a b c)'), /changed|conflict/i);
  const crlf = '```cljs loom\r\n(+ 1 2)\r\n```\r\n';
  assert.equal(findSnippetSpan(crlf, 0)?.source, '(+ 1 2)');
});

test('structural snippet editing changes only its code and retains other cards', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const body = 'Before\n\n~~~cljs loom\n(a b) c\n~~~\n\nAfter';
  let base = addItem(emptyKnowledgeBase(), { title: 'Code', body }, { id: A, now: NOW });
  base = addItem(base, { title: 'Context', body: 'Stay open' }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A); app.openItem(B);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  const context = dom.window.document.querySelector(`[data-item-id="${B}"]`);
  card.scrollTop = 36;
  card.querySelector('[data-action="edit-snippet"]').click();
  const textarea = card.querySelector('.snippet-editor textarea');
  assert.equal(textarea.value, '(a b) c');
  textarea.setSelectionRange(4, 4);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
  assert.equal(textarea.value, '(a b c)');
  card.querySelector('[data-action="apply-snippet"]').click();
  assert.equal(app.getBase().items.find(item => item.id === A).body, body.replace('(a b) c', '(a b c)'));
  assert.equal(dom.window.document.querySelector(`[data-item-id="${B}"]`), context);
  assert.equal(card.scrollTop, 36);
  card.querySelector('[data-action="edit-snippet"]').click();
  card.querySelector('.snippet-editor textarea').value = '(changed)';
  card.querySelector('[data-action="cancel-snippet"]').click();
  assert.equal(app.getBase().items.find(item => item.id === A).body, body.replace('(a b) c', '(a b c)'));
  dom.window.close();
});
