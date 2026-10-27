import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown } from '../../loom/js/render.js';
import { createIndexedDBAttachmentStore, createMemoryAttachmentStore } from '../../loom/js/attachments.js';

const FILE = '660e8400-e29b-41d4-a716-446655440000';
const MISSING = '660e8400-e29b-41d4-a716-446655440001';

function context(attachments = []) {
  const dom = new JSDOM('<main></main>');
  return {
    dom,
    document: dom.window.document,
    items: [],
    attachments: new Map(attachments.map(attachment => [attachment.id, attachment])),
    attachmentURL: attachment => `blob:${attachment.id}`,
    dependencies: new Set(),
  };
}

test('attachment references render safe image previews and downloadable file links', () => {
  const ctx = context([
    { id: FILE, name: 'diagram.png', type: 'image/png', size: 3 },
    { id: MISSING, name: 'notes.txt', type: 'text/plain', size: 4 },
  ]);
  const host = ctx.document.querySelector('main');
  host.append(renderMarkdown(`![[file:${FILE}]]\n\n[[file:${MISSING}]]`, ctx));
  const image = host.querySelector('img');
  assert.equal(image.src, `blob:${FILE}`);
  assert.equal(image.alt, 'diagram.png');
  assert.equal(image.closest('.loom-image')?.dataset.loomFile, FILE);
  const link = host.querySelector('a.loom-file-link');
  assert.equal(link.textContent, 'notes.txt');
  assert.equal(link.href, `blob:${MISSING}`);
  assert.equal(link.download, 'notes.txt');
  ctx.dom.window.close();
});

test('missing attachments and file syntax inside code stay inert or diagnostic', () => {
  const ctx = context();
  const host = ctx.document.querySelector('main');
  host.append(renderMarkdown([
    `[[file:${MISSING}]]`,
    `![[file:${MISSING}]]`,
    `inline \`[[file:${FILE}]]\``,
    '~~~clojure',
    `![[file:${FILE}]]`,
    '~~~',
  ].join('\n\n'), ctx));
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelectorAll('.unresolved-file').length, 2);
  assert.equal(host.querySelectorAll('.render-error').length, 2);
  assert.match(host.textContent, /Missing file/);
  assert.equal(host.querySelectorAll('code')[1].textContent.trim(), `![[file:${FILE}]]`);
  ctx.dom.window.close();
});

test('escaped file embeds remain literal instead of loading an attachment', () => {
  const ctx = context([{ id: FILE, name: 'diagram.png', type: 'image/png', size: 3 }]);
  const host = ctx.document.querySelector('main');
  host.append(renderMarkdown(`\\![[file:${FILE}]]`, ctx));
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.textContent.trim(), `![[file:${FILE}]]`);
  ctx.dom.window.close();
});

test('the in-memory attachment store validates and round-trips blobs', async () => {
  const store = createMemoryAttachmentStore();
  const blob = new Blob(['hello'], { type: 'text/plain' });
  const record = { id: FILE, name: 'hello.txt', type: 'text/plain', size: blob.size, blob, 'created-at': '2026-10-26T00:00:00.000Z' };
  await store.put(record);
  const [saved] = await store.list();
  assert.equal(saved.id, FILE);
  assert.equal(saved.name, 'hello.txt');
  assert.equal(await saved.blob.text(), 'hello');
  await assert.rejects(() => store.put({ ...record, id: 'not-a-uuid' }), /attachment ID/i);
  await store.delete(FILE);
  assert.equal((await store.list()).length, 0);
});

function fakeIndexedDB() {
  const records = new Map();
  let created = false;
  const store = {
    put(record) {
      const request = {};
      queueMicrotask(() => { records.set(record.id, record); request.result = record.id; request.onsuccess?.(); });
      return request;
    },
    getAll() {
      const request = {};
      queueMicrotask(() => { request.result = [...records.values()]; request.onsuccess?.(); });
      return request;
    },
    delete(id) {
      const request = {};
      queueMicrotask(() => { records.delete(id); request.onsuccess?.(); });
      return request;
    },
  };
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    transaction: () => {
      const transaction = { objectStore: () => store };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    },
  };
  return {
    open() {
      const request = { result: db };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  };
}

test('the IndexedDB attachment store creates its object store and persists blobs', async () => {
  const store = createIndexedDBAttachmentStore(fakeIndexedDB());
  const blob = new Blob(['indexed'], { type: 'text/plain' });
  const record = { id: FILE, name: 'indexed.txt', type: 'text/plain', size: blob.size, blob, 'created-at': '2026-10-26T00:00:00.000Z' };
  assert.equal(store.persistent, true);
  await store.put(record);
  const [saved] = await store.list();
  assert.equal(saved.name, 'indexed.txt');
  assert.equal(await saved.blob.text(), 'indexed');
  const second = { ...record, id: '660e8400-e29b-41d4-a716-446655440001', name: 'second.txt' };
  assert.equal(await store.importMany([second]), 1);
  assert.equal((await store.list()).length, 2);
  await store.delete(FILE);
  assert.equal((await store.list()).length, 1);
});
