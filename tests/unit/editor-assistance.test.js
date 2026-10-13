import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYWORDS, LITERALS, SHEET_FUNCTIONS, CORE_FUNCTIONS, BUILTIN_SYMBOLS, PAIRS, CLOSERS,
  escapeHTML, highlightClojureScript, extractDeclarations, syntaxError, completionCandidates,
  computeSuggestions, completionInsertion,
} from '../../src/js/editor-assistance.js';

test('le tabelle di simboli contengono i valori attesi', () => {
  assert.ok(KEYWORDS.has('defn'));
  assert.ok(KEYWORDS.has('->>'));
  assert.ok(LITERALS.has('nil'));
  assert.ok(BUILTIN_SYMBOLS.has('SUM'));
  assert.ok(BUILTIN_SYMBOLS.has('map'));
  assert.equal(SHEET_FUNCTIONS.AVERAGE, 'media');
  assert.equal(typeof CORE_FUNCTIONS['flatten'], 'string');
  assert.equal(PAIRS['('], ')');
  assert.equal(PAIRS["'"], undefined, "in ClojureScript ' non è una coppia ma la quote");
  assert.ok(CLOSERS.has(')'));
  assert.equal(escapeHTML('<a & b>'), '&lt;a &amp; b>');
});

test('extractDeclarations trova def, defonce e defn (anche multi-arità)', () => {
  const code = [
    '(def IVA 0.22)',
    '(defonce CACHE {})',
    '(defn CONIVA',
    '  ([x] (CONIVA x IVA))',
    '  ([x r] (* x (+ 1 r))))',
    '(defn media [xs] (/ (SUM xs) (count xs)))',
  ].join('\n');
  const d = extractDeclarations(code);
  assert.deepEqual(d.map(x => x.n), ['IVA', 'CACHE', 'CONIVA', 'media']);
  assert.equal(d[0].d, 'valore');
  assert.equal(d[2].d, '[x] [x r]');
  assert.ok(d[2].f);
  assert.equal(d[3].d, '[xs]');
});

test('extractDeclarations ignora il codice non leggibile', () => {
  assert.deepEqual(extractDeclarations('(defn rotta [x'), []);
});

test('highlightClojureScript riusa i token degli editor ed esegue escaping HTML', () => {
  const html = highlightClojureScript('{:status :active :count 4 :label "<tag>"}', { declarationCode: '(defn my-fn [x] x)' });
  assert.match(html, /class=k>:status<\/i>/);
  assert.match(html, /class=n>4<\/i>/);
  assert.match(html, /class=s>"&lt;tag>"<\/i>/);
  assert.doesNotMatch(html, /<tag>/);
});

test('syntaxError riconosce il codice valido', () => {
  assert.equal(syntaxError('(defn f [x] (* x 2))'), null);
  assert.equal(syntaxError(''), null);
});

test("syntaxError stima la riga dell'errore", () => {
  const e = syntaxError('(def a 1)\n(def b\n(def c 3)');
  assert.ok(e);
  assert.equal(e.line, 2);
});

test('syntaxError segnala le parentesi non chiuse', () => {
  const e = syntaxError('(defn f [x]\n  (* x 2)');
  assert.ok(e);
  assert.match(e.msg, /non chiusa/);
});

test('completionCandidates comprende nucleo, foglio, forme speciali e dichiarazioni', () => {
  const list = completionCandidates('(defn MIA [x] x)');
  const names = list.map(c => c.n);
  assert.ok(names.includes('MIA'));
  assert.ok(names.includes('SUM'));
  assert.ok(names.includes('map'));
  assert.ok(names.includes('defn'));
  assert.equal(names.filter(n => n === 'SUM').length, 1);
});

test('computeSuggestions suggerisce le funzioni del foglio', () => {
  const r = computeSuggestions({ code: 'SU', cursor: 2, hasSelection: false });
  assert.ok(r);
  assert.equal(r.word, 'SU');
  assert.ok(r.list.some(c => c.n === 'SUM'));
});

test('computeSuggestions non mostra nulla senza prefisso', () => {
  assert.equal(computeSuggestions({ code: '(SUM ', cursor: 5, hasSelection: false }), null);
  assert.ok(computeSuggestions({ code: '(SUM ', cursor: 5, hasSelection: false, force: true }));
});

test('computeSuggestions non mostra nulla con una selezione', () => {
  assert.equal(computeSuggestions({ code: 'SU', cursor: 2, hasSelection: true }), null);
});

test('computeSuggestions non mostra nulla nei commenti né nelle stringhe', () => {
  assert.equal(computeSuggestions({ code: '; SUM', cursor: 5, hasSelection: false }), null);
  assert.equal(computeSuggestions({ code: '(str "SUM', cursor: 9, hasSelection: false }), null);
});

test('computeSuggestions propone le dichiarazioni utente', () => {
  const code = '(defn CONIVA [x] (* x 1.22))\nCONI';
  const r = computeSuggestions({ code, cursor: code.length, hasSelection: false });
  assert.ok(r);
  assert.ok(r.list.some(c => c.n === 'CONIVA'));
});

test('completionInsertion inserisce il simbolo senza parentesi', () => {
  const r = completionInsertion({ n: 'SUM' }, 'SU', 2, 'SU');
  assert.deepEqual(r, { text: 'SUM', from: 0, to: 2, caret: 3 });
});
