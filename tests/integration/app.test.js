import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp, fakeClipboardEvent } from '../helpers/dom.js';

/** Shortcut: zero-based cell coordinates (r,c). */
const cell = (document, r, c) => document.querySelector('#g').rows[r + 1].cells[c + 1];
const mouse = (window, type, el) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
const key = (window, el, init) => el.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }));

test('startup builds the grid and calculates cell values', async () => {
  const { document, window, app, close } = await mountApp();
  const G = document.querySelector('#g');
  assert.equal(G.rows.length, 1025);
  assert.equal(G.rows[0].cells.length, 27);
  assert.equal(G.rows[0].cells[1].textContent, 'A');
  assert.equal(G.rows[0].cells[26].textContent, 'Z');
  assert.equal(G.rows[1024].cells[0].textContent, '1024');
  assert.equal(G.rows[1024].cells[1].colSpan, 26);
  assert.match(G.style.getPropertyValue('--compact-gridlines'), /transparent 83px,\s*var\(--ln\) 83px,\s*var\(--ln\) 84px,\s*transparent 84px/);
  G.rows[101].cells[1].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 }));
  assert.equal(document.querySelector('#nb').value, 'B101');
  assert.equal(G.rows[1].cells[1].textContent, 'Prodotto');
  assert.equal(cell(document, 1, 1).textContent, '1.50');
  assert.equal(cell(document, 1, 3).textContent, '150.00');
  assert.equal(cell(document, 1, 4).textContent, '183.00');
  assert.equal(cell(document, 5, 3).textContent, '843.80');
  assert.equal(cell(document, 5, 4).textContent, '1029.44');
  assert.equal(cell(document, 8, 3).textContent, 'Bassa');
  app.grid.sel(1023, 0);
  assert.equal(document.querySelector('#nb').value, 'A1024');
  app.grid.setCellText(1023, 0, 'Ultima riga');
  assert.equal(cell(document, 1023, 0).textContent, 'Ultima riga');
  close();
});

test('startup renders the toolbar, tabs, editor, and status', async () => {
  const { document, close } = await mountApp();
  assert.equal(document.querySelector('#stat').textContent, 'Foglio di calcolo');
  assert.equal(document.querySelector('#nb').value, 'A1');
  assert.equal(document.querySelector('#fx').value, 'Prodotto');
  assert.equal(document.querySelectorAll('#tabs button').length, 4);
  assert.equal(document.querySelector('#tabs button').textContent, 'Foglio1');
  assert.ok(document.querySelector('#code').value.includes('(defn WITH_TAX'));
  assert.ok(document.querySelector('#code').value.includes('(defn WEIGHTED_AVERAGE'));
  assert.doesNotMatch(document.querySelector('#code').value, /CONIVA|MEDIA_PESATA|valori|pesi/);
  assert.ok(document.querySelector('#hl').innerHTML.includes('class="u"'));
  assert.equal(document.querySelector('#ed'), null);
  assert.equal(document.querySelector('#formula-pop'), null);
  close();
});

test('selecting a cell updates the reference field', async () => {
  const { document, close } = await mountApp();
  mouse(document.defaultView, 'mousedown', cell(document, 5, 3));
  assert.equal(document.querySelector('#nb').value, 'D6');
  assert.equal(document.querySelector('#fx').value, '=SUM(D2:D5)');
  close();
});

test('the formula panel applies edits with Ctrl+Enter', async () => {
  const { document, window, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 1, 2));
  mouse(window, 'dblclick', cell(document, 1, 2));
  const ed = document.querySelector('#code');
  assert.equal(document.querySelector('#fn').hidden, false);
  assert.equal(ed.value, '100');
  assert.equal(document.querySelector('#ln').children.length, ed.value.split('\n').length);
  ed.value = '';
  ed.setSelectionRange(0, 0);
  ed.value = '(+ 1 1)';
  key(window, ed, { key: 'Enter', ctrlKey: true });
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.ok(ed.value.includes('(defn WITH_TAX'));
  assert.equal(cell(document, 1, 2).textContent, '2');
  assert.equal(cell(document, 1, 3).textContent, '3.00');
  assert.equal(document.querySelector('#nb').value, 'C2');
  close();
});

test('the code panel can be dragged in sheet and cell editor modes', async () => {
  const { document, window, app, close } = await mountApp();
  const panel = document.querySelector('#fn');
  const head = document.querySelector('#fn-head');
  let left = 40, top = 50;
  Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: 400 });
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 300 });
  panel.getBoundingClientRect = () => ({ left, top, width: 400, height: 300, right: left + 400, bottom: top + 300 });

  document.querySelector('#bfn').click();
  head.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 140 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(panel.style.left, '70px');
  assert.equal(panel.style.top, '90px');
  left = 70;
  top = 90;

  app.grid.sel(1, 2);
  app.grid.edit();
  head.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 200, clientY: 200 }));
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 180, clientY: 220 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(panel.style.left, '50px');
  assert.equal(panel.style.top, '110px');

  const before = [panel.style.left, panel.style.top];
  document.querySelector('#apply-code').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 200, clientY: 200 }));
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.deepEqual([panel.style.left, panel.style.top], before);
  close();
});

test('typing = does not open the formula editor as a formula prefix', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  key(window, window, { key: '=' });

  const ed = document.querySelector('#code');
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(ed.dataset.formula, undefined);
  close();
});

