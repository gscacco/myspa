import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbook } from '../../src/js/model.js';
import { createEngine } from '../../src/js/engine.js';

test('formula errors are logged with cell and expression context once per unchanged failure', () => {
  const workbook = createWorkbook({ sheets: [{ name: 'S', cells: {
    A1: { r: '(missing-function 1)' }, A2: { r: '(+ A1 1)' },
  } }] });
  const logged = [];
  const engine = createEngine(workbook, { log: (...args) => logged.push(args) });
  engine.loadAll();
  engine.recalculate();
  engine.invalidateFormulas();
  engine.recalculate();

  assert.equal(logged.length, 1, 'a propagated error does not create a duplicate diagnostic');
  assert.equal(logged[0][0], 'error');
  assert.equal(logged[0][1], engine.nd('S!A1').err.message);
  assert.deepEqual(logged[0][2].source, { cell: 'S!A1' });
  assert.equal(logged[0][2].details.expression, '(missing-function 1)');
  assert.ok(logged[0][2].exception.stack);
  assert.equal(engine.nd('S!A2').err, engine.nd('S!A1').err);
});

test('ClojureScript log! writes through the active runtime bridge with optional metadata', () => {
  const workbook = createWorkbook({ sheets: [{ name: 'S', cells: {} }] });
  const logged = [];
  const engine = createEngine(workbook, { log: (...args) => logged.push(args) });

  assert.equal(engine.setCode('(log! :warn "Loaded records" {:category :data :source {:operation "import"}})'), null);
  assert.equal(logged[0][0], 'warn');
  assert.equal(logged[0][1], 'Loaded records');
  assert.equal(logged[0][2].category, 'data');
  assert.deepEqual(logged[0][2].source, { operation: 'import' });

  engine.put('S', 'A1', '(log! :info "Evaluated" {:category :exec})');
  engine.recalculate();
  engine.invalidateFormulas();
  engine.recalculate();
  const formulaLog = logged.find(entry => entry[1] === 'Evaluated');
  assert.equal(formulaLog[0], 'info');
  assert.deepEqual(formulaLog[2].source, { cell: 'S!A1' });
  assert.equal(logged.filter(entry => entry[1] === 'Evaluated').length, 1, 'unchanged formulas do not flood the buffer on recalculation');
});
