/**
 * Helper per i test che richiedono un DOM: costruisce un documento jsdom,
 * installa i globali del browser usati dai moduli e monta l'applicazione.
 */

import { JSDOM } from 'jsdom';
import { sourceHTML } from './sample.js';

/**
 * Crea un DOM a partire da un markup HTML, senza eseguirne gli script.
 * @param {string} [html]
 */
export function domFromHTML(html = sourceHTML()) {
  return new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
}

/**
 * Rende disponibili i globali del browser usati dai moduli dell'applicazione.
 * @param {Window} window
 */
export function installGlobals(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.URL = window.URL;
  globalThis.Blob = window.Blob;
  globalThis.addEventListener = (...a) => window.addEventListener(...a);
  globalThis.confirm = () => true;
}

/**
 * Monta l'applicazione su un nuovo DOM.
 * @param {string} [html] markup da usare (per impostazione predefinita i sorgenti)
 * @returns {Promise<{dom:JSDOM,window:Window,document:Document,app:object,close:Function}>}
 */
export async function mountApp(html = sourceHTML()) {
  const dom = domFromHTML(html);
  installGlobals(dom.window);
  const { createApp } = await import('../../src/js/app.js');
  const app = createApp();
  return { dom, window: dom.window, document: dom.window.document, app, close: () => dom.window.close() };
}

/**
 * Costruisce un oggetto evento compatibile con i gestori di copia/incolla.
 * jsdom non implementa ClipboardEvent, quindi si usa un finto evento.
 */
export function fakeClipboardEvent(target) {
  const store = {};
  return {
    target,
    store,
    clipboardData: { setData: (t, v) => { store[t] = v; }, getData: t => store[t] || '' },
    preventDefault() {},
  };
}
