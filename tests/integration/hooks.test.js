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

test('cell hooks report committed sources, changed SCI values, dependency recalculation, and evaluation errors', async () => {
  const { app, document, close } = await mountApp();
  try {
    const registration = app.session.evalForm(`
      (add-hook :on-cell-source-change
        (fn [event]
          (let [data (:data event)]
            (log! :info
              (str "source|" (:cell data) "|" (pr-str (:old-source data)) "->" (pr-str (:new-source data))
                   "|" (:event event) "|" (:source event) "|" (string? (:timestamp event)))
              {:category :data}))))
      (add-hook :on-cell-value-change
        (fn [event]
          (let [data (:data event)
                old-value (:old-value data)
                new-value (:new-value data)]
            (log! :info
              (str "value|" (:cell data) "|"
                   (if (:previous-value-available? data)
                     (str (pr-str old-value) "->" (pr-str new-value)
                          "|old-keyword=" (keyword? old-value)
                          "|new-string=" (string? new-value)
                          "|old-vector=" (vector? old-value)
                          "|new-vector=" (vector? new-value))
                     (str "initial=" (pr-str new-value))))
              {:category :data}))))
      (add-hook :on-cell-evaluation-error
        (fn [event]
          (log! :warn
            (str "error|" (get-in event [:data :cell]) "|"
                 (get-in event [:data :expression]) "|"
                 (get-in event [:data :error :message]))
            {:category :data})))`);
    assert.equal(registration.error, null);

    app.grid.sel(4, 25);
    app.grid.edit();
    document.querySelector('#code').value = ':intermediate';
    assert.equal(app.messages.getMessages().length, 0, 'typing before commit does not emit cell events');
    app.grid.endEdit(false);
    app.grid.edit();
    document.querySelector('#code').value = '42';
    app.grid.endEdit(true);
    let logs = app.messages.getMessages().filter(message => message.category === 'data').map(message => message.message);
    assert.ok(logs.includes('source|Foglio1!Z5|nil->42|:on-cell-source-change|:cell|true'));
    assert.ok(logs.includes('value|Foglio1!Z5|initial=42'));

    app.session.setCell('Foglio1', 0, 25, ':active');
    app.session.setCell('Foglio1', 1, 25, '(vector Z1)');
    app.messages.clear();
    app.session.setCell('Foglio1', 0, 25, '"active"');

    logs = app.messages.getMessages().filter(message => message.category === 'data').map(message => message.message);
    assert.ok(logs.includes('source|Foglio1!Z1|\":active\"->\"\\\"active\\\"\"|:on-cell-source-change|:cell|true'));
    assert.ok(logs.includes('value|Foglio1!Z1|:active->"active"|old-keyword=true|new-string=true|old-vector=false|new-vector=false'));
    assert.ok(logs.includes('value|Foglio1!Z2|[:active]->["active"]|old-keyword=false|new-string=false|old-vector=true|new-vector=true'));
    assert.equal(app.session.engine.evaluate('Foglio1!Z2')[0], 'active');

    app.messages.clear();
    app.session.setCell('Foglio1', 0, 25, '"active"');
    assert.equal(app.messages.getMessages().length, 0, 'committing the identical source emits no source or value event');

    app.session.setCell('Foglio1', 2, 25, '(throw (js/Error. "broken cell"))');
    app.session.setCell('Foglio1', 3, 25, '(+ Z3 1)');
    app.session.setCell('Foglio1', 4, 25, '(+ Z4 1)');
    logs = app.messages.getMessages().filter(message => message.category === 'data').map(message => message.message);
    const errors = logs.filter(message => message.startsWith('error|'));
    assert.equal(errors.length, 1, 'the dependent error does not emit a duplicate notification');
    assert.match(errors[0], /^error\|Foglio1!Z3\|\(throw \(js\/Error\. "broken cell"\)\)\|broken cell$/);
    assert.equal(logs.some(message => ['Z3', 'Z4', 'Z5'].some(address => message.startsWith(`value|Foglio1!${address}|`))), false);
  } finally {
    close();
  }
});
