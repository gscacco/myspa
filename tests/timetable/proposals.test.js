import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, applyProposal, ProposalError } from '../../timetable/js/proposals.js';
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
