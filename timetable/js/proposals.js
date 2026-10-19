import { validateTimetable } from './validation.js';
import { analyzeSchedule } from './schedule.js';
import { isOptimizableLesson, optimizationScope } from './optimization-scope.js';
import { objectiveValue } from './optimization-core.js';

function clone(value) { return structuredClone(value); }
function signature(timetable) { return JSON.stringify(timetable); }

export class ProposalError extends Error {
  constructor(code, message) { super(message); this.name = 'ProposalError'; this.code = code; }
}

/** Captures the exact base state so stale recommendations cannot be applied. */
export function createProposal(timetable, suggestion) {
  if (!Array.isArray(suggestion?.changes) || !suggestion.changes.length) {
    throw new ProposalError('invalid-proposal', 'La proposta non contiene spostamenti.');
  }
  return { baseSignature: signature(timetable), changes: clone(suggestion.changes), rationale: suggestion.rationale || '' };
}

/** Applies every move to a copy and rejects structural errors or hard issues involving moved lessons. */
export function applyProposal(timetable, proposal) {
  if (proposal?.baseSignature !== signature(timetable)) {
    throw new ProposalError('stale-proposal', 'L’orario è cambiato dopo la ricerca. Cerca nuove alternative.');
  }
  const updated = clone(timetable);
  const changed = new Set();
  for (const move of proposal.changes || []) {
    const lesson = updated.lessons.find(item => item.id === move.lessonId);
    if (!lesson || changed.has(move.lessonId) || !Number.isInteger(move.assignedTime?.dayIndex) || !Number.isInteger(move.assignedTime?.periodIndex)) {
      throw new ProposalError('invalid-proposal', 'La proposta contiene una lezione mancante o un orario non valido.');
    }
    if (!isOptimizableLesson(updated, lesson)) {
      throw new ProposalError('excluded-lesson', 'La proposta non può riassegnare attività associate alla classe UNKNOWN.');
    }
    changed.add(move.lessonId);
    lesson.assignedTime = {
      dayIndex: move.assignedTime.dayIndex,
      periodIndex: move.assignedTime.periodIndex,
      sourceValue: `${move.assignedTime.dayIndex}.${move.assignedTime.periodIndex}`,
    };
  }
  const structural = validateTimetable(updated).errors;
  if (structural.length) throw new ProposalError('invalid-proposal', 'La proposta non rispetta la struttura del modello timetable.');
  const hard = analyzeSchedule(optimizationScope(updated).timetable).issues.filter(item => item.severity === 'error');
  const changedHard = hard.filter(item => item.lessonIds.some(id => changed.has(id)));
  if (changedHard.length) throw new ProposalError('hard-constraint', 'La proposta crea un nuovo conflitto o lascia la lezione modificata in conflitto.');
  return updated;
}

/**
 * Validates a complete manual edit against the same structural, hard-constraint,
 * and soft-objective model used by the optimizer.
 */
export function evaluateManualEdit(timetable, changes) {
  if (!Array.isArray(changes) || !changes.length) {
    throw new ProposalError('invalid-edit', 'La modifica non contiene lezioni da spostare.');
  }
  const updated = clone(timetable);
  const changed = new Set();
  for (const change of changes) {
    const lesson = updated.lessons.find(item => item.id === change.lessonId);
    const time = change.assignedTime;
    if (!lesson || changed.has(change.lessonId) || !Number.isInteger(time?.dayIndex) || !Number.isInteger(time?.periodIndex)) {
      throw new ProposalError('invalid-edit', 'La modifica contiene una lezione mancante o un orario non valido.');
    }
    if (!isOptimizableLesson(updated, lesson)) {
      throw new ProposalError('excluded-lesson', 'Le attività associate alla classe UNKNOWN non possono essere spostate.');
    }
    changed.add(lesson.id);
    lesson.assignedTime = {
      dayIndex: time.dayIndex,
      periodIndex: time.periodIndex,
      sourceValue: `${time.dayIndex}.${time.periodIndex}`,
    };
  }

  const structural = validateTimetable(updated).errors;
  if (structural.length) {
    throw new ProposalError('invalid-edit', 'La modifica non rispetta la struttura del modello timetable.');
  }
  const hardIssues = analyzeSchedule(optimizationScope(updated).timetable).issues
    .filter(item => item.severity === 'error');
  if (hardIssues.length) {
    const first = hardIssues[0];
    const resource = first.resourceName ? ` (${first.resourceName})` : '';
    const day = timetable.calendar.days[first.dayIndex]?.name;
    const period = timetable.calendar.periods[first.periodIndex];
    const time = day && period ? `: ${day}, ${String(Math.floor(period.beginMinute / 60)).padStart(2, '0')}:${String(period.beginMinute % 60).padStart(2, '0')}` : '';
    throw new ProposalError('hard-constraint', `La modifica lascia ${hardIssues.length} violazioni hard${resource}${time}.`);
  }
  return {
    timetable: updated,
    changedLessonIds: [...changed],
    softBefore: objectiveValue(timetable),
    softAfter: objectiveValue(updated),
    hardIssues,
  };
}

export function evaluateManualMove(timetable, lessonId, assignedTime) {
  return evaluateManualEdit(timetable, [{ lessonId, assignedTime }]);
}

export function evaluateManualSwap(timetable, firstLessonId, secondLessonId) {
  const first = timetable.lessons.find(item => item.id === firstLessonId);
  const second = timetable.lessons.find(item => item.id === secondLessonId);
  if (!first?.assignedTime || !second?.assignedTime || firstLessonId === secondLessonId) {
    throw new ProposalError('invalid-swap', 'Per scambiare due lezioni servono due assegnazioni distinte.');
  }
  const firstTime = { dayIndex: first.assignedTime.dayIndex, periodIndex: first.assignedTime.periodIndex };
  const secondTime = { dayIndex: second.assignedTime.dayIndex, periodIndex: second.assignedTime.periodIndex };
  return evaluateManualEdit(timetable, [
    { lessonId: firstLessonId, assignedTime: secondTime },
    { lessonId: secondLessonId, assignedTime: firstTime },
  ]);
}
