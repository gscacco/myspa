import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { renderMarkdown } from '../../loom/js/render.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const C = '550e8400-e29b-41d4-a716-446655440002';
const NOW = '2026-10-23T00:00:00.000Z';

function items() {
  return [
    { id: A, title: 'Current title', body: '' },
    { id: B, title: 'Other item', body: '' },
  ];
}

function context(list = items()) {
  const dom = new JSDOM('<main></main>');
  const opened = [];
  return { dom, document: dom.window.document, items: list, dependencies: new Set(), onNavigate: id => opened.push(id), opened };
}

async function mount() {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  let base = addItem(emptyKnowledgeBase(), { title: 'Source', body: `[[item:${B}]]` }, { id: A, now: NOW });
  base = addItem(base, { title: 'Target', body: 'Destination' }, { id: B, now: NOW });
  base = addItem(base, { title: 'Draft holder', body: 'Draft body' }, { id: C, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base, confirmDelete: () => true });
  return { app, dom, document: dom.window.document };
}

test('stable item references render the current title in every Markdown inline context', () => {
  const ctx = context();
  const body = `# Heading [[item:${A}]]\n\nParagraph [[item:${B}]].\n\n- list [[item:${A}]]`;
  ctx.document.querySelector('main').append(renderMarkdown(body, ctx));
  assert.deepEqual([...ctx.document.querySelectorAll('a')].map(anchor => anchor.textContent), ['Current title', 'Other item', 'Current title']);
  assert.deepEqual([...ctx.dependencies], [A, B]);
  ctx.document.querySelector('a').click();
  assert.deepEqual(ctx.opened, [A]);
  ctx.dom.window.close();
});

test('stable item references stay inert in code, executable source, escaped text, and malformed syntax', () => {
  const ctx = context();
  const body = [
    `inline \`[[item:${A}]]\``,
    `~~~clojure\n[[item:${A}]]\n~~~`,
    `~~~clojurescript\n[[item:${A}]]\n~~~`,
    `escaped \\[[item:${A}]]`,
    'malformed [[item:not-a-uuid]] and [[item:' + A,
  ].join('\n\n');
  ctx.document.querySelector('main').append(renderMarkdown(body, ctx));
  assert.equal(ctx.document.querySelectorAll('a').length, 0);
  assert.match(ctx.document.body.textContent, /\[\[item:/);
  ctx.dom.window.close();
});

test('missing references render an explicit unresolved indicator without guessing by title', () => {
  const ctx = context([{ id: A, title: 'Some title', body: '' }]);
  ctx.document.querySelector('main').append(renderMarkdown(`[[item:${B}]]`, ctx));
  const unresolved = ctx.document.querySelector('.unresolved-link');
  assert.ok(unresolved);
  assert.equal(unresolved.textContent, `Missing item: ${B}`);
  assert.equal(ctx.document.querySelector('a'), null);
  ctx.dom.window.close();
});

test('renaming a target updates existing references without rewriting source Markdown', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A);
  const source = document.querySelector(`[data-item-id="${A}"]`);
  assert.equal(source.querySelector('a').textContent, 'Target');
  app.openItem(B);
  const target = document.querySelector(`[data-item-id="${B}"]`);
  target.querySelector('[data-action="edit"]').click();
  target.querySelector('[name="title"]').value = 'Renamed target';
  target.querySelector('[data-action="apply"]').click();
  assert.equal(source.querySelector('a').textContent, 'Renamed target');
  assert.equal(app.getBase().items.find(item => item.id === A).body, `[[item:${B}]]`);
  dom.window.close();
});

test('following a stable reference preserves open cards, relative order, and unsaved drafts', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A); app.openItem(C);
  const draft = document.querySelector(`[data-item-id="${C}"]`);
  draft.querySelector('[data-action="edit"]').click();
  draft.querySelector('[name="title"]').value = 'Unsaved draft';
  document.querySelector(`[data-item-id="${A}"] a`).click();
  assert.deepEqual(app.getBase().workspace['open-ids'], [B, C, A]);
  assert.equal(document.querySelector(`[data-item-id="${C}"]`), draft);
  assert.equal(draft.querySelector('[name="title"]').value, 'Unsaved draft');
  dom.window.close();
});

test('deleting a target leaves existing references unresolved', async () => {
  const { app, dom, document } = await mount();
  app.openItem(A); app.openItem(B);
  document.querySelector(`[data-item-id="${B}"] [data-action="delete"]`).click();
  assert.equal(document.querySelector(`[data-item-id="${A}"] a`), null);
  assert.equal(document.querySelector(`[data-item-id="${A}"] .unresolved-link`).textContent, `Missing item: ${B}`);
  dom.window.close();
});
