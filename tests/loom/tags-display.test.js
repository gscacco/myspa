import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount() {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), {
    title: 'Tagged', body: 'Body', tags: [keyword('clojure'), keyword('knowledge-management')],
  }, { id: A, now: NOW });
  base = addItem(base, { title: 'Untagged', body: 'Plain body' }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  return { app, dom, document: dom.window.document };
}

test('tags are visible in presentation mode and update after editing', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A);
  const card = document.querySelector(`[data-item-id="${A}"]`);
  let tags = card.querySelector('.item-content > .item-tags');
  assert.ok(tags);
  assert.equal(tags.getAttribute('aria-label'), 'Tags');
  assert.deepEqual([...tags.querySelectorAll('li')].map(tag => tag.textContent), [':clojure', ':knowledge-management']);

  card.querySelector('[data-action="edit"]').click();
  assert.equal(card.querySelector('.item-tags'), null);
  assert.equal(card.querySelector('[name="tags"]').value, 'clojure knowledge-management');

  card.querySelector('[name="tags"]').value = 'clojure updated';
  card.querySelector('[data-action="apply"]').click();
  tags = card.querySelector('.item-content > .item-tags');
  assert.deepEqual([...tags.querySelectorAll('li')].map(tag => tag.textContent), [':clojure', ':updated']);
  assert.deepEqual(app.getBase().items.find(item => item.id === A).tags.map(tag => tag.name), ['clojure', 'updated']);

  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[data-action="cancel"]').click();
  assert.deepEqual([...card.querySelectorAll('.item-tags li')].map(tag => tag.textContent), [':clojure', ':updated']);

  app.openItem(B);
  assert.equal(document.querySelector(`[data-item-id="${B}"] .item-tags`), null);
  dom.window.close();
});