test('opening delimiters start cell editing and insert a balanced pair', async () => {
  const { document, window, app, close } = await mountApp();
  const ed = document.querySelector('#code');
  for (const [i, open] of ['(', '[', '{'].entries()) {
    const pair = open + { '(': ')', '[': ']', '{': '}' }[open];
    app.grid.sel(9 + i, 8);
    key(window, window, { key: open });
    assert.equal(document.querySelector('#fn').hidden, false);
    assert.equal(ed.value, pair);
    assert.equal(ed.selectionStart, 1);
    key(window, ed, { key: 'Enter', ctrlKey: true });
    assert.equal(document.querySelector('#fn').hidden, true);
  }
  close();
});

test('cell formulas and ClojureScript data forms need no equals prefix', async () => {
  const { app, document, window, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const code = document.querySelector('#code');
  code.value = '(+ 1 2 3)';
  key(window, code, { key: 'Enter', ctrlKey: true });
  assert.equal(app.currentSheet().cells.I10.r, '(+ 1 2 3)');
  assert.equal(document.querySelector('#fx').value, '(+ 1 2 3)');
  assert.equal(cell(document, 9, 8).textContent, '6');

  app.grid.setCellText(0, 8, ':pippo');
  app.grid.setCellText(1, 8, '[1 2 3]');
  app.grid.setCellText(2, 8, '{:pippo 12}');
  assert.equal(app.session.engine.evaluate('Foglio1!I1'), 'pippo');
  assert.deepEqual(app.session.engine.evaluate('Foglio1!I2'), [1, 2, 3]);
  assert.deepEqual(app.session.engine.evaluate('Foglio1!I3'), { pippo: 12 });
  assert.equal(cell(document, 1, 8).textContent, '[1 2 3]');
  assert.equal(cell(document, 2, 8).textContent, '{:pippo 12}');

  app.grid.sel(9, 8);
  app.grid.edit();
  code.value = '[1 ';
  code.setSelectionRange(code.value.length, code.value.length);
  mouse(window, 'mousedown', cell(document, 1, 1));
  assert.equal(code.value, '[1 B2');
  code.value += ']';
  key(window, code, { key: 'Enter', ctrlKey: true });
  assert.deepEqual(app.session.engine.evaluate('Foglio1!I10'), [1, 1.5]);
  close();
});

test('cell formulas reuse the syntax-highlighted editor and its apply button', async () => {
  const { document, window, app, close } = await mountApp();
  const code = document.querySelector('#code');
  const originalCode = code.value;
  assert.equal(document.querySelector('#fn').hidden, true);

  app.grid.sel(1, 3);
  app.grid.edit();
  assert.equal(document.querySelector('#fn').hidden, false);
  assert.equal(document.querySelector('#fn-title').textContent, 'Cell formula · D2');
  assert.equal(code.value, 'B2*C2');
  assert.equal(document.querySelector('#apply-code').textContent, '✓');
  assert.equal(document.querySelector('#apply-code').getAttribute('aria-label'), 'Apply this cell formula');

  code.value = '(SUM B2 C2)';
  code.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match(document.querySelector('#hl').innerHTML, /class="b">SUM/);
  document.querySelector('#apply-code').click();
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(code.value, originalCode);
  assert.equal(document.querySelector('#nb').value, 'D2');
  assert.equal(document.querySelector('#fx').value, '(SUM B2 C2)');
  assert.equal(document.querySelector('#g').rows[2].cells[4].textContent, '101.50');
  close();
});

test('ClojureScript values in cells share the editor syntax highlighting safely', async () => {
  const { document, app, close } = await mountApp();
  app.grid.setCellText(10, 8, '{:status :active :count 4 :label "<tag>"}');
  const td = cell(document, 10, 8);
  assert.ok(td.classList.contains('clj-value'));
  assert.ok([...td.querySelectorAll('i.k')].some(token => token.textContent === ':active'));
  assert.equal(td.querySelector('i.n')?.textContent, '4');
  assert.equal(td.querySelector('i.s')?.textContent, '"<tag>"');
  assert.ok(td.innerHTML.includes('&lt;tag'));
  assert.equal(td.querySelector('tag'), null);
  app.grid.setCellText(10, 8, '(vec (range 1000))');
  assert.equal(app.session.engine.evaluate('Foglio1!I11').length, 1000, 'the complete value remains available to the workbook');
  assert.ok(td.textContent.endsWith('…'), 'large values are previewed in the grid');
  assert.equal(td.querySelector('i'), null, 'large values do not create syntax-highlight spans');
  close();
});

test('the formula editor stays open on blur and grid click until Ctrl+Enter', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(+ 2 3)';
  ed.setSelectionRange(ed.value.length, ed.value.length);

  ed.dispatchEvent(new window.FocusEvent('blur'));
  assert.equal(document.querySelector('#fn').hidden, false);
  mouse(window, 'mousedown', cell(document, 1, 1));
  assert.equal(document.querySelector('#fn').hidden, false);
  assert.deepEqual(app.grid.cursor(), { r: 9, c: 8 });

  key(window, ed, { key: 'Enter', ctrlKey: true });
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.ok(ed.value.includes('(defn WITH_TAX'));
  assert.equal(app.currentSheet().cells.I10.r.trim(), '(+ 2 3)');
  assert.equal(cell(document, 9, 8).textContent, '5');
  close();
});

test('Escape and the close button cancel an inline formula edit', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(+ 2 3)';
  key(window, ed, { key: 'Escape' });
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(app.currentSheet().cells.I10, undefined);

  app.grid.edit();
  ed.value = '(+ 3 4)';
  document.querySelector('#close-code').click();
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(app.currentSheet().cells.I10, undefined);
  close();
});

