/** Byte-preserving locations for executable fenced code inside Markdown source. */

import { marked } from 'marked';

export function findSnippetSpan(source, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 0) return null;
  const tokens = marked.lexer(source, { gfm: true });
  const originalOffset = normalizedOffset => {
    let original = 0, normalized = 0;
    while (normalized < normalizedOffset && original < source.length) {
      if (source[original] === '\r' && source[original + 1] === '\n') original++;
      original++; normalized++;
    }
    return original;
  };
  let offset = 0, seen = 0;
  for (const token of tokens) {
    if (token.type === 'code' && token.lang === 'cljs loom') {
      if (seen++ === ordinal) {
        const raw = token.raw;
        const opening = /^ {0,3}(`{3,}|~{3,})[ \t]*cljs loom[ \t]*\r?\n/.exec(raw);
        if (!opening) return null;
        const closing = new RegExp(`\\n {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*(?:\\n)?$`).exec(raw);
        if (!closing) return null;
        const start = originalOffset(offset + opening[0].length);
        const end = originalOffset(offset + closing.index);
        return { start, end, source: source.slice(start, end) };
      }
    }
    offset += token.raw.length;
  }
  return null;
}

export function applySnippetEdit(originalBody, currentBody, span, newCode) {
  if (currentBody !== originalBody) throw new Error('Snippet edit conflict: Markdown changed since editing began');
  if (!span || typeof newCode !== 'string' || originalBody.slice(span.start, span.end) !== span.source) {
    throw new TypeError('Snippet source span is invalid');
  }
  return originalBody.slice(0, span.start) + newCode + originalBody.slice(span.end);
}
