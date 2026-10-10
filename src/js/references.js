/**
 * references.js — Indirizzi di cella, riferimenti tra fogli e utilità sui
 * riferimenti usati nelle formule.
 *
 * Modulo puro: non dipende dal DOM né dal motore di calcolo.
 */

/**
 * Nome di colonna (0 -> "A", 25 -> "Z", 26 -> "AA").
 * @param {number} c indice di colonna a base 0
 * @returns {string}
 */
export const colName = c => { let s = ''; for (c++; c; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };

/**
 * Indice di colonna a base 0 da un nome di colonna ("A" -> 0, "AA" -> 26).
 * @param {string} s
 * @returns {number}
 */
export const colIndex = s => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * Indirizzo A1 da coordinate a base 0.
 * @param {number} r
 * @param {number} c
 * @returns {string}
 */
export const addr = (r, c) => colName(c) + (r + 1);

/**
 * Coordinate a base 0 da un indirizzo A1.
 * @param {string} a
 * @returns {{r:number,c:number}}
 */
export const parseRef = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { r: +m[2] - 1, c: colIndex(m[1]) }; };

/**
 * Riconosce i riferimenti a celle e intervalli, con foglio opzionale e
 * ancoraggi assoluti `$`. Gruppi:
 *  1 foglio, 2 $ colonna, 3 colonna, 4 $ riga, 5 riga,
 *  6 $ colonna fine, 7 colonna fine, 8 $ riga fine, 9 riga fine
 */
export const REF_RE = /(?<![\w.$])(?:([A-Za-z_]\w*)!)?(\$?)([A-Z]{1,2})(\$?)(\d+)(?::(\$?)([A-Z]{1,2})(\$?)(\d+))?(?![\w(])/g;

/**
 * Applica `f` a ogni riferimento presente in `src`, ignorando le stringhe
 * (singole, doppie e template literal). `f` riceve un descrittore:
 * `{ sh, ac, c, ar, r, b }` dove `b` è il secondo estremo dell'intervallo
 * (`{ ac, c, ar, r }`) oppure `null`.
 *
 * @param {string} src
 * @param {(ref:object)=>string} f
 * @returns {string}
 */
export function mapRefs(src, f) {
  return src.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/)
    .map((p, i) => i % 2 ? p : p.replace(REF_RE, (...m) => f({ sh: m[1], ac: m[2], c: m[3], ar: m[4], r: +m[5], b: m[9] ? { ac: m[6], c: m[7], ar: m[8], r: +m[9] } : null })))
    .join('');
}

/**
 * Trasla i riferimenti relativi di una formula di `dr` righe e `dc` colonne,
 * rispettando gli ancoraggi `$`.
 *
 * @param {string} v formula (con `=` iniziale)
 * @param {number} dr
 * @param {number} dc
 * @returns {string}
 */
export function shiftRefs(v, dr, dc) {
  const one = (p, sh) => p.ac + (p.ac ? p.c : colName(Math.max(0, colIndex(p.c) + dc))) + p.ar + (p.ar ? p.r : Math.max(1, p.r + dr));
  return '=' + mapRefs(v.slice(1), x => (x.sh ? x.sh + '!' : '') + one(x) + (x.b ? ':' + one(x.b) : ''));
}