test('switching sheets cannot close the active formula editor', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(+ 2 3)';

  mouse(window, 'click', document.querySelectorAll('#tabs button')[1]);

  assert.equal(document.querySelector('#fn').hidden, false);
  assert.equal(app.currentSheet().name, 'Foglio1');
  assert.equal(app.currentSheet().cells.I10, undefined);
  close();
});

test('Enter inserts a newline and Ctrl+Enter applies the form', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(+ 1 2)';
  ed.setSelectionRange(4, 4);

  key(window, ed, { key: 'Enter' });
  assert.equal(document.querySelector('#fn').hidden, false);
  assert.equal(ed.value.includes('\n'), true);
  assert.equal(cell(document, 9, 8).textContent, '');

  key(window, ed, { key: 'Enter', ctrlKey: true });
  assert.equal(document.querySelector('#fn').hidden, true);
  assert.equal(cell(document, 9, 8).textContent, '3');
  assert.match(app.currentSheet().cells.I10.r, /^\(\+ 1\n/);
  close();
});

test('the editor has no duplicate textarea, help block, or paredit toolbar', async () => {
  const { document, close } = await mountApp();
  assert.equal(document.querySelector('#fn b').textContent, 'User-defined functions (ClojureScript)');
  assert.equal(document.querySelectorAll('#fn textarea').length, 1);
  assert.equal(document.querySelector('#help'), null);
  assert.equal(document.querySelector('#help-resize'), null);
  assert.equal(document.querySelectorAll('#fn [data-action^="paredit-"]').length, 0);
  assert.deepEqual([...document.querySelectorAll('#fn button')].map(button => button.id), ['apply-code', 'close-code']);
  assert.equal(document.querySelector('#note').getAttribute('role'), 'status');
  assert.ok(document.querySelector('#fe'));
  close();
});

test('clicking a cell completes the first argument of a ClojureScript formula', async () => {
  const { document, window, app, close } = await mountApp();
  document.querySelector('#code').value = '(defn double-value [x] (* x 2))';
  mouse(window, 'click', document.querySelector('#apply-code'));

  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(double-value';
  ed.setSelectionRange(ed.value.length, ed.value.length);
  mouse(window, 'mousedown', cell(document, 1, 1));

  assert.equal(document.querySelector('#fn').hidden, false);
  assert.equal(ed.value, '(double-value B2');
  ed.value += ')';
  key(window, ed, { key: 'Enter', ctrlKey: true });
  assert.equal(cell(document, 9, 8).textContent, '3');
  close();
});

test('dragging across cells inserts a range reference while editing a formula', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(SUM';
  ed.setSelectionRange(ed.value.length, ed.value.length);

  mouse(window, 'mousedown', cell(document, 1, 1));
  mouse(window, 'mouseover', cell(document, 3, 4));
  assert.ok(cell(document, 2, 2).classList.contains('ref-range-target'));
  mouse(window, 'mouseup', window);

  assert.equal(ed.value, '(SUM B2:E4');
  assert.equal(cell(document, 2, 2).classList.contains('ref-range-target'), false);
  close();
});

test('clicking a cell after a function name inserts its argument in the existing space', async () => {
  const { document, window, app, close } = await mountApp();
  document.querySelector('#code').value = '(defn double-value [x] (* x 2))';
  mouse(window, 'click', document.querySelector('#apply-code'));

  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(double-value )';
  const cursor = '(double-value '.length;
  ed.setSelectionRange(cursor, cursor);
  mouse(window, 'mousedown', cell(document, 1, 1));

  assert.equal(document.querySelector('#fn').hidden, false);
  assert.equal(ed.value, '(double-value B2)');
  key(window, ed, { key: 'Enter', ctrlKey: true });
  assert.equal(cell(document, 9, 8).textContent, '3');
  close();
});

test('paredit completes, skips, and deletes paired delimiters in the formula editor', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '';
  ed.setSelectionRange(0, 0);

  key(window, ed, { key: '(' });
  assert.equal(ed.value, '()');
  assert.equal(ed.selectionStart, 1);
  key(window, ed, { key: 'Delete' });
  assert.equal(ed.value, '()');
  key(window, ed, { key: 'Backspace' });
  assert.equal(ed.value, '');
  assert.equal(ed.selectionStart, 0);

  key(window, ed, { key: '(' });
  key(window, ed, { key: ')' });
  assert.equal(ed.value, '()');
  assert.equal(ed.selectionStart, 2);
  close();
});

test('paredit runs structural keyboard commands in the formula editor', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(f 1) 2';
  ed.setSelectionRange(5, 5);
  key(window, ed, { key: 'ArrowRight', ctrlKey: true });
  assert.equal(ed.value, '(f 1 2)');
  close();
});

test('the formula bar edits the selected cell', async () => {
  const { document, window, close } = await mountApp();
  const fx = document.querySelector('#fx');
  fx.value = '7';
  key(window, fx, { key: 'Enter' });
  assert.equal(cell(document, 0, 0).textContent, '7');
  close();
});

test('keyboard navigation and extended selection work', async () => {
  const { document, window, close } = await mountApp();
  key(window, window, { key: 'ArrowDown' });
  assert.equal(document.querySelector('#nb').value, 'A2');
  key(window, window, { key: 'ArrowRight' });
  assert.equal(document.querySelector('#nb').value, 'B2');
  key(window, window, { key: 'ArrowDown', shiftKey: true });
  assert.equal(document.querySelector('#nb').value, 'B2');
  assert.equal(document.querySelector('#vv').textContent, '');
  close();
});

