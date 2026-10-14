/**
 * persistence.js — Salvataggio e apertura: un solo file .html che contiene sia
 * l'applicazione sia il modello EDN del workbook.
 *
 * Il documento viene costruito clonando il DOM corrente, svuotando gli
 * elementi dinamici (`[data-dyn]`), nascondendo l'editor di funzioni (`#fn`)
 * e iniettando il modello serializzato in `#model`.
 */

import { writeEDN, readEDN } from './edn.js';
import { createWorkbook } from './model.js';

/** Tipi accettati dal selettore file nativo. */
export const FILE_TYPES = [{ description: 'Foglio di calcolo HTML', accept: { 'text/html': ['.html'] } }];
export const DATA_FILE_TYPES = [{ description: 'Dati e codice Foglio (EDN)', accept: { 'application/edn': ['.edn'] } }];

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
  const messagesPanel = h.querySelector('#messages-panel');
  messagesPanel.hidden = true;
  messagesPanel.style.height = '';
  messagesPanel.querySelector('.messages-rows').replaceChildren();
  messagesPanel.querySelector('#messages-virtual-list').style.height = '0px';
  messagesPanel.querySelector('[data-category-filter]').replaceChildren(Object.assign(doc.createElement('option'), { value: '', textContent: 'All categories' }));
  messagesPanel.querySelector('[data-message-search]').value = '';
  messagesPanel.querySelector('[data-message-count]').textContent = '0 retained · 0 discarded';
  messagesPanel.querySelector('.messages-status').textContent = '';
  messagesPanel.querySelectorAll('[data-level]').forEach(button => { button.setAttribute('aria-pressed', 'true'); button.classList.remove('off'); });
  const messagesButton = h.querySelector('#bmessages');
  messagesButton.classList.remove('on');
  messagesButton.setAttribute('aria-expanded', 'false');
  messagesButton.querySelector('#messages-badge').textContent = '0';
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

/** Legge e normalizza un workbook esportato separatamente dall'applicazione. */
export function parseWorkbookData(source) {
  const parsed = readEDN(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !Array.isArray(parsed.sheets) || parsed.sheets.length === 0
    || (parsed.name != null && typeof parsed.name !== 'string')
    || (parsed.code != null && typeof parsed.code !== 'string')
    || parsed.sheets.some(sheet => !sheet || typeof sheet.name !== 'string' || !sheet.name.trim()
      || (sheet.cells != null && (typeof sheet.cells !== 'object' || Array.isArray(sheet.cells))))) {
    throw new Error('Il file non contiene dati di un workbook Foglio validi.');
  }
  return createWorkbook(parsed);
}

/**
 * Crea il servizio di persistenza.
 * @param {object} ctx contesto applicativo con `session`, `flash`,
 *   `updateStatus`, `loadWorkbook`
 */
export function createPersistence(ctx) {
  const E = (t, a = {}) => { const e = document.createElement(t); Object.assign(e, a); return e; };
  let fh = null;

  function download(content, filename, type) {
    const view = window;
    const url = view.URL.createObjectURL(new view.Blob([content], { type }));
    const a = E('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => view.URL.revokeObjectURL(url), 1000);
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
      } else download(html, wb.name + '.html', 'text/html;charset=utf-8');
    } catch (e) {
      if (e.name === 'AbortError') return html;
      try {
        download(html, wb.name + '.html', 'text/html;charset=utf-8');
        ctx.messages?.warn('The native save failed; a download fallback was used.', {
          category: 'app', source: { operation: 'save' }, details: { reason: e.message }, exception: e,
        });
      } catch (fallbackError) {
        ctx.messages?.error('Workbook could not be saved.', {
          category: 'app', source: { operation: 'save' }, details: { reason: e.message }, exception: fallbackError,
        });
        throw fallbackError;
      }
    }
    ctx.session.markSaved();
    ctx.updateStatus();
    ctx.messages?.info('Workbook saved.', { category: 'app', source: { operation: 'save' } });
    ctx.flash('Salvato');
    return html;
  }

  /** Esporta soltanto il workbook, inclusi dati, formattazione e codice utente. */
  function exportData() {
    const wb = ctx.session.workbook;
    const edn = writeEDN(wb, 0);
    const baseName = String(wb.name || 'Foglio').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Foglio';
    download(edn, baseName + '.edn', 'application/edn;charset=utf-8');
    ctx.messages?.info('Workbook data and ClojureScript code exported.', {
      category: 'app', source: { operation: 'export' },
    });
    ctx.flash('Dati e codice esportati');
    return edn;
  }

  /** Seleziona un file EDN con i dati esportati da Foglio. */
  async function chooseDataFile() {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({ types: DATA_FILE_TYPES });
      return handle.getFile();
    }
    return new Promise((resolve, reject) => {
      const input = E('input', { type: 'file', accept: '.edn,application/edn,text/plain' });
      input.onchange = () => input.files?.[0]
        ? resolve(input.files[0])
        : reject({ name: 'AbortError' });
      input.click();
    });
  }

  /** Importa e sostituisce i dati del workbook corrente, lasciando intatta l'app. */
  async function importData() {
    try {
      const file = await chooseDataFile();
      const workbook = parseWorkbookData(await file.text());
      const editorHasDraft = !ctx.grid?.isEditing?.()
        && ctx.editor?.value?.() !== (ctx.session.workbook.code || '');
      if ((ctx.session.isModified() || editorHasDraft)
        && !confirm('Ci sono modifiche non salvate. Sostituire il workbook con i dati importati?')) return null;
      ctx.loadWorkbook(workbook);
      ctx.messages?.info('Workbook data and ClojureScript code imported.', {
        category: 'app', source: { operation: 'import' }, details: { file: file.name || '' },
      });
      ctx.flash('Dati e codice importati');
      return workbook;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      ctx.messages?.error('Workbook data could not be imported.', {
        category: 'app', source: { operation: 'import' }, details: { reason: error.message }, exception: error,
      });
      ctx.flash('Importazione non riuscita: ' + error.message);
      return null;
    }
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
      ctx.messages?.info('Workbook loaded.', { category: 'app', source: { operation: 'open' } });
    } catch (e) {
      if (e.name !== 'AbortError') {
        ctx.messages?.error('Workbook could not be opened.', {
          category: 'app', source: { operation: 'open' }, details: { reason: e.message }, exception: e,
        });
        ctx.flash('Apertura non riuscita: ' + e.message);
      }
    }
  }

  /** Avvisa in caso di modifiche non salvate. */
  function init() {
    addEventListener('beforeunload', e => { if (ctx.session.isModified()) { e.preventDefault(); e.returnValue = ''; } });
  }

  return { save, open, exportData, importData, init, download, build: () => buildDocument(document, ctx.session.workbook) };
}
