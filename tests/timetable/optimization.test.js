import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeTimetable } from '../../timetable/js/optimization.js';
import { objectiveBreakdown, objectiveUpperBound, optimizeLocally } from '../../timetable/js/optimization-core.js';
import { optimizationScope } from '../../timetable/js/optimization-scope.js';
import { solverFixture, timetableFixture } from './helpers.js';

test('optimization reports a monotonically improving best objective without changing the source', async () => {
  const timetable = solverFixture();
  timetable.lessons[0].assignedTime = { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' };
  timetable.source.assignmentHints = { target: { dayIndex: 0, periodIndex: 0 } };
  const before = structuredClone(timetable);
  const progress = [];
  const result = await optimizeTimetable(timetable, {
    timeLimitMs: 1000,
    maxObjective: 0,
    workers: 1,
    onProgress: item => progress.push(item),
  });
  assert.equal(result.status, 'solved');
  assert.ok(result.iterations > 0);
  assert.ok(result.objective <= result.initialObjective);
  assert.ok(progress.length > 0);
  assert.ok(progress.every((item, index) => index === 0 || item.bestObjective <= progress[index - 1].bestObjective));
  assert.deepEqual(timetable, before);
});

test('optimization respects a pre-cancelled signal and a zero-time budget', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const stopped = await optimizeTimetable(timetableFixture(), { signal: cancelled.signal, timeLimitMs: 1000, workers: 1 });
  assert.equal(stopped.status, 'cancelled');

  const expired = await optimizeTimetable(timetableFixture(), { timeLimitMs: 0, workers: 1 });
  assert.equal(expired.status, 'time-limit');
});

