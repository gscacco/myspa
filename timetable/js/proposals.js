import { validateTimetable } from './validation.js';
import { analyzeSchedule } from './schedule.js';

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
    changed.add(move.lessonId);
    lesson.assignedTime = {
      dayIndex: move.assignedTime.dayIndex,
      periodIndex: move.assignedTime.periodIndex,
      sourceValue: `${move.assignedTime.dayIndex}.${move.assignedTime.periodIndex}`,
    };
  }
  const structural = validateTimetable(updated).errors;
  if (structural.length) throw new ProposalError('invalid-proposal', 'La proposta non rispetta la struttura del modello timetable.');
  const hard = analyzeSchedule(updated).issues.filter(item => item.severity === 'error');
  const changedHard = hard.filter(item => item.lessonIds.some(id => changed.has(id)));
  if (changedHard.length) throw new ProposalError('hard-constraint', 'La proposta crea un nuovo conflitto o lascia la lezione modificata in conflitto.');
  return updated;
}
