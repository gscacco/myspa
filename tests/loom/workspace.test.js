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
const D = '550e8400-e29b-41d4-a716-446655440003';
const E = '550e8400-e29d-41d4-a716-446655440004';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount(options = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = emptyKnowledgeBase();
  base = addItem(base, { title: 'Alpha', body: 'Clarity of thought', tags: [keyword('clojure')] }, { id: A, now: NOW });
  base = addItem(base, { title: 'Beta', body: 'Other idea' }, { id: B, now: NOW });
  base = addItem(base, { title: 'Gamma', body: 'Unrelated' }, { id: C, now: NOW });
  base = addItem(base, { title: 'Thought leadership', body: 'A thought that also mentions thought' }, { id: D, now: NOW });
  base = addItem(base, { title: 'Notes', body: 'Another thought about navigation' }, { id: E, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base, ...options });
  return { app, dom, document: dom.window.document };
}

function confirmDelete(document) {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog);
  dialog.querySelector('[data-action="confirm-delete"]').click();
}

test('cards open and close independently, and history restores exploration', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A);
  app.openItem(B);
  const first = document.querySelector(`[data-item-id="${A}"]`);
  first.scrollTop = 45;
  app.openItem(C);
  assert.deepEqual(app.getBase().workspace['open-ids'], [C, B, A]);
  assert.deepEqual([...document.querySelectorAll('#workspace [data-item-id]')].map(card => card.dataset.itemId), [C, B, A]);
  assert.equal(document.querySelector(`[data-item-id="${A}"]`), first);
  assert.equal(first.scrollTop, 45);
  app.closeItem(B);
  assert.deepEqual(app.getBase().workspace['open-ids'], [C, A]);
  app.back();
  assert.deepEqual(app.getBase().workspace['open-ids'], [C, B, A]);
  app.forward();
  assert.deepEqual(app.getBase().workspace['open-ids'], [C, A]);
  dom.window.close();
});

test('opening an item that is already open moves it to the top without duplication', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A); app.openItem(B); app.openItem(C);
  app.openItem(A);
  assert.deepEqual(app.getBase().workspace['open-ids'], [A, C, B]);
  assert.equal(document.querySelectorAll(`[data-item-id="${A}"]`).length, 1);
  assert.deepEqual([...document.querySelectorAll('#workspace [data-item-id]')].map(card => card.dataset.itemId), [A, C, B]);
  dom.window.close();
});

test('deleting an item removes its card and history skips its stale ID', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A); app.openItem(B); app.openItem(C);
  document.querySelector(`[data-item-id="${B}"] [data-action="delete"]`).click();
  confirmDelete(document);
  assert.equal(app.getBase().items.some(item => item.id === B), false);
  assert.equal(document.querySelector(`[data-item-id="${B}"]`), null);
  app.back(); app.back(); app.forward();
  assert.equal(app.getBase().workspace['open-ids'].includes(B), false);
  dom.window.close();
});

test('deleting a focused card restores focus to the remaining card or search', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A); app.openItem(B);
  let remove = document.querySelector(`[data-item-id="${B}"] [data-action="delete"]`);
  remove.focus(); remove.click();
  confirmDelete(document);
  assert.equal(document.activeElement?.dataset.itemId, A);
  remove = document.querySelector(`[data-item-id="${A}"] [data-action="delete"]`);
  remove.focus(); remove.click();
  confirmDelete(document);
  assert.equal(document.activeElement, document.querySelector('#loom-search'));
  dom.window.close();
});

test('search matches title, tags, and body without closing cards', async () => {
  const { app, dom, document } = await mount();
  app.openItem(B);
  const search = document.querySelector('#loom-search');
  search.value = 'clojure';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(document.querySelectorAll('#search-results button').length, 1);
  assert.match(document.querySelector('#search-results').textContent, /:clojure/);
  document.querySelector('#search-results button').click();
  assert.deepEqual(app.getBase().workspace['open-ids'], [A, B]);
  search.value = 'thought';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(document.querySelector('#search-results').textContent, /Alpha/);
  search.value = 'absent';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(document.querySelector('#search-results').textContent, /No matching items/);
  dom.window.close();
});

test('search groups title and tag matches before content-only matches without duplicates', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A);
  const search = document.querySelector('#loom-search');
  search.value = 'thought'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const groups = [...document.querySelectorAll('#search-results [data-search-group]')];
  assert.deepEqual(groups.map(group => group.dataset.searchGroup), ['titles-tags', 'content']);
  const titleGroup = groups[0], contentGroup = groups[1];
  assert.match(titleGroup.textContent, /Thought leadership/);
  assert.doesNotMatch(contentGroup.textContent, /Thought leadership/);
  assert.match(contentGroup.textContent, /Alpha/);
  assert.match(contentGroup.textContent, /Notes/);
  assert.match(contentGroup.textContent, /Clarity of thought/);
  assert.equal(document.querySelectorAll('#search-results [data-item-id]').length, 3);
  assert.deepEqual(app.getBase().workspace['open-ids'], [A]);
  dom.window.close();
});

test('search reflects an edited item without retaining stale matches', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A);
  const card = document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="body"]').value = 'Aurora insight';
  card.querySelector('[data-action="apply"]').click();
  const search = document.querySelector('#loom-search');
  search.value = 'aurora'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(document.querySelector('#search-results').textContent, /Alpha/);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="body"]').value = 'No matching term';
  card.querySelector('[data-action="apply"]').click();
  assert.match(document.querySelector('#search-results').textContent, /No matching items/);
  dom.window.close();
});

test('editing one item keeps another card and its draft in place', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A);
  app.openItem(B);
  const first = document.querySelector(`[data-item-id="${A}"]`);
  first.querySelector('[data-action="edit"]').click();
  const title = first.querySelector('[name="title"]');
  title.value = 'Alpha draft';
  const other = document.querySelector(`[data-item-id="${B}"]`);
  other.querySelector('[data-action="edit"]').click();
  other.querySelector('[name="title"]').value = 'Beta edited';
  other.querySelector('[data-action="apply"]').click();
  assert.equal(document.querySelector(`[data-item-id="${A}"]`), first);
  assert.equal(first.querySelector('[name="title"]').value, 'Alpha draft');
  assert.equal(app.getBase().items.find(item => item.id === B).title, 'Beta edited');
  dom.window.close();
});
