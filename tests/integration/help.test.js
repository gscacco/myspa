import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../helpers/dom.js';

test('Help searches entries, copies an example, and inserts it into the ClojureScript editor', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async text => copied.push(text) } },
  });
  const { app, document, close } = await mountApp();
  try {
    const overlay = document.querySelector('#help-overlay');
    document.querySelector('[data-action="help"]').click();
    assert.equal(overlay.hidden, false);

    const search = overlay.querySelector('[data-help-search]');
    search.value = 'filter';
    search.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    const entry = overlay.querySelector('[data-help-id*="filter"]');
    assert.ok(entry, 'search results include the filter function');
    entry.click();
    const example = overlay.querySelector('.help-example').textContent;
    assert.match(example, /\(filter/);

    overlay.querySelector('[data-help-copy]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, [example]);
    assert.match(overlay.querySelector('[data-help-status]').textContent, /copiato/);

    overlay.querySelector('[data-help-insert]').click();
    assert.equal(overlay.hidden, true);
    assert.equal(document.querySelector('#fn').hidden, false);
    assert.ok(app.editor.value().includes(example));
    // The editor runs its normal delayed syntax check after text insertion.
    await new Promise(resolve => setTimeout(resolve, 450));
  } finally {
    close();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('Help closes with Escape and reopens without losing its search', async () => {
  const { document, close } = await mountApp();
  try {
    const overlay = document.querySelector('#help-overlay');
    document.querySelector('[data-action="help"]').click();
    const search = overlay.querySelector('[data-help-search]');
    search.value = 'loop';
    search.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    overlay.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(overlay.hidden, true);
    document.querySelector('[data-action="help"]').click();
    assert.equal(overlay.hidden, false);
    assert.equal(search.value, 'loop');
    assert.match(overlay.querySelector('.help-entry-button').textContent, /loop/);
  } finally {
    close();
  }
});
