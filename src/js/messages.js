/** Bounded, UI-independent store for application diagnostics and feedback. */

export const MESSAGE_LIMITS = Object.freeze({
  maxMessages: 2000,
  maxChars: 2 * 1024 * 1024,
  maxEntryChars: 16 * 1024,
});

const MAX_FIELD_CHARS = 8192;
const MAX_STACK_CHARS = 8192;
const LEVELS = new Set(['info', 'warn', 'error', 'debug']);

function cut(value, limit = MAX_FIELD_CHARS) {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(0, Math.max(0, limit - 1)) + '…' : text;
}

function safeValue(value, depth = 0, seen = new WeakSet(), budget = { nodes: 512, chars: MAX_FIELD_CHARS }) {
  if (budget.nodes-- <= 0) return '[Value truncated]';
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value !== 'string') return value;
    const result = cut(value, Math.max(0, Math.min(2048, budget.chars)));
    budget.chars = Math.max(0, budget.chars - result.length);
    return result;
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return `[Function${value.name ? ` ${value.name}` : ''}]`;
  if (value instanceof Error) return {
    name: cut(value.name, 128), message: safeValue(value.message, depth + 1, seen, budget),
    stack: safeValue(cut(value.stack, MAX_STACK_CHARS), depth + 1, seen, budget),
  };
  if (depth >= 3) return '[Nested value omitted]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 40).map(item => safeValue(item, depth + 1, seen, budget));
  if (value instanceof Map) {
    const result = [];
    for (const [key, item] of value) {
      if (result.length >= 40 || budget.nodes <= 0) break;
      result.push([safeValue(key, depth + 1, seen, budget), safeValue(item, depth + 1, seen, budget)]);
    }
    return result;
  }
  if (value instanceof Set) {
    const result = [];
    for (const item of value) {
      if (result.length >= 40 || budget.nodes <= 0) break;
      result.push(safeValue(item, depth + 1, seen, budget));
    }
    return result;
  }
  const result = {};
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (count++ >= 40 || budget.nodes <= 0) break;
    try { result[cut(key, 128)] = safeValue(value[key], depth + 1, seen, budget); }
    catch { result[cut(key, 128)] = '[Unavailable]'; }
  }
  return result;
}

function boundedJSON(value) {
  try { return cut(JSON.stringify(safeValue(value)), MAX_FIELD_CHARS); }
  catch { return '[Details unavailable]'; }
}

function entrySize(message) {
  return message.message.length + String(message.category).length
    + (message.source == null ? 0 : boundedJSON(message.source).length) + (message.details?.length || 0)
    + (message.exception?.name?.length || 0) + (message.exception?.message?.length || 0)
    + (message.exception?.stack?.length || 0) + 64;
}

function freezeValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeValue(item);
  return Object.freeze(value);
}

/**
 * Create a bounded in-memory store. Subscriber errors are isolated from the
 * code that logged the message, and updates are coalesced into one microtask.
 */
export function createMessagesStore(limits = {}) {
  const cap = { ...MESSAGE_LIMITS, ...limits };
  let retained = [];
  let chars = 0;
  let discarded = 0;
  let nextId = 1;
  const listeners = new Set();
  let scheduled = false;
  let pending = { added: [], removed: [], cleared: false };

  function notifySoon() {
    if (scheduled) return;
    scheduled = true;
    const flush = () => {
      scheduled = false;
      const change = { ...pending, stats: getStats() };
      pending = { added: [], removed: [], cleared: false };
      for (const listener of [...listeners]) {
        try { listener(change); } catch { /* A view must never disrupt logging. */ }
      }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(flush);
    else Promise.resolve().then(flush);
  }

  function log(level, message, metadata = {}) {
    try {
      const normalizedLevel = String(level || 'info').replace(/^:/, '').toLowerCase();
      const error = message instanceof Error ? message : metadata.exception;
      const exception = error ? {
        name: cut(error.name || 'Error', 128),
        message: cut(error.message || String(error)),
        stack: cut(error.stack || '', MAX_STACK_CHARS),
      } : null;
      let source = null;
      if (metadata.source != null) {
        const sourceJSON = cut(boundedJSON(metadata.source), MAX_FIELD_CHARS / 2);
        try { source = JSON.parse(sourceJSON); }
        catch { source = sourceJSON; }
      }
      let item = {
        id: nextId++,
        timestamp: new Date().toISOString(),
        level: LEVELS.has(normalizedLevel) ? normalizedLevel : 'info',
        category: cut(String(metadata.category || 'app').replace(/^:/, ''), 64),
        message: cut(message instanceof Error ? message.message : message, MAX_FIELD_CHARS / 2),
        ...(source ? { source } : {}),
        ...(metadata.details !== undefined ? { details: boundedJSON(metadata.details) } : {}),
        ...(exception ? { exception } : {}),
      };
      let size = entrySize(item);
      if (size > cap.maxEntryChars) {
        const excess = size - cap.maxEntryChars;
        if (item.exception?.stack) item.exception.stack = cut(item.exception.stack, Math.max(128, item.exception.stack.length - excess));
        size = entrySize(item);
        if (size > cap.maxEntryChars && item.exception?.message) item.exception.message = cut(item.exception.message, Math.max(128, item.exception.message.length - (size - cap.maxEntryChars)));
        size = entrySize(item);
        if (size > cap.maxEntryChars && item.details) item.details = cut(item.details, Math.max(128, item.details.length - (size - cap.maxEntryChars)));
        size = entrySize(item);
        if (size > cap.maxEntryChars) item.message = cut(item.message, Math.max(128, item.message.length - (size - cap.maxEntryChars)));
        size = entrySize(item);
      }
      freezeValue(item.source);
      freezeValue(item.exception);
      Object.freeze(item);
      retained.push(item);
      chars += size;
      pending.added.push(item);
      while (retained.length > cap.maxMessages || chars > cap.maxChars) {
        const removed = retained.shift();
        chars -= entrySize(removed);
        discarded++;
        if (pending.added[0]?.id === removed.id) pending.added.shift();
        else pending.removed.push({ id: removed.id, category: removed.category });
      }
      notifySoon();
      return item;
    } catch {
      // Logging is deliberately best-effort and has no recursive error path.
      return null;
    }
  }

  function clear() {
    retained = [];
    chars = 0;
    pending.added = [];
    pending.removed = [];
    pending.cleared = true;
    notifySoon();
  }

  function getStats() {
    return { retained: retained.length, discarded, chars };
  }

  return {
    log,
    info: (message, metadata) => log('info', message, metadata),
    warn: (message, metadata) => log('warn', message, metadata),
    error: (message, metadata) => log('error', message, metadata),
    debug: (message, metadata) => log('debug', message, metadata),
    clear,
    getMessages: () => retained.slice(),
    getStats,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
