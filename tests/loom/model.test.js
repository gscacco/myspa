import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyword } from '../../timetable/js/edn-codec.js';
import {
  emptyKnowledgeBase, addItem, updateItem, reorderItems, deleteItem,
  parseKnowledgeBase, writeKnowledgeBase,
} from '../../loom/js/model.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const NOW = '2026-10-23T00:00:00.000Z';
const LATER = '2026-10-24T00:00:00.000Z';

test('an empty knowledge base has the approved versioned EDN shape', () => {
  assert.deepEqual(emptyKnowledgeBase(), {
    'schema-version': 1,
    items: [],
    workspace: { 'open-ids': [], 'active-id': null },
  });
});

test('item identity survives title edits and ordering changes', () => {
  const first = addItem(emptyKnowledgeBase(), { title: 'First', body: `[Second](loom:${B})`, tags: [keyword('clojure')] }, { id: A, now: NOW });
  const second = addItem(first, { title: 'Second' }, { id: B, now: NOW });
  const renamed = updateItem(second, B, { title: 'Renamed' }, LATER);
  const reordered = reorderItems(renamed, [B, A]);
  assert.deepEqual(reordered.items.map(item => item.id), [B, A]);
  assert.equal(reordered.items[0].title, 'Renamed');
  assert.equal(reordered.items[0]['created-at'], NOW);
  assert.equal(reordered.items[0]['updated-at'], LATER);
  assert.equal(reordered.items[1].body, `[Second](loom:${B})`);
  assert.deepEqual(second.items.map(item => item.title), ['First', 'Second'], 'updates do not mutate the previous model');
});

test('duplicate titles are valid but duplicate IDs and ID edits are rejected', () => {
  const base = addItem(emptyKnowledgeBase(), { title: 'Same' }, { id: A, now: NOW });
  assert.equal(addItem(base, { title: 'Same' }, { id: B, now: NOW }).items.length, 2);
  assert.throws(() => addItem(base, { title: 'Other' }, { id: A, now: NOW }), /duplicate.*id/i);
  assert.throws(() => updateItem(base, A, { id: B }, LATER), /id.*immutable/i);
});

test('deleting an item clears workspace references but preserves dangling Markdown links', () => {
  const first = addItem(emptyKnowledgeBase(), { title: 'First', body: `[Second](loom:${B})` }, { id: A, now: NOW });
  const second = addItem(first, { title: 'Second' }, { id: B, now: NOW });
  const open = { ...second, workspace: { 'open-ids': [A, B], 'active-id': B } };
  const deleted = deleteItem(open, B);
  assert.deepEqual(deleted.workspace, { 'open-ids': [A], 'active-id': A });
  assert.equal(deleted.items[0].body, `[Second](loom:${B})`);
});

test('strict EDN round-trips tags and workspace in the approved wire format', () => {
  const base = addItem(emptyKnowledgeBase(), { title: 'EDN', tags: [keyword('clojure')] }, { id: A, now: NOW });
  const open = { ...base, workspace: { 'open-ids': [A], 'active-id': A } };
  const source = writeKnowledgeBase(open);
  assert.match(source, /:schema-version 1/);
  assert.match(source, /:tags \[\s*:clojure\s*\]/);
  assert.deepEqual(parseKnowledgeBase(source), open);
});

test('invalid import is rejected before a knowledge base can be replaced', () => {
  const base = addItem(emptyKnowledgeBase(), { title: 'Valid' }, { id: A, now: NOW });
  const source = writeKnowledgeBase(base);
  assert.throws(() => parseKnowledgeBase(`${source} :extra`), /trailing/i);
  assert.throws(() => parseKnowledgeBase(source.replace(':schema-version 1', ':schema-version 2')), /version/i);
  assert.throws(() => parseKnowledgeBase(source.replace(':items', ':unknown [] :items')), /unknown/i);
  const duplicate = { ...base, items: [base.items[0], base.items[0]] };
  assert.throws(() => writeKnowledgeBase(duplicate), /duplicate.*id/i);
  const badWorkspace = { ...base, workspace: { 'open-ids': [B], 'active-id': B } };
  assert.throws(() => writeKnowledgeBase(badWorkspace), /workspace.*id/i);
});

test('UUID generation falls back to getRandomValues without randomUUID', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let counter = 0;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index++) bytes[index] = (counter + index + 1) & 0xff;
        counter += bytes.length;
        return bytes;
      },
    },
  });
  try {
    const first = addItem(emptyKnowledgeBase(), { title: 'First' });
    const second = addItem(first, { title: 'Second' });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(first.items[0].id, uuid);
    assert.match(second.items[1].id, uuid);
    assert.notEqual(first.items[0].id, second.items[1].id);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
});

test('image items have a dedicated kind and private attachment ID', () => {
  const image = addItem(emptyKnowledgeBase(), {
    title: 'Screenshot',
    body: '',
    tags: [],
    kind: keyword('image'),
    'attachment-id': B,
  }, { id: A, now: NOW });
  assert.equal(image.items[0].kind.name, 'image');
  assert.equal(image.items[0]['attachment-id'], B);
  const source = writeKnowledgeBase(image);
  assert.match(source, /:kind :image/);
  assert.match(source, /:attachment-id "550e8400-e29b-41d4-a716-446655440001"/);
  assert.deepEqual(parseKnowledgeBase(source), image);

  assert.throws(() => addItem(emptyKnowledgeBase(), {
    title: 'Broken image', body: '', tags: [], kind: keyword('image'),
  }, { id: A, now: NOW }), /attachment-id/i);
  assert.throws(() => addItem(emptyKnowledgeBase(), {
    title: 'Broken note', body: '', tags: [], 'attachment-id': B,
  }, { id: A, now: NOW }), /attachment-id/i);
  assert.throws(() => addItem(emptyKnowledgeBase(), {
    title: 'Broken image', body: 'Not empty', tags: [], kind: keyword('image'), 'attachment-id': B,
  }, { id: A, now: NOW }), /body/i);
});
