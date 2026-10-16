import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateTimeframeConstraint } from '../../timetable/js/constraints.js';
import { timetableFixture } from './helpers.js';

test('timeframe constraints can be added, edited, and deleted on a lesson or resource', () => {
  const original = timetableFixture();
  const added = updateTimeframeConstraint(original, { scope: 'teacher', id: 'teacher:T1', kind: 'unavailable', action: 'add', slot: '1.1' });
  assert.ok(added.entities.teachers[0].constraints.timeframes.unavailable.includes('1.1'));
  const edited = updateTimeframeConstraint(added, { scope: 'teacher', id: 'teacher:T1', kind: 'unavailable', action: 'update', from: '1.1', slot: '1.2' });
  assert.ok(!edited.entities.teachers[0].constraints.timeframes.unavailable.includes('1.1'));
  assert.ok(edited.entities.teachers[0].constraints.timeframes.unavailable.includes('1.2'));
  const deleted = updateTimeframeConstraint(edited, { scope: 'teacher', id: 'teacher:T1', kind: 'unavailable', action: 'delete', slot: '1.2' });
  assert.ok(!deleted.entities.teachers[0].constraints.timeframes.unavailable.includes('1.2'));
  assert.deepEqual(original.entities.teachers[0].constraints.timeframes.unavailable, []);
  assert.throws(() => updateTimeframeConstraint(original, { scope: 'lesson', id: 'lesson:0', kind: 'unavailable', action: 'add', slot: '8.8' }), /calendario/i);
});
