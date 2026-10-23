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
