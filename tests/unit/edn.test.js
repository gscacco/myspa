import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEDN, writeEDN } from '../../src/js/edn.js';
import { modelEDN, workbook } from '../helpers/sample.js';

test('readEDN legge scalari, nil e booleani', () => {
  assert.equal(readEDN('nil'), null);
  assert.equal(readEDN('true'), true);
  assert.equal(readEDN('false'), false);
  assert.equal(readEDN('42'), 42);
  assert.equal(readEDN('-3.5'), -3.5);
  assert.equal(readEDN('1e3'), 1000);
  assert.equal(readEDN('ciao'), 'ciao');
});

test('readEDN legge keyword come stringhe', () => {
  assert.deepEqual(readEDN('{:r "x"}'), { r: 'x' });
  assert.deepEqual(readEDN('{:a 1 :b {:c 2}}'), { a: 1, b: { c: 2 } });
});

test('readEDN ignora virgole e commenti', () => {
  assert.deepEqual(readEDN('; commento\n {:a 1, :b 2}'), { a: 1, b: 2 });
  assert.deepEqual(readEDN('[1, 2, 3] ; fine'), [1, 2, 3]);
});

test('readEDN gestisce gli escape nelle stringhe', () => {
  assert.equal(readEDN('"a\\nb\\tc"'), 'a\nb\tc');
  assert.equal(readEDN('"virgolette \\" dentro"'), 'virgolette " dentro');
  assert.equal(readEDN('"\\u0041"'), 'A');
});

test('writeEDN scrive nil per null/undefined e String per i primitivi', () => {
  assert.equal(writeEDN(null), 'nil');
  assert.equal(writeEDN(undefined), 'nil');
  assert.equal(writeEDN(12), '12');
  assert.equal(writeEDN(true), 'true');
});

test('writeEDN sopprime le proprietà undefined', () => {
  assert.equal(writeEDN({ a: 1, b: undefined }), '{\n  :a 1\n}');
});

test('writeEDN protegge la sequenza di chiusura script', () => {
  const out = writeEDN('x</script>y');
  assert.ok(!out.includes('</script'));
  assert.equal(readEDN(out), 'x</script>y');
});

test('round-trip del modello di esempio', () => {
  const wb = workbook();
  const again = readEDN(writeEDN(wb, 0));
  assert.equal(writeEDN(again, 0), writeEDN(wb, 0));
});

test('il modello di esempio contiene i fogli e il codice utente', () => {
  const wb = readEDN(modelEDN());
  assert.equal(wb.sheets.length, 2);
  assert.equal(wb.sheets[0].name, 'Foglio1');
  assert.equal(wb.sheets[1].name, 'Foglio2');
  assert.ok(wb.code.includes('WITH_TAX'));
});
