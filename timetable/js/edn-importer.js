import { readEDN, writeEDN } from './edn-codec.js';
import { validateTimetable } from './validation.js';

export class EDNImportError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'EDNImportError';
    this.diagnostics = diagnostics;
  }
}

function summarize(timetable, diagnostics = []) {
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
    warningCount: diagnostics.filter(item => item.severity === 'warning').length,
  };
}

function normalizeMissingLessonDetails(timetable) {
  const diagnostics = [];
  const entities = timetable?.entities;
  if (!entities || !Array.isArray(entities.classes) || !Array.isArray(entities.subjects) || !Array.isArray(timetable.lessons)) return diagnostics;
  const ensureUnknown = collection => {
    const existing = entities[collection].find(item => item?.name?.trim().toLocaleUpperCase() === 'UNKNOWN');
    if (existing) {
      existing.placeholder = 'unknown';
      return existing.id;
    }
    const prefix = collection === 'classes' ? 'class' : 'subject';
    const occupied = new Set(Object.values(entities).flatMap(items => Array.isArray(items) ? items.map(item => item?.id) : []));
    let id = `${prefix}:unknown`, suffix = 2;
    while (occupied.has(id)) id = `${prefix}:unknown-${suffix++}`;
    entities[collection].push({ id, name: 'UNKNOWN', placeholder: 'unknown' });
    return id;
  };
  let missingClass = 0, missingSubject = 0;
  for (const lesson of timetable.lessons) {
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) continue;
    if (lesson.classIds == null || (Array.isArray(lesson.classIds) && lesson.classIds.length === 0)) {
      lesson.classIds = [ensureUnknown('classes')];
      missingClass++;
    }
    if (lesson.subjectId == null || lesson.subjectId === '') {
      lesson.subjectId = ensureUnknown('subjects');
      missingSubject++;
    }
  }
  if (missingClass) diagnostics.push({ severity: 'warning', code: 'lesson-without-class', details: { count: missingClass }, message: `${missingClass} lessons have no class; UNKNOWN was assigned.`, path: 'lessons' });
  if (missingSubject) diagnostics.push({ severity: 'warning', code: 'lesson-without-subject', details: { count: missingSubject }, message: `${missingSubject} lessons have no subject; UNKNOWN was assigned.`, path: 'lessons' });
  return diagnostics;
}

/** Reads and validates a timetable EDN interchange document. */
export function importTimetableEDN(source) {
  let timetable;
  try { timetable = readEDN(source); }
  catch (error) { throw new EDNImportError(`EDN could not be read: ${error.message}`); }
  const normalizationDiagnostics = normalizeMissingLessonDetails(timetable);
  const { errors } = validateTimetable(timetable);
  if (errors.length) {
    const diagnostics = errors.map(error => ({ ...error, severity: 'error' }));
    throw new EDNImportError(`EDN timetable failed validation: ${errors[0].message} (${errors[0].path})`, diagnostics);
  }
  const summary = summarize(timetable);
  const diagnostics = [...normalizationDiagnostics, ...(summary.unassignedLessons ? [{
    severity: 'warning', code: 'unassigned-lessons', details: { count: summary.unassignedLessons },
    message: `${summary.unassignedLessons} lessons have no assigned time in the source timetable.`, path: 'lessons',
  }] : [])];
  summary.warningCount = diagnostics.length;
  return { timetable, summary, diagnostics };
}

/** Validates the schema before serializing a timetable as native EDN. */
export function exportTimetableEDN(timetable) {
  const { errors } = validateTimetable(timetable);
  if (errors.length) throw new EDNImportError(`EDN export refused invalid timetable: ${errors[0].message} (${errors[0].path})`, errors);
  return writeEDN(timetable);
}
