import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableApp } from '../../timetable/js/app.js';
import { readEDN, writeEDN } from '../../timetable/js/edn-codec.js';
import { createEmptySchool } from '../../timetable/js/school-workbench.js';
import { domParser } from './helpers.js';

const indexPath = fileURLToPath(new URL('../../timetable/index.html', import.meta.url));
const samplePath = new URL('../../OR_30_SETT.ofd', import.meta.url);
const unsupportedPath = new URL('../../timetable/fixtures/unsupported-demo.ofd', import.meta.url);
const fileFrom = (source, name = 'school.ofd') => ({ name, arrayBuffer: async () => {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
} });

async function mount(options = {}) {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document, DOMParser: domParser, ...options });
  return { app, dom, document: dom.window.document };
}

test('OFD is imported from its roster sheet and adds only the selected entity type', async () => {
  const { app, dom, document } = await mount();
  assert.equal(document.querySelector('#ofd-file'), null);
  assert.equal(document.querySelector('#edn-file').accept, '.edn');
  assert.match(document.querySelector('#import-heading').textContent, /progetto EDN/i);
  const input = document.querySelector('#roster-file-classes');
  assert.equal(input.accept, '.ofd,.csv');
  assert.equal(document.querySelector('#roster-file-rooms').accept, '.ofd,.csv');
  assert.equal(document.querySelector('#roster-file-students').accept, '.csv,.ofd');
  const bytes = await readFile(samplePath);
  await app.stageRosterFile('classes', fileFrom(bytes, 'OR_30_SETT.ofd'));
  assert.ok(app.pendingRoster.items.length > 50);
  assert.match(document.querySelector('[data-roster-status="classes"]').textContent, /classi pronte/i);
  assert.equal(app.timetable.lessons.length, 0, 'OFD roster import does not load assignments or lessons');
  document.querySelector('[data-roster-apply="classes"]').click();
  assert.ok(app.timetable.entities.classes.length > 50);
  assert.equal(app.timetable.entities.teachers.length, 0, 'only classes are imported from this action');
  assert.equal(app.timetable.entities.rooms.length, 0);
  assert.ok(app.timetable.source.calendarSourceId, 'the imported school calendar is adopted with its roster');
  assert.equal(app.timetable.entities.classes.some(item => item.sourceData?.ofdTimeframes), false, 'the adopted calendar keeps imported constraints in the active model');
  assert.match(app.timetable.source.rosterImports[0].source.xml, /Questo file è stato generato/);
  assert.match(readEDN(app.exportEDN()).source.rosterImports[0].source.xml, /Questo file è stato generato/);
  document.querySelector('[data-screen="classes"]').click();
  assert.equal(document.querySelector('[data-school-panel="classes"]').hidden, false);
  dom.window.close();
});

test('invalid and unsupported OFD roster files preserve current school data and can be cancelled', async () => {
  const { app, dom, document } = await mount();
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:mine', name: 'Mia' }]);
  const current = app.timetable;
  assert.equal(await app.stageRosterFile('classes', fileFrom('<DOCUMENT>', 'bad.ofd')), false);
  assert.equal(app.timetable, current);
  assert.match(document.querySelector('[data-roster-status="classes"]').textContent, /rimasta invariata/i);
  const unsupported = await readFile(unsupportedPath);
  assert.equal(await app.stageRosterFile('classes', fileFrom(unsupported, 'future.ofd')), true);
  assert.equal(app.timetable, current);
  assert.match(document.querySelector('[data-roster-status="classes"]').textContent, /FUTURE_RULE/i);
  document.querySelector('[data-roster-cancel="classes"]').click();
  assert.equal(app.timetable.entities.teachers[0].name, 'Mia');
  assert.equal(app.timetable.entities.classes.length, 0);
  dom.window.close();
});

test('students require a CSV roster and are linked to an existing class', async () => {
  const { app, dom, document } = await mount();
  app.schoolWorkbench.importEntities('classes', [{ id: 'class:1a', name: '1A' }]);
  assert.equal(await app.stageRosterFile('students', fileFrom('<DOCUMENT/>', 'school.ofd')), false);
  assert.match(document.querySelector('[data-roster-status="students"]').textContent, /non fornisce.*studenti/i);
  assert.equal(await app.stageRosterFile('students', fileFrom('nome,cognome,classe\nAda,Rossi,1A', 'students.csv')), true);
  document.querySelector('[data-roster-apply="students"]').click();
  assert.deepEqual(app.timetable.entities.students.map(student => [student.name, student.classId]), [['Ada Rossi', 'class:1a']]);
  assert.equal(document.querySelector('#school-grid-students tbody tr[data-row="0"] select').value, 'class:1a');
  dom.window.close();
});

test('EDN panel stages and confirms whole-project replacement; export retains the current domain model', async () => {
  let allowReplacement = false;
  const { app, dom, document } = await mount({ confirm: () => allowReplacement });
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:old', name: 'Docente esistente' }]);
  const existing = app.timetable;
  const replacement = createEmptySchool();
  replacement.name = 'Scuola importata';
  const source = writeEDN(replacement);
  const ednFile = fileFrom(source, 'school.edn');
  assert.equal(await app.stageEDNFile(ednFile), true);
  assert.equal(app.timetable, existing, 'staging leaves current data untouched');
  document.querySelector('#apply-import').click();
  assert.equal(app.timetable, existing, 'declining replacement keeps existing work');
  allowReplacement = true;
  document.querySelector('#apply-import').click();
  assert.equal(app.timetable.name, 'Scuola importata');
  assert.deepEqual(readEDN(app.exportEDN()), app.timetable);
  dom.window.close();
});

test('invalid EDN cannot replace the current project', async () => {
  const { app, dom, document } = await mount();
  app.schoolWorkbench.importEntities('teachers', [{ id: 'teacher:mine', name: 'Mia' }]);
  const original = app.timetable;
  await app.stageEDNFile(fileFrom('{:schemaVersion 1}', 'broken.edn'));
  assert.equal(app.timetable, original);
  assert.equal(document.querySelector('#apply-import').disabled, true);
  assert.match(document.querySelector('#import-report').textContent, /importazione non riuscita/i);
  dom.window.close();
});
