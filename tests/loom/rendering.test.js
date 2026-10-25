import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { keyword } from '../../shared/js/edn-codec.js';
import { renderMarkdown, renderHiccup, renderResult } from '../../loom/js/render.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';

function context(items = []) {
  const dom = new JSDOM('<main></main>');
  const opened = [];
  return { dom, document: dom.window.document, items, onNavigate: id => opened.push(id), opened };
}

test('Markdown formatting becomes DOM while raw HTML and unsafe links stay inert', () => {
  const ctx = context();
  const body = '# Heading\n\nA **strong** and *emphasized* idea.\n\n- one\n- two\n\n```cljs\n(+ 1 2)\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))';
  ctx.document.querySelector('main').append(renderMarkdown(body, ctx));
  assert.equal(ctx.document.querySelector('h1')?.textContent, 'Heading');
  assert.equal(ctx.document.querySelector('strong')?.textContent, 'strong');
  assert.equal(ctx.document.querySelectorAll('li').length, 2);
  assert.equal(ctx.document.querySelector('pre code')?.textContent, '(+ 1 2)');
  assert.equal(ctx.document.querySelector('script'), null);
  assert.equal(ctx.document.querySelector('a[href^="javascript"]'), null);
  assert.match(ctx.document.querySelector('main').textContent, /<script>alert/);
  ctx.dom.window.close();
});

test('Markdown Loom links navigate by ID and missing links show a local diagnostic', () => {
  const ctx = context([{ id: A, title: 'Renamed', body: '' }]);
  ctx.document.querySelector('main').append(renderMarkdown(`[Old title](loom:${A}) [Missing](loom:${B})`, ctx));
  ctx.document.querySelector('a').click();
  assert.deepEqual(ctx.opened, [A]);
  assert.match(ctx.document.querySelector('main').textContent, /Missing item/);
  ctx.dom.window.close();
});

test('whole and section transclusion retain source identity and bound cycles', () => {
  const ctx = context([
    { id: A, title: 'Source', body: '# First\n\nVisible\n\n## Detail\n\nSelected\n\n# Next\n\nExcluded\n\n![Cycle](loom:' + B + ')' },
    { id: B, title: 'Cycle', body: `![Back](loom:${A})` },
  ]);
  const host = ctx.document.querySelector('main');
  host.append(renderMarkdown(`![Selected section](loom:${A}#detail)\n\n![All](loom:${A})`, ctx));
  const embeds = host.querySelectorAll('[data-loom-source]');
  assert.equal(embeds[0].dataset.loomSource, A);
  assert.match(embeds[0].textContent, /Selected/);
  assert.doesNotMatch(embeds[0].textContent, /Excluded/);
  assert.match(host.textContent, /Transclusion cycle/);
  embeds[0].querySelector('button').click();
  assert.deepEqual(ctx.opened, [A]);
  ctx.dom.window.close();
});

test('duplicate heading slugs stay stable in section embeds and source snippets remain inert', () => {
  const ctx = context([{ id: A, title: 'Source', body: '# Detail\n\nFirst\n\n# Detail\n\nSecond\n\n```cljs loom\n(+ 1 2)\n```' }]);
  const host = ctx.document.querySelector('main');
  host.append(renderMarkdown(`![Second detail](loom:${A}#detail-2)`, ctx));
  assert.equal(host.querySelector('.transclusion h1')?.id, 'detail-2');
  assert.match(host.textContent, /Second/);
  assert.doesNotMatch(host.textContent, /First/);
  assert.equal(host.querySelector('.loom-snippet'), null);
  ctx.dom.window.close();
});

test('missing sections and excessive transclusion depth fail locally', () => {
  const ids = Array.from({ length: 18 }, (_, index) => `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`);
  const items = ids.map((id, index) => ({ id, title: `Item ${index}`, body: index + 1 < ids.length ? `![Next](loom:${ids[index + 1]})` : 'End' }));
  const ctx = context(items), host = ctx.document.querySelector('main');
  host.append(renderMarkdown(`![Missing](loom:${ids[0]}#absent)\n\n![Deep](loom:${ids[0]})`, ctx));
  assert.match(host.textContent, /Missing section/);
  assert.match(host.textContent, /depth limit/);
  ctx.dom.window.close();
});

test('only executable fence markers create Loom snippet blocks', () => {
  const ctx = context();
  const fence = (lang) => ['~~~' + lang, '(+ 1 2)', '~~~'].join('\n');
  const host = ctx.document.querySelector('main');
  host.append(renderMarkdown(`${fence('cljs')}\n\n${fence('cljs loom')}`, ctx));
  assert.equal(host.querySelectorAll('.loom-snippet').length, 1);
  assert.equal(host.querySelectorAll('pre code').length, 1);
  assert.equal(host.querySelector('[data-action="run-snippet"]'), null);
  ctx.dom.window.close();
});

test('Hiccup supports nested collections and safe links, and rejects active attributes', () => {
  const ctx = context([{ id: A, title: 'Source', body: '' }]);
  const value = [keyword('ul'), [keyword('li'), 'one'], [keyword('li'), [keyword('a'), { href: `loom:${A}`, class: 'jump' }, 'open']]];
  ctx.document.querySelector('main').append(renderHiccup(value, ctx));
  assert.equal(ctx.document.querySelectorAll('li').length, 2);
  ctx.document.querySelector('a').click();
  assert.deepEqual(ctx.opened, [A]);
  assert.throws(() => renderHiccup([keyword('img'), { src: 'x' }], ctx), /tag/i);
  assert.throws(() => renderHiccup([keyword('div'), { onclick: 'alert(1)' }, 'bad'], ctx), /attribute/i);
  assert.throws(() => renderHiccup([keyword('a'), { href: 'javascript:alert(1)' }, 'bad'], ctx), /URL|href/i);
  ctx.dom.window.close();
});

test('a string result is text, while Hiccup and ordinary EDN data remain distinct', () => {
  const ctx = context();
  const host = ctx.document.querySelector('main');
  host.append(renderResult('<b>literal</b>', ctx), renderResult([keyword('strong'), 'node'], ctx), renderResult({ answer: 42 }, ctx));
  assert.equal(host.querySelector('b'), null);
  assert.equal(host.querySelector('strong')?.textContent, 'node');
  assert.match(host.querySelector('pre')?.textContent, /answer/);
  ctx.dom.window.close();
});
