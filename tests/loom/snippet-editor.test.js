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
  const css = await readFile(new URL('../../loom/css/style.css', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const style = dom.window.document.createElement('style'); style.textContent = css;
  dom.window.document.head.append(style);
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
  const highlight = card.querySelector('.snippet-highlight');
  assert.ok(highlight);
  assert.equal(highlight.getAttribute('aria-hidden'), 'true');
  assert.equal(highlight.textContent, '(a b) c');
  const field = card.querySelector('.snippet-code-field');
  assert.match(dom.window.getComputedStyle(field).fontFamily, /JetBrains Mono/);
  assert.equal(dom.window.getComputedStyle(field).fontSize, '14px');
  assert.equal(dom.window.getComputedStyle(field).lineHeight, '21px');
  assert.equal(dom.window.getComputedStyle(textarea).position, 'absolute');
  assert.equal(dom.window.getComputedStyle(textarea).whiteSpace, 'pre');
  assert.equal(textarea.wrap, 'off');
  assert.equal(dom.window.getComputedStyle(textarea).paddingTop, dom.window.getComputedStyle(highlight).paddingTop);
  textarea.value = '(def greeting "hello")';
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(highlight.textContent, '(def greeting "hello")');
  assert.equal(highlight.querySelector('.k')?.textContent, 'def');
  assert.equal(highlight.querySelector('.s')?.textContent, '"hello"');
  textarea.value = '(a b) c';
  textarea.setSelectionRange(4, 4);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
  assert.equal(textarea.value, '(a b c)');
  const apply = card.querySelector('[data-action="apply-snippet"]');
  const cancel = card.querySelector('[data-action="cancel-snippet"]');
  for (const [button, title] of [[apply, 'Apply code'], [cancel, 'Cancel']]) {
    assert.ok(button.classList.contains('icon-button'));
    assert.ok(button.querySelector('svg'));
    assert.equal(button.textContent, '');
    assert.equal(button.title, title);
    assert.ok(button.getAttribute('aria-label'));
  }
  apply.click();
  assert.equal(app.getBase().items.find(item => item.id === A).body, body.replace('(a b) c', '(a b c)'));
  assert.equal(dom.window.document.querySelector(`[data-item-id="${B}"]`), context);
  assert.equal(card.scrollTop, 36);
  card.querySelector('[data-action="edit-snippet"]').click();
  card.querySelector('.snippet-editor textarea').value = '(changed)';
  assert.ok(card.querySelector('[data-action="cancel-snippet"] svg'));
  card.querySelector('[data-action="cancel-snippet"]').click();
  assert.equal(app.getBase().items.find(item => item.id === A).body, body.replace('(a b) c', '(a b c)'));
  dom.window.close();
});

test('snippet view and editor icons toggle modes without silently discarding drafts', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const base = addItem(emptyKnowledgeBase(), { title: 'Code', body: '~~~clojurescript\n(+ 40 2)\n~~~' }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  const snippet = card.querySelector('.loom-snippet');
  const output = snippet.querySelector('.snippet-output');
  const view = snippet.querySelector('[data-action="view-snippet"]');
  const edit = snippet.querySelector('[data-action="edit-snippet"]');
  assert.equal(output.hidden, false);
  assert.equal(view.getAttribute('aria-pressed'), 'true');
  assert.equal(edit.getAttribute('aria-pressed'), 'false');

  edit.click();
  assert.equal(output.hidden, true);
  assert.equal(snippet.querySelector('.snippet-editor textarea').value, '(+ 40 2)');
  assert.equal(view.getAttribute('aria-pressed'), 'false');
  assert.equal(edit.getAttribute('aria-pressed'), 'true');

  view.click();
  assert.equal(snippet.querySelector('.snippet-editor'), null);
  assert.equal(output.hidden, false);
  assert.equal(view.getAttribute('aria-pressed'), 'true');
  assert.equal(edit.getAttribute('aria-pressed'), 'false');

  edit.click();
  const textarea = snippet.querySelector('.snippet-editor textarea');
  textarea.value = '(+ 1 1)';
  let confirmations = 0;
  dom.window.confirm = () => { confirmations++; return false; };
  view.click();
  assert.equal(confirmations, 1);
  assert.ok(snippet.querySelector('.snippet-editor'));
  assert.equal(output.hidden, true);
  assert.equal(app.getBase().items[0].body, '~~~clojurescript\n(+ 40 2)\n~~~');

  dom.window.confirm = () => { confirmations++; return true; };
  view.click();
  assert.equal(confirmations, 2);
  assert.equal(snippet.querySelector('.snippet-editor'), null);
  assert.equal(output.hidden, false);
  assert.equal(app.getBase().items[0].body, '~~~clojurescript\n(+ 40 2)\n~~~');
  dom.window.close();
});
