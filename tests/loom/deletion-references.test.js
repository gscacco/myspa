import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const C = '550e8400-e29b-41d4-a716-446655440002';
const D = '550e8400-e29b-41d4-a716-446655440003';
const E = '550e8400-e29b-41d4-a716-446655440004';
const F = '550e8400-e29b-41d4-a716-446655440005';
const NOW = '2026-10-26T00:00:00.000Z';

async function mount() {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = emptyKnowledgeBase();
  base = addItem(base, { title: 'Source link', body: `See [[item:${D}]] and again [[item:${D}]].` }, { id: A, now: NOW });
  base = addItem(base, { title: 'Source embed', body: `![[item:${D}]]` }, { id: B, now: NOW });
  base = addItem(base, { title: 'Code mention', body: `Inline \`[[item:${D}]]\`.\n\n\`\`\`clojure\n[[item:${D}]]\n\`\`\`` }, { id: C, now: NOW });
  base = addItem(base, { title: 'Target', body: 'Destination' }, { id: D, now: NOW });
  base = addItem(base, { title: 'Unrelated', body: 'Nothing points here' }, { id: E, now: NOW });
  base = addItem(base, { title: 'Legacy source', body: `[Legacy link](loom:${D}) and ![Legacy embed](loom:${D})` }, { id: F, now: NOW });
  const app = createLoomApp({
    document: dom.window.document,
    window: dom.window,
    base,
  });
  let nativeConfirmations = 0;
  dom.window.confirm = () => { nativeConfirmations += 1; return true; };
  return { app, dom, document: dom.window.document, nativeConfirmations: () => nativeConfirmations };
}

function deleteButton(document, id) {
  return document.querySelector(`[data-item-id="${id}"] [data-action="delete"]`);
}

test('deleting a referenced item lists its unique source items and can be cancelled', async () => {
  const { app, dom, document, nativeConfirmations } = await mount();
  app.openItem(D);
  const remove = deleteButton(document, D);
  remove.focus();
  remove.click();

  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /Target is referenced by 3 items/);
  assert.deepEqual([...dialog.querySelectorAll('[data-reference-item]')].map(node => node.textContent), ['Source link', 'Source embed', 'Legacy source']);
  assert.doesNotMatch(dialog.textContent, /Code mention/);
  assert.equal(dialog.querySelector('[data-action="open-all"]').textContent, 'Open all');
  assert.equal(dialog.querySelector('[data-action="cancel"]').textContent, 'Cancel');
  assert.ok(app.getBase().items.some(item => item.id === D));
  assert.equal(nativeConfirmations(), 0);

  dialog.querySelector('[data-action="cancel"]').click();
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(app.getBase().items.some(item => item.id === D));
  assert.equal(document.activeElement, remove);
  dom.window.close();
});

test('Open all opens each referencing item without deleting the target', async () => {
  const { app, dom, document } = await mount();
  app.openItem(E);
  app.openItem(D);
  deleteButton(document, D).click();
  document.querySelector('[role="dialog"] [data-action="open-all"]').click();

  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(app.getBase().workspace['open-ids'], [A, B, F, D, E]);
  assert.ok(app.getBase().items.some(item => item.id === D));
  assert.equal(document.activeElement?.dataset.itemId, A);
  dom.window.close();
});

test('deleting an item without references uses an in-app confirmation', async () => {
  const { app, dom, document, nativeConfirmations } = await mount();
  app.openItem(E);
  const remove = deleteButton(document, E);
  remove.focus();
  remove.click();

  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /Delete "Unrelated" and its content\?/);
  assert.equal(dialog.querySelector('[data-action="confirm-delete"]').textContent, 'Delete');
  assert.equal(dialog.querySelector('[data-action="cancel-delete"]').textContent, 'Cancel');
  assert.ok(app.getBase().items.some(item => item.id === E));
  assert.equal(nativeConfirmations(), 0);

  dialog.querySelector('[data-action="cancel-delete"]').click();
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(app.getBase().items.some(item => item.id === E));
  assert.equal(document.activeElement, remove);

  remove.click();
  document.querySelector('[role="dialog"] [data-action="confirm-delete"]').click();
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(app.getBase().items.some(item => item.id === E), false);
  assert.equal(nativeConfirmations(), 0);
  dom.window.close();
});
