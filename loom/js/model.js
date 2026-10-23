/** Versioned Loom knowledge base and strict EDN interchange. */

import { EDNKeyword, readEDN, writeEDN } from '../../shared/js/edn-codec.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_KEYS = new Set(['id', 'title', 'body', 'tags', 'created-at', 'updated-at']);
const BASE_KEYS = new Set(['schema-version', 'items', 'workspace']);
const WORKSPACE_KEYS = new Set(['open-ids', 'active-id']);

function record(value, keys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${context} must be a map`);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${context} has an unknown field: ${key}`);
}

function isoTime(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${name} must be a UTC ISO timestamp`);
  }
  return value;
}

function itemValue(value) {
  record(value, ITEM_KEYS, 'Item');
  if (typeof value.id !== 'string' || !UUID.test(value.id)) throw new TypeError('Item ID must be a UUID string');
  if (typeof value.title !== 'string' || !value.title.trim()) throw new TypeError('Item title must be nonempty');
  if (typeof value.body !== 'string') throw new TypeError('Item body must be Markdown text');
  if (!Array.isArray(value.tags)) throw new TypeError('Item tags must be a vector');
  const tagNames = new Set();
  for (const tag of value.tags) {
    if (!(tag instanceof EDNKeyword)) throw new TypeError('Item tags must be EDN keywords');
    if (tagNames.has(tag.name)) throw new TypeError('Item tags must be unique');
    tagNames.add(tag.name);
  }
  const created = isoTime(value['created-at'], 'Item created-at');
  const updated = isoTime(value['updated-at'], 'Item updated-at');
  if (updated < created) throw new TypeError('Item updated-at precedes created-at');
  return { id: value.id, title: value.title, body: value.body, tags: [...value.tags], 'created-at': created, 'updated-at': updated };
}

/** Validate and copy an imported or in-memory knowledge base. */
export function validateKnowledgeBase(value) {
  record(value, BASE_KEYS, 'Knowledge base');
  if (value['schema-version'] !== 1) throw new TypeError('Unsupported Loom schema version');
  if (!Array.isArray(value.items)) throw new TypeError('Knowledge base items must be a vector');
  const items = value.items.map(itemValue);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new TypeError(`Duplicate item ID: ${item.id}`);
    ids.add(item.id);
  }
  record(value.workspace, WORKSPACE_KEYS, 'Workspace');
  const openIds = value.workspace['open-ids'];
  const activeId = value.workspace['active-id'];
  if (!Array.isArray(openIds)) throw new TypeError('Workspace open-ids must be a vector');
  if (openIds.some(id => typeof id !== 'string' || !ids.has(id)) || new Set(openIds).size !== openIds.length) {
    throw new TypeError('Workspace contains an invalid or duplicate item ID');
  }
  if (activeId !== null && !openIds.includes(activeId)) throw new TypeError('Workspace active ID must be open');
  return { 'schema-version': 1, items, workspace: { 'open-ids': [...openIds], 'active-id': activeId } };
}

/** Create a new empty knowledge base without persistent example data. */
export function emptyKnowledgeBase() {
  return { 'schema-version': 1, items: [], workspace: { 'open-ids': [], 'active-id': null } };
}

/** Add an item; the optional ID and timestamp make the operation testable. */
export function addItem(base, fields, { id = globalThis.crypto?.randomUUID?.(), now = new Date().toISOString() } = {}) {
  const current = validateKnowledgeBase(base);
  if (!id) throw new Error('Cryptographic UUID generation is unavailable');
  if (current.items.some(item => item.id === id)) throw new TypeError(`Duplicate item ID: ${id}`);
  const item = itemValue({ id, title: fields.title, body: fields.body ?? '', tags: fields.tags ?? [], 'created-at': now, 'updated-at': now });
  return { ...current, items: [...current.items, item] };
}

/** Change authored fields while keeping identity and creation time fixed. */
export function updateItem(base, id, changes, now = new Date().toISOString()) {
  const current = validateKnowledgeBase(base);
  if (Object.hasOwn(changes, 'id')) throw new TypeError('Item ID is immutable');
  for (const key of Object.keys(changes)) if (!['title', 'body', 'tags'].includes(key)) throw new TypeError(`Unsupported item edit: ${key}`);
  const index = current.items.findIndex(item => item.id === id);
  if (index < 0) throw new TypeError(`Unknown item ID: ${id}`);
  const items = [...current.items];
  items[index] = itemValue({ ...items[index], ...changes, 'updated-at': now });
  return { ...current, items };
}

/** Reorder items without changing any ID or content. */
export function reorderItems(base, orderedIds) {
  const current = validateKnowledgeBase(base);
  if (!Array.isArray(orderedIds) || orderedIds.length !== current.items.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new TypeError('Item order must contain every ID exactly once');
  }
  const byId = new Map(current.items.map(item => [item.id, item]));
  if (orderedIds.some(id => !byId.has(id))) throw new TypeError('Item order contains an unknown ID');
  return { ...current, items: orderedIds.map(id => byId.get(id)) };
}

/** Remove an item and its workspace entries; references in Markdown remain authored text. */
export function deleteItem(base, id) {
  const current = validateKnowledgeBase(base);
  if (!current.items.some(item => item.id === id)) throw new TypeError(`Unknown item ID: ${id}`);
  const openIds = current.workspace['open-ids'].filter(openId => openId !== id);
  const activeId = current.workspace['active-id'] === id ? (openIds.at(-1) ?? null) : current.workspace['active-id'];
  return { ...current, items: current.items.filter(item => item.id !== id), workspace: { 'open-ids': openIds, 'active-id': activeId } };
}

export function parseKnowledgeBase(source) { return validateKnowledgeBase(readEDN(source)); }
export function writeKnowledgeBase(base) { return writeEDN(validateKnowledgeBase(base)); }
