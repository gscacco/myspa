import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbook, addSheet, setRaw } from '../../src/js/model.js';
import { createEngine, buildBuiltins } from '../../src/js/engine.js';
import { workbook as sampleWorkbook } from '../helpers/sample.js';

/** Crea un motore pronto all'uso su un workbook. */
function engineWith(wb) {
  const engine = createEngine(wb);
  engine.loadAll();
  engine.recalculate();
  return engine;
}

test('buildBuiltins espone Math e le funzioni del foglio', () => {
  const B = buildBuiltins();
  assert.equal(B.PI, Math.PI);
  assert.equal(B.SUM(1, 2, 3), 6);
  assert.equal(B.SUM([1, 2], [[3]]), 6);
  assert.equal(B.COUNT(1, 'x', 2), 2);
  assert.equal(B.AVG(2, 4), 3);
  assert.equal(B.AVERAGE(2, 4), 3);
  assert.equal(B.MIN(3, 1, 2), 1);
  assert.equal(B.MAX(3, 1, 2), 3);
  assert.equal(B.ROUND(1.2345, 2), 1.23);
  assert.equal(B.IF(true, 'a', 'b'), 'a');
});

test('valori letterali e formule di base', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 2 }, A2: { r: 3 }, A3: { r: '=A1*A2' } } }] });
  const engine = engineWith(wb);
  assert.equal(engine.evaluate('S!A1'), 2);
  assert.equal(engine.evaluate('S!A3'), 6);
});

test('intervalli, SUM e riferimenti tra fogli', () => {
  const wb = createWorkbook({
    sheets: [
      { name: 'Uno', cells: { A1: { r: 1 }, A2: { r: 2 }, A3: { r: '=SUM(A1:A2)' } } },
      { name: 'Due', cells: { B1: { r: '=Uno!A3*10' } } },
    ],
  });
  const engine = engineWith(wb);
  assert.equal(engine.evaluate('Uno!A3'), 3);
  assert.equal(engine.evaluate('Due!B1'), 30);
});

test('le funzioni utente ClojureScript sono disponibili nelle formule', () => {
  const wb = createWorkbook({
    code: '(def IVA 0.22)\n(defn CONIVA [x] (* x (+ 1 IVA)))',
    sheets: [{ name: 'S', cells: { A1: { r: 100 }, A2: { r: '=CONIVA(A1)' } } }],
  });
  const engine = createEngine(wb);
  assert.equal(engine.setCode(wb.code), null);
  engine.loadAll();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A2'), 122);
});

test('i nomi ClojureScript con trattino sono esposti anche nella forma munged', () => {
  const wb = createWorkbook({
    code: '(defn con-iva [x] (* x 1.22))',
    sheets: [{ name: 'S', cells: { A1: { r: 100 }, A2: { r: '=con_iva(A1)' } } }],
  });
  const engine = createEngine(wb);
  assert.equal(engine.setCode(wb.code), null);
  engine.loadAll();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A2'), 122);
});

test('setCode restituisce un errore di sintassi e mantiene le funzioni incorporate', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=SUM(1,2)' } } }] });
  const engine = engineWith(wb);
  const err = engine.setCode('(defn bad [x]');
  assert.ok(err instanceof Error);
  assert.equal(engine.evaluate('S!A1'), 3);
});

test('ricalcolo incrementale: cambia solo chi dipende dalla cella modificata', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 1 }, A2: { r: '=A1+1' }, A3: { r: '=A2+1' }, B1: { r: 9 } } }] });
  const engine = engineWith(wb);
  assert.equal(engine.evaluate('S!A3'), 3);
  engine.put('S', 'A1', 10);
  const changed = engine.recalculate().map(n => n.id).sort();
  assert.deepEqual(changed, ['S!A1', 'S!A2', 'S!A3']);
  assert.equal(engine.evaluate('S!A3'), 12);
});

test('errore di riferimento circolare', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=B1' }, B1: { r: '=A1' } } }] });
  const engine = engineWith(wb);
  const n = engine.nd('S!A1');
  assert.match(n.err.message, /#CIRC/);
});

test('errore di riferimento a un foglio inesistente', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=Manca!B1' } } }] });
  const engine = engineWith(wb);
  assert.match(engine.nd('S!A1').err.message, /#REF/);
});

test('errore JavaScript in una formula', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=inesistente(1)' } } }] });
  const engine = engineWith(wb);
  assert.match(engine.nd('S!A1').err.message, /inesistente/);
  assert.equal(engine.nd('S!A1').val, null);
});

test('put aggiorna il modello e il valore nullo per celle vuote', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: {} }] });
  const engine = engineWith(wb);
  engine.put('S', 'A1', 5);
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 5);
  engine.put('S', 'A1', undefined);
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), null);
  assert.deepEqual(wb.sheets[0].cells, {});
});

test('il workbook di esempio calcola i valori attesi', () => {
  const engine = engineWith(sampleWorkbook());
  engine.setCode(sampleWorkbook().code);
  engine.invalidateFormulas();
  engine.recalculate();
  const g = id => engine.evaluate(id);
  assert.equal(g('Foglio1!D2'), 150);
  assert.equal(g('Foglio1!E2'), 183);
  assert.equal(g('Foglio1!D6'), 843.8);
  assert.ok(Math.abs(g('Foglio1!D8') - 843.8 / 155) < 1e-9);
  assert.equal(g('Foglio1!D9'), 'Bassa');
  assert.equal(g('Foglio2!D1'), 1029.436);
});

