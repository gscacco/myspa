/** Structural, reference, and assignment validation for timetable schema v1. */

import { TIMETABLE_SCHEMA_VERSION } from './domain.js';

function diagnostic(code, message, path = '') {
  return { code, message, path };
}

function arrayAt(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(diagnostic('invalid-shape', 'Expected a list.', path));
    return [];
  }
  return value;
}

/** Returns structural, reference, and assignment errors without changing the input. */
export function validateTimetable(timetable) {
  const errors = [], warnings = [];
  if (!timetable || typeof timetable !== 'object' || Array.isArray(timetable)) {
    return { errors: [diagnostic('invalid-shape', 'Timetable must be a map.', 'timetable')], warnings };
  }
  if (timetable.schemaVersion !== TIMETABLE_SCHEMA_VERSION) {
    errors.push(diagnostic('unsupported-schema-version', `Expected schema version ${TIMETABLE_SCHEMA_VERSION}.`, 'schemaVersion'));
  }
  if (typeof timetable.name !== 'string' || !timetable.name.trim()) errors.push(diagnostic('invalid-shape', 'Timetable name is required.', 'name'));
  if (!timetable.source || typeof timetable.source.xml !== 'string') errors.push(diagnostic('invalid-shape', 'Preserved source XML is required.', 'source.xml'));

  const calendar = timetable.calendar;
  const days = arrayAt(calendar?.days, 'calendar.days', errors);
  const periods = arrayAt(calendar?.periods, 'calendar.periods', errors);
  if (!days.length || !periods.length) errors.push(diagnostic('empty-calendar', 'At least one day and one period are required.', 'calendar'));
  if (!Number.isInteger(calendar?.unitMinutes) || calendar.unitMinutes <= 0) {
    errors.push(diagnostic('invalid-shape', 'Calendar unitMinutes must be a positive integer.', 'calendar.unitMinutes'));
  }
  const checkIndexes = (items, path) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (!item || !Number.isInteger(item.index) || item.index !== index || seen.has(item.index)) {
        errors.push(diagnostic('invalid-calendar-index', 'Calendar indexes must be unique and contiguous from zero.', `${path}[${index}]`));
      } else seen.add(item.index);
    });
  };
  checkIndexes(days, 'calendar.days');
  checkIndexes(periods, 'calendar.periods');
  periods.forEach((period, index) => {
    if (!Number.isFinite(period?.beginMinute) || !Number.isFinite(period?.endMinute) || period.endMinute <= period.beginMinute) {
      errors.push(diagnostic('invalid-period', 'Period end must follow its start.', `calendar.periods[${index}]`));
    }
  });

  const entityTypes = ['teachers', 'rooms', 'classes', 'subjects'];
  const entities = timetable.entities;
  if (!entities || typeof entities !== 'object') errors.push(diagnostic('invalid-shape', 'Entity collections are required.', 'entities'));
  const entityById = new Map();
  const localIds = new Set();
  for (const type of entityTypes) {
    const values = arrayAt(entities?.[type], `entities.${type}`, errors);
    const names = new Set();
    values.forEach((entity, index) => {
      const path = `entities.${type}[${index}]`;
      if (!entity || typeof entity.id !== 'string' || !entity.id || typeof entity.name !== 'string' || !entity.name.trim()) {
        errors.push(diagnostic('invalid-shape', 'Entity requires a stable id and name.', path));
        return;
      }
      if (localIds.has(entity.id)) errors.push(diagnostic('duplicate-id', `Duplicate identifier ${entity.id}.`, path));
      localIds.add(entity.id);
      if (names.has(entity.name)) errors.push(diagnostic('duplicate-name', `Ambiguous ${type.slice(0, -1)} name ${entity.name}.`, path));
      names.add(entity.name);
      entityById.set(entity.id, type);
      const constraints = entity.constraints;
      if (constraints != null && (typeof constraints !== 'object' || Array.isArray(constraints))) {
        errors.push(diagnostic('invalid-shape', 'Entity constraints must be a map.', `${path}.constraints`));
      } else if (constraints?.timeframes != null) {
        validateTimeframes(constraints.timeframes, `${path}.constraints.timeframes`, days.length, periods.length, errors);
      }
    });
  }

  const lessons = arrayAt(timetable.lessons, 'lessons', errors);
  const lessonIds = new Set();
  lessons.forEach((lesson, index) => {
    const path = `lessons[${index}]`;
    if (!lesson || typeof lesson.id !== 'string' || !lesson.id) {
      errors.push(diagnostic('invalid-shape', 'Lesson requires an identifier.', path));
      return;
    }
    if (lessonIds.has(lesson.id)) errors.push(diagnostic('duplicate-id', `Duplicate lesson identifier ${lesson.id}.`, path));
    lessonIds.add(lesson.id);
    if (!Number.isInteger(lesson.durationPeriods) || lesson.durationPeriods < 1) {
      errors.push(diagnostic('invalid-duration', 'Lesson duration must be a positive number of periods.', `${path}.durationPeriods`));
    }
    const references = [
      ['subjectId', 'subjects'],
      ['teacherIds', 'teachers'],
      ['classIds', 'classes'],
      ['roomIds', 'rooms'],
    ];
    for (const [key, type] of references) {
      const ids = key.endsWith('Ids') ? arrayAt(lesson[key], `${path}.${key}`, errors) : [lesson[key]];
      ids.forEach((id, refIndex) => {
        if (!entityById.has(id) || entityById.get(id) !== type) {
          errors.push(diagnostic('missing-reference', `Unknown ${type.slice(0, -1)} reference ${String(id)}.`, `${path}.${key}${key.endsWith('Ids') ? `[${refIndex}]` : ''}`));
        }
      });
    }
    const assignment = lesson.assignedTime;
    if (assignment != null && (!Number.isInteger(assignment.dayIndex) || assignment.dayIndex < 0 || assignment.dayIndex >= days.length
      || !Number.isInteger(assignment.periodIndex) || assignment.periodIndex < 0
      || assignment.periodIndex + lesson.durationPeriods > periods.length)) {
      errors.push(diagnostic('invalid-assignment', 'Assigned time falls outside the timetable calendar.', `${path}.assignedTime`));
    }
    if (lesson.timeframes != null) validateTimeframes(lesson.timeframes, `${path}.timeframes`, days.length, periods.length, errors);
  });

  for (const [index, link] of arrayAt(timetable.links, 'links', errors).entries()) {
    for (const key of ['subjectAId', 'subjectBId']) {
      if (!entityById.has(link?.[key]) || entityById.get(link[key]) !== 'subjects') {
        errors.push(diagnostic('missing-reference', `Unknown subject reference ${String(link?.[key])}.`, `links[${index}].${key}`));
      }
    }
  }
  arrayAt(timetable.parameters, 'parameters', errors);
  return { errors, warnings };
}

function validateTimeframes(timeframes, path, dayCount, periodCount, errors) {
  if (!timeframes || typeof timeframes !== 'object' || Array.isArray(timeframes)) {
    errors.push(diagnostic('invalid-shape', 'Timeframes must be a map.', path));
    return;
  }
  for (const key of ['unavailable', 'desired', 'undesired']) {
    if (timeframes[key] == null) continue;
    if (!Array.isArray(timeframes[key])) {
      errors.push(diagnostic('invalid-shape', 'Timeframe values must be lists.', `${path}.${key}`));
      continue;
    }
    timeframes[key].forEach((value, index) => {
      const match = typeof value === 'string' ? /^(\d+)\.(\d+)$/.exec(value) : null;
      if (!match || Number(match[1]) >= dayCount || Number(match[2]) >= periodCount) {
        errors.push(diagnostic('invalid-timeframe', `Invalid day.period value ${String(value)}.`, `${path}.${key}[${index}]`));
      }
    });
  }
}
