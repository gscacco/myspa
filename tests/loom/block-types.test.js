import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { renderMarkdown } from '../../loom/js/render.js';
import { applySnippetEdit, findSnippetSpan } from '../../loom/js/snippet-source.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-23T00:00:00.000Z';

function fence(language, source) {
  return ['~~~' + language, source, '~~~'].join('\n');
}

test('only clojurescript and the legacy marker create executable blocks', () => {
  const dom = new JSDOM('<main></main>');
  const ctx = { document: dom.window.document, items: [] };
  const body = [
    fence('clojure', '(def display-only true)'),
    fence('clojurescript', '"Executable"'),
    fence('cljs', '"Ordinary example"'),
    fence('cljs loom', '"Legacy executable"'),
  ].join('\n\n');
  dom.window.document.querySelector('main').append(renderMarkdown(body, ctx));
  const snippets = dom.window.document.querySelectorAll('.loom-snippet');
  assert.equal(snippets.length, 2);
  assert.equal(snippets[1].querySelector('pre').textContent, '"Legacy executable"');
  assert.equal(snippets[0].querySelector('pre').hidden, true);
  assert.equal(snippets[1].querySelector('pre').hidden, true);
  assert.equal(dom.window.document.querySelectorAll('[data-action="edit-snippet"]').length, 2);
  assert.equal(dom.window.document.querySelectorAll('[data-action="view-snippet"]').length, 0);
  assert.equal(dom.window.document.querySelectorAll('[data-action="run-snippet"]').length, 0);
  const actions = snippets[0].querySelector('.snippet-actions');
  assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.dataset.action), ['edit-snippet']);
  for (const button of actions.querySelectorAll('button')) {
    assert.ok(button.querySelector('svg'));
    assert.equal(button.textContent, '');
    assert.ok(button.title);
    assert.ok(button.getAttribute('aria-label'));
  }
  assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.title), ['Edit code']);
  assert.equal([...dom.window.document.querySelectorAll('pre code')].length, 2);
  dom.window.close();
});

test('the subtle snippet edit action shares its top row with the result', async () => {
  const css = await readFile(new URL('../../loom/css/style.css', import.meta.url), 'utf8');
  const dom = new JSDOM('<!doctype html><main></main>');
  const style = dom.window.document.createElement('style'); style.textContent = css;
  dom.window.document.head.append(style);
  const ctx = { document: dom.window.document, items: [] };
  dom.window.document.querySelector('main').append(renderMarkdown(fence('clojurescript', '(+ 1 2)'), ctx));
  const snippet = dom.window.document.querySelector('.loom-snippet');
  const actions = snippet.querySelector('.snippet-actions');
  const output = snippet.querySelector('.snippet-output');
  const edit = actions.querySelector('[data-action="edit-snippet"]');

  assert.equal(dom.window.getComputedStyle(snippet).display, 'grid');
  assert.equal(dom.window.getComputedStyle(actions).position, 'static');
  assert.equal(dom.window.getComputedStyle(output).marginTop, '0px');
  assert.equal(dom.window.getComputedStyle(edit).opacity, '0.5');
  assert.match(css, /\.snippet-actions \.icon-button:hover[^{]*\{[^}]*opacity:1/);
  assert.match(css, /\.snippet-actions \.icon-button:focus-visible[^{]*\{[^}]*opacity:1/);
  assert.match(css, /\.snippet-actions\[hidden\]\{display:none\}/);
  dom.window.close();
});

test('clojure fences are display-only and receive safe DOM syntax highlighting', () => {
  const dom = new JSDOM('<main></main>');
  const ctx = { document: dom.window.document, items: [] };
  const source = '(defn greet [name]\n  ;; comment <unsafe>\n  (str "Hello " name "!" 42))';
  dom.window.document.querySelector('main').append(renderMarkdown(fence('clojure', source), ctx));
  const code = dom.window.document.querySelector('pre code');
  assert.equal(code.textContent, source);
  assert.equal(dom.window.document.querySelector('.loom-snippet'), null);
  assert.equal(code.querySelector('script'), null);
  assert.equal(code.querySelector('.k')?.textContent, 'defn');
  assert.equal(code.querySelector('.s')?.textContent, '"Hello "');
  assert.equal(code.querySelector('.c')?.textContent, ';; comment <unsafe>');
  assert.equal(code.querySelector('.n')?.textContent, '42');
  dom.window.close();
});

test('snippet spans locate clojurescript blocks and preserve the surrounding Markdown', () => {
  const body = `Before\n\n${fence('clojurescript', '(+ 1 2)')}\n\nAfter`;
  const span = findSnippetSpan(body, 0);
  assert.ok(span);
  assert.equal(span.source, '(+ 1 2)');
  const updated = applySnippetEdit(body, body, span, '(+ 3 4)');
  assert.equal(updated, body.replace('(+ 1 2)', '(+ 3 4)'));
});

test('clojurescript blocks evaluate through Scittle and keep output separate from source', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const body = `${fence('clojure', '(str "display")')}\n\n${fence('clojurescript', '(str "runtime-" (+ 1 2))')}`;
  const base = addItem(emptyKnowledgeBase(), { title: 'Blocks', body }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  assert.equal(card.querySelectorAll('.loom-snippet').length, 1);
  assert.equal(card.querySelector('.snippet-output').textContent, 'runtime-3');
  assert.match(card.querySelector('.loom-snippet pre').textContent, /runtime-/);
  assert.equal(card.querySelector('.loom-snippet pre').hidden, true);
  assert.equal(app.getBase().items[0].body, body);
  dom.window.close();
});