test('the objective rewards preferred periods as well as avoiding unwanted ones', async () => {
  const timetable = solverFixture();
  timetable.entities.teachers[0].constraints.timeframes.desired = ['0.2'];
  timetable.entities.teachers[0].constraints.timeframes.undesired = [];
  timetable.lessons[0].assignedTime = { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' };
  const result = await optimizeTimetable(timetable, { workers: 1, timeLimitMs: 1000 });
  assert.equal(result.status, 'solved');
  assert.equal(result.assignments.get('target').periodIndex, 2);
  assert.equal(result.objective, 0);
});

test('soft preference weights are configurable and reflected in the objective and upper bound', () => {
  const timetable = solverFixture();
  const teacher = timetable.entities.teachers[0];
  teacher.constraints.timeframes.desired = ['0.2'];
  teacher.constraints.timeframes.undesired = ['0.1'];
  const weights = { undesiredSlot: 70, missedPreferredSlot: 8 };
  const missed = objectiveBreakdown(timetable, new Map([['target', { dayIndex: 0, periodIndex: 1 }]]), weights);
  const preferred = objectiveBreakdown(timetable, new Map([['target', { dayIndex: 0, periodIndex: 2 }]]), weights);
  assert.equal(missed.penalties.avoidedSlots, 70);
  assert.equal(missed.penalties.missedPreferences, 8);
  assert.equal(missed.total, 78);
  assert.equal(preferred.total, 0);
  assert.equal(objectiveUpperBound(timetable, weights), 78);
});

test('invalid soft preference weights are rejected', async () => {
  await assert.rejects(
    optimizeTimetable(solverFixture(), { workers: 1, timeLimitMs: 1000, objectiveWeights: { undesiredSlot: -1 } }),
    /Objective weights must be finite, non-negative numbers/,
  );
});

test('unknown-class activities do not enter genetic search, score, or candidate bound', async () => {
  const timetable = solverFixture();
  const unknownClass = { id: 'class:unknown', name: 'UNKNOWN', placeholder: 'unknown', constraints: {
    timeframes: { unavailable: ['0.0', '0.1', '0.2'], desired: [], undesired: ['0.0', '0.1', '0.2'] },
  } };
  timetable.entities.classes.push(unknownClass);
  const excluded = {
    ...structuredClone(timetable.lessons[0]), id: 'unknown-activity', classIds: [unknownClass.id],
    assignedTime: null, timeframes: { unavailable: ['0.0', '0.1', '0.2'], desired: [], undesired: ['0.0'] },
  };
  timetable.lessons.push(excluded);
  const baseline = solverFixture();
  const weights = { undesiredSlot: 73, missedPreferredSlot: 9 };
  const baselineScore = objectiveBreakdown(baseline, new Map([['target', { dayIndex: 0, periodIndex: 0 }]]), weights);
  const score = objectiveBreakdown(timetable, new Map([['target', { dayIndex: 0, periodIndex: 0 }]]), weights);
  assert.deepEqual(score, baselineScore);
  assert.equal(objectiveUpperBound(timetable, weights), objectiveUpperBound(baseline, weights));

  const result = await optimizeTimetable(timetable, { algorithm: 'genetic', workers: 1, timeLimitMs: 1_000, seed: 17 });
  assert.equal(result.status, 'solved');
  assert.deepEqual([...result.assignments.keys()], ['target']);
  assert.equal(result.excludedLessonCount, 1);
  assert.equal(timetable.lessons.at(-1).assignedTime, null, 'optimization does not mutate excluded source activities');
});

test('a timetable containing only unknown-class activities reports no eligible work', async () => {
  const timetable = solverFixture();
  timetable.entities.classes[0].placeholder = 'unknown';
  timetable.entities.classes[0].name = 'UNKNOWN';
  const result = await optimizeTimetable(timetable, { workers: 1, timeLimitMs: 1_000 });
  assert.equal(result.status, 'no-eligible-lessons');
  assert.equal(result.assignments.size, 0);
  assert.equal(result.activeLessonCount, 0);
  assert.equal(result.excludedLessonCount, timetable.lessons.length);
  assert.equal(optimizationScope(timetable).optimizableLessons.length, 0);
});

test('genetic feasibility reports its partial CSP branch when no individual can enter the population', async () => {
  const timetable = solverFixture();
  for (const lesson of timetable.lessons) lesson.assignedTime = null;
  const diagnosticPartial = {
    assignedCount: 1,
    assignments: new Map([['target', { dayIndex: 0, periodIndex: 0 }]]),
    unassignedCount: 0,
    zeroDomainCount: 0,
    remainingDomainHistogram: {},
    smallestRemainingDomains: [],
  };
  const result = await optimizeLocally(timetable, {
    algorithm: 'genetic', timeLimitMs: 1_000, seed: 1,
    recalculate: async () => ({
      status: 'unsatisfiable', visited: 5, diagnosticPartial,
      failureCauses: [{ blockingLessonId: 'blocker', blockedLessonId: 'target', sharedResources: [], count: 1 }],
    }),
  });
  assert.equal(result.status, 'unsatisfiable');
  assert.equal(result.populationCount, 0);
  assert.equal(result.populationSize, 8);
  assert.equal(result.generations, 0);
  assert.deepEqual(result.diagnosticPartial, diagnosticPartial);
  assert.equal(result.failureCauses.length, 1);
});

test('requested parallel workers run independently and the best valid result wins', async () => {
  const workers = [];
  const workerFactory = () => {
    const listeners = {};
    const objective = workers.length;
    const worker = {
      addEventListener(type, listener) { listeners[type] = listener; },
      postMessage() { queueMicrotask(() => listeners.message({ data: { type: 'result', result: { status: 'solved', iterations: 4, objective, initialObjective: 9, assignments: [['target', { dayIndex: 0, periodIndex: 0 }]] } } })); },
      terminate() { this.terminated = true; },
    };
    workers.push(worker);
    return worker;
  };
  const result = await optimizeTimetable(solverFixture(), { workers: 2, workerFactory, timeLimitMs: 1000 });
  assert.equal(workers.length, 2);
  assert.equal(result.workersUsed, 2);
  assert.equal(result.objective, 0);
});
