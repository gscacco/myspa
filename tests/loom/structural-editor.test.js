import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { attachStructuralEditor } from '../../loom/js/structural-editor.js';

test('editor pairs delimiters and quotes outside strings and comments', () => {
  const dom = new JSDOM('<textarea></textarea>');
  const textarea = dom.window.document.querySelector('textarea');
  attachStructuralEditor(textarea);
  textarea.value = '(a)'; textarea.setSelectionRange(2, 2);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '[', bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '(a[])');
  assert.equal(textarea.selectionStart, 3);
  textarea.value = '; comment'; textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '"', bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '; comment', 'a comment quote is left to ordinary input');
  textarea.value = '"a"'; textarea.setSelectionRange(2, 2);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '(', bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '"a"', 'a string parenthesis is left to ordinary input');
  dom.window.close();
});

test('editor protects isolated delimiter deletion and handles paired removal', () => {
  const dom = new JSDOM('<textarea></textarea>');
  const textarea = dom.window.document.querySelector('textarea');
  attachStructuralEditor(textarea);
  textarea.value = '(a)'; textarea.setSelectionRange(1, 1);
  const blocked = new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
  textarea.dispatchEvent(blocked);
  assert.equal(blocked.defaultPrevented, true);
  assert.equal(textarea.value, '(a)');
  textarea.value = '()'; textarea.setSelectionRange(1, 1);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '');
  dom.window.close();
});

test('deletion moves across structural delimiters without removing them', () => {
  const dom = new JSDOM('<textarea></textarea>');
  const textarea = dom.window.document.querySelector('textarea');
  attachStructuralEditor(textarea);
  const source = '(a [b] {c} "d")';
  const press = (key, position) => {
    textarea.value = source; textarea.setSelectionRange(position, position);
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);
    return event;
  };
  for (let index = 0; index < source.length; index++) {
    if (')]}'.includes(source[index]) || (source[index] === '"' && index > source.indexOf('"'))) {
      const event = press('Backspace', index + 1);
      assert.equal(event.defaultPrevented, true);
      assert.equal(textarea.value, source);
      assert.equal(textarea.selectionStart, index);
    }
    if ('([{'.includes(source[index]) || (source[index] === '"' && index === source.indexOf('"'))) {
      const event = press('Delete', index);
      assert.equal(event.defaultPrevented, true);
      assert.equal(textarea.value, source);
      assert.equal(textarea.selectionStart, index + 1);
    }
  }
  dom.window.close();
});
