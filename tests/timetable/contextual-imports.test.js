import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { parseRosterCSV } from '../../timetable/js/roster-importer.js';
import { importOFD } from '../../timetable/js/ofd-importer.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { minimalOFD, lessonXML } from './helpers.js';

const htmlPath = new URL('../../timetable/index.html', import.meta.url);
const fileFrom = (name, source) => ({ name, arrayBuffer: async () => new TextEncoder().encode(source).buffer });

test('CSV roster import parses Italian headers, quoted fields, and class references', () => {
  const timetable = { entities: { classes: [{ id: 'class:1a', name: '1A' }] } };
  assert.deepEqual(parseRosterCSV('nome; note\r\n"1A; seconda";ok', 'classes', timetable), {
    items: [{ name: '1A; seconda', sourceData: { note: 'ok' } }], warnings: [],
  });
  assert.deepEqual(parseRosterCSV('nome;cognome;classe\nAda;Rossi;1A', 'students', timetable), {
    items: [{ name: 'Ada Rossi', classId: 'class:1a' }], warnings: [],
  });
  assert.throws(() => parseRosterCSV('nome,cognome,classe\nAda,Rossi,2B', 'students', timetable), /classe.*2B/i);
  assert.throws(() => parseRosterCSV('nome\n"Ada', 'rooms', timetable), /virgolette|CSV/i);
});

test('school screens navigate freely; calculation is available but its action waits for complete inputs', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document });
  assert.equal(document.querySelector('#school-next'), null);
  assert.equal(document.querySelector('#ofd-file'), null, 'OFD import belongs to a roster sheet');
  assert.ok(document.querySelector('#edn-file'));
  document.querySelector('[data-screen="calculation"]').click();
  assert.equal(app.activeScreen, 'calculation');
  assert.equal(document.querySelector('#recalculate-all').disabled, true);
  assert.match(document.querySelector('#calculation-readiness').textContent, /docenti.*classi.*lezioni/i);
  dom.window.close();
});

test('CSV imports are scoped to the selected roster, staged, and applied without replacing existing entries', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document });
  const input = document.querySelector('#roster-file-classes');
  assert.ok(input);
  assert.equal(document.querySelector('#global-ofd-file'), null);
  await app.stageRosterFile('classes', fileFrom('classi.csv', 'nome\n1A\n2B'));
  assert.deepEqual(app.pendingRoster.items, [{ name: '1A' }, { name: '2B' }]);
  assert.equal(app.timetable.entities.classes.length, 0, 'staging never mutates the school');
  document.querySelector('[data-roster-apply="classes"]').click();
  assert.deepEqual(app.timetable.entities.classes.map(item => item.name), ['1A', '2B']);

  const students = fileFrom('studenti.csv', 'nome,cognome,classe\nAda,Rossi,1A');
  await app.stageRosterFile('students', students);
  document.querySelector('[data-roster-apply="students"]').click();
  assert.deepEqual(app.timetable.entities.students.map(item => [item.name, item.classId]), [['Ada Rossi', app.timetable.entities.classes[0].id]]);
  assert.equal(app.timetable.source.rosterImports.length, 2, 'source CSV data is preserved in the project EDN');
  dom.window.close();
});

test('teacher CSV uses the teacher sheet and retains columns outside the known fields', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  await app.stageRosterFile('teachers', fileFrom('docenti.csv', 'docente,email\nAda Rossi,ada@example.test'));
  dom.window.document.querySelector('[data-roster-apply="teachers"]').click();
  assert.equal(app.timetable.entities.teachers[0].name, 'Ada Rossi');
  assert.deepEqual(app.timetable.entities.teachers[0].sourceData, { email: 'ada@example.test' });
  assert.equal(app.timetable.source.rosterImports[0].content, 'docente,email\nAda Rossi,ada@example.test');
  dom.window.close();
});

