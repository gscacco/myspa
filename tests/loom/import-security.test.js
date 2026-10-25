import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase, writeKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

async function mount(options = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, ...options });
  return { app, dom, document: dom.window.document };
}

test('unsupported EDN reader forms are rejected before replacement', async () => {
  let confirmations = 0;
  const { app, dom } = await mount({ confirmReplace: () => { confirmations++; return true; } });
  const before = app.getBase();
  const hostileForms = [
    '#js {:probe 1}',
    '#inst "2026-10-23T00:00:00.000Z"',
    '#"probe"',
    '\\c',
    '@probe',
    '(+ 1 2)',
    '`probe',
    '~probe',
    "'probe",
    writeKnowledgeBase(before) + ' trailing',
  ];
  for (const source of hostileForms) {
    assert.equal(app.importEDN(source), false, source);
    assert.deepEqual(app.getBase(), before, source);
  }
  assert.equal(confirmations, 0);
  dom.window.close();
});

test('imported hostile Markdown stays inert and imported snippets do not run', async () => {
  const body = [
    '# Imported',
    '<script>globalThis.__loomImportExecuted = true</script>',
    '<img src="x" onerror="globalThis.__loomImportExecuted = true">',
    '[bad](javascript:globalThis.__loomImportExecuted=true)',
    '![remote](https://example.test/image.png)',
    '~~~cljs loom',
    '(set! js/globalThis.__loomImportExecuted true)',
    '~~~',
  ].join('\n\n');
  let importedBase = addItem(emptyKnowledgeBase(), { title: 'Hostile', body }, { id: A, now: NOW });
  importedBase = { ...importedBase, workspace: { 'open-ids': [A], 'active-id': A } };
  globalThis.__loomImportExecuted = false;
  try {
    const { app, dom, document } = await mount();
    assert.equal(app.importEDN(writeKnowledgeBase(importedBase)), true);
    assert.equal(globalThis.__loomImportExecuted, false);
    assert.equal(document.querySelector('.item-content script'), null);
    assert.equal(document.querySelector('.item-content img'), null);
    assert.equal(document.querySelector('.item-content a[href^="javascript"]'), null);
    assert.match(document.querySelector('.item-content').textContent, /<script>globalThis/);
    assert.match(document.querySelector('.item-content').textContent, /Unsafe or unsupported URL/);
    assert.match(document.querySelector('.item-content').textContent, /Unsupported image/);
    assert.equal(document.querySelector('.snippet-output').textContent, '');
    dom.window.close();
  } finally {
    delete globalThis.__loomImportExecuted;
  }
});
