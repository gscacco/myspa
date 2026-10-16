import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { importOFD, OFDImportError } from '../../timetable/js/ofd-importer.js';
import { exportTimetableEDN, importTimetableEDN } from '../../timetable/js/edn-importer.js';
import { domParser, lessonXML, minimalOFD } from './helpers.js';

const samplePath = fileURLToPath(new URL('../../OR_30_SETT.ofd', import.meta.url));
const unsupportedPath = fileURLToPath(new URL('../../timetable/fixtures/unsupported-demo.ofd', import.meta.url));
const parse = (source, options = {}) => importOFD(source, { DOMParser: domParser, ...options });

test('imports observed entities, lesson relationships, calendar, constraints, and diagnostics from the supplied OFD', async () => {
  const original = await readFile(samplePath);
  const result = parse(original);
  const timetable = result.timetable;
  assert.equal(timetable.source.version, '5000');
  assert.equal(timetable.source.documentId, '1203847731');
  assert.equal(timetable.entities.teachers.length, 118);
  assert.equal(timetable.entities.rooms.length, 61);
  assert.equal(timetable.entities.classes.length, 58);
  assert.equal(timetable.entities.subjects.length, 40);
  assert.equal(timetable.lessons.length, 1714);
  assert.equal(timetable.lessons.filter(lesson => lesson.assignedTime).length, 1708);
  assert.equal(timetable.lessons.filter(lesson => !lesson.assignedTime).length, 6);
  assert.equal(timetable.calendar.days.length, 6);
  assert.equal(timetable.calendar.periods.length, 6);
  assert.equal(timetable.calendar.periods[0].beginMinute, 480);
  assert.equal(timetable.calendar.unitMinutes, 60);
  assert.deepEqual(timetable.source.catalogues, { periodDataName: 'Orario definitivo', sites: ['UNICA'], modules: ['STANDARD'] });
  assert.ok(timetable.lessons.some(lesson => lesson.teacherIds.length > 1));
  assert.ok(timetable.lessons.some(lesson => lesson.roomIds.length === 0));
  assert.ok(timetable.lessons.some(lesson => lesson.durationPeriods === 2));
  assert.ok(timetable.entities.teachers.some(teacher => teacher.constraints?.timeframes?.unavailable?.length));
  assert.ok(timetable.entities.subjects.some(subject => subject.preferences?.backgroundColor !== undefined));
  assert.equal(timetable.links.length, 40);
  assert.equal(timetable.parameters.length, 25);
  assert.equal(timetable.source.xml.length > 0, true);
  assert.ok(result.diagnostics.some(item => item.code === 'encoding-mismatch'));
  assert.ok(result.diagnostics.some(item => item.code === 'unassigned-lessons'));
  assert.deepEqual(importTimetableEDN(exportTimetableEDN(timetable)).timetable, timetable, 'full imported model round-trips through EDN');
  assert.deepEqual(await readFile(samplePath), original, 'import never changes the source file');
});

test('maps a synthetic lesson and its availability to explicit calendar indexes', () => {
  const xml = minimalOFD({ lesson: lessonXML({
    time: '0.1', timeframes: '<UNAVAIL value="0.0"/><DESIRED value="0.1"/>', duration: '1',
  }) });
  const { timetable } = parse(xml);
  assert.deepEqual(timetable.lessons[0].assignedTime, { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' });
  assert.deepEqual(timetable.lessons[0].timeframes, { unavailable: ['0.0'], desired: ['0.1'], undesired: [] });
  assert.deepEqual(timetable.entities.teachers[0].constraints.timeframes, { unavailable: [], desired: [], undesired: [] });
});

test('fatal malformed XML, missing required data, invalid references, duplicates, and invalid times are rejected', () => {
  const cases = [
    ['<DOCUMENT>', /XML/i],
    [minimalOFD().replace(/<TIMEGRID>[\s\S]*?<\/TIMEGRID>/, ''), /TIMEGRID|required/i],
    [minimalOFD({ lesson: lessonXML({ subject: 'Missing' }) }), /missing|reference/i],
    [minimalOFD().replace('<TEACHER><NAME value="T1"/><SEX value="X"/></TEACHER>', '<TEACHER><NAME value="T1"/></TEACHER><TEACHER><NAME value="T1"/></TEACHER>'), /duplicate/i],
    [minimalOFD({ lesson: lessonXML({ time: '9.0' }) }), /time|period|assignment/i],
  ];
  for (const [source, pattern] of cases) {
    assert.throws(() => parse(source), error => error instanceof OFDImportError && pattern.test(error.message), source.slice(0, 80));
  }
});

test('reports unsupported XML without discarding it from the preserved source', () => {
  const xml = minimalOFD({ additions: '<FUTURE_RULE value="opaque"/>' });
  const { timetable, diagnostics } = parse(xml);
  assert.ok(diagnostics.some(item => item.code === 'unsupported-structure' && item.path.includes('FUTURE_RULE')));
  assert.match(timetable.source.xml, /<FUTURE_RULE value="opaque"\/>/);
});

test('the repeatable synthetic unsupported OFD fixture reports and preserves its unknown structure', async () => {
  const { timetable, diagnostics } = parse(await readFile(unsupportedPath));
  assert.ok(diagnostics.some(item => item.code === 'unsupported-structure' && item.path.includes('FUTURE_RULE')));
  assert.match(timetable.source.xml, /<FUTURE_RULE value="opaque"\/>/);
});

test('rejects DTD declarations rather than resolving entities', () => {
  const xml = minimalOFD().replace('<DOCUMENT>', '<!DOCTYPE DOCUMENT [<!ENTITY x SYSTEM "file:///etc/passwd">]><DOCUMENT>');
  assert.throws(() => parse(xml), error => error instanceof OFDImportError && /DTD|entity/i.test(error.message));
});
