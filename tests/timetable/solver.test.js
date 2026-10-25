import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findAlternatives, validateAssignment } from '../../timetable/js/solver.js';
import { importOFD } from '../../timetable/js/ofd-importer.js';
import { domParser, solverFixture } from './helpers.js';

const samplePath = fileURLToPath(new URL('../../OR_30_SETT.ofd', import.meta.url));

test('search rejects invalid complexity limits explicitly', async () => {
  await assert.rejects(findAlternatives(solverFixture(), 'target', { maxMoves: 0 }), RangeError);
  await assert.rejects(findAlternatives(solverFixture(), 'target', { maxResults: 0 }), RangeError);
  await assert.rejects(findAlternatives(solverFixture(), 'target', { maxNodes: 0 }), RangeError);
});

test('immediate validation rejects hard conflicts and unavailable periods across lesson duration', () => {
  const timetable = solverFixture({ chain: true });
  timetable.lessons[0].durationPeriods = 2;
  const result = validateAssignment(timetable, 'target', { dayIndex: 0, periodIndex: 1 });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.code === 'unavailable-time'));
  assert.ok(result.issues.some(issue => issue.code === 'resource-collision'));
  assert.equal(validateAssignment(timetable, 'target', { dayIndex: 0, periodIndex: 3 }).issues[0].code, 'invalid-time');
});

test('unknown-class activities are excluded from manual assignment and do not block ordinary lessons', async () => {
  const timetable = solverFixture();
  timetable.entities.classes.push({ id: 'class:unknown', name: 'UNKNOWN', placeholder: 'unknown' });
  const other = structuredClone(timetable.lessons[0]);
  other.id = 'other';
  other.teacherIds = ['teacher:T2'];
  other.classIds = ['class:unknown'];
  other.roomIds = [];
  other.assignedTime = { dayIndex: 0, periodIndex: 0, sourceValue: '0.0' };
  timetable.entities.teachers.push({ id: 'teacher:T2', name: 'Teacher Two' });
  timetable.lessons.push(other);
  const result = validateAssignment(timetable, 'target', { dayIndex: 0, periodIndex: 0 });
  assert.equal(result.valid, true, 'the excluded activity does not create a teacher, room, or class collision');
  assert.equal(validateAssignment(timetable, 'other', { dayIndex: 0, periodIndex: 0 }).issues[0].code, 'excluded-lesson');
  assert.equal((await findAlternatives(timetable, 'other')).reason, 'excluded-lesson');
});

test('alternatives are hard-valid, rank soft-preference trade-offs, and do not mutate current data', async () => {
  const timetable = solverFixture();
  const before = structuredClone(timetable);
  const result = await findAlternatives(timetable, 'target');
  assert.ok(result.suggestions.length > 0);
  assert.ok(result.suggestions.every(item => item.hardValid));
  assert.equal(result.suggestions[0].changes[0].assignedTime.periodIndex, 2);
  assert.ok(result.suggestions.some(item => item.softAfter > item.softBefore), 'undesired time remains visible as a trade-off');
  assert.deepEqual(timetable, before);
});

test('an existing direct conflict can be repaired without introducing another hard conflict', async () => {
  const timetable = solverFixture({ chain: true });
  timetable.lessons[0].assignedTime = { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' };
  const result = await findAlternatives(timetable, 'target', { maxMoves: 1 });
  assert.ok(result.suggestions.some(item => item.changes[0].assignedTime.periodIndex === 0));
  assert.ok(result.suggestions.every(item => item.hardValid));
});

test('an unassigned lesson can receive a feasible time without inventing the assignment beforehand', async () => {
  const timetable = solverFixture();
  timetable.lessons[0].assignedTime = null;
  const result = await findAlternatives(timetable, 'target', { maxMoves: 1, maxResults: 1 });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].changes[0].lessonId, 'target');
  assert.equal(timetable.lessons[0].assignedTime, null);
});

test('bounded local search moves a short chain and cancellation preserves the input', async () => {
  const timetable = solverFixture({ chain: true });
  const result = await findAlternatives(timetable, 'target', { maxMoves: 3, maxResults: 3 });
  const chain = result.suggestions.find(item => item.changes.length === 3);
  assert.ok(chain, 'selected lesson and two blockers can move as an atomic chain');
  assert.deepEqual(chain.changes.map(change => change.assignedTime.periodIndex), [1, 2, 3]);

  const controller = new AbortController();
  const cancelled = await findAlternatives(timetable, 'target', {
    maxMoves: 3,
    signal: controller.signal,
    onProgress: () => controller.abort(),
  });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(timetable.lessons.map(lesson => lesson.assignedTime.periodIndex), [0, 1, 2]);
});

test('immediate search returns safe alternatives on the supplied timetable without mutating it (external OFD fixture)', async () => {
  const { timetable } = importOFD(await readFile(samplePath), { DOMParser: domParser });
  const before = structuredClone(timetable);
  const started = performance.now();
  let result;
  for (const lesson of timetable.lessons.filter(item => item.assignedTime && item.teacherIds.length).slice(0, 12)) {
    result = await findAlternatives(timetable, lesson.id, { maxMoves: 1, maxResults: 1, maxNodes: 60 });
    if (result.suggestions.length) break;
  }
  const elapsed = performance.now() - started;
  assert.ok(result.suggestions.length > 0);
  assert.ok(result.suggestions.every(item => item.hardValid));
  assert.deepEqual(timetable, before);
  // Keep the measurement observable without asserting an unverified product target.
  assert.ok(elapsed >= 0);
});
