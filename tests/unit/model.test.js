import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROWS, COLS, createWorkbook, sheetByName, getCell, getRaw, setRaw,
  addSheet, removeSheet, uniqueSheetName, parseInput,
} from '../../src/js/model.js';

test('le dimensioni della griglia sono quelle storiche', () => {
  assert.equal(ROWS, 100);
  assert.equal(COLS, 26);
});

test('createWorkbook normalizza i campi mancanti', () => {
  const wb = createWorkbook();
  assert.equal(wb.version, 1);
  assert.equal(wb.name, 'Foglio di calcolo');
  assert.equal(wb.code, '');
  assert.deepEqual(wb.sheets, [{ name: 'Foglio1', cells: {} }]);
});

test('createWorkbook copia le celle senza condividere i riferimenti', () => {
  const src = { sheets: [{ name: 'S', cells: { A1: { r: 1 } } }] };
  const wb = createWorkbook(src);
  wb.sheets[0].cells.A1.r = 2;
  assert.equal(src.sheets[0].cells.A1.r, 1);
});

test('sheetByName/getCell/getRaw leggono il modello', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 'x', b: true } } }] });
  assert.equal(sheetByName(wb, 'S').name, 'S');
  assert.equal(sheetByName(wb, 'X'), undefined);
  assert.deepEqual(getCell(wb, 'S', 'A1'), { r: 'x', b: true });
  assert.equal(getRaw(wb, 'S', 'A1'), 'x');
  assert.equal(getRaw(wb, 'S', 'B9'), undefined);
});

test('setRaw scrive e cancella mantenendo il formato', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 1, b: true } } }] });
  setRaw(wb, 'S', 'A1', 5);
  assert.deepEqual(getCell(wb, 'S', 'A1'), { r: 5, b: true });
  setRaw(wb, 'S', 'A1', undefined);
  assert.deepEqual(getCell(wb, 'S', 'A1'), { b: true });
  setRaw(wb, 'S', 'A1', undefined);
  assert.deepEqual(getCell(wb, 'S', 'A1'), { b: true });
});

test('setRaw elimina la cella quando non resta nulla', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: {} }] });
  setRaw(wb, 'S', 'A1', 'x');
  assert.deepEqual(wb.sheets[0].cells, { A1: { r: 'x' } });
  setRaw(wb, 'S', 'A1', undefined);
  assert.deepEqual(wb.sheets[0].cells, {});
});

test('setRaw su un foglio inesistente non fa nulla', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: {} }] });
  assert.equal(setRaw(wb, 'Manca', 'A1', 1), undefined);
});

test('addSheet/removeSheet gestiscono i fogli', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: {} }] });
  addSheet(wb, 'T');
  assert.deepEqual(wb.sheets.map(s => s.name), ['S', 'T']);
  assert.equal(removeSheet(wb, 0).name, 'S');
  assert.deepEqual(wb.sheets.map(s => s.name), ['T']);
});

test('uniqueSheetName propone un nome libero', () => {
  const wb = createWorkbook({ sheets: [{ name: 'Foglio1', cells: {} }, { name: 'Foglio2', cells: {} }] });
  assert.equal(uniqueSheetName(wb, 'Foglio'), 'Foglio3');
  addSheet(wb, 'Foglio3');
  assert.equal(uniqueSheetName(wb, 'Foglio'), 'Foglio4');
});

test('parseInput interpreta il testo digitato', () => {
  assert.equal(parseInput(''), undefined);
  assert.equal(parseInput('=A1+1'), '=A1+1');
  assert.equal(parseInput('12'), 12);
  assert.equal(parseInput(' 1.5 '), 1.5);
  assert.equal(parseInput('-3'), -3);
  assert.equal(parseInput('.5'), 0.5);
  assert.equal(parseInput('1e3'), 1000);
  assert.equal(parseInput('ciao'), 'ciao');
  assert.equal(parseInput('12abc'), '12abc');
});
