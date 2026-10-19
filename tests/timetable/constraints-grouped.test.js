import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createSchoolWorkbench } from '../../timetable/js/school-workbench.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { timetableFixture } from './helpers.js';

const htmlPath = new URL('../../timetable/index.html', import.meta.url);

function syncAppWorkbench(app) {
  const temporary = { scope: 'teacher', id: 'teacher:T1', kind: 'unavailable', slot: '0.0' };
  app.schoolWorkbench.updateConstraint({ ...temporary, action: 'add' });
  app.schoolWorkbench.updateConstraint({ ...temporary, action: 'delete' });
}

test('the default constraints list groups equivalent records and keeps occurrence selection', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[0].constraints.timeframes = {
    unavailable: ['0.1'], desired: ['0.1'], undesired: ['0.1', '1.1', '1.2'],
  };
  school.entities.teachers[1].constraints.timeframes.unavailable = ['0.1'];
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);

  const document = dom.window.document;
  assert.equal(document.querySelector('#school-grid-constraints tbody').hidden, true, 'the grouped list is the default presentation');
  assert.equal(document.querySelector('#school-constraint-count').textContent, '1–5 gruppi · 6 vincoli');
  const groups = [...document.querySelectorAll('.constraint-group')];
  assert.equal(groups.length, 5, 'hard/soft categories, types and times stay separate');
  const typeGroups = [...document.querySelectorAll('.constraint-type-group')];
  assert.equal(typeGroups.length, 4, 'each element separates its constraints by type');
  assert.deepEqual([...new Set(typeGroups.map(group => group.querySelector('.constraint-type-label').textContent))].sort(), [
    'Hard · Indisponibilità', 'Soft · Da evitare', 'Soft · Preferita',
  ]);
  const avoidNine = groups.find(group => group.classList.contains('constraint-category-undesired') && group.textContent.includes('09:00'));
  assert.ok(avoidNine);
  assert.equal(avoidNine.querySelector('.constraint-type-badge'), null, 'the type is shown only by the outer category label');
  assert.equal(avoidNine.querySelector('.constraint-group-select').textContent.trim(), '09:00');
  assert.equal(avoidNine.closest('.constraint-type-group').querySelector('.constraint-type-label').textContent, 'Soft · Da evitare');
  assert.deepEqual([...avoidNine.querySelectorAll('.constraint-weekday')].map(item => item.textContent), ['Lun', 'Mar']);
  const tuesday = [...avoidNine.querySelectorAll('.constraint-weekday')].find(item => item.textContent === 'Mar');
  assert.equal(tuesday.tagName, 'BUTTON', 'a specified weekday is an interactive occurrence selector');
  const monday = [...avoidNine.querySelectorAll('.constraint-weekday')].find(item => item.textContent === 'Lun');
  assert.ok(monday.classList.contains('constraint-status-unsatisfied'), 'a verified preference conflict is highlighted in yellow');
  assert.ok(tuesday.classList.contains('constraint-status-satisfied'), 'a verified respected constraint is highlighted in green');
  avoidNine.querySelector('.constraint-group-select').click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Gruppo/);
  assert.match(document.querySelector('#entity-detail-content').textContent, /2 occorrenze/);
  assert.doesNotMatch(document.querySelector('#entity-detail-content').textContent, /Giorni:/, 'the selected group does not repeat weekday labels in text');
  avoidNine.querySelector('.constraint-group-expand').click();
  assert.equal(avoidNine.querySelector('.constraint-group-expand').getAttribute('aria-expanded'), 'true');
  const occurrences = avoidNine.querySelectorAll('.constraint-occurrence');
  assert.equal(occurrences.length, 2);
  tuesday.click();
  const detailPanel = document.querySelector('#entity-detail-content');
  assert.match(detailPanel.textContent, /Tuesday, 09:00/, 'clicking a weekday opens its underlying constraint in the details panel');
  assert.match(detailPanel.textContent, /Vincolo rispettato/);
  assert.equal(detailPanel.querySelector('.context-constraint-list'), null, 'global constraint details do not repeat the full textual list');
  assert.ok(detailPanel.querySelector('.contextual-constraints .detail-link'), 'the selected occurrence keeps its edit and delete actions');
  assert.equal([...detailPanel.querySelectorAll('h3')].some(item => item.textContent === 'Violazioni e avvisi'), false, 'global teacher constraint details report the selected status once');
  occurrences[1].click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Vincolo/);
  assert.match(document.querySelector('#entity-detail-content').textContent, /Tuesday, 09:00/, 'an expanded occurrence opens its own underlying record');
  dom.window.close();
});

