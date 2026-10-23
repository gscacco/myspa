import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recalculateAssignments } from '../../timetable/js/recalculator.js';
import { optimizationScope } from '../../timetable/js/optimization-scope.js';
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

test('the supplied OFD retains constraints and bounds a search without using source placements (external OFD fixture)', async () => {
  const source = await readFile(samplePath);
  const result = withoutOFDAssignments(importOFD(source, { DOMParser: domParser }));
  assert.equal(result.summary.lessons, 1714);
  assert.equal(result.summary.assignedLessons, 0);
  assert.equal(result.summary.unassignedLessons, 1714);
  assert.equal(result.summary.teachers, 118);
  assert.equal(result.summary.classes, 59);
  assert.equal(result.timetable.source.assignmentHints, undefined, 'OFD placements are not retained as calculation hints');
  assert.ok(result.timetable.lessons.every(lesson => lesson.assignedTime === null));
  assert.ok(result.timetable.entities.teachers.some(teacher => teacher.constraints?.timeframes?.unavailable.length));
  assert.match(result.timetable.source.xml, /<TIME value=/, 'source XML is preserved as provenance');
  const recalculated = await recalculateAssignments(result.timetable, { maxNodes: 10_000 });
  assert.ok(['solved', 'limit'].includes(recalculated.status));
  assert.ok(recalculated.visited <= 10_000);
  if (recalculated.status === 'solved') assert.equal(recalculated.assignments.size, optimizationScope(result.timetable).optimizableLessons.length);
});

test('optimization bounds a real-school search and never returns a partial proposal (external OFD fixture)', async () => {
  const source = await readFile(samplePath);
  const timetable = withoutOFDAssignments(importOFD(source, { DOMParser: domParser })).timetable;
  const optimizable = optimizationScope(timetable).optimizableLessons;
  const result = await optimizeTimetable(timetable, {
    workers: 1, timeLimitMs: 1_000, maxObjective: 0,
  });
  assert.ok(['solved', 'time-limit', 'limit', 'unsatisfiable'].includes(result.status));
  const assignments = result.assignments instanceof Map ? result.assignments : new Map(result.assignments || []);
  assert.ok(assignments.size === 0 || assignments.size === optimizable.length, 'a timed-out search does not expose an incomplete optimized schedule');
  if (assignments.size) {
    const candidate = structuredClone(timetable);
    for (const lesson of optimizable) lesson.assignedTime = assignments.get(lesson.id);
    const { analyzeSchedule } = await import('../../timetable/js/schedule.js');
    assert.equal(analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length, 0);
  }
});

test('recalculation ignores original OFD placements and uses only constraints and seed', async () => {
  const first = solverFixture();
  first.lessons[0].assignedTime = null;
  first.source.assignmentHints = { target: { dayIndex: 0, periodIndex: 2 } };
  const second = structuredClone(first);
  second.source.assignmentHints = { target: { dayIndex: 0, periodIndex: 0 } };
  const firstResult = await recalculateAssignments(first, { seed: 17 });
  const secondResult = await recalculateAssignments(second, { seed: 17 });
  assert.equal(firstResult.status, 'solved');
  assert.deepEqual(firstResult.assignments, secondResult.assignments);
  assert.equal(first.lessons[0].assignedTime, null);
});

test('full recalculation returns a complete hard-valid assignment without mutating the base', async () => {
  const timetable = timetableFixture();
  for (const lesson of timetable.lessons) lesson.assignedTime = null;
  const before = structuredClone(timetable);
  const result = await recalculateAssignments(timetable, { maxNodes: 20000 });

  assert.equal(result.status, 'solved');
  assert.equal(result.assignments.size, optimizationScope(timetable).optimizableLessons.length);
  assert.ok(optimizationScope(timetable).optimizableLessons.every(lesson => result.assignments.has(lesson.id)));
  assert.deepEqual(timetable, before);
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) if (result.assignments.has(lesson.id)) lesson.assignedTime = result.assignments.get(lesson.id);
  const { analyzeSchedule } = await import('../../timetable/js/schedule.js');
  assert.equal(analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length, 0);
});

