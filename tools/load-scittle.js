/** Carica Scittle come script classico per i comandi Node che usano l'engine. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

if (!globalThis.scittle?.core?.eval_string) {
  const require = createRequire(import.meta.url);
  const bundlePath = require.resolve('scittle/dist/scittle.js');
  vm.runInThisContext(readFileSync(bundlePath, 'utf8'), { filename: bundlePath });
}
