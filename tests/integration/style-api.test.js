import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../helpers/dom.js';

const cell = (document, row, column) => document.querySelector('#g').rows[row + 1].cells[column + 1];

test('ClojureScript style functions format ranges and clear them without changing cell values', async () => {
  const { app, document, close } = await mountApp();
  try {
    const before = app.session.engine.evaluate('Foglio1!A1');
    const styled = app.session.evalForm(`
      (style-range! "Foglio1!A1:B2"
        {:background "#fff2a8"
         :color "navy"
         :bold true
         :italic true
         :underline true
         :font-size 14
         :font-family "Arial, sans-serif"
         :border-color "#1d6f42"
         :border-width 2
         :border-style :dashed})`);
    assert.equal(styled.error, null);
    assert.equal(styled.value, 4);
    for (const [row, column] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const td = cell(document, row, column);
      assert.equal(td.style.backgroundColor, 'rgb(255, 242, 168)');
      assert.equal(td.style.color, 'navy');
      assert.equal(td.style.fontWeight, '700');
      assert.equal(td.style.fontStyle, 'italic');
      assert.equal(td.style.textDecoration, 'underline');
      assert.equal(td.style.fontSize, '14px');
      assert.equal(td.style.fontFamily, 'Arial, sans-serif');
      assert.equal(td.style.borderColor, 'rgb(29, 111, 66)');
      assert.equal(td.style.borderWidth, '2px');
      assert.equal(td.style.borderStyle, 'dashed');
    }
    assert.equal(app.session.engine.evaluate('Foglio1!A1'), before);

    const cleared = app.session.evalForm('(clear-range-style! "Foglio1!A1:B2")');
    assert.equal(cleared.error, null);
    assert.equal(cleared.value, 4);
    assert.equal(cell(document, 0, 0).style.backgroundColor, '');
    assert.equal(cell(document, 0, 0).style.borderWidth, '');
    assert.equal(cell(document, 0, 0).style.fontStyle, '');

    app.session.evalForm('(style-range! "B101" {:italic true})');
    assert.equal(document.querySelector('#g').rows[101].cells[1].colSpan, 26, 'styling does not eagerly expand a compact row');
    app.grid.sel(100, 0);
    assert.equal(cell(document, 100, 1).style.fontStyle, 'italic', 'a styled compact row renders when opened');
  } finally {
    close();
  }
});

test('a selection hook can style its selected cell or range using the event payload', async () => {
  const { app, document, close } = await mountApp();
  try {
    const definition = app.session.evalForm(`
      (defn highlight-selection [event]
        (let [selection (get-in event [:data :selection])]
          (style-range! (str (:sheet selection) "!" (:range selection))
            {:background "#dbeafe" :bold true :border-color "blue" :border-width 1})))`);
    assert.equal(definition.error, null);
    const registration = app.session.evalForm('(add-hook :on-selection-change highlight-selection)');
    assert.equal(registration.error, null);
    assert.equal(registration.value, true);

    app.grid.sel(2, 1);
    assert.equal(cell(document, 2, 1).style.backgroundColor, 'rgb(219, 234, 254)');
    assert.equal(cell(document, 2, 1).style.fontWeight, '700');
    assert.equal(cell(document, 2, 0).style.backgroundColor, '');
  } finally {
    close();
  }
});
