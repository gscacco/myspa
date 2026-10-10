/**
 * editor-assistance.js — Logica pura di supporto all'editor ClojureScript:
 * tabelle di simboli, evidenziazione a token, dichiarazioni, diagnostica di
 * sintassi, completamento e comandi paredit (slurp/barf/splice/wrap/newline).
 *
 * Modulo puro: nessun accesso al DOM. Usa `cljs.js` per leggere le forme del
 * programma (dichiarazioni e errori di sintassi).
 */

import { declarations, readError } from './cljs.js';

/** Forme speciali e macro di ClojureScript (evidenziate come parole chiave). */
export const KEYWORDS = new Set('def defonce defn defn- fn let if when when-not cond and or do -> ->> quote comment ns loop recur try catch'.split(' '));

/** Letterali. */
export const LITERALS = new Set(['nil', 'true', 'false']);

/** Funzioni incorporate del foglio di calcolo, con descrizione. */
export const SHEET_FUNCTIONS = {
  SUM: 'somma di numeri e matrici',
  AVG: 'media',
  AVERAGE: 'media',
  MIN: 'minimo',
  MAX: 'massimo',
  COUNT: 'quanti numeri',
  ROUND: '(x, decimali)',
  IF: '(cond, a, b)',
};

/** Funzioni del nucleo ClojureScript disponibili, con breve descrizione. */
export const CORE_FUNCTIONS = {
  '+': 'somma', '-': 'differenza', '*': 'prodotto', '/': 'divisione',
  'mod': 'modulo', 'rem': 'resto', 'inc': 'incrementa', 'dec': 'decrementa',
  'min': 'minimo', 'max': 'massimo',
  '=': 'uguale', 'not=': 'diverso', '<': 'minore', '<=': 'minore o uguale',
  '>': 'maggiore', '>=': 'maggiore o uguale',
  'not': 'negazione logica',
  'nil?': 'è nil', 'some?': 'non è nil', 'number?': 'è un numero', 'string?': 'è una stringa',
  'boolean?': 'è un booleano', 'fn?': 'è una funzione', 'vector?': 'è un vettore',
  'map?': 'è una mappa', 'empty?': 'è vuoto', 'zero?': 'è zero', 'pos?': 'è positivo',
  'neg?': 'è negativo', 'even?': 'è pari', 'odd?': 'è dispari',
  'str': 'concatena in stringa', 'count': 'numero di elementi', 'get': '(coll chiave)',
  'nth': '(coll indice)', 'first': 'primo elemento', 'second': 'secondo elemento',
  'last': 'ultimo elemento', 'rest': 'elementi dopo il primo', 'next': 'come rest, nil se vuoto',
  'vec': 'converte in vettore', 'vector': 'crea un vettore', 'list': 'crea una lista',
  'hash-map': 'crea una mappa', 'conj': 'aggiunge a una collezione', 'assoc': 'associa chiavi',
  'dissoc': 'rimuove chiavi', 'merge': 'unisce mappe', 'keys': 'chiavi', 'vals': 'valori',
  'contains?': 'contiene la chiave?', 'into': 'versa in una collezione', 'concat': 'concatena sequenze',
  'flatten': 'appiattisce le matrici', 'map': '(f coll …) applica', 'filter': '(pred coll) filtra',
  'remove': '(pred coll) scarta', 'reduce': '(f init coll) riduce', 'apply': '(f coll) spande',
  'range': 'sequenza di numeri', 'sort': 'ordina', 'sort-by': 'ordina per chiave',
  'reverse': 'inverte', 'take': '(n coll)', 'drop': '(n coll)', 'some': 'almeno uno',
  'every?': 'tutti', 'upper-case': 'maiuscole', 'lower-case': 'minuscole', 'trim': 'toglie spazi',
  'subs': '(s da a) sottostringa', 'split': '(s re) divide', 'join': '(sep coll) unisce',
  'replace': '(s a b) sostituisce',
  'abs': 'valore assoluto', 'sqrt': 'radice quadrata', 'pow': '(x n) potenza',
  'floor': 'arrotonda in giù', 'ceil': 'arrotonda in su', 'round': 'arrotonda',
  'trunc': 'parte intera', 'exp': 'esponenziale', 'log': 'logaritmo naturale', 'log10': 'logaritmo decimale',
  'sin': 'seno', 'cos': 'coseno', 'tan': 'tangente', 'PI': 'pigreco', 'E': 'numero di Eulero',
  'println': 'stampa una riga', 'prn': 'stampa un valore',
};

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
  const seen = new Set(decls.map(x => x.n));
  const list = [...decls];
  const add = (n, d, f) => { if (!seen.has(n)) { seen.add(n); list.push({ n, d, f }); } };
  Object.entries(SHEET_FUNCTIONS).forEach(([n, d]) => add(n, d, true));
  Object.entries(CORE_FUNCTIONS).forEach(([n, d]) => add(n, d, true));
  KEYWORDS.forEach(n => add(n, 'forma speciale', true));
  LITERALS.forEach(n => add(n, 'letterale', false));
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

