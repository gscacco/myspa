/** Compact tree inspector for evaluated ClojureScript values. */

import { printCljsValue, scittleEval } from './scittle-runtime.js';

const NS = 'foglio.data-explorer';
const REGISTRY = '__foglioDataExplorer';
const MAX_CHILDREN = 200;
let runtimeReady = false;

const CORE = `(ns ${NS})
(defn register-value [value]
  (let [values (.-values js/globalThis.${REGISTRY}) id (.-length values)]
    (.push values value)
    id))
(defn value-at [id] (aget (.-values js/globalThis.${REGISTRY}) id))
(defn value-type [v]
  (cond (nil? v) "nil" (keyword? v) "keyword" (string? v) "string"
        (number? v) "number" (boolean? v) "boolean" (map? v) "map"
        (vector? v) "vector" (set? v) "set" (list? v) "list"
        (seq? v) "sequence" (fn? v) "function" :else "object"))
(defn child-info [label pathsegment value]
  {:label label :valueid (register-value value) :pathsegment (pr-str pathsegment)})
(defn compact-value [v]
  (cond
    (map? v) (if (empty? v) "{}" "{…}")
    (vector? v) (if (empty? v) "[]" "[…]" )
    (set? v) (if (empty? v) "#{}" "#{…}")
    (list? v) (if (empty? v) "()" "(…)")
    (seq? v) "(…)"
    :else (pr-str v)))
(defn describe-value [v]
  (let [t (value-type v)
        sample (cond
          (map? v) (mapv (fn [[k x]] (child-info (pr-str k) k x)) (take ${MAX_CHILDREN} v))
          (or (vector? v) (list? v) (seq? v) (set? v))
            (mapv (fn [[i x]] (child-info (str "[" i "]") i x))
                  (map-indexed vector (take (inc ${MAX_CHILDREN}) v)))
          :else [])
        entries (vec (take ${MAX_CHILDREN} sample))
        size (cond
          (or (map? v) (vector? v) (set? v) (list? v)) (count v)
          (seq? v) (if (> (count sample) ${MAX_CHILDREN}) "${MAX_CHILDREN}+" (count sample))
          :else nil)]
    {:id (register-value v) :type t :display (compact-value v) :size size
     :truncated (or (= size "${MAX_CHILDREN}+") (and (number? size) (> size ${MAX_CHILDREN})))
     :children entries}))`;

function initializeRuntime() {
  if (!globalThis[REGISTRY]) globalThis[REGISTRY] = { values: [] };
  if (!runtimeReady) {
    scittleEval(CORE);
    runtimeReady = true;
  }
}

function cljCall(source) {
  initializeRuntime();
  return scittleEval(`(ns ${NS}) (do ${source})`);
}

function register(value) {
  const id = globalThis[REGISTRY].values.length;
  globalThis[REGISTRY].values.push(value);
  return id;
}

function descriptor(id) {
  return cljCall(`(clj->js (describe-value (value-at ${id})))`);
}

function typeName(type, size) {
  const label = { map: 'map', vector: 'vector', list: 'list', sequence: 'sequence', set: 'set', keyword: 'keyword', string: 'string', number: 'number', boolean: 'boolean', nil: 'nil', function: 'function', object: 'object' }[type] || type;
  return size === null || size === undefined ? label : `${label} · ${size}`;
}

function isStructured(type) {
  return ['map', 'vector', 'list', 'sequence', 'set'].includes(type);
}

function cellExpression(sheetName, address) {
  return `($ ${JSON.stringify(`${sheetName}!${address}`)})`;
}

function childExpression(parent, parentType, pathSegment) {
  if (['list', 'sequence', 'set'].includes(parentType)) return `(nth (seq ${parent}) ${pathSegment})`;
  return `(get ${parent} ${pathSegment})`;
}

function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = element('textarea', { value: text });
  input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.append(input); input.select();
  const copied = document.execCommand?.('copy') || false;
  input.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard access is unavailable'));
}

function ednForExport(value) {
  const meta = descriptor(register(value));
  if (meta.type === 'sequence' && meta.truncated) {
    throw new Error('This lazy sequence exceeds the 200 item preview limit.');
  }
  return printCljsValue(value);
}

