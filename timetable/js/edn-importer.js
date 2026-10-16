import { readEDN, writeEDN } from './edn-codec.js';
import { validateTimetable } from './validation.js';

export class EDNImportError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'EDNImportError';
    this.diagnostics = diagnostics;
  }
}

function summarize(timetable) {
  const unassignedLessons = timetable.lessons.filter(lesson => lesson.assignedTime == null).length;
  return {
    teachers: timetable.entities.teachers.length,
    rooms: timetable.entities.rooms.length,
    classes: timetable.entities.classes.length,
    subjects: timetable.entities.subjects.length,
    students: timetable.entities.students?.length || 0,
    lessons: timetable.lessons.length,
    assignedLessons: timetable.lessons.length - unassignedLessons,
    unassignedLessons,
    warningCount: unassignedLessons ? 1 : 0,
  };
}

/** Reads and validates a timetable EDN interchange document. */
export function importTimetableEDN(source) {
  let timetable;
  try { timetable = readEDN(source); }
  catch (error) { throw new EDNImportError(`EDN could not be read: ${error.message}`); }
  const { errors } = validateTimetable(timetable);
  if (errors.length) {
    const diagnostics = errors.map(error => ({ ...error, severity: 'error' }));
    throw new EDNImportError(`EDN timetable failed validation: ${errors[0].message} (${errors[0].path})`, diagnostics);
  }
  const summary = summarize(timetable);
  const diagnostics = summary.unassignedLessons ? [{
    severity: 'warning', code: 'unassigned-lessons', details: { count: summary.unassignedLessons },
    message: `${summary.unassignedLessons} lessons have no assigned time in the source timetable.`, path: 'lessons',
  }] : [];
  return { timetable, summary, diagnostics };
}

/** Validates the schema before serializing a timetable as native EDN. */
export function exportTimetableEDN(timetable) {
  const { errors } = validateTimetable(timetable);
  if (errors.length) throw new EDNImportError(`EDN export refused invalid timetable: ${errors[0].message} (${errors[0].path})`, errors);
  return writeEDN(timetable);
}
