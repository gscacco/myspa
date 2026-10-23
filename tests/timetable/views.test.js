import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableViews } from '../../timetable/js/views.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { importOFD, withoutOFDAssignments } from '../../timetable/js/ofd-importer.js';
import { exportTimetableEDN } from '../../timetable/js/edn-importer.js';
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

test('schedule summaries separate UNKNOWN-class activities from ordinary unassigned lessons', async () => {
  const { dom, document, views } = await mount();
  const timetable = timetableFixture();
  timetable.entities.classes.push({ id: 'class:unknown', name: 'UNKNOWN', placeholder: 'unknown' });
  timetable.lessons.push({ ...structuredClone(timetable.lessons[4]), id: 'unknown-activity', classIds: ['class:unknown'], assignedTime: null });
  views.render(timetable, []);
  assert.equal(views.analysis.summary.unassignedLessons, 1);
  assert.match(document.querySelector('#structure-summary').textContent, /Escluse \(classe UNKNOWN\)1/);
  assert.match(document.querySelector('#structure-description').textContent, /1 lezioni con classe reale.*1 attività con classe UNKNOWN/i);
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

test('real supplied timetable renders its six-day grid and navigates to a lesson in teacher view (external OFD fixture)', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { timetable, diagnostics } = importOFD(await readFile(samplePath), { DOMParser: domParser });
  const views = createTimetableViews({ document: dom.window.document });
  views.render(timetable, diagnostics);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('#schedule-grid .day-heading').length, 6);
  assert.equal(document.querySelectorAll('#entity-select option').length, 59);
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

test('OFD roster and constraints are available in their school sheets without placement hints (external OFD fixture)', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const imported = importOFD(await readFile(samplePath), { DOMParser: domParser });
  const structureOnly = withoutOFDAssignments(imported);
  const { document } = dom.window;
  const app = createTimetableApp({ document, DOMParser: domParser });
  app.schoolWorkbench.setTimetable(structureOnly.timetable);
  document.querySelector('[data-screen="classes"]').click();
  assert.equal(document.querySelectorAll('#school-grid-classes tbody tr[data-entity-id]').length, 59);
  document.querySelector('[data-screen="teachers"]').click();
  assert.equal(document.querySelectorAll('#school-grid-teachers tbody tr[data-entity-id]').length, 118);
  assert.equal(structureOnly.timetable.lessons.every(lesson => lesson.assignedTime === null), true);
  assert.equal(structureOnly.timetable.source.assignmentHints, undefined);
  document.querySelector('[data-screen="constraints"]').click();
  assert.ok(document.querySelectorAll('#school-grid-constraints tbody tr[data-row]').length > 0);
  assert.equal(document.querySelector('#constraint-editor').closest('[data-school-panel="constraints"]') !== null, true);
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

test('school lists open persistent inline details without a close action', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document });
  const fixture = timetableFixture();
  const bytes = new TextEncoder().encode(exportTimetableEDN(fixture));
  await app.stageEDNFile({ name: 'fixture.edn', arrayBuffer: async () => bytes.buffer });
  app.applyImport();
  document.querySelector('[data-screen="teachers"]').click();
  const detailPanel = document.querySelector('#entity-detail-panel');
  assert.equal(detailPanel.hidden, false);
  assert.equal(detailPanel.querySelector('[data-detail-close]'), null);
  document.querySelector('#school-grid-teachers tbody tr[data-entity-id="teacher:T1"]').click();
  assert.match(document.querySelector('#entity-detail-title').textContent, /Teacher One/);
  assert.match(document.querySelector('#entity-detail-content').textContent, /fascia da evitare/i);
  assert.equal(detailPanel.hidden, false, 'opening a list detail keeps the detail column visible');
  assert.equal(document.querySelector('#detail-back').hidden, true, 'back is hidden until navigating from one detail to another');
  assert.equal(document.querySelector('#structure-page').hidden, true, 'the redundant structure view is no longer navigable');
  dom.window.close();
});
