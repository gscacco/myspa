import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase, writeKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount({ open = A, ...options } = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = emptyKnowledgeBase();
  base = addItem(base, { title: 'Alpha', body: 'Body' }, { id: A, now: NOW });
  base = addItem(base, { title: 'Beta', body: 'Other' }, { id: B, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base, ...options });
  if (open) app.openItem(open);
  return { app, dom, document: dom.window.document };
}

function actionNames(card) {
  return [...card.querySelectorAll(':scope > header .card-actions button')].map(button => button.dataset.action);
}

test('the sidebar owns search and the New Item button while the workspace stays separate', async () => {
  const { dom, document } = await mount();
  const sidebar = document.querySelector('#sidebar');
  assert.ok(sidebar);
  assert.equal(sidebar.querySelector('#loom-search')?.id, 'loom-search');
  assert.equal(sidebar.querySelector('#search-results')?.id, 'search-results');
  const create = sidebar.querySelector('#new-item');
  assert.equal(create.title, 'New Item');
  assert.equal(create.getAttribute('aria-label'), 'New Item');
  assert.ok(create.querySelector('svg'));
  assert.equal(sidebar.querySelector('#workspace'), null);
  assert.ok(document.querySelector('#workspace'));
  dom.window.close();
});

test('the workspace toolbar closes every open item with an SVG action', async () => {
  const { app, dom, document } = await mount();
  const closeAll = document.querySelector('.toolbar #close-all');
  assert.ok(closeAll);
  assert.ok(closeAll.querySelector('svg'));
  assert.equal(closeAll.textContent.trim(), '');
  assert.equal(closeAll.title, 'Close all items');
  assert.equal(closeAll.getAttribute('aria-label'), 'Close all items');

  app.openItem(B);
  assert.equal(closeAll.disabled, false);
  closeAll.click();

  assert.deepEqual(app.getBase().workspace, { 'open-ids': [], 'active-id': null });
  assert.equal(document.querySelectorAll('#workspace [data-item-id]').length, 0);
  assert.match(document.querySelector('#workspace').textContent, /Open an item/);
  assert.equal(app.getBase().items.length, 2);
  assert.equal(document.activeElement, document.querySelector('#loom-search'));
  app.back();
  assert.deepEqual(app.getBase().workspace['open-ids'], [B, A]);
  dom.window.close();
});

test('closing all items can preserve unsaved edits', async () => {
  let confirmations = 0;
  const { app, dom, document } = await mount({ confirmCloseAll: () => { confirmations += 1; return false; } });
  const card = document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  const body = card.querySelector('[name="body"]');
  body.value = 'Unsaved body';

  document.querySelector('#close-all').click();

  assert.equal(confirmations, 1);
  assert.deepEqual(app.getBase().workspace['open-ids'], [A]);
  assert.equal(document.querySelector(`[data-item-id="${A}"] [name="body"]`).value, 'Unsaved body');
  dom.window.close();
});

test('discarding a draft uses the in-app delete confirmation', async () => {
  const { app, dom, document } = await mount();
  document.querySelector('#new-item').click();
  const draft = document.querySelector('#workspace [data-item-id]');
  const draftId = draft.dataset.itemId;
  let nativeConfirmations = 0;
  dom.window.confirm = () => { nativeConfirmations += 1; return true; };

  draft.querySelector('[data-action="delete"]').click();
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /Discard draft\?/);
  assert.equal(nativeConfirmations, 0);
  assert.ok(document.querySelector('#workspace [data-item-id]'));

  dialog.querySelector('[data-action="cancel-delete"]').click();
  assert.ok(document.querySelector('#workspace [data-item-id]'));
  assert.equal(app.getBase().items.length, 2);

  document.querySelector('#workspace [data-item-id] [data-action="delete"]').click();
  document.querySelector('[role="dialog"] [data-action="confirm-delete"]').click();
  assert.equal(document.querySelector(`[data-item-id="${draftId}"]`), null);
  assert.equal(app.getBase().items.length, 2);
  assert.equal(nativeConfirmations, 0);
  dom.window.close();
});

