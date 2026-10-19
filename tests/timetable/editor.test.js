import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableEditor } from '../../timetable/js/editor.js';
import { createTimetableApp } from '../../timetable/js/app.js';
import { importTimetableEDN } from '../../timetable/js/edn-importer.js';
import { exportTimetableEDN } from '../../timetable/js/edn-importer.js';
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
  const app = createTimetableApp({ document: dom.window.document, confirm: () => true });
  const source = new TextEncoder().encode(exportTimetableEDN(fixture));
  await app.stageEDNFile({ name: 'synthetic.edn', arrayBuffer: async () => source.buffer });
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
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, selectedPeriod, 'the applied timetable remains current while views change');

  document.querySelector('[data-view="class"]').click();
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="target"]').style.gridRow.includes(String(selectedPeriod + 1)));
  document.querySelector('[data-view="teacher"]').click();
  assert.ok(document.querySelector('#schedule-grid [data-lesson-id="target"]').style.gridRow.includes(String(selectedPeriod + 1)));
  document.querySelector('#undo-change').click();
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, 0);
  assert.equal(document.querySelector('[data-view="teacher"]').getAttribute('aria-pressed'), 'true', 'undo also retains the active view');
  assert.match(document.querySelector('#edit-status').textContent, /Modifica annullata/i);
  assert.match(document.querySelector('#current-status').textContent, /Modifiche non esportate/i);
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
  assert.ok(document.querySelector('.timetable-heading #recalculate-all'), 'the calculation action stays in the timetable workspace');
  assert.equal(document.querySelector('#optimization-weight-undesired').value, '100');
  assert.equal(document.querySelector('#optimization-weight-preferred').value, '25');
  document.querySelector('#recalculate-all').click();
  await editor.recalculationComplete;
  assert.ok(document.querySelector('.proposal-option'));
  assert.ok(Number(document.querySelector('#optimization-iteration').textContent.replace(/\D/g, '')) > 0);
  assert.equal(document.querySelector('#review-recalculation').hidden, false);
  assert.equal(current.lessons[0].assignedTime, null, 'search leaves the current timetable unchanged');
  document.querySelector('#review-recalculation').click();
  assert.equal(confirms, 1);
  assert.equal(applied.lessons[0].assignedTime, null, 'declining the complete reassignment keeps current data');
  allow = true;
  document.querySelector('#review-recalculation').click();
  assert.equal(confirms, 2);
  assert.ok(applied.lessons[0].assignedTime);
  document.querySelector('#undo-change').click();
  assert.equal(applied.lessons[0].assignedTime, null);
  dom.window.close();
});

test('applying a full recalculation opens a populated class timetable and reports visible lessons', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const sourceTimetable = solverFixture();
  sourceTimetable.lessons[0].assignedTime = null;
  const app = createTimetableApp({ document, confirm: () => true });
  const source = new TextEncoder().encode(exportTimetableEDN(sourceTimetable));
  await app.stageEDNFile({ name: 'synthetic.edn', arrayBuffer: async () => source.buffer });
  app.applyImport();
  app.showScreen('schedule');

  document.querySelector('#recalculate-all').click();
  await app.editor.recalculationComplete;
  document.querySelector('.proposal-option').click();
  document.querySelector('#review-recalculation').click();

  assert.equal(app.activeScreen, 'schedule');
  assert.equal(document.querySelectorAll('#schedule-grid [data-lesson-id]').length, 1);
  assert.match(document.querySelector('#recalculation-status').textContent, /1 lezioni assegnate; 1 visualizzate per Class 1/);
  dom.window.close();
});

