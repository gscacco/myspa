import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pareditSlurp, pareditBarf, pareditSplice, pareditWrap, pareditNewline, indentFor, safeDeletion, formBefore } from '../../src/js/editor-assistance.js';

/** Applica il risultato di un comando paredit al testo. */
const ap = (t, r) => (r ? t.slice(0, r.from) + r.text + t.slice(r.to) : null);

test('slurp tira la forma successiva dentro la lista', () => {
  assert.equal(ap('(a b) c', pareditSlurp('(a b) c', 4)), '(a b c)');
  assert.equal(ap('(a)  (b c)', pareditSlurp('(a)  (b c)', 2)), '(a  (b c))');
  assert.equal(ap('(a) "x y"', pareditSlurp('(a) "x y"', 2)), '(a "x y")');
  assert.equal(pareditSlurp('(a)', 2), null, 'nulla da tirare');
  assert.equal(pareditSlurp('a b', 1), null, 'fuori da una lista');
});

test('barf spinge fuori l’ultima forma', () => {
  assert.equal(ap('(a b c)', pareditBarf('(a b c)', 3)), '(a b) c');
  assert.equal(ap('(a b)', pareditBarf('(a b)', 3)), '(a) b');
  assert.equal(ap('(a)', pareditBarf('(a)', 2)), '() a');
  assert.equal(ap('(a "x y")', pareditBarf('(a "x y")', 2)), '(a) "x y"');
});

test('splice elimina le parentesi della lista corrente', () => {
  assert.equal(ap('(a b)', pareditSplice('(a b)', 3)), 'a b');
  assert.equal(ap('((a) b)', pareditSplice('((a) b)', 2)), '(a b)', 'agisce sulla lista più interna');
  assert.equal(pareditSplice('a b', 1), null);
});

test('wrap avvolge la selezione o la forma successiva', () => {
  assert.equal(ap('a b', pareditWrap('a b', 0, 0)), '(a) b');
  assert.equal(ap('a b', pareditWrap('a b', 0, 3)), '(a b)');
  assert.equal(ap('(+ 1 2)', pareditWrap('(+ 1 2)', 1, 6)), '((+ 1 2))');
});

test('wrap imposta la selezione sul contenuto', () => {
  const r = pareditWrap('a b', 0, 3);
  assert.equal(r.caret, 1);
  assert.equal(r.selEnd, 4);
});

test('newline apre due righe fra parentesi vuote', () => {
  const r = pareditNewline('()', 1);
  assert.equal(r.text, '\n  \n');
  assert.equal(ap('()', r), '(\n  \n)');
  assert.equal(r.caret, 4);
});

test('newline indenta in base al livello di annidamento', () => {
  assert.equal(ap('(x)', pareditNewline('(x)', 1)), '(\n  x)');
  assert.equal(ap('(a (b)', pareditNewline('(a (b)', 5)), '(a (b\n    )');
});

test('indentFor conta i livelli aperti', () => {
  assert.equal(indentFor('(defn f [x]', 12), 2);
  assert.equal(indentFor('(a (b', 5), 4);
  assert.equal(indentFor('(a ")" (b', 9), 4, 'le parentesi nelle stringhe non contano');
});

test('i comandi paredit agiscono anche con il cursore subito dopo la «)»', () => {
  assert.equal(ap('(a b) c', pareditSlurp('(a b) c', 5)), '(a b c)');
  assert.equal(ap('(a b c)', pareditBarf('(a b c)', 7)), '(a b) c');
  assert.equal(ap('(a b) c', pareditSplice('(a b) c', 5)), 'a b c');
  assert.equal(ap('(f (g) h)', pareditSplice('(f (g) h)', 6)), '(f g h)', 'vince la lista appena chiusa');
});

test('safeDeletion protegge solo le cancellazioni che romperebbero la simmetria', () => {
  assert.equal(safeDeletion('(a b)', 1, 2), true, 'testo normale');
  assert.equal(safeDeletion('(a b)', 3, 3), true, 'nessuna cancellazione');
  assert.equal(safeDeletion('(a b)', 0, 1), false, 'sola parentesi aperta');
  assert.equal(safeDeletion('(a b)', 4, 5), false, 'sola parentesi chiusa');
  assert.equal(safeDeletion('(a b)', 0, 5), true, 'una lista intera resta bilanciata');
  assert.equal(safeDeletion('(a (b) c)', 3, 6), true, 'una sotto-lista intera');
  assert.equal(safeDeletion('(a (b) c)', 3, 5), false, 'sotto-lista tagliata a metà');
  assert.equal(safeDeletion('[x] {y}', 0, 3), true);
  assert.equal(safeDeletion('ab', -1, 0), true, 'inizio del testo');
  assert.equal(safeDeletion('(str "a")', 5, 6), false, 'una sola virgoletta');
  assert.equal(safeDeletion('(str "a")', 5, 8), true, 'una stringa intera');
  assert.equal(safeDeletion('(str "a)")', 5, 9), true, 'parentesi dentro una stringa');
});

test('formBefore trova la forma che termina prima del cursore', () => {
  const form = '(defn f [x] (* x 2))';
  assert.deepEqual(formBefore(form, form.length), { from: 0, to: form.length, text: form });
  assert.equal(formBefore('(def A 1) (def B 2)', 19).text, '(def B 2)');
  assert.equal(formBefore('(a)   \n', 6).text, '(a)', 'spazi e righe vuote finali ignorati');
  assert.equal(formBefore('(f (g) h)', 7).text, '(g)', 'la forma più interna che termina lì');
  assert.equal(formBefore('(str "a)b")', 10).text, '"a)b"', 'le parentesi nelle stringhe non contano');
  assert.equal(formBefore('(str "a)b")', 11).text, '(str "a)b")');
  assert.equal(formBefore('(a b)   ' + 'c', 9).text, 'c', 'anche un atomo');
  assert.equal(formBefore('(a', 3).text, 'a');
});

test('formBefore restituisce null quando non c’è una forma', () => {
  assert.equal(formBefore('', 0), null);
  assert.equal(formBefore('   \n ', 4), null);
  assert.equal(formBefore('(a b)', 1), null, 'subito dopo la parentesi aperta');
  assert.equal(formBefore('(a b', 0), null);
  assert.equal(formBefore('"x', 1), null, 'dentro una stringa non chiusa');
});

test('formBefore ignora i commenti', () => {
  const code = '(def A 1) ; (non una forma))';
  assert.equal(formBefore(code, code.length).text, '(def A 1)');
  assert.equal(formBefore('(def A 1)\n; nota', 16).text, '(def A 1)');
});
