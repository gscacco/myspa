/** Session-scoped Scittle bridge. Snippets are trusted code with browser JS access. */

import { readEDN } from '../../shared/js/edn-codec.js';
import { itemRelationships } from './item-relationships.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const API_SOURCE = `(ns loom)
(defn- item-map [raw]
  (when raw
    (update (js->clj raw :keywordize-keys true) :tags #(mapv keyword %))))
(defn items
  ([] (mapv item-map (.items js/globalThis.__loomBridge nil)))
  ([opts] (let [tag (:tag opts)]
            (mapv item-map (.items js/globalThis.__loomBridge (when tag (name tag)))))))
(defn item [id] (item-map (.item js/globalThis.__loomBridge id)))
(defn current-item-id [] (.currentItemId js/globalThis.__loomBridge))
(defn current-item []
  (when-let [id (current-item-id)] (item id)))
(defn link
  ([id] (link id nil))
  ([id label]
   (if (.resolveLink js/globalThis.__loomBridge id)
     (if (nil? label) [:a {:href (str "loom:" id)}] [:a {:href (str "loom:" id)} label])
     (throw (js/Error. "Loom link requires a valid item UUID")))))
(defn data [value] {"loom/data" value})
(defn normalize [value]
  (cond
    (var? value) {"loom/definition" (str value)}
    (map? value) (into {} (map (fn [[key child]] [key (normalize child)]) value))
    (or (sequential? value) (set? value))
      (let [values (vec (take 1001 value))]
        (when (> (count values) 1000) (throw (js/Error. "Snippet result limit exceeded")))
        (mapv normalize values))
    :else value))

(ns loom.core (:require [loom :as api]))
(def items api/items)
(def item api/item)
(def current-item-id api/current-item-id)
(def current-item api/current-item)
(def link api/link)
(def data api/data)
(def normalize api/normalize)`;

export function createSnippetRuntime({ getItems, scittle = globalThis.scittle, host = globalThis }) {
  const evaluate = scittle?.core?.eval_string;
  if (typeof evaluate !== 'function') throw new Error('Scittle is not available');
  let initialized = false;

  function run(source, { currentItemId = null } = {}) {
    if (typeof source !== 'string') throw new TypeError('Snippet source must be text');
    const dependencies = new Set();
    const items = getItems();
    const byId = new Map(items.map(item => [item.id, item]));

    function relatedItems(ids) {
      return ids.map(id => {
        dependencies.add(`item:${id}`);
        const item = byId.get(id);
        return item ? { id: item.id, title: item.title } : null;
      }).filter(Boolean);
    }

    function summary(item) {
      const relationships = itemRelationships(item.body);
      return {
        id: item.id,
        title: item.title,
        tags: item.tags.map(value => value.name),
        'created-at': item['created-at'],
        'updated-at': item['updated-at'],
        'referenced-items': relatedItems(relationships.referenced),
        'transcluded-items': relatedItems(relationships.transcluded),
      };
    }

    host.__loomBridge = {
      items(tag) {
        dependencies.add(tag ? `tag:${tag}` : 'index');
        return items.filter(item => !tag || item.tags.some(value => value.name === tag))
          .map(summary);
      },
      item(id) {
        dependencies.add(`item:${id}`);
        const item = items.find(value => value.id === id);
        if (!item) return null;
        const relationships = itemRelationships(item.body);
        return {
          ...item,
          tags: item.tags.map(value => value.name),
          'referenced-items': relatedItems(relationships.referenced),
          'transcluded-items': relatedItems(relationships.transcluded),
        };
      },
      currentItemId() {
        if (typeof currentItemId !== 'string' || !currentItemId) return null;
        dependencies.add(`item:${currentItemId}`);
        return currentItemId;
      },
      resolveLink(id) {
        if (typeof id !== 'string' || !UUID.test(id)) return false;
        dependencies.add(`item:${id}`);
        return true;
      },
    };
    try {
      if (!initialized) { evaluate(API_SOURCE); initialized = true; }
      evaluate('(ns loom.user (:require [loom] [loom.core]))');
      const result = evaluate(`(pr-str (loom/normalize (do ${source})))`);
      return { value: readEDN(result), dependencies };
    } finally { delete host.__loomBridge; }
  }

  return { run };
}