/* ===== Paredit (modifica strutturale delle s-espressioni) ===== */

const OPENERS = '([{';
const CLOSERS_S = ')]}';

/** Salta una stringa a partire dalla virgoletta, restituendo l'indice dopo la chiusura. */
function skipStr(text, i) {
  i++;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    i++;
  }
  return i;
}

/** Primo indice non bianco/commento da `i` (senza superare `end`). */
function skipWS(text, i, end = text.length) {
  while (i < end) {
    const c = text[i];
    if (c === ';') { while (i < end && text[i] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') { i++; continue; }
    break;
  }
  return i;
}

/** Indice della parentesi di chiusura che pareggia quella in `i`, oppure -1. */
function matchAt(text, i) {
  const open = text[i];
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  if (!close) return -1;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '"') { j = skipStr(text, j) - 1; continue; }
    if (c === ';') { while (j < text.length && text[j] !== '\n') j++; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j;
  }
  return -1;
}

/** Indice (esclusivo) di fine della forma che inizia in `i`, oppure `null`. */
function formEnd(text, i) {
  const c = text[i];
  if (c === undefined) return null;
  if (c === '"') return skipStr(text, i);
  if (OPENERS.includes(c)) { const m = matchAt(text, i); return m < 0 ? null : m + 1; }
  let j = i;
  while (j < text.length && !/[\s,()\[\]{}";]/.test(text[j])) j++;
  return j === i ? i + 1 : j;
}

/** Coppie di parentesi bilanciate presenti nel testo. */
function pairs(text) {
  const out = [], stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipStr(text, i) - 1; continue; }
    if (c === ';') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (OPENERS.includes(c)) stack.push({ i, c });
    else if (CLOSERS_S.includes(c) && stack.length) {
      const t = stack.pop();
      out.push({ open: t.i, close: i, oc: t.c, cc: c });
    }
  }
  return out;
}

/**
 * Lista più interna che racchiude la posizione del cursore. Vale anche la lista
 * la cui chiusura sta immediatamente prima del cursore (`(a b)| c`): è la lista
 * "corrente" su cui agiscono slurp/barf/splice, come in Emacs.
 */
function enclosingPair(text, pos) {
  let best = null;
  for (const p of pairs(text)) {
    const inside = p.open < pos && pos <= p.close;
    const justClosed = p.close + 1 === pos;
    if ((inside || justClosed) && (!best || p.open > best.open)) best = p;
  }
  return best;
}

/** Forme di primo livello comprese fra `from` e `to`. */
function topForms(text, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    i = skipWS(text, i, to);
    if (i >= to) break;
    const e = formEnd(text, i);
    if (e === null || e > to) break;
    out.push({ start: i, end: e });
    i = e;
  }
  return out;
}

/** Indentazione (2 spazi per livello) appropriata alla posizione indicata. */
export function indentFor(text, pos) {
  let depth = 0;
  for (let i = 0; i < pos; i++) {
    const c = text[i];
    if (c === '"') { i = skipStr(text, i) - 1; continue; }
    if (c === ';') { while (i < pos && text[i] !== '\n') i++; continue; }
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS_S.includes(c)) depth = Math.max(0, depth - 1);
  }
  return depth * 2;
}

/**
 * Slurp in avanti: tira la forma successiva dentro la lista corrente.
 * `(a b) c` -> `(a b c)`
 */
export function pareditSlurp(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const start = skipWS(text, p.close + 1);
  if (start >= text.length) return null;
  const end = formEnd(text, start);
  if (end === null) return null;
  return { from: p.close, to: end, text: text.slice(p.close + 1, end) + p.cc, caret: pos };
}

/**
 * Barf in avanti: spinge l'ultima forma fuori dalla lista corrente.
 * `(a b c)` -> `(a b) c`
 */
export function pareditBarf(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const forms = topForms(text, p.open + 1, p.close);
  if (!forms.length) return null;
  const last = forms[forms.length - 1];
  const prevEnd = forms.length > 1 ? forms[forms.length - 2].end : p.open + 1;
  const region = p.cc + ' ' + text.slice(last.start, p.close).replace(/\s+$/, '');
  return { from: prevEnd, to: p.close + 1, text: region, caret: Math.min(pos, prevEnd + region.length) };
}

