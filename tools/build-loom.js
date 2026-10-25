#!/usr/bin/env node
/** Build Loom as a self-contained offline HTML document. */

import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineBundle } from './build.js';
import { JETBRAINS_MONO_NOTICE, SCITTLE_NOTICE } from '../loom/js/third-party-notices.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_ASSETS = [
  'jetbrains-mono-latin-400-normal.woff2',
  'jetbrains-mono-latin-400-italic.woff2',
  'jetbrains-mono-latin-600-normal.woff2',
];

export async function buildLoomArtifact({ minify = true } = {}) {
  const [html, cssSource, vendor, result, ...fonts] = await Promise.all([
    readFile(join(ROOT, 'loom/index.html'), 'utf8'),
    readFile(join(ROOT, 'loom/css/style.css'), 'utf8'),
    readFile(join(ROOT, 'node_modules/scittle/dist/scittle.js'), 'utf8'),
    build({
      entryPoints: [join(ROOT, 'loom/js/main.js')],
      bundle: true,
      format: 'iife',
      target: ['es2022'],
      charset: 'utf8',
      legalComments: 'none',
      minify,
      write: false,
      logLevel: 'silent',
    }),
    ...FONT_ASSETS.map(file => readFile(join(ROOT, 'loom/fonts', file))),
  ]);
  const embeddedCss = FONT_ASSETS.reduce((source, file, index) => source.replaceAll(
    `../fonts/${file}`,
    `data:font/woff2;base64,${fonts[index].toString('base64')}`,
  ), cssSource);
  const css = minify ? (await transform(embeddedCss, { loader: 'css', minify: true, charset: 'utf8' })).code : embeddedCss;
  const output = inlineBundle(html, css, result.outputFiles[0].text, `${SCITTLE_NOTICE}\n${JETBRAINS_MONO_NOTICE}\n${vendor}`);
  const destination = join(ROOT, 'dist/loom.html');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output, 'utf8');
  return output;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildLoomArtifact({ minify: !process.argv.includes('--no-minify') })
    .then(output => console.log(`dist/loom.html written (${Buffer.byteLength(output, 'utf8')} bytes)`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
