import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankTimetable } from '../../timetable/js/blank-timetable.js';
import { validateTimetable } from '../../timetable/js/validation.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableApp } from '../../timetable/js/app.js';
import { minimalOFD, lessonXML } from './helpers.js';

const indexPath = fileURLToPath(new URL('../../timetable/index.html', import.meta.url));

const setup = {
  name: 'Nuovo orario', unitMinutes: 60,
  days: ['Lunedì', 'Martedì'],
  periods: [{ beginMinute: 480, endMinute: 540 }, { beginMinute: 540, endMinute: 600 }],
  teachers: ['Ada Rossi'], classes: ['1A'], rooms: ['Aula 1'], subjects: ['Matematica'],
  lessons: [{ subject: 'Matematica', teacher: 'Ada Rossi', class: '1A', room: 'Aula 1', durationPeriods: 1 }],
};

test('a school timetable can be created from scratch with valid empty assignments and stable references', () => {
  const timetable = createBlankTimetable(setup);
  assert.deepEqual(validateTimetable(timetable).errors, []);
  assert.equal(timetable.source.format, 'native');
  assert.equal(timetable.lessons.length, 1);
  assert.equal(timetable.lessons[0].assignedTime, null);
  assert.equal(timetable.entities.teachers[0].name, 'Ada Rossi');
  assert.deepEqual(timetable.lessons[0].teacherIds, [timetable.entities.teachers[0].id]);
  assert.deepEqual(timetable.lessons[0].classIds, [timetable.entities.classes[0].id]);
  assert.deepEqual(timetable.lessons[0].roomIds, [timetable.entities.rooms[0].id]);
});

test('blank timetable creation rejects missing or duplicate source definitions', () => {
  assert.throws(() => createBlankTimetable({ ...setup, teachers: [] }), /docente/i);
  assert.throws(() => createBlankTimetable({ ...setup, subjects: ['Matematica', 'Matematica'] }), /duplicat/i);
  assert.throws(() => createBlankTimetable({ ...setup, lessons: [{ ...setup.lessons[0], teacher: 'Sconosciuto' }] }), /riferimento/i);
});

test('blank timetable creation assigns UNKNOWN when an individual lesson has no class or subject', () => {
  const timetable = createBlankTimetable({
    ...setup,
    classes: [],
    subjects: [],
    lessons: [{ subject: '', teacher: 'Ada Rossi', class: '', durationPeriods: 1 }],
  });
  const lesson = timetable.lessons[0];
  assert.equal(timetable.entities.subjects.find(item => item.id === lesson.subjectId).name, 'UNKNOWN');
  assert.equal(timetable.entities.classes.find(item => item.id === lesson.classIds[0]).name, 'UNKNOWN');
  assert.deepEqual(validateTimetable(timetable).errors, []);
});

test('the app creates roster data and imports lesson requirements from settings before recalculation', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, DOMParser: dom.window.DOMParser });
  assert.equal(app.activeScreen, 'teachers');
  assert.equal(document.querySelector('#school-page').hidden, false);
  assert.equal(document.querySelector('#import-card').hidden, true);
  document.querySelector('[data-screen="schedule"]').click();
  assert.equal(app.activeScreen, 'schedule');
  assert.equal(document.querySelector('#recalculate-all').disabled, true, 'recalculation stays inactive while required data is missing');
  assert.match(document.querySelector('#calculation-readiness').textContent, /calcolo disabilitato.*docenti.*classi.*materie.*lezione/i);
  for (const [type, name] of [['teachers', 'T1'], ['classes', 'C1'], ['rooms', 'R1']]) {
    app.schoolWorkbench.createEntity(type, name);
  }
  app.schoolWorkbench.createEntity('subjects', 'Matematica');
  document.querySelector('[data-screen="settings"]').click();
  document.querySelector('[data-lessons-open]').click();
  const lessonFile = minimalOFD({ lesson: lessonXML() });
  assert.equal(await app.stageLessonsFile({ name: 'lessons.ofd', arrayBuffer: async () => new TextEncoder().encode(lessonFile).buffer }), true);
  app.applyLessonsImport();
  assert.equal(app.timetable.lessons.length, 1);
  assert.equal(app.timetable.lessons[0].assignedTime, null);
  assert.equal(app.timetable.calendar.days.length, 1);
  document.querySelector('[data-screen="schedule"]').click();
  assert.equal(app.activeScreen, 'schedule');
  assert.equal(document.querySelector('#recalculate-all').disabled, false);
  dom.window.close();
});
