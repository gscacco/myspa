/**
 * persistence.js — Salvataggio e apertura: un solo file .html che contiene sia
 * l'applicazione sia il modello EDN del workbook.
 *
 * Il documento viene costruito clonando il DOM corrente, svuotando gli
 * elementi dinamici (`[data-dyn]`), nascondendo l'editor di funzioni (`#fn`)
 * e iniettando il modello serializzato in `#model`.
 */

import { writeEDN, readEDN } from './edn.js';

/** Tipi accettati dal selettore file nativo. */
export const FILE_TYPES = [{ description: 'Foglio di calcolo HTML', accept: { 'text/html': ['.html'] } }];

/**
 * Costruisce il documento HTML standalone.
 * @param {Document} doc documento corrente
 * @param {object} wb workbook da serializzare
 * @returns {string}
 */
export function buildDocument(doc, wb) {
  const h = doc.documentElement.cloneNode(true);
  h.querySelectorAll('[data-dyn]').forEach(e => e.replaceChildren());
  h.querySelector('#fn').hidden = true;
  h.querySelector('#model').textContent = '\n' + writeEDN(wb, 0) + '\n';
  h.querySelector('title').textContent = wb.name;
  return '<!doctype html>\n' + h.outerHTML;
}

/**
 * Estrae il testo EDN del modello da un documento HTML.
 * @param {string} html
 * @returns {string}
 */
export function extractModel(html) {
  const m = /id="model">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw Error('non è un foglio di questo editor');
  return m[1];
}

/**
 * Crea il servizio di persistenza.
 * @param {object} ctx contesto applicativo con `session`, `flash`,
 *   `updateStatus`, `loadWorkbook`
 */
export function createPersistence(ctx) {
  const E = (t, a = {}) => { const e = document.createElement(t); Object.assign(e, a); return e; };
  let fh = null;

  function download(html) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = E('a', { href: url, download: ctx.session.workbook.name + '.html' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Salva il documento.
   * @param {boolean} [as] true per "salva con nome"
   * @returns {Promise<string>} l'HTML generato
   */
  async function save(as) {
    const wb = ctx.session.workbook;
    const html = buildDocument(document, wb);
    try {
      if (window.showSaveFilePicker) {
        if (!fh || as) fh = await window.showSaveFilePicker({ suggestedName: wb.name + '.html', types: FILE_TYPES });
        const w = await fh.createWritable();
        await w.write(html);
        await w.close();
      } else download(html);
    } catch (e) {
      if (e.name === 'AbortError') return html;
      download(html);
    }
    ctx.session.markSaved();
    ctx.updateStatus();
    ctx.flash('Salvato');
    return html;
  }

  /** Apre un documento HTML e ne carica il modello. */
  async function open() {
    if (ctx.session.isModified() && !confirm('Ci sono modifiche non salvate. Continuare?')) return;
    try {
      let h = null, f;
      if (window.showOpenFilePicker) {
        [h] = await window.showOpenFilePicker({ types: FILE_TYPES });
        f = await h.getFile();
      } else {
        f = await new Promise((ok, ko) => {
          const i = E('input', { type: 'file', accept: '.html,text/html' });
          i.onchange = () => i.files[0] ? ok(i.files[0]) : ko({ name: 'AbortError' });
          i.click();
        });
      }
      const wb = readEDN(extractModel(await f.text()));
      fh = h;
      ctx.loadWorkbook(wb);
    } catch (e) {
      if (e.name !== 'AbortError') ctx.flash('Apertura non riuscita: ' + e.message);
    }
  }

  /** Avvisa in caso di modifiche non salvate. */
  function init() {
    addEventListener('beforeunload', e => { if (ctx.session.isModified()) { e.preventDefault(); e.returnValue = ''; } });
  }

  return { save, open, init, download, build: () => buildDocument(document, ctx.session.workbook) };
}
