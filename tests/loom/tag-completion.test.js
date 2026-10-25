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

async function mount(tagSets = [['clojure', 'javascript'], ['knowledge-management', 'clojure']]) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Source', body: 'Body' }, { id: A, now: NOW });
  base = addItem(base, { title: 'Tagged one', tags: tagSets[0].map(keyword) }, { id: B, now: NOW });
  base = addItem(base, { title: 'Tagged two', tags: (tagSets[1] || []).map(keyword) }, { id: C, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  return { app, dom, card, input: card.querySelector('[name="tags"]') };
}

function type(input, dom, value) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('the tag field suggests each existing tag once and inserts the mouse choice', async () => {
  const { dom, card, input } = await mount();
  input.focus();
  const popup = card.querySelector('.tag-completion');
  assert.ok(popup);
  assert.equal(popup.hidden, false);
  assert.equal(popup.getAttribute('role'), 'listbox');
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...popup.querySelectorAll('[role="option"]')].map(option => option.textContent), [
    ':clojure', ':javascript', ':knowledge-management',
  ]);

  popup.querySelectorAll('[role="option"]')[1].click();
  assert.equal(input.value, 'javascript');
  assert.equal(popup.hidden, true);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  dom.window.close();
});

test('tag suggestions filter incrementally and support keyboard selection', async () => {
  const { dom, card, input } = await mount();
  input.focus();
  type(input, dom, 'KNOW');
  const popup = card.querySelector('.tag-completion');
  assert.deepEqual([...popup.querySelectorAll('[role="option"]')].map(option => option.textContent), [':knowledge-management']);
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(input.value, 'knowledge-management');
  assert.equal(popup.hidden, true);
  dom.window.close();
});

test('already entered tags are excluded and Escape preserves the current text', async () => {
  const { dom, card, input } = await mount();
  input.focus();
  type(input, dom, 'clojure ');
  const popup = card.querySelector('.tag-completion');
  assert.deepEqual([...popup.querySelectorAll('[role="option"]')].map(option => option.textContent), [
    ':javascript', ':knowledge-management',
  ]);
  const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  input.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(popup.hidden, true);
  assert.equal(input.value, 'clojure ');
  dom.window.close();
});

test('the tag field stays quiet when there are no existing tags', async () => {
  const { dom, card, input } = await mount([[], []]);
  input.focus();
  assert.equal(card.querySelector('.tag-completion').hidden, true);
  dom.window.close();
});
