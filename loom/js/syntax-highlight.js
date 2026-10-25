/** DOM-safe syntax highlighting for display-only Clojure code fences. */

const TOKEN_RE = /(;[^\n]*)|("(?:[^"\\]|\\.)*"?)|(::?[^\s()\[\]{}",;]*)|([+-]?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)|([^\s()\[\]{}",;]+)|([\s\S])/g;
const KEYWORDS = new Set([
  'def', 'defn', 'defn-', 'defmacro', 'defonce', 'defmulti', 'defmethod', 'defprotocol',
  'deftype', 'defrecord', 'fn', 'let', 'letfn', 'if', 'if-let', 'if-not', 'when',
  'when-let', 'when-not', 'cond', 'condp', 'case', 'do', 'loop', 'recur', 'for',
  'doseq', 'dotimes', 'try', 'catch', 'finally', 'throw', 'quote', 'var', 'set!',
  'new', 'ns', 'require', 'import', 'reify', 'proxy', 'binding', 'lazy-seq', '->',
  '->>', 'as->', 'some->', 'some->>', 'doto', 'and', 'or',
]);
const LITERALS = new Set(['nil', 'true', 'false']);
const BUILTINS = new Set([
  'map', 'mapv', 'filter', 'remove', 'reduce', 'sort', 'sort-by', 'into', 'str', 'pr-str',
  'get', 'get-in', 'assoc', 'assoc-in', 'update', 'update-in', 'merge', 'select-keys',
  'first', 'second', 'last', 'rest', 'next', 'seq', 'conj', 'cons', 'concat', 'range',
  'count', 'empty?', 'some', 'every?', 'not', 'identity', 'apply', 'partial', 'comp',
  'juxt', 'key', 'val', 'keys', 'vals', 'contains?', 'find', 'name', 'keyword', 'print',
  'println', 'atom', 'swap!', 'reset!', 'deref', 'inc', 'dec', '+', '-', '*', '/', '=',
  '==', 'not=', '<', '>', '<=', '>=',
]);

function appendToken(document, parent, text, className) {
  if (!className) { parent.append(document.createTextNode(text)); return; }
  const span = document.createElement('i');
  span.className = className;
  span.textContent = text;
  parent.append(span);
}

export function highlightClojure(document, source) {
  const fragment = document.createDocumentFragment();
  const value = String(source);
  const tokens = new RegExp(TOKEN_RE.source, 'g');
  let match;
  while ((match = tokens.exec(value))) {
    const [text, comment, string, keyword, number, identifier] = match;
    if (comment) appendToken(document, fragment, text, 'c');
    else if (string) appendToken(document, fragment, text, 's');
    else if (keyword) appendToken(document, fragment, text, 'k');
    else if (number) appendToken(document, fragment, text, 'n');
    else if (identifier) {
      const className = KEYWORDS.has(identifier) ? 'k'
        : LITERALS.has(identifier) ? 'n'
          : BUILTINS.has(identifier) ? 'b' : null;
      appendToken(document, fragment, text, className);
    } else appendToken(document, fragment, text, null);
  }
  return fragment;
}
