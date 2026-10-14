/** Small ordered registry for the application's supported ClojureScript hooks. */

const SUPPORTED_EVENTS = new Set([
  'on-selection-change',
  'on-cell-source-change',
  'on-cell-value-change',
  'on-cell-evaluation-error',
]);

function eventName(event) {
  const name = String(event ?? '').replace(/^:/, '');
  if (!SUPPORTED_EVENTS.has(name)) throw new Error(`Unsupported hook event: ${name || '(empty)'}`);
  return name;
}

/**
 * Create an in-memory hook registry. Dispatch always uses a snapshot, so
 * registration changes made by a callback affect the next event only.
 */
export function createEventHooks() {
  const registrations = new Map();

  function listeners(event) {
    const name = eventName(event);
    if (!registrations.has(name)) registrations.set(name, []);
    return registrations.get(name);
  }

  function add(event, callback) {
    if (typeof callback !== 'function') throw new TypeError('A hook must be a function');
    const list = listeners(event);
    if (list.includes(callback)) return false;
    list.push(callback);
    return true;
  }

  function remove(event, callback) {
    const list = listeners(event);
    const index = list.indexOf(callback);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  function clear(event) {
    const list = listeners(event);
    const removed = list.length;
    list.length = 0;
    return removed;
  }

  function list(event) { return Object.freeze([...listeners(event)]); }

  function run(event, payload, invoke, onError = () => {}) {
    const name = eventName(event);
    const snapshot = [...listeners(name)];
    for (const callback of snapshot) {
      try { invoke(callback, payload); }
      catch (error) {
        try { onError(error, { event: name, callback }); }
        catch { /* Diagnostics must not interrupt the remaining hooks. */ }
      }
    }
    return snapshot.length;
  }

  return Object.freeze({ add, remove, clear, list, run });
}

export { SUPPORTED_EVENTS };
