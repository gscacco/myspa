import { test } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createLoomApp } from '../../loom/js/app.js';
import { createMemoryAttachmentStore } from '../../loom/js/attachments.js';

async function mount(options = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  dom.window.URL.createObjectURL = blob => `blob:${blob.type}:${blob.size}`;
  dom.window.URL.revokeObjectURL = () => {};
  const store = options.attachmentStore || createMemoryAttachmentStore();
  const app = createLoomApp({ document: dom.window.document, window: dom.window, attachmentStore: store, ...options });
  await app.ready;
  return { app, dom, document: dom.window.document, store };
}

async function eventually(assertion) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await assertion(); } catch { await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  return assertion();
}

function pasteFile(dom, target, file) {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
  });
  target.dispatchEvent(event);
  return event;
}

test('pasting a screenshot on the page creates one dedicated image item', async () => {
  const { app, dom, document, store } = await mount();
  document.querySelector('#new-item').click();
  const draft = document.querySelector('#workspace [data-item-id]');
  const body = draft.querySelector('[name="body"]');
  body.value = 'Draft remains untouched';
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  const event = pasteFile(dom, document.body, file);
  assert.equal(event.defaultPrevented, true);

  await eventually(() => assert.equal(app.getBase().items.filter(item => item.kind?.name === 'image').length, 1));
  const [saved] = await store.list();
  assert.equal(saved.name, 'shot.png');
  assert.equal(saved.type, 'image/png');
  assert.equal(saved.blob.size, 4);
  assert.equal(body.value, 'Draft remains untouched');

  const created = app.getBase().items.find(item => item.kind?.name === 'image');
  assert.equal(created.body, '');
  assert.equal(created['attachment-id'], saved.id);
  assert.equal(created.title, `Screenshot: item:${created.id}`);
  const preview = document.querySelector(`[data-item-id="${created.id}"]`);
  assert.ok(preview.classList.contains('image-item-card'));
  const image = preview.querySelector('.image-item img');
  assert.match(image.src, /^blob:image\/png:4$/);
  assert.equal(preview.querySelector('.image-item').dataset.loomFile, saved.id);
  assert.equal(document.querySelectorAll('.image-item img').length, 1);

  body.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  body.value = 'Draft [[file:';
  body.setSelectionRange(body.value.length, body.value.length);
  body.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(draft.querySelector('.link-completion').textContent, /No saved files/);
  body.value = `![[file:${saved.id}]]`;
  body.setSelectionRange(body.value.length, body.value.length);
  body.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  draft.querySelector('[data-action="apply"]').click();
  const note = document.querySelector(`[data-item-id="${app.getBase().items.find(item => item.kind?.name !== 'image').id}"]`);
  assert.equal(note.querySelector('img'), null);
  assert.match(note.textContent, /Missing file/);
  assert.equal(document.querySelectorAll('.image-item img').length, 1);
  dom.window.close();
});

test('pasting a non-image file on the page does not create an image item', async () => {
  const { app, dom, document, store } = await mount();
  const event = pasteFile(dom, document.body, new File(['notes'], 'notes.txt', { type: 'text/plain' }));
  assert.equal(event.defaultPrevented, false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.getBase().items.length, 0);
  assert.equal((await store.list()).length, 0);
  dom.window.close();
});

test('the item toolbar attaches ordinary files and references them as downloads', async () => {
  const { app, dom, document, store } = await mount();
  document.querySelector('#new-item').click();
  const card = document.querySelector('#workspace [data-item-id]');
  card.querySelector('[name="title"]').value = 'File';
  const input = card.querySelector('[data-attachment-input]');
  assert.equal(card.querySelector('[data-attachment-action="attach-file"]').title, 'Attach file');
  const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const body = card.querySelector('[name="body"]');
  await eventually(() => assert.match(body.value, /^\[\[file:[0-9a-f-]{36}\]\]$/i));
  const [saved] = await store.list();
  assert.equal(saved.name, 'notes.txt');

  card.querySelector('[data-action="apply"]').click();
  const created = app.getBase().items[0];
  const link = document.querySelector(`[data-item-id="${created.id}"] a.loom-file-link`);
  assert.equal(link.textContent, 'notes.txt');
  assert.equal(link.download, 'notes.txt');
  dom.window.close();
});

test('attachment bundles export from Setup and import into another store', async () => {
  let exported;
  const first = await mount({
    saveAttachmentFile: async (source, filename) => { exported = { source, filename }; return true; },
  });
  pasteFile(first.dom, first.document.body, new File(['image'], 'paste.png', { type: 'image/png' }));
  await eventually(() => assert.equal(first.app.getBase().items.length, 1));
  const source = await first.app.exportAttachments();
  assert.equal(source, exported.source);
  assert.equal(exported.filename, 'loom-files.json');

  const secondStore = createMemoryAttachmentStore();
  const second = await mount({
    attachmentStore: secondStore,
    chooseAttachmentFile: async () => ({ text: async () => source }),
  });
  assert.equal(await second.app.importAttachments(), 1);
  assert.equal((await secondStore.list())[0].name, 'paste.png');
  first.dom.window.close(); second.dom.window.close();
});

test('stored attachments reload into image previews on a new app instance', async () => {
  const store = createMemoryAttachmentStore();
  const first = await mount({ attachmentStore: store });
  pasteFile(first.dom, first.document.body, new File(['image'], 'persisted.png', { type: 'image/png' }));
  await eventually(() => assert.equal(first.app.getBase().items.length, 1));
  const base = first.app.getBase();

  const second = await mount({ attachmentStore: store, base });
  const card = second.document.querySelector('#workspace [data-item-id]');
  assert.equal(card.querySelector('h2').textContent, `Screenshot: item:${base.items[0].id}`);
  assert.ok(card.querySelector('.image-item img'));
  first.dom.window.close(); second.dom.window.close();
});

test('deleting an image item removes its private attachment', async () => {
  const { app, dom, document, store } = await mount();
  pasteFile(dom, document.body, new File(['image'], 'private.png', { type: 'image/png' }));
  await eventually(() => assert.equal(app.getBase().items.length, 1));
  const item = app.getBase().items[0];
  document.querySelector(`[data-item-id="${item.id}"] [data-action="delete"]`).click();
  document.querySelector('[data-action="confirm-delete"]').click();
  await eventually(async () => assert.equal((await store.list()).length, 0));
  dom.window.close();
});