test('the sidebar setup page owns EDN import and export without losing search state', async () => {
  const { dom, document } = await mount();
  const sidebar = document.querySelector('#sidebar');
  const itemsPage = sidebar.querySelector('#items-page');
  const setupPage = sidebar.querySelector('#setup-page');
  const setupButton = sidebar.querySelector('#setup-button');
  const search = sidebar.querySelector('#loom-search');
  assert.ok(itemsPage);
  assert.ok(setupPage);
  assert.ok(setupButton);
  assert.equal(setupPage.hidden, true);
  assert.equal(itemsPage.hidden, false);
  assert.equal(setupButton.getAttribute('aria-controls'), 'setup-page');
  assert.equal(setupButton.getAttribute('aria-expanded'), 'false');
  assert.equal(setupPage.querySelector('#save-edn')?.textContent, 'Save EDN');
  assert.equal(setupPage.querySelector('#import-edn')?.textContent, 'Import EDN');
  assert.equal(setupPage.querySelector('#export-files')?.textContent, 'Export files');
  assert.equal(setupPage.querySelector('#import-files')?.textContent, 'Import files');
  assert.equal(document.querySelector('.app-header #save-edn'), null);
  assert.equal(document.querySelector('.app-header #import-edn'), null);

  search.value = 'Alpha';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const resultCount = sidebar.querySelectorAll('#search-results button').length;
  setupButton.click();
  assert.equal(setupPage.hidden, false);
  assert.equal(itemsPage.hidden, true);
  assert.equal(setupButton.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, setupPage.querySelector('#save-edn'));

  setupButton.click();
  assert.equal(setupPage.hidden, true);
  assert.equal(itemsPage.hidden, false);
  assert.equal(search.value, 'Alpha');
  assert.equal(sidebar.querySelectorAll('#search-results button').length, resultCount);
  assert.equal(document.activeElement, search);

  setupButton.click();
  setupPage.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(setupPage.hidden, true);
  assert.equal(document.activeElement, search);
  dom.window.close();
});

