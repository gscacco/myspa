/** Shared structural editing operations extracted from Foglio. */

const OPENERS = '([{';
const CLOSERS_S = ')]}';

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

function skipWS(text, i, end = text.length) {
  while (i < end) {
    const c = text[i];
    if (c === ';') { while (i < end && text[i] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') { i++; continue; }
    break;
  }
  return i;
}

function matchAt(text, i) {
  if (!OPENERS.includes(text[i])) return -1;
  const stack = [];
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '"') { j = skipStr(text, j) - 1; continue; }
    if (c === ';') { while (j < text.length && text[j] !== '\n') j++; continue; }
    if (OPENERS.includes(c)) stack.push(CLOSERS_S[OPENERS.indexOf(c)]);
    else if (CLOSERS_S.includes(c)) {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return j;
    }
  }
  return -1;
}

function nextFormEnd(text, i) {
  i = skipWS(text, i);
  return i < text.length ? formEnd(text, i) : null;
}

function formEnd(text, i) {
  const c = text[i];
  if (c === undefined) return null;
  if (CLOSERS_S.includes(c)) return null;
  if (c === '"') return skipStr(text, i);
  if (OPENERS.includes(c)) { const m = matchAt(text, i); return m < 0 ? null : m + 1; }
  if (c === '#' && text[i + 1] === '"') return skipStr(text, i + 1);
  if (c === '#' && OPENERS.includes(text[i + 1])) {
    const m = matchAt(text, i + 1); return m < 0 ? null : m + 1;
  }
  if (c === '#') {
    let j = i + 1;
    while (j < text.length && !/[\s,()\[\]{}";]/.test(text[j])) j++;
    return nextFormEnd(text, j) ?? (j === i + 1 ? i + 1 : j);
  }
  if (c === '^') {
    const metaEnd = nextFormEnd(text, i + 1);
    return metaEnd === null ? null : nextFormEnd(text, metaEnd) ?? metaEnd;
  }
  if (c === "'" || c === '`' || c === '@' || c === '~') {
    return nextFormEnd(text, i + (text[i + 1] === '@' ? 2 : 1));
  }
  let j = i;
  while (j < text.length && !/[\s,()\[\]{}";]/.test(text[j])) j++;
  return j === i ? i + 1 : j;
}

function pairs(text) {
  const out = [], stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipStr(text, i) - 1; continue; }
    if (c === ';') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (OPENERS.includes(c)) stack.push({ i, c });
    else if (CLOSERS_S.includes(c) && stack.length) {
      const t = stack.pop();
      if (CLOSERS_S[OPENERS.indexOf(t.c)] !== c) { stack.length = 0; continue; }
      out.push({ open: t.i, close: i, oc: t.c, cc: c });
    }
  }
  return out;
}

function enclosingPairs(text, pos) {
  const matches = [];
  for (const p of pairs(text)) {
    const inside = p.open < pos && pos <= p.close;
    const justClosed = p.close + 1 === pos;
    if (inside || justClosed) matches.push(p);
  }
  return matches.sort((a, b) => b.open - a.open);
}

function enclosingPair(text, pos) {
  return enclosingPairs(text, pos)[0] ?? null;
}

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

export function pareditSlurp(text, pos) {
  for (const p of enclosingPairs(text, pos)) {
    const start = skipWS(text, p.close + 1);
    if (start >= text.length) continue;
    const end = formEnd(text, start);
    if (end === null) continue;
    return { from: p.close, to: end, text: text.slice(p.close + 1, end) + p.cc, caret: pos };
  }
  return null;
}

export function pareditBackwardSlurp(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const previous = formBefore(text, p.open);
  if (!previous) return null;
  return {
    from: previous.from,
    to: p.open + 1,
    text: p.oc + text.slice(previous.from, p.open),
    caret: pos,
  };
}

export function pareditBarf(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const forms = topForms(text, p.open + 1, p.close);
  if (!forms.length) return null;
  const last = forms[forms.length - 1];
  const prevEnd = forms.length > 1 ? forms[forms.length - 2].end : p.open + 1;
  const gap = text.slice(prevEnd, last.start) || ' ';
  const moved = text.slice(last.start, p.close).replace(/\s+$/, '');
  const region = p.cc + gap + moved;
  const movedStart = prevEnd + p.cc.length + gap.length;
  const caret = pos <= prevEnd ? pos
    : pos < last.start ? prevEnd + p.cc.length + (pos - prevEnd)
      : movedStart + Math.min(moved.length, pos - last.start);
  return { from: prevEnd, to: p.close + 1, text: region, caret };
}

export function pareditBackwardBarf(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const forms = topForms(text, p.open + 1, p.close);
  if (!forms.length) return null;
  const first = forms[0];
  const nextStart = forms.length > 1 ? forms[1].start : p.close;
  const gap = text.slice(first.end, nextStart) || ' ';
  const moved = text.slice(first.start, first.end);
  const region = moved + gap + p.oc;
  const caret = pos < first.start ? pos
    : pos < first.end ? p.open + (pos - first.start)
      : pos < nextStart ? p.open + moved.length + Math.min(gap.length, pos - first.end)
        : p.open + region.length + (pos - nextStart);
  return { from: p.open, to: nextStart, text: region, caret };
}

export function pareditSplice(text, pos) {
  const p = enclosingPair(text, pos);
  if (!p) return null;
  const caret = Math.max(p.open, pos - 1);
  return { from: p.open, to: p.close + 1, text: text.slice(p.open + 1, p.close), caret };
}

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

export function safeDeletion(text, from, to) {
  from = Math.max(0, from); to = Math.max(0, to);
  if (from >= to) return true;
  let string = false, comment = false, escaped = false;
  const advance = c => {
    if (comment) { if (c === '\n') comment = false; return; }
    if (string) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') string = false;
      return;
    }
    if (c === ';') comment = true;
    else if (c === '"') string = true;
  };
  for (let i = 0; i < from; i++) advance(text[i]);
  const startedString = string, startedComment = comment;
  const stack = [];
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (!string && !comment) {
      if (OPENERS.includes(c)) stack.push(CLOSERS_S[OPENERS.indexOf(c)]);
      else if (CLOSERS_S.includes(c) && stack.pop() !== c) return false;
    }
    advance(c);
  }
  return !stack.length && string === startedString && comment === startedComment;
}

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
    if (j === limit && j < text.length && !isDelim(text[j])) { i = j; continue; }
    remember(i, j);
    i = j;
  }
  return last;
}
