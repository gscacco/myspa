import { test } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';
import { createMemoryAttachmentStore } from '../../loom/js/attachments.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const C = '550e8400-e29b-41d4-a716-446655440002';
const IMAGE_FILE = '660e8400-e29b-41d4-a716-446655440000';
const TEXT_FILE = '660e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';

function attachment(id, name, type, content, createdAt) {
  const blob = new Blob([content], { type });
  return { id, name, type, size: blob.size, blob, 'created-at': createdAt };
}

async function mount({ attachmentRecords = [] } = {}) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  dom.window.URL.createObjectURL = blob => `blob:${blob.type}:${blob.size}`;
  dom.window.URL.revokeObjectURL = () => {};
  let base = addItem(emptyKnowledgeBase(), { title: 'Source', body: 'A body with [[', tags: [] }, { id: A, now: NOW });
  base = addItem(base, { title: 'Alpha target', body: 'Alpha body', tags: [keyword('clojure')] }, { id: B, now: NOW });
  base = addItem(base, { title: 'Needle notes', body: 'Needle content' }, { id: C, now: NOW });
  const attachmentStore = createMemoryAttachmentStore(attachmentRecords);
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base, attachmentStore });
  await app.ready;
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit"]').click();
  return { app, dom, document: dom.window.document, card, textarea: card.querySelector('[name="body"]') };
}

async function eventually(assertion) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await assertion(); } catch { await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  return assertion();
}

function pasteImage(dom, file) {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
  });
  dom.window.document.body.dispatchEvent(event);
  return event;
}

function type(textarea, dom, value, caret = value.length) {
  textarea.value = value;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('typing [[ opens a contextual search popup and keyboard selection inserts a stable ID', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, 'Before [[', 9);
  let popup = card.querySelector('.link-completion');
  assert.ok(popup);
  assert.equal(popup.hidden, false);
  assert.match(popup.textContent, /Type to search items/);

  type(textarea, dom, 'Before [[alp', 12);
  popup = card.querySelector('.link-completion');
  assert.match(popup.textContent, /Alpha target/);
  assert.equal(popup.querySelectorAll('[role="option"]').length, 1);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  textarea.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(textarea.value, `Before [[item:${B}]]`);
  assert.equal(popup.hidden, true);
  dom.window.close();
});

test('Escape dismisses link completion without changing the source', async () => {
  const { dom, textarea } = await mount();
  type(textarea, dom, 'Keep [[bet', 10);
  const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  textarea.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(textarea.value, 'Keep [[bet');
  assert.equal(textarea.ownerDocument.querySelector('.link-completion').hidden, true);
  dom.window.close();
});

test('mouse selection replaces only the trigger and preserves surrounding text', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, 'Start [[nee middle end', 11);
  const option = card.querySelector('[role="option"]');
  assert.match(option.textContent, /Needle notes/);
  option.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  option.click();
  assert.equal(textarea.value, `Start [[item:${C}]] middle end`);
  dom.window.close();
});

test('link completion reuses title/tag grouping and ignores escaped triggers', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, 'Escaped \\[[', 12);
  assert.equal(card.querySelector('.link-completion')?.hidden, true);
  type(textarea, dom, 'Tag [[clojure', 13);
  const popup = card.querySelector('.link-completion');
  assert.equal(popup.querySelector('[data-search-group="titles-tags"]')?.textContent.includes(':clojure'), true);
  assert.equal(popup.querySelectorAll('[data-item-id]').length, 1);
  dom.window.close();
});

test('typing [[file: shows saved files with image previews and inserts only the stable file ID', async () => {
  const { dom, card, textarea } = await mount({ attachmentRecords: [
    attachment(TEXT_FILE, 'notes.txt', 'text/plain', 'notes', '2026-10-22T00:00:00.000Z'),
    attachment(IMAGE_FILE, 'shot.png', 'image/png', 'png', '2026-10-23T00:00:00.000Z'),
  ] });
  type(textarea, dom, '[[file:', 7);
  const popup = card.querySelector('.link-completion');
  assert.equal(popup.hidden, false);
  assert.equal(popup.getAttribute('aria-label'), 'Insert file reference');
  const options = [...popup.querySelectorAll('[role="option"]')];
  assert.deepEqual(options.map(option => option.dataset.fileId), [IMAGE_FILE, TEXT_FILE]);
  assert.match(options[0].textContent, /shot\.png/);
  assert.equal(options[0].querySelector('img')?.getAttribute('src'), 'blob:image/png:3');
  assert.equal(options[1].querySelector('img'), null);
  assert.ok(options[1].querySelector('.link-completion-file-icon'));

  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  textarea.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(textarea.value, `[[file:${IMAGE_FILE}]]`);
  dom.window.close();
});

test('file completion filters by filename and supports transclusion syntax', async () => {
  const { dom, card, textarea } = await mount({ attachmentRecords: [
    attachment(IMAGE_FILE, 'shot.png', 'image/png', 'png', '2026-10-23T00:00:00.000Z'),
    attachment(TEXT_FILE, 'notes.txt', 'text/plain', 'notes', '2026-10-23T00:00:00.000Z'),
  ] });
  type(textarea, dom, '![[file:note', 12);
  const popup = card.querySelector('.link-completion');
  const options = [...popup.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 1);
  assert.equal(options[0].dataset.fileId, TEXT_FILE);
  options[0].click();
  assert.equal(textarea.value, `![[file:${TEXT_FILE}]]`);
  dom.window.close();
});

test('file completion explains an empty attachment store', async () => {
  const { dom, card, textarea } = await mount();
  type(textarea, dom, '[[file:', 7);
  assert.match(card.querySelector('.link-completion').textContent, /No saved files/);
  dom.window.close();
});

test('typing ![[] shows scene image items with previews and transcludes the selected item', async () => {
  const { app, dom, card, textarea } = await mount();
  pasteImage(dom, new File(['image'], 'scene.png', { type: 'image/png' }));
  await eventually(() => assert.equal(app.getBase().items.filter(item => item.kind?.name === 'image').length, 1));
  const imageItem = app.getBase().items.find(item => item.kind?.name === 'image');
  assert.equal(imageItem.title, `Screenshot: item:${imageItem.id}`);

  type(textarea, dom, '![[', 3);
  const popup = card.querySelector('.link-completion');
  assert.match(popup.textContent, new RegExp(`Screenshot: item:${imageItem.id}`));
  const option = popup.querySelector(`[data-item-id="${imageItem.id}"]`);
  assert.ok(option);
  assert.equal(option.querySelector('img')?.getAttribute('src'), 'blob:image/png:5');
  option.click();
  assert.equal(textarea.value, `![[item:${imageItem.id}]]`);

  card.querySelector('[data-action="apply"]').click();
  const preview = card.querySelector('.image-transclusion img');
  assert.equal(preview?.getAttribute('src'), 'blob:image/png:5');
  assert.equal(card.querySelector('.image-transclusion')?.closest('.transclusion')?.querySelector('header'), null);
  assert.equal(card.querySelector('.image-transclusion')?.closest('.transclusion')?.hasAttribute('aria-label'), false);
  assert.doesNotMatch(card.querySelector('.transclusion')?.textContent || '', /From Screenshot/);
  dom.window.close();
});
