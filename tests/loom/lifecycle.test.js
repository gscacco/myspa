import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

test('title edits keep an authorized snippet; Markdown edits require Run again', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const code = '~~~cljs loom\n"Computed"\n~~~';
  const base = addItem(emptyKnowledgeBase(), { title: 'First', body: code }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('.loom-snippet button').click();
  assert.equal(card.querySelector('.snippet-output').textContent, 'Computed');
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Renamed';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(card.querySelector('.snippet-output').textContent, 'Computed');
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="body"]').value = code + '\n\nChanged';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(card.querySelector('.snippet-output').textContent, '');
  assert.equal(card.querySelector('.loom-snippet button').textContent, 'Run trusted code');
  dom.window.close();
});
