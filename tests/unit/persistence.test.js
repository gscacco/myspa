import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { domFromHTML } from '../helpers/dom.js';
import { workbook } from '../helpers/sample.js';
import { buildDocument } from '../../src/js/persistence.js';

test('standalone workbook export resets transient Messages state and history', () => {
  const dom = domFromHTML();
  const { document } = dom.window;
  const panel = document.querySelector('#messages-panel');
  panel.hidden = false;
  panel.querySelector('.messages-rows').innerHTML = '<article>private diagnostic</article>';
  panel.querySelector('[data-category-filter]').add(new dom.window.Option('secret-category', 'secret'));
  panel.querySelector('[data-category-filter]').value = 'secret';
  panel.querySelector('[data-message-search]').value = 'private';
  panel.querySelector('[data-message-count]').textContent = '1 retained · 3 discarded';
  panel.querySelector('.messages-status').textContent = 'Copied private diagnostic';
  const button = document.querySelector('#bmessages');
  button.classList.add('on');
  button.setAttribute('aria-expanded', 'true');
  button.querySelector('#messages-badge').textContent = '1';

  const html = buildDocument(document, workbook());
  const saved = new JSDOM(html).window.document;
  assert.equal(saved.querySelector('#messages-panel').hidden, true);
  assert.equal(saved.querySelector('.messages-rows').children.length, 0);
  assert.equal(saved.querySelector('[data-category-filter]').options.length, 1);
  assert.equal(saved.querySelector('[data-message-search]').value, '');
  assert.equal(saved.querySelector('[data-message-count]').textContent, '0 retained · 0 discarded');
  assert.equal(saved.querySelector('.messages-status').textContent, '');
  assert.equal(saved.querySelector('#bmessages').getAttribute('aria-expanded'), 'false');
  assert.equal(saved.querySelector('#messages-badge').textContent, '0');
  assert.doesNotMatch(html, /private diagnostic|secret-category/);
  dom.window.close();
});
