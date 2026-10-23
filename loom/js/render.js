/** Safe DOM rendering for Loom Markdown, transclusion, and Hiccup values. */

import { marked } from 'marked';
import { EDNKeyword, writeEDN } from '../../shared/js/edn-codec.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ELEMENTS = new Set('p span div section article aside h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code em strong b i small br hr table thead tbody tr th td a'.split(' '));

function errorNode(document, message) {
  const node = document.createElement('span'); node.className = 'render-error';
  node.setAttribute('role', 'alert'); node.textContent = message;
  return node;
}

export function parseLoomURL(value) {
  const match = /^loom:([0-9a-f-]{36})(?:#([a-z0-9-]+))?$/i.exec(String(value));
  return match && UUID.test(match[1]) ? { id: match[1], section: match[2] || null } : null;
}

function safeExternalURL(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function makeLink(ctx, href, label) {
  const target = parseLoomURL(href);
  if (target) {
    if (!ctx.items?.some(item => item.id === target.id)) return errorNode(ctx.document, `Missing item: ${target.id}`);
    const anchor = ctx.document.createElement('a'); anchor.href = href;
    anchor.addEventListener('click', event => { event.preventDefault(); ctx.onNavigate?.(target.id, target.section); });
    anchor.append(label); return anchor;
  }
  const external = safeExternalURL(href);
  if (!external) return errorNode(ctx.document, `Unsafe or unsupported URL: ${href}`);
  const anchor = ctx.document.createElement('a'); anchor.href = external;
  anchor.rel = 'noopener noreferrer'; anchor.target = '_blank'; anchor.append(label);
  return anchor;
}

function plainInline(tokens = []) { return tokens.map(token => token.tokens ? plainInline(token.tokens) : token.text || '').join(''); }

function slug(value) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

function headingSlugs(tokens) {
  const counts = new Map(), slugs = new Map();
  for (const [index, token] of tokens.entries()) if (token.type === 'heading') {
    const stem = slug(plainInline(token.tokens) || token.text) || 'section';
    const count = (counts.get(stem) || 0) + 1; counts.set(stem, count);
    slugs.set(index, count === 1 ? stem : `${stem}-${count}`);
  }
  return slugs;
}

export function sectionSourceOffset(source, name) {
  if (!name) return 0;
  const tokens = marked.lexer(source, { gfm: true });
  const slugs = headingSlugs(tokens);
  let offset = 0;
  for (const [index, token] of tokens.entries()) {
    if (slugs.get(index) === name) return offset;
    offset += token.raw.length;
  }
  return null;
}

function sectionTokens(tokens, name) {
  if (!name) return { tokens, slugs: headingSlugs(tokens) };
  const slugs = headingSlugs(tokens);
  const start = [...slugs].find(([, value]) => value === name)?.[0];
  if (start === undefined) return null;
  let end = tokens.length;
  for (let index = start + 1; index < tokens.length; index++) {
    if (tokens[index].type === 'heading' && tokens[index].depth <= tokens[start].depth) { end = index; break; }
  }
  const selected = tokens.slice(start, end);
  return { tokens: selected, slugs: new Map([...slugs].filter(([index]) => index >= start && index < end).map(([index, value]) => [index - start, value])) };
}

function transclude(target, label, ctx) {
  const { document } = ctx;
  if (!target) return errorNode(document, 'Invalid transclusion target');
  ctx.dependencies?.add(target.id);
  const item = ctx.items?.find(candidate => candidate.id === target.id);
  if (!item) return errorNode(document, `Missing item: ${target.id}`);
  const key = `${target.id}#${target.section || ''}`;
  const path = ctx.path || [];
  if (path.includes(key)) return errorNode(document, `Transclusion cycle: ${item.title}`);
  if (path.length >= 16) return errorNode(document, 'Transclusion depth limit reached');
  const tokens = marked.lexer(item.body, { gfm: true });
  const selected = sectionTokens(tokens, target.section);
  if (!selected) return errorNode(document, `Missing section: ${target.section}`);
  const embed = document.createElement('section');
  embed.className = 'transclusion'; embed.dataset.loomSource = target.id;
  if (target.section) embed.dataset.loomSection = target.section;
  embed.setAttribute('aria-label', label || `Embedded ${item.title}`);
  const header = document.createElement('header');
  const title = document.createElement('span'); title.textContent = `From ${item.title}`;
  const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open source';
  open.addEventListener('click', () => ctx.onNavigate?.(target.id, target.section));
  const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit source';
  edit.addEventListener('click', () => ctx.onEditSource?.(target.id, target.section));
  header.append(title, open, edit);
  embed.append(header, blocks(selected.tokens, { ...ctx, path: [...path, key], transcluded: true }, selected.slugs));
  return embed;
}

function inline(tokens, ctx) {
  const fragment = ctx.document.createDocumentFragment();
  for (const token of tokens || []) {
    let node;
    switch (token.type) {
      case 'text': case 'escape': case 'html': node = ctx.document.createTextNode(token.text || token.raw || ''); break;
      case 'codespan': node = ctx.document.createElement('code'); node.textContent = token.text; break;
      case 'strong': case 'em': case 'del': {
        node = ctx.document.createElement(token.type === 'del' ? 's' : token.type);
        node.append(inline(token.tokens, ctx)); break;
      }
      case 'br': node = ctx.document.createElement('br'); break;
      case 'link': node = makeLink(ctx, token.href, inline(token.tokens, ctx)); break;
      case 'image': node = token.href?.startsWith('loom:')
        ? transclude(parseLoomURL(token.href), token.text, ctx)
        : errorNode(ctx.document, `Unsupported image: ${token.href}`); break;
      default: node = ctx.document.createTextNode(token.raw || token.text || '');
    }
    fragment.append(node);
  }
  return fragment;
}

function blocks(tokens, ctx, slugs = headingSlugs(tokens)) {
  const fragment = ctx.document.createDocumentFragment();
  for (const [index, token] of tokens.entries()) {
    let node;
    switch (token.type) {
      case 'space': continue;
      case 'heading':
        node = ctx.document.createElement(`h${token.depth}`); node.id = slugs.get(index) || '';
        node.append(inline(token.tokens, ctx)); break;
      case 'paragraph': case 'text':
        node = ctx.document.createElement('p'); node.append(inline(token.tokens, ctx)); break;
      case 'code': {
        if (token.lang === 'cljs loom' && !ctx.transcluded) {
          node = ctx.document.createElement('div'); node.className = 'loom-snippet';
          const run = ctx.document.createElement('button'); run.type = 'button'; run.textContent = 'Run trusted code'; run.dataset.action = 'run-snippet';
          const ordinal = ctx.snippetCounter ? ctx.snippetCounter.value++ : 0;
          const edit = ctx.document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit code';
          edit.dataset.action = 'edit-snippet';
          const code = ctx.document.createElement('pre'); code.textContent = token.text;
          const output = ctx.document.createElement('div'); output.className = 'snippet-output';
          run.addEventListener('click', () => ctx.onRun?.({ source: token.text, output, run }));
          edit.addEventListener('click', () => ctx.onEditSnippet?.({ ordinal, source: token.text, node }));
          node.append(run, edit, code, output);
        } else {
          node = ctx.document.createElement('pre'); const code = ctx.document.createElement('code');
          code.textContent = token.text; node.append(code);
        }
        break;
      }
      case 'hr': node = ctx.document.createElement('hr'); break;
      case 'blockquote': node = ctx.document.createElement('blockquote'); node.append(blocks(token.tokens, ctx)); break;
      case 'list': {
        node = ctx.document.createElement(token.ordered ? 'ol' : 'ul');
        if (token.ordered && token.start > 1) node.start = token.start;
        for (const entry of token.items) {
          const li = ctx.document.createElement('li'); li.append(blocks(entry.tokens, ctx)); node.append(li);
        }
        break;
      }
      case 'html': node = ctx.document.createElement('pre'); node.textContent = token.text || token.raw; break;
      default: node = ctx.document.createElement('pre'); node.textContent = token.raw || token.text || ''; break;
    }
    fragment.append(node);
  }
  return fragment;
}

export function renderMarkdown(source, ctx) {
  const tokens = marked.lexer(source, { gfm: true });
  return blocks(tokens, { snippetCounter: { value: 0 }, ...ctx });
}

function renderHiccupNode(value, ctx, state, depth) {
  if (depth > 32 || ++state.nodes > 1000) throw new TypeError('Hiccup rendering limit exceeded');
  const { document } = ctx;
  if (value === null || value === undefined) return document.createDocumentFragment();
  if (!Array.isArray(value)) {
    if (value instanceof EDNKeyword) return document.createTextNode(`:${value.name}`);
    if (['string', 'number', 'boolean'].includes(typeof value)) return document.createTextNode(String(value));
    throw new TypeError('Unsupported Hiccup child');
  }
  if (!(value[0] instanceof EDNKeyword)) {
    const fragment = document.createDocumentFragment();
    for (const child of value) fragment.append(renderHiccupNode(child, ctx, state, depth + 1));
    return fragment;
  }
  const tag = value[0].name;
  if (!ELEMENTS.has(tag)) throw new TypeError(`Unsupported Hiccup tag: ${tag}`);
  const element = document.createElement(tag);
  const hasAttrs = value.length > 1 && value[1] && typeof value[1] === 'object' && !Array.isArray(value[1]) && !(value[1] instanceof EDNKeyword);
  const attributes = hasAttrs ? value[1] : null;
  if (attributes) for (const [name, attribute] of Object.entries(attributes)) {
    const allowed = ['class', 'title'].includes(name) || /^aria-[a-z0-9-]+$/.test(name)
      || (/^data-[a-z0-9-]+$/.test(name) && !name.startsWith('data-loom-'))
      || (tag === 'a' && name === 'href')
      || (['td', 'th'].includes(tag) && ['colspan', 'rowspan'].includes(name));
    if (!allowed) throw new TypeError(`Unsupported Hiccup attribute: ${name}`);
    if (name === 'href') {
      const target = parseLoomURL(attribute), external = safeExternalURL(attribute);
      if (!target && !external) throw new TypeError(`Unsafe href URL: ${attribute}`);
      element.href = target ? attribute : external;
      if (target) element.addEventListener('click', event => { event.preventDefault(); ctx.onNavigate?.(target.id, target.section); });
      else { element.rel = 'noopener noreferrer'; element.target = '_blank'; }
    } else if (['colspan', 'rowspan'].includes(name)) {
      if (!Number.isInteger(attribute) || attribute < 1 || attribute > 100) throw new TypeError(`Invalid Hiccup attribute: ${name}`);
      element.setAttribute(name, String(attribute));
    } else {
      if (typeof attribute !== 'string') throw new TypeError(`Invalid Hiccup attribute: ${name}`);
      element.setAttribute(name, attribute);
    }
  }
  for (const child of value.slice(hasAttrs ? 2 : 1)) element.append(renderHiccupNode(child, ctx, state, depth + 1));
  return element;
}

export function renderHiccup(value, ctx) { return renderHiccupNode(value, ctx, { nodes: 0 }, 0); }

export function renderResult(value, ctx) {
  if (value === null || value === undefined) return ctx.document.createDocumentFragment();
  if (Array.isArray(value) && value[0] instanceof EDNKeyword) return renderHiccup(value, ctx);
  if (Array.isArray(value) && value.every(child => Array.isArray(child) && child[0] instanceof EDNKeyword)) return renderHiccup(value, ctx);
  if (typeof value === 'object' && Object.hasOwn(value, 'loom/data')) value = value['loom/data'];
  if (typeof value === 'object') {
    const pre = ctx.document.createElement('pre'); pre.textContent = writeEDN(value); return pre;
  }
  return ctx.document.createTextNode(value instanceof EDNKeyword ? `:${value.name}` : String(value));
}