test('the toolbar changes bold, decimal places, and background color', async () => {
  const { document, window, close } = await mountApp();
  // B2 is a numeric cell without bold or background formatting, so it can be
  // used to verify toolbar formatting.
  mouse(window, 'mousedown', cell(document, 1, 1));
  mouse(window, 'click', document.querySelector('[data-action="toggle-bold"]'));
  assert.equal(cell(document, 1, 1).style.fontWeight, '700');
  mouse(window, 'click', document.querySelector('[data-action="dec-plus"]'));
  assert.equal(cell(document, 1, 1).textContent, '1.500');
  const color = document.querySelector('[data-action="bg-color"]');
  color.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.notEqual(cell(document, 1, 1).style.background, '');
  mouse(window, 'click', document.querySelector('[data-action="bg-clear"]'));
  assert.equal(cell(document, 1, 1).style.background, '');
  close();
});

test('column and row header edges resize and retain their dimensions', async () => {
  const { document, window, app, close } = await mountApp();
  const colHandle = document.querySelector('.col-resizer[data-column="1"]');
  colHandle.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 84 }));
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 124 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(app.currentSheet().widths['1'], 124);
  assert.equal(document.querySelector('col[data-column="1"]').style.width, '124px');

  const rowHandle = document.querySelector('.row-resizer[data-row="1"]');
  rowHandle.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientY: 24 }));
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientY: 54 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(app.currentSheet().heights['1'], 54);
  assert.equal(document.querySelector('#g').rows[2].cells[0].style.height, '54px');

  app.grid.render();
  assert.equal(document.querySelector('col[data-column="1"]').style.width, '124px');
  assert.equal(document.querySelector('#g').rows[2].cells[0].style.height, '54px');
  close();
});

test('Delete clears a cell and Ctrl+Z undoes the change', async () => {
  const { document, window, app, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 0, 0));
  key(window, window, { key: 'Delete' });
  assert.equal(cell(document, 0, 0).textContent, '');
  assert.equal(document.querySelector('#stat').textContent, '● modificato · Foglio di calcolo');
  key(window, window, { code: 'KeyZ', key: 'z', ctrlKey: true });
  assert.equal(cell(document, 0, 0).textContent, 'Prodotto');
  assert.equal(app.session.getHistorySize(), 0);
  close();
});

test('copy and paste work with the internal clipboard', async () => {
  const { document, app, close } = await mountApp();
  app.grid.sel(0, 0);
  const e1 = fakeClipboardEvent(document.body);
  app.commands.cp(e1, 0);
  assert.equal(e1.store['text/plain'], 'Prodotto');
  app.grid.sel(6, 2);
  app.grid.sel(7, 4, true);
  const e2 = fakeClipboardEvent(document.body);
  e2.clipboardData.setData('text/plain', e1.store['text/plain']);
  app.commands.paste(e2);
  for (let r = 6; r <= 7; r++) for (let c = 2; c <= 4; c++) assert.equal(cell(document, r, c).textContent, 'Prodotto');
  close();
});

test('pasting preserves newlines inside a quoted or HTML clipboard cell', async () => {
  const { document, app, close } = await mountApp();

  app.grid.sel(9, 8);
  const quoted = fakeClipboardEvent(document.body);
  quoted.clipboardData.setData('text/plain', '"Uno\r\nDue"');
  app.commands.paste(quoted);
  assert.equal(app.currentSheet().cells.I10.r, 'Uno\nDue');
  assert.equal(app.currentSheet().cells.I11, undefined, 'an embedded line break stays in one cell');

  app.grid.sel(9, 9);
  const fromExcel = fakeClipboardEvent(document.body);
  fromExcel.clipboardData.setData('text/plain', 'Uno\nDue');
  fromExcel.clipboardData.setData('text/html', '<table><tr><td>Uno<br>Due</td></tr></table>');
  app.commands.paste(fromExcel);
  assert.equal(app.currentSheet().cells.J10.r, 'Uno\nDue');
  assert.equal(app.currentSheet().cells.J11, undefined, 'HTML cell boundaries disambiguate an unquoted Excel line break');

  app.grid.sel(9, 10);
  const rows = fakeClipboardEvent(document.body);
  rows.clipboardData.setData('text/plain', 'Uno\nDue');
  app.commands.paste(rows);
  assert.equal(app.currentSheet().cells.K10.r, 'Uno');
  assert.equal(app.currentSheet().cells.K11.r, 'Due', 'ordinary unquoted multiline text still pastes as rows');
  close();
});

test('copying a ClojureScript formula shifts relative rows and columns while keeping dollar anchors', async () => {
  const { document, app, close } = await mountApp();
  app.grid.setCellText(1, 1, '1');
  app.grid.setCellText(1, 2, '2');
  app.grid.setCellText(1, 3, '3');
  app.grid.setCellText(2, 2, '4');
  app.grid.setCellText(2, 3, '5');
  app.grid.setCellText(19, 0, '(+ B2 $C$2 C$2 $D2)');
  assert.equal(app.session.engine.evaluate('Foglio1!A20'), 8);

  app.grid.sel(19, 0);
  const copied = fakeClipboardEvent(document.body);
  app.commands.cp(copied, 0);
  app.grid.sel(20, 1);
  const pasted = fakeClipboardEvent(document.body);
  pasted.clipboardData.setData('text/plain', copied.store['text/plain']);
  app.commands.paste(pasted);

  assert.equal(app.currentSheet().cells.B21.r, '(+ C3 $C$2 D$2 $D3)');
  assert.equal(app.session.engine.evaluate('Foglio1!B21'), 14);
  close();
});

