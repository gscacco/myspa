import { TIMETABLE_SCHEMA_VERSION } from './domain.js';
import { validateTimetable } from './validation.js';

export class BlankTimetableError extends Error {
  constructor(message) { super(message); this.name = 'BlankTimetableError'; }
}

function cleanNames(values, label, required = true) {
  if (!Array.isArray(values)) throw new BlankTimetableError(`Elenco ${label} non valido.`);
  const names = values.map(value => String(value || '').trim()).filter(Boolean);
  const singular = { giorni: 'giorno', docenti: 'docente', classi: 'classe', aule: 'aula', materie: 'materia' }[label] || label;
  if (required && !names.length) throw new BlankTimetableError(`Inserisci almeno un ${singular}.`);
  if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) throw new BlankTimetableError(`Ci sono nomi ${label} duplicati.`);
  return names;
}

function identifier(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'elemento';
}

function makeEntities(names, type) {
  return names.map((name, index) => {
    const entity = { id: `${type}:${identifier(name)}-${index + 1}`, name };
    if (type !== 'subject') entity.constraints = { timeframes: { unavailable: [], desired: [], undesired: [] } };
    return entity;
  });
}

/** Builds the native timetable model for a new school without importing a file. */
export function createBlankTimetable({ name, unitMinutes = 60, days, periods, teachers, classes, rooms = [], subjects, lessons }) {
  const timetableName = String(name || '').trim();
  if (!timetableName) throw new BlankTimetableError('Inserisci il nome dell’orario.');
  const dayNames = cleanNames(days, 'giorni');
  if (!Array.isArray(periods) || !periods.length) throw new BlankTimetableError('Inserisci almeno una fascia oraria.');
  if (!Number.isInteger(unitMinutes) || unitMinutes <= 0) throw new BlankTimetableError('La durata dell’ora deve essere positiva.');
  const normalizedPeriods = periods.map((period, index) => {
    const beginMinute = Number(period?.beginMinute), endMinute = Number(period?.endMinute);
    if (!Number.isFinite(beginMinute) || !Number.isFinite(endMinute) || endMinute <= beginMinute) {
      throw new BlankTimetableError(`Fascia oraria ${index + 1} non valida.`);
    }
    return { index, beginMinute, endMinute };
  });
  const teacherNames = cleanNames(teachers, 'docenti');
  const classNames = cleanNames(classes, 'classi');
  const roomNames = cleanNames(rooms, 'aule', false);
  const subjectNames = cleanNames(subjects, 'materie');
  if (!Array.isArray(lessons) || !lessons.length) throw new BlankTimetableError('Aggiungi almeno una lezione prima di creare l’orario.');

  const entities = {
    teachers: makeEntities(teacherNames, 'teacher'),
    classes: makeEntities(classNames, 'class'),
    rooms: makeEntities(roomNames, 'room'),
    subjects: makeEntities(subjectNames, 'subject'),
  };
  const find = (collection, label, value) => {
    const match = entities[collection].find(item => item.name === String(value || '').trim());
    if (!match) throw new BlankTimetableError(`Riferimento ${label} non presente: ${value || '(vuoto)'}.`);
    return match.id;
  };
  const normalizedLessons = lessons.map((lesson, index) => {
    const durationPeriods = Number(lesson.durationPeriods || 1);
    if (!Number.isInteger(durationPeriods) || durationPeriods < 1 || durationPeriods > normalizedPeriods.length) {
      throw new BlankTimetableError(`Durata non valida per la lezione ${index + 1}.`);
    }
    const roomIds = lesson.room ? [find('rooms', 'aula', lesson.room)] : [];
    return {
      id: `lesson:new-${index + 1}`,
      sourceIndex: index,
      subjectId: find('subjects', 'materia', lesson.subject),
      teacherIds: [find('teachers', 'docente', lesson.teacher)],
      classIds: [find('classes', 'classe', lesson.class)],
      roomIds,
      durationPeriods,
      assignedTime: null,
      timeframes: { unavailable: [], desired: [], undesired: [] },
    };
  });
  const timetable = {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    name: timetableName,
    source: { format: 'native', version: '1', xml: '', unsupportedStructures: [] },
    calendar: {
      unitMinutes,
      days: dayNames.map((dayName, index) => ({ index, shortName: dayName.slice(0, 3).toLocaleUpperCase(), name: dayName })),
      periods: normalizedPeriods,
    },
    entities,
    lessons: normalizedLessons,
    links: [],
    parameters: [],
  };
  const errors = validateTimetable(timetable).errors;
  if (errors.length) throw new BlankTimetableError(`Struttura non valida: ${errors[0].message}`);
  return timetable;
}
