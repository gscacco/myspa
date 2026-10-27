import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';
import {
  attachClojureCompletion, completionCandidates, completionInsertion, computeCompletion,
} from '../../loom/js/clojure-completion.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-27T00:00:00.000Z';

test('completion catalog documents common ClojureScript functions and the Loom API', () => {
  const candidates = completionCandidates();
  const byName = new Map(candidates.map(candidate => [candidate.name, candidate]));
  for (const name of ['defn', 'map', 'filter', 'reduce', 'loom/items', 'loom/item', 'loom/link', 'loom/data']) {
    assert.ok(byName.has(name), `${name} should be suggested`);
  }
  assert.match(byName.get('map').signature, /\(map/);
  assert.match(byName.get('map').description, /collection/i);
  assert.match(byName.get('loom/items').description, /item/i);
  assert.equal(new Set(candidates.map(candidate => candidate.name)).size, candidates.length);
});

test('completion matches the current symbol prefix and exposes its documentation', () => {
  const result = computeCompletion({ code: '(ma', cursor: 3, hasSelection: false });
  assert.equal(result.word, 'ma');
  assert.equal(result.from, 1);
  assert.equal(result.to, 3);
  assert.equal(result.candidates[0].name, 'map');
  assert.match(result.candidates[0].signature, /\(map/);
  assert.match(result.candidates[0].description, /collection/i);
  assert.ok(result.candidates.some(candidate => candidate.name === 'max'));
});

test('completion keeps an exact symbol available for its documentation', () => {
  const result = computeCompletion({ code: '(map', cursor: 4, hasSelection: false });
  assert.equal(result.candidates[0].name, 'map');
});

test('completion is suppressed in strings, comments, and selections', () => {
  assert.equal(computeCompletion({ code: '(str "ma', cursor: 8, hasSelection: false }), null);
  assert.equal(computeCompletion({ code: '; ma', cursor: 4, hasSelection: false }), null);
  assert.equal(computeCompletion({ code: '(ma', cursor: 3, hasSelection: true }), null);
  assert.equal(computeCompletion({ code: '(str \\; ma', cursor: 10, hasSelection: false })?.word, 'ma');
});

test('completion supports an explicit empty-prefix suggestion request', () => {
  assert.equal(computeCompletion({ code: '(', cursor: 1, hasSelection: false }), null);
  const forced = computeCompletion({ code: '(', cursor: 1, hasSelection: false, force: true });
  assert.ok(forced);
  assert.ok(forced.candidates.length > 0);
});

test('completion rejects malformed input and inserts only the current word', () => {
  assert.equal(computeCompletion({ code: null, cursor: 0, hasSelection: false }), null);
  assert.equal(computeCompletion({ code: '(ma', cursor: 99, hasSelection: false }), null);
  const candidate = completionCandidates().find(value => value.name === 'map');
  assert.deepEqual(completionInsertion(candidate, '(ma)', 3, 'ma'), {
    text: 'map', from: 1, to: 3, caret: 4,
  });
});

test('completion leaves Ctrl-modified navigation to the structural editor', () => {
  const dom = new JSDOM('<div class="snippet-editor"><textarea></textarea></div>');
  const textarea = dom.window.document.querySelector('textarea');
  const detach = attachClojureCompletion(textarea);
  textarea.focus();
  textarea.value = 'ma';
  textarea.setSelectionRange(2, 2);
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(dom.window.document.querySelector('.clojure-assistance').hidden, false);
  let forwarded = false;
  textarea.addEventListener('keydown', event => { forwarded = event.ctrlKey && event.key === 'ArrowUp'; });
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowUp', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  assert.equal(forwarded, true);
  detach();
  dom.window.close();
});

async function snippetApp(source) {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const base = addItem(emptyKnowledgeBase(), {
    title: 'Code', body: `~~~cljs loom\n${source}\n~~~`,
  }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  await app.ready;
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit-snippet"]').click();
  const textarea = card.querySelector('.snippet-editor textarea');
  return { dom, card, textarea };
}

function type(dom, textarea, value) {
  textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('the snippet editor shows suggestions and documentation and accepts with Enter', async () => {
  const { dom, card, textarea } = await snippetApp('nil');
  type(dom, textarea, '(fil');
  const panel = card.querySelector('.clojure-assistance');
  assert.ok(panel);
  assert.equal(panel.hidden, false);
  const listbox = panel.querySelector('[role="listbox"]');
  assert.equal(textarea.getAttribute('aria-expanded'), 'true');
  assert.equal(textarea.getAttribute('aria-controls'), listbox.id);
  assert.ok(listbox.querySelector('[role="option"]'));
  assert.match(panel.querySelector('.clojure-assistance-doc').textContent, /filter/);
  assert.match(panel.querySelector('.clojure-assistance-doc').textContent, /predicate/i);

  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  }));
  assert.equal(textarea.value, '(filter');
  assert.equal(panel.hidden, true);
  assert.equal(textarea.getAttribute('aria-expanded'), 'false');

  type(dom, textarea, '(ma');
  assert.equal(panel.hidden, false);
  const options = [...panel.querySelectorAll('[role="option"]')];
  const count = options.length;
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown', bubbles: true, cancelable: true,
  }));
  assert.equal(panel.querySelector('[role="option"][aria-selected="true"]').textContent, options[1].textContent);
  assert.match(panel.querySelector('.clojure-assistance-doc').textContent, new RegExp(options[1].textContent));
  assert.equal(count, options.length);

  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  assert.equal(panel.hidden, true);
  assert.equal(textarea.value, '(ma');

  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  assert.equal(panel.hidden, false);
  const target = panel.querySelectorAll('[role="option"]')[2];
  target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(textarea.value, `(${target.textContent}`);
  assert.equal(panel.hidden, true);
  dom.window.close();
});

test('closing the snippet editor disposes its completion panel', async () => {
  const { dom, card, textarea } = await snippetApp('(map inc [])');
  type(dom, textarea, '(ma');
  assert.ok(card.querySelector('.clojure-assistance'));
  card.querySelector('[data-action="cancel-snippet"]').click();
  assert.equal(card.querySelector('.clojure-assistance'), null);
  assert.equal(textarea.getAttribute('aria-expanded'), null);
  dom.window.close();
});
