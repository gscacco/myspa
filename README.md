# Foglio

Foglio is a small browser-based spreadsheet experiment. It combines a cell grid with JavaScript-style formulas and a ClojureScript editor for user-defined functions, evaluated by Scittle/SCI in the browser.

## Project status

This project is a proof of concept. Its purpose is to explore the spreadsheet and ClojureScript editing experience; it is not a production-ready spreadsheet or a compatibility replacement for established spreadsheet software. Features and file formats may change as the experiment evolves.

There is currently no schedule or timeline for future versions.

## What it can do

- Edit workbooks with multiple sheets, each with a 1024-row by 26-column grid.
- Use cell references, ranges, absolute references, and references to other sheets in formulas.
- Recalculate dependent cells and report formula errors, including circular references.
- Write ClojureScript forms directly in cells, such as `(+ 1 2 3)`, `:pippo`, `[1 2 3]`, and `{:pippo 12}`. Existing infix formulas such as `=B2*C2` remain supported.
- Define functions in the ClojureScript editor and call them from formulas.
- Open the selected cell in the syntax-highlighted, line-numbered editor with Ctrl+Enter. In the editor, Enter inserts a line and Ctrl+Enter applies a cell formula or evaluates the form before the cursor.
- In either mode of the ClojureScript editor, use `Alt`+`+` to increase the code font and `Alt`+`-` to decrease it. The size is bounded between 9 and 28 pixels.
- Apply basic formatting, including bold text, decimal places, and background colors. Copy and paste cell ranges, and undo or redo workbook changes.
- Use ClojureScript functions to format one cell or a range, including text and border styles.
- Save and reopen a workbook as a standalone HTML file containing the application and workbook data.
- Export workbook data and general ClojureScript code to EDN, then import them into another Foglio version without replacing that version's application files.

### Moving workbook data between Foglio versions

**Save** writes the complete standalone HTML application. **Esporta dati** writes only the workbook as an `.edn` file, including sheets, cell sources, formatting, dimensions, and general ClojureScript code. Use **Importa dati** in another Foglio version to load that file; the current workbook is replaced while the new version's application remains in place. Import asks before replacing unsaved changes. The imported code becomes the workbook's general ClojureScript code and is loaded by Foglio.

The runtime is Scittle 0.8.33, which evaluates ClojureScript through SCI. It does not require Java or a JVM. SCI is an interpreter, not the official ClojureScript compiler, and it does not provide the complete ClojureScript build and library ecosystem. The spreadsheet functions and cell-reference bridge are defined in `src/js/scittle-runtime.js`; `src/js/cljs.js` contains the editor reader and compatibility wrappers that delegate evaluation to Scittle.

## ClojureScript values and formulas in cells

Cells can contain ClojureScript values and expressions directly; a leading `=` is not required. Common examples are:

| Cell contents | Value |
| --- | --- |
| `:active` | Keyword |
| `"active"` | String |
| `42`, `true`, `false`, `nil` | Number, booleans, or nil |
| `[1 2 3]` | Vector |
| `{:name "Radar" :budget 1200000 :status :active}` | Map with keyword keys and a keyword value |
| `(+ 1 2 3)` | ClojureScript expression, evaluates to `6` |

Keywords and strings are different values: `:active` is not the same as `"active"`. Use ClojureScript's `=` to compare them. For example, if cells `C2:C4` contain one map each, this returns the maps whose `:status` is the keyword `:active`:

```clojure
(filter #(= (:status %) :active) (map first C2:C4))
```

The map lookup can also be written `(get % :status)`. A cell showing a map or vector is rendered in ClojureScript notation, so keywords keep their leading colon. Plain text that is not recognized as a ClojureScript value, expression, or cell reference remains text.

Cell and range references can be used inside ClojureScript forms. A single-cell reference such as `A1` produces that cell's value; a range such as `A1:B3` produces a vector of row vectors. Thus `C2:C4` is a three-row, one-column value, and `(map first C2:C4)` turns it into a sequence of the three cell values. References can include a sheet name, for example `OtherSheet!B3`, and `$` can anchor a row or column when formulas are copied. Empty cells evaluate as `nil`.

