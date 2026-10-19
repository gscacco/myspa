import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, applyProposal, evaluateManualMove, evaluateManualSwap, ProposalError } from '../../timetable/js/proposals.js';
import { createTimetableHistory } from '../../timetable/js/history.js';
import { solverFixture } from './helpers.js';

test('a proposal is inert until applied, and application changes the schedule atomically', () => {
  const current = solverFixture();
  const suggestion = { changes: [{ lessonId: 'target', assignedTime: { dayIndex: 0, periodIndex: 2 } }] };
  const proposal = createProposal(current, suggestion);
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0);
  const updated = applyProposal(current, proposal);
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0);
  assert.equal(updated.lessons[0].assignedTime.periodIndex, 2);
});

test('application rejects stale or hard-invalid proposals without changing the source', () => {
  const current = solverFixture();
  const proposal = createProposal(current, { changes: [{ lessonId: 'target', assignedTime: { dayIndex: 0, periodIndex: 2 } }] });
  const changed = structuredClone(current);
  changed.lessons[0].assignedTime.periodIndex = 1;
  assert.throws(() => applyProposal(changed, proposal), error => error instanceof ProposalError && error.code === 'stale-proposal');

  const occupiedSchedule = solverFixture({ chain: true });
  const invalid = createProposal(occupiedSchedule, { changes: [{ lessonId: 'target', assignedTime: { dayIndex: 0, periodIndex: 1 } }] });
  assert.throws(() => applyProposal(occupiedSchedule, invalid), error => error instanceof ProposalError && error.code === 'hard-constraint');
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0);
});

test('history applies a proposal and undo restores the exact prior EDN domain value', () => {
  const current = solverFixture();
  const before = structuredClone(current);
  const history = createTimetableHistory(current);
  const proposal = createProposal(current, { changes: [{ lessonId: 'target', assignedTime: { dayIndex: 0, periodIndex: 2 } }] });
  history.apply(proposal);
  assert.equal(history.canUndo, true);
  assert.equal(history.current.lessons[0].assignedTime.periodIndex, 2);
  assert.equal(history.undo(), true);
  assert.deepEqual(history.current, before);
  assert.equal(history.canUndo, false);
});

test('manual moves accept a valid hard-constraint schedule and report soft penalty changes', () => {
  const current = solverFixture();
  const result = evaluateManualMove(current, 'target', { dayIndex: 0, periodIndex: 1 });
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0);
  assert.equal(result.timetable.lessons[0].assignedTime.periodIndex, 1);
  assert.equal(result.softBefore, 0);
  assert.equal(result.softAfter, 100);
});

test('manual moves reject the full result when any hard violation remains', () => {
  const current = solverFixture();
  current.entities.classes[0].constraints = { timeframes: { unavailable: ['0.2'], desired: [], undesired: [] } };
  assert.throws(
    () => evaluateManualMove(current, 'target', { dayIndex: 0, periodIndex: 2 }),
    error => error instanceof ProposalError && error.code === 'hard-constraint',
  );
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0);
});

test('manual swaps apply as one complete validated operation', () => {
  const current = solverFixture();
  current.entities.teachers.push({ id: 'teacher:T2', name: 'Teacher Two', constraints: { timeframes: { unavailable: [], desired: [], undesired: [] } } });
  current.entities.classes.push({ id: 'class:C2', name: 'Class 2' });
  current.lessons.push({
    ...structuredClone(current.lessons[0]), id: 'second', sourceIndex: 1,
    teacherIds: ['teacher:T2'], classIds: ['class:C2'], assignedTime: { dayIndex: 0, periodIndex: 2, sourceValue: '0.2' },
  });
  const result = evaluateManualSwap(current, 'target', 'second');
  assert.deepEqual(result.timetable.lessons.map(item => item.assignedTime.periodIndex), [2, 0]);
  assert.deepEqual(current.lessons.map(item => item.assignedTime.periodIndex), [0, 2]);
  assert.throws(() => evaluateManualSwap(current, 'target', 'target'), ProposalError);
});

test('history redo restores an edit and a new commit clears the redo branch', () => {
  const current = solverFixture();
  const history = createTimetableHistory(current);
  history.commit(evaluateManualMove(current, 'target', { dayIndex: 0, periodIndex: 2 }).timetable);
  assert.equal(history.undo(), true);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), true);
  assert.equal(history.current.lessons[0].assignedTime.periodIndex, 2);
  assert.equal(history.undo(), true);
  history.commit(evaluateManualMove(history.current, 'target', { dayIndex: 0, periodIndex: 1 }).timetable);
  assert.equal(history.canRedo, false);
});