test('full recalculation excludes UNKNOWN-class activities and preserves them when applying/exporting', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const current = solverFixture();
  current.lessons[0].assignedTime = null;
  current.entities.classes.push({ id: 'class:unknown', name: 'UNKNOWN', placeholder: 'unknown' });
  const excluded = {
    ...structuredClone(current.lessons[0]), id: 'unknown-activity', classIds: ['class:unknown'],
    assignedTime: { dayIndex: 0, periodIndex: 0, sourceValue: '0.0' },
    timeframes: { unavailable: [], desired: [], undesired: ['0.0'] },
  };
  current.lessons.push(excluded);
  const beforeExcluded = structuredClone(excluded);
  const editor = createTimetableEditor({ document, getTimetable: () => current, onApply: next => Object.assign(current, next), confirm: () => true });

  document.querySelector('#recalculate-all').click();
  await editor.recalculationComplete;
  const proposalButton = document.querySelector('.proposal-option');
  assert.ok(proposalButton);
  assert.equal(proposalButton.dataset.changeCount, '1', 'only the real-class lesson is proposed for reassignment');
  proposalButton.click();
  assert.match(document.querySelector('#proposal-impact').textContent, /classe UNKNOWN sono escluse e restano invariate/i);
  document.querySelector('#review-recalculation').click();
  assert.ok(current.lessons.find(lesson => lesson.id === 'target').assignedTime);
  assert.deepEqual(current.lessons.find(lesson => lesson.id === 'unknown-activity'), beforeExcluded);
  assert.deepEqual(importTimetableEDN(exportTimetableEDN(current)).timetable, current, 'excluded activity survives export unchanged');
  dom.window.close();
});

test('an incomplete result marked solved is never offered as a full timetable proposal', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const current = solverFixture();
  const editor = createTimetableEditor({
    document,
    getTimetable: () => current,
    recalculator: async () => ({ status: 'solved', assignments: new Map(), objective: 0, iterations: 1 }),
  });
  document.querySelector('#recalculate-all').click();
  await editor.recalculationComplete;
  assert.equal(document.querySelector('.proposal-option'), null);
  assert.match(document.querySelector('#edit-status').textContent, /risultato incompleto/i);
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

test('constraint details are managed in the constraints sheet and undo stays on that sheet', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const source = structuredClone(solverFixture());
  source.lessons.forEach(lesson => { lesson.assignedTime = null; });
  const app = createTimetableApp({ document, confirm: () => true });
  const edn = new TextEncoder().encode(exportTimetableEDN(source));
  await app.stageEDNFile({ name: 'structure.edn', arrayBuffer: async () => edn.buffer });
  app.applyImport();
  assert.equal(app.timetable.lessons.every(lesson => lesson.assignedTime === null), true);
  assert.equal(document.querySelector('#school-page').hidden, false, 'structure-only imports open the data workspace');
  assert.equal(document.querySelector('#timetable-workspace').hidden, true);
  document.querySelector('[data-screen="constraints"]').click();
  assert.equal(document.querySelector('[data-school-panel="constraints"]').hidden, false);
  assert.equal(document.querySelector('#constraint-target').value, 'teacher|teacher:T1', 'the constraint editor starts on an imported target with an existing timeframe');
  document.querySelector('#constraint-target').value = 'teacher|teacher:T1';
  document.querySelector('#constraint-day').value = '0';
  document.querySelector('#constraint-period').value = '2';
  document.querySelector('#add-constraint').click();
  assert.equal(document.querySelector('[data-school-panel="constraints"]').hidden, false, 'saving keeps the constraints sheet open');
  assert.match(document.querySelector('#school-grid-constraints').textContent, /Teacher One.*Hard.*Monday.*10:00/i);
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.unavailable, ['0.2']);
  document.querySelector('#undo-constraint-change').click();
  assert.equal(document.querySelector('[data-school-panel="constraints"]').hidden, false, 'undo is available without leaving the constraints sheet');
  assert.deepEqual(app.timetable.entities.teachers[0].constraints.timeframes.unavailable, []);
  assert.doesNotMatch(document.querySelector('#school-grid-constraints').textContent, /Teacher One.*Hard.*Monday.*10:00/i);
  dom.window.close();
});

