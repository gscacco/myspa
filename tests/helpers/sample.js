/**
 * Helper condiviso: carica il documento sorgente e il modello EDN di esempio.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readEDN } from '../../src/js/edn.js';
import { createWorkbook } from '../../src/js/model.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Contenuto di `src/index.html`. */
export function sourceHTML() {
  return readFileSync(join(ROOT, 'src/index.html'), 'utf8');
}

/** Testo EDN del modello iniziale. */
export function modelEDN() {
  const m = /<script type="application\/edn" id="model">([\s\S]*?)<\/script>/.exec(sourceHTML());
  if (!m) throw Error('modello EDN non trovato in src/index.html');
  return m[1];
}

/** Workbook di esempio (Foglio1 + Foglio2) normalizzato. */
export function workbook() {
  return createWorkbook(readEDN(modelEDN()));
}
