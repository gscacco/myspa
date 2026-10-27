/** ClojureScript symbol suggestions and inline documentation for snippet editors. */

const MAX_SUGGESTIONS = 10;
const SYMBOL_CHARACTER = /[A-Za-z0-9_*+!?<>=.$%&|/-]/;

function candidate(name, signature, description, kind = 'function') {
  return Object.freeze({ name, signature, description, kind });
}

export const CLOJURE_CANDIDATES = Object.freeze([
  candidate('def', '(def name value)', 'Defines a var in the current namespace.', 'macro'),
  candidate('defonce', '(defonce name value)', 'Defines a var only when it does not already exist.', 'macro'),
  candidate('defn', '(defn name [params*] body*)', 'Defines a function with one or more arities.', 'macro'),
  candidate('defn-', '(defn- name [params*] body*)', 'Defines a private function.', 'macro'),
  candidate('fn', '(fn [params*] body*)', 'Creates an anonymous function.'),
  candidate('let', '(let [binding value ...] body*)', 'Creates lexical bindings for the body.', 'macro'),
  candidate('if', '(if test then else?)', 'Evaluates one of two branches.', 'macro'),
  candidate('if-not', '(if-not test then else?)', 'Evaluates the branches when test is false.', 'macro'),
  candidate('when', '(when test body*)', 'Evaluates the body when test is truthy.', 'macro'),
  candidate('when-not', '(when-not test body*)', 'Evaluates the body when test is false.', 'macro'),
  candidate('cond', '(cond test expr ...)', 'Evaluates the expression for the first truthy test.', 'macro'),
  candidate('condp', '(condp pred expr test result ...)', 'Compares an expression using pred and selects a matching result.', 'macro'),
  candidate('case', '(case expr value result ... default)', 'Selects a result by comparing an expression with compile-time constants.', 'macro'),
  candidate('do', '(do body*)', 'Evaluates forms in order and returns the last value.', 'macro'),
  candidate('doseq', '(doseq [binding coll ...] body*)', 'Iterates over bindings for side effects.', 'macro'),
  candidate('dotimes', '(dotimes [i n] body*)', 'Runs the body n times with a numeric binding.', 'macro'),
  candidate('loop', '(loop [binding init ...] body*)', 'Establishes a recursion point with initial bindings.', 'macro'),
  candidate('recur', '(recur args*)', 'Rebinds the nearest loop or function recursion point.'),
  candidate('->', '(-> value form ...)', 'Threads a value as the first argument through forms.', 'macro'),
  candidate('->>', '(->> value form ...)', 'Threads a value as the last argument through forms.', 'macro'),
  candidate('some->', '(some-> value form ...)', 'Threads a value as the first argument until a step is nil.', 'macro'),
  candidate('some->>', '(some->> value form ...)', 'Threads a value as the last argument until a step is nil.', 'macro'),
  candidate('as->', '(as-> value name form ...)', 'Binds a threaded expression to a reusable name.', 'macro'),
  candidate('doto', '(doto value form ...)', 'Calls forms for side effects and returns the original value.', 'macro'),
  candidate('try', '(try body* (catch class error handler) (finally cleanup))', 'Evaluates protected code with optional catch and finally clauses.', 'macro'),
  candidate('throw', '(throw error)', 'Throws an exception.'),

  candidate('map', '(map f coll & colls)', 'Applies f to each value in one or more collections.'),
  candidate('mapv', '(mapv f coll & colls)', 'Applies f to each value and eagerly returns a vector.'),
  candidate('map-indexed', '(map-indexed f coll)', 'Applies f to the index and value of each collection entry.'),
  candidate('mapcat', '(mapcat f coll & colls)', 'Applies f and concatenates the resulting collections.'),
  candidate('filter', '(filter predicate coll)', 'Returns values for which predicate is truthy.'),
  candidate('filterv', '(filterv predicate coll)', 'Returns a vector of values for which predicate is truthy.'),
  candidate('remove', '(remove predicate coll)', 'Returns values for which predicate is falsey.'),
  candidate('reduce', '(reduce f init coll)', 'Reduces a collection with a combining function.'),
  candidate('reduce-kv', '(reduce-kv f init coll)', 'Reduces an associative collection with its keys and values.'),
  candidate('keep', '(keep f coll)', 'Returns the non-nil results of applying f to each value.'),
  candidate('keep-indexed', '(keep-indexed f coll)', 'Returns the non-nil results of applying f to indexes and values.'),
  candidate('some', '(some predicate coll)', 'Returns the first truthy predicate result.'),
  candidate('every?', '(every? predicate coll)', 'Returns true when predicate is truthy for every value.'),
  candidate('not-any?', '(not-any? predicate coll)', 'Returns true when predicate is falsey for every value.'),
  candidate('not-every?', '(not-every? predicate coll)', 'Returns true when predicate is falsey for at least one value.'),
  candidate('first', '(first coll)', 'Returns the first value in a collection.'),
  candidate('second', '(second coll)', 'Returns the second value in a collection.'),
  candidate('last', '(last coll)', 'Returns the last value in a collection.'),
  candidate('rest', '(rest coll)', 'Returns the remaining values as a sequence.'),
  candidate('next', '(next coll)', 'Returns the remaining values, or nil when none remain.'),
  candidate('nth', '(nth coll index default?)', 'Returns the value at an index.'),
  candidate('get', '(get associative key default?)', 'Looks up a key in a map, vector, string, or other associative value.'),
  candidate('get-in', '(get-in associative keys default?)', 'Looks up a key path in nested associative values.'),
  candidate('assoc', '(assoc associative key value ...)', 'Returns an associative value with keys replaced or added.'),
  candidate('assoc-in', '(assoc-in associative keys value)', 'Returns a nested associative value with a key path updated.'),
  candidate('update', '(update associative key f args*)', 'Returns an associative value with f applied to a key.'),
  candidate('update-in', '(update-in associative keys f args*)', 'Returns a nested associative value with f applied to a key path.'),
  candidate('dissoc', '(dissoc map key ...)', 'Returns a map without the specified keys.'),
  candidate('disj', '(disj set value ...)', 'Returns a set without the specified values.'),
  candidate('merge', '(merge map ...)', 'Combines maps, with later values taking precedence.'),
  candidate('merge-with', '(merge-with f map ...)', 'Combines maps and resolves duplicate keys with f.'),
  candidate('select-keys', '(select-keys map keys)', 'Returns a map containing only the requested keys.'),
  candidate('keys', '(keys map)', 'Returns a sequence of a map keys.'),
  candidate('vals', '(vals map)', 'Returns a sequence of a map values.'),
  candidate('conj', '(conj coll value ...)', 'Adds values to a collection in its natural position.'),
  candidate('cons', '(cons value coll)', 'Prepends a value to a sequence.'),
  candidate('into', '(into target coll)', 'Adds every value from coll to target.'),
  candidate('concat', '(concat coll ...)', 'Returns a lazy sequence containing the values of each collection.'),
  candidate('count', '(count coll)', 'Returns the number of values in a collection.'),
  candidate('empty?', '(empty? coll)', 'Returns true when a collection has no values.'),
  candidate('seq', '(seq coll)', 'Returns a sequence for a collection, or nil when it is empty.'),
  candidate('vec', '(vec coll)', 'Builds a vector from a collection.'),
  candidate('vector', '(vector value ...)', 'Creates a vector containing the arguments.'),
  candidate('list', '(list value ...)', 'Creates a list containing the arguments.'),
  candidate('set', '(set coll)', 'Builds a set from a collection.'),
  candidate('hash-map', '(hash-map key value ...)', 'Creates a map from alternating keys and values.'),
  candidate('zipmap', '(zipmap keys values)', 'Creates a map from parallel key and value collections.'),
  candidate('group-by', '(group-by f coll)', 'Groups collection values by the result of f.'),
  candidate('frequencies', '(frequencies coll)', 'Returns a map of values and their occurrence counts.'),
  candidate('sort', '(sort coll)', 'Returns a sorted sequence of collection values.'),
  candidate('sort-by', '(sort-by keyfn coll)', 'Returns values sorted by applying keyfn.'),
  candidate('reverse', '(reverse coll)', 'Returns the values in reverse order.'),
  candidate('range', '(range end) or (range start end step)', 'Returns a lazy sequence of numbers.'),
  candidate('repeat', '(repeat n? value)', 'Returns a lazy sequence that repeats a value.'),
  candidate('iterate', '(iterate f value)', 'Returns value followed by repeated applications of f.'),
  candidate('take', '(take n coll)', 'Returns up to n values from a collection.'),
  candidate('drop', '(drop n coll)', 'Returns a collection without its first n values.'),
  candidate('take-while', '(take-while predicate coll)', 'Takes values while predicate is truthy.'),
  candidate('drop-while', '(drop-while predicate coll)', 'Drops values while predicate is truthy.'),
  candidate('partition', '(partition n coll)', 'Splits a collection into groups of n values.'),
  candidate('partition-by', '(partition-by f coll)', 'Splits a collection whenever the result of f changes.'),
  candidate('distinct', '(distinct coll)', 'Returns a sequence without duplicate values.'),
  candidate('dedupe', '(dedupe coll)', 'Returns a sequence without consecutive duplicate values.'),
  candidate('interpose', '(interpose separator coll)', 'Places a separator between collection values.'),
  candidate('flatten', '(flatten coll)', 'Returns the leaves of nested sequential values.'),
  candidate('comp', '(comp f g ...)', 'Composes functions from right to left.'),
  candidate('partial', '(partial f args*)', 'Creates a function with some arguments pre-bound.'),
  candidate('identity', '(identity value)', 'Returns its argument unchanged.'),
  candidate('constantly', '(constantly value)', 'Returns a function that always returns value.'),
  candidate('apply', '(apply f args)', 'Calls f with arguments supplied by a collection.'),
  candidate('juxt', '(juxt f ...)', 'Returns a function that collects the results of several functions.'),
  candidate('complement', '(complement f)', 'Returns a function whose truthiness is the complement of f.'),

  candidate('inc', '(inc number)', 'Returns a number increased by one.'),
  candidate('dec', '(dec number)', 'Returns a number decreased by one.'),
  candidate('+', '(+ number ...)', 'Returns the sum of numeric values.'),
  candidate('-', '(- number ...)', 'Subtracts numbers or negates one number.'),
  candidate('*', '(* number ...)', 'Returns the product of numeric values.'),
  candidate('/', '(/ number ...)', 'Divides numbers.'),
  candidate('mod', '(mod number divisor)', 'Returns a number modulo a divisor.'),
  candidate('quot', '(quot number divisor)', 'Returns the integer quotient of two numbers.'),
  candidate('rem', '(rem number divisor)', 'Returns the remainder of a division.'),
  candidate('max', '(max number ...)', 'Returns the greatest numeric value.'),
  candidate('min', '(min number ...)', 'Returns the least numeric value.'),
  candidate('abs', '(abs number)', 'Returns the absolute value of a number.'),
  candidate('even?', '(even? number)', 'Returns true when a number is even.'),
  candidate('odd?', '(odd? number)', 'Returns true when a number is odd.'),
  candidate('zero?', '(zero? number)', 'Returns true when a number equals zero.'),
  candidate('pos?', '(pos? number)', 'Returns true when a number is positive.'),
  candidate('neg?', '(neg? number)', 'Returns true when a number is negative.'),
  candidate('nil?', '(nil? value)', 'Returns true when value is nil.'),
  candidate('some?', '(some? value)', 'Returns true when value is not nil.'),
  candidate('true?', '(true? value)', 'Returns true only when value is true.'),
  candidate('false?', '(false? value)', 'Returns true only when value is false.'),
  candidate('number?', '(number? value)', 'Returns true when value is a number.'),
  candidate('string?', '(string? value)', 'Returns true when value is a string.'),
  candidate('keyword?', '(keyword? value)', 'Returns true when value is a keyword.'),
  candidate('symbol?', '(symbol? value)', 'Returns true when value is a symbol.'),
  candidate('map?', '(map? value)', 'Returns true when value is a map.'),
  candidate('vector?', '(vector? value)', 'Returns true when value is a vector.'),
  candidate('seq?', '(seq? value)', 'Returns true when value is a sequence.'),
  candidate('fn?', '(fn? value)', 'Returns true when value is callable as a function.'),
  candidate('coll?', '(coll? value)', 'Returns true when value is a collection.'),
  candidate('sequential?', '(sequential? value)', 'Returns true when value is sequential.'),
  candidate('associative?', '(associative? value)', 'Returns true when value supports associative lookup.'),
  candidate('=', '(= value ...)', 'Returns true when all values are equal.'),
  candidate('not=', '(not= value ...)', 'Returns true when values are not all equal.'),
  candidate('<', '(< number ...)', 'Returns true when numbers are strictly increasing.'),
  candidate('>', '(> number ...)', 'Returns true when numbers are strictly decreasing.'),
  candidate('<=', '(<= number ...)', 'Returns true when numbers are non-decreasing.'),
  candidate('>=', '(>= number ...)', 'Returns true when numbers are non-increasing.'),
  candidate('not', '(not value)', 'Returns the logical complement of a value.'),
  candidate('and', '(and value ...)', 'Returns the last truthy value or the first falsey value.', 'macro'),
  candidate('or', '(or value ...)', 'Returns the first truthy value or the last falsey value.', 'macro'),

  candidate('str', '(str value ...)', 'Concatenates values into a string.'),
  candidate('subs', '(subs string start end?)', 'Returns a substring between start and end indexes.'),
  candidate('name', '(name named-value)', 'Returns the name portion of a keyword or symbol.'),
  candidate('namespace', '(namespace named-value)', 'Returns the namespace portion of a keyword or symbol.'),
  candidate('keyword', '(keyword name)', 'Creates a keyword from a name.'),
  candidate('symbol', '(symbol name)', 'Creates a symbol from a name.'),
  candidate('clojure.string/join', '(clojure.string/join separator coll)', 'Joins collection values into one string.'),
  candidate('clojure.string/split', '(clojure.string/split string pattern)', 'Splits a string with a pattern and returns a vector.'),
  candidate('clojure.string/replace', '(clojure.string/replace string match replacement)', 'Replaces matches in a string.'),
  candidate('clojure.string/upper-case', '(clojure.string/upper-case string)', 'Returns a string in upper case.'),
  candidate('clojure.string/lower-case', '(clojure.string/lower-case string)', 'Returns a string in lower case.'),
  candidate('clojure.string/trim', '(clojure.string/trim string)', 'Removes whitespace from both ends of a string.'),
  candidate('clojure.string/includes?', '(clojure.string/includes? string search)', 'Returns true when a string contains search.'),
  candidate('clojure.string/starts-with?', '(clojure.string/starts-with? string prefix)', 'Returns true when a string starts with prefix.'),
  candidate('clojure.string/ends-with?', '(clojure.string/ends-with? string suffix)', 'Returns true when a string ends with suffix.'),

  candidate('println', '(println value ...)', 'Prints values to the console with a trailing newline.'),
  candidate('prn', '(prn value ...)', 'Prints readable values to the console with a trailing newline.'),
  candidate('atom', '(atom value)', 'Creates an atom holding a mutable reference.'),
  candidate('deref', '(deref reference)', 'Returns the current value of a reference.'),
  candidate('swap!', '(swap! atom f args*)', 'Atomically updates an atom with a function.'),
  candidate('reset!', '(reset! atom value)', 'Atomically replaces the value of an atom.'),
  candidate('js->clj', '(js->clj value :keywordize-keys bool)', 'Converts JavaScript data into ClojureScript data.'),
  candidate('clj->js', '(clj->js value)', 'Converts ClojureScript data into JavaScript data.'),

  candidate('loom/items', '(loom/items) or (loom/items {:tag tag})', 'Returns item summaries with timestamps and relationships, optionally filtered by one tag.'),
  candidate('loom/item', '(loom/item id)', 'Returns the full item with timestamps and relationships, or nil when missing.'),
  candidate('loom/current-item-id', '(loom/current-item-id)', 'Returns the stable ID of the item hosting this snippet, or nil without item context.'),
  candidate('loom/current-item', '(loom/current-item)', 'Returns the full item hosting this snippet, or nil without item context.'),
  candidate('loom/link', '(loom/link id) or (loom/link id label)', 'Returns a Hiccup link to a validated Loom item ID.'),
  candidate('loom/data', '(loom/data value)', 'Wraps a value as an explicit EDN data result.'),
]);

