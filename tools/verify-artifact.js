#!/usr/bin/env node
/**
 * tools/verify-artifact.js — Verifica delle proprietà dell'artefatto
 * `dist/foglio.html` che non dipendono da un browser:
 *  - è un singolo file autonomo (nessun riferimento a file locali);
 *  - contiene CSS e JavaScript inline e il modello EDN in `#model`;
 *  - il modello è rileggibile e compatibile con quello di `src/index.html`;
 *  - il bundle non contiene sequenze che romperebbero il documento.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Script } from 'node:vm';
import { readEDN, writeEDN } from '../src/js/edn.js';
import { extractModel } from '../src/js/persistence.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };

export function verify(html, sourceHtml) {
  check('inizia con <!doctype html>', /^<!doctype html>/i.test(html));
  check('nessun riferimento CSS esterno', !/<link[^>]+stylesheet/i.test(html));
  check('nessun script di modulo esterno', !/<script[^>]*type="module"/i.test(html));
  check('nessuno script con src esterno', !/<script[^>]+src=/i.test(html));

  const styleBlock = /<style>([\s\S]*?)<\/style>/.exec(html);
  check('CSS inline presente', !!styleBlock && /border-collapse:collapse/.test(styleBlock[1]) && /#gw\{/.test(styleBlock[1]));
  check('una sola sezione <style>', (html.match(/<style>/g) || []).length === 1);

  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const bundle = scripts.find(m => !/application\/edn/.test(m[1]));
  check('bundle inline presente', !!bundle && bundle[2].includes('data-dyn'));
  check('un solo script inline (oltre al modello)', scripts.length === 2);
  check('modello EDN presente', /<script type="application\/edn" id="model">/.test(html));
  check('il bundle non contiene "</script"', !!bundle && !/<\/script/i.test(bundle[2]));

  let bundleError = '';
  try { if (bundle) new Script(bundle[2]); } catch (e) { bundleError = e.message; }
  check('il bundle inline è JavaScript valido', !!bundle && !bundleError, bundleError);

  // La minificazione non riduce necessariamente a una sola riga: esbuild può
  // lasciare a capo "grezzi" dentro i template literal puri. Si misura quindi la
  // densità di spazi bianchi, che nel codice non minificato è molto più alta.
  const wsRatio = s => (s.match(/[ \t\n]/g) || []).length / s.length;
  check('bundle JavaScript minificato', !!bundle && wsRatio(bundle[2]) < 0.08, bundle ? (wsRatio(bundle[2]) * 100).toFixed(1) + '% di spazi bianchi' : 'bundle assente');
  check('CSS minificato', !!styleBlock && wsRatio(styleBlock[1]) < 0.08, styleBlock ? (wsRatio(styleBlock[1]) * 100).toFixed(1) + '% di spazi bianchi' : 'CSS assente');

  check('gli elementi dinamici sono vuoti', !/<span id="stat"[^>]*>[^<\s]/.test(html));

  let model = null;
  try {
    const edn = extractModel(html);
    model = readEDN(edn);
    check('modello rileggibile', true);
    check('modello con fogli', Array.isArray(model.sheets) && model.sheets.length > 0);
    check('modello con codice utente in ClojureScript', typeof model.code === 'string' && model.code.includes('(defn WITH_TAX'));
  } catch (e) {
    check('modello rileggibile', false, e.message);
  }

  if (sourceHtml && model) {
    const src = readEDN(extractModel(sourceHtml));
    check('modello identico alla sorgente', writeEDN(src, 0) === writeEDN(model, 0));
  }
  return checks;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const html = await readFile(join(ROOT, 'dist/foglio.html'), 'utf8');
  const sourceHtml = await readFile(join(ROOT, 'src/index.html'), 'utf8');
  const results = verify(html, sourceHtml);
  for (const r of results) console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? '\n' + failed.length + ' verifiche fallite' : '\nTutte le verifiche superate (' + results.length + ')');
  process.exit(failed.length ? 1 : 0);
}
