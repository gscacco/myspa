/** Textarea adapter for Foglio's shared structural editing operations. */

import {
  pareditSlurp, pareditBarf, pareditBackwardSlurp, pareditBackwardBarf,
  pareditSplice, pareditWrap, pareditNewline,
  safeDeletion,
} from '../../shared/js/paredit.js';

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"' };
const CLOSERS = new Set(Object.values(PAIRS));

function lexicalState(source, end) {
  let string = false, comment = false, escaped = false;
  for (let index = 0; index < end; index++) {
    const char = source[index];
    if (comment) { if (char === '\n') comment = false; continue; }
    if (string) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === ';') comment = true;
    else if (char === '"') string = true;
  }
  return { string, comment };
}

export function attachStructuralEditor(textarea, { onStatus = () => {}, onEvaluate = () => {} } = {}) {
  function replace(edit) {
    if (!edit) { onStatus('No structural edit is available here'); return false; }
    textarea.setRangeText(edit.text, edit.from, edit.to, 'end');
    if (edit.caret !== undefined) textarea.setSelectionRange(edit.caret, edit.selEnd ?? edit.caret);
    textarea.dispatchEvent(new textarea.ownerDocument.defaultView.Event('input', { bubbles: true }));
    return true;
  }

  function keydown(event) {
    const source = textarea.value, from = textarea.selectionStart, to = textarea.selectionEnd;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey) {
      if (event.key === 'Enter') { event.preventDefault(); onEvaluate(); return; }
      const operation = {
        ArrowRight: () => event.shiftKey ? pareditBackwardSlurp(source, from) : pareditSlurp(source, from),
        ArrowLeft: () => event.shiftKey ? pareditBackwardBarf(source, from) : pareditBarf(source, from),
        ArrowUp: () => pareditSplice(source, from),
        ArrowDown: () => pareditWrap(source, from, to),
      }[event.key];
      if (operation) { event.preventDefault(); replace(operation()); return; }
    }
    if (modifier || event.altKey) return;
    if (event.key === 'Enter') { event.preventDefault(); replace(pareditNewline(source, from)); return; }
    if (event.key === 'Tab') { event.preventDefault(); replace({ from, to, text: '  ', caret: from + 2 }); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const empty = from === to;
      if (empty && event.key === 'Backspace' && from > 0 && Object.hasOwn(PAIRS, source[from - 1])
        && PAIRS[source[from - 1]] === source[from]) {
        event.preventDefault(); replace({ from: from - 1, to: from + 1, text: '', caret: from - 1 }); return;
      }
      if (empty && event.key === 'Delete' && Object.hasOwn(PAIRS, source[from])
        && PAIRS[source[from]] === source[from + 1]) {
        event.preventDefault(); replace({ from, to: from + 2, text: '', caret: from }); return;
      }
      const start = empty ? from - (event.key === 'Backspace' ? 1 : 0) : from;
      const end = empty ? from + (event.key === 'Delete' ? 1 : 0) : to;
      if (!safeDeletion(source, start, end)) {
        event.preventDefault();
        if (empty) {
          const position = event.key === 'Backspace' ? Math.max(0, from - 1) : Math.min(source.length, from + 1);
          textarea.setSelectionRange(position, position);
        }
        onStatus('Paredit protected a structural delimiter');
      }
      return;
    }
    if (event.key.length !== 1) return;
    const state = lexicalState(source, from);
    if (state.comment) return;
    if (state.string) {
      if (event.key === '"' && source[from] === '"' && from === to) {
        event.preventDefault(); textarea.setSelectionRange(from + 1, from + 1);
      }
      return;
    }
    if (CLOSERS.has(event.key) && source[from] === event.key && from === to) {
      event.preventDefault(); textarea.setSelectionRange(from + 1, from + 1); return;
    }
    const closing = PAIRS[event.key];
    if (!closing) return;
    event.preventDefault();
    const selected = source.slice(from, to);
    replace({ from, to, text: event.key + selected + closing, caret: from + 1, selEnd: to > from ? to + 1 : undefined });
  }

  textarea.addEventListener('keydown', keydown);
  return () => textarea.removeEventListener('keydown', keydown);
}
