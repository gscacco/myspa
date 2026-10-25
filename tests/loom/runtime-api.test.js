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

function base() {
  let value = addItem(emptyKnowledgeBase(), { title: 'Alpha', body: 'First body', tags: [keyword('clojure')] }, { id: A, now: NOW });
  return addItem(value, { title: 'Beta', body: 'Second body' }, { id: B, now: NOW });
}

test('the canonical loom namespace exposes item queries, data, and stable links', () => {
  const runtime = createSnippetRuntime({ getItems: () => base().items, scittle: globalThis.scittle });
  const source = `[(mapv :title (loom/items))
            (:body (loom/item "${A}"))
            (loom/link "${A}")
            (loom/data [:strong "literal Hiccup"])]`;
  const { value, dependencies } = runtime.run(source);
  assert.deepEqual(value[0], ['Alpha', 'Beta']);
  assert.equal(value[1], 'First body');
  assert.deepEqual([...dependencies], ['index', `item:${A}`]);

  const dom = new JSDOM('<main></main>');
  const main = dom.window.document.querySelector('main');
  main.append(renderResult(value[2], { document: dom.window.document, items: base().items }));
  assert.equal(dom.window.document.querySelector('a').textContent, 'Alpha');
  assert.equal(dom.window.document.querySelector('a').getAttribute('href'), `loom:${A}`);
  main.append(renderResult(value[3], { document: dom.window.document, items: base().items }));
  assert.equal(dom.window.document.querySelector('strong'), null);
  assert.match(dom.window.document.querySelector('pre').textContent, /literal Hiccup/);
  dom.window.close();
});

test('loom.core remains a compatibility surface for existing snippets', () => {
  const runtime = createSnippetRuntime({ getItems: () => base().items, scittle: globalThis.scittle });
  const { value } = runtime.run('[(count (loom.core/items {:tag :clojure})) (:title (loom.core/item "' + A + '"))]');
  assert.deepEqual(value, [1, 'Alpha']);
});

test('link dependencies refresh dynamic titles and missing targets without guessing by title', () => {
  const runtime = createSnippetRuntime({ getItems: () => base().items, scittle: globalThis.scittle });
  const { value, dependencies } = runtime.run(`[(loom/link "${A}") (loom/link "${B.replace(/.$/, '2')}")]`);
  assert.deepEqual([...dependencies], [`item:${A}`, `item:${B.replace(/.$/, '2')}`]);
  const dom = new JSDOM('<main></main>');
  dom.window.document.querySelector('main').append(renderResult(value, { document: dom.window.document, items: base().items }));
  assert.equal(dom.window.document.querySelector('a').textContent, 'Alpha');
  assert.equal(dom.window.document.querySelector('.unresolved-link').dataset.loomTarget, B.replace(/.$/, '2'));
  dom.window.close();
});

test('invalid IDs are rejected instead of becoming unresolved or title-based links', () => {
  const runtime = createSnippetRuntime({ getItems: () => base().items, scittle: globalThis.scittle });
  assert.throws(() => runtime.run('(loom/link "Alpha")'), /UUID/i);
});

test('dynamic links follow the shared workspace rules and refresh when their target changes', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let value = addItem(emptyKnowledgeBase(), { title: 'Target', body: 'Destination' }, { id: A, now: NOW });
  value = addItem(value, { title: 'Query', body: `~~~clojurescript\n(loom/link "${A}")\n~~~` }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base: value, confirmDelete: () => true });
  app.openItem(B);
  const query = dom.window.document.querySelector(`[data-item-id="${B}"]`);
  query.querySelector('[data-action="run-snippet"]').click();
  assert.equal(query.querySelector('.snippet-output a').textContent, 'Target');
  query.querySelector('.snippet-output a').click();
  assert.deepEqual(app.getBase().workspace['open-ids'], [A, B]);

  const target = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  target.querySelector('[data-action="edit"]').click();
  target.querySelector('[name="title"]').value = 'Renamed target';
  target.querySelector('[data-action="apply"]').click();
  assert.equal(query.querySelector('.snippet-output a').textContent, 'Renamed target');

  target.querySelector('[data-action="delete"]').click();
  assert.equal(query.querySelector('.snippet-output a'), null);
  assert.equal(query.querySelector('.snippet-output .unresolved-link').dataset.loomTarget, A);
  dom.window.close();
});

test('direct Hiccup loom links also rerun when the target title changes', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let value = addItem(emptyKnowledgeBase(), { title: 'Target', body: '' }, { id: A, now: NOW });
  value = addItem(value, { title: 'Query', body: `~~~clojurescript\n[:a {:href "loom:${A}"}]\n~~~` }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base: value });
  app.openItem(B);
  const query = dom.window.document.querySelector(`[data-item-id="${B}"]`);
  query.querySelector('[data-action="run-snippet"]').click();
  assert.equal(query.querySelector('.snippet-output a').textContent, 'Target');

  app.openItem(A);
  const target = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  target.querySelector('[data-action="edit"]').click();
  target.querySelector('[name="title"]').value = 'Renamed target';
  target.querySelector('[data-action="apply"]').click();
  assert.equal(query.querySelector('.snippet-output a').textContent, 'Renamed target');
  dom.window.close();
});
