import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount(body) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const base = addItem(emptyKnowledgeBase(), { title: 'Automatic', body }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  return { app, dom, document: dom.window.document, card: dom.window.document.querySelector(`[data-item-id="${A}"]`) };
}

test('rendered items execute snippets immediately and hide source code outside editing', async () => {
  const body = 'Before\n\n~~~clojurescript\n(str "automatic-" (+ 1 2))\n~~~\n\nAfter';
  const { dom, card } = await mount(body);
  assert.equal(card.querySelector('.snippet-output').textContent, 'automatic-3');
  assert.equal(card.querySelector('.loom-snippet pre').hidden, true);
  assert.equal(card.querySelector('[data-action="run-snippet"]'), null);
  assert.match(card.textContent, /Before.*automatic-3.*After/s);
  dom.window.close();
});

test('item editing shows executable source and applying a change reruns it automatically', async () => {
  const { app, dom, card } = await mount('~~~clojurescript\n"first"\n~~~');
  card.querySelector('[data-action="edit"]').click();
  const textarea = card.querySelector('[name="body"]');
  assert.match(textarea.value, /~~~clojurescript\n"first"\n~~~/);
  textarea.value = '~~~clojurescript\n"second"\n~~~';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(card.querySelector('.snippet-output').textContent, 'second');
  assert.equal(app.getBase().items[0].body, '~~~clojurescript\n"second"\n~~~');
  dom.window.close();
});

test('automatic execution contains failures to their own block', async () => {
  const body = '~~~clojurescript\n(no-such-symbol)\n~~~\n\n~~~clojurescript\n"Working"\n~~~';
  const { dom, card } = await mount(body);
  assert.ok(card.querySelector('.loom-snippet [role="alert"]'));
  assert.equal(card.querySelectorAll('.snippet-output')[1].textContent, 'Working');
  dom.window.close();
});
