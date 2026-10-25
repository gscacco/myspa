import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

test('search Enter opens a result and closing a focused card restores focus', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Alpha' }, { id: A, now: NOW });
  base = addItem(base, { title: 'Beta' }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  const search = dom.window.document.querySelector('#loom-search');
  search.value = 'Alpha'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(app.getBase().workspace['open-ids'], [A]);
  app.openItem(B);
  const close = dom.window.document.querySelector(`[data-item-id="${B}"] [data-action="close"]`);
  close.focus(); close.click();
  assert.equal(dom.window.document.activeElement?.dataset.itemId, A);
  assert.equal(dom.window.document.querySelector('#loom-status').getAttribute('aria-live'), 'polite');
  dom.window.close();
});
