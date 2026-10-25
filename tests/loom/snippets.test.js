import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { renderResult } from '../../loom/js/render.js';
import { createSnippetRuntime } from '../../loom/js/runtime.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

test('the Loom SCI API composes tagged item queries and navigable Hiccup links', () => {
  let base = addItem(emptyKnowledgeBase(), { title: 'Beta', tags: [keyword('clojure')] }, { id: A, now: NOW });
  base = addItem(base, { title: 'Alpha', tags: [keyword('clojure')] }, { id: B, now: NOW });
  const runtime = createSnippetRuntime({ getItems: () => base.items, scittle: globalThis.scittle });
  const source = '(into [:ul] (map (fn [{:keys [id title]}] [:li (loom.core/link id title)]) (sort-by :title (loom.core/items {:tag :clojure}))))';
  const { value, dependencies } = runtime.run(source);
  assert.deepEqual([...dependencies], ['tag:clojure', `item:${B}`, `item:${A}`]);
  const dom = new JSDOM('<main></main>'), opened = [];
  dom.window.document.querySelector('main').append(renderResult(value, { document: dom.window.document, items: base.items, onNavigate: id => opened.push(id) }));
  assert.deepEqual([...dom.window.document.querySelectorAll('li')].map(node => node.textContent), ['Alpha', 'Beta']);
  dom.window.document.querySelector('a').click();
  assert.deepEqual(opened, [B]);
  dom.window.close();
});

test('item reads track the item ID and data wrappers preserve Hiccup-shaped data', () => {
  const base = addItem(emptyKnowledgeBase(), { title: 'Source', body: 'Content' }, { id: A, now: NOW });
  const runtime = createSnippetRuntime({ getItems: () => base.items, scittle: globalThis.scittle });
  const { value, dependencies } = runtime.run(`(loom.core/data [(:title (loom.core/item "${A}")) :strong])`);
  assert.deepEqual([...dependencies], [`item:${A}`]);
  const dom = new JSDOM('<main></main>');
  dom.window.document.querySelector('main').append(renderResult(value, { document: dom.window.document }));
  assert.equal(dom.window.document.querySelector('strong'), null);
  assert.match(dom.window.document.querySelector('pre').textContent, /Source/);
  dom.window.close();
});

test('oversized generated collections fail explicitly instead of being truncated', () => {
  const runtime = createSnippetRuntime({ getItems: () => [], scittle: globalThis.scittle });
  assert.throws(() => runtime.run('(range 1001)'), /limit/i);
});

test('opening never runs a snippet; Run shows a text result at its fence', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const body = 'Before\n\n~~~cljs loom\n(str "<b>literal</b>")\n~~~\n\nAfter';
  const base = addItem(emptyKnowledgeBase(), { title: 'Snippet', body }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  assert.equal(card.querySelector('.snippet-output').textContent, '');
  card.querySelector('.loom-snippet button').click();
  assert.equal(card.querySelector('.snippet-output').textContent, '<b>literal</b>');
  assert.equal(card.querySelector('.snippet-output b'), null);
  assert.match(card.textContent, /Before.*literal.*After/s);
  dom.window.close();
});

test('a failing snippet reports locally and does not prevent its sibling from running', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const body = 'Start\n\n~~~cljs loom\n(no-such-symbol)\n~~~\n\nMiddle\n\n~~~cljs loom\n"Working"\n~~~\n\nEnd';
  const base = addItem(emptyKnowledgeBase(), { title: 'Errors', body }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  const runs = card.querySelectorAll('[data-action="run-snippet"]');
  runs[0].click(); runs[1].click();
  assert.ok(card.querySelector('.loom-snippet [role="alert"]'));
  assert.equal(card.querySelectorAll('.snippet-output')[1].textContent, 'Working');
  assert.match(card.textContent, /Start.*Middle.*End/s);
  dom.window.close();
});
