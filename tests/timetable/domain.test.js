import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTimetable } from '../../timetable/js/validation.js';

const valid = () => ({
  schemaVersion: 1,
  name: 'Test',
  source: { format: 'orario-facile-ofd', version: '5000', documentId: '1', xml: '<DOCUMENT/>' },
  calendar: { unitMinutes: 60, days: [{ index: 0, shortName: 'MON', name: 'Monday' }], periods: [
    { index: 0, beginMinute: 480, endMinute: 540 }, { index: 1, beginMinute: 540, endMinute: 600 },
  ] },
  entities: {
    teachers: [{ id: 'teacher:T1', name: 'T1' }], rooms: [{ id: 'room:R1', name: 'R1' }],
    classes: [{ id: 'class:C1', name: 'C1' }], subjects: [{ id: 'subject:Math', name: 'Math' }],
  },
  lessons: [{ id: 'lesson:0', sourceIndex: 0, subjectId: 'subject:Math', teacherIds: ['teacher:T1'],
    classIds: ['class:C1'], roomIds: ['room:R1'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 0 } }],
  links: [], parameters: [],
});

test('domain validator accepts a complete schema v1 timetable', () => {
  assert.deepEqual(validateTimetable(valid()), { errors: [], warnings: [] });
});

test('domain validator reports duplicate identifiers, missing references, and invalid assignments', () => {
  const timetable = valid();
  timetable.entities.teachers.push({ id: 'teacher:T1', name: 'Duplicate' });
  timetable.lessons[0].roomIds = ['room:missing'];
  timetable.lessons[0].assignedTime = { dayIndex: 1, periodIndex: 4 };
  const { errors } = validateTimetable(timetable);
  assert.ok(errors.some(error => error.code === 'duplicate-id'));
  assert.ok(errors.some(error => error.code === 'missing-reference'));
  assert.ok(errors.some(error => error.code === 'invalid-assignment'));
});

test('domain validator rejects unsupported schema versions and malformed collections', () => {
  const timetable = valid();
  timetable.schemaVersion = 99;
  timetable.lessons = {};
  const { errors } = validateTimetable(timetable);
  assert.ok(errors.some(error => error.code === 'unsupported-schema-version'));
  assert.ok(errors.some(error => error.code === 'invalid-shape'));
});

test('domain validator rejects ambiguous entity names, empty calendars, and non-contiguous indexes', () => {
  const timetable = valid();
  timetable.entities.teachers.push({ id: 'teacher:T1-copy', name: 'T1' });
  timetable.calendar.days[0].index = 2;
  timetable.calendar.periods = [];
  const { errors } = validateTimetable(timetable);
  assert.ok(errors.some(error => error.code === 'duplicate-name'));
  assert.ok(errors.some(error => error.code === 'invalid-calendar-index'));
  assert.ok(errors.some(error => error.code === 'empty-calendar'));
});
