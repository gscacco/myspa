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

test('the zero-start builder creates a complete working timetable without selecting a file', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document });
  document.querySelector('#open-blank-builder').click();
  assert.equal(document.querySelector('#blank-builder').hidden, false);
  assert.equal(document.querySelector('#import-card').hidden, true);
  document.querySelector('#new-timetable-name').value = 'Scuola nuova';
  document.querySelector('#new-days').value = 'Lunedì, Martedì';
  document.querySelector('#new-period-count').value = '3';
  document.querySelector('#new-start-time').value = '08:00';
  document.querySelector('#new-unit-minutes').value = '60';

  for (const [type, name] of [['teacher', 'Ada Rossi'], ['class', '1A'], ['subject', 'Matematica'], ['room', 'Aula 1']]) {
    document.querySelector(`#new-${type}-name`).value = name;
    document.querySelector(`#add-new-${type}`).click();
  }
  for (const selector of ['#lesson-subject', '#lesson-teacher', '#lesson-class', '#lesson-room']) {
    const select = document.querySelector(selector);
    select.value = select.querySelector('option:not([value=""])')?.value || '';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  document.querySelector('#add-new-lesson').click();
  assert.equal(document.querySelectorAll('#new-lesson-list li').length, 1);
  document.querySelector('#create-new-timetable').click();
  assert.equal(app.timetable.name, 'Scuola nuova');
  assert.equal(app.timetable.lessons.length, 1);
  assert.equal(app.timetable.lessons[0].assignedTime, null);
  assert.equal(app.timetable.calendar.days.length, 2);
  assert.equal(document.querySelector('#timetable-workspace').hidden, false);
  assert.ok(document.querySelector('.timetable-heading #recalculate-all'));
  dom.window.close();
});
