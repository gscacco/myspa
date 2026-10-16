import { applyProposal } from './proposals.js';

function clone(value) { return structuredClone(value); }

/** In-memory atomic history for one timetable editing session. */
export function createTimetableHistory(initial) {
  let current = clone(initial);
  const previous = [];
  return {
    get current() { return clone(current); },
    get canUndo() { return previous.length > 0; },
    reset(timetable) { current = clone(timetable); previous.length = 0; },
    apply(proposal) {
      const next = applyProposal(current, proposal);
      previous.push(clone(current));
      current = next;
      return clone(current);
    },
    commit(timetable) {
      previous.push(clone(current));
      current = clone(timetable);
      return clone(current);
    },
    undo() {
      if (!previous.length) return false;
      current = previous.pop();
      return true;
    },
  };
}