/**
 * Splice: elimina le parentesi della lista corrente, fondendone il contenuto.
 * `(a b c)` -> `a b c`
 */
export function pareditSplice(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const caret = Math.max(p.open, pos - 1);
  return { from: p.open, to: p.close + 1, text: text.slice(p.open + 1, p.close), caret };
}

/**
 * Wrap: avvolge la selezione (o la forma successiva) in una lista.
 * `a b` -> `(a) b`
 */
export function pareditWrap(text, from, to) {
  let a = from, b = to;
  if (a === b) {
    a = skipWS(text, a);
    if (a >= text.length) return null;
    const e = formEnd(text, a);
    if (e === null) return null;
    b = e;
  } else {
    b = skipWS(text, b - 1, b) + 1;
  }
  return { from: a, to: b, text: '(' + text.slice(a, b) + ')', caret: a + 1, selEnd: b + 1 };
}

/**
 * A capo con indentazione strutturale: fra `(` e `)` apre due righe.
 * @returns {{from:number,to:number,text:string,caret:number}}
 */
export function pareditNewline(text, pos) {
  const before = text[pos - 1], after = text[pos];
  if (before && OPENERS.includes(before) && after && CLOSERS_S.includes(after) && matchAt(text, pos - 1) === pos) {
    const outer = indentFor(text, pos - 1), inner = outer + 2;
    const ins = '\n' + ' '.repeat(inner) + '\n' + ' '.repeat(outer);
    const caret = pos + 1 + inner;
    return { from: pos, to: pos, text: ins, caret };
  }
  const ins = '\n' + ' '.repeat(indentFor(text, pos));
  return { from: pos, to: pos, text: ins, caret: pos + ins.length };
}

/* ===== Simmetria delle parentesi e forma sotto il cursore ===== */

/** Delimitatori di lista usati per il controllo di simmetria. */
const OPEN_RE = /[(\[{]/;
const CLOSE_RE = /[\])}]/;

/**
 * Vero se cancellare `text[from,to)` lascia le parentesi **simmetriche**.
 * Una sola parentesi o una forma tagliata a metà sbilancerebbero il testo: in
 * quel caso paredit non cancella e si usano barf/splice. Cancellare invece un
 * blocco già bilanciato (anche una lista intera) è consentito.
 * @param {string} text
 * @param {number} from
 * @param {number} to
 */
export function safeDeletion(text, from, to) {
  if (from >= to) return true;
  const region = text.slice(from, to);
  let depth = 0, quotes = 0, inStr = false;
  for (let i = 0; i < region.length; i++) {
    const c = region[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') { inStr = !inStr; quotes++; continue; }
    if (inStr) continue;                          // i delimitatori nelle stringhe non contano
    if (OPEN_RE.test(c)) depth++;
    else if (CLOSE_RE.test(c)) depth--;
  }
  return depth === 0 && quotes % 2 === 0;
}

/**
 * Ultima s-expression **completa** che termina entro la posizione indicata
 * (come `C-x C-e` di Emacs): considera le forme annidate, ignora commenti e
 * spazi e non restituisce nulla se il cursore è dentro una forma incompleta.
 * @param {string} text
 * @param {number} pos
 * @returns {{from:number,to:number,text:string}|null} `null` se non c'è una forma
 */
export function formBefore(text, pos) {
  const limit = Math.min(pos, text.length);
  const isDelim = c => /[\s,()\[\]{}";]/.test(c);
  const stack = [];
  let last = null;
  let i = 0;
  const remember = (from, to) => {
    if (to <= limit && (!last || to > last.to)) last = { from, to, text: text.slice(from, to) };
  };
  while (i < limit) {
    const c = text[i];
    if (c === ';') { while (i < limit && text[i] !== '\n') i++; continue; }
    if (c === '"') { const e = skipStr(text, i); if (e <= limit) remember(i, e); i = Math.min(e, limit); continue; }
    if (OPENERS.includes(c)) { stack.push(i); i++; continue; }
    if (CLOSERS_S.includes(c)) {
      const o = stack.pop();
      if (o !== undefined && text[o] === OPENERS[CLOSERS_S.indexOf(c)]) remember(o, i + 1);
      i++; continue;
    }
    if (isDelim(c)) { i++; continue; }
    let j = i;
    while (j < limit && !isDelim(text[j])) j++;
    if (j === limit && j < text.length && !isDelim(text[j])) { i = j; continue; }   // atomo a cavallo del cursore
    remember(i, j);
    i = j;
  }
  return last;
}

