import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemRelationships } from '../../loom/js/item-relationships.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '550e8400-e29b-41d4-a716-446655440001';
const C = '550e8400-e29b-41d4-a716-446655440002';
const D = '550e8400-e29b-41d4-a716-446655440003';
const E = '550e8400-e29b-41d4-a716-446655440004';

test('item relationships distinguish references from transclusions in source order', () => {
  const body = [
    `See [[item:${B}]] and [legacy](loom:${C}).`,
    `Again [[item:${B}]] and ![[item:${D}#detail]].`,
    `![legacy embed](loom:${E})`,
  ].join('\n\n');
  assert.deepEqual(itemRelationships(body), {
    referenced: [B, C],
    transcluded: [D, E],
  });
});

test('item relationships ignore code, escaped references, malformed targets, and empty bodies', () => {
  const body = [
    `Inline \`[[item:${A}]]\`.`,
    `~~~clojure\n[[item:${B}]]\n~~~`,
    `escaped \\[[item:${C}]]`,
    'malformed [[item:not-a-uuid]]',
  ].join('\n\n');
  assert.deepEqual(itemRelationships(body), { referenced: [], transcluded: [] });
  assert.deepEqual(itemRelationships(''), { referenced: [], transcluded: [] });
  assert.deepEqual(itemRelationships(null), { referenced: [], transcluded: [] });
});
