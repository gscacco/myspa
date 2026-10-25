import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyword } from '../../shared/js/edn-codec.js';
import { searchExcerpt, searchItems } from '../../loom/js/item-search.js';

const items = [
  { id: 'a', title: 'Alpha', body: 'A thought about clarity', tags: [keyword('clojure')] },
  { id: 'b', title: 'Thought leadership', body: 'A thought that also mentions thought', tags: [] },
  { id: 'c', title: 'Notes', body: 'Another thought', tags: [keyword('navigation')] },
];

test('shared item search groups title and tag matches before content-only matches', () => {
  const result = searchItems(items, 'THOUGHT');
  assert.deepEqual(result.primary.map(item => item.id), ['b']);
  assert.deepEqual(result.content.map(item => item.id), ['a', 'c']);
  assert.equal(result.total, 3);
  assert.match(result.details.get('a'), /A thought about clarity/);
});

test('shared item search handles partial tag matches without duplicates or title guessing', () => {
  const result = searchItems(items, 'clo');
  assert.deepEqual(result.primary.map(item => item.id), ['a']);
  assert.equal(result.details.get('a'), ':clojure');
  assert.deepEqual(result.content, []);
  assert.equal(result.total, 1);
  assert.equal(searchItems(items, '').total, 0);
});

test('search excerpts are centered on a case-insensitive match', () => {
  const excerpt = searchExcerpt(items[1], 'thought');
  assert.match(excerpt, /^A thought/);
});