Examples of cell formulas:

```clojure
(+ A1 B1)                         ; add two cells
(count A1:A3)                     ; count the values in a range
(double-value A2)                 ; call a function defined in the code editor
double-value(A2)                  ; equivalent function-call shorthand
```

The existing infix formula syntax is also supported, for example `=B2*C2`. In the `ƒ CLJS` code editor, define workbook functions with `defn`; those functions are available to cell formulas:

```clojure
(defn double-value [x]
  (* x 2))
```

### Available functions

The runtime includes the following spreadsheet functions in addition to the ClojureScript functions supplied by Scittle/SCI:

| Function | Purpose |
| --- | --- |
| `SUM` | Sum numeric values, including values nested in ranges and collections. |
| `COUNT` | Count numeric values. |
| `MIN`, `MAX` | Return the smallest or largest numeric value. |
| `AVG`, `AVERAGE` | Calculate the average of numeric values. |
| `ROUND` | Round a number; an optional second argument gives the number of decimal places. |
| `IF` | Choose a value based on a condition: `(IF (> A1 0) :positive :other)`. |
| `$`, `$$` | Read a cell or a range explicitly; references such as `A1` and `A1:B3` are usually more convenient. |

Common ClojureScript core functions include arithmetic and comparisons (`+`, `-`, `*`, `/`, `inc`, `dec`, `=`, `not=`, `<`, `<=`, `>`, `>=`), collection operations (`map`, `filter`, `reduce`, `flatten`, `count`, `get`, `nth`, `first`, `assoc`, `conj`, `merge`, `keys`, `vals`, `sort`, `take`, `drop`, `range`), and string helpers (`str`, `upper-case`, `lower-case`, `trim`, `subs`, `split`, `join`, `replace`). The runtime also exposes common math functions such as `abs`, `sqrt`, `pow`, `floor`, `ceil`, `round`, `sin`, `cos`, and the constants `PI` and `E`. Names are case-sensitive: ClojureScript core functions such as `count` are lowercase, while spreadsheet functions such as `COUNT` are uppercase.

### In-app Help

Click **Help** in the toolbar to open the searchable ClojureScript reference. It documents the functions exposed by Foglio's runtime, spreadsheet functions, special forms such as `defn`, `loop`, and `recur`, important values and system keywords, and examples for cell references, Messages, and event hooks. The same descriptions are available in the editor's inline completion suggestions.

Choose an entry to read its description and example. **Copy example** places the example on the clipboard. **Insert into editor** adds it at the current cursor position in the `ƒ CLJS` editor, opening that editor if needed; it does not run the code or change a cell. Review the inserted code, then use Ctrl+Enter to evaluate the form at the cursor or apply the editor code as appropriate. Examples that refer to names such as `records`, `record`, or `event` expect those values to exist in the workbook or calling context.

### Modifying cell appearance from ClojureScript

Foglio exposes two functions for changing cell appearance; they do not set or replace cell values. Use `style-range!` to apply or update styles on a single cell or range, and `clear-range-style!` to remove them:

```clojure
(style-range! reference styles)
(clear-range-style! reference)
```

The reference is text such as `"A1"` or `"A1:B3"`. An unqualified reference uses the sheet containing the running cell, or the currently selected sheet when evaluated from the `ƒ CLJS` editor. Add `SheetName!` to target a specific sheet. `style-range!` merges supplied options with existing styles, returns the number of cells changed, records the change for undo, and does not recalculate formulas.

```clojure
(style-range! "A1:B3"
  {:background "#fff2a8"
   :color "#243447"
   :bold true
   :italic true
   :underline false
   :font-size 14
   :font-family "Arial, sans-serif"
   :border-color "#1d6f42"
   :border-width 2
   :border-style :solid})
```

Supported style keys are `:background`, `:color`, `:bold`, `:italic`, `:underline`, `:font-size`, `:font-family`, `:border-color`, `:border-width`, and `:border-style`. Font sizes are 8–72 pixels; border widths are 0–12 pixels. Border styles include `:none`, `:solid`, `:dashed`, `:dotted`, and `:double` (as well as the standard groove, ridge, inset, and outset styles). Set an individual option to `nil` to remove that override. `clear-range-style!` removes styles set through this API and legacy toolbar bold/background styles, while preserving cell values and decimal formatting. Both functions accept a single cell or a range.

