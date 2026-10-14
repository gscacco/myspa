import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessagesStore, MESSAGE_LIMITS } from '../../src/js/messages.js';

test('messages get stable identifiers, timestamps, severity, category, and safe context', () => {
  const store = createMessagesStore();
  const source = { cell: 'Foglio1!C2' };
  const entry = store.log('error', 'Evaluation failed', {
    category: 'exec', source, details: { attempt: 1 }, exception: new Error('invalid form'),
  });
  source.cell = 'changed';

  assert.deepEqual([entry.id, entry.level, entry.category], [1, 'error', 'exec']);
  assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
  assert.deepEqual(entry.source, { cell: 'Foglio1!C2' });
  assert.match(entry.details, /"attempt":1/);
  assert.equal(entry.exception.message, 'invalid form');
  assert.ok(Object.isFrozen(entry));
  for (const level of ['info', 'warn', 'error', 'debug']) assert.equal(store.log(level, level).level, level);
});

test('retention removes the oldest messages and tracks count and text budget', () => {
  const store = createMessagesStore({ maxMessages: 2, maxChars: 10_000 });
  store.info('first');
  store.warn('second');
  store.error('third');
  assert.deepEqual(store.getMessages().map(message => message.message), ['second', 'third']);
  assert.deepEqual(store.getStats(), { retained: 2, discarded: 1, chars: store.getStats().chars });

  const byBytes = createMessagesStore({ maxMessages: 10, maxChars: 220, maxEntryChars: 180 });
  byBytes.info('a'.repeat(2000), { details: 'b'.repeat(2000), exception: new Error('c'.repeat(2000)) });
  byBytes.info('new');
  assert.ok(byBytes.getStats().chars <= 220);
  assert.ok(byBytes.getStats().discarded >= 1);
  assert.ok(byBytes.getMessages().every(message => JSON.stringify(message).length < MESSAGE_LIMITS.maxEntryChars * 2));
});

test('store batches notifications, isolates subscriber failures, and clear releases retained entries', async () => {
  const store = createMessagesStore();
  let calls = 0;
  let latest;
  store.subscribe(() => { throw new Error('broken view'); });
  store.subscribe(change => { calls++; latest = change; });
  store.info('one');
  store.warn('two');
  assert.equal(store.getStats().retained, 2, 'storage updates synchronously even before views are notified');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.deepEqual(latest.added.map(message => message.message), ['one', 'two']);
  store.clear();
  assert.deepEqual(store.getMessages(), []);
  assert.equal(store.getStats().retained, 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(latest.cleared, true);
});

test('batched notifications do not retain or publish messages already evicted in the same batch', async () => {
  const store = createMessagesStore({ maxMessages: 2 });
  const changes = [];
  store.subscribe(change => changes.push(change));
  store.info('one');
  store.info('two');
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const message of ['three', 'four', 'five', 'six', 'seven']) store.info(message);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(store.getMessages().map(message => message.message), ['six', 'seven']);
  assert.deepEqual(changes[1].added.map(message => message.message), ['six', 'seven']);
  assert.deepEqual(changes[1].removed.map(entry => entry.id), [1, 2]);
});

test('malformed metadata and logging failures never escape or recurse', () => {
  const store = createMessagesStore();
  const metadata = Object.defineProperty({}, 'category', { get() { throw new Error('getter failed'); } });
  assert.doesNotThrow(() => store.log('error', 'message', metadata));
  assert.equal(store.getStats().retained, 0);
  assert.doesNotThrow(() => store.error(new Error('caught')));
  assert.equal(store.getMessages()[0].message, 'caught');
});
