import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { printableLessons } from '../../timetable/js/pdf.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { writeEDN } from '../../timetable/js/edn-codec.js';
import { timetableFixture } from './helpers.js';

const htmlPath = new URL('../../timetable/index.html', import.meta.url);

test('printable timetable supports general and selected teacher, class, and room output', () => {
  const timetable = timetableFixture();
  assert.equal(printableLessons(timetable, 'general').length, 5);
  assert.ok(printableLessons(timetable, 'teacher', 'teacher:T1').every(row => row.teachers.includes('Teacher One')));
  assert.ok(printableLessons(timetable, 'class', 'class:C1').every(row => row.className.includes('Class One')));
  assert.ok(printableLessons(timetable, 'room', 'room:R1').every(row => row.rooms.includes('Room One')));
  assert.throws(() => printableLessons(timetable, 'students'), /non supportato/i);
});

test('PDF page exposes only relevant selectors and prints the selected timetable', async () => {
  const dom = new JSDOM(await readFile(htmlPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  let printCalls = 0;
  dom.window.print = () => { printCalls++; };
  const app = createTimetableApp({ document, confirm: () => true });
  const file = { name: 'school.edn', arrayBuffer: async () => new TextEncoder().encode(writeEDN(timetableFixture())).buffer };
  assert.equal(await app.stageEDNFile(file), true);
  document.querySelector('#apply-import').click();
  document.querySelector('[data-screen="pdf"]').click();
  const type = document.querySelector('#pdf-output-type');
  const entityWrap = document.querySelector('#pdf-entity-wrap');
  assert.equal(entityWrap.hidden, true);
  assert.equal(document.querySelector('#entity-detail-panel').hidden, true);
  assert.ok([...type.options].every(option => option.value !== 'general'));
  type.value = 'teacher';
  type.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(entityWrap.hidden, false);
  assert.equal(document.querySelector('#pdf-entity-select').value, 'teacher:T1');
  document.querySelector('#print-timetable').click();
  assert.equal(printCalls, 1);
  assert.equal(document.querySelectorAll('#pdf-print-content .print-calendar-grid .lesson-card').length, 3);
  assert.ok([...document.querySelectorAll('#pdf-print-content .lesson-card')].every(card => card.className === 'lesson-card'));
  assert.equal(document.querySelector('#pdf-print-content .lesson-status'), null);
  type.value = 'class';
  type.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok([...document.querySelector('#pdf-entity-select').options].every(option => ['class:C1', 'class:C2'].includes(option.value)));
  type.value = 'room';
  type.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok([...document.querySelector('#pdf-entity-select').options].every(option => ['room:R1', 'room:R2'].includes(option.value)));
  dom.window.close();
});
