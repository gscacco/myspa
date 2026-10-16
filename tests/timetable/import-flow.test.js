import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTimetableApp } from '../../timetable/js/app.js';
import { readEDN } from '../../timetable/js/edn-codec.js';
import { domParser, minimalOFD, lessonXML } from './helpers.js';

const indexPath = fileURLToPath(new URL('../../timetable/index.html', import.meta.url));
const samplePath = fileURLToPath(new URL('../../OR_30_SETT.ofd', import.meta.url));
const unsupportedPath = fileURLToPath(new URL('../../timetable/fixtures/unsupported-demo.ofd', import.meta.url));
const fileFrom = source => ({ name: 'schedule.ofd', arrayBuffer: async () => {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
} });

async function mount({ confirm = () => true } = {}) {
  const html = await readFile(indexPath, 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const app = createTimetableApp({ document: dom.window.document, DOMParser: domParser, confirm });
  return { app, dom, document: dom.window.document };
}

test('import screen labels file selection, reports validation, and loads only on explicit confirmation', async () => {
  const { app, dom, document } = await mount();
  const bytes = await readFile(samplePath);
  const fileInput = document.querySelector('#ofd-file');
  assert.equal(fileInput.accept, '.ofd');
  assert.ok(fileInput.labels.length);
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [fileFrom(bytes)] });
  fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.timetable.lessons.length, 0, 'the app starts with an editable empty school');
  assert.equal(app.activeScreen, 'school');
  assert.equal(document.querySelector('#apply-import').disabled, false);
  assert.match(document.querySelector('#import-summary').textContent, /1[.,]?714/);
  assert.match(document.querySelector('#import-diagnostics').textContent, /6 lezioni senza orario/i);
  document.querySelector('#apply-import').click();
  assert.equal(app.timetable.lessons.length, 1714);
  assert.match(document.querySelector('#current-status').textContent, /caricato/i);
  assert.equal(document.querySelector('.import-card').hidden, true, 'the timetable workspace becomes primary after loading');
  assert.equal(document.querySelector('#timetable-workspace').hidden, false);
  assert.equal(document.querySelector('#export-edn').disabled, false, 'export stays available while the timetable is the primary screen');
  document.querySelector('#change-timetable').click();
  assert.equal(document.querySelector('.import-card').hidden, false, 'import controls remain reachable');
  dom.window.close();
});

test('failed or declined imports preserve the current timetable', async () => {
  let allowReplacement = false;
  const { app, dom, document } = await mount({ confirm: () => allowReplacement });
  const initial = fileFrom(minimalOFD({ lesson: lessonXML() }));
  await app.stageFile(initial);
  document.querySelector('#apply-import').click();
  const original = app.timetable;
  assert.ok(original);

  await app.stageFile(fileFrom('<DOCUMENT>'));
  assert.equal(app.timetable, original);
  assert.equal(document.querySelector('#apply-import').disabled, true);
  assert.match(document.querySelector('#import-report').textContent, /xml/i);

  await app.stageFile(fileFrom(minimalOFD({ lesson: lessonXML({ time: '0.1' }) })));
  document.querySelector('#apply-import').click();
  assert.equal(app.timetable, original, 'declining replacement keeps the active schedule');
  dom.window.close();
});

test('discarding a valid pending import leaves the current timetable unchanged', async () => {
  const { app, dom, document } = await mount();
  await app.stageFile(fileFrom(minimalOFD({ lesson: lessonXML() })));
  document.querySelector('#apply-import').click();
  const original = app.timetable;
  await app.stageFile(fileFrom(minimalOFD({ lesson: lessonXML({ time: '0.1' }) })));
  document.querySelector('#cancel-import').click();
  assert.equal(app.timetable, original);
  assert.match(document.querySelector('#import-report').textContent, /annullat/i);
  dom.window.close();
});

test('OFD import can keep teachers, classes, lessons, and constraints while omitting placements', async () => {
  const { app, dom, document } = await mount();
  const mode = document.querySelector('#ofd-without-assignments');
  assert.ok(mode, 'the import mode is available to staff');
  mode.checked = true;
  await app.stageFile(fileFrom(minimalOFD({ lesson: lessonXML({ time: '0.0', timeframes: '<UNAVAIL value="0.1"/>' }) })));
  assert.equal(app.pendingTimetable.lessons[0].assignedTime, null);
  assert.equal(app.pendingTimetable.lessons[0].teacherIds.length, 1);
  assert.equal(app.pendingTimetable.entities.classes.length, 1);
  assert.deepEqual(app.pendingTimetable.lessons[0].timeframes.unavailable, ['0.1']);
  assert.match(document.querySelector('#import-diagnostics').textContent, /collocazioni.*omesse/i);
  document.querySelector('#apply-import').click();
  assert.equal(app.timetable.lessons[0].assignedTime, null);
  dom.window.close();
});

test('unsupported OFD warnings can be reviewed and cancelled without replacing current data', async () => {
  const { app, dom, document } = await mount();
  await app.stageFile(fileFrom(minimalOFD({ lesson: lessonXML() })));
  document.querySelector('#apply-import').click();
  const original = app.timetable;
  await app.stageFile(fileFrom(await readFile(unsupportedPath)));
  assert.equal(app.timetable, original);
  assert.match(document.querySelector('#import-diagnostics').textContent, /FUTURE_RULE/);
  document.querySelector('#cancel-import').click();
  assert.equal(app.timetable, original);
  assert.match(document.querySelector('#import-report').textContent, /annullat/i);
  dom.window.close();
});

test('validates EDN before loading and exports the current domain model as EDN', async () => {
  const { app, dom, document } = await mount();
  const input = document.querySelector('#edn-file');
  assert.equal(input.accept, '.edn');
  assert.equal(document.querySelector('#export-edn-tools').disabled, true);
  await app.stageFile(fileFrom(minimalOFD({ lesson: lessonXML() })));
  document.querySelector('#apply-import').click();
  const original = app.timetable;
  assert.equal(document.querySelector('#export-edn').disabled, false);
  assert.equal(document.querySelector('#export-edn-tools').disabled, false);
  assert.deepEqual(readEDN(app.exportEDN()), original);

  await app.stageEDNFile(fileFrom('{:schemaVersion 1}'));
  assert.equal(app.timetable, original);
  assert.equal(document.querySelector('#apply-import').disabled, true);
  assert.match(document.querySelector('#import-report').textContent, /importazione non riuscita/i);
  dom.window.close();
});
