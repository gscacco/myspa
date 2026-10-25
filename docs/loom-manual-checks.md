# Loom manual checks

**Status:** Required before claiming usability. This checklist records observations; it is not evidence until the browser, viewport, date, and result are filled in.

## Environment

- Record browser and version, operating system, viewport dimensions, and whether Loom was opened from `file://` or the development server.
- Verify **Save EDN** and **Import EDN** in the target browser, including browsers without the File System Access API.

## Workspace and keyboard

- Open several items from search and links; confirm earlier cards, drafts, and scroll positions remain intact.
- Close and delete cards independently; confirm the remaining active card receives focus, or search receives focus when none remain.
- Navigate back and forward; confirm deleted IDs are skipped without errors.
- Complete the main workflow using only the keyboard: search, open, edit, apply, cancel, close, delete, save, import, back, and forward.
- Confirm labels, status announcements, visible focus, and error messages are usable with a screen reader.

## Editing and rendering

- Render headings, lists, quotes, tables, code examples, links, whole-item transclusion, and section transclusion.
- Insert `[[item:...]]` links by typing `[[`; verify the picker groups title/tag matches first, works by mouse and keyboard, inserts only the stable-ID reference, and closes with Escape.
- Use every formatting-toolbar control with a selection, a multi-line selection, and a collapsed cursor; confirm only the intended Markdown changes, focus returns to the field, and Ctrl/Cmd+B and Ctrl/Cmd+I work.
- Insert an executable block from the toolbar, enter code, Apply, and confirm the rendered output replaces the source until the item is edited again.
- Rename a linked item and confirm every Markdown link displays the new title without rewriting source; delete it and confirm the reference becomes unresolved rather than resolving by title.
- Confirm link-like text in inline code, `clojure` examples, display-only fences, and executable source stays inert.
- Confirm raw HTML, unsafe URLs, unsupported images, and unsupported Hiccup remain inert or produce local diagnostics.
- Confirm missing sections, transclusion cycles, and nesting limits fail locally without breaking unrelated content.
- Open two snippet editors in one item, change the second, and verify save and leave protection still detect the draft.
- Exercise Paredit operations with nested delimiters, strings, comments, and partial forms; verify surrounding Markdown is unchanged.
- Type a comment, string, keyword, number, built-in call, and special form in a snippet editor; confirm the classic Courier New monospace glyphs are used, colors update while typing, the caret aligns with text, and both stay aligned after wrapping, scrolling, and field resizing.
- Place the cursor after each of `)`, `]`, `}`, and the closing `"`, press Backspace, and confirm the source is unchanged while the cursor moves left. Repeat before each opening delimiter with Delete and confirm the cursor moves right.
- Render `clojurescript` and legacy `cljs loom` blocks; confirm they execute automatically, item editing shows their source, `clojure` remains display-only and highlighted, and `cljs` remains an ordinary example.

## Persistence and security

- Create and edit items, reload the page without exporting, and confirm items and open-card order are restored from local storage.
- Save, reload, and import an EDN file; confirm items and open-card order round-trip.
- Cancel save and import; confirm current edits and drafts remain unchanged.
- Import malformed, unsupported, and hostile EDN; confirm the current knowledge base is preserved.
- Import Markdown containing executable fences and hostile markup; confirm no raw active markup executes, and that executable snippets run only when their items are rendered in the workspace.
- Confirm no generated snippet output is persisted in item bodies.
- Open the standalone `dist/loom.html` from `file://` with network disabled; confirm Loom boots and evaluates a local `clojurescript` block without requests or external runtime assets.
- Confirm the generated artifact contains the Scittle 0.8.33 EPL notice and that `THIRD_PARTY_NOTICES.md` and `licenses/EPL-1.0.txt` are present.

## Layout

- Inspect desktop and narrow viewports for readable typography, card boundaries, overflow, focus visibility, and non-overlapping controls.
- Confirm the left sidebar contains only New Item, search, and grouped results, with no folders, graph view, dashboard, or unrequested panel.
