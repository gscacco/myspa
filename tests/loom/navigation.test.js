import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

test('following a Markdown link retains the source card and source edits refresh transclusion', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Parent', body: `[Open](loom:${B})\n\n![[item:${B}]]` }, { id: A, now: NOW });
  base = addItem(base, { title: 'Source', body: 'Old text' }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const parent = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  parent.querySelector('a').click();
  assert.deepEqual(app.getBase().workspace['open-ids'], [B, A]);
  assert.equal(dom.window.document.querySelector(`[data-item-id="${A}"]`), parent);
  const source = dom.window.document.querySelector(`[data-item-id="${B}"]`);
  source.querySelector('[data-action="edit"]').click();
  source.querySelector('[name="body"]').value = 'New text';
  source.querySelector('[data-action="apply"]').click();
  assert.match(parent.querySelector('.transclusion').textContent, /New text/);
  assert.equal(app.getBase().items.find(item => item.id === A).body.includes('Old text'), false);
  assert.deepEqual(app.getBase().workspace['open-ids'], [B, A]);
  assert.equal(parent.querySelector('.transclusion button'), null);
  dom.window.close();
});

test('transclusion exposes no source action buttons or implicit editing', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Parent', body: `![[item:${B}#detail-2]]` }, { id: A, now: NOW });
  const sourceBody = '# Detail\n\nFirst\n\n# Detail\n\nSecond';
  base = addItem(base, { title: 'Source', body: sourceBody }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const parent = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  const embed = parent.querySelector('.transclusion');
  assert.match(embed.textContent, /From Source/);
  assert.match(embed.textContent, /Second/);
  assert.equal(embed.querySelectorAll('button').length, 0);
  assert.deepEqual(app.getBase().workspace['open-ids'], [A]);
  assert.equal(dom.window.document.querySelector(`[data-item-id="${B}"]`), null);
  assert.equal(dom.window.document.querySelector(`[data-item-id="${A}"]`), parent);
  dom.window.close();
});