test('the details divider can be resized by keyboard with an accessible value', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  createTimetableApp({ document: dom.window.document });
  const document = dom.window.document;
  const workspace = document.querySelector('.workspace');
  const panel = document.querySelector('#entity-detail-panel');
  const divider = document.querySelector('#detail-resizer');
  Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1000 });
  panel.getBoundingClientRect = () => ({ width: 320, right: 950, left: 630, top: 0, bottom: 400, height: 400 });
  assert.equal(divider.getAttribute('role'), 'separator');
  assert.equal(divider.hidden, false);
  divider.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(workspace.style.getPropertyValue('--detail-panel-width'), '344px');
  assert.equal(divider.getAttribute('aria-valuenow'), '344');
  Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1600 });
  divider.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  assert.equal(workspace.style.getPropertyValue('--detail-panel-width'), '960px', 'wide workspaces let the details panel expand far enough for the timetable');
  assert.equal(divider.getAttribute('aria-valuemax'), '960');
  dom.window.close();
});

test('selecting a class from global constraints shows its timetable grid in the details panel', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  dom.window.scrollTo = () => {};
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.classes[0].constraints = { timeframes: { unavailable: ['0.0'], desired: [], undesired: [] } };
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);
  const document = dom.window.document;
  document.querySelector('[data-screen="constraints"]').click();
  const classOwner = [...document.querySelectorAll('.constraint-element-heading')]
    .find(button => button.textContent.includes('Class One'));
  assert.ok(classOwner);
  classOwner.click();
  const detail = document.querySelector('#entity-detail-content');
  const schedule = detail.querySelector('.entity-detail-calendar-grid');
  assert.ok(schedule, detail.textContent);
  assert.equal(detail.querySelector('.entity-lesson-list'), null, 'the class schedule is shown as a timetable grid instead of a textual list');
  assert.equal(schedule.querySelectorAll('.day-heading').length, 2);
  assert.equal(schedule.querySelectorAll('.lesson-card[data-lesson-id]').length, 2);
  assert.equal(schedule.style.gridTemplateColumns, '58px repeat(2, minmax(96px, 1fr))', 'the details timetable uses compact day columns');
  assert.match(schedule.getAttribute('aria-label'), /Class One/);
  schedule.querySelector('.lesson-card[data-lesson-id]').click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Dettaglio lezione/);
  const back = document.querySelector('#detail-back');
  assert.equal(back.hidden, false);
  assert.match(back.textContent, /Orario della classe/);
  back.click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Classe · Class One/);
  assert.ok(document.querySelector('#entity-detail-content .entity-detail-calendar-grid'), 'back restores the class timetable inside the details panel');
  assert.equal(document.documentElement.dataset.activeScreen, 'constraints', 'back stays on the constraints page');
  dom.window.close();
});

