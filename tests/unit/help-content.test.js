import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreBuiltins } from '../../src/js/cljs.js';
import { HELP_ENTRIES } from '../../src/js/help-content.js';
import { completionCandidates } from '../../src/js/editor-assistance.js';

test('every help entry has a unique id, explanation, and copyable example', () => {
  assert.ok(HELP_ENTRIES.length > 100);
  assert.equal(new Set(HELP_ENTRIES.map(entry => entry.id)).size, HELP_ENTRIES.length);
  for (const entry of HELP_ENTRIES) {
    assert.ok(entry.category && entry.name && entry.description, `document ${entry.name}`);
    assert.ok(entry.example, `example for ${entry.name}`);
  }
});

test('the help catalog covers every function exposed by the ClojureScript runtime', () => {
  const documented = new Set(HELP_ENTRIES.filter(entry => entry.kind === 'function').map(entry => entry.name));
  for (const name of Object.keys(coreBuiltins())) assert.ok(documented.has(name), `${name} is documented`);
  for (const name of ['SUM', 'COUNT', 'MIN', 'MAX', 'AVG', 'AVERAGE', 'ROUND', 'IF', '$', '$$', 'log!', 'add-hook', 'remove-hook', 'run-hook', 'clear-hook', 'list-hooks', 'style-range!', 'clear-range-style!', 'set-status!', 'clear-status!']) {
    assert.ok(documented.has(name), `${name} is documented`);
  }
});

test('inline completion uses the same documentation for functions, forms, and system keywords', () => {
  const candidates = new Map(completionCandidates('').map(candidate => [candidate.n, candidate]));
  for (const entry of HELP_ENTRIES.filter(item => ['function', 'form', 'keyword'].includes(item.kind))) {
    assert.ok(candidates.has(entry.name), `completion candidate ${entry.name}`);
    assert.ok(candidates.get(entry.name).d.includes(entry.description), `inline documentation for ${entry.name}`);
  }
});

test('the reference documents selection hooks, event payload keywords, and all key syntax forms', () => {
  const names = new Set(HELP_ENTRIES.map(entry => entry.name));
  for (const name of [
    'loop', 'recur', 'get-in', 'group-by', 'log!', 'add-hook', 'remove-hook',
    'run-hook', 'clear-hook', 'list-hooks', ':on-selection-change', ':on-cell-source-change',
    ':on-cell-value-change', ':on-cell-evaluation-error', ':cell', ':old-source', ':new-source',
    ':old-value', ':new-value', ':previous-value-available?', ':expression', ':error', ':info',
    ':warn', ':error', ':debug', ':category', ':details', ':exception',
    ':previous-selection', ':selection', ':range', ':background', ':color', ':bold',
    ':italic', ':underline', ':font-size', ':font-family', ':border-color', ':border-width', ':border-style',
    'case', 'as->', 'finally',
  ]) assert.ok(names.has(name), `${name} is documented`);
});

test('the add-hook help example logs both the previous and current selection', () => {
  const addHook = HELP_ENTRIES.find(entry => entry.kind === 'function' && entry.name === 'add-hook');
  assert.match(addHook.example, /\(fn \[event\]/);
  assert.match(addHook.example, /\[:data :previous-selection\]/);
  assert.match(addHook.example, /\[:data :selection\]/);
  assert.match(addHook.example, /\(log! :info/);
  assert.match(addHook.example, /:details \{:previous-selection previous\s+:selection current\}/);
});
