import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, evaluate, readForms, readError, declarations, munge, coreBuiltins, sheetCoreVars, CLJSError } from '../../src/js/cljs.js';

test('munge converte i nomi ClojureScript in nomi usabili da JavaScript', () => {
  assert.equal(munge('con-iva'), 'con_iva');
  assert.equal(munge('pronto?'), 'pronto_QMARK_');
  assert.equal(munge('scatta!'), 'scatta_BANG_');
  assert.equal(munge('SUM'), 'SUM');
});

test('readForms riconosce numeri, stringhe, keyword, vettori e mappe', () => {
  const forms = readForms('42 -1.5 2e3 "ciao\\n" :chiave [1 2] {:a 1}');
  assert.equal(forms.length, 7);
  assert.deepEqual(evaluate('42'), 42);
  assert.equal(evaluate('-1.5'), -1.5);
  assert.equal(evaluate('2e3'), 2000);
  assert.equal(evaluate('"ciao\\n"'), 'ciao\n');
  assert.equal(evaluate(':chiave'), 'chiave');
  assert.deepEqual(evaluate('[1 2 3]'), [1, 2, 3]);
  assert.deepEqual(evaluate('{:a 1 :b 2}'), { a: 1, b: 2 });
  assert.equal(evaluate('nil'), null);
  assert.equal(evaluate('true'), true);
});

test('aritmetica e confronti', () => {
  assert.equal(evaluate('(+ 1 2 3)'), 6);
  assert.equal(evaluate('(- 10 4)'), 6);
  assert.equal(evaluate('(- 5)'), -5);
  assert.equal(evaluate('(* 2 3 4)'), 24);
  assert.equal(evaluate('(/ 8 2)'), 4);
  assert.equal(evaluate('(mod 7 3)'), 1);
  assert.equal(evaluate('(inc 4)'), 5);
  assert.equal(evaluate('(min [3 1 2])'), 1);
  assert.equal(evaluate('(< 1 2 3)'), true);
  assert.equal(evaluate('(< 1 3 2)'), false);
  assert.equal(evaluate('(not= 1 2)'), true);
  assert.equal(evaluate('(= [1 2] [1 2])'), true);
});

test('def, defn e scope', () => {
  const r = interpret('(def IVA 0.22)\n(defn con-iva [x] (* x (+ 1 IVA)))');
  assert.equal(r.error, null);
  assert.equal(r.defs.IVA, 0.22);
  assert.equal(r.defs['con-iva'](100), 122);
  assert.equal(r.defs.con_iva(100), 122, 'alias munged disponibile per le formule');
});

test('let, if, when, cond e threading', () => {
  assert.equal(evaluate('(let [x 3 y 4] (+ x y))'), 7);
  assert.equal(evaluate('(if (> 3 2) "sì" "no")'), 'sì');
  assert.equal(evaluate('(when false 1)'), null);
  assert.equal(evaluate('(cond (< 1 0) :a (> 1 0) :b :else :c)'), 'b');
  assert.equal(evaluate('(and 1 2 3)'), 3);
  assert.equal(evaluate('(or false nil 7)'), 7);
  assert.deepEqual(evaluate('(-> 5 inc (* 2))'), 12);
  assert.deepEqual(evaluate('(->> [3 1 2] (sort) (map inc))'), [2, 3, 4]);
});

test('collezioni: map, filter, reduce, flatten, str', () => {
  assert.deepEqual(evaluate('(map inc [1 2 3])'), [2, 3, 4]);
  assert.deepEqual(evaluate('(map * [1 2] [10 20])'), [10, 40]);
  assert.deepEqual(evaluate('(filter odd? [1 2 3 4])'), [1, 3]);
  assert.equal(evaluate('(reduce + 0 [1 2 3 4])'), 10);
  assert.deepEqual(evaluate('(flatten [[1] [2 3] [[4]]])'), [1, 2, 3, 4]);
  assert.equal(evaluate('(count [1 2 3])'), 3);
  assert.equal(evaluate('(nth [10 20 30] 1)'), 20);
  assert.equal(evaluate('(get {:a 5} :a)'), 5);
  assert.equal(evaluate('(str "x=" 1 nil "!")'), 'x=1!');
  assert.deepEqual(evaluate('(assoc {:a 1} :b 2)'), { a: 1, b: 2 });
});

