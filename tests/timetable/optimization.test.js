import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeTimetable } from '../../timetable/js/optimization.js';
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