test('OFD roster import extracts only classes or rooms and never replaces unrelated school data', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, DOMParser: dom.window.DOMParser });
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:mine', name: 'Mia' }]);
  const ofd = await readFile(new URL('../../OR_30_SETT.ofd', import.meta.url));
  const file = { name: 'OR_30_SETT.ofd', arrayBuffer: async () => ofd.buffer.slice(ofd.byteOffset, ofd.byteOffset + ofd.byteLength) };
  await app.stageRosterFile('classes', file);
  assert.ok(app.pendingRoster.items.length > 50);
  document.querySelector('[data-roster-apply="classes"]').click();
  assert.equal(app.timetable.entities.teachers[0].name, 'Mia');
  assert.equal(app.timetable.lessons.length, 0);
  dom.window.close();
});

test('lessons sheet stages OFD lesson requirements and applies them without source assignments', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, DOMParser: dom.window.DOMParser });
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:T1', name: 'T1' }]);
  app.schoolWorkbench.importEntities('classes', [{ id: 'class:C1', name: 'C1' }]);
  app.schoolWorkbench.importEntities('rooms', [{ id: 'room:R1', name: 'R1' }]);
  app.timetable.calendar = {
    unitMinutes: 60,
    days: [{ index: 0, name: 'Monday', shortName: 'MON' }],
    periods: [{ index: 0, beginMinute: 480, endMinute: 540 }, { index: 1, beginMinute: 540, endMinute: 600 }],
  };
  app.schoolWorkbench.setTimetable(app.timetable);
  const original = app.timetable;
  const ofd = minimalOFD({ lesson: lessonXML({ time: '0.1' }) });

  document.querySelector('[data-screen="lessons"]').click();
  assert.equal(document.querySelector('#ofd-file'), null);
  assert.equal(document.querySelector('#lesson-ofd-file').accept, '.ofd');
  assert.equal(document.querySelector('[data-school-panel="lessons"]').hidden, false);
  document.querySelector('[data-lessons-open]').click();
  assert.equal(document.querySelector('[data-lessons-panel]').hidden, false);
  assert.equal(await app.stageLessonsFile(fileFrom('school.ofd', ofd)), true);
  assert.equal(app.timetable, original, 'preview does not change current data');
  assert.equal(app.pendingLessons.lessons.length, 1);
  assert.equal(app.pendingLessons.lessons[0].assignedTime, null);
  assert.match(document.querySelector('[data-lessons-status]').textContent, /1 lezione pronta/i);

  document.querySelector('[data-lessons-apply]').click();
  assert.equal(app.timetable.lessons.length, 1);
  assert.equal(app.timetable.lessons[0].assignedTime, null);
  assert.equal(app.timetable.source.assignmentHints, undefined, 'OFD placements are not stored as calculation hints');
  assert.equal(app.timetable.entities.teachers.length, 1);
  assert.equal(app.timetable.entities.classes.length, 1);
  assert.equal(app.timetable.entities.subjects[0].name, 'Math');
  assert.equal(app.timetable.lessons[0].teacherIds[0], 'teacher:T1');
  assert.equal(app.timetable.lessons[0].classIds[0], 'class:C1');
  assert.equal(app.timetable.lessons[0].roomIds[0], 'room:R1');
  assert.match(app.timetable.source.lessonImports[0].source.xml, /<LESSON>/);
  assert.equal(await app.stageLessonsFile(fileFrom('school.ofd', ofd)), false);
  assert.match(document.querySelector('[data-lessons-status]').textContent, /già importate/i);
  assert.equal(app.schoolWorkbench.undo(), true);
  assert.equal(app.timetable.lessons.length, 0);
  assert.equal(app.timetable.entities.subjects.length, 0);
  assert.equal(app.timetable.source.assignmentHints, undefined);
  dom.window.close();
});

