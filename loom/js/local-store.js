/** Automatic browser-local persistence for the Loom knowledge base. */

import { parseKnowledgeBase, writeKnowledgeBase } from './model.js';

export const LOCAL_STORAGE_KEY = 'loom.knowledge-base';

export function readLocalKnowledgeBase(storage) {
  if (!storage) return null;
  try {
    const source = storage.getItem(LOCAL_STORAGE_KEY);
    return source ? parseKnowledgeBase(source) : null;
  } catch {
    return null;
  }
}

export function writeLocalKnowledgeBase(storage, base) {
  if (!storage) return false;
  try {
    storage.setItem(LOCAL_STORAGE_KEY, writeKnowledgeBase(base));
    return true;
  } catch {
    return false;
  }
}
