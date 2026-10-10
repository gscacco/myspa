/**
 * Test end-to-end sull'artefatto costruito: carica `dist/foglio.html` in jsdom
 * eseguendone gli script, così da verificare il bundle minificato reale (che i
 * test di integrazione, montando i moduli direttamente, non coprono).
 *
 * Richiede che l'artefatto esista: `npm run build` (lo fa già `npm run check`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from '../helpers/sample.js';

const ARTIFACT = join(ROOT, 'dist/foglio.html');

/** Carica l'artefatto eseguendone gli script inline. */
function load() {
  const html = readFileSync(ARTIFACT, 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  return { html, dom };
}

/** Cella (r,c) a base 0 del foglio corrente. */
const cell = (document, r, c) => document.querySelector('#g').rows[r + 1].cells[c + 1];

test("l'artefatto si avvia e calcola i valori del modello d'esempio", () => {
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

test("l'artefatto monta l'editor ClojureScript con le funzioni utente", () => {
  const { dom } = load();
  const { document } = dom.window;
  assert.ok(document.querySelector('#code').value.includes('(defn CONIVA'));
  assert.ok(document.querySelector('#hl').innerHTML.includes('class="u"'));
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(document.querySelector('#bfn').textContent, 'ƒ CLJS');
  assert.match(document.querySelector('#help').textContent, /paredit/);
  assert.match(document.querySelector('#fn b').textContent, /ClojureScript/);
  dom.window.close();
});

test("l'artefatto esegue paredit e la valutazione della forma dal cursore", async () => {
  const { dom } = load();
  const { document, window } = dom.window;
  const ta = document.querySelector('#code');
  const key = (el, init) => { const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(ev); return ev; };
  const mouse = el => el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));

  // Ctrl+Invio valuta la s-exp prima del cursore e la rende subito disponibile
  const form = '(defn TRIPLO [x] (* x 3))';
  ta.value = form;
  ta.setSelectionRange(form.length, form.length);
  key(ta, { key: 'Enter', ctrlKey: true });
  assert.match(document.querySelector('#note').textContent, /^✓ .*TRIPLO/);
  const fx = document.querySelector('#fx');
  fx.value = '=TRIPLO(4)';
  key(fx, { key: 'Enter' });
  assert.equal(cell(document, 0, 0).textContent, '12');

  // ridefinire la stessa defn aggiorna le formule che la usano
  const nuovo = '(defn TRIPLO [x] (* x 10))';
  ta.value = nuovo;
  ta.setSelectionRange(nuovo.length, nuovo.length);
  key(ta, { key: 'Enter', ctrlKey: true });
  assert.equal(cell(document, 0, 0).textContent, '40');

  // i pulsanti paredit agiscono sulla lista del cursore
  ta.value = '(a b) c';
  ta.setSelectionRange(5, 5);
  mouse(document.querySelector('[data-action="paredit-slurp"]'));
  assert.equal(ta.value, '(a b c)');
  mouse(document.querySelector('[data-action="paredit-barf"]'));
  assert.equal(ta.value, '(a b) c');

  // le parentesi restano protette dalle cancellazioni
  ta.setSelectionRange(5, 5);
  assert.equal(key(ta, { key: 'Backspace' }).defaultPrevented, true);

  // Attende il controllo sintattico differito dell'editor prima di chiudere il DOM.
  await new Promise(r => setTimeout(r, 450));
  dom.window.close();
});

test("l'artefatto è minificato (bundle e CSS)", () => {
  const { html } = load();
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const bundle = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m => !/application\/edn/.test(m[1]))[2];
  const wsRatio = s => (s.match(/[ \t\n]/g) || []).length / s.length;
  assert.ok(wsRatio(bundle) < 0.08, 'bundle minificato (spazi bianchi: ' + (wsRatio(bundle) * 100).toFixed(1) + '%)');
  assert.ok(wsRatio(style) < 0.08, 'CSS minificato (spazi bianchi: ' + (wsRatio(style) * 100).toFixed(1) + '%)');
});
