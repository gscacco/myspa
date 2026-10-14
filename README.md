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
- Apply basic formatting, including bold text, decimal places, and background colors. Copy and paste cell ranges, and undo or redo workbook changes.
- Save and reopen a workbook as a standalone HTML file containing the application and workbook data.

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

The first supported event is `:on-selection-change`. Hooks run synchronously after the grid commits a genuinely different selection. The initial A1 selection at startup does not emit an event. Cell and range selections include the sheet name and A1 references for the anchor, focus, and normalized range. Switching sheets is a selection change as well.

The Help reference documents the hook functions and payload keywords. It also documents the Messages levels (`:info`, `:warn`, `:error`, `:debug`) and metadata keys such as `:category`, `:details`, and `:exception`.

Register a ClojureScript function to log each selection change to Messages:

```clojure
(defn report-selection [event]
  (log! :info
    (str "Selection changed to "
         (get-in event [:data :selection :range]))))

(add-hook :on-selection-change report-selection)
```

The payload has the form `{:event :on-selection-change, :timestamp "…", :source :ui, :data {:previous-selection …, :selection …}}`. Each selection descriptor contains `:sheet`, `:anchor`, `:focus`, and `:range`. Registering the same function twice is ignored. `remove-hook` returns `false` if the function was not registered; `clear-hook` removes all hooks for the event; and `list-hooks` returns the registered functions, optionally for a specified event. `run-hook` manually dispatches an event and returns the number of hooks attempted. Only `:on-selection-change` is supported; unsupported events raise an error. Each dispatch uses a stable listener snapshot, and a failing hook is reported in Messages while later hooks still run.

Remove a hook when it is no longer needed:

```clojure
(remove-hook :on-selection-change report-selection)
```

## Try it locally

Requirements: Node.js 20.19 or newer and npm.

```sh
npm ci
npm run dev
```

Open <http://localhost:8080/src/index.html> in a browser. The development server serves the source files; ES modules are not intended to be opened directly from `file://`.

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

The individual commands are `npm run test:unit`, `npm run test:integration`, and `npm run test:e2e`.

## Source layout

- `src/index.html` and `src/css/style.css` contain the application shell and styles.
- `src/js/` contains the grid, editor, workbook model, formula engine, Scittle bridge, editor source analysis, and persistence code.
- `tools/build.js` bundles the application into the standalone HTML file; `tools/serve.js` provides the local development server.
- `tests/` contains unit, integration, and built-artifact checks.
