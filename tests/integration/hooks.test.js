import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../helpers/dom.js';

test('ClojureScript selection hooks receive changed cell and range selections and can log to Messages', async () => {
  const { app, close } = await mountApp();
  try {
    assert.equal(app.hooks.list(':on-selection-change').length, 0, 'startup does not emit an initial selection event');
    const registration = app.session.evalForm(`
      (def selection-hook
        (fn [event]
          (log! :info
            (str (get-in event [:data :previous-selection :range])
                 " -> "
                 (get-in event [:data :selection :range])))))
      (add-hook :on-selection-change
        (fn [_event] (throw (js/Error. "Deliberate hook failure"))))
      (add-hook :on-selection-change selection-hook)`);
    assert.equal(registration.error, null);
    assert.equal(app.session.evalForm('(count (list-hooks))').value, 2);
    assert.equal(app.session.evalForm('(add-hook :on-selection-change selection-hook)').value, false);

    app.grid.sel(0, 1);
    app.grid.sel(0, 1);
    app.grid.sel(1, 1, true);
    const messages = app.messages.getMessages().filter(message => message.category === 'exec');
    assert.deepEqual(messages.map(message => message.message), ['A1 -> B1', 'B1 -> B1:B2']);
    assert.equal(messages[0].level, 'info');
    const hookErrors = app.messages.getMessages().filter(message => message.category === 'hooks');
    assert.equal(hookErrors.length, 2, 'the failing hook is isolated and reported on both changed selections');
    assert.match(hookErrors[0].message, /Deliberate hook failure/);
  } finally {
    close();
  }
});
