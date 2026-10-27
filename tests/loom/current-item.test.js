import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';
import { createSnippetRuntime } from '../../loom/js/runtime.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-27T00:00:00.000Z';

function base() {
  let value = addItem(emptyKnowledgeBase(), { title: 'Host', body: 'Source' }, { id: A, now: NOW });
  return addItem(value, { title: 'Other', body: 'Destination' }, { id: B, now: NOW });
}

test('the runtime exposes the executing item and its ID only when context is supplied', () => {
  const runtime = createSnippetRuntime({ getItems: () => base().items, scittle: globalThis.scittle });
  const result = runtime.run('[(loom/current-item-id) (:id (loom/current-item)) (:title (loom.core/current-item))]', {
    currentItemId: A,
  });
  assert.deepEqual(result.value, [A, A, 'Host']);
  assert.deepEqual([...result.dependencies], [`item:${A}`]);
  const absent = runtime.run('[(loom/current-item-id) (loom/current-item)]');
  assert.deepEqual(absent.value, [null, null]);
  assert.deepEqual([...absent.dependencies], []);
});

async function mount(body) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const app = createLoomApp({
    document: dom.window.document,
    window: dom.window,
    base: addItem(emptyKnowledgeBase(), { title: 'Host', body }, { id: A, now: NOW }),
  });
  await app.ready;
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  return { app, dom, card };
}

test('automatic snippet execution receives its hosting item context', async () => {
  const { dom, card } = await mount('~~~clojurescript\n(loom/current-item-id)\n~~~');
  assert.equal(card.querySelector('.snippet-output').textContent, A);
  dom.window.close();
});

test('Ctrl+Enter evaluation receives the same hosting item context', async () => {
  const { dom, card } = await mount('~~~clojurescript\nnil\n~~~');
  card.querySelector('[data-action="edit-snippet"]').click();
  const textarea = card.querySelector('.snippet-editor textarea');
  textarea.value = '[(loom/current-item-id) (:title (loom/current-item))]';
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  const output = card.querySelector('.snippet-evaluation-output');
  assert.match(output.textContent, new RegExp(A));
  assert.match(output.textContent, /Host/);
  dom.window.close();
});
