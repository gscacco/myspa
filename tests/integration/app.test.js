import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp, fakeClipboardEvent } from '../helpers/dom.js';

/** Shortcut: zero-based cell coordinates (r,c). */
const cell = (document, r, c) => document.querySelector('#g').rows[r + 1].cells[c + 1];
const mouse = (window, type, el) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
const key = (window, el, init) => el.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }));

test('startup builds the grid and calculates cell values', async () => {
  const { document, close } = await mountApp();
  const G = document.querySelector('#g');
  assert.equal(G.rows.length, 101);
  assert.equal(G.rows[0].cells.length, 27);
  assert.equal(G.rows[0].cells[1].textContent, 'A');
  assert.equal(G.rows[0].cells[26].textContent, 'Z');
  assert.equal(G.rows[1].cells[1].textContent, 'Prodotto');
  assert.equal(cell(document, 1, 1).textContent, '1.50');
  assert.equal(cell(document, 1, 3).textContent, '150.00');
  assert.equal(cell(document, 1, 4).textContent, '183.00');
  assert.equal(cell(document, 5, 3).textContent, '843.80');
  assert.equal(cell(document, 5, 4).textContent, '1029.44');
  assert.equal(cell(document, 8, 3).textContent, 'Bassa');
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
  const { document, app, close } = await mountApp();
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

test('the formula editor stays open until Ctrl+Enter or the apply button', async () => {
  const { document, window, app, close } = await mountApp();
  app.grid.sel(9, 8);
  app.grid.edit();
  const ed = document.querySelector('#code');
  ed.value = '(+ 2 3)';
  ed.setSelectionRange(ed.value.length, ed.value.length);

  ed.dispatchEvent(new window.FocusEvent('blur'));
  assert.equal(document.querySelector('#fn').hidden, false);
  key(window, ed, { key: 'Escape' });
  assert.equal(document.querySelector('#fn').hidden, false);
  key(window, ed, { key: 'Tab' });
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
  assert.deepEqual([...document.querySelectorAll('#fn button')].map(button => button.id), ['apply-code']);
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
  const e2 = fakeClipboardEvent(document.body);
  e2.clipboardData.setData('text/plain', e1.store['text/plain']);
  app.commands.paste(e2);
  assert.equal(cell(document, 6, 2).textContent, 'Prodotto');
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
  const { document, window, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 5, 3));
  assert.ok(document.querySelectorAll('#g td.pre').length > 0);
  mouse(window, 'click', document.querySelector('[data-action="toggle-flow"]'));
  assert.equal(document.querySelectorAll('#g td.pre').length, 0);
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
  assert.equal(pressKey({ key: 'Backspace' }).defaultPrevented, true, 'the closing «)» is protected');
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


