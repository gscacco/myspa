import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createSchoolWorkbench } from '../../timetable/js/school-workbench.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { writeEDN } from '../../timetable/js/edn-codec.js';
import { getCalculationReadiness } from '../../timetable/js/validation.js';
import { optimizationScope } from '../../timetable/js/optimization-scope.js';
import { timetableFixture } from './helpers.js';

const htmlPath = new URL('../../timetable/index.html', import.meta.url);

test('the app opens on the requested data workspace with import in settings', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('#school-page')?.hidden, false);
  assert.equal(document.querySelector('#import-card')?.hidden, true);
  assert.ok(document.querySelector('#school-grid-teachers'));
  assert.ok(document.querySelector('#school-grid-classes'));
  assert.ok(document.querySelector('#school-grid-constraints'));
  assert.ok(document.querySelector('#school-constraint-filter'));
  assert.deepEqual([...document.querySelectorAll('#app-sidebar nav [data-screen]')].map(button => button.dataset.screen), ['schedule', 'teachers', 'classes', 'rooms', 'constraints', 'pdf']);
  assert.equal(document.querySelector('#entity-detail-panel').hidden, false);
  assert.equal(document.querySelector('[data-screen="settings"]')?.closest('.sidebar-footer') != null, true);
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
    ['constraints', 'Hard', 0],
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

  const firstClass = document.querySelector('#school-grid-lessons tbody tr[data-row="0"] input[aria-label="Classe"]');
  const secondClass = document.querySelector('#school-grid-lessons tbody tr[data-row="1"] input[aria-label="Classe"]');
  firstClass.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(document.activeElement, secondClass, 'Enter on a lesson class moves to the class cell below');

  const freshRow = document.querySelector('#school-grid-lessons tbody tr[data-new-row="true"]');
  const [newSubject, newTeacher, newClass] = freshRow.querySelectorAll('input');
  for (const [input, value] of [[newSubject, 'Mathematics'], [newTeacher, 'Teacher Two'], [newClass, 'Class Two']]) {
    input.value = value;
    input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  }
  assert.equal(workbench.timetable.lessons.length, 6);
  assert.ok(document.querySelector('#school-grid-lessons tbody tr[data-new-row="true"]'));
  document.querySelector('#undo-school-edit').click();
  assert.equal(workbench.timetable.lessons.length, 6, 'undo first restores the previous UNKNOWN class value');
  assert.equal(workbench.timetable.entities.classes.find(item => item.id === workbench.timetable.lessons[5].classIds[0]).name, 'UNKNOWN');
  document.querySelector('#undo-school-edit').click();
  assert.equal(workbench.timetable.lessons.length, 5);
});

test('missing lesson class and subject become valid UNKNOWN placeholders for separate management', () => {
  const document = new JSDOM('<main><section id="school-page"><table id="school-grid-teachers"></table><table id="school-grid-classes"></table><table id="school-grid-subjects"></table><table id="school-grid-rooms"></table><table id="school-grid-students"></table><table id="school-grid-lessons"></table><div><table id="school-grid-constraints"></table><input id="school-constraint-filter"><span id="school-constraint-count"></span><button id="school-constraint-previous"></button><button id="school-constraint-next"></button></div><button id="undo-school-edit" disabled></button><p id="school-edit-status"></p></section></main>').window.document;
  const workbench = createSchoolWorkbench({ document });
  const school = timetableFixture();
  workbench.setTimetable(school);
  workbench.importLessons([{
    id: 'lesson:missing-details', subjectId: null, teacherIds: ['teacher:T1'], classIds: [], roomIds: [],
    durationPeriods: 1, assignedTime: null, timeframes: { unavailable: [], desired: [], undesired: [] },
  }]);
  const lesson = school.lessons.at(-1);
  const unknownSubject = school.entities.subjects.find(item => item.id === lesson.subjectId);
  const unknownClass = school.entities.classes.find(item => item.id === lesson.classIds[0]);
  assert.equal(unknownSubject.name, 'UNKNOWN');
  assert.equal(unknownClass.name, 'UNKNOWN');
  assert.equal(unknownSubject.placeholder, 'unknown');
  assert.equal(unknownClass.placeholder, 'unknown');
  assert.ok(!getCalculationReadiness(school).includes('lesson-details'));
  assert.ok(!getCalculationReadiness(school).includes('invalid-data'));
  assert.ok(optimizationScope(school).excludedLessons.some(item => item.id === lesson.id));
  const freshRow = document.querySelector('#school-grid-lessons [data-new-row="true"]');
  const teacher = freshRow.querySelectorAll('input')[1];
  teacher.value = 'Teacher Two';
  teacher.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(school.lessons.length, 7);
  assert.equal(school.lessons.at(-1).subjectId, unknownSubject.id);
  assert.deepEqual(school.lessons.at(-1).classIds, [unknownClass.id]);
  assert.ok(freshRow.isConnected, 'lesson rows stay stable while the fallback is applied');
  document.querySelector('#undo-school-edit').click();
  assert.equal(school.lessons.length, 6);
  const unknownClassInput = document.querySelector(`#school-grid-classes [data-row="${school.entities.classes.indexOf(unknownClass)}"] input`);
  unknownClassInput.value = '1A';
  unknownClassInput.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(unknownClass.placeholder, undefined, 'renaming UNKNOWN to a real class restores normal conflict checks');
  assert.equal(optimizationScope(school).excludedLessons.some(item => item.id === lesson.id), false, 'the lesson becomes optimizable once its class is identified');
});

