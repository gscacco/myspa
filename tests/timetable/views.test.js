import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableViews } from '../../timetable/js/views.js';
import { importOFD, withoutOFDAssignments } from '../../timetable/js/ofd-importer.js';
import { domParser, timetableFixture } from './helpers.js';

const indexPath = fileURLToPath(new URL('../../timetable/index.html', import.meta.url));
const samplePath = fileURLToPath(new URL('../../OR_30_SETT.ofd', import.meta.url));

async function mount() {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const document = dom.window.document;
  const views = createTimetableViews({ document });
  views.render(timetableFixture(), [{ severity: 'warning', code: 'unsupported-structure', path: 'DOCUMENT/FUTURE[0]', message: 'unknown structure' }]);
  return { dom, document, views };
}

test('class, teacher, and room views show the matching schedule and preserve selected lesson context', async () => {
  const { dom, document } = await mount();
  assert.equal(document.querySelector('[data-view="class"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...document.querySelectorAll('#entity-select option')].map(option => option.textContent), ['Class One', 'Class Two']);
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="lesson:0"]'));
  assert.equal(document.querySelector('#schedule-grid').getAttribute('role'), 'region');
  assert.equal(document.querySelector('#schedule-grid [data-lesson-id="lesson:0"]').tagName, 'BUTTON');
  assert.match(document.querySelector('#source-warnings').textContent, /FUTURE/);
  const entitySelect = document.querySelector('#entity-select');
  entitySelect.value = 'class:C2';
  entitySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="lesson:1"]'));
  assert.equal(document.querySelector('#schedule-grid [data-lesson-id="lesson:0"]'), null);

  document.querySelector('[data-view="teacher"]').click();
  assert.equal(document.querySelector('[data-view="teacher"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...document.querySelectorAll('#entity-select option')].map(option => option.textContent), ['Teacher One', 'Teacher Two']);
  document.querySelector('#schedule-grid [data-lesson-id="lesson:1"]').click();
  assert.match(document.querySelector('#lesson-details').textContent, /History|Teacher One|Class Two|Room One/);
  const focusedLesson = document.querySelector('#schedule-grid [data-lesson-id="lesson:1"]');
  focusedLesson.focus();
  focusedLesson.click();
  assert.equal(document.activeElement.dataset.lessonId, 'lesson:1', 'keyboard focus remains on the selected lesson');

  document.querySelector('[data-view="room"]').click();
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="lesson:1"]'));
  assert.match(document.querySelector('#lesson-details').textContent, /lesson:1|History/);
  assert.equal(document.querySelector('[data-view="room"]').getAttribute('aria-pressed'), 'true');
  dom.window.close();
});

test('lesson detail shows subject, participants, time, and detected conflicts', async () => {
  const { dom, document } = await mount();
  const entitySelect = document.querySelector('#entity-select');
  entitySelect.value = 'class:C2';
  entitySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match(document.querySelector('#schedule-grid [data-lesson-id="lesson:3"]').getAttribute('aria-label'), /avviso/i);
  entitySelect.value = 'class:C1';
  entitySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const lesson = document.querySelector('#schedule-grid [data-lesson-id="lesson:0"]');
  assert.ok(lesson);
  assert.match(lesson.textContent, /Conflitto/);
  lesson.click();
  const detail = document.querySelector('#lesson-details').textContent;
  for (const value of ['Mathematics', 'Teacher One', 'Class One', 'Room One', '08:00', '10:00']) assert.ok(detail.includes(value), value);
  assert.match(document.querySelector('#issues-list').textContent, /senza orario/i);
  dom.window.close();
});

test('issue navigation selects an unassigned lesson and retains its detail even when it has no room', async () => {
  const { dom, document } = await mount();
  document.querySelector('[data-view="room"]').click();
  const link = document.querySelector('#issues-list [data-lesson-id="lesson:4"]');
  assert.ok(link);
  assert.match(link.textContent, /Class Two.*Senza orario/);
  link.focus();
  link.click();
  assert.match(document.querySelector('#lesson-details').textContent, /Mathematics|Teacher Two|Class Two/);
  assert.match(document.querySelector('#lesson-details').textContent, /senza orario/i);
  assert.equal(document.activeElement.id, 'lesson-details', 'focus moves to the detail for an unassigned lesson');
  assert.equal(document.querySelector('[data-view="class"]').getAttribute('aria-pressed'), 'true');
  dom.window.close();
});

test('real supplied timetable renders its six-day grid and navigates to a lesson in teacher view', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { timetable, diagnostics } = importOFD(await readFile(samplePath), { DOMParser: domParser });
  const views = createTimetableViews({ document: dom.window.document });
  views.render(timetable, diagnostics);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#schedule-grid .day-heading').length, 6);
  assert.equal(document.querySelectorAll('#entity-select option').length, 58);
  assert.ok(document.querySelector('#source-warnings').textContent.includes('Codifica XML'));
  assert.ok(document.querySelector('#issues-list').textContent.includes('senza orario'));

  const lesson = timetable.lessons.find(item => item.assignedTime && item.teacherIds.length);
  assert.ok(views.selectLesson(lesson.id, { navigate: true }));
  document.querySelector('[data-view="teacher"]').click();
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id]'));
  assert.ok(document.querySelector('#lesson-details').textContent.includes(timetable.entities.subjects.find(subject => subject.id === lesson.subjectId).name));
  assert.ok(document.querySelector('#lesson-details').textContent.includes(timetable.entities.teachers.find(teacher => teacher.id === lesson.teacherIds[0]).name));
  dom.window.close();
});

