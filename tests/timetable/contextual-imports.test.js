import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { parseRosterCSV } from '../../timetable/js/roster-importer.js';
import { createTimetableApp } from '../../timetable/js/app.js';

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