test('full recalculation reports impossible and cancelled searches without assignments', async () => {
  const impossible = timetableFixture();
  impossible.calendar.days = [impossible.calendar.days[0]];
  impossible.calendar.periods = impossible.calendar.periods.slice(0, 2);
  impossible.lessons = impossible.lessons.slice(0, 2).map(lesson => ({
    ...lesson, durationPeriods: 1, assignedTime: null,
    timeframes: { unavailable: ['0.1'], desired: [], undesired: [] },
  }));
  for (const item of impossible.entities.classes) item.constraints = { timeframes: { unavailable: ['0.1'], desired: [], undesired: [] } };
  const unsolved = await recalculateAssignments(impossible, { maxNodes: 100 });
  assert.equal(unsolved.status, 'unsatisfiable');
  assert.equal(unsolved.assignments, undefined);
  assert.equal(unsolved.diagnostics.maxDepth, 1, 'depth includes a placement rejected by immediate forward checking');
  assert.equal(unsolved.diagnosticPartial.assignedCount, 1);
  assert.equal(unsolved.diagnosticPartial.assignments.size, 1);
  assert.equal(unsolved.diagnosticPartial.unassignedCount, 1);
  assert.equal(unsolved.diagnosticPartial.zeroDomainCount, 1);
  assert.equal(unsolved.diagnosticPartial.smallestRemainingDomains[0].remainingDomainSize, 0);
  assert.ok(unsolved.failureCauses[0].sharedResources.some(item => item.id === 'teacher:T1'));
  const partial = structuredClone(impossible);
  for (const lesson of partial.lessons) {
    if (unsolved.diagnosticPartial.assignments.has(lesson.id)) lesson.assignedTime = unsolved.diagnosticPartial.assignments.get(lesson.id);
  }
  const { analyzeSchedule } = await import('../../timetable/js/schedule.js');
  assert.equal(analyzeSchedule(partial).issues.filter(issue => issue.severity === 'error').length, 0);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await recalculateAssignments(timetableFixture(), { signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.assignments, undefined);
});

test('UNKNOWN-class activities are excluded from CSP and cannot affect ordinary assignments', async () => {
  const ordinary = timetableFixture();
  for (const lesson of ordinary.lessons) lesson.assignedTime = null;
  const baseline = await recalculateAssignments(ordinary, { seed: 13 });
  const timetable = structuredClone(ordinary);
  const unknownClass = { id: 'class:unknown', name: 'UNKNOWN', placeholder: 'unknown' };
  timetable.entities.classes.push(unknownClass);
  unknownClass.constraints = { timeframes: { unavailable: ['0.0', '0.1', '0.2', '1.0', '1.1', '1.2'], desired: [], undesired: [] } };
  const excluded = [0, 1].map(index => ({
    ...structuredClone(timetable.lessons[index]), id: `unknown-${index}`, teacherIds: ['teacher:T1'],
    classIds: [unknownClass.id], roomIds: ['room:R1'], durationPeriods: 4,
    assignedTime: null, timeframes: { unavailable: [], desired: [], undesired: ['0.0'] },
  }));
  timetable.lessons.push(...excluded);

  const result = await recalculateAssignments(timetable, { seed: 13 });
  assert.equal(result.status, 'solved');
  assert.equal(result.assignments.size, ordinary.lessons.length);
  assert.deepEqual(result.assignments, baseline.assignments, 'excluded activities do not alter ordinary CSP choices');
  assert.equal(result.assignments.has('unknown-0'), false);
  assert.equal(result.assignments.has('unknown-1'), false);
  assert.equal(result.excludedLessonCount, 2);
  assert.ok(excluded.every(lesson => lesson.assignedTime === null), 'source activities remain unchanged');

  const onlyUnknown = { ...timetable, lessons: excluded };
  const empty = await recalculateAssignments(onlyUnknown);
  assert.equal(empty.status, 'solved');
  assert.equal(empty.assignments.size, 0);
});

test('experimental LCV and pressure candidate orders preserve complete hard-valid schedules', async () => {
  const { analyzeSchedule } = await import('../../timetable/js/schedule.js');
  for (const options of [{ candidateOrdering: 'lcv' }, { candidateOrdering: 'pressure' }, { variableOrdering: 'domain-loss' }]) {
    const label = options.candidateOrdering || options.variableOrdering;
    const timetable = timetableFixture();
    for (const lesson of timetable.lessons) lesson.assignedTime = null;
    const result = await recalculateAssignments(timetable, {
      seed: 41,
      randomizeOrder: true,
      randomizeVariables: true,
      ...options,
    });
    assert.equal(result.status, 'solved', `${label} finds a complete schedule`);
    assert.equal(result.assignments.size, optimizationScope(timetable).optimizableLessons.length);
    const candidate = structuredClone(timetable);
    for (const lesson of candidate.lessons) if (result.assignments.has(lesson.id)) lesson.assignedTime = result.assignments.get(lesson.id);
    assert.equal(analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length, 0);
    assert.ok(result.diagnostics.domainBuildMs >= 0);
    assert.ok(result.diagnostics.preprocessingMs >= 0);
    assert.ok(result.diagnostics.searchMs >= 0);
  }
});
