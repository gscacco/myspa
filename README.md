# Foglio

Foglio is a small browser-based spreadsheet experiment. It combines a cell grid with JavaScript-style formulas and a ClojureScript editor for user-defined functions, evaluated by Scittle/SCI in the browser.

## Project status

This project is a proof of concept. Its purpose is to explore the spreadsheet and ClojureScript editing experience; it is not a production-ready spreadsheet or a compatibility replacement for established spreadsheet software. Features and file formats may change as the experiment evolves.

There is currently no schedule or timeline for future versions.

## What it can do

- Edit workbooks with multiple sheets, each with a 100-row by 26-column grid.
- Use cell references, ranges, absolute references, and references to other sheets in formulas.
- Recalculate dependent cells and report formula errors, including circular references.
- Write ClojureScript forms directly in cells, such as `(+ 1 2 3)`, `:pippo`, `[1 2 3]`, and `{:pippo 12}`. Existing infix formulas such as `=B2*C2` remain supported.
- Define functions in the ClojureScript editor and call them from formulas.
- Open the selected cell in the syntax-highlighted, line-numbered editor with Ctrl+Enter. In the editor, Enter inserts a line and Ctrl+Enter applies a cell formula or evaluates the form before the cursor.
- Apply basic formatting, including bold text, decimal places, and background colors. Copy and paste cell ranges, and undo or redo workbook changes.
- Save and reopen a workbook as a standalone HTML file containing the application and workbook data.

The runtime is Scittle 0.8.33, which evaluates ClojureScript through SCI. It does not require Java or a JVM. SCI is an interpreter, not the official ClojureScript compiler, and it does not provide the complete ClojureScript build and library ecosystem. The spreadsheet functions and cell-reference bridge are defined in `src/js/scittle-runtime.js`; `src/js/cljs.js` contains the editor reader and compatibility wrappers that delegate evaluation to Scittle.

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
