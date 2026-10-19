import { applyProposal } from './proposals.js';

function clone(value) { return structuredClone(value); }

/** In-memory atomic history for one timetable editing session. */
export function createTimetableHistory(initial) {
  let current = clone(initial);
  const previous = [];
  const future = [];
  return {
    get current() { return clone(current); },
    get canUndo() { return previous.length > 0; },
    get canRedo() { return future.length > 0; },
    reset(timetable) { current = clone(timetable); previous.length = 0; future.length = 0; },
    apply(proposal) {
      const next = applyProposal(current, proposal);
      previous.push(clone(current));
      future.length = 0;
      current = next;
      return clone(current);
    },
    commit(timetable) {
      previous.push(clone(current));
      future.length = 0;
      current = clone(timetable);
      return clone(current);
    },
    undo() {
      if (!previous.length) return false;
      future.push(clone(current));
      current = previous.pop();
      return true;
    },
    redo() {
      if (!future.length) return false;
      previous.push(clone(current));
      current = future.pop();
      return true;
    },
  };
}
