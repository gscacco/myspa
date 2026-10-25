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

test('active snippets rerun only for observed item and tag dependencies', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Tagged', body: 'First', tags: [keyword('clojure')] }, { id: A, now: NOW });
  base = addItem(base, { title: 'Other', body: 'Other' }, { id: B, now: NOW });
  const code = `~~~cljs loom\n(do (set! (.-tag js/globalThis.__loomProbe) (inc (.-tag js/globalThis.__loomProbe))) (count (loom.core/items {:tag :clojure})))\n~~~\n\n~~~cljs loom\n(do (set! (.-item js/globalThis.__loomProbe) (inc (.-item js/globalThis.__loomProbe))) (:body (loom.core/item "${A}")))\n~~~`;
  base = addItem(base, { title: 'Queries', body: code }, { id: C, now: NOW });
  globalThis.__loomProbe = { tag: 0, item: 0 };
  try {
    const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
    app.openItem(C);
    const card = dom.window.document.querySelector(`[data-item-id="${C}"]`);
    assert.deepEqual(globalThis.__loomProbe, { tag: 1, item: 1 });
    const edit = (id, name, value) => {
      app.openItem(id);
      const target = dom.window.document.querySelector(`[data-item-id="${id}"]`);
      target.querySelector('[data-action="edit"]').click();
      target.querySelector(`[name="${name}"]`).value = value;
      target.querySelector('[data-action="apply"]').click();
    };
    edit(B, 'body', 'Changed other body');
    assert.deepEqual(globalThis.__loomProbe, { tag: 1, item: 1 });
    edit(A, 'body', 'Changed tagged body');
    assert.deepEqual(globalThis.__loomProbe, { tag: 1, item: 2 });
    edit(A, 'title', 'Renamed');
    assert.deepEqual(globalThis.__loomProbe, { tag: 2, item: 3 });
    app.closeItem(C);
    edit(A, 'title', 'Again');
    assert.deepEqual(globalThis.__loomProbe, { tag: 2, item: 3 });
  } finally { delete globalThis.__loomProbe; dom.window.close(); }
});
