import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recalculateAssignments } from '../../timetable/js/recalculator.js';
import { optimizeTimetable } from '../../timetable/js/optimization.js';
import { importOFD, withoutOFDAssignments } from '../../timetable/js/ofd-importer.js';
import { domParser, timetableFixture } from './helpers.js';
import { solverFixture } from './helpers.js';

const samplePath = fileURLToPath(new URL('../../OR_30_SETT.ofd', import.meta.url));

test('OFD import can omit every placement while retaining requirements and constraints', () => {
  const timetable = timetableFixture();
  const result = withoutOFDAssignments({
    timetable,
    diagnostics: [{ code: 'unassigned-lessons', severity: 'warning', details: { count: 1 } }],
    summary: { lessons: 5, assignedLessons: 4, unassignedLessons: 1, teachers: 2, classes: 2, rooms: 2, subjects: 2 },
  });

  assert.ok(result.timetable.lessons.every(lesson => lesson.assignedTime === null));
  assert.deepEqual(result.timetable.entities, timetable.entities);
  assert.deepEqual(result.timetable.lessons.map(lesson => lesson.teacherIds), timetable.lessons.map(lesson => lesson.teacherIds));
  assert.deepEqual(result.timetable.lessons.map(lesson => lesson.timeframes), timetable.lessons.map(lesson => lesson.timeframes));
  assert.equal(result.summary.assignedLessons, 0);
  assert.equal(result.summary.unassignedLessons, timetable.lessons.length);
  assert.equal(result.diagnostics.find(item => item.code === 'assignments-omitted').details.count, 4);
  assert.ok(timetable.lessons.some(lesson => lesson.assignedTime), 'source model is not mutated');
});

test('the supplied OFD retains requirements and can be fully recalculated without loading its 1,708 placements', async () => {
  const source = await readFile(samplePath);
  const result = withoutOFDAssignments(importOFD(source, { DOMParser: domParser }));
  assert.equal(result.summary.lessons, 1714);
  assert.equal(result.summary.assignedLessons, 0);
  assert.equal(result.summary.unassignedLessons, 1714);
  assert.equal(result.summary.teachers, 118);
  assert.equal(result.summary.classes, 58);
  assert.equal(Object.keys(result.timetable.source.assignmentHints).length, 1708);
  assert.ok(result.timetable.lessons.every(lesson => lesson.assignedTime === null));
  assert.ok(result.timetable.entities.teachers.some(teacher => teacher.constraints?.timeframes?.unavailable.length));
  assert.match(result.timetable.source.xml, /<TIME value=/, 'source XML is preserved as provenance');
  const recalculated = await recalculateAssignments(result.timetable, { maxNodes: 250_000 });
  assert.equal(recalculated.status, 'solved');
  assert.equal(recalculated.assignments.size, 1714);
  assert.ok(recalculated.visited < 250_000);
});

test('optimization improves the objective on the supplied school while returning a complete hard-valid proposal', async () => {
  const source = await readFile(samplePath);
  const timetable = withoutOFDAssignments(importOFD(source, { DOMParser: domParser })).timetable;
  const progress = [];
  const result = await optimizeTimetable(timetable, {
    workers: 1, timeLimitMs: 30_000, maxObjective: 0,
    onProgress: item => { if (Number.isFinite(item.bestObjective)) progress.push(item.bestObjective); },
  });
  assert.equal(result.status, 'solved');
  assert.equal(result.assignments.size, 1714);
  assert.ok(result.iterations > 0);
  assert.ok(result.objective < result.initialObjective);
  assert.ok(progress.every((value, index) => index === 0 || value <= progress[index - 1]));
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) lesson.assignedTime = result.assignments.get(lesson.id);
  const { analyzeSchedule } = await import('../../timetable/js/schedule.js');
  assert.equal(analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length, 0);
});

test('recalculation can prefer original OFD placements as suggestions without applying them directly', async () => {
  const timetable = solverFixture();
  timetable.lessons[0].assignedTime = null;
  timetable.source.assignmentHints = { target: { dayIndex: 0, periodIndex: 2 } };
  const result = await recalculateAssignments(timetable, { useSourceHints: true });
  assert.equal(result.status, 'solved');
  assert.equal(result.assignments.get('target').periodIndex, 2);
  assert.equal(timetable.lessons[0].assignedTime, null);
});

test('full recalculation returns a complete hard-valid assignment without mutating the base', async () => {
  const timetable = timetableFixture();
  for (const lesson of timetable.lessons) lesson.assignedTime = null;
  const before = structuredClone(timetable);
  const result = await recalculateAssignments(timetable, { maxNodes: 20000 });

  assert.equal(result.status, 'solved');
  assert.equal(result.assignments.size, timetable.lessons.length);
  assert.ok(result.assignments.size === timetable.lessons.length);
  assert.deepEqual(timetable, before);
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) lesson.assignedTime = result.assignments.get(lesson.id);
  const { analyzeSchedule } = await import('../../timetable/js/schedule.js');
  assert.equal(analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length, 0);
});

test('full recalculation reports impossible and cancelled searches without assignments', async () => {
  const impossible = timetableFixture();
  impossible.calendar.days = [impossible.calendar.days[0]];
  impossible.calendar.periods = [impossible.calendar.periods[0]];
  impossible.lessons = impossible.lessons.slice(0, 2).map(lesson => ({ ...lesson, durationPeriods: 1, assignedTime: null }));
  const unsolved = await recalculateAssignments(impossible, { maxNodes: 100 });
  assert.equal(unsolved.status, 'unsatisfiable');
  assert.equal(unsolved.assignments, undefined);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await recalculateAssignments(timetableFixture(), { signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.assignments, undefined);
});
