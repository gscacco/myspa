/**
 * app.js — Radice di composizione: legge il modello EDN iniziale dal documento,
 * crea la sessione e collega vista, editor, comandi e persistenza.
 *
 * Esporta `createApp()` per poter montare l'applicazione su un documento
 * qualsiasi (usato dai test di integrazione). `main.js` è il punto di ingresso
 * del browser e si limita a chiamare `createApp()`.
 */

import { readEDN } from './edn.js';
import { createWorkbook } from './model.js';
import { createSession } from './workbook.js';
import { createGrid } from './grid.js';
import { createEditor } from './editor.js';
import { createCommands } from './commands.js';
import { createPersistence } from './persistence.js';
import { syntaxError } from './editor-assistance.js';

/**
 * Monta l'applicazione sul documento corrente.
 * @returns {object} il contesto applicativo
 */
export function createApp() {
  const modelEl = document.querySelector('#model');
  const session = createSession(createWorkbook(readEDN(modelEl.textContent)));

  let ci = 0;
  let note = '';

  /** Contesto condiviso fra i moduli della vista. */
  const ctx = {
    session,
    grid: null,
    editor: null,
    commands: null,
    save: null,
    open: null,
    applyCode: null,
    applyForm: null,
    loadWorkbook: null,
    afterHistory: null,
    rebuildAll: null,
    get sheetIndex() { return ci; },
    setSheetIndex(v) { ci = v; },
    currentSheet() { return session.workbook.sheets[ci]; },
    updateStatus() {
      document.querySelector('#stat').textContent = note || ((session.isModified() ? '● modificato · ' : '') + session.workbook.name);
    },
    flash(t) { note = t; ctx.updateStatus(); setTimeout(() => { note = ''; ctx.updateStatus(); }, 2000); },
  };

  /** Ricarica il codice utente nell'editor e ne mostra gli eventuali errori. */
  function refreshEditor() {
    const code = session.workbook.code || '';
    const err = session.engine.setCode(code);
    ctx.editor.setCode(code);
    const se = err ? syntaxError(code) : null;
    ctx.editor.showError(err ? err.message : '', se ? se.line : 0);
  }

  /** Ricostruisce griglia, schede e stato dopo un cambio di workbook/foglio. */
  function rebuildAll() {
    ctx.grid.rebuild();
    ctx.commands.renderTabs();
    ctx.updateStatus();
  }

  /** Sostituisce il workbook corrente (apertura file). */
  function loadWorkbook(wb) {
    session.replace(wb);
    ci = 0;
    refreshEditor();
    rebuildAll();
    ctx.grid.sel(0, 0);
  }

  /** Ripristina la vista dopo annulla/ripristina. */
  function afterHistory() {
    refreshEditor();
    rebuildAll();
  }

  const grid = createGrid(ctx);
  const editor = createEditor(ctx);
  ctx.grid = grid;
  ctx.editor = editor;

  const persistence = createPersistence(ctx);
  ctx.save = as => persistence.save(as);
  ctx.open = () => persistence.open();

  const commands = createCommands(ctx);
  ctx.commands = commands;
  ctx.applyCode = () => commands.applyCode();
  ctx.applyForm = form => commands.applyForm(form);
  ctx.rebuildAll = rebuildAll;
  ctx.afterHistory = afterHistory;
  ctx.loadWorkbook = loadWorkbook;

  grid.mount();
  editor.mount();
  commands.init();
  persistence.init();
  refreshEditor();
  rebuildAll();
  grid.sel(0, 0);

  return ctx;
}
