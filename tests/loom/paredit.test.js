import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pareditSlurp, pareditBarf, pareditSplice, pareditWrap, pareditNewline,
  safeDeletion, indentFor,
} from '../../shared/js/paredit.js';

const apply = (source, edit) => edit && source.slice(0, edit.from) + edit.text + source.slice(edit.to);

test('shared structural operations handle nested forms, strings, and comments', () => {
  assert.equal(apply('(a [b]) c', pareditSlurp('(a [b]) c', 2)), '(a [b] c)');
  assert.equal(apply('(a "x ) y") z', pareditSlurp('(a "x ) y") z', 3)), '(a "x ) y" z)');
  assert.equal(apply('(a b c)', pareditBarf('(a b c)', 3)), '(a b) c');
  assert.equal(apply('(a b)', pareditSplice('(a b)', 3)), 'a b');
  assert.equal(apply('a b', pareditWrap('a b', 0, 0)), '(a) b');
  assert.equal(apply('()', pareditNewline('()', 1)), '(\n  \n)');
  assert.equal(indentFor('(a\n  [b', 7), 4);
});

test('deletion protects delimiter types and ignores delimiters inside strings and comments', () => {
  const source = '(a [b] "c )" ; ] in a comment\n d)';
  assert.equal(safeDeletion(source, source.indexOf('['), source.indexOf('[') + 1), false);
  assert.equal(safeDeletion(source, source.indexOf('[b]'), source.indexOf('[b]') + 3), true);
  assert.equal(safeDeletion(source, source.indexOf('c )') + 2, source.indexOf('c )') + 3), true);
  assert.equal(safeDeletion(source, source.indexOf('] in a comment'), source.indexOf('] in a comment') + 1), true);
  assert.equal(safeDeletion('(a [b])', 0, 7), true);
  assert.equal(safeDeletion('(a [b])', 0, 5), false);
});

test('mismatched partial forms are not treated as structural pairs', () => {
  assert.equal(pareditSlurp('(a] b', 2), null);
});

test('slurp and barf keep reader-prefixed forms intact', () => {
  for (const [source, expected] of [
    ['(a) #(inc %)', '(a #(inc %))'],
    ['(a) #{:x}', '(a #{:x})'],
    ['(a) #"x y"', '(a #"x y")'],
    ['(a) #js {:x 1}', '(a #js {:x 1})'],
    ["(a) 'b", "(a 'b)"],
    ['(a) @b', '(a @b)'],
    ['(a) ^:private b', '(a ^:private b)'],
  ]) {
    assert.equal(apply(source, pareditSlurp(source, 2)), expected, source);
  }
  assert.equal(apply('(a #(inc %))', pareditBarf('(a #(inc %))', 2)), '(a) #(inc %)');
  assert.equal(apply('(a #{:x})', pareditBarf('(a #{:x})', 2)), '(a) #{:x}');
  assert.equal(apply('(a #"x y")', pareditBarf('(a #"x y")', 2)), '(a) #"x y"');
});

test('barf preserves comments and keeps the cursor with the moved form', () => {
  const source = '(a b ; note\n c)';
  const barfed = pareditBarf(source, source.indexOf('c'));
  assert.equal(apply(source, barfed), '(a b) ; note\n c');
  assert.equal(barfed.caret, 14);

  const simple = pareditBarf('(a b c)', 5);
  assert.equal(apply('(a b c)', simple), '(a b) c');
  assert.equal(simple.caret, 6);
});