test('pasting a multiline ClojureScript map between sheets keeps it in one cell', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.setCellText(3, 1, '100');
  app.grid.setCellText(0, 0, '{:name "Radar"\n :budget B4\n :status :active}');
  app.grid.sel(0, 0);
  const copied = fakeClipboardEvent(document.body);
  app.commands.cp(copied, 0);
  assert.equal(copied.store['text/plain'].includes('\n'), false);

  mouse(window, 'click', document.querySelectorAll('#tabs button')[1]);
  app.grid.setCellText(4, 2, '250');
  app.grid.sel(1, 1);
  const pasted = fakeClipboardEvent(document.body);
  pasted.clipboardData.setData('text/plain', copied.store['text/plain']);
  pasted.clipboardData.setData('application/x-foglio-cells', copied.store['application/x-foglio-cells']);
  app.commands.paste(pasted);

  assert.equal(app.currentSheet().cells.B2.r.includes('\n'), false);
  assert.match(app.currentSheet().cells.B2.r, /:budget 100/);
  assert.deepEqual(app.session.engine.evaluate('Foglio2!B2'), { name: 'Radar', budget: 100, status: 'active' });
  assert.equal(app.currentSheet().cells.B3, undefined);
  assert.equal(app.currentSheet().cells.B4, undefined);
  app.grid.setCellText(2, 1, '(= (:status B2) :active)');
  assert.equal(app.session.engine.evaluate('Foglio2!B3'), true);
  close();
});

test('pasting into a selected range repeats the copied formula and shifts it per destination cell', async () => {
  const { document, app, close } = await mountApp();
  app.grid.setCellText(19, 0, '(+ B2 $C$2 C$2 $D2)');
  app.grid.sel(19, 0);
  const copied = fakeClipboardEvent(document.body);
  app.commands.cp(copied, 0);
  app.grid.sel(20, 1);
  app.grid.sel(21, 2, true);
  const pasted = fakeClipboardEvent(document.body);
  pasted.clipboardData.setData('text/plain', copied.store['text/plain']);
  app.commands.paste(pasted);

  assert.equal(app.currentSheet().cells.B21.r, '(+ C3 $C$2 D$2 $D3)');
  assert.equal(app.currentSheet().cells.C21.r, '(+ D3 $C$2 E$2 $D3)');
  assert.equal(app.currentSheet().cells.B22.r, '(+ C4 $C$2 D$2 $D4)');
  assert.equal(app.currentSheet().cells.C22.r, '(+ D4 $C$2 E$2 $D4)');
  close();
});

test('the fill handle copies a cell through the dragged-to range', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.setCellText(19, 0, '(str B2)');
  app.grid.sel(19, 0);
  const handle = document.querySelector('#fh');
  mouse(window, 'mousedown', handle);
  mouse(window, 'mouseover', cell(document, 21, 2));
  mouse(window, 'mouseup', window);

  assert.equal(app.currentSheet().cells.A20.r, '(str B2)');
  assert.equal(app.currentSheet().cells.B20.r, '(str C2)');
  assert.equal(app.currentSheet().cells.C20.r, '(str D2)');
  assert.equal(app.currentSheet().cells.A21.r, '(str B3)');
  assert.equal(app.currentSheet().cells.C22.r, '(str D4)');
  assert.deepEqual(app.grid.rect(), { r0: 19, r1: 21, c0: 0, c1: 2 });
  close();
});

test('sheets can be added and selected from the tabs', async () => {
  const { document, window, close } = await mountApp();
  const plus = () => [...document.querySelectorAll('#tabs button')].find(b => b.textContent === '＋');
  mouse(window, 'click', plus());
  assert.equal(document.querySelectorAll('#tabs button').length, 5);
  assert.equal(document.querySelector('#tabs button.on').textContent, 'Foglio3');
  assert.equal(cell(document, 0, 0).textContent, '');
  mouse(window, 'click', document.querySelector('#tabs button'));
  assert.equal(document.querySelector('#tabs button.on').textContent, 'Foglio1');
  assert.equal(cell(document, 0, 0).textContent, 'Prodotto');
  close();
});

test('ClojureScript code can be applied from the editor', async () => {
  const { document, window, app, close } = await mountApp();
  document.querySelector('#code').value = '(defn TRIPLE [x] (* x 3))';
  mouse(window, 'click', document.querySelector('#apply-code'));
  app.grid.setCellText(0, 8, '=TRIPLE(4)');
  assert.equal(cell(document, 0, 8).textContent, '12');
  close();
});

test('an editor error does not affect built-in functions', async () => {
  const { document, window, app, close } = await mountApp();
  document.querySelector('#code').value = '(defn broken [x]';
  mouse(window, 'click', document.querySelector('#apply-code'));
  assert.match(document.querySelector('#fe').textContent, /Riga/);
  app.grid.setCellText(0, 8, '=SUM(1,2,3)');
  assert.equal(cell(document, 0, 8).textContent, '6');
  close();
});

test('the editor applies paredit slurp/barf with Ctrl+arrows', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  ta.value = '(a b) c';
  ta.setSelectionRange(4, 4);
  key(window, ta, { key: 'ArrowRight', ctrlKey: true });
  assert.equal(ta.value, '(a b c)');
  key(window, ta, { key: 'ArrowLeft', ctrlKey: true });
  assert.equal(ta.value, '(a b) c');
  // Wait for the editor's delayed syntax check before closing the DOM.
  await new Promise(r => setTimeout(r, 450));
  close();
});

