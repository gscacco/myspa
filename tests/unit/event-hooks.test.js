import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventHooks } from '../../src/js/event-hooks.js';

const EVENT = ':on-selection-change';

test('hook registration preserves order, ignores duplicates, and lists a stable snapshot', () => {
  const hooks = createEventHooks();
  const calls = [];
  const first = () => calls.push('first');
  const second = () => calls.push('second');

  assert.equal(hooks.add(EVENT, first), true);
  assert.equal(hooks.add(EVENT, first), false);
  assert.equal(hooks.add(EVENT, second), true);
  assert.deepEqual(hooks.list(EVENT), [first, second]);
  assert.equal(hooks.run(EVENT, {}, callback => callback()), 2);
  assert.deepEqual(calls, ['first', 'second']);
});

test('removing and clearing hooks report whether registrations existed', () => {
  const hooks = createEventHooks();
  const callback = () => {};
  assert.equal(hooks.remove(EVENT, callback), false);
  hooks.add(EVENT, callback);
  assert.equal(hooks.remove(EVENT, callback), true);
  assert.equal(hooks.remove(EVENT, callback), false);
  hooks.add(EVENT, callback);
  assert.equal(hooks.clear(EVENT), 1);
  assert.equal(hooks.clear(EVENT), 0);
  assert.deepEqual(hooks.list(EVENT), []);
});

test('unsupported events and non-function hooks fail predictably', () => {
  const hooks = createEventHooks();
  assert.throws(() => hooks.add(':on-cell-edit', () => {}), /Unsupported hook event/);
  assert.throws(() => hooks.add(EVENT, null), /must be a function/);
});

test('dispatch uses a stable snapshot and continues after an individual hook throws', () => {
  const hooks = createEventHooks();
  const calls = [], errors = [];
  const later = () => calls.push('later');
  hooks.add(EVENT, () => {
    calls.push('first');
    hooks.remove(EVENT, later);
    hooks.add(EVENT, () => calls.push('next dispatch'));
    throw new Error('hook failure');
  });
  hooks.add(EVENT, later);

  assert.equal(hooks.run(EVENT, { selection: 'A1' }, callback => callback(), error => errors.push(error.message)), 2);
  assert.deepEqual(calls, ['first', 'later']);
  assert.deepEqual(errors, ['hook failure']);
  hooks.run(EVENT, {}, callback => callback());
  assert.deepEqual(calls, ['first', 'later', 'first', 'next dispatch']);
});
