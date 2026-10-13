/** Interactive inspector and immutable query pipeline for evaluated SCI values. */

import { evaluateInNamespaceWithRaw, printCljsValue, scittleEval } from './scittle-runtime.js';

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
(defn child-info [label key-value value]
  {:label label :keyid (when (some? key-value) (register-value key-value))
   :valueid (register-value value) :pathsegment (pr-str key-value)})
(defn compact-value [v t size]
  (if-not (coll? v) (pr-str v)
    (str "#<" t (when size (str " " size)) ">")))
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
          (or (map? v) (vector? v) (set? v)) (count v)
          (list? v) (count v)
          (seq? v) (if (> (count sample) ${MAX_CHILDREN}) "${MAX_CHILDREN}+" (count sample))
          :else nil)]
    {:id (register-value v) :type t :display (compact-value v t size) :size size
     :truncated (or (= size "${MAX_CHILDREN}+") (and (number? size) (> size ${MAX_CHILDREN}))) :children entries}))
(defn lookup-path [value path]
  (if (empty? path) [true value]
    (let [key (first path)]
      (cond
        (map? value) (if (contains? value key)
                       (lookup-path (get value key) (rest path)) [false nil])
        (and (sequential? value) (integer? key) (<= 0 key))
          (let [sample (vec (take (inc key) value))]
            (if (< key (count sample)) (lookup-path (nth sample key) (rest path)) [false nil]))
        :else [false nil]))))
(defn condition-matches? [record path operator expected]
  (let [[present? actual] (lookup-path record path)]
    (case operator
          :missing (not present?)
          :nil (and present? (nil? actual))
          :eq (and present? (= actual expected))
          :neq (and present? (not= actual expected))
          :gt (and present? (number? actual) (number? expected) (> actual expected))
          :gte (and present? (number? actual) (number? expected) (>= actual expected))
          :lt (and present? (number? actual) (number? expected) (< actual expected))
          :lte (and present? (number? actual) (number? expected) (<= actual expected))
          :contains (and present? (string? actual) (string? expected)
                         (not= -1 (.indexOf actual expected)))
          false)))
(defn filter-many [data conditions]
  (if-not (coll? data) data
    (filter (fn [record]
      (first (reduce (fn [[result first?] [path operator expected combine]]
        (let [matched? (condition-matches? record path operator expected)]
          [(if first? matched? (if (= combine :OR) (or result matched?) (and result matched?))) false]))
        [false true] conditions))) data)))
(defn project-record [record paths]
  (if-not (map? record) record
    (reduce (fn [out path]
      (let [[present? value] (lookup-path record path)]
        (if present? (assoc-in out path value) out))) {} paths)))
(defn group-nested [records paths]
  (if (empty? paths) (vec records)
    (into {} (map (fn [[key rows]] [key (group-nested rows (rest paths))])
                  (group-by (fn [row]
                    (let [[present? value] (lookup-path row (first paths))]
                      (if present? value ::missing))) records)))))
(defn sort-records [data path direction]
  (if-not (coll? data) data
    (let [present (filter (fn [row] (first (lookup-path row path))) data)
          missing (remove (fn [row] (first (lookup-path row path))) data)
          sorted (sort-by (fn [row] (second (lookup-path row path))) present)]
      (vec (concat (if (= direction :desc) (reverse sorted) sorted) missing)))))
