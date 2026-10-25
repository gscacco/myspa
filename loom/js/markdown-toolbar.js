/** Pure Markdown formatting commands used by the Loom item editor toolbar. */

export const MARKDOWN_FORMATS = [
  { action: 'bold', label: 'Bold', icon: 'bold' },
  { action: 'italic', label: 'Italic', icon: 'italic' },
  { action: 'strikethrough', label: 'Strikethrough', icon: 'strikethrough' },
  { action: 'inline-code', label: 'Inline code', icon: 'inline-code' },
  { action: 'heading', label: 'Heading', icon: 'heading' },
  { action: 'bullet-list', label: 'Bulleted list', icon: 'bullet-list' },
  { action: 'blockquote', label: 'Blockquote', icon: 'blockquote' },
  { action: 'item-link', label: 'Insert item link', icon: 'item-link' },
  { action: 'executable-code', label: 'Insert executable ClojureScript block', icon: 'executable-code' },
];

const INLINE = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strikethrough: ['~~', '~~'],
  'inline-code': ['`', '`'],
};

const PREFIXES = {
  heading: '## ',
  'bullet-list': '- ',
  blockquote: '> ',
};

function inlineFormat(source, start, end, action) {
  const [opening, closing] = INLINE[action];
  const selected = source.slice(start, end);
  return {
    value: source.slice(0, start) + opening + selected + closing + source.slice(end),
    start: start + opening.length,
    end: end + opening.length,
  };
}

function prefixFormat(source, start, end, prefix) {
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = source.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = source.length;
  const lines = source.slice(lineStart, lineEnd).split('\n');
  const populated = lines.filter(Boolean);
  const remove = populated.length > 0 && populated.every(line => line.startsWith(prefix));
  let firstDelta = 0, totalDelta = 0;
  const updated = lines.map((line, index) => {
    if (!line) return line;
    if (remove) {
      totalDelta -= prefix.length;
      if (index === 0) firstDelta = -prefix.length;
      return line.slice(prefix.length);
    }
    totalDelta += prefix.length;
    if (index === 0) firstDelta = prefix.length;
    return prefix + line;
  }).join('\n');
  return {
    value: source.slice(0, lineStart) + updated + source.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta),
    end: end + totalDelta,
  };
}

function insertExecutableBlock(source, start, end) {
  const selected = source.slice(start, end);
  const before = source.slice(0, start), after = source.slice(end);
  const leading = before && !before.endsWith('\n') ? '\n\n' : '';
  const trailing = after && !after.startsWith('\n') ? '\n\n' : '';
  const opening = '~~~clojurescript\n';
  const block = `${leading}${opening}${selected}\n~~~${trailing}`;
  const codeStart = start + leading.length + opening.length;
  return { value: before + block + after, start: codeStart, end: codeStart + selected.length };
}

export function applyMarkdownFormat(source, start, end, action) {
  const text = String(source), from = Number.isInteger(start) ? start : text.length, to = Number.isInteger(end) ? end : from;
  if (from < 0 || to < from || to > text.length) throw new RangeError('Invalid Markdown selection');
  if (INLINE[action]) return inlineFormat(text, from, to, action);
  if (PREFIXES[action]) return prefixFormat(text, from, to, PREFIXES[action]);
  if (action === 'item-link') return { value: text.slice(0, from) + '[[' + text.slice(to), start: from + 2, end: from + 2 };
  if (action === 'executable-code') return insertExecutableBlock(text, from, to);
  throw new TypeError(`Unknown Markdown formatting action: ${action}`);
}
