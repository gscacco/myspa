import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { addItem, emptyKnowledgeBase } from '../../loom/js/model.js';
import { createLoomApp } from '../../loom/js/app.js';

const A = '550e8400-e29b-41d4-a716-446655440000';
const NOW = '2026-10-27T00:00:00.000Z';

async function mount() {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const body = '~~~clojurescript\nnil\n~~~';
  const base = addItem(emptyKnowledgeBase(), { title: 'Evaluate', body }, { id: A, now: NOW });
  const app = createLoomApp({ document: dom.window.document, window: dom.window, base });
  await app.ready;
  app.openItem(A);
  const card = dom.window.document.querySelector(`[data-item-id="${A}"]`);
  card.querySelector('[data-action="edit-snippet"]').click();
  const editor = card.querySelector('.snippet-editor');
  const textarea = editor.querySelector('textarea');
  return { app, dom, card, editor, textarea, body };
}

function evaluate(dom, textarea) {
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
  }));
}

test('Ctrl+Enter evaluates the form and shows its output in the bottom area', async () => {
  const { app, dom, editor, textarea, body } = await mount();
  const output = editor.querySelector('.snippet-evaluation');
  assert.ok(output);
  assert.equal(output.hidden, true);
  assert.equal(editor.lastElementChild.className, 'snippet-evaluation');

  textarea.value = '(+ 1 2)';
  evaluate(dom, textarea);
  assert.equal(output.hidden, false);
  assert.equal(output.querySelector('.snippet-evaluation-output').textContent, '3');
  assert.equal(app.getBase().items[0].body, body, 'manual evaluation does not apply the editor draft');

  textarea.value = '(defn greet [name] (str "Hello " name))';
  evaluate(dom, textarea);
  assert.match(output.querySelector('.snippet-evaluation-output').textContent, /Defined loom\.user\/greet/);

  textarea.value += '\n(greet "Loom")';
  evaluate(dom, textarea);
  assert.equal(output.querySelector('.snippet-evaluation-output').textContent, 'Hello Loom');

  textarea.value = '(defn greet [name] (str "Hi " name))';
  evaluate(dom, textarea);
  assert.match(output.querySelector('.snippet-evaluation-output').textContent, /Defined loom\.user\/greet/);
  textarea.value += '\n(greet "Loom")';
  evaluate(dom, textarea);
  assert.equal(output.querySelector('.snippet-evaluation-output').textContent, 'Hi Loom');
  dom.window.close();
});

test('Ctrl+Enter only evaluates when the cursor is at the end of an s-expression', async () => {
  const { dom, editor, textarea } = await mount();
  textarea.value = '(greet "Loom")';
  textarea.focus();
  textarea.setSelectionRange(4, 4);
  textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  const output = editor.querySelector('.snippet-evaluation');
  assert.equal(output.hidden, true);
  assert.match(editor.querySelector('[role="alert"]').textContent, /end of an s-expression/i);
  dom.window.close();
});

test('evaluation errors stay in the bottom output area', async () => {
  const { dom, editor, textarea } = await mount();
  textarea.value = '(missing-function)';
  evaluate(dom, textarea);
  const output = editor.querySelector('.snippet-evaluation');
  assert.equal(output.hidden, false);
  assert.match(output.textContent, /Snippet error:/);
  assert.ok(output.querySelector('[role="alert"]'));
  dom.window.close();
});
