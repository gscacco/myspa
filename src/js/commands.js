/**
 * commands.js — Comandi dell'applicazione: scorciatoie da tastiera, copia/
 * taglia/incolla, barra strumenti e schede dei fogli.
 *
 * Non contiene logica di calcolo: usa la sessione per le operazioni e la
 * griglia per il ridisegno.
 */

import { addr } from './references.js';
import { syntaxError } from './editor-assistance.js';
import { printCljsValue } from './scittle-runtime.js';
import { createDataExplorer } from './data-explorer.js';
import { createMessagesPanel } from './messages-panel.js';

/** Tasti che muovono la selezione. */
const KEYS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] };

function quoteTsvCell(value) {
  const text = String(value ?? '');
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseTsv(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n');
  if (!source) return [];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (quoted) {
      if (character === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === '\t') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field !== '' || row.length || !source.endsWith('\n')) { row.push(field); rows.push(row); }
  return rows;
}

function parseHtmlClipboard(html) {
  if (!html || !/<table\b/i.test(html) || !document.defaultView?.DOMParser) return null;
  const parsed = new document.defaultView.DOMParser().parseFromString(html, 'text/html');
  const table = parsed.querySelector('table');
  if (!table) return null;
  const cells = [...table.querySelectorAll('td, th')];
  const hasCellBreak = cells.some(cell => cell.querySelector('br'));
  const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children]
    .filter(child => child.matches('td, th'))
    .map(cell => {
      const copy = cell.cloneNode(true);
      copy.querySelectorAll('br').forEach(br => br.replaceWith(parsed.createTextNode('\n')));
      return copy.textContent.replace(/\u00a0/g, ' ');
    })).filter(row => row.length);
  return rows.length ? { rows, hasCellBreak } : null;
}

function sameTableShape(left, right) {
  return left.length === right.length && left.every((row, index) => row.length === right[index].length);
}

/**
 * Crea e collega i comandi dell'applicazione.
 * @param {object} ctx contesto applicativo
 */