test('the functions panel can be opened and closed', async () => {
  const { document, window, close } = await mountApp();
  const panel = document.querySelector('#fn');
  assert.equal(panel.hidden, true);
  mouse(window, 'click', document.querySelector('[data-action="toggle-functions"]'));
  assert.equal(panel.hidden, false);
  assert.equal(document.querySelector('#bfn').classList.contains('on'), true);
  close();
});

test('the dependency-flow toggle highlights sources and dependents', async () => {
  const { document, window, app, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 5, 3));
  assert.ok(document.querySelectorAll('#g td.pre').length > 0);
  mouse(window, 'click', document.querySelector('[data-action="toggle-flow"]'));
  assert.equal(document.querySelectorAll('#g td.pre').length, 0);

  const querySelectorAll = document.querySelectorAll.bind(document);
  let fullFlowScans = 0;
  document.querySelectorAll = selector => {
    if (selector === '.pre,.post') fullFlowScans++;
    return querySelectorAll(selector);
  };
  app.grid.sel(0, 0);
  assert.equal(fullFlowScans, 0, 'turning flow off avoids document-wide scans on cell selection');

  mouse(window, 'click', document.querySelector('[data-action="toggle-flow"]'));
  const changed = app.session.pasteRows('Foglio1', 0, 0, Array.from({ length: 277 }, (_, i) => [i + 1]));
  app.grid.paint(changed);
  app.grid.setCellText(0, 25, '=SUM(A1:A277)');
  app.grid.sel(0, 25);
  assert.equal(app.session.engine.evaluate('Foglio1!Z1'), 277 * 278 / 2);
  assert.equal(document.querySelectorAll('#g td.pre').length, 0, 'very large dependency sets are not highlighted');
  close();
});

test('paredit keyboard shortcuts run slurp, barf, splice, and wrap', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  const run = (value, cursor, keyName, expected) => {
    ta.value = value;
    ta.setSelectionRange(cursor, cursor);
    key(window, ta, { key: keyName, ctrlKey: true });
    assert.equal(ta.value, expected, keyName);
  };
  run('(a b) c', 5, 'ArrowRight', '(a b c)');
  run('(a b c)', 7, 'ArrowLeft', '(a b) c');
  run('(a b) c', 5, 'ArrowUp', 'a b c');
  ta.value = 'a b';
  ta.setSelectionRange(0, 3);
  key(window, ta, { key: 'ArrowDown', ctrlKey: true });
  assert.equal(ta.value, '(a b)');
  await new Promise(r => setTimeout(r, 450));
  close();
});

test('paredit: Backspace and Delete keep delimiters balanced', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  const pressKey = init => {
    const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    ta.dispatchEvent(ev);
    return ev;
  };
  ta.value = '(a b)';
  ta.setSelectionRange(1, 1);
  assert.equal(pressKey({ key: 'Backspace' }).defaultPrevented, true, 'the opening «(» is protected');
  assert.match(document.querySelector('#note').textContent, /sbilancerebbe/);
  ta.setSelectionRange(5, 5);
  assert.equal(pressKey({ key: 'Backspace' }).defaultPrevented, true, 'Backspace steps over the closing «)»');
  assert.equal(ta.value, '(a b)');
  assert.equal(ta.selectionStart, 4);
  ta.value = '(+ 1 2 3)';
  ta.setSelectionRange(ta.value.length, ta.value.length);
  pressKey({ key: 'Backspace' });
  assert.equal(ta.value, '(+ 1 2 3)');
  assert.equal(ta.selectionStart, 8);
  ta.setSelectionRange(0, 0);
  assert.equal(pressKey({ key: 'Delete' }).defaultPrevented, true, 'Delete steps over the opening «(»');
  assert.equal(ta.value, '(+ 1 2 3)');
  assert.equal(ta.selectionStart, 1);
  ta.value = '(a b)';
  ta.setSelectionRange(2, 2);
  assert.equal(pressKey({ key: 'Backspace' }).defaultPrevented, false, 'ordinary text can be deleted');
  ta.setSelectionRange(1, 1);
  assert.equal(pressKey({ key: 'Delete' }).defaultPrevented, false, 'Delete works on an ordinary character');
  ta.setSelectionRange(0, 5);
  assert.equal(pressKey({ key: 'Delete' }).defaultPrevented, false, 'a whole list remains balanced');
  ta.value = '(a b';
  ta.setSelectionRange(0, 4);
  assert.equal(pressKey({ key: 'Delete' }).defaultPrevented, true, 'a selection that cuts through a list is protected');
  // An empty pair is deleted as a whole.
  ta.value = '()';
  ta.setSelectionRange(1, 1);
  pressKey({ key: 'Backspace' });
  assert.equal(ta.value, '');
  await new Promise(r => setTimeout(r, 450));
  close();
});

test('Ctrl+Enter evaluates the form before the cursor (C-x C-e)', async () => {
  const { document, window, app, close } = await mountApp();
  const ta = document.querySelector('#code');
  const evaluate = text => {
    ta.value = text;
    ta.setSelectionRange(text.length, text.length);
    key(window, ta, { key: 'Enter', ctrlKey: true });
  };
  evaluate('(defn TRIPLE [x] (* x 3))');
  app.grid.setCellText(0, 8, '=TRIPLE(4)');
  assert.equal(cell(document, 0, 8).textContent, '12');
  assert.match(document.querySelector('#note').textContent, /TRIPLE/);
  // Redefining the function updates formulas that use it.
  evaluate('(defn TRIPLE [x] (* x 10))');
  assert.equal(cell(document, 0, 8).textContent, '40');
  // Other model definitions remain active.
  app.grid.setCellText(0, 9, '=WITH_TAX(1)');
  assert.equal(app.session.engine.evaluate('Foglio1!J1'), 1 + 0.22);
  // If there is no form before the cursor, the whole editor is applied.
  ta.value = '   ';
  ta.setSelectionRange(3, 3);
  key(window, ta, { key: 'Enter', ctrlKey: true });
  assert.match(document.querySelector('#note').textContent, /applicato/);
  close();
});

