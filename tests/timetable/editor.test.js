import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableEditor } from '../../timetable/js/editor.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { solverFixture } from './helpers.js';

const indexPath = fileURLToPath(new URL('../../timetable/index.html', import.meta.url));

test('editing UI compares an explicit proposal, applies it on request, and provides undo', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  let current = solverFixture();
  const editor = createTimetableEditor({ document, getTimetable: () => current, onApply: next => { current = next; }, confirm: () => true });
  editor.selectLesson('target');
  assert.equal(document.querySelector('#find-alternatives').disabled, false);
  assert.equal(document.querySelector('#apply-proposal').disabled, true);

  document.querySelector('#find-alternatives').click();
  await editor.searchComplete;
  const option = document.querySelector('.proposal-option');
  assert.ok(option);
  option.click();
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0, 'selecting a proposal does not apply it');
  assert.match(document.querySelector('#proposal-impact').textContent, /Mathematics|Teacher One|Class 1/);
  assert.equal(document.querySelector('#apply-proposal').disabled, false);

  document.querySelector('#apply-proposal').click();
  assert.equal(current.lessons[0].assignedTime.periodIndex, Number(option.dataset.periodIndex));
  assert.equal(document.querySelector('#undo-change').disabled, false);
  document.querySelector('#undo-change').click();
  assert.equal(current.lessons[0].assignedTime.periodIndex, 0);
  assert.equal(document.querySelector('#undo-change').disabled, true);
  dom.window.close();
});

test('applying a proposal that moves multiple lessons requests confirmation', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  let current = solverFixture({ chain: true });
  let confirmations = 0;
  let accept = false;
  const editor = createTimetableEditor({ document, getTimetable: () => current, onApply: next => { current = next; }, confirm: () => { confirmations++; return accept; } });
  editor.selectLesson('target');
  document.querySelector('#search-depth').value = 'chain';
  document.querySelector('#find-alternatives').click();
  await editor.searchComplete;
  const option = [...document.querySelectorAll('.proposal-option')].find(button => button.dataset.changeCount === '3');
  assert.ok(option);
  option.click();
  document.querySelector('#apply-proposal').click();
  assert.equal(confirmations, 1);
  assert.deepEqual(current.lessons.map(lesson => lesson.assignedTime.periodIndex), [0, 1, 2]);
  accept = true;
  document.querySelector('#apply-proposal').click();
  assert.equal(confirmations, 2);
  assert.deepEqual(current.lessons.map(lesson => lesson.assignedTime.periodIndex), [1, 2, 3]);
  dom.window.close();
});

test('the editor can find a first assignment for a lesson without an existing time', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const current = solverFixture();
  current.lessons[0].assignedTime = null;
  const editor = createTimetableEditor({ document, getTimetable: () => current });
  editor.selectLesson('target');
  assert.equal(document.querySelector('#find-alternatives').disabled, false);
  assert.match(document.querySelector('#edit-status').textContent, /primo orario/i);
  document.querySelector('#find-alternatives').click();
  await editor.searchComplete;
  assert.ok(document.querySelector('.proposal-option'));
  assert.equal(current.lessons[0].assignedTime, null);
  dom.window.close();
});

test('the application refreshes class and teacher views after apply and restores both after undo', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const fixture = solverFixture();
  const app = createTimetableApp({
    document: dom.window.document,
    importer: async () => ({ timetable: fixture, diagnostics: [], summary: { lessons: 1, assignedLessons: 1, unassignedLessons: 0, teachers: 1, classes: 1, rooms: 1, subjects: 2 } }),
    confirm: () => true,
  });
  await app.stageFile({ name: 'synthetic.ofd', arrayBuffer: async () => new ArrayBuffer(0) });
  app.applyImport();
  const { document } = dom.window;
  document.querySelector('#schedule-grid [data-lesson-id="target"]').click();
  document.querySelector('#find-alternatives').click();
  await app.editor.searchComplete;
  document.querySelector('.proposal-option').click();
  const selectedPeriod = Number(document.querySelector('.proposal-option[aria-pressed="true"]').dataset.periodIndex);
  document.querySelector('[data-view="teacher"]').click();
  document.querySelector('#apply-proposal').click();
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, selectedPeriod);
  assert.match(document.querySelector('#edit-status').textContent, /Modifica applicata/i);
  assert.equal(document.querySelector('[data-view="teacher"]').getAttribute('aria-pressed'), 'true', 'applying a change retains the active view');
  assert.ok(document.querySelector(`#schedule-grid [data-lesson-id="target"]`).style.gridRow.includes(String(selectedPeriod + 1)));

  document.querySelector('[data-view="class"]').click();
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="target"]').style.gridRow.includes(String(selectedPeriod + 1)));
  document.querySelector('[data-view="teacher"]').click();
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="target"]').style.gridRow.includes(String(selectedPeriod + 1)));
  document.querySelector('#undo-change').click();
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, 0);
  assert.equal(document.querySelector('[data-view="teacher"]').getAttribute('aria-pressed'), 'true', 'undo also retains the active view');
  assert.match(document.querySelector('#edit-status').textContent, /Modifica annullata/i);
  assert.match(document.querySelector('#current-status').textContent, /Esporta EDN/i);
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="target"]').style.gridRow.includes('1 / span'));
  dom.window.close();
});