test('setWorkbook azzera il grafo', () => {
  const engine = engineWith(createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 1 } } }] }));
  const other = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: 7 } } }] });
  engine.setWorkbook(other);
  engine.loadAll();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 7);
});

test('una cella appena aggiunta al modello entra nel grafo con loadAll', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: {} }] });
  addSheet(wb, 'T');
  setRaw(wb, 'T', 'C3', '=1+2');
  const engine = createEngine(wb);
  engine.loadAll();
  engine.recalculate();
  assert.equal(engine.evaluate('T!C3'), 3);
});

test('evalForm ridefinisce una definizione senza toccare le altre', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=F(2)' }, A2: { r: '=G(1)' } } }] });
  const engine = engineWith(wb);
  assert.equal(engine.setCode('(defn F [x] (* x 3))\n(defn G [x] (+ x 1))'), null);
  engine.invalidateFormulas();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 6);
  assert.equal(engine.evaluate('S!A2'), 2);

  const r = engine.evalForm('(defn F [x] (* x 4))');
  assert.equal(r.error, null);
  assert.equal(r.value.cljsName, 'F');
  engine.invalidateFormulas();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 8, 'le formule usano la funzione ridefinita');
  assert.equal(engine.evaluate('S!A2'), 2, 'le altre definizioni restano');

  const d = engine.evalForm('(def con-iva 0.5)');
  assert.equal(d.value, 0.5);
  assert.equal(engine.ENV['con-iva'], 0.5);
  assert.equal(engine.ENV.con_iva, 0.5, 'alias munged disponibile alle formule');
});

test('evalForm con errore non altera l\'ambiente', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=F(1)' } } }] });
  const engine = engineWith(wb);
  engine.setCode('(defn F [x] (* x 7))');
  engine.invalidateFormulas();
  engine.recalculate();
  const bad = engine.evalForm('(defn F [x]');
  assert.ok(bad.error instanceof Error);
  assert.deepEqual(bad.defs, {});
  engine.invalidateFormulas();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 7, 'la definizione precedente resta valida');
});


test('evalForm di una costante è vista anche dalle funzioni già definite', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=CONIVA(1)' } } }] });
  const engine = engineWith(wb);
  engine.setCode('(def IVA 0.2)\n(defn CONIVA [x] (* x (+ 1 IVA)))');
  engine.invalidateFormulas();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 1 + 0.2);

  engine.evalForm('(def IVA 0.5)');
  engine.invalidateFormulas();
  engine.recalculate();
  assert.equal(engine.evaluate('S!A1'), 1.5, 'ridefinire la costante aggiorna le funzioni esistenti');
  assert.equal(engine.ENV.IVA, 0.5);
});

test('le formule possono essere codice ClojureScript (=pippo(A2) e =(count …))', () => {
  const wb = createWorkbook({
    code: '(defn pippo [x] (* x 2))',
    sheets: [{ name: 'S', cells: {
      A1: { r: 1 }, A2: { r: 3 }, A3: { r: 4 }, A4: { r: 5 },
      B1: { r: '=pippo(A2)' },               // zucchero per (pippo A2)
      B2: { r: '=(count A1:A3)' },           // codice cljs con riferimento a intervallo
      B3: { r: '=(+ A4 A2)' },               // codice cljs con riferimenti a celle
      B4: { r: '=sheet.core/SUM(A4:A4)' },   // funzione del foglio qualificata
      B5: { r: '=user/pippo(A4)' },          // funzione utente qualificata
    } }],
  });
  const engine = createEngine(wb);
  assert.equal(engine.setCode(wb.code), null);
  engine.loadAll();
  engine.recalculate();
  assert.equal(engine.evaluate('S!B1'), 6);
  assert.equal(engine.evaluate('S!B2'), 3);
  assert.equal(engine.evaluate('S!B3'), 8);
  assert.equal(engine.evaluate('S!B4'), 5);
  assert.equal(engine.evaluate('S!B5'), 10);
});

test('una formula ClojureScript con un simbolo sconosciuto produce un errore #NAME', () => {
  const wb = createWorkbook({ sheets: [{ name: 'S', cells: { A1: { r: '=(sconosciuto 1)' } } }] });
  const engine = engineWith(wb);
  assert.equal(engine.getNode('S!A1').err.message.split(':')[0], '#NAME');
  assert.throws(() => engine.evaluate('S!A1'), /#NAME/);
});

test('le formule infisse restano supportate accanto a quelle in ClojureScript', () => {
  const wb = createWorkbook({
    code: '(defn doppio [x] (* x 2))',
    sheets: [{ name: 'S', cells: { A1: { r: 4 }, B1: { r: '=A1*10-1' }, B2: { r: '=doppio(A1)' } } }],
  });
  const engine = createEngine(wb);
  assert.equal(engine.setCode(wb.code), null);
  engine.loadAll();
  engine.recalculate();
  assert.equal(engine.evaluate('S!B1'), 39, 'formula infissa (percorso JavaScript)');
  assert.equal(engine.evaluate('S!B2'), 8, 'chiamata ClojureScript');
});