test('varargs e funzioni multi-arità', () => {
  assert.equal(evaluate('(defn somma [x & xs] (SUM x xs)) (somma 1 2 3 4)'), 10);
  const r = interpret('(defn saluta ([n] (saluta n "!")) ([n p] (str "Ciao " n p)))');
  assert.equal(r.defs.saluta('Anna'), 'Ciao Anna!');
  assert.equal(r.defs.saluta('Anna', '?'), 'Ciao Anna?');
});

test('quote e commenti', () => {
  assert.deepEqual(evaluate("(map first '([1 2] [3 4]))"), [1, 3]);
  assert.equal(evaluate('; commento\n(+ 1 1)'), 2);
  assert.equal(evaluate('(comment (* 9 9)) (+ 0 1)'), 1);
});

test('le funzioni del foglio sono raggiungibili dal codice utente', () => {
  const r = interpret('(defn media-pesata [v p] (/ (SUM (map * (flatten v) (flatten p))) (SUM p)))', { SUM: (...a) => a.flat(Infinity).filter(x => typeof x === 'number').reduce((x, y) => x + y, 0) });
  assert.equal(r.error, null);
  assert.equal(r.defs['media-pesata']([[2], [4]], [[1], [3]]), 3.5);
});

test('gli errori riportano la riga del sorgente', () => {
  const e1 = readError('(def a 1)\n(defn b [x]');
  assert.ok(e1 instanceof CLJSError);
  assert.equal(e1.line, 2);
  const r = interpret('(def a 1)\n(def b (:chiave-mancante))');
  assert.ok(r.error);
});

test('un simbolo non definito produce un errore #NAME', () => {
  const r = interpret('(defn f [x] (inesistente x))');
  assert.equal(r.error, null, 'il corpo non è valutato alla definizione');
  assert.throws(() => r.defs.f(1), /#NAME/);
});

test('coreBuiltins espone aritmetica e collezioni; il foglio sta in sheet.core', () => {
  const B = coreBuiltins();
  assert.equal(B['+'](1, 2), 3);
  assert.deepEqual(B.flatten([[1], [2]]), [1, 2]);
  assert.equal(B.SUM, undefined, 'le funzioni del foglio non fanno parte di cljs.core');
  const S = sheetCoreVars();
  assert.equal(S.SUM(1, 2, [3]), 6);
  assert.equal(S.ROUND(1.2345, 2), 1.23);
});

test('le funzioni del foglio sono definite in ClojureScript nel namespace sheet.core', () => {
  assert.equal(evaluate('(SUM 1 2 3)'), 6);
  assert.equal(evaluate('(SUM [1 2] [[3]])'), 6);
  assert.equal(evaluate('(COUNT 1 "x" 2)'), 2);
  assert.equal(evaluate('(AVG 2 4)'), 3);
  assert.equal(evaluate('(AVERAGE 2 4)'), 3);
  assert.equal(evaluate('(MIN 3 1 2)'), 1);
  assert.equal(evaluate('(MAX 3 1 2)'), 3);
  assert.equal(evaluate('(ROUND 1.2345 2)'), 1.23);
  assert.equal(evaluate('(IF true "a" "b")'), 'a');
  assert.equal(evaluate('(sheet.core/SUM 1 2 3)'), 6, 'qualificabile col namespace');
});

test('i namespace sheet.core e user sono visibili al codice utente', () => {
  const r = interpret('(ns user)\n(defn DOPPIO [x] (* x 2))\n(user/DOPPIO (sheet.core/SUM 1 2))');
  assert.equal(r.error, null);
  assert.equal(r.value, 6);
  assert.ok(r.scope.registry.get('user').has('DOPPIO'));
  assert.ok(r.scope.registry.get('sheet.core').has('SUM'));
  assert.equal(r.vars.DOPPIO, r.defs.DOPPIO, 'le var di user sono visibili nello scope piatto');
});

test('il workbook di esempio in ClojureScript produce i valori attesi', async () => {
  const { workbook } = await import('../helpers/sample.js');
  const wb = workbook();
  const r = interpret(wb.code);
  assert.equal(r.error, null);
  assert.equal(r.defs.WITH_TAX(150), 183);
  const v = r.defs.WEIGHTED_AVERAGE([[1.5], [3.2], [24.9], [89]], [[100], [40], [12], [3]]);
  assert.ok(Math.abs(v - 843.8 / 155) < 1e-12);
});
