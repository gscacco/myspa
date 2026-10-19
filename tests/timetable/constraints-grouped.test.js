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
  avoidNine.querySelector('.constraint-group-select').click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Gruppo/);
  assert.match(document.querySelector('#entity-detail-content').textContent, /2 occorrenze/);
  avoidNine.querySelector('.constraint-group-expand').click();
  assert.equal(avoidNine.querySelector('.constraint-group-expand').getAttribute('aria-expanded'), 'true');
  const occurrences = avoidNine.querySelectorAll('.constraint-occurrence');
  assert.equal(occurrences.length, 2);
  occurrences[1].click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Vincolo/);
  assert.match(document.querySelector('#entity-detail-content').textContent, /Tuesday, 09:00/, 'an expanded occurrence opens its own underlying record');
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
