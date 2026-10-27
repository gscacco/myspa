/** Derive item link and transclusion relationships from Markdown source. */

import { lexMarkdown } from './markdown.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseLoomURL(value) {
  const match = /^loom:([0-9a-f-]{36})(?:#([a-z0-9-]+))?$/i.exec(String(value));
  return match && UUID.test(match[1]) ? { id: match[1], section: match[2] || null } : null;
}

function collect(value, referenced, transcluded) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) collect(child, referenced, transcluded);
    return;
  }
  if (value.type === 'loomItemReference') referenced.add(value.id);
  else if (value.type === 'loomTransclusion') transcluded.add(value.id);
  else if (value.type === 'link' || value.type === 'image') {
    const target = parseLoomURL(value.href);
    if (target) (value.type === 'image' ? transcluded : referenced).add(target.id);
  }
  if (Array.isArray(value.tokens)) collect(value.tokens, referenced, transcluded);
  if (Array.isArray(value.items)) collect(value.items, referenced, transcluded);
}

/** Return linked and embedded target IDs in first-appearance order without duplicates. */
export function itemRelationships(body) {
  const referenced = new Set(), transcluded = new Set();
  if (typeof body === 'string' && body) collect(lexMarkdown(body), referenced, transcluded);
  return { referenced: [...referenced], transcluded: [...transcluded] };
}
