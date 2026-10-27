/** Safe DOM rendering for Loom Markdown, transclusion, and Hiccup values. */

import { EDNKeyword, writeEDN } from '../../shared/js/edn-codec.js';
import { lexMarkdown } from './markdown.js';
import { isClojureLanguage, isExecutableLanguage } from './code-blocks.js';
import { highlightClojure } from './syntax-highlight.js';
import { isImageAttachment } from './attachments.js';
import { parseLoomURL } from './item-relationships.js';

export { parseLoomURL } from './item-relationships.js';

const ELEMENTS = new Set('p span div section article aside h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code em strong b i small br hr table thead tbody tr th td a'.split(' '));
const HICCUP_STYLE_PROPERTIES = new Set(`color background-color
  font font-family font-size font-style font-weight font-variant
  line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent
  white-space overflow-wrap word-break vertical-align
  display gap row-gap column-gap align-items align-content align-self justify-content justify-items justify-self
  flex flex-direction flex-wrap flex-grow flex-shrink flex-basis
  grid-template-columns grid-template-rows grid-auto-flow
  margin margin-top margin-right margin-bottom margin-left
  padding padding-top padding-right padding-bottom padding-left
  border border-top border-right border-bottom border-left border-color border-style border-width border-radius
  width min-width max-width height min-height max-height
  opacity overflow overflow-x overflow-y`.trim().split(/\s+/));
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|@import|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding/i;
const SNIPPET_ICONS = {
  'edit-snippet': 'M4 20h4L18 10l-4-4L4 16v4zM13 7l4 4',
};

function cssPropertyName(name) {
  if (typeof name !== 'string') return null;
  const kebab = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  return /^-?[a-z][a-z0-9-]*$/.test(kebab) ? kebab : null;
}

function applyHiccupStyle(element, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style) || style instanceof EDNKeyword) {
    throw new TypeError('Hiccup style must be a map');
  }
  for (const [rawName, rawValue] of Object.entries(style)) {
    const name = cssPropertyName(rawName);
    if (!name || !HICCUP_STYLE_PROPERTIES.has(name)) throw new TypeError(`Unsupported Hiccup style property: ${rawName}`);
    if (typeof rawValue !== 'string' || !rawValue.trim() || rawValue.length > 300
      || /[\u0000-\u001f\u007f;{}]/.test(rawValue) || UNSAFE_STYLE_VALUE.test(rawValue)) {
      throw new TypeError(`Invalid Hiccup style value for ${rawName}`);
    }
    element.style.setProperty(name, rawValue.trim());
  }
}

function snippetButton(ctx, action, label) {
  const button = ctx.document.createElement('button');
  button.type = 'button'; button.className = 'icon-button'; button.dataset.action = action;
  button.title = label; button.setAttribute('aria-label', label);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = ctx.document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = ctx.document.createElementNS(ns, 'path'); path.setAttribute('d', SNIPPET_ICONS[action]);
  svg.append(path); button.append(svg);
  return button;
}

function errorNode(document, message) {
  const node = document.createElement('span'); node.className = 'render-error';
  node.setAttribute('role', 'alert'); node.textContent = message;
  return node;
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
  if (target) return itemLink(ctx, target);
  const external = safeExternalURL(href);
  if (!external) return errorNode(ctx.document, `Unsafe or unsupported URL: ${href}`);
  const anchor = ctx.document.createElement('a'); anchor.href = external;
  anchor.rel = 'noopener noreferrer'; anchor.target = '_blank'; anchor.append(label);
  return anchor;
}

function unresolvedLink(ctx, id) {
  const node = errorNode(ctx.document, `Missing item: ${id}`);
  node.classList.add('unresolved-link');
  node.dataset.loomTarget = id;
  return node;
}

function itemLink(ctx, target, anchor = ctx.document.createElement('a')) {
  ctx.dependencies?.add(`item:${target.id}`);
  const item = ctx.items?.find(candidate => candidate.id === target.id);
  if (!item) return unresolvedLink(ctx, target.id);
  anchor.href = `loom:${target.id}${target.section ? `#${target.section}` : ''}`;
  anchor.className = 'loom-item-link';
  anchor.dataset.loomTarget = target.id;
  anchor.textContent = item.title;
  anchor.addEventListener('click', event => { event.preventDefault(); ctx.onNavigate?.(target.id, target.section); });
  return anchor;
}

