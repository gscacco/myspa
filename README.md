# Foglio

Foglio is a small browser-based spreadsheet experiment. It combines a cell grid with JavaScript-style formulas and an embedded interpreter for a subset of ClojureScript, including an editor for user-defined functions.

## Project status

This project is a proof of concept. Its purpose is to explore the spreadsheet and ClojureScript editing experience; it is not a production-ready spreadsheet or a compatibility replacement for established spreadsheet software. Features and file formats may change as the experiment evolves.

There is currently no schedule or timeline for future versions.

## What it can do

- Edit workbooks with multiple sheets, each with a 100-row by 26-column grid.
- Use cell references, ranges, absolute references, and references to other sheets in formulas.
- Recalculate dependent cells and report formula errors, including circular references.
- Write formulas using infix expressions such as `=B2*C2`, or ClojureScript forms such as `=(SUM B2:B5)`.
- Define functions in the ClojureScript editor and call them from formulas.
- Edit cell formulas in the same syntax-highlighted, line-numbered editor used for function definitions. Enter inserts a line; Ctrl+Enter applies a cell formula or evaluates the form before the cursor.
- Apply basic formatting, including bold text, decimal places, and background colors. Copy and paste cell ranges, and undo or redo workbook changes.
- Save and reopen a workbook as a standalone HTML file containing the application and workbook data.

The embedded ClojureScript interpreter supports a subset of the language, not the full ClojureScript ecosystem. It has no JVM, compiler toolchain, or external library integration. The exact supported forms and functions are implemented in `src/js/cljs.js` and can evolve with the prototype.

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

This creates `dist/foglio.html`. Open that file in a browser to use the standalone build. Saving and opening use the browser's file picker when available, with download and file-input fallbacks.

## Checks

Run the complete test suite and verify the generated standalone artifact with:

```sh
npm run check
```

The individual commands are `npm run test:unit`, `npm run test:integration`, and `npm run test:e2e`.

## Source layout

- `src/index.html` and `src/css/style.css` contain the application shell and styles.
- `src/js/` contains the grid, editor, workbook model, formula engine, ClojureScript subset interpreter, and persistence code.
- `tools/build.js` bundles the application into the standalone HTML file; `tools/serve.js` provides the local development server.
- `tests/` contains unit, integration, and built-artifact checks.