test('Ctrl+Enter reports an error for a form that cannot be evaluated', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  const form = '(missing-key 1)';
  ta.value = form;
  ta.setSelectionRange(form.length, form.length);
  key(window, ta, { key: 'Enter', ctrlKey: true });
  assert.match(document.querySelector('#note').textContent, /^✗/);
  assert.match(document.querySelector('#fe').textContent, /missing-key/);
  close();
});

test('Explore Data shows the selected cell value as a tree and closes without changing it', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.setCellText(0, 8, '{:status :active :result (+ 1 2) :items ["a" :b]}');
  app.grid.sel(0, 8);
  document.querySelector('[data-action="explore-data"]').click();

  const overlay = document.querySelector('#data-explorer');
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.querySelector('.explorer-location').textContent, 'Source snapshot: Foglio1!I1');
  assert.equal(overlay.querySelector('.tree-value').textContent, '{…}');
  assert.equal(overlay.querySelector('.explorer-nav'), null, 'the inspector has one simple tree view');
  assert.equal(overlay.querySelector('.pipeline-add'), null);

  const root = overlay.querySelector('.tree-node');
  root.open = true;
  root.dispatchEvent(new window.Event('toggle'));
  assert.ok([...overlay.querySelectorAll('.tree-value')].some(value => value.textContent === '3'), 'the tree displays evaluated values');
  assert.ok([...overlay.querySelectorAll('.tree-label')].some(label => label.textContent === ':status'));

  app.grid.sel(1, 8);
  assert.equal(overlay.querySelector('.explorer-location').textContent, 'Source snapshot: Foglio1!I1');
  overlay.querySelector('[data-explorer-close]').click();
  assert.equal(overlay.hidden, true);
  assert.equal(app.currentSheet().cells.I1.r, '{:status :active :result (+ 1 2) :items ["a" :b]}');
  assert.deepEqual(app.grid.cursor(), { r: 1, c: 8 });
  close();
});

test('Explore Data displays atomic values and nested ClojureScript collections in the tree', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.setCellText(0, 8, '{:atom 42 :empty [] :items [{:status :active}] :values (list :first :second) :tags #{:one :two}}');
  app.grid.sel(0, 8);
  document.querySelector('[data-action="explore-data"]').click();

  const overlay = document.querySelector('#data-explorer');
  const root = overlay.querySelector('.tree-node');
  root.open = true;
  root.dispatchEvent(new window.Event('toggle'));
  const nodeForLabel = label => [...overlay.querySelectorAll('.tree-label')]
    .find(node => node.textContent === label)?.closest('.tree-node');

  assert.equal(nodeForLabel(':atom').querySelector('.tree-type').textContent, 'number');
  assert.equal(nodeForLabel(':empty').querySelector('.tree-value').textContent, '[]');
  assert.equal(nodeForLabel(':empty').tagName, 'DIV', 'empty collections do not show an empty disclosure control');
  assert.equal(nodeForLabel(':tags').querySelector('.tree-type').textContent, 'set · 2');
  assert.equal(nodeForLabel(':values').querySelector('.tree-type').textContent, 'list · 2');

  const items = nodeForLabel(':items');
  items.open = true;
  items.dispatchEvent(new window.Event('toggle'));
  const firstItem = [...items.querySelectorAll('.tree-label')]
    .find(label => label.textContent === '[0]')?.closest('.tree-node');
  assert.ok(firstItem);
  firstItem.open = true;
  firstItem.dispatchEvent(new window.Event('toggle'));
  assert.ok(items.textContent.includes(':active'));
  close();
});

test('Explore Data copies the selected EDN and its ClojureScript selection expression from the toolbar', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async value => { copied.push(value); } } },
  });
  const { document, window, app, close } = await mountApp();
  try {
    app.grid.setCellText(0, 8, '{:person {:score 7} :tags [:alpha :beta]}');
    app.grid.sel(0, 8);
    document.querySelector('[data-action="explore-data"]').click();

    const overlay = document.querySelector('#data-explorer');
    const expand = details => {
      details.open = true;
      details.dispatchEvent(new window.Event('toggle'));
    };
    const nodeForLabel = label => [...overlay.querySelectorAll('.tree-label')]
      .find(node => node.textContent === label)?.closest('.tree-node');
    expand(overlay.querySelector('.tree-node'));
    const person = nodeForLabel(':person');
    expand(person);
    const score = nodeForLabel(':score');
    score.querySelector('.tree-node-summary').click();

    assert.equal(score.querySelector('.tree-node-summary').getAttribute('aria-selected'), 'true');
    assert.equal(overlay.querySelector('.tree-copy'), null, 'copy actions live in the toolbar');
    overlay.querySelector('[data-copy-selected-edn]').click();
    overlay.querySelector('[data-copy-select-expression]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(copied[0], '7');
    assert.equal(copied[1], '(get (get ($ "Foglio1!I1") :person) :score)');
    assert.equal(overlay.querySelector('.explorer-selected-path').textContent, 'Selected path: :person → :score');
    app.grid.setCellText(1, 8, copied[1]);
    assert.equal(app.session.engine.evaluate('Foglio1!I2'), 7, 'the copied expression evaluates to the selected source value');
  } finally {
    close();
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
});