test('constraint filters operate on occurrences and sorting deterministically orders grouped results', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[0].constraints.timeframes = {
    unavailable: ['0.1'], desired: ['0.1'], undesired: ['0.1', '1.1', '1.2'],
  };
  school.entities.teachers[1].constraints.timeframes.unavailable = ['0.1'];
  app.schoolWorkbench.setTimetable(school);
  const document = dom.window.document;
  const dayFilter = document.querySelector('#school-grid-constraints [data-grid-column-filter][data-column-index="2"]');
  dayFilter.value = 'Monday';
  dayFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('#school-constraint-count').textContent, '1–4 gruppi · 4 vincoli');
  assert.ok([...document.querySelectorAll('.constraint-weekday')].every(item => item.textContent === 'Lun'), 'filtered groups expose only matching days');

  dayFilter.value = '';
  dayFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const timeFilter = document.querySelector('#school-grid-constraints [data-grid-column-filter][data-column-index="3"]');
  timeFilter.value = '09:00';
  timeFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(document.querySelector('#school-constraint-count').textContent, /5 vincoli$/);
  assert.ok([...document.querySelectorAll('.constraint-group')].every(group => group.textContent.includes('09:00')));

  timeFilter.value = '';
  timeFilter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const sortElement = document.querySelector('#school-grid-constraints [data-grid-sort][data-column-index="0"]');
  sortElement.click();
  sortElement.click();
  assert.deepEqual([...document.querySelectorAll('.constraint-element-heading strong')].map(item => item.textContent), ['Docente · Teacher Two', 'Docente · Teacher One']);
  document.querySelector('#school-constraint-view-toggle').click();
  assert.equal(document.querySelector('#school-grid-constraints tbody').hidden, false, 'the existing flat table remains available');
  dom.window.close();
});

test('pending or unsupported constraint outcomes stay neutral in the list', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[1].constraints.timeframes.desired = ['1.0'];
  school.entities.rooms[0].constraints = { timeframes: { undesired: ['1.0'] } };
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);
  const groups = [...dom.window.document.querySelectorAll('.constraint-group')];
  const pending = groups.find(group => group.classList.contains('constraint-category-desired') && group.textContent.includes('08:00') && group.closest('.constraint-element-group').textContent.includes('Teacher Two'));
  assert.ok(pending);
  assert.equal(pending.querySelector('.constraint-weekday').classList.contains('constraint-status-satisfied'), false);
  assert.equal(pending.querySelector('.constraint-weekday').classList.contains('constraint-status-unsatisfied'), false);
  const roomGroup = groups.find(group => group.classList.contains('constraint-category-undesired') && group.textContent.includes('08:00') && group.closest('.constraint-element-group').textContent.includes('Room One'));
  assert.ok(roomGroup);
  assert.equal(roomGroup.querySelector('.constraint-weekday').classList.contains('constraint-status-satisfied'), false);
  assert.equal(roomGroup.querySelector('.constraint-weekday').classList.contains('constraint-status-unsatisfied'), false);
  dom.window.close();
});

test('group-level edits update each occurrence together and can be undone', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[0].constraints.timeframes.undesired = ['0.1', '1.1', '1.2'];
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);
  const group = [...dom.window.document.querySelectorAll('.constraint-group')]
    .find(item => item.classList.contains('constraint-category-undesired') && item.textContent.includes('09:00'));
  group.querySelector('.constraint-group-select').click();
  const panel = dom.window.document.querySelector('#entity-detail-content');
  panel.querySelector('[aria-label="Categoria del gruppo"]').value = 'desired';
  panel.querySelector('[aria-label="Fascia oraria del gruppo"]').value = '2';
  panel.querySelector('.constraint-group-editor button').click();
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.desired, ['0.2', '1.2']);
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.undesired, ['1.2'], 'records outside the selected group remain unchanged');
  assert.match(panel.textContent, /Soft · Preferita · 10:00/);
  dom.window.document.querySelector('#undo-school-edit').click();
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.desired, []);
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.undesired, ['0.1', '1.1', '1.2']);
  dom.window.close();
});

test('editing an expanded occurrence changes only that underlying record', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[0].constraints.timeframes.undesired = ['0.1', '1.1', '1.2'];
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);
  const group = [...dom.window.document.querySelectorAll('.constraint-group')]
    .find(item => item.classList.contains('constraint-category-undesired') && item.textContent.includes('09:00'));
  group.querySelector('.constraint-group-expand').click();
  group.querySelectorAll('.constraint-occurrence')[1].click();
  const panel = dom.window.document.querySelector('#entity-detail-content');
  [...panel.querySelectorAll('.contextual-constraints .detail-link')].find(button => button.textContent === 'Modifica').click();
  panel.querySelector('[aria-label="Categoria del vincolo"]').value = 'desired';
  panel.querySelector('[aria-label="Giorno del vincolo"]').value = '0';
  panel.querySelector('[aria-label="Fascia oraria del vincolo"]').value = '2';
  panel.querySelector('.context-constraint-form button').click();
  const confirmation = dom.window.document.querySelector('#confirmation-overlay');
  if (confirmation && !confirmation.hidden) dom.window.document.querySelector('#confirmation-accept').click();
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.undesired, ['0.1', '1.2']);
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.desired, ['0.2']);
  dom.window.close();
});

