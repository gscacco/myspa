import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEDNFileIO } from '../../loom/js/files.js';

test('native EDN save writes the separate user file and cancellation keeps it unsaved', async () => {
  const dom = new JSDOM('<input id="edn-file" type="file">');
  let written;
  dom.window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async source => { written = source; }, close: async () => {} }) });
  const files = createEDNFileIO({ window: dom.window, document: dom.window.document });
  assert.equal(await files.save('{:schema-version 1}'), true);
  assert.equal(written, '{:schema-version 1}');
  dom.window.showSaveFilePicker = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
  assert.equal(await files.save('ignored'), false);
  dom.window.close();
});

test('download and file-input fallbacks work without native pickers', async () => {
  const dom = new JSDOM('<input id="edn-file" type="file">');
  const view = dom.window;
  let clicked = false, revoked = false;
  view.URL.createObjectURL = () => 'blob:loom-data';
  view.URL.revokeObjectURL = () => { revoked = true; };
  view.setTimeout = callback => { callback(); return 1; };
  view.HTMLAnchorElement.prototype.click = function () { clicked = this.download === 'loom.edn' && this.href === 'blob:loom-data'; };
  const files = createEDNFileIO({ window: view, document: view.document });
  assert.equal(await files.save('data'), true);
  assert.equal(clicked, true);
  const file = { name: 'data.edn', text: async () => 'data' };
  const selection = files.choose();
  const input = view.document.querySelector('#edn-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new view.Event('change'));
  assert.equal(await selection, file);
  assert.equal(revoked, true);
  dom.window.close();
});