Style operations can run in an event hook. This example highlights the current selection and works for both a cell and a range:

```clojure
(defn highlight-selection [event]
  (let [selection (get-in event [:data :selection])]
    (style-range! (str (:sheet selection) "!" (:range selection))
      {:background "#fff2a8" :bold true
       :border-color "#b7791f" :border-width 2 :border-style :solid})))

(add-hook :on-selection-change highlight-selection)
```

Use `(clear-hook :on-selection-change)` to remove selection hooks, and `(clear-range-style! "A1:B3")` to reset the example's styles.

## Explore Data

Select a cell and click **Explore Data** in the toolbar to inspect its evaluated value. The explorer snapshots that cell when it opens; changing the grid selection will not change the data being explored. An empty cell or a cell with an evaluation error leaves the spreadsheet in place and reports the reason in the status bar. Closing the explorer returns to the existing workbook without changing the cell or its expression.

The explorer provides:

- A lazy, expandable tree with collection types, sizes, map keys, stable sequence indices and previews of nested values.
- Select an item and use **Copy selected EDN** or **Copy select expression** in the toolbar. The expression reads the original cell and follows the selected map key or collection index. **Copy path** is also available. Copying never writes to the source cell.

The explorer operates on the original Scittle values, so keywords remain different from strings, and maps, vectors, lists, and sets remain distinguishable. Unsupported JavaScript interop objects may have limited inspection or EDN export. Lazy sequences show at most 200 items; exporting a longer lazy sequence is refused with an explanation.

## Messages

Click **Messages** in the toolbar to open the resizable panel below the grid. It keeps collecting diagnostics while closed and does not change the current cell selection. The toolbar badge shows the number of retained messages. The panel shows retained and discarded counts, and follows new messages only while you are already at the bottom of the list.

Messages have a timestamp, severity, category, text, and optional source, details, and exception. Severity is independent from category. Common categories include `app`, `exec`, and `data`. `INFO` uses blue, `WARN` amber, `ERROR` red, and `DEBUG` muted gray; execution messages use the `exec` category, shown with a violet accent. Text labels accompany the colors.

Use the severity buttons, category menu, and search field to narrow the list. Search includes text, category, source, details, and exception information. Expand **Details** to inspect long messages, structured details, or exception stacks. **Copy** copies one message; **Copy details** includes its details and stack. **Copy filtered** copies the current filtered results, and **Export all** downloads all retained messages as JSON. **Clear** asks for confirmation before removing the retained history.

Application diagnostics use one bounded in-memory store. It retains at most 2,000 messages and 2,097,152 UTF-16 code units across message text and metadata (up to about 4 MiB of raw string storage); an individual entry is limited to 16 KiB, with long fields truncated. These limits are defined in `MESSAGE_LIMITS` in `src/js/messages.js`. When either limit is exceeded, the oldest entries are discarded first and the discarded count increases. Clearing the store releases retained message and detail references but does not reset the discarded count. The visible list is virtualized: it renders only the viewport and a small overscan region. Messages are not persisted in the workbook or standalone HTML file.

Formula evaluation failures are recorded with their cell, expression, exception, and stack where available. An unchanged formula failure is logged once until the formula succeeds or changes. Application modules can use the shared store's `log` method or its `info`, `warn`, `error`, and `debug` helpers. For example, a module with the application context can call `ctx.messages.warn("Some rows have no budget", { category: "data", source: { operation: "rows->maps" } })`. User ClojureScript has the `log!` function in the workbook namespace:

```clojure
(log! :info "Imported records" {:category :data
                                :source {:operation "rows->maps"}
                                :details {:count (count records)}})
(log! :warn "Some records are missing :budget")
(log! :error "Import failed" {:category :data
                              :exception error})
```

The supported severities are `:info`, `:warn`, `:error`, and `:debug`. If omitted, the category is `:exec` for messages from ClojureScript. A formula that calls `log!` repeatedly with the same severity, category, and text is deduplicated until its source expression changes; messages with changing text can still produce new entries, so avoid logging routine recalculation output.

