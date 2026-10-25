import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { applyMarkdownFormat } from '../../loom/js/markdown-toolbar.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount() {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const base = addItem(emptyKnowledgeBase(), { title: 'Formatting', body: 'plain' }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  return { app, dom, document: dom.window.document, card, textarea: card.querySelector('[name="body"]') };
}

test('Markdown formatting commands update only the requested selection', () => {
  assert.deepEqual(applyMarkdownFormat('hello world', 0, 5, 'bold'), { value: '**hello** world', start: 2, end: 7 });
  assert.deepEqual(applyMarkdownFormat('hello', 0, 5, 'italic'), { value: '*hello*', start: 1, end: 6 });
  assert.deepEqual(applyMarkdownFormat('one\ntwo', 0, 7, 'bullet-list'), { value: '- one\n- two', start: 2, end: 11 });
  const code = applyMarkdownFormat('Before\n\nAfter', 8, 8, 'executable-code');
  assert.equal(code.value, 'Before\n\n~~~clojurescript\n\n~~~\n\nAfter');
  assert.equal(code.value.slice(code.start, code.end), '');
  assert.equal(applyMarkdownFormat('(+ 1 2)', 0, 7, 'executable-code').value, '~~~clojurescript\n(+ 1 2)\n~~~');
});

test('item editing exposes a labelled formatting toolbar with SVG controls', async () => {
  const { dom, card } = await mount();
  const toolbar = card.querySelector('.format-toolbar');
  assert.equal(toolbar.getAttribute('role'), 'toolbar');
  assert.equal(toolbar.getAttribute('aria-label'), 'Markdown formatting');
  const actions = [...toolbar.querySelectorAll('button')].map(button => button.dataset.formatAction);
  assert.deepEqual(actions, ['bold', 'italic', 'strikethrough', 'inline-code', 'heading', 'bullet-list', 'blockquote', 'item-link', 'executable-code']);
  for (const button of toolbar.querySelectorAll('button')) {
    assert.ok(button.querySelector('svg'));
    assert.ok(button.title);
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.type, 'button');
  }
  dom.window.close();
});

test('toolbar actions preserve focus and apply Markdown around the textarea selection', async () => {
  const { app, dom, card, textarea } = await mount();
  textarea.focus();
  textarea.value = 'hello world';
  textarea.setSelectionRange(0, 5);
  card.querySelector('[data-format-action="bold"]').click();
  assert.equal(textarea.value, '**hello** world');
  assert.equal(dom.window.document.activeElement, textarea);
  assert.equal(textarea.selectionStart, 2);
  assert.equal(textarea.selectionEnd, 7);
  card.querySelector('[data-action="apply"]').click();
  assert.equal(app.getBase().items[0].body, '**hello** world');
  assert.equal(card.querySelector('strong').textContent, 'hello');
  dom.window.close();
});

test('the executable-code toolbar button inserts a ClojureScript fence at the cursor', async () => {
  const { dom, card, textarea } = await mount();
  textarea.value = 'Before\n\nAfter';
  textarea.setSelectionRange(8, 8);
  card.querySelector('[data-format-action="executable-code"]').click();
  assert.equal(textarea.value, 'Before\n\n~~~clojurescript\n\n~~~\n\nAfter');
  assert.equal(textarea.selectionStart, 25);
  assert.equal(textarea.selectionEnd, 25);
  assert.equal(dom.window.document.activeElement, textarea);
  dom.window.close();
});

test('Bold and Italic keyboard shortcuts use the same Markdown commands', async () => {
  const { dom, card, textarea } = await mount();
  textarea.value = 'word';
  textarea.setSelectionRange(0, 4);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '**word**');
  textarea.setSelectionRange(2, 6);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '***word***');
  assert.equal(card.querySelector('.format-toolbar').contains(dom.window.document.activeElement), false);
  dom.window.close();
});
