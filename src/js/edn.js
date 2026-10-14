/**
 * edn.js — Serializzazione e deserializzazione EDN del modello workbook.
 *
 * Modulo puro: non dipende dal DOM, dal motore di calcolo o dal browser.
 * Il formato prodotto da `writeEDN` è identico a quello dell'applicazione
 * originale (nessuna modifica al formato dati salvato).
 */

/**
 * Serializza un valore JavaScript in EDN leggibile.
 *
 * - `null`/`undefined` -> `nil`
 * - stringhe -> JSON.stringify con escaping di `</` in `<\/` (sicurezza dentro
 *   un elemento <script> del documento HTML standalone)
 * - array -> vettori `[...]`, oggetti -> mappe `{...}`
 * - le proprietà `undefined` vengono omesse
 *
 * @param {*} v valore da serializzare
 * @param {number} [d] livello di indentazione corrente
 * @returns {string}
 */
export function writeEDN(v, d = 0) {
  if (v == null) return 'nil';
  if (typeof v === 'string') return JSON.stringify(v).replace(/<\//g, '<\\/');
  if (typeof v !== 'object') return String(v);
  const p = '\n' + ' '.repeat(d * 2 + 2), e = '\n' + ' '.repeat(d * 2);
  if (Array.isArray(v)) return v.length ? '[' + v.map(x => p + writeEDN(x, d + 1)).join('') + e + ']' : '[]';
  return '{' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => p + ':' + k + ' ' + writeEDN(x, d + 1)).join('') + e + '}';
}

/**
 * Analizza una stringa EDN e restituisce il valore JavaScript corrispondente.
 *
 * Grammatica supportata (identica all'originale):
 *  - mappe `{}` (le chiavi keyword `:x` diventano stringhe)
 *  - vettori `[]`
 *  - stringhe `"..."` con escape `\n \t \uXXXX` e `\x`
 *  - commenti di riga con `;`
 *  - separatori: spazi bianchi e virgole
 *  - `nil`, `true`, `false`, numeri
 *
 * @param {string} s
 * @returns {*}
 */
export function readEDN(s) {
  let i = 0;
  const tok = /[^\s,\[\]{}"]+/y;
  const ws = () => { for (;;) { const c = s[i]; if (c === ',' || c <= ' ') { i++; continue; } if (c === ';') { while (i < s.length && s[i] !== '\n') i++; continue; } break; } };
  function v() {
    ws();
    const c = s[i];
    if (c === '{') { i++; const o = {}; for (;;) { ws(); if (s[i] === '}') { i++; return o; } const k = v(); o[String(k)] = v(); } }
    if (c === '[') { i++; const a = []; for (;;) { ws(); if (s[i] === ']') { i++; return a; } a.push(v()); } }
    if (c === '"') {
      i++;
      let r = '';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') {
          i++;
          const d = s[i];
          if (d === 'n') r += '\n';
          else if (d === 't') r += '\t';
          else if (d === 'u') { r += String.fromCharCode(parseInt(s.substr(i + 1, 4), 16)); i += 4; }
          else r += d;
        } else r += s[i];
        i++;
      }
      if (i >= s.length) throw Error('EDN: stringa non terminata');
      i++;
      return r;
    }
    tok.lastIndex = i;
    const m = tok.exec(s);
    if (!m) throw Error('EDN: carattere inatteso in posizione ' + i);
    i += m[0].length;
    const t = m[0];
    if (t === 'nil') return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t[0] === ':') return t.slice(1);
    return isNaN(t) ? t : +t;
  }
  return v();
}
