import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { VirtualConsole, JSDOM } from 'jsdom';
import { buildTimetableArtifact } from '../../tools/build-timetable.js';

const artifactPath = fileURLToPath(new URL('../../dist/timetable.html', import.meta.url));
const samplePath = fileURLToPath(new URL('../../OR_30_SETT.ofd', import.meta.url));

test('standalone build is a single-file offline document with a bootable timetable UI', async () => {
  const html = await buildTimetableArtifact();
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<link[^>]+stylesheet|<script[^>]+src=|type="module"/i);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+">/);
  assert.doesNotMatch(html, /(?:href|src)=["'](?:https?:|\/\/)|url\(["']?(?:https?:|\/\/)/i);
  assert.equal((html.match(/<style>/g) || []).length, 1);
  const script = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(match => !/application\/edn/i.test(match[1]));
  assert.ok(script, 'bundled application JavaScript is inline');
  assert.doesNotThrow(() => new Script(script[2]));
  assert.equal(await readFile(artifactPath, 'utf8'), html);

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'file:///tmp/timetable.html', runScripts: 'dangerously', virtualConsole });
  const { document } = dom.window;
  assert.equal(document.querySelector('h1').textContent, 'Orario scolastico');
  assert.ok(document.querySelector('#ofd-file'));
  assert.ok(document.querySelector('#view-controls'));
  assert.ok(document.querySelector('#find-alternatives'));
  assert.ok(document.querySelector('link[rel="icon"]'));
  assert.equal(document.querySelector('#apply-import').disabled, true);
  assert.deepEqual(errors, [], 'startup does not depend on external scripts or assets');
  dom.window.close();
});

test('the offline artifact imports the supplied OFD and displays its real timetable', async () => {
  const html = await buildTimetableArtifact();
  const bytes = await readFile(samplePath);
  const dom = new JSDOM(html, { url: 'file:///tmp/timetable.html', runScripts: 'dangerously' });
  const { document } = dom.window;
  dom.window.TextDecoder = TextDecoder;
  dom.window.structuredClone = structuredClone;
  const input = document.querySelector('#ofd-file');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name: 'OR_30_SETT.ofd', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }],
  });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (let attempt = 0; attempt < 20 && document.querySelector('#apply-import').disabled; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(document.querySelector('#apply-import').disabled, false, document.querySelector('#import-report').textContent);
  assert.match(document.querySelector('#import-summary').textContent, /1[.,]?714/);
  document.querySelector('#apply-import').click();
  assert.equal(document.querySelector('#timetable-workspace').hidden, false);
  assert.match(document.querySelector('#current-status').textContent, /1[.,]?714/);
  assert.equal(document.querySelectorAll('#schedule-grid .day-heading').length, 6);
  assert.match(document.querySelector('#issues-list').textContent, /senza orario/i);
  dom.window.close();
});
