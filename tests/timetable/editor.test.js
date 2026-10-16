import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableEditor } from '../../timetable/js/editor.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { importTimetableEDN } from '../../timetable/js/edn-importer.js';
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

test('the cancel-search control stops optimization without changing the current timetable', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const current = solverFixture({ chain: true });
  const before = structuredClone(current);
  const editor = createTimetableEditor({ document, getTimetable: () => current });
  editor.selectLesson('target');
  document.querySelector('#search-depth').value = 'chain';
  document.querySelector('#find-alternatives').click();
  assert.equal(document.querySelector('#cancel-search').disabled, false);
  document.querySelector('#cancel-search').click();
  await editor.searchComplete;
  assert.match(document.querySelector('#edit-status').textContent, /Ricerca annullata/i);
  assert.deepEqual(current, before);
  assert.equal(document.querySelector('#apply-proposal').disabled, true);
  dom.window.close();
});

test('the application refreshes class and teacher views after apply and restores both after undo', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const fixture = solverFixture();
  const app = createTimetableApp({
    document: dom.window.document,
    importer: async bytes => {
      if (bytes.length) throw new Error('Synthetic malformed OFD.');
      return { timetable: fixture, diagnostics: [], summary: { lessons: 1, assignedLessons: 1, unassignedLessons: 0, teachers: 1, classes: 1, rooms: 1, subjects: 2 } };
    },
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
  const exported = importTimetableEDN(app.exportEDN()).timetable;
  assert.deepEqual(exported, app.timetable, 'EDN export preserves applied changes');
  await app.stageFile({ name: 'invalid.ofd', arrayBuffer: async () => new Uint8Array([1]).buffer });
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, selectedPeriod, 'invalid import preserves unsaved edits');

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

test('full timetable recalculation stays a proposal until explicitly confirmed and can be undone', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const current = solverFixture();
  current.lessons[0].assignedTime = null;
  let applied = current;
  let allow = false;
  let confirms = 0;
  const editor = createTimetableEditor({ document, getTimetable: () => applied, onApply: next => { applied = next; }, confirm: () => { confirms++; return allow; } });
  assert.equal(document.querySelector('#recalculate-all').disabled, false);
  assert.ok(document.querySelector('.timetable-heading #recalculate-all'), 'the global calculation action is at the top of the timetable workspace');
  assert.equal(document.querySelector('#prefer-source-hints').checked, true);
  document.querySelector('#recalculate-all').click();
  await editor.recalculationComplete;
  assert.ok(document.querySelector('.proposal-option'));
  assert.equal(document.querySelector('#review-recalculation').hidden, false);
  assert.equal(current.lessons[0].assignedTime, null, 'search leaves the current timetable unchanged');
  document.querySelector('#review-recalculation').click();
  assert.match(document.querySelector('#proposal-impact').textContent, /assegnazione completa/i);
  document.querySelector('#apply-proposal').click();
  assert.equal(confirms, 1);
  assert.equal(applied.lessons[0].assignedTime, null, 'declining the complete reassignment keeps current data');
  allow = true;
  document.querySelector('#apply-proposal').click();
  assert.equal(confirms, 2);
  assert.ok(applied.lessons[0].assignedTime);
  document.querySelector('#undo-change').click();
  assert.equal(applied.lessons[0].assignedTime, null);
  dom.window.close();
});

test('constraint controls add, edit, and delete an active unavailability rule', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  let current = solverFixture();
  const editor = createTimetableEditor({ document, getTimetable: () => current, onApply: next => { current = next; } });
  editor.selectLesson('target');
  document.querySelector('#constraint-target').value = 'teacher|teacher:T1';
  document.querySelector('#constraint-day').value = '0';
  document.querySelector('#constraint-period').value = '1';
  document.querySelector('#add-constraint').click();
  assert.deepEqual(current.entities.teachers[0].constraints.timeframes.unavailable, ['0.1']);
  const edit = document.querySelector('.constraint-edit');
  edit.click();
  document.querySelector('#constraint-period').value = '2';
  document.querySelector('#add-constraint').click();
  assert.deepEqual(current.entities.teachers[0].constraints.timeframes.unavailable, ['0.2']);
  document.querySelector('.constraint-delete').click();
  assert.deepEqual(current.entities.teachers[0].constraints.timeframes.unavailable, []);
  document.querySelector('#undo-change').click();
  assert.deepEqual(current.entities.teachers[0].constraints.timeframes.unavailable, ['0.2']);
  dom.window.close();
});

test('editing an imported constraint from the structure screen keeps the overview open and current', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const source = solverFixture();
  const app = createTimetableApp({
    document,
    importer: async () => ({ timetable: source, diagnostics: [], summary: { lessons: 1, assignedLessons: 1, unassignedLessons: 0, teachers: 1, classes: 1, rooms: 1, subjects: 2 } }),
    confirm: () => true,
  });
  document.querySelector('#ofd-without-assignments').checked = true;
  await app.stageFile({ name: 'structure.ofd', arrayBuffer: async () => new ArrayBuffer(0) });
  app.applyImport();
  assert.equal(app.timetable.lessons.every(lesson => lesson.assignedTime === null), true);
  assert.equal(document.querySelector('#structure-page').hidden, false, 'structure-only imports open directly on the school overview');
  assert.equal(document.querySelector('#timetable-workspace').hidden, true);
  document.querySelector('#go-to-schedule-calculation').click();
  assert.equal(document.querySelector('#structure-page').hidden, true);
  assert.equal(document.activeElement.id, 'recalculate-all', 'the structure screen has a direct route to assignment calculation');
  document.querySelector('#open-structure').click();
  assert.match(document.querySelector('#structure-summary').textContent, /Senza assegnazione1/);
  assert.equal(document.querySelector('#constraint-target').value, 'teacher|teacher:T1', 'the constraint editor starts on an imported target with an existing timeframe');
  document.querySelector('#constraint-target').value = 'teacher|teacher:T1';
  document.querySelector('#constraint-day').value = '0';
  document.querySelector('#constraint-period').value = '2';
  document.querySelector('#add-constraint').click();
  assert.equal(document.querySelector('#structure-page').hidden, false, 'saving a constraint preserves the active structure screen');
  assert.match(document.querySelector('#structure-constraints').textContent, /Teacher One.*non disponibile.*Monday, 10:00/i);
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.unavailable, ['0.2']);
  document.querySelector('#undo-structure-change').click();
  assert.equal(document.querySelector('#structure-page').hidden, false, 'undo is available without leaving the structure screen');
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.unavailable, []);
  assert.doesNotMatch(document.querySelector('#structure-constraints').textContent, /Teacher One.*non disponibile.*Monday, 10:00/i);
  dom.window.close();
});

test('cancelling a full recalculation leaves the current timetable intact', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const current = solverFixture();
  const before = structuredClone(current);
  const editor = createTimetableEditor({
    document,
    getTimetable: () => current,
    recalculator: (timetable, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ status: 'cancelled', visited: 0 }), { once: true })),
  });
  document.querySelector('#recalculate-all').click();
  assert.equal(document.querySelector('#cancel-recalculation').disabled, false);
  document.querySelector('#cancel-recalculation').click();
  await editor.recalculationComplete;
  assert.deepEqual(current, before);
  assert.match(document.querySelector('#edit-status').textContent, /calcolo annullato/i);
  dom.window.close();
});