test('item editor fields use a plain font weight inside bold labels', async () => {
  const css = await readFile(new URL('../../loom/css/style.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><form class="item-form"><label>Title<input name="title"></label><label>Markdown<textarea name="body"></textarea></label></form>`);
  const { document } = dom.window;
  assert.equal(dom.window.getComputedStyle(document.querySelector('[name="title"]')).fontWeight, '400');
  assert.equal(dom.window.getComputedStyle(document.querySelector('[name="body"]')).fontWeight, '400');
  dom.window.close();
});

test('image previews add no second frame inside cards or transclusions', async () => {
  const css = await readFile(new URL('../../loom/css/style.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><figure class="image-item"></figure><section class="transclusion"><figure class="image-transclusion"></figure></section>`);
  const { document } = dom.window;
  for (const selector of ['.image-item', '.image-transclusion']) {
    const style = dom.window.getComputedStyle(document.querySelector(selector));
    assert.equal(style.borderTopWidth, '0px', `${selector} must not add an inner border`);
    assert.equal(style.paddingTop, '0px', `${selector} must not add an inner frame`);
    assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)', `${selector} must not add an inner background`);
  }
  dom.window.close();
});

test('item actions use labelled SVG buttons in the upper-right and switch by mode', async () => {
  const { dom, document } = await mount();
  const card = document.querySelector(`[data-item-id="${A}"]`);
  assert.deepEqual(actionNames(card), ['edit', 'close', 'delete']);
  for (const button of card.querySelectorAll(':scope > header .card-actions button')) {
    assert.ok(button.querySelector('svg'));
    assert.ok(button.title);
    assert.ok(button.getAttribute('aria-label'));
  }
  assert.deepEqual([
    card.querySelector('[data-action="edit"]').title,
    card.querySelector('[data-action="close"]').title,
    card.querySelector('[data-action="delete"]').title,
  ], ['Edit', 'Close', 'Delete']);
  assert.equal(card.querySelector('[data-action="delete"]').classList.contains('danger'), true);
  assert.equal(card.querySelector('[data-action="close"]').classList.contains('danger'), false);

  card.querySelector('[data-action="edit"]').click();
  assert.deepEqual(actionNames(card), ['apply', 'cancel', 'delete']);
  assert.equal(card.querySelectorAll('.item-form > button').length, 0);
  assert.deepEqual([
    card.querySelector('[data-action="apply"]').title,
    card.querySelector('[data-action="cancel"]').title,
    card.querySelector('[data-action="delete"]').title,
  ], ['Apply', 'Cancel Changes', 'Delete']);
  for (const button of card.querySelectorAll('.card-actions button')) assert.ok(button.querySelector('svg'));
  card.querySelector('[data-action="cancel"]').click();
  assert.deepEqual(actionNames(card), ['edit', 'close', 'delete']);
  dom.window.close();
});

test('a new item stays an unsaved draft until Apply, then appears once at the top', async () => {
  const { app, dom, document } = await mount();
  document.querySelector('#new-item').click();
  assert.equal(app.getBase().items.length, 2);
  let draft = document.querySelector('#workspace [data-item-id]');
  assert.ok(draft.querySelector('.item-form'));
  assert.equal(app.isDirty(), true);
  draft.querySelector('[name="title"]').value = 'Created';
  draft.querySelector('[name="tags"]').value = ':clojure';
  draft.querySelector('[name="body"]').value = 'New body';
  draft.querySelector('[data-action="apply"]').click();

  assert.equal(app.getBase().items.length, 3);
  assert.equal(app.getBase().items.filter(item => item.title === 'Created').length, 1);
  const created = app.getBase().items.find(item => item.title === 'Created');
  const card = document.querySelector(`[data-item-id="${created.id}"]`);
  assert.ok(card);
  assert.equal(card.querySelector('.item-form'), null);
  assert.equal(document.querySelector('#workspace [data-item-id]'), card);
  assert.deepEqual(actionNames(card), ['edit', 'close', 'delete']);
  dom.window.close();
});

test('cancelling a new item discards the draft without touching the workspace', async () => {
  const { app, dom, document } = await mount({ open: null });
  document.querySelector('#new-item').click();
  assert.equal(app.isDirty(), true);
  assert.equal(document.querySelectorAll('#workspace [data-item-id]').length, 1);
  document.querySelector('.card-actions [data-action="cancel"]').click();
  assert.equal(app.getBase().items.length, 2);
  assert.deepEqual(app.getBase().workspace, { 'open-ids': [], 'active-id': null });
  assert.equal(document.querySelectorAll('#workspace [data-item-id]').length, 0);
  assert.equal(app.isDirty(), false);
  dom.window.close();
});

test('applying an edit updates once and cancelling restores the saved state', async () => {
  const { app, dom, document } = await mount();
  const card = document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Alpha updated';
  card.querySelector('[name="body"]').value = 'Changed body';
  card.querySelector('[data-action="apply"]').click();

  assert.equal(app.getBase().items.length, 2);
  assert.equal(app.getBase().items.filter(item => item.id === A).length, 1);
  assert.equal(app.getBase().items.find(item => item.id === A).title, 'Alpha updated');
  assert.equal(card.querySelector('h2').textContent, 'Alpha updated');

  card.querySelector('[data-action="edit"]').click();
  card.querySelector('[name="title"]').value = 'Discard this change';
  card.querySelector('[name="body"]').value = 'Discard this body';
  card.querySelector('[data-action="cancel"]').click();

  assert.equal(app.getBase().items.find(item => item.id === A).title, 'Alpha updated');
  assert.equal(app.getBase().items.find(item => item.id === A).body, 'Changed body');
  assert.equal(card.querySelector('h2').textContent, 'Alpha updated');
  assert.equal(card.querySelector('.item-form'), null);
  dom.window.close();
});

test('title editing happens in place in the card header', async () => {
  const { app, dom, document } = await mount();
  const card = document.querySelector(`[data-item-id="${A}"]`);
  const title = card.querySelector('h2 .item-title-button');
  assert.ok(title);

  title.click();
  const form = card.querySelector('.item-form');
  const input = card.querySelector('header [name="title"]');
  assert.ok(input);
  assert.equal(form.querySelector('[name="title"]'), null);
  assert.equal(form.elements.title, input);
  assert.equal(document.activeElement, input);

  input.value = 'Alpha in place';
  card.querySelector('[data-action="apply"]').click();
  assert.equal(card.querySelector('h2').textContent, 'Alpha in place');
  assert.equal(app.getBase().items.find(item => item.id === A).title, 'Alpha in place');

  document.querySelector('#new-item').click();
  const draft = document.querySelector('#workspace [data-item-id]');
  const draftForm = draft.querySelector('.item-form');
  assert.ok(draft.querySelector('header [name="title"]'));
  assert.equal(draftForm.querySelector('[name="title"]'), null);
  assert.equal(draftForm.elements.title, draft.querySelector('header [name="title"]'));
  dom.window.close();
});

test('requesting another new item keeps the existing draft instead of discarding it', async () => {
  const { app, dom, document } = await mount();
  const create = document.querySelector('#new-item');
  create.click();
  const draft = document.querySelector('#workspace [data-item-id]');
  draft.querySelector('[name="title"]').value = 'Unapplied title';
  create.click();

  assert.equal(app.getBase().items.length, 2);
  assert.equal(document.querySelectorAll('#workspace [data-item-id]').length, 2);
  assert.equal(document.querySelector('#workspace [data-item-id]').querySelector('[name="title"]').value, 'Unapplied title');
  assert.match(document.querySelector('#loom-status').textContent, /Apply or cancel/);
  dom.window.close();
});

test('import restores the saved workspace order and drops an unsaved draft', async () => {
  const { app, dom, document } = await mount({ confirmReplace: () => true });
  document.querySelector('#new-item').click();
  const imported = app.getBase();
  imported.workspace = { 'open-ids': [B, A], 'active-id': B };
  const source = writeKnowledgeBase(imported);

  assert.equal(app.importEDN(source), true);
  assert.deepEqual(app.getBase().workspace['open-ids'], [B, A]);
  assert.equal(document.querySelector('#workspace [data-item-id]').dataset.itemId, B);
  assert.equal(document.querySelectorAll('#workspace [data-item-id]').length, 2);
  assert.equal(app.isDirty(), false);
  dom.window.close();
});
