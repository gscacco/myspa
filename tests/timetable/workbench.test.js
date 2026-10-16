import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createSchoolWorkbench } from '../../timetable/js/school-workbench.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { timetableFixture } from './helpers.js';

const htmlPath = new URL('../../timetable/index.html', import.meta.url);

test('the app opens on the school workspace and keeps import secondary', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('#school-page')?.hidden, false);
  assert.equal(document.querySelector('#import-card')?.hidden, true);
  assert.ok(document.querySelector('#school-grid-teachers'));
  assert.ok(document.querySelector('#school-grid-classes'));
  assert.ok(document.querySelector('#school-grid-constraints'));
  assert.ok(document.querySelector('#school-constraint-filter'));
  assert.ok(document.querySelector('[data-screen="calculation"]'));
});

test('all school tables can be searched without changing their underlying data', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.students = [
    { id: 'student:ada', name: 'Ada Rossi', classId: 'class:C1' },
    { id: 'student:leo', name: 'Leo Bianchi', classId: 'class:C2' },
  ];
  app.schoolWorkbench.setTimetable(school);

  const cases = [
    ['teachers', 'Teacher Two', 1],
    ['classes', 'Class Two', 1],
    ['subjects', 'Mathematics', 0],
    ['rooms', 'Room Two', 1],
    ['students', 'Ada Rossi', 0],
    ['lessons', 'Room Two', [2, 3]],
    ['constraints', 'Obbligatorio', 0],
  ];
  for (const [grid, query, expectedRow] of cases) {
    const filter = dom.window.document.querySelector(`#school-filter-${grid}`) || dom.window.document.querySelector('#school-constraint-filter');
    assert.ok(filter, `missing search for ${grid}`);
    filter.value = query;
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const rows = [...dom.window.document.querySelectorAll(`#school-grid-${grid} tbody tr[data-row]:not([data-new-row="true"])`)]
      .filter(row => !row.hidden);
    assert.deepEqual(rows.map(row => Number(row.dataset.row)), Array.isArray(expectedRow) ? expectedRow : [expectedRow], `${grid} search should show the matching row`);
  }
  assert.equal(school.lessons.length, 5, 'searching must not remove lessons from the model');
  const constraintFilter = dom.window.document.querySelector('#school-constraint-filter');
  constraintFilter.value = '09:00';
  constraintFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal([...dom.window.document.querySelectorAll('#school-grid-constraints tbody tr[data-row]:not([data-new-row="true"])')].length, 2, 'constraint search also matches the displayed time');
  const teacherFilter = dom.window.document.querySelector('#school-filter-teachers');
  teacherFilter.value = '';
  teacherFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal([...dom.window.document.querySelectorAll('#school-grid-teachers tbody tr[data-row]:not([data-new-row="true"])')].filter(row => !row.hidden).length, 2);
  dom.window.close();
});

test('editing a lesson keeps unrelated and lesson table rows in place', () => {
  const document = new JSDOM('<main><section id="school-page"><table id="school-grid-teachers"></table><table id="school-grid-classes"></table><table id="school-grid-subjects"></table><table id="school-grid-rooms"></table><table id="school-grid-students"></table><table id="school-grid-lessons"></table><div><table id="school-grid-constraints"></table><input id="school-constraint-filter"><span id="school-constraint-count"></span><button id="school-constraint-previous"></button><button id="school-constraint-next"></button></div><button id="undo-school-edit" disabled></button><p id="school-edit-status"></p></section></main>').window.document;
  const workbench = createSchoolWorkbench({ document });
  workbench.setTimetable(timetableFixture());
  const teacherBody = document.querySelector('#school-grid-teachers tbody');
  const lessonRow = document.querySelector('#school-grid-lessons tbody tr[data-row="0"]');
  const subject = lessonRow.querySelector('input');
  subject.value = 'History';
  subject.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(workbench.timetable.lessons[0].subjectId, 'subject:HIST');
  assert.equal(document.querySelector('#school-grid-teachers tbody'), teacherBody);
  assert.equal(document.querySelector('#school-grid-lessons tbody tr[data-row="0"]'), lessonRow);
  document.querySelector('#undo-school-edit').click();
  assert.equal(workbench.timetable.lessons[0].subjectId, 'subject:MATH');

  const freshRow = document.querySelector('#school-grid-lessons tbody tr[data-new-row="true"]');
  const [newSubject, newTeacher, newClass] = freshRow.querySelectorAll('input');
  for (const [input, value] of [[newSubject, 'Mathematics'], [newTeacher, 'Teacher Two'], [newClass, 'Class Two']]) {
    input.value = value;
    input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  }
  assert.equal(workbench.timetable.lessons.length, 6);
  assert.ok(document.querySelector('#school-grid-lessons tbody tr[data-new-row="true"]'));
  document.querySelector('#undo-school-edit').click();
  assert.equal(workbench.timetable.lessons.length, 5);
});

