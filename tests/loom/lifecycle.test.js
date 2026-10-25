import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

test('snippets rerun automatically after item edits while editing exposes the source', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const code = '~~~cljs loom\n"Computed"\n~~~';
  const base = addItem(emptyKnowledgeBase(), { title: 'First', body: code }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  assert.equal(card.querySelector('.snippet-output').textContent, 'Computed');
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Renamed';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(card.querySelector('.snippet-output').textContent, 'Computed');
  card.querySelector('[data-action="edit"]').click();
  assert.match(card.querySelector('[name="body"]').value, /~~~cljs loom\n"Computed"\n~~~/);
  card.querySelector('[name="body"]').value = '~~~cljs loom\n"Changed automatically"\n~~~';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(card.querySelector('.snippet-output').textContent, 'Changed automatically');
  assert.equal(card.querySelector('[data-action="run-snippet"]'), null);
  dom.window.close();
});