/** Mounts the tree inspector and connects it to the existing workbook. */
export function createDataExplorer(ctx) {
  const overlay = document.querySelector('#data-explorer');
  if (!overlay) return { open() {} };
  const status = overlay.querySelector('.data-explorer-status');
  const tree = overlay.querySelector('.data-explorer-tree');
  let state = null;

  function report(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function selectionLabel(path) {
    return path.length ? `Selected path: ${path.join(' → ')}` : 'Selected path: root';
  }

  function selectNode(id, path, expression, summary) {
    state.selectedNodeId = id;
    state.selectedPath = path;
    state.selectedExpression = expression;
    tree.querySelectorAll('.tree-node-summary.selected').forEach(node => {
      node.classList.remove('selected');
      node.setAttribute('aria-selected', 'false');
    });
    summary.classList.add('selected');
    summary.setAttribute('aria-selected', 'true');
    overlay.querySelector('.explorer-selected-path').textContent = selectionLabel(path);
  }

  function nodeFor(id, label, path, depth, expression) {
    let meta;
    try { meta = descriptor(id); }
    catch (error) { return element('div', { class: 'explorer-error', text: `${label}: ${error.message}` }); }

    const expandable = isStructured(meta.type) && meta.children?.length > 0;
    const selectionKey = expression;
    const selected = state.selectedExpression === selectionKey;
    const summary = element(expandable ? 'summary' : 'div', {
      class: `tree-node-summary${selected ? ' selected' : ''}`,
      tabindex: '0',
      'aria-selected': selected ? 'true' : 'false',
      onclick: () => {
        selectNode(id, path, expression, summary);
      },
      onkeydown: event => {
        if (!expandable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          selectNode(id, path, expression, summary);
        }
      },
    },
      element('span', { class: 'tree-label', text: label }),
      element('span', { class: 'tree-type', text: typeName(meta.type, meta.size) }),
      element('code', { class: 'tree-value', text: meta.display }));

    if (expandable) {
      const box = element('details', { class: `tree-node depth-${Math.min(depth, 8)}` }, summary);
      let loaded = false;
      box.addEventListener('toggle', () => {
        if (!box.open || loaded) return;
        loaded = true;
        for (const child of meta.children) {
          const childPath = [...path, child.pathsegment];
          const expressionForChild = childExpression(expression, meta.type, child.pathsegment);
          box.append(nodeFor(child.valueid, child.label, childPath, depth + 1, expressionForChild));
        }
      });
      return box;
    }

    return element('div', { class: `tree-node depth-${Math.min(depth, 8)}` }, summary);
  }

  function render() {
    if (!state) return;
    overlay.querySelector('.explorer-location').textContent = `Source snapshot: ${state.sheetName}!${state.address}`;
    overlay.querySelector('.explorer-selected-path').textContent = selectionLabel(state.selectedPath);
    tree.replaceChildren(nodeFor(
      state.rootId,
      `${state.sheetName}!${state.address}`,
      [],
      0,
      cellExpression(state.sheetName, state.address),
    ));
  }

  function copySelectedEdn() {
    try {
      const value = globalThis[REGISTRY].values[state.selectedNodeId];
      copyText(ednForExport(value)).then(() => report('Selected value copied as EDN.')).catch(error => report(error.message, true));
    } catch (error) { report(error.message, true); }
  }

  function copySelectedExpression() {
    copyText(state.selectedExpression).then(() => report('Select expression copied.')).catch(error => report(error.message, true));
  }

  function open(sheetName, address) {
    const value = ctx.session.engine.evaluatedCell(sheetName, address);
    if (value.error) { ctx.flash(`Cannot explore ${sheetName}!${address}: ${value.error.message}`); return; }
    if (!value.available) { ctx.flash(`Cell ${sheetName}!${address} is empty or has no evaluated value.`); return; }
    initializeRuntime();
    const rootId = register(value.value);
    const expression = cellExpression(sheetName, address);
    state = { sheetName, address, rootId, selectedNodeId: rootId, selectedPath: [], selectedExpression: expression };
    render();
    overlay.hidden = false;
    overlay.querySelector('[data-explorer-close]').focus();
  }

  function close() {
    overlay.hidden = true;
    state = null;
    globalThis[REGISTRY]?.values.splice(0);
    status.textContent = '';
    status.classList.remove('error');
  }

  overlay.querySelector('[data-copy-selected-edn]').addEventListener('click', copySelectedEdn);
  overlay.querySelector('[data-copy-select-expression]').addEventListener('click', copySelectedExpression);
  overlay.querySelector('[data-copy-path]').addEventListener('click', () => {
    copyText(state.selectedPath.length ? `[${state.selectedPath.join(' ')}]` : '[]')
      .then(() => report('Selected path copied.')).catch(error => report(error.message, true));
  });
  overlay.querySelector('[data-explorer-close]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  });

  return { open };
}