test('unspecified constraint slots remain explicit and read-only in the grouped view', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[0].constraints.timeframes.undesired = ['missing', '98.1'];
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);
  const group = [...dom.window.document.querySelectorAll('.constraint-group')].find(item => item.textContent.includes('Ora non specificata'));
  assert.ok(group);
  assert.match(group.textContent, /Giorno n\.s\./);
  group.querySelector('.constraint-group-select').click();
  const panel = dom.window.document.querySelector('#entity-detail-content');
  assert.match(panel.textContent, /Ora non specificata/);
  assert.equal(panel.querySelector('.constraint-group-editor'), null, 'an incomplete record is not assigned an inferred time');
  group.querySelector('.constraint-group-expand').click();
  group.querySelector('.constraint-occurrence').click();
  assert.match(panel.textContent, /Ora non specificata/);
  assert.equal([...panel.querySelectorAll('.contextual-constraints .detail-link')].some(button => button.textContent === 'Modifica'), false);
  const noDay = [...dom.window.document.querySelectorAll('.constraint-group')]
    .find(item => item.textContent.includes('09:00') && item.textContent.includes('Giorno n.s.'));
  assert.ok(noDay, 'an invalid weekday is displayed as unspecified instead of inferred');
  dom.window.close();
});

test('global constraint create and delete operations still update the canonical records', () => {
  const document = new JSDOM('<main><section id="school-page"><table id="school-grid-teachers"></table><table id="school-grid-classes"></table><table id="school-grid-subjects"></table><table id="school-grid-rooms"></table><table id="school-grid-students"></table><table id="school-grid-lessons"></table><div><table id="school-grid-constraints"></table><input id="school-constraint-filter"><span id="school-constraint-count"></span><button id="school-constraint-previous"></button><button id="school-constraint-next"></button></div><button id="undo-school-edit" disabled></button><p id="school-edit-status"></p></section></main>').window.document;
  const workbench = createSchoolWorkbench({ document });
  workbench.setTimetable(timetableFixture());
  workbench.applyConstraints([{ scope: 'teacher', id: 'teacher:T1', kind: 'unavailable', slot: '1.0' }]);
  assert.deepEqual(workbench.timetable.entities.teachers[0].constraints.timeframes.unavailable, ['1.0']);
  workbench.updateConstraint({ scope: 'teacher', id: 'teacher:T1', kind: 'unavailable', action: 'delete', slot: '1.0' });
  assert.deepEqual(workbench.timetable.entities.teachers[0].constraints.timeframes.unavailable, []);
  document.querySelector('#undo-school-edit').click();
  assert.deepEqual(workbench.timetable.entities.teachers[0].constraints.timeframes.unavailable, ['1.0']);
});

test('deleting a selected global group removes its records together and can be undone', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document });
  const school = timetableFixture();
  school.entities.teachers[0].constraints.timeframes.undesired = ['0.1', '1.1'];
  app.schoolWorkbench.setTimetable(school);
  syncAppWorkbench(app);
  const group = [...dom.window.document.querySelectorAll('.constraint-group')]
    .find(item => item.classList.contains('constraint-category-undesired') && item.textContent.includes('09:00'));
  group.querySelector('.constraint-group-select').click();
  const panel = dom.window.document.querySelector('#entity-detail-content');
  assert.equal(panel.querySelector('.context-constraint-list'), null, 'the right panel does not repeat the occurrence list');
  panel.querySelector('.constraint-group-delete').click();
  dom.window.document.querySelector('#confirmation-accept').click();
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.undesired, []);
  dom.window.document.querySelector('#undo-school-edit').click();
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.undesired, ['0.1', '1.1']);
  dom.window.close();
});
