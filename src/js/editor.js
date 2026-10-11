/**
 * editor.js — Editor ClojureScript incorporato (gutter, evidenziazione,
 * parentesi, indentazione, popup di completamento, comandi paredit).
 *
 * Usa editor-assistance.js per la logica pura (token, dichiarazioni,
 * suggerimenti, diagnostica, paredit) e gestisce solo il DOM.
 */

import {
  TOKEN_RE, PAIRS, CLOSERS, KEYWORDS, LITERALS, BUILTIN_SYMBOLS,
  escapeHTML, extractDeclarations, syntaxError, computeSuggestions, completionInsertion,
  indentFor, pareditNewline, pareditSlurp, pareditBarf, pareditSplice, pareditWrap,
  safeDeletion, formBefore,
} from './editor-assistance.js';

/**
 * Crea e collega l'editor ClojureScript.
 * @param {object} ctx contesto applicativo con `applyCode()` e `save(as)`
 */
export function createEditor(ctx) {
  const Q = s => document.querySelector(s);
  const E = (t, a = {}, ...k) => { const e = document.createElement(t); Object.assign(e, a); e.append(...k); return e; };
  const ta = Q('#code'), hl = Q('#hl'), ln = Q('#ln'), pop = Q('#pop'), cw = Q('#cw');
  const fn = Q('#fn'), fnTitle = Q('#fn-title'), applyButton = Q('#apply-code');
  const noteEl = Q('#note');

  let errLine = 0, bm = [], ac = null, cwid = 0, chk = 0, cellEdit = null;

  function highlight() {
    const code = ta.value, own = new Set(extractDeclarations(cellEdit ? cellEdit.code : code).map(x => x.n));
    hl.innerHTML = code.replace(TOKEN_RE, (m, c, st, kw, n, id, other, off) => {
      const t = escapeHTML(m);
      if (c) return `<i class=c>${t}</i>`;
      if (st) return `<i class=s>${t}</i>`;
      if (kw) return `<i class=k>${t}</i>`;
      if (n) return `<i class=n>${t}</i>`;
      if (id) { const x = KEYWORDS.has(id) ? 'k' : LITERALS.has(id) ? 'n' : own.has(id) ? 'u' : BUILTIN_SYMBOLS.has(id) ? 'b' : 0; return x ? `<i class=${x}>${t}</i>` : t; }
      return bm.includes(off) ? `<i class=m>${t}</i>` : t;
    }) + '\n ';
    lines();
  }

  function lines() {
    const n = ta.value.split('\n').length;
    if (ln.childElementCount !== n) ln.innerHTML = Array.from({ length: n }, (_, i) => '<b>' + (i + 1) + '</b>').join('');
    const cur = ta.value.slice(0, ta.selectionStart).split('\n').length;
    [...ln.children].forEach((b, i) => b.className = (i + 1 === cur ? 'cur ' : '') + (i + 1 === errLine ? 'er' : ''));
    ln.scrollTop = ta.scrollTop;
  }

  const refresh = () => { bm = matchBr(); highlight(); };

  function setCode(v) { ta.value = v; errLine = 0; refresh(); }

  function beginCellEdit({ value, formula, address, apply }) {
    if (cellEdit) return false;
    clearTimeout(chk);
    cellEdit = {
      code: ta.value,
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      panelHidden: fn.hidden,
      title: fnTitle.textContent,
      applyLabel: applyButton.textContent,
      applyTitle: applyButton.title,
      note: noteEl.textContent,
      noteClass: noteEl.className,
      error: Q('#fe').textContent,
      errLine,
      formula: !!formula,
      apply,
    };
    fn.hidden = false;
    Q('#bfn').classList.add('on');
    fnTitle.textContent = 'Cell formula · ' + address;
    applyButton.textContent = 'Apply formula';
    applyButton.title = 'Apply this cell formula';
    ta.value = value;
    ta.dataset.formula = String(!!formula);
    errLine = 0;
    showError('', 0);
    note('');
    hidePop();
    refresh();
    ta.focus();
    return true;
  }

  function finishCellEdit(ok) {
    if (!cellEdit) return false;
    const edit = cellEdit;
    let cellValue = ta.value;
    const formula = edit.formula || /^\s*\(/.test(cellValue);
    if (formula) {
      if (cellValue.startsWith('=')) cellValue = cellValue.slice(1);
      cellValue = cellValue.trim() ? '=' + cellValue : '';
    }

    cellEdit = null;
    clearTimeout(chk);
    hidePop();
    ta.value = edit.code;
    ta.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    delete ta.dataset.formula;
    fnTitle.textContent = edit.title;
    applyButton.textContent = edit.applyLabel;
    applyButton.title = edit.applyTitle;
    fn.hidden = edit.panelHidden;
    Q('#bfn').classList.toggle('on', !edit.panelHidden);
    errLine = edit.errLine;
    Q('#fe').textContent = edit.error;
    noteEl.textContent = edit.note;
    noteEl.className = edit.noteClass;
    refresh();

    if (ok) edit.apply(cellValue);
    if (edit.panelHidden) ta.blur();
    else ta.focus();
    return true;
  }

  function matchBr() {
    const v = ta.value, p = ta.selectionStart;
    if (ta.selectionEnd !== p) return [];
    for (const i of [p - 1, p]) {
      const c = v[i], o = '([{'.indexOf(c), cl = ')]}'.indexOf(c);
      if (!c || (o < 0 && cl < 0)) continue;
      const d = o >= 0 ? 1 : -1, other = o >= 0 ? ')]}'[o] : '([{'[cl];
      let n = 0;
      for (let j = i, k = 0; j >= 0 && j < v.length && k < 20000; j += d, k++) { if (v[j] === c) n++; else if (v[j] === other && --n === 0) return [i, j]; }
      return [i];
    }
    return [];
  }

  function showError(msg, line) { errLine = line || 0; Q('#fe').textContent = msg ? (line ? 'Riga ' + line + ': ' : '') + msg : ''; lines(); }

  /** Show evaluation feedback and paredit command results. */
  function note(msg, bad) {
    if (!noteEl) return;
    noteEl.textContent = msg || '';
    noteEl.className = bad ? 'bad' : '';
  }

  /**
   * Sostituisce `[from,to)` con `t` conservando annulla/ripristina nativi
   * quando possibile. `execCommand` non è affidabile (alcuni browser
   * restituiscono true senza cambiare nulla): si verifica il risultato e in
   * caso contrario si ripiega su `setRangeText`.
   */
  function replace(t, from, to) {
    ta.focus();
    ta.setSelectionRange(from, to);
    const before = ta.value;
    let ok = false;
    try { ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, t) === true; } catch { ok = false; }
    if (ok && ta.value !== before) return;
    ta.setRangeText(t, from, to, 'end');
    ta.dispatchEvent(new Event('input'));
  }

  /** Inserimento con cursore relativo all'inizio della sostituzione. */
  function ins(t, from, to, caret) {
    replace(t, from, to);
    if (caret != null) ta.setSelectionRange(from + caret, from + caret);
    refresh();
  }

  /**
   * Applica una modifica strutturale del paredit (slurp/barf/splice/wrap),
   * conservando annulla/ripristina nativi del textarea quando il browser lo
   * consente.
   * @returns {boolean} vero se la modifica è stata applicata
   */
  function structure(r) {
    if (!r) return false;
    replace(r.text, r.from, r.to);
    if (r.caret != null) ta.setSelectionRange(r.caret, r.selEnd != null ? r.selEnd : r.caret);
    refresh();
    return true;
  }

  /** Comandi paredit disponibili: operazione e messaggio quando non si applica. */
  const PAREDIT = {
    slurp: { f: (v, a) => pareditSlurp(v, a), hint: 'nessuna forma da tirare dentro: metti il cursore nella lista (o subito dopo la sua «)») seguita da una forma' },
    barf: { f: (v, a) => pareditBarf(v, a), hint: 'niente da spingere fuori: la lista è vuota o il cursore non è in una lista' },
    splice: { f: (v, a) => pareditSplice(v, a), hint: 'nessuna lista attorno al cursore da togliere' },
    wrap: { f: (v, a, b) => pareditWrap(v, a, b), hint: 'seleziona del testo (o metti il cursore prima di una forma) per avvolgerlo in «( )»' },
  };

  /**
   * Run a paredit command at the cursor using its keyboard shortcut.
   * @param {string} name slurp|barf|splice|wrap
   */
  function command(name) {
    const op = PAREDIT[name];
    if (!op) return false;
    ta.focus();
    const ok = structure(op.f(ta.value, ta.selectionStart, ta.selectionEnd));
    hidePop();
    note(ok ? '✓ ' + name.charAt(0).toUpperCase() + name.slice(1) : name.charAt(0).toUpperCase() + name.slice(1) + ': ' + op.hint, !ok);
    return ok;
  }

  /** Applica `fn` alle righe selezionate (array di stringhe). */
  function blk(fn) {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, s = v.lastIndexOf('\n', a - 1) + 1;
    const end = b > a && v[b - 1] === '\n' ? b - 1 : b;
    let e = v.indexOf('\n', end);
    if (e < 0) e = v.length;
    const t = fn(v.slice(s, e).split('\n')).join('\n');
    ins(t, s, e);
    a === b ? ta.setSelectionRange(Math.max(s, a + t.length - (e - s)), Math.max(s, a + t.length - (e - s))) : ta.setSelectionRange(s, s + t.length);
    refresh();
  }

  /** A capo con indentazione/paredit (fra parentesi apre due righe). */
  function newline() {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    if (a !== b) { ins('\n' + ' '.repeat(indentFor(v, a)), a, b); return; }
    const r = pareditNewline(v, a);
    ins(r.text, r.from, r.to, r.caret - r.from);
  }

  const cwidth = () => cwid || (cwid = (() => {
    const x = E('span', { textContent: '0'.repeat(40) });
    x.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    cw.append(x);
    const w = x.getBoundingClientRect().width / 40;
    x.remove();
    return w;
  })());

  const hidePop = () => { ac = null; pop.hidden = true; };

  /** Ricalcola e mostra i suggerimenti (parte DOM dell'originale `suggest`). */
  function suggest(force) {
    const p = ta.selectionStart;
    const r = computeSuggestions({ code: ta.value, cursor: p, hasSelection: ta.selectionEnd !== p, force });
    if (!r) return hidePop();
    ac = { L: r.list, i: 0, w: r.word };
    popDraw();
  }

  function popDraw() {
    const before = ta.value.slice(0, ta.selectionStart), ls = before.lastIndexOf('\n') + 1;
    const row = before.split('\n').length - 1, col = before.slice(ls).replace(/\t/g, '  ').length - ac.w.length;
    pop.replaceChildren(...ac.L.map((c, i) => E('div', { className: i === ac.i ? 'on' : '', onmousedown: ev => { ev.preventDefault(); ac.i = i; accept(); } }, c.n, E('small', { textContent: ' ' + c.d }))));
    Object.assign(pop.style, { left: Math.max(0, 8 + col * cwidth() - ta.scrollLeft) + 'px', top: 8 + (row + 1) * 19 - ta.scrollTop + 'px' });
    pop.hidden = false;
  }

  function accept() {
    const c = ac.L[ac.i], p = ta.selectionStart;
    const r = completionInsertion(c, ta.value, p, ac.w);
    hidePop();
    ins(r.text, r.from, r.to, r.caret - r.from);
  }

  /** Collega gli eventi dell'editor. */
  function mount() {
    ta.addEventListener('input', () => {
      refresh();
      clearTimeout(chk);
      if (cellEdit) showError('', 0);
      else chk = setTimeout(() => { const e = syntaxError(ta.value); showError(e && e.msg, e && e.line); }, 400);
      suggest();
    });
    ta.addEventListener('scroll', () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; ln.scrollTop = ta.scrollTop; hidePop(); });
    ta.addEventListener('keyup', e => { if (/^(Arrow|Home|End|Page)/.test(e.key)) refresh(); });
    ['mouseup', 'focus'].forEach(v => ta.addEventListener(v, refresh));
    ta.addEventListener('blur', hidePop);
    ta.addEventListener('keydown', e => {
      const m = e.ctrlKey || e.metaKey, v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      if (ac) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !m) { e.preventDefault(); ac.i = (ac.i + (e.key === 'ArrowDown' ? 1 : ac.L.length - 1)) % ac.L.length; popDraw(); return; }
        if ((e.key === 'Enter' && !m) || e.key === 'Tab') { e.preventDefault(); accept(); return; }
        if (e.key === 'Escape') { e.preventDefault(); hidePop(); return; }
        if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) hidePop();
      }
      // Ctrl+Invio: valuta la sola s-exp prima del cursore (come C-x C-e di
      // Emacs, utile per ridefinire una defn o una costante def); se non c'è
      // alcuna forma da valutare applica l'intero editor.
      if (m && e.key === 'Enter') {
        e.preventDefault();
        if (cellEdit) ctx.grid.endEdit(1);
        else ctx.applyForm(formBefore(v, a));
        return;
      }
      if (m && e.code === 'Space') { e.preventDefault(); suggest(1); return; }
      if (m && e.key === '/') {
        e.preventDefault();
        blk(L => { const all = L.every(l => !l.trim() || /^\s*;/.test(l)); return L.map(l => !l.trim() ? l : all ? l.replace(/^(\s*); ?/, '$1') : l.replace(/^(\s*)/, '$1; ')); });
        return;
      }
      // Paredit keyboard commands: slurp/barf/splice/wrap.
      if (m && e.key === 'ArrowRight') { e.preventDefault(); command('slurp'); return; }
      if (m && e.key === 'ArrowLeft') { e.preventDefault(); command('barf'); return; }
      if (m && e.key === 'ArrowUp') { e.preventDefault(); command('splice'); return; }
      if (m && e.key === 'ArrowDown') { e.preventDefault(); command('wrap'); return; }
      if (e.key === 'Tab') { e.preventDefault(); a === b && !e.shiftKey ? ins('  ', a, b, 2) : blk(L => L.map(l => e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)); return; }
      if (e.key === 'Enter' && !m) { e.preventDefault(); newline(); return; }
      // Paredit prevents deletions from unbalancing delimiters; use slurp,
      // barf, or splice when the structure prevents a deletion.
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const empty = a === b;
        if (e.key === 'Backspace' && empty && PAIRS[v[a - 1]] && PAIRS[v[a - 1]] === v[a]) { e.preventDefault(); ins('', a - 1, a + 1); return; }
        const from = empty ? (e.key === 'Backspace' ? a - 1 : a) : a;
        const to = empty ? (e.key === 'Backspace' ? a : a + 1) : b;
        if (from >= 0 && to > from && !safeDeletion(v, from, to)) {
          e.preventDefault();
          note('Paredit: la cancellazione sbilancerebbe le parentesi — usa Barf (Ctrl+←), Slurp o Splice (Ctrl+↑)', true);
          return;
        }
      }
      if (!m && !e.altKey && e.key.length === 1) {
        const o = e.key;
        if (CLOSERS.has(o) && v[a] === o && a === b) { e.preventDefault(); ta.setSelectionRange(a + 1, a + 1); refresh(); return; }
        if (PAIRS[o]) {
          if (a !== b) { e.preventDefault(); ins(o + v.slice(a, b) + PAIRS[o], a, b); ta.setSelectionRange(a + 1, b + 1); refresh(); return; }
          if (!/[({\[]/.test(o) && /\w/.test(v[a - 1] || '')) return;
          e.preventDefault(); ins(o + PAIRS[o], a, b, 1);
        }
      }
    });
  }

  return {
    mount, setCode, showError, note, command, refresh, suggest, hidePop,
    beginCellEdit, finishCellEdit, isCellEditing: () => !!cellEdit,
    value: () => ta.value, node: ta,
  };
}