test('real OFD imported without placements exposes its full school roster and imported time constraints', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const imported = importOFD(await readFile(samplePath), { DOMParser: domParser });
  const structureOnly = withoutOFDAssignments(imported);
  const views = createTimetableViews({ document: dom.window.document });
  views.render(structureOnly.timetable, structureOnly.diagnostics);
  const { document } = dom.window;
  document.querySelector('#open-structure').click();
  assert.equal(document.querySelectorAll('#structure-classes [data-entity-name]').length, 58);
  assert.equal(document.querySelectorAll('#structure-teachers [data-entity-name]').length, 118);
  assert.equal([...document.querySelectorAll('#structure-summary dd')].some(value => Number(value.textContent.replace(/\D/g, '')) === 1714), true);
  assert.equal(structureOnly.timetable.lessons.every(lesson => lesson.assignedTime === null), true);
  assert.match(document.querySelector('#structure-constraint-summary').textContent, /indisponibilità obbligatorie/);
  assert.ok(document.querySelector('#constraint-editor').closest('#structure-page'));
  dom.window.close();
});

test('warnings stay off the timetable page and open in a filtered, navigable issue screen', async () => {
  const { dom, document, views } = await mount();
  const open = document.querySelector('#open-issues');
  const issuePage = document.querySelector('#issues-page');
  assert.ok(Number(open.dataset.count) > 0);
  assert.equal(issuePage.hidden, true);
  assert.equal(document.querySelector('#timetable-workspace').hidden, false);
  open.click();
  assert.equal(issuePage.hidden, false);
  assert.equal(document.querySelector('#timetable-workspace').hidden, true);
  document.querySelector('#issue-category').value = 'import';
  document.querySelector('#issue-category').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok([...document.querySelectorAll('#source-warnings > li')].filter(row => !row.hidden).length > 0);
  assert.equal([...document.querySelectorAll('#issues-list > li')].filter(row => !row.hidden).length, 0);
  document.querySelector('#issue-category').value = 'all';
  document.querySelector('#issue-category').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const navigation = document.querySelector('#issues-list [data-lesson-id="lesson:4"]');
  assert.ok(navigation);
  navigation.click();
  assert.equal(issuePage.hidden, true);
  assert.equal(document.querySelector('#timetable-workspace').hidden, false);
  assert.equal(views.selectedLessonId, 'lesson:4');
  dom.window.close();
});

test('school structure screen lists classes, teachers, imported constraints, and entry points for editing', async () => {
  const { dom, document } = await mount();
  const structureButton = document.querySelector('#open-structure');
  assert.ok(structureButton);
  assert.equal(document.querySelector('#structure-page').hidden, true);
  structureButton.click();
  assert.equal(document.querySelector('#structure-page').hidden, false);
  assert.equal(document.querySelector('#timetable-workspace').hidden, true);
  assert.deepEqual([...document.querySelectorAll('#structure-classes [data-entity-name]')].map(item => item.dataset.entityName), ['Class One', 'Class Two']);
  assert.deepEqual([...document.querySelectorAll('#structure-teachers [data-entity-name]')].map(item => item.dataset.entityName), ['Teacher One', 'Teacher Two']);
  assert.match(document.querySelector('#structure-constraints').textContent, /Teacher One.*fascia da evitare/i);
  assert.match(document.querySelector('#structure-constraints').textContent, /Teacher Two.*non disponibile/i);
  assert.equal(document.querySelector('#constraint-editor').closest('#structure-page') !== null, true, 'constraint editing is visibly available on the structure screen');
  document.querySelector('#structure-teachers [data-entity-name="Teacher One"]').click();
  assert.equal(document.querySelector('#structure-page').hidden, true);
  assert.equal(document.querySelector('[data-view="teacher"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#entity-select').value, 'teacher:T1');
  dom.window.close();
});