test('the school grids edit names in place, add by blank row, and undo the latest edit', () => {
  const document = new JSDOM('<main><section id="school-page"><table id="school-grid-teachers"></table><table id="school-grid-classes"></table><table id="school-grid-subjects"></table><table id="school-grid-rooms"></table><table id="school-grid-lessons"></table><div><table id="school-grid-constraints"></table><input id="school-constraint-filter"><span id="school-constraint-count"></span><button id="school-constraint-previous"></button><button id="school-constraint-next"></button></div><button id="undo-school-edit" disabled></button><p id="school-edit-status"></p></section></main>').window.document;
  let updated;
  const workbench = createSchoolWorkbench({ document, onChange: value => { updated = value; } });
  const source = timetableFixture();
  workbench.setTimetable(source);
  const teacherCell = document.querySelector('[data-grid="teachers"] [data-row="0"] [data-field="name"]');
  teacherCell.value = 'Docente aggiornato';
  teacherCell.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(updated.entities.teachers[0].name, 'Docente aggiornato');
  assert.ok(document.querySelector('[data-grid="teachers"] [data-new-row="true"]'));
  const undoButton = document.querySelector('#undo-school-edit');
  assert.equal(undoButton.disabled, false);
  undoButton.click();
  assert.equal(workbench.timetable.entities.teachers[0].name, 'Teacher One');
  assert.equal(undoButton.disabled, true);
  const filter = document.querySelector('#school-constraint-filter');
  filter.value = 'Teacher Two';
  filter.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#school-constraint-count').textContent, '1–1 di 1');
});

test('the constraint sheet adds and removes an unavailable slot without an add button', () => {
  const document = new JSDOM('<main><section id="school-page"><table id="school-grid-teachers"></table><table id="school-grid-classes"></table><table id="school-grid-subjects"></table><table id="school-grid-rooms"></table><table id="school-grid-lessons"></table><div><table id="school-grid-constraints"></table><input id="school-constraint-filter"><span id="school-constraint-count"></span><button id="school-constraint-previous"></button><button id="school-constraint-next"></button></div><button id="undo-school-edit" disabled></button><p id="school-edit-status"></p></section></main>').window.document;
  const workbench = createSchoolWorkbench({ document });
  const source = timetableFixture();
  workbench.setTimetable(source);
  const row = document.querySelector('#school-grid-constraints [data-new-row="true"]');
  const [target, kind, day, period] = row.querySelectorAll('input, select');
  target.value = 'Docente · Teacher One';
  target.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  kind.value = 'unavailable'; kind.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  day.value = '0'; day.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  period.value = '0'; period.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(source.entities.teachers[0].constraints.timeframes.unavailable, ['0.0']);
  const added = document.querySelector('#school-grid-constraints tbody tr[data-row="0"]');
  added.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Delete', ctrlKey: true, bubbles: true }));
  assert.deepEqual(source.entities.teachers[0].constraints.timeframes.unavailable, []);
});

test('calculation controls expose time, objective and worker limits', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const document = new JSDOM(html).window.document;
  assert.ok(document.querySelector('#optimization-time-limit'));
  assert.ok(document.querySelector('#optimization-target'));
  assert.ok(document.querySelector('#optimization-workers'));
  assert.ok(document.querySelector('#optimization-iteration'));
  assert.ok(document.querySelector('#optimization-objective'));
});

test('the application shell follows the local Chronos mockup without remote runtime assets', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const css = await readFile(new URL('../../timetable/css/style.css', import.meta.url), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.ok(document.querySelector('aside#app-sidebar nav[aria-label="Navigazione principale"]'));
  for (const view of ['schedule', 'calculation', 'teachers', 'classes', 'students', 'rooms', 'constraints', 'lessons']) {
    assert.ok(document.querySelector(`[data-screen="${view}"]`), `missing ${view} navigation`);
  }
  assert.match(css, /--primary:\s*#2563eb/i);
  assert.match(css, /--canvas:\s*#f8fafc/i);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i);
});

test('sidebar navigation opens one focused school sheet at a time', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const { document } = dom.window;
  assert.equal(document.querySelector('[data-school-panel="teachers"]').hidden, false);
  document.querySelector('[data-screen="classes"]').click();
  assert.equal(app.activeScreen, 'school');
  assert.equal(document.querySelector('[data-school-panel="teachers"]').hidden, true);
  assert.equal(document.querySelector('[data-school-panel="classes"]').hidden, false);
  assert.equal(document.querySelector('[data-screen="classes"]').getAttribute('aria-pressed'), 'true');
  document.querySelector('[data-screen="constraints"]').click();
  assert.equal(document.querySelector('[data-school-panel="constraints"]').hidden, false);
  assert.equal(document.querySelector('[data-school-panel="classes"]').hidden, true);
  dom.window.close();
});

test('the school name edit can also be undone', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const name = dom.window.document.querySelector('#school-name');
  name.value = 'Istituto di prova';
  name.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(app.timetable.name, 'Istituto di prova');
  dom.window.document.querySelector('#undo-school-edit').click();
  assert.equal(app.timetable.name, 'Nuova scuola');
  assert.equal(name.value, 'Nuova scuola');
  dom.window.close();
});

test('student rows support direct edits, class reassignment, and deletion', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  app.schoolWorkbench.importEntities('classes', [{ id: 'class:1a', name: '1A' }, { id: 'class:1b', name: '1B' }]);
  const { document } = dom.window;
  const name = document.querySelector('#school-grid-students [data-new-row="true"] input');
  const classSelect = document.querySelector('#school-grid-students [data-new-row="true"] select');
  name.value = 'Ada Rossi'; classSelect.value = 'class:1a';
  name.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(app.timetable.entities.students.map(item => [item.name, item.classId]), [['Ada Rossi', 'class:1a']]);
  const active = document.querySelector('#school-grid-students tbody tr[data-row="0"]');
  active.querySelector('input').value = 'Ada Verdi';
  active.querySelector('select').value = 'class:1b';
  active.querySelector('select').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(app.timetable.entities.students.map(item => [item.name, item.classId]), [['Ada Verdi', 'class:1b']]);
  active.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', ctrlKey: true, bubbles: true }));
  assert.deepEqual(app.timetable.entities.students, []);
  dom.window.close();
});
