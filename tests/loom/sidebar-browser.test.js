import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';
import { SIDEBAR_PAGE_SIZE, itemsByUpdated, itemsWithTag, pageSlice, recentItems } from '../../loom/js/sidebar-browser.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const C = '550e8400-e29b-41d4-a716-446655440002';
const IDS = [
  A, B, C,
  '550e8400-e29b-41d4-a716-446655440003',
  '550e8400-e29b-41d4-a716-446655440004',
  '550e8400-e29b-41d4-a716-446655440005',
  '550e8400-e29b-41d4-a716-446655440006',
  '550e8400-e29b-41d4-a716-446655440007',
  '550e8400-e29b-41d4-a716-446655440008',
];

function timestamp(minute) {
  return `2026-10-26T00:${String(minute).padStart(2, '0')}:00.000Z`;
}

async function mount({ count = 3, body = index => `Body ${index}`, tags = () => [] } = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = emptyKnowledgeBase();
  for (let index = 0; index < count; index++) {
    base = addItem(base, {
      title: `Item ${index}`,
      body: body(index),
      tags: tags(index),
    }, { id: IDS[index], now: timestamp(index) });
  }
  const app = createLoomApp({
    document: dom.window.document,
    window: dom.window,
    base,
    storage: null,
  });
  return { app, dom, document: dom.window.document };
}

function listedIds(document, selector) {
  return [...document.querySelectorAll(`${selector} button`)]
    .map(button => button.dataset.itemId || button.dataset.browserItemId)
    .filter(Boolean);
}

test('sidebar ordering helpers are deterministic and paginate without losing items', () => {
  const items = [
    { id: B, title: 'B', 'updated-at': timestamp(1), tags: [keyword('shared')] },
    { id: A, title: 'A', 'updated-at': timestamp(2), tags: [keyword('shared'), keyword('other')] },
    { id: C, title: 'C', 'updated-at': timestamp(2), tags: [keyword('other')] },
  ];

  assert.deepEqual(itemsByUpdated(items).map(item => item.id), [A, C, B]);
  assert.deepEqual(recentItems(items, [C, B, A, C, 'missing']).map(item => item.id), [C, B, A]);
  assert.deepEqual(itemsWithTag(items, 'shared').map(item => item.id), [B, A]);
  assert.deepEqual(itemsWithTag(items, ':other').map(item => item.id), [A, C]);
  assert.deepEqual(itemsWithTag(items, ''), []);

  const paged = pageSlice(itemsByUpdated(items), 2, 1);
  assert.deepEqual(paged.items.map(item => item.id), [C]);
  assert.equal(paged.page, 2);
  assert.equal(paged.pageCount, 3);
  assert.equal(paged.total, 3);
  assert.equal(pageSlice(items, 99, SIDEBAR_PAGE_SIZE).page, 1);
  assert.deepEqual(pageSlice([], 1).items, []);
});

test('the sidebar browser shows latest updates by default and keeps recently opened items after close', async () => {
  const { app, dom, document } = await mount({ count: 3 });
  const sidebar = document.querySelector('#sidebar');
  const tabs = [...sidebar.querySelectorAll('[role="tab"]')];

  assert.deepEqual(tabs.map(tab => tab.textContent), ['Updated', 'Opened', 'Search', 'Tag']);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelector('#updated-panel').hidden, false);
  assert.deepEqual(listedIds(document, '#updated-items'), [C, B, A]);

  app.openItem(A);
  app.openItem(C);
  app.openItem(B);
  app.closeItem(B);
  tabs[1].click();

  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelector('#updated-panel').hidden, true);
  assert.equal(document.querySelector('#opened-panel').hidden, false);
  assert.deepEqual(listedIds(document, '#opened-items'), [B, C, A]);
  dom.window.close();
});

