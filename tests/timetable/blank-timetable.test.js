import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankTimetable } from '../../timetable/js/blank-timetable.js';
import { validateTimetable } from '../../timetable/js/validation.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableApp } from '../../timetable/js/app.js';

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

test('the app opens as a new school and adds its first class, teacher, subjects and lesson in the grid', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document });
  assert.equal(app.activeScreen, 'school');
  assert.equal(document.querySelector('#school-page').hidden, false);
  assert.equal(document.querySelector('#import-card').hidden, true);
  document.querySelector('[data-screen="calculation"]').click();
  assert.equal(app.activeScreen, 'calculation');
  assert.equal(document.querySelector('#recalculate-all').disabled, true, 'the calculation remains reachable but inactive while required data is missing');
  assert.match(document.querySelector('#calculation-readiness').textContent, /calcolo disabilitato.*docenti.*classi.*materie.*lezione/i);
  assert.ok(document.querySelector('[data-readiness-screen="lessons"]'), 'the blocker offers a direct route to the lesson sheet');
  document.querySelector('[data-screen="teachers"]').click();
  for (const [type, name] of [['teachers', 'Ada Rossi'], ['classes', '1A'], ['subjects', 'Matematica'], ['rooms', 'Aula 1']]) {
    const input = document.querySelector(`#school-grid-${type} [data-new-row="true"] input`);
    input.value = name;
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  document.querySelector('[data-screen="calculation"]').click();
  assert.equal(document.querySelector('#recalculate-all').disabled, true);
  assert.match(document.querySelector('#calculation-readiness').textContent, /definisci almeno una lezione.*materia.*docente.*classe/i);
  document.querySelector('[data-readiness-screen="lessons"]').click();
  assert.equal(document.querySelector('[data-school-panel="lessons"]').hidden, false);
  const lessonRow = document.querySelector('#school-grid-lessons [data-new-row="true"]');
  const lessonFields = lessonRow.querySelectorAll('input');
  ['Matematica', 'Ada Rossi', '1A', 'Aula 1'].forEach((value, index) => { lessonFields[index].value = value; });
  lessonFields[2].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(app.timetable.lessons.length, 1);
  assert.equal(app.timetable.lessons[0].assignedTime, null);
  assert.equal(app.timetable.calendar.days.length, 5);
  document.querySelector('[data-screen="calculation"]').click();
  assert.equal(app.activeScreen, 'calculation');
  assert.equal(document.querySelector('#calculation-page').hidden, false);
  assert.equal(document.querySelector('#recalculate-all').disabled, false);
  assert.match(document.querySelector('#calculation-readiness').textContent, /requisiti completi.*motore calcola/i);
  dom.window.close();
});
