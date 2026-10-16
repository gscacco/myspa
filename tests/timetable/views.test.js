import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableViews } from '../../timetable/js/views.js';
import { importOFD } from '../../timetable/js/ofd-importer.js';
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