(defn table-model [data selected-paths]
  (when (and (coll? data) (not (map? data)))
    (let [sample (vec (take (inc ${MAX_CHILDREN}) data))
          rows (vec (take ${MAX_CHILDREN} sample))
          keys (vec (distinct (mapcat #(if (map? %) (keys %) []) rows)))
          other? (some (complement map?) rows)
          paths (when (seq selected-paths) selected-paths)
          columns (if paths
                    (map (fn [path] {:label (pr-str path) :pathid (register-value path)}) paths)
                    (concat (when other? [{:label "<value>" :special true}])
                            (map (fn [k] {:label (pr-str k) :keyid (register-value k)}) keys)))
          row-model (fn [row]
            (let [cells (if paths
                          (mapv (fn [path]
                                  (let [[present? value] (lookup-path row path)]
                                    {:present present? :valueid (when present? (register-value value))}))
                                paths)
                          (vec (concat
                            (when other?
                              [{:present (not (map? row)) :valueid (when-not (map? row) (register-value row))}])
                            (map (fn [k]
                                   (let [present? (and (map? row) (contains? row k))]
                                     {:present present? :valueid (when present? (register-value (get row k)))}))
                                 keys))))]
              {:id (register-value row) :cells cells}))]
      {:columns (vec columns)
       :rows (mapv row-model rows)
       :truncated (> (count sample) ${MAX_CHILDREN})})))
(defn records-in-groups [grouped]
  (if (map? grouped) (mapcat records-in-groups (vals grouped)) (seq grouped)))
(defn group-summary [grouped path operation]
  (let [records (vec (records-in-groups grouped))
        values (keep (fn [record]
          (let [[present? value] (lookup-path record path)]
            (when (and present? (number? value)) value))) records)
        aggregate (case operation
          :sum (reduce + 0 values)
          :average (if (seq values) (/ (reduce + 0 values) (count values)) nil)
          :minimum (when (seq values) (apply min values))
          :maximum (when (seq values) (apply max values))
          (count records))]
    {:count (count records) :aggregate aggregate}))`;

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

function parseLiteral(source, label) {
  const text = String(source || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return scittleEval(`(read-string ${JSON.stringify(text)})`);
}

function parsePaths(source) {
  const sources = String(source || '').split(/\n|;/).map(text => text.trim()).filter(Boolean);
  for (const text of sources) {
    parseLiteral(text, 'Path');
    if (!scittleEval(`(vector? (read-string ${JSON.stringify(text)}))`)) throw new Error(`Path must be a vector: ${text}`);
  }
  return scittleEval(`[${sources.join(' ')}]`);
}

function runPipeline(base, operations) {
  let result = base;
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (['project', 'group', 'sort'].includes(operation.type)) {
      const inputDescription = descriptor(register(result));
      if (inputDescription.type === 'sequence' && inputDescription.truncated) {
        throw new Error('This operation needs a finite sequence. The current lazy sequence exceeds the 200 item preview limit.');
      }
    }
    if (operation.type === 'filter') {
      const filters = [];
      while (operations[index]?.type === 'filter') filters.push(operations[index++]);
      index--;
      const conditions = filters.map(filter => {
        const pathId = register(parseLiteral(filter.path, 'Filter path'));
        const valueId = register(filter.operator === 'missing' || filter.operator === 'nil' ? null : parseLiteral(filter.value, 'Filter value'));
        return `[(value-at ${pathId}) :${filter.operator} (value-at ${valueId}) :${filter.combine || 'AND'}]`;
      }).join(' ');
      result = evaluateInNamespaceWithRaw(NS,
        `(filter-many (value-at ${register(result)}) [${conditions}])`).raw;
    } else if (operation.type === 'project') {
      const paths = parsePaths(operation.paths);
      const pathsId = register(paths);
      result = evaluateInNamespaceWithRaw(NS,
        `(mapv (fn [row] (project-record row (value-at ${pathsId}))) (value-at ${register(result)}))`).raw;
    } else if (operation.type === 'group') {
      const paths = parsePaths(operation.paths);
      if (!String(operation.paths || '').split(/\n|;/).some(text => text.trim())) throw new Error('Add at least one grouping path');
      const pathsId = register(paths);
      result = evaluateInNamespaceWithRaw(NS,
        `(group-nested (value-at ${register(result)}) (value-at ${pathsId}))`).raw;
    } else if (operation.type === 'sort') {
      const path = parseLiteral(operation.path, 'Sort path');
      const pathId = register(path);
      result = evaluateInNamespaceWithRaw(NS,
        `(sort-records (value-at ${register(result)}) (value-at ${pathId}) :${operation.direction})`).raw;
    }
  }
  return result;
}

function tableModel(value, paths = null) {
  const id = register(value);
  if (!paths) paths = scittleEval('[]');
  const pathId = register(paths);
  return cljCall(`(clj->js (table-model (value-at ${id}) (value-at ${pathId})))`);
}

function groupSummary(value, operation) {
  const id = register(value);
  const path = parseLiteral(operation.aggregatePath || '[]', 'Aggregate path');
  const pathId = register(path);
  const agg = operation.aggregate || 'count';
  return cljCall(`(clj->js (group-summary (value-at ${id}) (value-at ${pathId}) :${agg}))`);
}

function kindName(type, size) {
  const labels = { map: 'map', vector: 'vector', list: 'list', sequence: 'sequence', set: 'set', keyword: 'keyword', string: 'string', number: 'number', boolean: 'boolean', nil: 'nil', function: 'function', object: 'object' };
  return `${labels[type] || type}${size !== null && size !== undefined ? ` · ${size}` : ''}`;
}

function isStructuredType(type) {
  return ['map', 'vector', 'list', 'sequence', 'set'].includes(type);
}

function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = value;
    else if (key === 'disabled') node.disabled = value;
    else if (key === 'hidden') node.hidden = value;
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
    throw new Error('This lazy sequence exceeds the 200 item preview limit. Materialize a finite result before exporting it.');
  }
  return printCljsValue(value);
}

/** Mounts the Explorer controls and connects them to the existing workbook. */
export function createDataExplorer(ctx) {
  const overlay = document.querySelector('#data-explorer');
  if (!overlay) return { open() {} };
  const panel = overlay.querySelector('.data-explorer-panel');
  const header = overlay.querySelector('.data-explorer-header');
  const status = overlay.querySelector('.data-explorer-status');
  const views = overlay.querySelector('.data-explorer-views');
  let state = null;

  function report(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function open(sheetName, address) {
    const value = ctx.session.engine.evaluatedCell(sheetName, address);
    if (value.error) { ctx.flash(`Cannot explore ${sheetName}!${address}: ${value.error.message}`); return; }
    if (!value.available) { ctx.flash(`Cell ${sheetName}!${address} is empty or has no evaluated value.`); return; }
    initializeRuntime();
    const rootId = register(value.value);
    state = { sheetName, address, rootId, selectedId: rootId, selectedPath: [], operations: [], view: 'tree', result: value.value, expression: '', expressionResult: undefined, expressionError: '' };
    render();
    overlay.hidden = false;
    overlay.querySelector('[data-explorer-close]').focus();
  }

  function activeResult() { return state.expressionResult === undefined ? state.result : state.expressionResult; }
  function nodeFor(id, label, path, depth = 0) {
    let meta;
    try { meta = descriptor(id); }
    catch (error) { return element('div', { class: 'explorer-error', text: `${label}: ${error.message}` }); }
    const summary = element('div', { class: 'tree-node-summary' },
      isStructuredType(meta.type) && element('button', { class: 'tree-focus', text: 'Use as root', title: 'Use this node as the current exploration root', onclick: () => { state.selectedId = id; state.selectedPath = path; state.expressionResult = undefined; applyAndRender(); } }),
      element('span', { class: 'tree-label', text: label }),
      element('span', { class: 'tree-type', text: kindName(meta.type, meta.size) }),
      element('code', { class: 'tree-value', text: meta.display }),
      element('button', { class: 'tree-copy', text: 'Copy EDN', onclick: () => {
        try { copyText(ednForExport(globalThis[REGISTRY].values[meta.id])).then(() => report('Subtree copied as EDN.')).catch(err => report(err.message, true)); }
        catch (error) { report(error.message, true); }
      } }));
    const box = element('div', { class: `tree-node depth-${Math.min(depth, 5)}` }, summary);
    if (meta.children?.length) {
      const details = element('details', { class: 'tree-children' });
      const summary = element('summary', { text: `${meta.children.length} children${meta.truncated ? ' (showing first 200)' : ''}` });
      details.append(summary);
      const loadChildren = () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = 'true';
        for (const child of meta.children) details.append(nodeFor(child.valueid, child.label, [...path, child.pathsegment], depth + 1));
      };
      details.addEventListener('toggle', loadChildren);
      summary.addEventListener('click', () => setTimeout(loadChildren, 0));
      box.append(details);
    }
    return box;
  }

  function currentDescriptor() { return descriptor(register(activeResult())); }

  function renderTree() {
    views.append(nodeFor(state.rootId, `${state.sheetName}!${state.address}`, [], 0));
    const selected = descriptor(state.selectedId);
    if (state.selectedId !== state.rootId) views.prepend(element('div', { class: 'explorer-note', text: `Selected node path: ${state.selectedPath.join(' → ') || 'root'} · ${selected.display}` }));
  }

  function renderTable() {
    const data = activeResult();
    let model;
    try {
      const projection = [...state.operations].reverse().find(operation => operation.type === 'project');
      model = tableModel(data, projection ? parsePaths(projection.paths) : []);
    }
    catch (error) { views.append(element('div', { class: 'explorer-error', text: error.message })); return; }
    if (!model) { views.append(element('div', { class: 'explorer-empty', text: 'This value has no row-oriented table representation. Use Tree to inspect it.' })); return; }
    const table = element('table', { class: 'explorer-table' });
    const head = element('tr', {}, ...model.columns.map(column => element('th', { text: column.label })));
    table.append(element('thead', {}, head));
    const body = element('tbody');
    for (const [rowIndex, row] of model.rows.entries()) {
      const tr = element('tr');
      for (const [columnIndex, cell] of row.cells.entries()) {
        if (!cell.present) { tr.append(element('td', { class: 'missing-value', text: '— missing' })); continue; }
        const desc = descriptor(cell.valueid);
        const value = element('code', { text: desc.display, title: desc.type });
        const td = element('td', {}, value);
        if (desc.children?.length) {
          const nestedValue = globalThis[REGISTRY].values[cell.valueid];
          let nestedModel = null;
          try { nestedModel = tableModel(nestedValue); } catch { /* The tree fallback remains available. */ }
          if (nestedModel) {
            let expandedRow = null;
            td.append(element('button', { class: 'nested-rows-button', text: 'Expand as rows', onclick: () => {
              if (expandedRow) { expandedRow.remove(); expandedRow = null; return; }
              const details = element('td', { colspan: String(model.columns.length) });
              details.append(element('div', { class: 'explorer-note', text: `Parent row ${rowIndex + 1} · ${model.columns[columnIndex]?.label || 'value'}` }));
              details.append(tableFromModel(nestedModel));
              expandedRow = element('tr', { class: 'nested-data-row' }, details);
              tr.after(expandedRow);
            } }));
          }
          const details = element('details', { class: 'table-detail' });
          details.append(element('summary', { text: 'details' }));
          details.append(nodeFor(cell.valueid, 'value', [], 0)); td.append(details);
        }
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body); views.append(table);
    if (model.truncated) views.append(element('div', { class: 'explorer-note', text: 'Showing first 200 rows. The underlying result remains unchanged.' }));
  }

  function tableFromModel(model) {
    const nested = element('table', { class: 'explorer-table nested-table' });
    nested.append(element('thead', {}, element('tr', {}, ...model.columns.map(column => element('th', { text: column.label })))));
    const body = element('tbody');
    for (const row of model.rows) {
      const tr = element('tr');
      for (const cell of row.cells) {
        if (!cell.present) tr.append(element('td', { class: 'missing-value', text: '— missing' }));
        else tr.append(element('td', {}, element('code', { text: descriptor(cell.valueid).display })));
      }
      body.append(tr);
    }
    nested.append(body);
    return nested;
  }

  function renderGroups() {
    const grouped = activeResult();
    const descriptorValue = descriptor(register(grouped));
    if (descriptorValue.type !== 'map') {
      views.append(element('div', { class: 'explorer-empty', text: 'Add and apply a Group operation to view nested groups here.' })); return;
    }
    const groupOperation = [...state.operations].reverse().find(operation => operation.type === 'group') || { aggregate: 'count', aggregatePath: '[]' };
    function groupNode(id, label, depth) {
      const meta = descriptor(id);
      const summary = groupSummary(globalThis[REGISTRY].values[id], groupOperation);
      const box = element('details', { class: 'group-node' });
      const summaryElement = element('summary', {}, element('b', { text: label }), element('span', { text: ` ${summary.count} records · ${groupOperation.aggregate || 'count'}: ${summary.aggregate ?? '—'}` }));
      box.append(summaryElement);
      const loadChildren = () => {
        if (!box.open || box.dataset.loaded) return;
        box.dataset.loaded = 'true';
        if (meta.type === 'map') for (const child of meta.children || []) box.append(groupNode(child.valueid, child.label, depth + 1));
        else {
          const leaf = element('div', { class: 'group-leaf' });
          for (const child of meta.children || []) leaf.append(nodeFor(child.valueid, child.label, [], depth + 1));
          box.append(leaf);
        }
      };
      box.addEventListener('toggle', loadChildren);
      summaryElement.addEventListener('click', () => setTimeout(loadChildren, 0));
      return box;
    }
    for (const child of descriptorValue.children || []) views.append(groupNode(child.valueid, child.label, 0));
  }

  function addOperation(type) {
    const defaults = {
      filter: { type, path: '[:status]', operator: 'eq', value: ':active', combine: 'AND' },
      project: { type, paths: '[:name]\n[:status]' },
      group: { type, paths: '[:category]\n[:status]', aggregatePath: '[:amount]', aggregate: 'sum' },
      sort: { type, path: '[:name]', direction: 'asc' },
    };
    state.operations.push(defaults[type]); state.expressionResult = undefined; applyAndRender();
  }

  function opControl(operation, key, label, multiline = false) {
    const field = element(multiline ? 'textarea' : 'input', { class: 'pipeline-field', 'aria-label': label, value: operation[key] ?? '' });
    field.value = operation[key] ?? '';
    field.addEventListener('change', () => { operation[key] = field.value; state.expressionResult = undefined; applyAndRender(); });
    return element('label', { class: 'pipeline-control' }, element('span', { text: label }), field);
  }

  function selectControl(operation, key, label, options) {
    const select = element('select', { class: 'pipeline-field', 'aria-label': label });
    for (const [value, text] of options) select.append(element('option', { value, text }));
    select.value = operation[key];
    select.addEventListener('change', () => { operation[key] = select.value; state.expressionResult = undefined; applyAndRender(); });
    return element('label', { class: 'pipeline-control' }, element('span', { text: label }), select);
  }

  function renderPipeline() {
    const add = element('div', { class: 'pipeline-add' },
      element('span', { text: 'Add operation' }),
      ...[['filter', 'Filter'], ['project', 'Project fields'], ['group', 'Group'], ['sort', 'Sort']].map(([type, label]) => element('button', { text: label, onclick: () => addOperation(type) })));
    views.append(add);
    if (!state.operations.length) views.append(element('div', { class: 'explorer-empty', text: `No transformations. Selected root: ${state.selectedPath.join(' → ') || 'cell value'}.` }));
    state.operations.forEach((operation, index) => {
      const controls = [element('b', { text: `${index + 1}. ${operation.type}` })];
      if (operation.type === 'filter') controls.push(opControl(operation, 'path', 'Nested path'), selectControl(operation, 'operator', 'Condition', [['eq', 'equals'], ['neq', 'does not equal'], ['gt', 'greater than'], ['gte', 'at least'], ['lt', 'less than'], ['lte', 'at most'], ['contains', 'string contains'], ['missing', 'is missing'], ['nil', 'is explicit nil']]), ...(operation.operator === 'missing' || operation.operator === 'nil' ? [] : [opControl(operation, 'value', 'Clojure value')]), selectControl(operation, 'combine', 'Combine filters', [['AND', 'AND'], ['OR', 'OR']]));
      else if (operation.type === 'project') controls.push(opControl(operation, 'paths', 'Paths (one EDN vector per line)', true));
      else if (operation.type === 'group') controls.push(opControl(operation, 'paths', 'Group paths (one EDN vector per line)', true), opControl(operation, 'aggregatePath', 'Aggregate path'), selectControl(operation, 'aggregate', 'Aggregate', [['count', 'Count'], ['sum', 'Sum'], ['average', 'Average'], ['minimum', 'Minimum'], ['maximum', 'Maximum']]));
      else controls.push(opControl(operation, 'path', 'Nested path'), selectControl(operation, 'direction', 'Order', [['asc', 'Ascending'], ['desc', 'Descending']]));
      controls.push(element('div', { class: 'pipeline-actions' },
        element('button', { text: '↑', title: 'Move operation up', disabled: index === 0, onclick: () => moveOperation(index, -1) }),
        element('button', { text: '↓', title: 'Move operation down', disabled: index === state.operations.length - 1, onclick: () => moveOperation(index, 1) }),
        element('button', { text: 'Remove', onclick: () => { state.operations.splice(index, 1); applyAndRender(); } })));
      views.append(element('section', { class: 'pipeline-operation' }, ...controls));
    });
  }

  function moveOperation(index, delta) {
    const [operation] = state.operations.splice(index, 1);
    state.operations.splice(index + delta, 0, operation);
    state.expressionResult = undefined; applyAndRender();
  }

  function renderExpression() {
    const help = element('p', { class: 'explorer-note', text: 'Available bindings: root (original cell value), selected-node, records (selected node), query-result (visual pipeline output). Evaluation runs in the existing Scittle/SCI runtime; it is isolated from workbook formulas.' });
    const editor = element('textarea', { class: 'explorer-expression', 'aria-label': 'ClojureScript transformation', spellcheck: 'false' });
    editor.value = state.expression;
    editor.addEventListener('input', () => { state.expression = editor.value; });
    const run = element('button', { text: 'Evaluate expression', onclick: () => {
      try {
        const result = evaluateInNamespaceWithRaw(NS,
          `(let [root (value-at ${state.rootId}) selected-node (value-at ${state.selectedId}) records selected-node query-result (value-at ${register(state.result)})] ${state.expression})`);
        state.expressionResult = result.raw; state.expressionError = ''; report('Expression result updated.'); render();
      } catch (error) { state.expressionError = error.message; render(); }
    } });
    views.append(help, editor, run);
    if (state.expressionError) views.append(element('pre', { class: 'explorer-error', text: state.expressionError }));
    if (state.expressionResult !== undefined) {
      let preview;
      try { preview = ednForExport(state.expressionResult); } catch (error) { preview = error.message; }
      views.append(element('div', { class: 'explorer-note', text: `Expression output: ${preview}` }));
    }
  }

  function applyAndRender() {
    try {
      state.result = runPipeline(globalThis[REGISTRY].values[state.selectedId], state.operations);
      report(`${descriptor(register(state.result)).type} result · ${state.operations.length} operation${state.operations.length === 1 ? '' : 's'}`);
    } catch (error) { state.result = globalThis[REGISTRY].values[state.selectedId]; report(error.message, true); }
    render();
  }

  function render() {
    if (!state) return;
    header.replaceChildren(
      element('div', {}, element('b', { text: `Explore Data · ${state.sheetName}!${state.address}` }), element('div', { class: 'explorer-root-path', text: `Current root path: ${state.selectedPath.length ? `[${state.selectedPath.join(' ')}]` : '[]'} (cell value)` })),
      element('div', { class: 'explorer-header-actions' },
        element('button', { text: 'Copy path', onclick: () => copyText(state.selectedPath.length ? `[${state.selectedPath.join(' ')}]` : '[]').then(() => report('Current path copied.')).catch(error => report(error.message, true)) }),
        element('button', { text: 'Copy result EDN', onclick: () => {
          try { copyText(ednForExport(activeResult())).then(() => report('Current result copied as EDN.')).catch(error => report(error.message, true)); }
          catch (error) { report(error.message, true); }
        } }),
        element('button', { text: 'Reset', onclick: () => { state.selectedId = state.rootId; state.selectedPath = []; state.operations = []; state.expressionResult = undefined; state.expressionError = ''; applyAndRender(); } }),
        element('button', { text: '×', title: 'Close data explorer', 'data-explorer-close': '', onclick: close })));
    overlay.querySelector('.explorer-location').textContent = `Source snapshot: ${state.sheetName}!${state.address}`;
    const result = activeResult();
    overlay.querySelector('.explorer-count').textContent = `Rows before: ${collectionCount(globalThis[REGISTRY].values[state.selectedId])} · after: ${collectionCount(result)}`;
    const nav = overlay.querySelector('.explorer-nav');
    nav.replaceChildren(...[['tree', 'Tree'], ['table', 'Table'], ['groups', 'Grouped'], ['pipeline', 'Pipeline'], ['expression', 'ClojureScript']].map(([key, label]) => element('button', { text: label, class: state.view === key ? 'active' : '', onclick: () => { state.view = key; render(); } })));
    views.replaceChildren();
    if (state.view === 'tree') renderTree();
    else if (state.view === 'table') renderTable();
    else if (state.view === 'groups') renderGroups();
    else if (state.view === 'pipeline') renderPipeline();
    else renderExpression();
    if (state.expressionResult !== undefined && state.view !== 'expression') views.prepend(element('div', { class: 'explorer-note' }, element('span', { text: 'Showing custom expression result · ' }), element('button', { text: 'Show visual result', onclick: () => { state.expressionResult = undefined; render(); } })));
  }

  function collectionCount(value) {
    const meta = descriptor(register(value));
    return meta.size ?? 'scalar';
  }

  function close() {
    overlay.hidden = true;
    state = null;
    globalThis[REGISTRY]?.values.splice(0);
    status.textContent = ''; status.classList.remove('error');
  }

  overlay.querySelector('[data-explorer-close]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

  return { open };
}
