#!/usr/bin/env node
/**
 * tools/build.js — Costruisce l'artefatto distribuitile `dist/foglio.html`.
 *
 * Il risultato è un singolo file HTML autonomo che contiene: markup, CSS
 * inline, bundle JavaScript inline e il modello EDN iniziale in `#model`.
 * Non sono presenti riferimenti a file esterni, quindi il file può essere
 * aperto con doppio clic e salvato di nuovo come documento autonomo.
 */

import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HTML_LINK = '<link rel="stylesheet" href="css/style.css">';
const HTML_SCRIPT = '<script type="module" src="js/main.js"></script>';
const HTML_VENDOR_SCRIPT = '<script src="../node_modules/scittle/dist/scittle.js"></script>';

/** Inline del bundle e del CSS nel documento, con verifica di sicurezza. */
export function inlineBundle(html, css, js, vendor = '') {
  if (!html.includes(HTML_LINK)) throw Error('build: nel documento manca il link al CSS atteso');
  if (!html.includes(HTML_SCRIPT)) throw Error('build: nel documento manca lo script del modulo atteso');
  if (vendor && !html.includes(HTML_VENDOR_SCRIPT)) throw Error('build: nel documento manca lo script Scittle atteso');
  const fullJS = (vendor ? vendor.trim() + '\n' : '') + js.trim();
  if (/<\/script/i.test(fullJS)) throw Error('build: il bundle contiene la sequenza letterale "</script" e romperebbe il documento');
  // Le replacement string di String.replace interpretano sequenze `$` (es. `$$`
  // → `$`). Il bundle usa identificatori come `$$`, quindi si passa una funzione
  // di sostituzione, il cui valore di ritorno non subisce alcuna interpretazione.
  return html
    .replace(HTML_LINK, () => '<style>\n' + css + '\n</style>')
    .replace(HTML_VENDOR_SCRIPT, '')
    .replace(HTML_SCRIPT, () => '<script>\n' + fullJS + '\n</script>');
}

/** Legge i sorgenti, produce il bundle e scrive l'artefatto. @returns {Promise<string>} */
export async function buildArtifact({ minify = true } = {}) {
  const [html, cssSrc, vendor, result] = await Promise.all([
    readFile(join(ROOT, 'src/index.html'), 'utf8'),
    readFile(join(ROOT, 'src/css/style.css'), 'utf8'),
    readFile(join(ROOT, 'node_modules/scittle/dist/scittle.js'), 'utf8'),
    build({
      entryPoints: [join(ROOT, 'src/js/main.js')],
      bundle: true,
      format: 'iife',
      target: ['es2022'],
      charset: 'utf8',
      legalComments: 'none',
      minify,
      write: false,
      logLevel: 'silent',
    }),
  ]);
  const css = minify ? (await transform(cssSrc, { loader: 'css', minify: true, charset: 'utf8' })).code : cssSrc;
  const out = inlineBundle(html, css, result.outputFiles[0].text, vendor);
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  await writeFile(join(ROOT, 'dist/foglio.html'), out, 'utf8');
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const minify = !process.argv.includes('--no-minify');
  buildArtifact({ minify })
    .then(html => console.log('dist/foglio.html scritto (' + Buffer.byteLength(html, 'utf8') + ' byte)' + (minify ? ' · minificato' : ' · non minificato')))
    .catch(e => { console.error(e.message); process.exit(1); });
}
