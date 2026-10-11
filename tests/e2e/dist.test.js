/**
 * End-to-end test for the built artifact: load `dist/foglio.html` in jsdom and
 * execute its scripts to verify the real minified bundle (which integration
 * tests that mount modules directly do not cover).
 *
 * Requires a built artifact: run `npm run build` (`npm run check` does this).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from '../helpers/sample.js';

const ARTIFACT = join(ROOT, 'dist/foglio.html');

/** Load the artifact and execute its inline scripts. */
function load() {
  const html = readFileSync(ARTIFACT, 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  return { html, dom };
}

/** Return the zero-based cell at (r,c) on the current sheet. */
const cell = (document, r, c) => document.querySelector('#g').rows[r + 1].cells[c + 1];

test('the artifact starts and calculates the sample workbook values', () => {
  const { dom } = load();
  const { document } = dom.window;
  assert.equal(document.querySelector('#g').rows.length, 101);
  assert.equal(cell(document, 1, 1).textContent, '1.50');
  assert.equal(cell(document, 1, 3).textContent, '150.00');
  assert.equal(cell(document, 1, 4).textContent, '183.00');
  assert.equal(cell(document, 5, 3).textContent, '843.80');
  assert.equal(cell(document, 8, 3).textContent, 'Bassa');
  assert.equal(document.querySelector('#stat').textContent, 'Foglio di calcolo');
  dom.window.close();
});

test('the artifact mounts the ClojureScript editor with user-defined functions', () => {
  const { dom } = load();
  const { document } = dom.window;
  assert.ok(document.querySelector('#code').value.includes('(defn WITH_TAX'));
  assert.ok(document.querySelector('#hl').innerHTML.includes('class="u"'));
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(document.querySelector('#bfn').textContent, 'ƒ CLJS');
  assert.match(document.querySelector('#help').textContent, /paredit/);
  assert.match(document.querySelector('#fn b').textContent, /ClojureScript/);
  dom.window.close();
});

test('the artifact runs paredit and evaluates the form before the cursor', async () => {
  const { dom } = load();
  const { document, window } = dom.window;
  const ta = document.querySelector('#code');
  const key = (el, init) => { const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(ev); return ev; };
  const mouse = el => el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));

  // Ctrl+Enter evaluates the s-expression before the cursor and makes it available.
  const form = '(defn TRIPLE [x] (* x 3))';
  ta.value = form;
  ta.setSelectionRange(form.length, form.length);
  key(ta, { key: 'Enter', ctrlKey: true });
  assert.match(document.querySelector('#note').textContent, /^✓ .*TRIPLE/);
  const fx = document.querySelector('#fx');
  fx.value = '=TRIPLE(4)';
  key(fx, { key: 'Enter' });
  assert.equal(cell(document, 0, 0).textContent, '12');

  // Redefining the function updates formulas that use it.
  const redefinedForm = '(defn TRIPLE [x] (* x 10))';
  ta.value = redefinedForm;
  ta.setSelectionRange(redefinedForm.length, redefinedForm.length);
  key(ta, { key: 'Enter', ctrlKey: true });
  assert.equal(cell(document, 0, 0).textContent, '40');

  // Paredit buttons act on the list containing the cursor.
  ta.value = '(a b) c';
  ta.setSelectionRange(5, 5);
  mouse(document.querySelector('[data-action="paredit-slurp"]'));
  assert.equal(ta.value, '(a b c)');
  mouse(document.querySelector('[data-action="paredit-barf"]'));
  assert.equal(ta.value, '(a b) c');

  // Delimiters remain protected from unbalancing deletions.
  ta.setSelectionRange(5, 5);
  assert.equal(key(ta, { key: 'Backspace' }).defaultPrevented, true);

  // Wait for the editor's delayed syntax check before closing the DOM.
  await new Promise(r => setTimeout(r, 450));
  dom.window.close();
});

test('the artifact is minified (bundle and CSS)', () => {
  const { html } = load();
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const bundle = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m => !/application\/edn/.test(m[1]))[2];
  const wsRatio = s => (s.match(/[ \t\n]/g) || []).length / s.length;
  assert.ok(wsRatio(bundle) < 0.08, 'minified bundle (whitespace: ' + (wsRatio(bundle) * 100).toFixed(1) + '%)');
  assert.ok(wsRatio(style) < 0.08, 'minified CSS (whitespace: ' + (wsRatio(style) * 100).toFixed(1) + '%)');
});