## Event hooks

Hooks run synchronously after the relevant state has been committed and recalculated. The supported events are `:on-selection-change`, `:on-cell-source-change`, `:on-cell-value-change`, and `:on-cell-evaluation-error`. Each event has the common shape `{:event keyword :timestamp ISO-string :source keyword :data map}`. The initial A1 selection at startup does not emit a selection event. Selection changes include the previous and current descriptors (`:sheet`, `:anchor`, `:focus`, and normalized `:range`); switching sheets counts as a change.

The selection event has this structure (the `:data` keys are ClojureScript keywords):

```clojure
{:event :on-selection-change
 :timestamp "2026-10-14T12:00:00.000Z"
 :source :ui
 :data {:previous-selection {:sheet "Foglio1"
                             :anchor "A1" :focus "A1" :range "A1"}
        :selection {:sheet "Foglio1"
                    :anchor "B1" :focus "B1" :range "B1"}}}
```

Cell events use `:source :cell` and identify a cell with its sheet-qualified A1 address, such as `"Foglio1!C2"`. `:on-cell-source-change` fires once when a committed raw source changes. Intermediate typing and identical source commits are ignored. Source values preserve the stored representation; clearing a source is represented by `nil`. Multiple writes to one cell before recalculation are coalesced from the original to the final source.

`:on-cell-value-change` fires only when a successful evaluated value differs under ClojureScript `=` semantics. It includes changes caused by dependency recalculation, even when the dependent cell's source did not change. Values remain ClojureScript values, preserving distinctions such as keywords versus strings and vectors versus lists. For a cell without a previous successful value, the event sets `:previous-value-available?` to `false` and omits `:old-value`; otherwise it sets the flag to `true` and provides both `:old-value` and `:new-value`. A failed evaluation never emits a value-change event.

`:on-cell-evaluation-error` fires for a failed cell evaluation. Its `:data` contains `:cell`, the string `:expression` when the source is text, and an `:error` map with `:name`, `:message`, and available `:line` or `:stack` information. Stack text is limited to 8,000 characters. Errors propagated from a failing cell to dependent formulas are reported only for the originating cell.

### Hook functions

Use these functions to register and manage callbacks. Each callback receives one event map as its argument:

| Function | Behavior |
| --- | --- |
| `(add-hook event function)` | Register a callback; returns `true` when added and `false` if the same function is already registered. |
| `(remove-hook event function)` | Remove that callback; returns `true` when removed and `false` if it was not registered. |
| `(run-hook event)` / `(run-hook event payload)` | Manually dispatch an event and return the number of callbacks attempted. The optional payload supplies `:data` and may supply `:timestamp` and `:source`; defaults are an empty data map, the current time, and `:manual`. |
| `(clear-hook event)` | Remove all callbacks for the event and return the number removed. |
| `(list-hooks)` / `(list-hooks event)` | Return the callbacks registered for an event. Without an argument, lists `:on-selection-change` callbacks. |

Only the four events listed above are supported; an unknown event raises an error. Callbacks run in registration order from a stable snapshot, so additions and removals during dispatch affect the next event. A callback error is sent to Messages and does not stop later callbacks.

For example, these hooks write source, value, and failure feedback to Messages:

```clojure
(add-hook :on-cell-source-change
  (fn [event]
    (let [data (:data event)]
      (log! :info
        (str "Source changed in " (:cell data) ": "
             (pr-str (:old-source data)) " → " (pr-str (:new-source data)))
        {:category :data}))))

(add-hook :on-cell-value-change
  (fn [event]
    (let [data (:data event)]
      (log! :info
        (str "Value changed in " (:cell data) ": "
             (if (:previous-value-available? data)
               (str (pr-str (:old-value data)) " → " (pr-str (:new-value data)))
               (str "initial value " (pr-str (:new-value data)))))
        {:category :data}))))

(add-hook :on-cell-evaluation-error
  (fn [event]
    (log! :error
      (str "Evaluation failed in " (get-in event [:data :cell]) ": "
           (get-in event [:data :error :message]))
      {:category :exec})))
```

