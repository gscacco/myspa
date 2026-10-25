/**
 * editor-assistance.js — Logica pura di supporto all'editor ClojureScript:
 * tabelle di simboli, evidenziazione a token, dichiarazioni, diagnostica di
 * sintassi, completamento e comandi paredit (slurp/barf/splice/wrap/newline).
 *
 * Modulo puro: nessun accesso al DOM. Usa `cljs.js` per leggere le forme del
 * programma (dichiarazioni e errori di sintassi).
 */

import { declarations, readError } from './cljs.js';
import { HELP_ENTRIES, SPECIAL_FORMS, SYSTEM_KEYWORDS } from './help-content.js';

/** Forme speciali e macro di ClojureScript (evidenziate come parole chiave). */
export const KEYWORDS = new Set(SPECIAL_FORMS.map(entry => entry.name));

/** Letterali. */
export const LITERALS = new Set(['nil', 'true', 'false']);

/** Funzioni incorporate del foglio di calcolo, con descrizione. */
export const SHEET_FUNCTIONS = Object.fromEntries(HELP_ENTRIES
  .filter(entry => entry.kind === 'function' && entry.category === 'Funzioni del foglio')
  .map(entry => [entry.name, entry.description]));

/** Funzioni del nucleo ClojureScript disponibili, con breve descrizione. */
export const CORE_FUNCTIONS = Object.fromEntries(HELP_ENTRIES
  .filter(entry => entry.kind === 'function' && entry.category !== 'Funzioni del foglio')
  .map(entry => [entry.name, entry.description]));

/** Nomi considerati "incorporati" per l'evidenziazione. */
export const BUILTIN_SYMBOLS = new Set([...Object.keys(CORE_FUNCTIONS), ...Object.keys(SHEET_FUNCTIONS)]);

/** Tokenizzatore per l'evidenziazione della sintassi ClojureScript. */
export const TOKEN_RE = /(;[^\n]*)|("(?:[^"\\]|\\.)*"?)|(::?[^\s()\[\]{}",;]*)|([+-]?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)|([^\s()\[\]{}",;]+)|([\s\S])/g;

/** Coppie di caratteri che si chiudono a vicenda (in ClojureScript `'` è quote). */
export const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"' };

/** Caratteri di chiusura. */
export const CLOSERS = new Set([')', ']', '}', '"']);

/** Escape HTML usato dall'evidenziazione. @param {string} t */
export const escapeHTML = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Restituisce HTML sicuro con la stessa evidenziazione usata dagli editor. */
export function highlightClojureScript(code, { declarationCode = code, matches = [] } = {}) {
  const own = new Set(extractDeclarations(declarationCode).map(x => x.n));
  return String(code).replace(TOKEN_RE, (m, c, st, kw, n, id, other, off) => {
    const t = escapeHTML(m);
    if (c) return `<i class=c>${t}</i>`;
    if (st) return `<i class=s>${t}</i>`;
    if (kw) return `<i class=k>${t}</i>`;
    if (n) return `<i class=n>${t}</i>`;
    if (id) {
      const x = KEYWORDS.has(id) ? 'k' : LITERALS.has(id) ? 'n' : own.has(id) ? 'u' : BUILTIN_SYMBOLS.has(id) ? 'b' : 0;
      return x ? `<i class=${x}>${t}</i>` : t;
    }
    return matches.includes(off) ? `<i class=m>${t}</i>` : t;
  });
}

/**
 * Estrae le dichiarazioni di primo livello (`def`, `defonce`, `defn`).
 * @param {string} code
 * @returns {{n:string,d:string,f:boolean,u:boolean}[]}
 */
export function extractDeclarations(code) {
  return declarations(code);
}

/**
 * Rileva gli errori di sintassi ClojureScript e la riga corrispondente.
 * @param {string} code
 * @returns {{msg:string,line:number}|null}
 */
export function syntaxError(code) {
  const e = readError(code);
  return e ? { msg: e.message, line: e.line } : null;
}

/**
 * Elenco completo dei candidati al completamento per un dato codice.
 * @param {string} code
 * @returns {{n:string,d:string,f?:boolean}[]}
 */
export function completionCandidates(code) {
  const decls = extractDeclarations(code);
  const byName = new Map(decls.map(candidate => [candidate.n, candidate]));
  const list = [...decls];
  const add = (n, d, f) => {
    const existing = byName.get(n);
    if (existing) {
      if (!existing.d.includes(d)) existing.d += ` · ${d}`;
      return;
    }
    const candidate = { n, d, f };
    byName.set(n, candidate);
    list.push(candidate);
  };
  HELP_ENTRIES.filter(entry => ['function', 'form', 'keyword'].includes(entry.kind))
    .forEach(entry => add(entry.name, `${entry.signature} · ${entry.description}`, entry.kind !== 'keyword'));
  LITERALS.forEach(n => add(n, 'valore letterale', false));
  SYSTEM_KEYWORDS.forEach(entry => add(entry.name, entry.description, false));
  return list;
}

/**
 * Calcola i suggerimenti di completamento (parte pura di `suggest`).
 *
 * @param {object} p
 * @param {string} p.code testo del buffer
 * @param {number} p.cursor posizione del cursore
 * @param {boolean} p.hasSelection presenza di una selezione
 * @param {boolean} [p.force] mostra anche con parola vuota (Ctrl+Spazio)
 * @returns {{list:object[], word:string}|null} `null` se non va mostrato nulla
 */
export function computeSuggestions({ code, cursor, hasSelection, force = false }) {
  const before = code.slice(0, cursor);
  const word = /[^\s()\[\]{}",;]*$/.exec(before)[0];
  if (hasSelection || (!force && !word)) return null;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const semi = line.lastIndexOf(';'), quote = line.lastIndexOf('"');
  if (semi > quote) return null;                                      // dentro un commento
  if ((line.match(/(?<!\\)"/g) || []).length % 2) return null;        // dentro una stringa
  const list = completionCandidates(code);
  const lw = word.toLowerCase();
  const out = list.filter(c => c.n.toLowerCase().startsWith(lw) && c.n !== word).slice(0, 8);
  if (!out.length) return null;
  return { list: out, word };
}

/**
 * Calcola testo e intervallo di inserimento per accettare un suggerimento.
 * In ClojureScript il simbolo viene inserito così com'è (niente parentesi).
 * @returns {{text:string,from:number,to:number,caret:number}}
 */
export function completionInsertion(candidate, code, cursor, word) {
  const from = cursor - word.length;
  return { text: candidate.n, from, to: cursor, caret: from + candidate.n.length };
}

export { indentFor, pareditSlurp, pareditBarf, pareditBackwardSlurp, pareditBackwardBarf, pareditSplice, pareditWrap, pareditNewline, safeDeletion, formBefore } from "../../shared/js/paredit.js";