function unresolvedFile(ctx, id) {
  const node = errorNode(ctx.document, `Missing file: ${id}`);
  node.classList.add('unresolved-file');
  node.dataset.loomFile = id;
  return node;
}

function attachmentSource(ctx, attachment) {
  const url = ctx.attachmentURL?.(attachment);
  return typeof url === 'string' && url ? url : null;
}

function fileLink(ctx, id) {
  ctx.dependencies?.add(`file:${id}`);
  const attachment = ctx.attachments?.get(id);
  if (!attachment) return unresolvedFile(ctx, id);
  const url = attachmentSource(ctx, attachment);
  if (!url) return errorNode(ctx.document, `Attachment unavailable: ${attachment.name}`);
  const anchor = ctx.document.createElement('a');
  anchor.className = 'loom-file-link'; anchor.href = url; anchor.download = attachment.name;
  anchor.textContent = attachment.name; anchor.title = attachment.name;
  anchor.dataset.loomFile = id;
  return anchor;
}

function fileEmbed(ctx, id, block = false) {
  ctx.dependencies?.add(`file:${id}`);
  const attachment = ctx.attachments?.get(id);
  if (!attachment) return unresolvedFile(ctx, id);
  if (!attachment.type?.toLocaleLowerCase().startsWith('image/')) {
    return errorNode(ctx.document, `Attachment is not an image: ${attachment.name}`);
  }
  const url = attachmentSource(ctx, attachment);
  if (!url) return errorNode(ctx.document, `Attachment unavailable: ${attachment.name}`);
  const figure = ctx.document.createElement(block ? 'figure' : 'span');
  figure.className = 'loom-image'; figure.dataset.loomFile = id;
  const image = ctx.document.createElement('img');
  image.src = url; image.alt = attachment.name; image.title = attachment.name;
  image.loading = 'lazy'; image.decoding = 'async';
  figure.append(image);
  return figure;
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

function transclude(target, ctx) {
  const { document } = ctx;
  if (!target) return errorNode(document, 'Invalid transclusion target');
  ctx.dependencies?.add(`item:${target.id}`);
  const item = ctx.items?.find(candidate => candidate.id === target.id);
  if (!item) return errorNode(document, `Missing item: ${target.id}`);
  const key = `${target.id}#${target.section || ''}`;
  const path = ctx.path || [];
  if (path.includes(key)) return errorNode(document, `Transclusion cycle: ${item.title}`);
  if (path.length >= 16) return errorNode(document, 'Transclusion depth limit reached');
  if (item.kind?.name === 'image') {
    if (target.section) return errorNode(document, `Missing section: ${target.section}`);
    ctx.dependencies?.add(`file:${item['attachment-id']}`);
    const attachment = (ctx.itemAttachments || ctx.attachments)?.get(item['attachment-id']);
    if (!attachment) return errorNode(document, `Missing file: ${item['attachment-id']}`);
    if (!isImageAttachment(attachment)) return errorNode(document, `Attachment is not an image: ${attachment.name}`);
    const url = attachmentSource(ctx, attachment);
    if (!url) return errorNode(document, `Attachment unavailable: ${attachment.name}`);
    const embed = document.createElement('section');
    embed.className = 'transclusion'; embed.dataset.loomSource = target.id;
    const figure = document.createElement('figure');
    figure.className = 'image-transclusion'; figure.dataset.loomFile = attachment.id;
    const image = document.createElement('img');
    image.src = url; image.alt = item.title; image.loading = 'lazy'; image.decoding = 'async';
    figure.append(image); embed.append(figure);
    return embed;
  }
  const tokens = lexMarkdown(item.body);
  const selected = sectionTokens(tokens, target.section);
  if (!selected) return errorNode(document, `Missing section: ${target.section}`);
  const embed = document.createElement('section');
  embed.className = 'transclusion'; embed.dataset.loomSource = target.id;
  if (target.section) embed.dataset.loomSection = target.section;
  embed.append(blocks(selected.tokens, { ...ctx, path: [...path, key], transcluded: true }, selected.slugs));
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
      case 'loomItemReference': node = itemLink(ctx, { id: token.id, section: null }); break;
      case 'loomTransclusion': node = transclude({ id: token.id, section: token.section }, ctx); break;
      case 'loomFileReference': node = fileLink(ctx, token.id); break;
      case 'loomFileEmbed': node = fileEmbed(ctx, token.id, false); break;
      case 'image': node = token.href?.startsWith('loom:')
        ? transclude(parseLoomURL(token.href), ctx)
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
      case 'loomTransclusion':
        node = transclude({ id: token.id, section: token.section }, ctx); break;
      case 'loomFileEmbed': node = fileEmbed(ctx, token.id, true); break;
      case 'code': {
        if (isExecutableLanguage(token.lang) && !ctx.transcluded) {
          node = ctx.document.createElement('div'); node.className = 'loom-snippet';
          const ordinal = ctx.snippetCounter ? ctx.snippetCounter.value++ : 0;
          const actions = ctx.document.createElement('div'); actions.className = 'snippet-actions';
          const edit = snippetButton(ctx, 'edit-snippet', 'Edit code');
          actions.append(edit);
          const code = ctx.document.createElement('pre'); code.textContent = token.text;
          code.className = 'snippet-source'; code.hidden = true;
          const output = ctx.document.createElement('div'); output.className = 'snippet-output';
          edit.addEventListener('click', () => ctx.onEditSnippet?.({ ordinal, source: token.text, node }));
          node.append(actions, code, output);
        } else {
          node = ctx.document.createElement('pre'); const code = ctx.document.createElement('code');
          if (isClojureLanguage(token.lang)) code.append(highlightClojure(ctx.document, token.text));
          else code.textContent = token.text;
          node.append(code);
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
  const tokens = lexMarkdown(source);
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
  let loomTarget = null;
  if (attributes) for (const [name, attribute] of Object.entries(attributes)) {
    const allowed = ['class', 'title'].includes(name) || /^aria-[a-z0-9-]+$/.test(name)
      || (/^data-[a-z0-9-]+$/.test(name) && !name.startsWith('data-loom-'))
      || ['key', 'style'].includes(name)
      || (tag === 'a' && name === 'href')
      || (['td', 'th'].includes(tag) && ['colspan', 'rowspan'].includes(name));
    if (!allowed) throw new TypeError(`Unsupported Hiccup attribute: ${name}`);
    if (name === 'style') {
      applyHiccupStyle(element, attribute);
    } else if (name === 'key') {
      if (typeof attribute !== 'string' && !(typeof attribute === 'number' && Number.isFinite(attribute))) {
        throw new TypeError('Invalid Hiccup key');
      }
    } else if (name === 'href') {
      const target = parseLoomURL(attribute), external = safeExternalURL(attribute);
      if (!target && !external) throw new TypeError(`Unsafe href URL: ${attribute}`);
      element.href = target ? attribute : external;
      if (target) loomTarget = target;
      else { element.rel = 'noopener noreferrer'; element.target = '_blank'; }
    } else if (['colspan', 'rowspan'].includes(name)) {
      if (!Number.isInteger(attribute) || attribute < 1 || attribute > 100) throw new TypeError(`Invalid Hiccup attribute: ${name}`);
      element.setAttribute(name, String(attribute));
    } else {
      if (typeof attribute !== 'string') throw new TypeError(`Invalid Hiccup attribute: ${name}`);
      element.setAttribute(name, attribute);
    }
  }
  if (loomTarget) return itemLink(ctx, loomTarget, element);
  for (const child of value.slice(hasAttrs ? 2 : 1)) element.append(renderHiccupNode(child, ctx, state, depth + 1));
  return element;
}

export function renderHiccup(value, ctx) { return renderHiccupNode(value, ctx, { nodes: 0 }, 0); }

export function renderResult(value, ctx) {
  if (value === null || value === undefined) return ctx.document.createDocumentFragment();
  if (Array.isArray(value) && value[0] instanceof EDNKeyword) return renderHiccup(value, ctx);
  if (Array.isArray(value) && value.every(child => Array.isArray(child) && child[0] instanceof EDNKeyword)) return renderHiccup(value, ctx);
  if (typeof value === 'object' && typeof value['loom/definition'] === 'string') {
    const status = ctx.document.createElement('p'); status.className = 'definition-result';
    status.textContent = `Defined ${value['loom/definition'].replace(/^#'/, '')}`;
    return status;
  }
  if (typeof value === 'object' && Object.hasOwn(value, 'loom/data')) value = value['loom/data'];
  if (typeof value === 'object') {
    const pre = ctx.document.createElement('pre'); pre.textContent = writeEDN(value); return pre;
  }
  return ctx.document.createTextNode(value instanceof EDNKeyword ? `:${value.name}` : String(value));
}