The Help reference also documents the event keywords and payload keys. The hook registry is in memory for the current application session; evaluate the registration expression again after reloading Foglio.

Remove a hook when it is no longer needed:

```clojure
(remove-hook :on-selection-change report-selection)
```

## Selection summary

The bottom-right area below the sheet tabs is available for short, user-defined status text. Use `(set-status! text)` to display a value, or `(clear-status!)` to remove it. The text is inserted as plain text and remains visible until replaced or cleared. Both functions can be called from cell expressions, the `ƒ CLJS` editor, or event hooks; updating the area does not change the workbook, cell selection, or Messages history.

For example, this hook shows the count, sum, and average of numeric values in the selected range, and clears the area when the range contains no numbers:

```clojure
(add-hook :on-selection-change
  (fn [event]
    (let [selection (get-in event [:data :selection])
          range (:range selection)
          reference (str (:sheet selection) "!" range
                         (when (= range (:focus selection)) (str ":" range)))
          numbers (filter number? (flatten ($$ reference)))]
      (if (seq numbers)
        (let [total (reduce + 0 numbers)]
          (set-status!
            (str "Count: " (count numbers)
                 " · Sum: " (ROUND total 2)
                 " · Average: " (ROUND (/ total (count numbers)) 2))))
        (clear-status!)))))
```

Here, count includes numeric cells, matching the spreadsheet `COUNT` convention; blank and nonnumeric values are excluded from all three calculations. The selected range is expanded to `A1:A1` form when it contains only one cell. The hook is registered only when this expression is evaluated. Use `(clear-hook :on-selection-change)` to remove all selection hooks.

## Try it locally

Requirements: Node.js 20.19 or newer and npm. The Nix flake pins Nixpkgs and supplies Node.js 24.21.0; enter the environment with `nix develop`. `package-lock.json` pins the npm dependencies.

```sh
npm ci
npm run dev
```

Open <http://localhost:8080/src/index.html> in a browser. The development server serves the source files; ES modules are not intended to be opened directly from `file://`.

For the Loom source application, open <http://localhost:8080/loom/>. To open Loom directly from the filesystem, build and use the standalone artifact with `npm run build:loom` and open `dist/loom.html`; browser modules cannot be loaded from `file://`.

To build the portable, single-file version:

```sh
npm run build
```

This creates `dist/foglio.html`. The pinned Scittle runtime is embedded in the HTML alongside the app, so the artifact has no runtime dependency on a CDN or other external files. Open it in a browser to use the standalone build. Saving and opening use the browser's file picker when available, with download and file-input fallbacks.

## Checks

Run the complete test suite and verify the generated standalone artifact with:

```sh
npm run check
```

The individual commands are `npm run test:unit`, `npm run test:integration`, `npm run test:timetable`, `npm run test:loom`, and `npm run test:e2e`. Timetable tests that require the external `OR_30_SETT.ofd` file are excluded from the normal suite; run them with `npm run test:integration:ofd` when that file is available at the repository root. Synthetic OFD tests remain in `npm run test:timetable`.

## Loom (in progress)

`npm run build:loom` generates `dist/loom.html` using the same standalone build environment. The artifact starts with an empty workspace and embeds the pinned Scittle 0.8.33 distribution, so it works offline with no CDN or network request. A narrow left sidebar contains New Item and incremental search; open cards form a vertical workspace with the most recently opened item at the top. Search groups title/tag matches before content-only matches, and accepts `Enter` to open the first result or `Escape` to clear the query. Card actions in the upper-right corner use labelled SVG buttons: Edit, Close, and Delete in display mode, or Apply, Cancel Changes, and Delete while editing. A new item remains a draft until Apply. Markdown renders as safe DOM.

Item editing includes a Markdown toolbar for bold, italic, strikethrough, inline code, heading, bulleted list, blockquote, item links, and executable ClojureScript blocks. Toolbar actions operate on the current selection or cursor and preserve surrounding Markdown. `Ctrl/Cmd+B` and `Ctrl/Cmd+I` apply bold and italic from the Markdown field.

