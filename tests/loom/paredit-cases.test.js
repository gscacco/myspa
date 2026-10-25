import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as paredit from '../../shared/js/paredit.js';

const COMMANDS = {
  'forward slurp': 'pareditSlurp',
  'backward slurp': 'pareditBackwardSlurp',
  'forward barf': 'pareditBarf',
  'backward barf': 'pareditBackwardBarf',
};

function marked(source) {
  const cursor = source.indexOf('|');
  assert.notEqual(cursor, -1, `missing cursor marker in ${source}`);
  return { text: source.slice(0, cursor) + source.slice(cursor + 1), cursor };
}

function apply(source, edit) {
  return source.slice(0, edit.from) + edit.text + source.slice(edit.to);
}

function assertCommand(command, input, expected) {
  const name = COMMANDS[command];
  assert.equal(typeof paredit[name], 'function', `${command} command is not implemented`);
  const actual = marked(input);
  const result = marked(expected);
  const edit = paredit[name](actual.text, actual.cursor);
  assert.ok(edit, `${command} returned no edit`);
  assert.equal(apply(actual.text, edit), result.text, `${command} text`);
  assert.equal(edit.caret, result.cursor, `${command} cursor`);
}

test('forward and backward slurp/barf match the core cursor cases', async t => {
  const cases = [
    ['forward slurp', '(foo |bar) baz', '(foo |bar baz)'],
    ['forward slurp with nested list', '(foo |bar) (baz qux)', '(foo |bar (baz qux))'],
    ['backward slurp', 'baz (foo |bar)', '(baz foo |bar)'],
    ['backward slurp with nested list', '(baz qux) (foo |bar)', '((baz qux) foo |bar)'],
    ['forward barf', '(foo |bar baz)', '(foo |bar) baz'],
    ['forward barf with nested list', '(foo |bar (baz qux))', '(foo |bar) (baz qux)'],
    ['backward barf', '(baz foo |bar)', 'baz (foo |bar)'],
    ['backward barf with nested list', '((baz qux) foo |bar)', '(baz qux) (foo |bar)'],
  ];
  for (const [label, input, expected] of cases) {
    await t.test(label, () => assertCommand(label.replace(' with nested list', ''), input, expected));
  }
});

test('forward and backward commands match nested cursor cases', async t => {
  const cases = [
    ['forward slurp', '(outer (foo |bar) baz)', '(outer (foo |bar baz))'],
    ['backward slurp', '(outer baz (foo |bar))', '(outer (baz foo |bar))'],
    ['forward barf', '(outer (foo |bar baz))', '(outer (foo |bar) baz)'],
    ['backward barf', '(outer (baz foo |bar))', '(outer baz (foo |bar))'],
    ['forward slurp two levels deep', '(outer (middle (foo |bar) baz))', '(outer (middle (foo |bar baz)))'],
    ['backward slurp two levels deep', '(outer (middle baz (foo |bar)))', '(outer (middle (baz foo |bar)))'],
    ['forward barf two levels deep', '(outer (middle (foo |bar baz)))', '(outer (middle (foo |bar) baz))'],
    ['backward barf two levels deep', '(outer (middle (baz foo |bar)))', '(outer (middle baz (foo |bar)))'],
  ];
  for (const [label, input, expected] of cases) {
    await t.test(label, () => assertCommand(label.replace(/ two levels deep$/, ''), input, expected));
  }
});

test('repeated forward slurp and barf keep the cursor in place', () => {
  const slurpSteps = ['(a |b) c d', '(a |b c) d', '(a |b c d)'];
  for (let index = 1; index < slurpSteps.length; index++) {
    assertCommand('forward slurp', slurpSteps[index - 1], slurpSteps[index]);
  }
  const barfSteps = ['(a |b c d)', '(a |b c) d', '(a |b) c d'];
  for (let index = 1; index < barfSteps.length; index++) {
    assertCommand('forward barf', barfSteps[index - 1], barfSteps[index]);
  }
});

test('repeated commands inside a nested list keep the cursor in place', () => {
  const slurpSteps = ['(outer (foo |bar) baz qux)', '(outer (foo |bar baz) qux)', '(outer (foo |bar baz qux))'];
  for (let index = 1; index < slurpSteps.length; index++) {
    assertCommand('forward slurp', slurpSteps[index - 1], slurpSteps[index]);
  }
  const barfSteps = ['(outer (foo |bar baz qux))', '(outer (foo |bar baz) qux)', '(outer (foo |bar) baz qux)'];
  for (let index = 1; index < barfSteps.length; index++) {
    assertCommand('forward barf', barfSteps[index - 1], barfSteps[index]);
  }
});

test('all commands support square and curly delimiters', async t => {
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const cases = [
      ['forward slurp', `${open}foo |bar${close} baz`, `${open}foo |bar baz${close}`],
      ['backward slurp', `baz ${open}foo |bar${close}`, `${open}baz foo |bar${close}`],
      ['forward barf', `${open}foo |bar baz${close}`, `${open}foo |bar${close} baz`],
      ['backward barf', `${open}baz foo |bar${close}`, `baz ${open}foo |bar${close}`],
      ['forward slurp with nested list', `${open}foo |bar${close} ${open}baz qux${close}`, `${open}foo |bar ${open}baz qux${close}${close}`],
      ['backward slurp with nested list', `${open}baz qux${close} ${open}foo |bar${close}`, `${open}${open}baz qux${close} foo |bar${close}`],
      ['forward barf with nested list', `${open}foo |bar ${open}baz qux${close}${close}`, `${open}foo |bar${close} ${open}baz qux${close}`],
      ['backward barf with nested list', `${open}${open}baz qux${close} foo |bar${close}`, `${open}baz qux${close} ${open}foo |bar${close}`],
    ];
    for (const [label, input, expected] of cases) {
      await t.test(`${open}${close} ${label}`, () => assertCommand(label.replace(' with nested list', ''), input, expected));
    }
  }
});

test('all commands keep mixed nested delimiter pairs balanced', async t => {
  const cases = [
    ['forward slurp', '(foo |bar) [baz qux]', '(foo |bar [baz qux])'],
    ['backward slurp', '[baz qux] (foo |bar)', '([baz qux] foo |bar)'],
    ['forward barf', '(foo |bar [baz qux])', '(foo |bar) [baz qux]'],
    ['backward barf', '([baz qux] foo |bar)', '[baz qux] (foo |bar)'],
  ];
  for (const [command, input, expected] of cases) {
    await t.test(command, () => assertCommand(command, input, expected));
  }
});

test('forward slurp skips a closed inner collection when only its parent can slurp', () => {
  assertCommand('forward slurp', '(a [b]|) c', '(a [b]| c)');
  const input = '(let [n 10]|)[:ol\n (for [n (range 1 11)]\n   [:li (str "Item " n)])]';
  const expected = '(let [n 10]|[:ol\n (for [n (range 1 11)]\n   [:li (str "Item " n)])])';
  assertCommand('forward slurp', input, expected);
});

test('boundary cases return no edit and leave the source unchanged', async t => {
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    for (const [command, source] of [
      ['forward slurp', `${open}foo |bar${close}`],
      ['backward slurp', `${open}foo |bar${close}`],
      ['forward barf', `${open}|${close}`],
      ['backward barf', `${open}|${close}`],
    ]) {
      await t.test(`${open}${close} ${command}`, () => {
        const name = COMMANDS[command];
        assert.equal(typeof paredit[name], 'function', `${command} command is not implemented`);
        const actual = marked(source);
        assert.equal(paredit[name](actual.text, actual.cursor), null, command);
      });
    }
  }
});
