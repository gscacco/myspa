import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbook, getCell, getRaw } from '../../src/js/model.js';
import { createSession } from '../../src/js/workbook.js';

/** Sessione su un foglio vuoto con qualche valore. */
function makeSession() {
  return createSession(createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 1 }, A2: { r: 2 }, B1: { r: 10 } } }] }));
}

test('setCell scrive il valore e restituisce i nodi cambiati', () => {
  const s = makeSession();
  const changed = s.setCell('S', 2, 0, '=A1+A2');
  assert.deepEqual(changed.map(n => n.id).sort(), ['S!A3']);
  assert.equal(getRaw(s.workbook, 'S', 'A3'), '=A1+A2');
  assert.equal(s.engine.evaluate('S!A3'), 3);
  assert.equal(s.isModified(), true);
});

test('setCell con stringa vuota cancella la cella', () => {
  const s = makeSession();
  s.setCell('S', 0, 0, '');
  assert.equal(getRaw(s.workbook, 'S', 'A1'), undefined);
});

test('clearRange svuota l\'intervallo', () => {
  const s = makeSession();
  s.clearRange('S', { r0: 0, r1: 1, c0: 0, c1: 0 });
  assert.equal(getRaw(s.workbook, 'S', 'A1'), undefined);
  assert.equal(getRaw(s.workbook, 'S', 'A2'), undefined);
  assert.equal(getRaw(s.workbook, 'S', 'B1'), 10);
});

test('fillDown copia la prima riga spostando i riferimenti', () => {
  const s = createSession(createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=B1' } } }] }));
  s.fillDown('S', { r0: 0, r1: 2, c0: 0, c1: 0 });
  assert.equal(getRaw(s.workbook, 'S', 'A2'), '=B2');
  assert.equal(getRaw(s.workbook, 'S', 'A3'), '=B3');
});

test('fillDown copia i valori non formula così come sono', () => {
  const s = createSession(createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 7 } } }] }));
  s.fillDown('S', { r0: 0, r1: 1, c0: 0, c1: 0 });
  assert.equal(getRaw(s.workbook, 'S', 'A2'), 7);
});

test('formatRange applica grassetto, decimali e sfondo', () => {
  const s = makeSession();
  const rect = { r0: 0, r1: 0, c0: 0, c1: 0 };
  s.formatRange('S', rect, 'b', true);
  assert.equal(getCell(s.workbook, 'S', 'A1').b, true);
  s.formatRange('S', rect, 'b', true);
  assert.equal(getCell(s.workbook, 'S', 'A1').b, undefined);
  s.formatRange('S', rect, 'd', 2);
  assert.equal(getCell(s.workbook, 'S', 'A1').d, 2);
  s.formatRange('S', rect, 'bg', '#fff');
  assert.equal(getCell(s.workbook, 'S', 'A1').bg, '#fff');
  s.formatRange('S', rect, 'bg', '');
  assert.equal(getCell(s.workbook, 'S', 'A1').bg, undefined);
});

test('formatRange limita i decimali tra 0 e 8', () => {
  const s = makeSession();
  const rect = { r0: 0, r1: 0, c0: 0, c1: 0 };
  for (let i = 0; i < 20; i++) s.formatRange('S', rect, 'd', 1);
  assert.equal(getCell(s.workbook, 'S', 'A1').d, 8);
  for (let i = 0; i < 20; i++) s.formatRange('S', rect, 'd', -1);
  assert.equal(getCell(s.workbook, 'S', 'A1').d, 0);
});

test('formatRange restituisce gli indirizzi toccati', () => {
  const s = makeSession();
  const list = s.formatRange('S', { r0: 0, r1: 1, c0: 0, c1: 1 }, 'b', '');
  assert.deepEqual(list, ['A1', 'B1', 'A2', 'B2']);
});

test('pasteRows con appunti interni sposta i riferimenti', () => {
  const s = makeSession();
  s.pasteRows('S', 1, 1, [['=A1+1']], { internal: true, baseR: 0, baseC: 0 });
  assert.equal(getRaw(s.workbook, 'S', 'B2'), '=B2+1');
});

