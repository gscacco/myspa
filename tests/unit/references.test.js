import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colName, colIndex, addr, parseRef, mapRefs, shiftRefs } from '../../src/js/references.js';

test('colName/colIndex sono inverse tra loro', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colIndex('A'), 0);
  assert.equal(colIndex('Z'), 25);
  assert.equal(colIndex('AA'), 26);
  for (let c = 0; c < 60; c++) assert.equal(colIndex(colName(c)), c);
});

test('addr e parseRef sono inverse tra loro', () => {
  assert.equal(addr(0, 0), 'A1');
  assert.equal(addr(9, 26), 'AA10');
  assert.deepEqual(parseRef('AA10'), { r: 9, c: 26 });
});

test('mapRefs elenca i riferimenti con foglio e intervallo', () => {
  const found = [];
  mapRefs('A1 + Foglio2!B3 + C4:D6', x => { found.push(x); return 'x'; });
  assert.equal(found.length, 3);
  assert.deepEqual(found[0], { sh: undefined, ac: '', c: 'A', ar: '', r: 1, b: null });
  assert.deepEqual(found[1], { sh: 'Foglio2', ac: '', c: 'B', ar: '', r: 3, b: null });
  assert.deepEqual(found[2], { sh: undefined, ac: '', c: 'C', ar: '', r: 4, b: { ac: '', c: 'D', ar: '', r: 6 } });
});

test('mapRefs ignora i riferimenti dentro le stringhe', () => {
  const found = [];
  mapRefs('"A1" + B2 + `C3` + \'D4\'', x => { found.push(x.c + x.r); return 'x'; });
  assert.deepEqual(found, ['B2']);
});

test('mapRefs riconosce gli ancoraggi assoluti', () => {
  const found = [];
  mapRefs('$A$1 + $B2 + C$3', x => { found.push([x.ac, x.c, x.ar, x.r]); return 'x'; });
  assert.deepEqual(found, [['$', 'A', '$', 1], ['$', 'B', '', 2], ['', 'C', '$', 3]]);
});

test('shiftRefs sposta solo i riferimenti relativi', () => {
  assert.equal(shiftRefs('=A1', 1, 0), '=A2');
  assert.equal(shiftRefs('=A1', 0, 1), '=B1');
  assert.equal(shiftRefs('=A1+$B$2', 2, 3), '=D3+$B$2');
  assert.equal(shiftRefs('=$A1+B$2', 1, 1), '=$A2+C$2');
});

test('shiftRefs sposta gli intervalli e mantiene il foglio', () => {
  assert.equal(shiftRefs('=SUM(A1:A5)', 1, 0), '=SUM(A2:A6)');
  assert.equal(shiftRefs('=Foglio2!A1', 1, 0), '=Foglio2!A2');
});

test('shiftRefs non tocca le stringhe e applica i limiti minimi', () => {
  assert.equal(shiftRefs('="A1"&B1', 0, 1), '="A1"&C1');
  assert.equal(shiftRefs('=A1', -5, -5), '=A1');
});