test('Messages stays independent of panel visibility and renders a virtual window', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(1, 2);
  const selected = app.grid.cursor();
  for (let i = 0; i < 2105; i++) app.messages.info(`Background message ${i}`, { category: 'app' });
  await new Promise(resolve => setTimeout(resolve, 0));

  const panel = document.querySelector('#messages-panel');
  const button = document.querySelector('[data-action="toggle-messages"]');
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.querySelector('[data-message-count]').textContent, '2000 retained · 105 discarded');
  assert.ok(panel.querySelectorAll('.message-row').length < 30, 'the panel renders only a viewport and overscan');
  assert.ok(panel.textContent.includes('Background message 2104'), 'opening follows the newest messages');
  assert.deepEqual(app.grid.cursor(), selected, 'opening the panel preserves spreadsheet selection');
  app.messages.info('Follow while at bottom');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(panel.textContent.includes('Follow while at bottom'), 'new messages are followed when the reader is at the bottom');

  const list = panel.querySelector('#messages-list');
  list.scrollTop = 0;
  list.dispatchEvent(new window.Event('scroll'));
  const firstRow = panel.querySelector('.message-row');
  const firstId = firstRow.dataset.messageId;
  assert.equal(firstId, '107');
  const retainedRow = panel.querySelector('[data-message-id="112"]');
  app.messages.warn('Appended while inspecting history');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(panel.querySelector(`[data-message-id="${firstId}"]`), null, 'retention drops the oldest row');
  assert.equal(panel.querySelector('[data-message-id="112"]'), retainedRow, 'append keeps surviving visible rows and DOM nodes');
  assert.ok(panel.querySelectorAll('.message-row').length < 30);

  panel.querySelector('[data-close-messages]').click();
  assert.equal(panel.hidden, true);
  app.messages.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
  app.messages.error('Collected while hidden');
  await new Promise(resolve => setTimeout(resolve, 0));
  button.click();
  assert.ok(app.messages.getMessages().some(message => message.message === 'Collected while hidden'));
  assert.deepEqual(app.messages.getStats(), { retained: 1, discarded: 107, chars: app.messages.getStats().chars });
  const search = panel.querySelector('[data-message-search]');
  assert.doesNotMatch(panel.textContent, /Background message 2104/, 'clear releases the hidden view of the old history');
  search.value = 'Collected while hidden';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(panel.textContent.includes('Collected while hidden'), 'search can reveal messages collected while hidden');
  close();
});

test('Messages filters, expands and copies details, exports retained JSON, and clears on confirmation', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const clipboard = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async value => { clipboard.push(value); } } },
  });
  const { document, window, app, close } = await mountApp();
  try {
    app.messages.error('Evaluation failed at C2', {
      category: 'exec', source: { cell: 'Foglio1!C2' }, details: { expression: '(bad-form)' }, exception: new Error('unbound symbol'),
    });
    app.messages.warn('Missing budget', { category: 'data' });
    await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector('[data-action="toggle-messages"]').click();
    const panel = document.querySelector('#messages-panel');
    assert.deepEqual([...panel.querySelectorAll('[data-category-filter] option')].map(option => option.value), ['', 'data', 'exec']);

    panel.querySelector('[data-level="warn"]').click();
    assert.equal(panel.querySelectorAll('.message-row').length, 1);
    assert.ok(panel.textContent.includes('Evaluation failed at C2'));
    panel.querySelector('[data-level="warn"]').click();
    const category = panel.querySelector('[data-category-filter]');
    category.value = 'data';
    category.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(panel.querySelectorAll('.message-row').length, 1);
    assert.ok(panel.textContent.includes('Missing budget'));
    category.value = 'exec';
    category.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.ok(panel.textContent.includes('Evaluation failed at C2'));
    category.value = '';
    category.dispatchEvent(new window.Event('change', { bubbles: true }));
    const search = panel.querySelector('[data-message-search]');
    search.value = 'Foglio1!C2';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    const row = panel.querySelector('.message-row');
    assert.ok(row);
    assert.equal(row.querySelector('.message-level').textContent, 'ERROR');
    assert.ok(row.querySelector('.message-level').classList.contains('level-error'));
    assert.equal(row.querySelector('.message-category').textContent, 'exec');
    row.querySelector('.message-row-actions button:last-child').click();
    row.querySelector('.message-details-toggle').click();
    const expandedRow = panel.querySelector('.message-row');
    assert.equal(expandedRow.querySelector('.message-details-toggle').getAttribute('aria-expanded'), 'true');
    assert.ok(expandedRow.querySelector('.message-detail').textContent.includes('unbound symbol'));
    expandedRow.querySelector('.message-detail button').click();
    panel.querySelector('[data-copy-messages]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(clipboard[0], /Foglio1!C2/);
    assert.doesNotMatch(clipboard[0], /unbound symbol/);
    assert.match(clipboard[1], /unbound symbol/);
    assert.match(clipboard[2], /Evaluation failed at C2/);

    let exported = null, downloaded = false;
    window.URL.createObjectURL = blob => { exported = blob; return 'blob:messages-test'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function click() { downloaded = this.download === 'foglio-messages.json'; };
    panel.querySelector('[data-export-messages]').click();
    assert.ok(exported instanceof window.Blob);
    assert.equal(downloaded, true);

    const handle = panel.querySelector('#messages-resizer');
    handle.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 200 }));
    window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientY: 160 }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    assert.equal(panel.style.height, '320px');

    panel.querySelector('[data-clear-messages]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.messages.getStats().retained, 0);
    assert.equal(panel.querySelectorAll('.message-row').length, 0);
  } finally {
    close();
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
});