export function completionCandidates() { return CLOJURE_CANDIDATES; }

function insideStringOrComment(code, cursor) {
  let string = false, comment = false, escaped = false;
  for (let index = 0; index < cursor; index++) {
    const char = code[index];
    if (comment) {
      if (char === '\n') comment = false;
      continue;
    }
    if (string) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '\\') { index++; continue; }
    if (char === ';') comment = true;
    else if (char === '"') string = true;
  }
  return string || comment;
}

function symbolAt(code, cursor) {
  let from = cursor;
  while (from > 0 && SYMBOL_CHARACTER.test(code[from - 1])) from--;
  return { from, to: cursor, word: code.slice(from, cursor) };
}

function compareCandidates(left, right, word) {
  if (left.name === word && right.name !== word) return -1;
  if (right.name === word && left.name !== word) return 1;
  return left.name.length - right.name.length || left.name.localeCompare(right.name);
}

/**
 * Computes suggestions for the symbol immediately before the cursor.
 * Returns nil for a selection, a string/comment, malformed input, or no match.
 */
export function computeCompletion({ code, cursor, hasSelection = false, force = false, candidates = CLOJURE_CANDIDATES } = {}) {
  if (typeof code !== 'string' || !Number.isInteger(cursor) || cursor < 0 || cursor > code.length) return null;
  if (hasSelection || !Array.isArray(candidates) || insideStringOrComment(code, cursor)) return null;
  const location = symbolAt(code, cursor);
  if ((!force && !location.word) || location.word.length > 80) return null;
  const matches = candidates.filter(value => value && typeof value.name === 'string'
    && (!location.word || value.name.startsWith(location.word)));
  if (!matches.length) return null;
  if (location.word) matches.sort((left, right) => compareCandidates(left, right, location.word));
  return { ...location, candidates: matches.slice(0, MAX_SUGGESTIONS) };
}

