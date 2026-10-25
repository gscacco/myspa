import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase, writeKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount(options = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const base = addItem(emptyKnowledgeBase(), { title: 'Saved', body: 'Body' }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base, ...options });
  return { app, dom, document: dom.window.document };
}

test('explicit EDN save and import round-trip item data and open workspace order', async () => {
  let saved;
  const first = await mount({ saveFile: async source => { saved = source; return true; } });
  first.app.openItem(A);
  assert.equal(first.app.isDirty(), true);
  await first.app.exportEDN();
  assert.equal(first.app.isDirty(), false);
  assert.match(saved, /:schema-version 1/);
  const second = await mount({ confirmReplace: () => true });
  assert.equal(second.app.importEDN(saved), true);
  assert.deepEqual(second.app.getBase().workspace['open-ids'], [A]);
  assert.equal(second.document.querySelector(`[data-item-id="${A}"] h2`).textContent, 'Saved');
  assert.equal(second.app.isDirty(), false);
  first.dom.window.close(); second.dom.window.close();
});

test('invalid and cancelled imports preserve current edits and drafts', async () => {
  let confirmations = 0;
  const { app, dom, document } = await mount({ confirmReplace: () => { confirmations++; return false; } });
  app.openItem(A);
  const card = document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Unsaved draft';
  const before = app.getBase();
  assert.equal(app.importEDN('(+ 1 2)'), false);
  assert.equal(confirmations, 0, 'invalid EDN is rejected before confirmation');
  assert.equal(app.importEDN(writeKnowledgeBase(emptyKnowledgeBase())), false);
  assert.equal(confirmations, 1);
  assert.deepEqual(app.getBase(), before);
  assert.equal(card.querySelector('[name="title"]').value, 'Unsaved draft');
  assert.equal(app.isDirty(), true);
  dom.window.close();
});

test('unsaved edits and unapplied drafts request a beforeunload warning', async () => {
  const { app, dom, document } = await mount();
  const clean = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(clean);
  assert.equal(clean.defaultPrevented, false);
  app.openItem(A);
  const dirty = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(dirty);
  assert.equal(dirty.defaultPrevented, true);
  dom.window.close();

  const draft = await mount({ saveFile: async () => true });
  draft.app.openItem(A);
  await draft.app.exportEDN();
  const card = draft.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="body"]').value = 'Draft only';
  const event = new draft.dom.window.Event('beforeunload', { cancelable: true });
  draft.dom.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  draft.dom.window.close();
});

test('cancelled save retains the unsaved state', async () => {
  const { app, dom } = await mount({ saveFile: async () => false });
  app.openItem(A);
  assert.equal(await app.exportEDN(), null);
  assert.equal(app.isDirty(), true);
  dom.window.close();
});

test('an unapplied draft in any snippet editor blocks saving', async () => {
  let saves = 0;
  const body = '~~~cljs loom\n"First"\n~~~\n\n~~~cljs loom\n"Second"\n~~~';
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const base = addItem(emptyKnowledgeBase(), { title: 'Snippets', body }, { id: A, now: NOW });
  const app = createLoomApp({
    document: dom.window.document, window: dom.window, base,
    saveFile: async () => { saves++; return true; },
  });
  app.openItem(A);
  await app.exportEDN();
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  const edits = card.querySelectorAll('[data-action="edit-snippet"]');
  for (const edit of edits) edit.click();
  const editors = card.querySelectorAll('.snippet-editor textarea');
  editors[1].value = '(changed)';
  assert.equal(app.isDirty(), true);
  assert.equal(await app.exportEDN(), null);
  assert.equal(saves, 1);
  dom.window.close();
});

test('importing a file with executable snippets never runs them', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const body = '~~~cljs loom\n(set! js/globalThis.__loomImportProbe 1)\n~~~';
  let base = addItem(emptyKnowledgeBase(), { title: 'Imported code', body }, { id: A, now: NOW });
  base = { ...base, workspace: { 'open-ids': [A], 'active-id': A } };
  globalThis.__loomImportProbe = 0;
  try {
    createLoomApp({
      document: dom.window.document, window: dom.window,
      chooseFile: async () => ({ text: async () => writeKnowledgeBase(base) }),
    });
    dom.window.document.querySelector('#import-edn').click();
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    assert.equal(globalThis.__loomImportProbe, 0);
    assert.equal(dom.window.document.querySelector('.snippet-output')?.textContent, '');
  } finally { delete globalThis.__loomImportProbe; dom.window.close(); }
});