test('every table column can filter and sort its own values', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  app.schoolWorkbench.setTimetable(timetableFixture());
  for (const grid of ['teachers', 'classes', 'subjects', 'rooms', 'students', 'lessons', 'constraints']) {
    const columns = [...dom.window.document.querySelectorAll(`#school-grid-${grid} thead th`)];
    assert.ok(columns.length > 0, `missing columns in ${grid}`);
    for (const column of columns) {
      assert.ok(column.querySelector('[data-grid-column-filter]'), `${grid} column has no filter`);
      assert.ok(column.querySelector('[data-grid-sort]'), `${grid} column has no sort control`);
    }
  }
  const nameFilter = dom.window.document.querySelector('#school-grid-teachers [data-grid-column-filter][data-column-index="0"]');
  nameFilter.value = 'Teacher Two';
  nameFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual([...dom.window.document.querySelectorAll('#school-grid-teachers tbody tr[data-row]:not([data-new-row="true"])')].filter(row => !row.hidden).map(row => Number(row.dataset.row)), [1]);
  nameFilter.value = '';
  nameFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const sort = dom.window.document.querySelector('#school-grid-teachers [data-grid-sort][data-column-index="0"]');
  sort.click();
  assert.deepEqual([...dom.window.document.querySelectorAll('#school-grid-teachers tbody tr[data-row]:not([data-new-row="true"])')].map(row => Number(row.dataset.row)), [0, 1]);
  sort.click();
  assert.deepEqual([...dom.window.document.querySelectorAll('#school-grid-teachers tbody tr[data-row]:not([data-new-row="true"])')].map(row => Number(row.dataset.row)), [1, 0]);
  const dayFilter = dom.window.document.querySelector('#school-grid-constraints [data-grid-column-filter][data-column-index="2"]');
  dayFilter.value = 'Monday';
  dayFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(dom.window.document.querySelector('#school-constraint-count').textContent, /di 2$/);
  dom.window.close();
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

test('constraint rows are read-only selectable details with the correct pointer semantics', () => {
  const document = new JSDOM('<main><section id="school-page"><table id="school-grid-teachers"></table><table id="school-grid-classes"></table><table id="school-grid-subjects"></table><table id="school-grid-rooms"></table><table id="school-grid-lessons"></table><div><table id="school-grid-constraints"></table><input id="school-constraint-filter"><span id="school-constraint-count"></span><button id="school-constraint-previous"></button><button id="school-constraint-next"></button></div><button id="undo-school-edit" disabled></button><p id="school-edit-status"></p></section></main>').window.document;
  const details = [];
  const workbench = createSchoolWorkbench({ document, onDetail: detail => details.push(detail) });
  const source = timetableFixture();
  workbench.setTimetable(source);
  const row = [...document.querySelectorAll('#school-grid-constraints tbody tr')]
    .find(item => item.textContent.includes('Teacher One'));
  assert.ok(row.classList.contains('selectable-detail-row'));
  assert.equal(row.querySelector('input, select, [contenteditable="true"]'), null);
  row.click();
  assert.equal(details.at(-1).type, 'constraint');
  assert.equal(details.at(-1).constraint.id, 'teacher:T1');
  row.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(details.length, 2, 'the same detail opens from the keyboard');
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

test('the application shell has the three stable areas and exact operational navigation', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const css = await readFile(new URL('../../timetable/css/style.css', import.meta.url), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.ok(document.querySelector('aside#app-sidebar nav[aria-label="Navigazione principale"]'));
  for (const view of ['schedule', 'teachers', 'classes', 'rooms', 'constraints', 'pdf', 'settings']) {
    assert.ok(document.querySelector(`[data-screen="${view}"]`), `missing ${view} navigation`);
  }
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+320px/i);
  assert.match(css, /\.entity-detail-panel\s*\{[^}]*width:\s*320px/s);
  assert.equal(document.querySelector('#entity-detail-panel').hidden, false);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i);
});

test('navigation keeps the details panel and opens the matching central workspace', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const { document } = dom.window;
  assert.equal(document.querySelector('[data-school-panel="teachers"]').hidden, false);
  document.querySelector('[data-screen="classes"]').click();
  assert.equal(app.activeScreen, 'classes');
  assert.equal(document.querySelector('[data-school-panel="teachers"]').hidden, true);
  assert.equal(document.querySelector('[data-school-panel="classes"]').hidden, false);
  assert.equal(document.querySelectorAll('[data-school-panel="classes"]')[1].hidden, false, 'classes and subjects share the requested page');
  assert.equal(document.querySelector('[data-screen="classes"]').getAttribute('aria-pressed'), 'true');
  document.querySelector('[data-screen="constraints"]').click();
  assert.equal(document.querySelector('[data-school-panel="constraints"]').hidden, false);
  assert.equal(document.querySelector('[data-school-panel="classes"]').hidden, true);
  document.querySelector('[data-screen="settings"]').click();
  assert.equal(document.querySelector('#entity-detail-panel').hidden, false);
  assert.equal(document.querySelector('#settings-page').hidden, false);
  dom.window.close();
});