/** Returns the text replacement for accepting a candidate, or nil for malformed input. */
export function completionInsertion(value, code, cursor, word) {
  if (!value || typeof value.name !== 'string' || !value.name || typeof code !== 'string'
    || !Number.isInteger(cursor) || typeof word !== 'string') return null;
  const from = cursor - word.length;
  if (from < 0 || code.slice(from, cursor) !== word) return null;
  return { text: value.name, from, to: cursor, caret: from + value.name.length };
}

let sequence = 0;

/** Attaches an accessible completion and documentation panel to a snippet textarea. */
export function attachClojureCompletion(textarea, { candidates = CLOJURE_CANDIDATES } = {}) {
  const document = textarea.ownerDocument;
  const editor = textarea.closest('.snippet-editor');
  if (!editor) return () => {};

  const id = `clojure-completion-${++sequence}`;
  const panel = document.createElement('section');
  panel.className = 'clojure-assistance'; panel.hidden = true;
  panel.setAttribute('aria-label', 'ClojureScript assistance');
  const heading = document.createElement('h3');
  heading.className = 'clojure-assistance-title'; heading.id = `${id}-title`;
  heading.textContent = 'ClojureScript suggestions';
  const list = document.createElement('div');
  list.className = 'clojure-assistance-list'; list.id = `${id}-list`;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-labelledby', heading.id);
  const doc = document.createElement('section');
  doc.className = 'clojure-assistance-doc'; doc.id = `${id}-doc`;
  doc.setAttribute('aria-live', 'polite'); doc.setAttribute('aria-atomic', 'true');
  const docName = document.createElement('code'); docName.className = 'clojure-assistance-name';
  const docSignature = document.createElement('code'); docSignature.className = 'clojure-assistance-signature';
  const docDescription = document.createElement('p'); docDescription.className = 'clojure-assistance-description';
  doc.append(docName, docSignature, docDescription);
  const hint = document.createElement('p'); hint.className = 'clojure-assistance-hint';
  hint.textContent = 'Arrow keys select · Enter or Tab inserts · Esc dismisses · Ctrl/Cmd+Space shows suggestions';
  panel.append(heading, list, doc, hint);
  editor.append(panel);

  textarea.setAttribute('aria-controls', list.id);
  textarea.setAttribute('aria-autocomplete', 'list');
  textarea.setAttribute('aria-expanded', 'false');

  let current = null, options = [], active = -1, dismissed = null;

  function close() {
    panel.hidden = true; list.replaceChildren(); options = []; active = -1; current = null;
    textarea.setAttribute('aria-expanded', 'false'); textarea.removeAttribute('aria-activedescendant');
  }

  function showDocumentation(value) {
    docName.textContent = value?.name ?? '';
    docSignature.textContent = value?.signature ?? '';
    docDescription.textContent = value?.description ?? '';
  }

  function setActive(index) {
    active = options.length ? (index + options.length) % options.length : -1;
    for (const [position, option] of options.entries()) {
      const selected = position === active;
      option.button.classList.toggle('active', selected);
      option.button.setAttribute('aria-selected', String(selected));
    }
    if (active >= 0) {
      textarea.setAttribute('aria-activedescendant', options[active].button.id);
      showDocumentation(options[active].value);
    } else {
      textarea.removeAttribute('aria-activedescendant'); showDocumentation(null);
    }
  }

  function choose(option) {
    if (!current || !option) return;
    const insertion = completionInsertion(option.value, textarea.value, textarea.selectionStart, current.word);
    if (!insertion) { close(); return; }
    textarea.setRangeText(insertion.text, insertion.from, insertion.to, 'end');
    textarea.setSelectionRange(insertion.caret, insertion.caret);
    textarea.dispatchEvent(new (document.defaultView.Event)('input', { bubbles: true }));
    close(); textarea.focus();
  }

  function option(value, index) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'clojure-assistance-option';
    button.id = `${id}-option-${index}`; button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false'); button.textContent = value.name;
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('mouseenter', () => setActive(index));
    button.addEventListener('click', () => choose(options[index]));
    return { button, value };
  }

  function render(result) {
    current = result;
    list.replaceChildren();
    options = result.candidates.map(option);
    list.append(...options.map(value => value.button));
    panel.hidden = false;
    textarea.setAttribute('aria-expanded', 'true');
    setActive(0);
  }

  function signature(result) { return `${result.from}:${result.to}:${result.word}`; }

  function refresh(force = false) {
    if (document.activeElement !== textarea) { close(); return; }
    const result = computeCompletion({
      code: textarea.value,
      cursor: textarea.selectionStart,
      hasSelection: textarea.selectionStart !== textarea.selectionEnd,
      force,
      candidates,
    });
    if (!result || (!force && dismissed === signature(result))) { close(); return; }
    dismissed = null;
    render(result);
  }

  function onInput() { dismissed = null; refresh(); }
  function onClick() { refresh(); }
  function onFocus() { dismissed = null; refresh(); }
  function onBlur() { close(); }
  function onKeyup(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) refresh();
  }
  function onKeydown(event) {
    const modifier = event.ctrlKey || event.metaKey;
    const space = event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
    if (panel.hidden) {
      if (modifier && !event.altKey && space) {
        event.preventDefault(); dismissed = null; refresh(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      dismissed = current ? signature(current) : null; close(); return;
    }
    if (!modifier && !event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (options.length) setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (!modifier && !event.altKey && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault(); event.stopImmediatePropagation();
      choose(options[Math.max(active, 0)]);
    }
  }

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('click', onClick);
  textarea.addEventListener('focus', onFocus);
  textarea.addEventListener('blur', onBlur);
  textarea.addEventListener('keyup', onKeyup);
  textarea.addEventListener('keydown', onKeydown, true);

  return () => {
    textarea.removeEventListener('input', onInput);
    textarea.removeEventListener('click', onClick);
    textarea.removeEventListener('focus', onFocus);
    textarea.removeEventListener('blur', onBlur);
    textarea.removeEventListener('keyup', onKeyup);
    textarea.removeEventListener('keydown', onKeydown, true);
    panel.remove();
    textarea.removeAttribute('aria-controls'); textarea.removeAttribute('aria-autocomplete'); textarea.removeAttribute('aria-expanded');
    textarea.removeAttribute('aria-activedescendant');
  };
}
