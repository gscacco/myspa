import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoomArtifact } from '../../tools/build-loom.js';

test('Loom builds and boots as a single offline HTML file', async () => {
  const html = await buildLoomArtifact();
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<link[^>]+stylesheet|<script[^>]+src=|type="module"/i);
  assert.doesNotMatch(html, /(?:href|src)=["'](?:https?:|\/\/)/i);
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'file:///tmp/loom.html', runScripts: 'dangerously', virtualConsole: console });
  assert.equal(typeof dom.window.scittle?.core?.eval_string, 'function');
  assert.equal(dom.window.document.querySelector('#loom-app')?.dataset.ready, 'true');
  assert.equal(dom.window.document.querySelector('#loom-status')?.textContent, '0 items');
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('Loom evaluates clojurescript blocks offline and ships Scittle attribution', async () => {
  const html = await buildLoomArtifact();
  assert.match(html, /Scittle 0\.8\.33/);
  assert.match(html, /Eclipse Public License 1\.0/);
  assert.match(html, /Copyright \(c\) 2021-2022 Michiel Borkent/i);

  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'file:///tmp/loom.html', runScripts: 'dangerously', virtualConsole: console });
  dom.window.document.querySelector('#new-item').click();
  const draft = dom.window.document.querySelector('.item-form');
  draft.elements.title.value = 'Offline';
  draft.elements.body.value = '~~~clojurescript\n(str "offline-" (+ 20 22))\n~~~';
  draft.closest('.item-card').querySelector('[data-action="apply"]').click();
  const card = dom.window.document.querySelector('.item-card');
  card.querySelector('[data-action="run-snippet"]').click();
  assert.equal(card.querySelector('.snippet-output').textContent, 'offline-42');
  assert.deepEqual(errors, []);
  dom.window.close();
});