test('lesson OFD import requires its referenced school structure and supports cancel and malformed input', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, DOMParser: dom.window.DOMParser });
  const original = app.timetable;
  const ofd = minimalOFD({ lesson: lessonXML() });

  assert.equal(await app.stageLessonsFile(fileFrom('school.ofd', ofd)), false);
  assert.equal(app.timetable, original);
  assert.match(document.querySelector('[data-lessons-status]').textContent, /importa prima.*docenti.*classi.*aule/i);
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:T1', name: 'T1' }]);
  app.schoolWorkbench.importEntities('classes', [{ id: 'class:C1', name: 'C1' }]);
  app.schoolWorkbench.importEntities('rooms', [{ id: 'room:R1', name: 'R1' }]);
  assert.equal(await app.stageLessonsFile(fileFrom('school.ofd', ofd)), true);
  document.querySelector('[data-lessons-cancel]').click();
  assert.equal(app.timetable.lessons.length, 0);
  assert.equal(await app.stageLessonsFile(fileFrom('bad.ofd', '<DOCUMENT>')), false);
  assert.equal(app.timetable.lessons.length, 0);
  assert.match(document.querySelector('[data-lessons-status]').textContent, /scuola.*invariata/i);
  dom.window.close();
});

test('lesson OFD import does not apply source times when its calendar differs', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, DOMParser: dom.window.DOMParser });
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:T1', name: 'T1' }]);
  app.schoolWorkbench.importEntities('classes', [{ id: 'class:C1', name: 'C1' }]);
  app.schoolWorkbench.importEntities('rooms', [{ id: 'room:R1', name: 'R1' }]);
  app.timetable.source.calendarSourceId = 'existing-calendar';
  app.schoolWorkbench.setTimetable(app.timetable);
  const ofd = minimalOFD({ lesson: lessonXML({ time: '0.1', timeframes: '<UNAVAIL value="0.0"/>' }) });

  assert.equal(await app.stageLessonsFile(fileFrom('different-calendar.ofd', ofd)), true);
  assert.match(document.querySelector('[data-lessons-status]').textContent, /calendario è diverso/i);
  document.querySelector('[data-lessons-apply]').click();
  assert.equal(app.timetable.lessons[0].assignedTime, null);
  assert.equal(app.timetable.source.assignmentHints, undefined);
  assert.deepEqual(app.timetable.lessons[0].timeframes, { unavailable: [], desired: [], undesired: [] });
  assert.deepEqual(app.timetable.lessons[0].sourceData.ofdTimeframes.unavailable, ['0.0']);
  assert.ok(app.diagnostics.some(item => item.code === 'lesson-timeframes-preserved'));
  assert.equal(app.schoolWorkbench.undo(), true);
  assert.equal(app.diagnostics.some(item => item.code === 'lesson-timeframes-preserved'), false);
  dom.window.close();
});

test('lesson sheet imports every lesson from the supplied OFD against its imported school structure', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const bytes = await readFile(new URL('../../OR_30_SETT.ofd', import.meta.url));
  const parsed = await importOFD(new Uint8Array(bytes), { DOMParser: dom.window.DOMParser });
  const app = createTimetableApp({ document, importer: async () => parsed });
  const school = app.timetable;
  school.calendar = structuredClone(parsed.timetable.calendar);
  school.entities = structuredClone(parsed.timetable.entities);
  school.entities.students = [];
  app.schoolWorkbench.setTimetable(school);

  document.querySelector('[data-screen="lessons"]').click();
  const file = fileFrom('OR_30_SETT.ofd', bytes);
  assert.equal(await app.stageLessonsFile(file), true, document.querySelector('[data-lessons-status]').textContent);
  assert.equal(app.timetable.lessons.length, 0);
  document.querySelector('[data-lessons-apply]').click();
  assert.equal(app.timetable.lessons.length, parsed.timetable.lessons.length);
  assert.ok(app.timetable.lessons.every(lesson => lesson.assignedTime === null));
  assert.equal(app.timetable.source.assignmentHints, undefined, 'the imported placements are not kept as calculation hints');
  assert.match(document.querySelector('[data-lessons-status]').textContent, /lezioni OFD.*UNKNOWN/i);
  assert.ok(app.diagnostics.some(item => item.code === 'lesson-without-class'));
  assert.equal(app.timetable.lessons.filter(lesson => app.timetable.entities.classes.find(item => item.id === lesson.classIds[0])?.placeholder === 'unknown').length, 166);
  assert.equal(document.querySelector('#recalculate-all').disabled, false, 'unknown class placeholders let the calculation proceed');
  assert.match(app.timetable.source.lessonImports[0].source.xml, /<LESSON/);
  dom.window.close();
});