Use the stable-ID syntax `[[item:550e8400-e29b-41d4-a716-446655440000]]` for an internal link; the displayed title always comes from the current target item. Typing `[[` in the Markdown editor opens a filtered item picker using the same search rules as the sidebar. The older `[label](loom:item-uuid)` syntax remains supported for links, and `![label](loom:item-uuid)` or `![label](loom:item-uuid#heading-slug)` embeds an item or section. Embedded content has source actions; source edits refresh it. Link-like text inside inline code and fenced code stays inert.

Loom automatically saves committed items and workspace state to browser-local storage and restores them when the page is reopened. Use **Save EDN** and **Import EDN** for portable file copies; a save is refused while an item or snippet draft is unapplied. Import validates the complete knowledge base before replacing the current one, and Loom warns before replacing unsaved work. Local-storage failures are reported without interrupting editing, and Loom warns before leaving only when an unapplied draft remains. Imported snippets remain inert until the user runs them.

Only fenced blocks tagged `clojurescript` are executable; the legacy `cljs loom` tag remains supported. `clojure` fences are display-only and receive safe DOM syntax highlighting, while `cljs` fences and inline code remain ordinary examples. Executable blocks run automatically whenever their item is rendered in display mode; item editing shows their Markdown source, and display mode shows the result. Applying an edit or opening a rendered imported item executes its current code. Snippets share the session's `loom.user` namespace. The canonical API is `(loom/items)`, `(loom/items {:tag :clojure})`, `(loom/item id)`, `(loom/link id)` or `(loom/link id label)`, and `(loom/data value)`; the same functions remain available under the compatibility namespace `loom.core`. Item lists return summaries, item reads return full item maps, links return navigable Hiccup anchors, and data wrappers force EDN presentation. Strings render as text, supported Hiccup as DOM, and other structured values as EDN. Item-ID, item-list/tag, and rendered Hiccup link targets trigger selective refresh while the card stays open. Generated output is not stored in the item body.

**Open only code you trust.** Scittle snippets can use `js/globalThis` to access browser JavaScript; Hiccup validation is not a code sandbox. Rendering an item executes its executable blocks automatically, so imported or untrusted executable content must not be opened until reviewed. Transcluded executable fences remain inert. Each rendered snippet has two SVG controls in its upper-right corner: **View result** shows the evaluated output, while **Edit code** opens a syntax-highlighted structural editor for that fence only. Code uses the classic web-safe monospace stack `Courier New`, `Courier`, `monospace`, with fixed 14 px text, 21 px line height, disabled ligatures, and soft wrapping. The editor hides the textarea's native caret and positions a custom caret from the matching offset in the highlighted text, so it follows wrapping and scrolling; the custom caret is hidden for selections and when the editor is unfocused. The editor uses matching icon-only **Apply code** and **Cancel** controls in its upper-right corner. Switching back to **View result** with unapplied code asks before discarding the draft. Ctrl+Right slurps, Ctrl+Left barfs, Ctrl+Up splices, and Ctrl+Down wraps a form. Slurp and barf treat reader-prefixed forms such as `#(...)`, `#{...}`, `#"..."`, quote, and deref as single forms; barf preserves intervening comments and whitespace and keeps the cursor with the moved form. Backspace immediately after a closing delimiter, or Delete immediately before an opening delimiter, moves the cursor across that delimiter instead of removing it; this rule covers `()`, `[]`, `{}`, and double-quoted strings. Apply changes only the code span; Cancel keeps the Markdown source unchanged. Scittle 0.8.33 is redistributed under EPL-1.0; see `THIRD_PARTY_NOTICES.md` and `licenses/EPL-1.0.txt`.

`npm run test:loom` runs the current Loom model, workspace, persistence, rendering, snippet, structural-editor, and standalone artifact tests. The complete `npm test` command includes them.

## Source layout

- `src/index.html` and `src/css/style.css` contain the application shell and styles.
- `src/js/` contains the grid, editor, workbook model, formula engine, Scittle bridge, editor source analysis, and persistence code.
- `tools/build.js` bundles the application into the standalone HTML file; `tools/serve.js` provides the local development server.
- `tests/` contains unit, integration, and built-artifact checks.
