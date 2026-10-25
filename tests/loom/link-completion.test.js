import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const C = '550e8400-e29b-41d4-a716-446655440002';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount() {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Source', body: 'A body with [[', tags: [] }, { id: A, now: NOW });
  base = addItem(base, { title: 'Alpha target', body: 'Alpha body', tags: [keyword('clojure')] }, { id: B, now: NOW });
  base = addItem(base, { title: 'Needle notes', body: 'Needle content' }, { id: C, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  return { app, dom, document: dom.window.document, card, textarea: card.querySelector('[name="body"]') };
}

function type(textarea, dom, value, caret = value.length) {
  textarea.value = value;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('typing [[ opens a contextual search popup and keyboard selection inserts a stable ID', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, 'Before [[', 9);
  let popup = card.querySelector('.link-completion');
  assert.ok(popup);
  assert.equal(popup.hidden, false);
  assert.match(popup.textContent, /Type to search items/);

  type(textarea, dom, 'Before [[alp', 12);
  popup = card.querySelector('.link-completion');
  assert.match(popup.textContent, /Alpha target/);
  assert.equal(popup.querySelectorAll('[role="option"]').length, 1);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  textarea.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(textarea.value, `Before [[item:${B}]]`);
  assert.equal(popup.hidden, true);
  dom.window.close();
});

test('Escape dismisses link completion without changing the source', async () => {
  const { dom, textarea } = await mount();
  type(textarea, dom, 'Keep [[bet', 10);
  const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  textarea.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(textarea.value, 'Keep [[bet');
  assert.equal(textarea.ownerDocument.querySelector('.link-completion').hidden, true);
  dom.window.close();
});

test('mouse selection replaces only the trigger and preserves surrounding text', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, 'Start [[nee middle end', 11);
  const option = card.querySelector('[role="option"]');
  assert.match(option.textContent, /Needle notes/);
  option.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  option.click();
  assert.equal(textarea.value, `Start [[item:${C}]] middle end`);
  dom.window.close();
});

test('link completion reuses title/tag grouping and ignores escaped triggers', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, 'Escaped \\[[', 12);
  assert.equal(card.querySelector('.link-completion')?.hidden, true);
  type(textarea, dom, 'Tag [[clojure', 13);
  const popup = card.querySelector('.link-completion');
  assert.equal(popup.querySelector('[data-search-group="titles-tags"]')?.textContent.includes(':clojure'), true);
  assert.equal(popup.querySelectorAll('[data-item-id]').length, 1);
  dom.window.close();
});
