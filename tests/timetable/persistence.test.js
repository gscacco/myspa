import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createTimetablePersistence } from '../../timetable/js/persistence.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { solverFixture } from './helpers.js';

const htmlPath = new URL('../../timetable/index.html', import.meta.url);

export function indexedDBStub() {
  const values = new Map();
  let hasStore = false;
  const db = {
    objectStoreNames: { contains: () => hasStore },
    createObjectStore() { hasStore = true; },
    transaction() {
      const transaction = { objectStore: () => ({
        get(key) {
          const request = {};
          queueMicrotask(() => { request.result = structuredClone(values.get(key)); request.onsuccess?.(); });
          return request;
        },
        put(value, key) {
          const request = {};
          queueMicrotask(() => {
            values.set(key, structuredClone(value));
            request.result = key;
            request.onsuccess?.();
            transaction.oncomplete?.();
          });
          return request;
        },
      }) };
      return transaction;
    },
  };
  return { open() {
    const request = { result: db };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  } };
}

test('IndexedDB persistence saves and restores a structured timetable copy', async () => {
  const persistence = createTimetablePersistence(indexedDBStub());
  const model = solverFixture();
  model.description = 'Anno scolastico';
  assert.equal(persistence.available, true);
  assert.equal(await persistence.save(model), true);
  model.name = 'Changed after save';
  const restored = await persistence.load();
  assert.equal(restored.name, 'Solver test');
  assert.equal(restored.description, 'Anno scolastico');
});

test('persistence degrades safely when IndexedDB is unavailable', async () => {
  const persistence = createTimetablePersistence(null);
  assert.equal(persistence.available, false);
  assert.equal(await persistence.load(), null);
  assert.equal(await persistence.save(solverFixture()), false);
});

test('school settings autosave and reload through the application persistence path', async () => {
  const database = indexedDBStub();
  const html = await readFile(htmlPath, 'utf8');
  const firstDOM = new JSDOM(html, { url: 'http://localhost/' });
  const first = createTimetableApp({ document: firstDOM.window.document, indexedDB: database });
  await first.ready;
  const description = firstDOM.window.document.querySelector('#school-description');
  description.value = 'Istituto tecnico · anno 2026/27';
  description.dispatchEvent(new firstDOM.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  const secondDOM = new JSDOM(html, { url: 'http://localhost/' });
  const second = createTimetableApp({ document: secondDOM.window.document, indexedDB: database });
  await second.ready;
  assert.equal(second.timetable.description, 'Istituto tecnico · anno 2026/27');
  assert.equal(secondDOM.window.document.querySelector('#school-description').value, 'Istituto tecnico · anno 2026/27');
  firstDOM.window.close();
  secondDOM.window.close();
});
