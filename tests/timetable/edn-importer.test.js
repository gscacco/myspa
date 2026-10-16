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
    teachers: 0, rooms: 0, classes: 0, subjects: 0, students: 0, lessons: 0,
    assignedLessons: 0, unassignedLessons: 0, warningCount: 0,
  });
});

test('EDN import fails explicitly on unsupported schema or invalid references', () => {
  const unsupported = { ...valid, schemaVersion: 2 };
  assert.throws(() => importTimetableEDN(writeEDN(unsupported)), /schema|version/i);
  const invalid = { ...valid, lessons: [{ id: 'lesson:0', subjectId: 'subject:missing', teacherIds: [], classIds: [], roomIds: [], durationPeriods: 1, assignedTime: null }] };
  assert.throws(() => importTimetableEDN(writeEDN(invalid)), /reference|subject/i);
});

test('EDN import replaces only missing lesson class and subject with explicit UNKNOWN placeholders', () => {
  const source = structuredClone(valid);
  source.entities.teachers.push({ id: 'teacher:t1', name: 'T1' });
  source.lessons.push({ id: 'lesson:incomplete', teacherIds: ['teacher:t1'], roomIds: [], durationPeriods: 1, assignedTime: null });

  const imported = importTimetableEDN(writeEDN(source));
  const lesson = imported.timetable.lessons[0];
  const unknownClass = imported.timetable.entities.classes.find(item => item.id === lesson.classIds[0]);
  const unknownSubject = imported.timetable.entities.subjects.find(item => item.id === lesson.subjectId);

  assert.equal(unknownClass.name, 'UNKNOWN');
  assert.equal(unknownClass.placeholder, 'unknown');
  assert.equal(unknownSubject.name, 'UNKNOWN');
  assert.equal(unknownSubject.placeholder, 'unknown');
  assert.deepEqual(imported.diagnostics.map(item => item.code), ['lesson-without-class', 'lesson-without-subject', 'unassigned-lessons']);
  assert.equal(imported.summary.warningCount, 3);
  assert.throws(() => importTimetableEDN(writeEDN({
    ...source,
    lessons: [{ ...source.lessons[0], subjectId: 'subject:missing', classIds: ['class:missing'] }],
  })), /reference/i, 'non-empty dangling references remain fatal');
});

test('EDN export refuses invalid timetable state instead of serializing it', () => {
  assert.throws(() => exportTimetableEDN({ ...valid, lessons: null }), /lesson|list|schema/i);
});

test('EDN round trip preserves student roster references and source import metadata', () => {
  const timetable = structuredClone(valid);
  timetable.entities.students = [{ id: 'student:ada', name: 'Ada Rossi', classId: 'class:1A' }];
  timetable.entities.classes.push({ id: 'class:1A', name: '1A' });
  timetable.source.rosterImports = [{ format: 'csv-roster', filename: 'studenti.csv', collection: 'students', content: 'nome,classe\nAda Rossi,1A' }];
  assert.deepEqual(importTimetableEDN(exportTimetableEDN(timetable)).timetable, timetable);
});
