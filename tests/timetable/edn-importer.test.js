import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTimetableEDN, exportTimetableEDN } from '../../timetable/js/edn-importer.js';
import { readEDN, writeEDN } from '../../timetable/js/edn-codec.js';

const valid = {
  schemaVersion: 1, name: 'EDN schedule',
  source: { format: 'orario-facile-ofd', version: '5000', documentId: '1', xml: '<DOCUMENT/>' },
  calendar: { unitMinutes: 60, days: [{ index: 0, shortName: 'MON', name: 'Monday' }], periods: [{ index: 0, beginMinute: 480, endMinute: 540 }] },
  entities: { teachers: [], rooms: [], classes: [], subjects: [] },
  lessons: [], links: [], parameters: [],
};

test('EDN timetable import/export validate schema v1 and preserve semantic values', () => {
  const source = exportTimetableEDN(valid);
  const imported = importTimetableEDN(source);
  assert.deepEqual(imported.timetable, valid);
  assert.deepEqual(readEDN(exportTimetableEDN(imported.timetable)), valid);
  assert.deepEqual(imported.summary, {
    teachers: 0, rooms: 0, classes: 0, subjects: 0, lessons: 0,
    assignedLessons: 0, unassignedLessons: 0, warningCount: 0,
  });
});

test('EDN import fails explicitly on unsupported schema or invalid references', () => {
  const unsupported = { ...valid, schemaVersion: 2 };
  assert.throws(() => importTimetableEDN(writeEDN(unsupported)), /schema|version/i);
  const invalid = { ...valid, lessons: [{ id: 'lesson:0', subjectId: 'subject:missing', teacherIds: [], classIds: [], roomIds: [], durationPeriods: 1, assignedTime: null }] };
  assert.throws(() => importTimetableEDN(writeEDN(invalid)), /reference|subject/i);
});

test('EDN export refuses invalid timetable state instead of serializing it', () => {
  assert.throws(() => exportTimetableEDN({ ...valid, lessons: null }), /lesson|list|schema/i);
});