test('detail panel stays fixed and supports create, edit, and delete for managed entities', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document });
  const panel = document.querySelector('#entity-detail-panel');
  const css = await readFile(new URL('../../timetable/css/style.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+320px/i);

  const createAndEdit = (screen, collection, label) => {
    document.querySelector(`[data-screen="${screen}"]`).click();
    assert.equal(panel.hidden, false);
    const create = document.querySelector(`[data-create-entity="${collection}"]`);
    const name = create.querySelector('input');
    name.value = `Nuova ${label}`;
    create.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    const entity = app.timetable.entities[collection].find(item => item.name === `Nuova ${label}`);
    assert.ok(entity, `${collection} can be created from the details panel`);
    const edit = document.querySelector('.detail-edit-form');
    const editName = edit.querySelector('input');
    editName.value = `${label} modificata`;
    edit.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(app.timetable.entities[collection].find(item => item.id === entity.id).name, `${label} modificata`);
    document.querySelector('.detail-edit-form .danger-button').click();
    assert.equal(app.timetable.entities[collection].some(item => item.id === entity.id), false);
  };

  createAndEdit('teachers', 'teachers', 'docente');
  createAndEdit('classes', 'classes', 'classe');
  createAndEdit('classes', 'subjects', 'materia');
  createAndEdit('rooms', 'rooms', 'aula');
  for (const screen of ['schedule', 'teachers', 'classes', 'rooms', 'constraints', 'pdf', 'settings']) {
    document.querySelector(`[data-screen="${screen}"]`).click();
    assert.equal(panel.hidden, false, `details remain mounted on ${screen}`);
  }
  dom.window.close();
});

test('contextual and global constraint views edit the same canonical record', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, confirm: () => true });
  const edn = writeEDN(timetableFixture());
  await app.stageEDNFile({ name: 'fixture.edn', arrayBuffer: async () => new TextEncoder().encode(edn).buffer });
  document.querySelector('#apply-import').click();
  document.querySelector('#school-grid-teachers tbody tr[data-entity-id="teacher:T1"]').click();
  const contextual = document.querySelector('.contextual-constraints');
  assert.ok(contextual);
  assert.match(contextual.textContent, /Soft · Da evitare/);
  contextual.querySelector('button').click();
  contextual.querySelector('[aria-label="Giorno del vincolo"]').value = '1';
  contextual.querySelector('[aria-label="Ora del vincolo"]').value = '2';
  contextual.querySelector('button:not(.detail-link)').click();
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.undesired, ['1.2']);

  document.querySelector('[data-screen="constraints"]').click();
  const globalRow = [...document.querySelectorAll('#school-grid-constraints tbody tr')]
    .find(row => row.textContent.includes('Tuesday') && row.textContent.includes('10:00'));
  assert.ok(globalRow, 'the global table reflects the contextual edit');
  globalRow.click();
  assert.equal(document.querySelector('#entity-detail-panel').hidden, false);
  assert.match(document.querySelector('#entity-detail-title').textContent, /Vincolo/);
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