test('clicking an item tag opens the Tag page with every matching item', async () => {
  const { app, dom, document } = await mount({
    count: 3,
    tags: index => [keyword(index < 2 ? 'shared' : 'other')],
  });
  app.openItem(A);
  const source = document.querySelector(`#workspace [data-item-id="${A}"]`);
  const tag = source.querySelector('.item-tags button[data-tag="shared"]');

  assert.ok(tag);
  assert.equal(tag.getAttribute('aria-label'), 'Show items tagged :shared');
  tag.click();

  assert.equal(document.querySelector('#tag-tab').getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelector('#tag-panel').hidden, false);
  assert.equal(document.querySelector('#tag-filter-name').textContent, ':shared');
  assert.deepEqual(listedIds(document, '#tag-items'), [B, A]);
  dom.window.close();
});

test('the Tag page paginates matching items and keeps an explicit unselected state', async () => {
  const { app, dom, document } = await mount({ count: 9, tags: () => [keyword('shared')] });
  const tagTab = document.querySelector('#tag-tab');
  tagTab.click();
  assert.equal(document.querySelector('#tag-filter-name').textContent, 'None selected');
  assert.match(document.querySelector('#tag-items').textContent, /Select a tag/);

  app.openItem(A);
  document.querySelector(`#workspace [data-item-id="${A}"] .item-tags button`).click();
  assert.equal(listedIds(document, '#tag-items').length, SIDEBAR_PAGE_SIZE);
  assert.deepEqual(listedIds(document, '#tag-items'), [...IDS].reverse().slice(0, SIDEBAR_PAGE_SIZE));
  document.querySelector('#tag-next').click();
  assert.deepEqual(listedIds(document, '#tag-items'), [A]);
  assert.equal(document.querySelector('#tag-pagination').hidden, false);
  dom.window.close();
});

test('updated, opened, and search lists expose previous/next pagination only when needed', async () => {
  const { app, dom, document } = await mount({ count: 9, body: () => 'needle' });

  assert.equal(listedIds(document, '#updated-items').length, SIDEBAR_PAGE_SIZE);
  assert.equal(document.querySelector('#updated-pagination').hidden, false);
  document.querySelector('#updated-next').click();
  assert.deepEqual(listedIds(document, '#updated-items'), [A]);

  for (const id of IDS) app.openItem(id);
  document.querySelector('#opened-tab').click();
  assert.equal(listedIds(document, '#opened-items').length, SIDEBAR_PAGE_SIZE);
  assert.deepEqual(listedIds(document, '#opened-items'), [...IDS].reverse().slice(0, SIDEBAR_PAGE_SIZE));
  document.querySelector('#opened-next').click();
  assert.deepEqual(listedIds(document, '#opened-items'), [A]);

  document.querySelector('#search-tab').click();
  const search = document.querySelector('#loom-search');
  search.value = 'needle';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(listedIds(document, '#search-results').length, SIDEBAR_PAGE_SIZE);
  assert.equal(document.querySelector('#search-pagination').hidden, false);
  document.querySelector('#search-next').click();
  assert.deepEqual(listedIds(document, '#search-results'), [IDS[8]]);

  search.value = '';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#search-pagination').hidden, true);
  assert.match(document.querySelector('#search-results').textContent, /Type to search/);
  dom.window.close();
});

test('focusing search programmatically activates its browser page', async () => {
  const { app, dom, document } = await mount({ count: 3 });
  app.openItem(A);
  app.closeAll();

  assert.equal(document.querySelector('#search-tab').getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelector('#search-panel').hidden, false);
  assert.equal(document.activeElement, document.querySelector('#loom-search'));
  dom.window.close();
});

test('editing and deleting items refresh the latest-updated list', async () => {
  const { app, dom, document } = await mount({ count: 3 });
  app.openItem(A);
  const card = document.querySelector(`#workspace [data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="body"]').value = 'Updated body';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(listedIds(document, '#updated-items')[0], A);

  app.deleteItem(C);
  document.querySelector('[role="dialog"] [data-action="confirm-delete"]').click();
  assert.equal(listedIds(document, '#updated-items').includes(C), false);
  dom.window.close();
});
