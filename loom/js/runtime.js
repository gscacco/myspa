/** Session-scoped Scittle bridge. Snippets are trusted code with browser JS access. */

import { readEDN } from '../../shared/js/edn-codec.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORE_SOURCE = `(ns loom.core)
(defn- item-map [raw]
  (when raw
    (update (js->clj raw :keywordize-keys true) :tags #(mapv keyword %))))
(defn items
  ([] (mapv item-map (.items js/globalThis.__loomBridge nil)))
  ([opts] (let [tag (:tag opts)]
            (mapv item-map (.items js/globalThis.__loomBridge (when tag (name tag)))))))
(defn item [id] (item-map (.item js/globalThis.__loomBridge id)))
(defn link [id label]
  (if (.validLink js/globalThis.__loomBridge id)
    [:a {:href (str "loom:" id)} label]
    (throw (js/Error. "Loom link requires a valid item UUID"))))
(defn data [value] {"loom/data" value})
(defn normalize [value]
  (cond
    (map? value) (into {} (map (fn [[key child]] [key (normalize child)]) value))
    (or (sequential? value) (set? value))
      (let [values (vec (take 1001 value))]
        (when (> (count values) 1000) (throw (js/Error. "Snippet result limit exceeded")))
        (mapv normalize values))
    :else value))`;

export function createSnippetRuntime({ getItems, scittle = globalThis.scittle, host = globalThis }) {
  const evaluate = scittle?.core?.eval_string;
  if (typeof evaluate !== 'function') throw new Error('Scittle is not available');
  let initialized = false;

  function run(source) {
    if (typeof source !== 'string') throw new TypeError('Snippet source must be text');
    const dependencies = new Set();
    const items = getItems();
    host.__loomBridge = {
      items(tag) {
        dependencies.add(tag ? `tag:${tag}` : 'index');
        return items.filter(item => !tag || item.tags.some(value => value.name === tag))
          .map(item => ({ id: item.id, title: item.title, tags: item.tags.map(value => value.name) }));
      },
      item(id) {
        dependencies.add(`item:${id}`);
        const item = items.find(value => value.id === id);
        return item ? { ...item, tags: item.tags.map(value => value.name) } : null;
      },
      validLink: id => typeof id === 'string' && UUID.test(id),
    };
    try {
      if (!initialized) { evaluate(CORE_SOURCE); initialized = true; }
      evaluate('(ns loom.user (:require [loom.core]))');
      const result = evaluate(`(pr-str (loom.core/normalize (do ${source})))`);
      return { value: readEDN(result), dependencies };
    } finally { delete host.__loomBridge; }
  }

  return { run };
}