export function createCommands(ctx) {
  const Q = s => document.querySelector(s);
  const E = (t, a = {}, ...k) => { const e = document.createElement(t); Object.assign(e, a); e.append(...k); return e; };
  let CB = null;   // appunti interni: { token, tsv, r0, c0, rows, values }
  let clipboardSequence = 0;
  const dataExplorer = createDataExplorer(ctx);
  const messagesPanel = createMessagesPanel(ctx.messages);

  const isCljsDataForm = raw => typeof raw === 'string'
    && /^(?:\{|\[|:|"|'|`|\\|#\{|true(?:\s|$)|false(?:\s|$)|nil(?:\s|$))/.test(raw.trim());

  /* ===== Selezione ===== */
  function clearSel() {
    const changed = ctx.session.clearRange(ctx.currentSheet().name, ctx.grid.rect());
    ctx.grid.paint(changed);
    ctx.grid.showCell();
    ctx.updateStatus();
  }

  function fillDown() {
    const changed = ctx.session.fillDown(ctx.currentSheet().name, ctx.grid.rect());
    ctx.grid.paint(changed);
    ctx.grid.showCell();
    ctx.updateStatus();
  }

  /** Applica una formattazione all'intervallo selezionato. */
  function fmt(k, v) {
    const list = ctx.session.formatRange(ctx.currentSheet().name, ctx.grid.rect(), k, v);
    ctx.grid.paintAddresses(list);
    ctx.updateStatus();
  }

  /* ===== Appunti ===== */
  function cp(e, cut) {
    if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const { r0, r1, c0, c1 } = ctx.grid.rect(), sheet = ctx.currentSheet(), rows = [], formulas = [], values = [], clipboardRows = [];
    for (let r = r0; r <= r1; r++) {
      const row = [], formulaRow = [], valueRow = [], clipboardRow = [];
      for (let c = c0; c <= c1; c++) {
        const address = addr(r, c), raw = sheet.cells[address]?.r, id = sheet.name + '!' + address;
        const node = ctx.session.engine.nd(id);
        let copiedValue = null, valueSource = false;
        if (node.cljs && isCljsDataForm(raw)) {
          try {
            ctx.session.engine.evaluate(id);
            copiedValue = node.cljVal;
            valueSource = true;
          } catch { /* A formula with an error is copied as source text. */ }
        }
        const source = String(raw ?? '');
        row.push(source);
        valueRow.push(valueSource ? copiedValue : undefined);
        formulaRow.push(!valueSource && !!(node.fn || node.cljs));
        clipboardRow.push(valueSource ? printCljsValue(copiedValue) : source);
      }
      rows.push(row); formulas.push(formulaRow); values.push(valueRow); clipboardRows.push(clipboardRow);
    }
    const tsv = clipboardRows.map(row => row.map(quoteTsvCell).join('\t')).join('\n');
    const token = 'foglio-' + Date.now() + '-' + (++clipboardSequence);
    CB = { token, tsv, r0, c0, rows, formulas, values };
    e.clipboardData.setData('text/plain', tsv);
    try { e.clipboardData.setData('application/x-foglio-cells', token); } catch { /* The normalized text remains a fallback. */ }
    e.preventDefault();
    if (cut) clearSel();
  }

  function paste(e) {
    if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
    e.preventDefault();
    const t = e.clipboardData.getData('text/plain');
    const html = parseHtmlClipboard(e.clipboardData.getData('text/html'));
    if (!t && !html) return;
    // Prefer the private clipboard token. Normalized text is a fallback for
    // browsers that strip custom clipboard formats.
    const normalized = t.replace(/\r\n?/g, '\n');
    const token = e.clipboardData.getData('application/x-foglio-cells');
    const same = CB && (token === CB.token || (normalized && CB.tsv.replace(/\r\n?/g, '\n') === normalized));
    let rows = same ? CB.rows.map((row, i) => row.map((raw, j) => CB.values[i][j] === undefined ? raw : printCljsValue(CB.values[i][j])))
      : parseTsv(normalized);
    if (!same && html?.hasCellBreak && !sameTableShape(rows, html.rows)) rows = html.rows;
    if (!rows.length && html) rows = html.rows;
    const targetRect = ctx.grid.rect(), { r0, c0 } = targetRect;
    const changed = ctx.session.pasteRows(ctx.currentSheet().name, r0, c0, rows, {
      internal: !!same, baseR: same ? CB.r0 : 0, baseC: same ? CB.c0 : 0,
      formulas: same ? CB.formulas : [],
      targetRect,
    });
    ctx.grid.paint(changed);
    ctx.grid.showCell();
    ctx.updateStatus();
  }

  /* ===== Fogli ===== */
  function addSheet() {
    if (ctx.grid.isEditing()) return;
    const i = ctx.session.addNewSheet();
    ctx.setSheetIndex(i);
    ctx.grid.render();
    renderTabs();
    ctx.grid.sel(0, 0);
    ctx.updateStatus();
  }

  function delSheet() {
    if (ctx.grid.isEditing()) return;
    if (!confirm('Eliminare il foglio «' + ctx.currentSheet().name + '»? Le formule che lo usano andranno in errore.')) return;
    ctx.session.deleteSheet(ctx.sheetIndex);
    ctx.setSheetIndex(0);
    ctx.rebuildAll();
    ctx.grid.sel(0, 0);
  }

  /** Ridisegna le schede dei fogli. */
  function renderTabs() {
    const wb = ctx.session.workbook;
    Q('#tabs').replaceChildren(
      ...wb.sheets.map((s, i) => E('button', {
        textContent: s.name, className: i === ctx.sheetIndex ? 'on' : '',
        onclick: () => {
          if (ctx.grid.isEditing()) return;
          ctx.setSheetIndex(i); ctx.grid.render(); renderTabs(); ctx.grid.sel(0, 0); ctx.updateStatus();
        },
      })),
      E('button', { textContent: '＋', title: 'Nuovo foglio', onclick: addSheet }),
      ...(wb.sheets.length > 1 ? [E('button', { textContent: '🗑 elimina «' + ctx.currentSheet().name + '»', onclick: delSheet })] : []),
    );
  }

  /* ===== Cronologia ===== */
  function doUndo() { if (ctx.session.undo()) ctx.afterHistory(); }
  function doRedo() { if (ctx.session.redo()) ctx.afterHistory(); }

  /** Applica il codice delle funzioni utente dall'editor. */
  function applyCode() {
    if (ctx.grid.isEditing()) { ctx.grid.endEdit(1); return; }
    const code = ctx.editor.value();
    const { error, changed } = ctx.session.applyCode(code);
    ctx.grid.paint(changed);
    ctx.grid.showCell();
    ctx.updateStatus();
    const se = error ? syntaxError(code) : null;
    ctx.editor.showError(error ? error.message : '', se ? se.line : 0);
    ctx.editor.note(error ? '' : '✓ Editor applicato e salvato nel foglio');
  }

  /** Riepilogo breve di una forma (per la nota dell'editor). */
  const brief = t => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > 42 ? s.slice(0, 41) + '…' : s; };

  /** Descrizione breve del valore prodotto dalla valutazione. */
  function describe(v) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'function') return 'ƒ' + (v.cljsName ? ' ' + v.cljsName : '');
    if (Array.isArray(v)) return '[' + v.map(x => String(x)).join(' ') + ']';
    return String(v);
  }

  /**
   * Valuta la sola forma che precede il cursore (come `C-x C-e` di Emacs): una
   * `defn` viene ridefinita, una costante `def` aggiornata, senza ricaricare
   * tutto il codice. Se non c'è alcuna forma applica l'intero editor.
   * @param {{text:string}|null} form forma da valutare (o null)
   */
  function applyForm(form) {
    if (!form) return applyCode();
    const { error, value, changed } = ctx.session.evalForm(form.text);
    if (error) {
      ctx.editor.showError(error.message, error.line || 0);
      ctx.editor.note('✗ ' + error.message, true);
      return;
    }
    ctx.grid.paint(changed);
    ctx.grid.showCell();
    ctx.updateStatus();
    ctx.editor.showError('', 0);
    ctx.editor.note('✓ ' + brief(form.text) + '  →  ' + describe(value));
  }

  /* ===== Barra strumenti ===== */
  function wireToolbar() {
    const act = (name, fn, evName = 'click') => { const el = Q('[data-action="' + name + '"]'); if (el) el.addEventListener(evName, fn); };
    act('save', () => ctx.save(false));
    act('open', () => ctx.open());
    act('undo', doUndo);
    act('redo', doRedo);
    act('toggle-bold', () => fmt('b'));
    act('dec-minus', () => fmt('d', -1));
    act('dec-plus', () => fmt('d', 1));
    act('bg-color', e => fmt('bg', e.target.value), 'input');
    act('bg-clear', () => fmt('bg', ''));
    act('toggle-flow', () => { const on = !ctx.grid.getFlowOn(); ctx.grid.setFlow(on); Q('#bflow').classList.toggle('on', on); });
    act('toggle-functions', () => {
      if (ctx.grid.isEditing()) return;
      Q('#fn').hidden = !Q('#fn').hidden;
      Q('#bfn').classList.toggle('on', !Q('#fn').hidden);
    });
    act('explore-data', () => {
      if (ctx.grid.isEditing()) { ctx.flash('Finish editing the cell before exploring its evaluated value.'); return; }
      const { r, c } = ctx.grid.cursor();
      dataExplorer.open(ctx.currentSheet().name, addr(r, c));
    });
    Q('#apply-code').addEventListener('click', applyCode);
  }

  /* ===== Scorciatoie globali ===== */
  function initKeys() {
    addEventListener('keydown', e => {
      const m = e.ctrlKey || e.metaKey, t = e.target;
      if (m && e.code === 'KeyS') { e.preventDefault(); ctx.save(e.shiftKey); return; }
      if (t.id === 'code') return;
      if (/INPUT|TEXTAREA/.test(t.tagName)) return;
      if (m && e.key === 'Enter') { e.preventDefault(); ctx.grid.edit(); return; }
      if (m && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (m && e.code === 'KeyY') { e.preventDefault(); doRedo(); }
      else if (m && e.code === 'KeyB') { e.preventDefault(); fmt('b'); }
      else if (m && e.code === 'KeyD') { e.preventDefault(); fillDown(); }
      else if (KEYS[e.key] && !m) {
        e.preventDefault();
        let [a, b] = KEYS[e.key];
        if (e.shiftKey && (e.key === 'Enter' || e.key === 'Tab')) { a = -a; b = -b; }
        const ext = e.shiftKey && e.key.startsWith('Arrow'), base = ext ? ctx.grid.selection().f : ctx.grid.selection().a;
        ctx.grid.sel(base.r + a, base.c + b, ext);
      }
      else if (e.key === 'F2') ctx.grid.edit();
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel(); }
      else if ('([{'.includes(e.key) && e.key.length === 1 && !m && !e.altKey) { e.preventDefault(); ctx.grid.edit(e.key); }
      else if (e.key === '=' && !m && !e.altKey) e.preventDefault();
      else if (e.key.length === 1 && !m && !e.altKey) ctx.grid.edit('');
    });
  }

  function init() {
    wireToolbar();
    initKeys();
    messagesPanel.init();
    addEventListener('copy', e => cp(e, 0));
    addEventListener('cut', e => cp(e, 1));
    addEventListener('paste', paste);
  }

  return { init, renderTabs, applyCode, applyForm, clearSel, fillDown, fmt, cp, paste, addSheet, delSheet, doUndo, doRedo, messagesPanel };
}