test('drag feedback accepts soft-worsening moves, rejects hard violations, and supports undo and redo', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, confirm: () => true });
  const source = new TextEncoder().encode(exportTimetableEDN(solverFixture()));
  await app.stageEDNFile({ name: 'manual.edn', arrayBuffer: async () => source.buffer });
  app.applyImport();
  document.querySelector('[data-screen="schedule"]').click();
  document.querySelector('#schedule-grid [data-lesson-id="target"]').click();
  const card = document.querySelector('#schedule-grid [data-lesson-id="target"]');
  const transfer = {
    data: '', effectAllowed: '', dropEffect: '',
    setData(_type, value) { this.data = value; },
    getData() { return this.data; },
  };
  const drag = new dom.window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(drag, 'dataTransfer', { value: transfer });
  card.dispatchEvent(drag);
  let destination = document.querySelector('#schedule-grid .slot-background[data-day-index="0"][data-period-index="1"]');
  assert.equal(destination.dataset.dropState, 'soft');
  const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: transfer });
  destination.dispatchEvent(drop);
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, 1);
  assert.match(document.querySelector('#edit-status').textContent, /penalità soft aumentata/i);
  document.querySelector('#undo-change').click();
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, 0);
  document.querySelector('#redo-change').click();
  assert.equal(app.timetable.lessons[0].assignedTime.periodIndex, 1);
  dom.window.close();

  const invalidDOM = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const invalidApp = createTimetableApp({ document: invalidDOM.window.document, confirm: () => true });
  const invalidModel = solverFixture();
  invalidModel.entities.teachers[0].constraints.timeframes.unavailable = ['0.1'];
  const invalidSource = new TextEncoder().encode(exportTimetableEDN(invalidModel));
  await invalidApp.stageEDNFile({ name: 'hard.edn', arrayBuffer: async () => invalidSource.buffer });
  invalidApp.applyImport();
  invalidDOM.window.document.querySelector('[data-screen="schedule"]').click();
  const invalidCard = invalidDOM.window.document.querySelector('#schedule-grid [data-lesson-id="target"]');
  const invalidTransfer = { data: '', setData(_type, value) { this.data = value; }, getData() { return this.data; } };
  const invalidDrag = new invalidDOM.window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(invalidDrag, 'dataTransfer', { value: invalidTransfer });
  invalidCard.dispatchEvent(invalidDrag);
  const invalidDestination = invalidDOM.window.document.querySelector('#schedule-grid .slot-background[data-day-index="0"][data-period-index="1"]');
  assert.equal(invalidDestination.dataset.dropState, 'invalid');
  assert.match(invalidDestination.title, /violazioni hard|non disponibile/i);
  const invalidDrop = new invalidDOM.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(invalidDrop, 'dataTransfer', { value: invalidTransfer });
  invalidDestination.dispatchEvent(invalidDrop);
  assert.equal(invalidApp.timetable.lessons[0].assignedTime.periodIndex, 0);
  assert.match(invalidDOM.window.document.querySelector('#edit-status').textContent, /violazioni hard/i);
  invalidDOM.window.close();
});

test('dropping a lesson on another lesson swaps both assignments atomically', async () => {
  const dom = new JSDOM(await readFile(indexPath, 'utf8'), { url: 'http://localhost/' });
  const { document } = dom.window;
  const app = createTimetableApp({ document, confirm: () => true });
  const model = solverFixture();
  model.entities.classes.push({ id: 'class:C2', name: 'Class 2' });
  model.entities.rooms.push({ id: 'room:R2', name: 'Room 2' });
  model.lessons.push({
    ...structuredClone(model.lessons[0]), id: 'second', sourceIndex: 1, classIds: ['class:C2'], roomIds: ['room:R2'],
    assignedTime: { dayIndex: 0, periodIndex: 2, sourceValue: '0.2' },
  });
  const source = new TextEncoder().encode(exportTimetableEDN(model));
  await app.stageEDNFile({ name: 'swap.edn', arrayBuffer: async () => source.buffer });
  app.applyImport();
  document.querySelector('[data-screen="schedule"]').click();
  document.querySelector('[data-view="teacher"]').click();
  document.querySelector('#schedule-grid [data-lesson-id="target"]').click();
  const target = document.querySelector('#schedule-grid [data-lesson-id="target"]');
  const second = document.querySelector('#schedule-grid [data-lesson-id="second"]');
  const transfer = { data: '', setData(_type, value) { this.data = value; }, getData() { return this.data; } };
  const drag = new dom.window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(drag, 'dataTransfer', { value: transfer });
  target.dispatchEvent(drag);
  assert.equal(second.dataset.dropState, 'valid');
  const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: transfer });
  second.dispatchEvent(drop);
  assert.deepEqual(app.timetable.lessons.map(lesson => lesson.assignedTime.periodIndex), [2, 0]);
  document.querySelector('#undo-change').click();
  assert.deepEqual(app.timetable.lessons.map(lesson => lesson.assignedTime.periodIndex), [0, 2]);
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
  assert.match(document.querySelector('#edit-status').textContent, /calcolo fermato/i);
  dom.window.close();
});