test('pasteRows da appunti esterni non sposta i riferimenti', () => {
  const s = makeSession();
  s.pasteRows('S', 1, 1, [['=A1+1', '3']], { internal: false });
  assert.equal(getRaw(s.workbook, 'S', 'B2'), '=A1+1');
  assert.equal(getRaw(s.workbook, 'S', 'C2'), 3);
});

test('addNewSheet aggiunge e restituisce l\'indice', () => {
  const s = makeSession();
  const i = s.addNewSheet();
  assert.equal(i, 1);
  assert.deepEqual(s.workbook.sheets.map(x => x.name), ['S', 'Foglio2']);
});

test('deleteSheet elimina il foglio indicato', () => {
  const s = makeSession();
  s.addNewSheet();
  s.deleteSheet(0);
  assert.deepEqual(s.workbook.sheets.map(x => x.name), ['Foglio2']);
});

test('applyCode applica il codice e segnala gli errori di sintassi', () => {
  const s = makeSession();
  const ok = s.applyCode('(defn DOBBIOT [x] (* x 2))');
  assert.equal(ok.error, null);
  s.setCell('S', 0, 3, '=DOBBIOT(21)');
  assert.equal(s.engine.evaluate('S!D1'), 42);
  const bad = s.applyCode('(defn rotto [x]');
  assert.ok(bad.error instanceof Error);
});

test('annulla e ripristina il valore precedente', () => {
  const s = makeSession();
  s.setCell('S', 0, 0, '100');
  assert.equal(getRaw(s.workbook, 'S', 'A1'), 100);
  const undone = s.undo();
  assert.ok(undone);
  s.rebuild();
  assert.equal(getRaw(s.workbook, 'S', 'A1'), 1);
  const redone = s.redo();
  assert.ok(redone);
  s.rebuild();
  assert.equal(getRaw(s.workbook, 'S', 'A1'), 100);
});

test('la cronologia è limitata a 100 passi', () => {
  const s = makeSession();
  for (let i = 0; i < 120; i++) s.setCell('S', 5, 5, String(i));
  assert.equal(s.getHistorySize(), 100);
});

test('replace azzera cronologia e stato modificato', () => {
  const s = makeSession();
  s.setCell('S', 0, 0, '9');
  assert.equal(s.isModified(), true);
  s.replace(createWorkbook({ sheets: [{ name: 'Z', cells: { A1: { r: 4 } } }] }));
  assert.equal(s.isModified(), false);
  assert.equal(s.canUndo(), false);
  s.rebuild();
  assert.equal(s.engine.evaluate('Z!A1'), 4);
});

test('markSaved azzera lo stato modificato', () => {
  const s = makeSession();
  s.setCell('S', 0, 0, '9');
  s.markSaved();
  assert.equal(s.isModified(), false);
});

test('evalForm valuta una forma senza toccare codice salvato e cronologia', () => {
  const s = makeSession();
  s.applyCode('(defn F [x] (* x 2))\n(defn G [x] (+ x 1))');
  s.setCell('S', 0, 3, '=F(3)+G(0)');
  assert.equal(s.engine.evaluate('S!D1'), 7);
  const storico = s.getHistorySize();

  const r = s.evalForm('(defn F [x] (* x 10))');
  assert.equal(r.error, null);
  assert.ok(r.changed.some(n => n.id === 'S!D1'), 'le formule sono ricalcolate');
  assert.equal(s.engine.evaluate('S!D1'), 31, 'la funzione ridefinita è usata dalle formule');
  assert.equal(s.engine.evaluate('S!A1'), 1, 'il resto del foglio non cambia');
  assert.equal(s.workbook.code, '(defn F [x] (* x 2))\n(defn G [x] (+ x 1))', 'il codice salvato non cambia');
  assert.equal(s.getHistorySize(), storico, 'nessun passo di cronologia');

  const d = s.evalForm('(def K 5)');
  assert.equal(d.value, 5);
  assert.equal(s.engine.ENV.K, 5);
});

test('evalForm segnala gli errori senza cambiare l\'ambiente', () => {
  const s = makeSession();
  s.applyCode('(def K 2)');
  const bad = s.evalForm('(defn rotto [x]');
  assert.ok(bad.error instanceof Error);
  assert.equal(bad.value, null);
  assert.deepEqual(bad.changed, []);
  assert.equal(s.engine.ENV.K, 2);
});

