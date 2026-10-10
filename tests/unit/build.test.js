import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { inlineBundle } from '../../tools/build.js';

const HTML = '<head><link rel="stylesheet" href="css/style.css"></head><body><script type="module" src="js/main.js"></script></body>';

test('inlineBundle preserva gli identificatori contenenti "$"', () => {
  const js = 'const $ = () => 1; const $$ = () => 2; fn($, $$); tpl(`$$("x")`);';
  const out = inlineBundle(HTML, 'body{color:red}', js);
  assert.ok(out.includes('const $$ = () => 2;'), 'identificatore $$ preservato');
  assert.ok(out.includes('fn($, $$);'), 'uso di $$ preservato');
  assert.ok(out.includes('tpl(`$$("x")`)'), '$$ dentro un template literal preservato');
  assert.ok(out.includes('<style>\nbody{color:red}\n</style>'), 'CSS inline presente');
  assert.ok(!out.includes('href="css/style.css"'), 'link esterno rimosso');
});

test("inlineBundle produce un bundle JavaScript valido", () => {
  const js = 'const $ = (id) => id; const $$ = (rg) => rg.split(":"); const r = $$($("A1:B2"));';
  const out = inlineBundle(HTML, 'body{}', js);
  const m = /<script>\n([\s\S]*?)\n<\/script>/.exec(out);
  assert.ok(m, 'script inline presente');
  assert.doesNotThrow(() => new Script(m[1]), 'il bundle inline deve essere sintatticamente valido');
});
