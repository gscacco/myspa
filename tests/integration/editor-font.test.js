import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../helpers/dom.js';

test('Alt plus and Alt minus adjust the ClojureScript editor font in both editor modes', async () => {
  const { app, document, window, close } = await mountApp();
  try {
    const textarea = document.querySelector('#code');
    const press = (key, code, shiftKey = false) => textarea.dispatchEvent(new window.KeyboardEvent('keydown', {
      key, code, altKey: true, shiftKey, bubbles: true, cancelable: true,
    }));

    document.querySelector('[data-action="toggle-functions"]').click();
    textarea.focus();
    const increase = new window.KeyboardEvent('keydown', {
      key: '+', code: 'Equal', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    textarea.dispatchEvent(increase);
    assert.equal(increase.defaultPrevented, true);
    assert.equal(document.documentElement.style.getPropertyValue('--code-editor-font-size'), '13.5px');
    assert.equal(document.documentElement.style.getPropertyValue('--code-editor-line-height'), '21px');

    press('-', 'Minus');
    assert.equal(document.documentElement.style.getPropertyValue('--code-editor-font-size'), '12.5px');

    app.grid.edit();
    press('-', 'Minus');
    assert.equal(document.documentElement.style.getPropertyValue('--code-editor-font-size'), '11.5px');
    app.grid.endEdit(false);

    for (let i = 0; i < 30; i++) press('+', 'Equal', true);
    assert.equal(document.documentElement.style.getPropertyValue('--code-editor-font-size'), '28px');
    for (let i = 0; i < 30; i++) press('-', 'Minus');
    assert.equal(document.documentElement.style.getPropertyValue('--code-editor-font-size'), '9px');
  } finally {
    close();
  }
});
