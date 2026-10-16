#!/usr/bin/env node
/** Build the timetable app as a self-contained offline HTML document. */

import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_LINK = '<link rel="stylesheet" href="css/style.css">';
const HTML_SCRIPT = '<script type="module" src="js/main.js"></script>';

export function inlineTimetableBundle(html, css, js) {
  if (!html.includes(HTML_LINK)) throw new Error('Timetable build: expected stylesheet link is missing.');
  if (!html.includes(HTML_SCRIPT)) throw new Error('Timetable build: expected module entry point is missing.');
  if (/<\/script/i.test(js)) throw new Error('Timetable build: script contains a closing tag sequence.');
  const output = html
    .replace(HTML_LINK, () => `<style>\n${css}\n</style>`)
    .replace(HTML_SCRIPT, () => `<script>\n${js}\n</script>`);
  if (/<link[^>]+stylesheet|<script[^>]+src=|type="module"/i.test(output)) {
    throw new Error('Timetable build: output still has an external runtime asset.');
  }
  return output;
}

export async function buildTimetableArtifact({ minify = true } = {}) {
  const [html, cssSource, result] = await Promise.all([
    readFile(join(ROOT, 'timetable/index.html'), 'utf8'),
    readFile(join(ROOT, 'timetable/css/style.css'), 'utf8'),
    build({
      entryPoints: [join(ROOT, 'timetable/js/main.js')],
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
  const css = minify ? (await transform(cssSource, { loader: 'css', minify: true, charset: 'utf8' })).code : cssSource;
  const output = inlineTimetableBundle(html, css, result.outputFiles[0].text);
  const destination = join(ROOT, 'dist/timetable.html');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output, 'utf8');
  return output;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const minify = !process.argv.includes('--no-minify');
  buildTimetableArtifact({ minify })
    .then(html => console.log('dist/timetable.html scritto (' + Buffer.byteLength(html, 'utf8') + ' byte)' + (minify ? ' · minificato' : ' · non minificato')))
    .catch(error => { console.error(error.message); process.exit(1); });
}
