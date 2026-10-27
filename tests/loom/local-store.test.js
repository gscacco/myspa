import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase, writeKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';
import { LOCAL_STORAGE_KEY, readLocalKnowledgeBase, writeLocalKnowledgeBase } from '../../loom/js/local-store.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function savedBase() {
  return addItem(emptyKnowledgeBase(), { title: 'Saved locally', body: 'Body' }, { id: A, now: NOW });
}

async function mount(storage, base = savedBase(), options = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base, storage, ...options });
  return { app, dom, document: dom.window.document };
}

test('the local store round-trips validated EDN and ignores corrupt data', () => {
  const storage = memoryStorage();
  assert.equal(readLocalKnowledgeBase(storage), null);
  const base = savedBase();
  assert.equal(writeLocalKnowledgeBase(storage, base), true);
  assert.deepEqual(readLocalKnowledgeBase(storage), base);
  storage.setItem(LOCAL_STORAGE_KEY, 'not edn');
  assert.equal(readLocalKnowledgeBase(storage), null);
});

test('applied item edits and workspace state reload from local storage', async () => {
  const storage = memoryStorage();
  const first = await mount(storage);
  first.app.openItem(A);
  const card = first.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Locally saved edit';
  card.querySelector('[data-action="apply"]').click();

  const second = await mount(storage, emptyKnowledgeBase());
  assert.equal(second.app.getBase().items.find(item => item.id === A).title, 'Locally saved edit');
  assert.deepEqual(second.app.getBase().workspace, { 'open-ids': [A], 'active-id': A });
  assert.equal(second.document.querySelector(`[data-item-id="${A}"] h2`).textContent, 'Locally saved edit');
  first.dom.window.close(); second.dom.window.close();
});

test('new, edited, and deleted items persist only after Apply or Delete', async () => {
  const storage = memoryStorage();
  writeLocalKnowledgeBase(storage, savedBase());
  const first = await mount(storage);
  first.document.querySelector('#new-item').click();
  first.document.querySelector('[name="title"]').value = 'Unapplied draft';
  let reopened = await mount(storage, emptyKnowledgeBase());
  assert.equal(reopened.app.getBase().items.some(item => item.title === 'Unapplied draft'), false);
  reopened.dom.window.close();

  first.document.querySelector('[data-action="apply"]').click();
  reopened = await mount(storage, emptyKnowledgeBase());
  assert.equal(reopened.app.getBase().items.filter(item => item.title === 'Unapplied draft').length, 1);
  reopened.dom.window.close();

  const created = first.app.getBase().items.find(item => item.title === 'Unapplied draft');
  reopened = await mount(storage, emptyKnowledgeBase());
  reopened.app.deleteItem(created.id);
  reopened.document.querySelector('[data-action="confirm-delete"]').click();
  const final = await mount(storage, emptyKnowledgeBase());
  assert.equal(final.app.getBase().items.some(item => item.id === created.id), false);
  first.dom.window.close(); reopened.dom.window.close(); final.dom.window.close();
});

test('local persistence removes the leave warning for applied changes but keeps it for drafts', async () => {
  const storage = memoryStorage();
  const { app, dom, document } = await mount(storage);
  app.openItem(A);
  const card = document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Saved before leaving';
  card.querySelector('[data-action="apply"]').click();
  const saved = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(saved);
  assert.equal(saved.defaultPrevented, false);

  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Still a draft';
  const draft = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(draft);
  assert.equal(draft.defaultPrevented, true);
  dom.window.close();
});

test('failed local writes keep the app usable and report the failure', async () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('quota exceeded'); };
  const { app, dom, document } = await mount(storage);
  app.openItem(A);
  assert.match(document.querySelector('#loom-status').textContent, /Local save failed/);
  assert.equal(document.querySelector(`[data-item-id="${A}"] h2`).textContent, 'Saved locally');
  dom.window.close();
});
