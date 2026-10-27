# Loom manual checks

**Status:** Required before claiming usability. This checklist records observations; it is not evidence until the browser, viewport, date, and result are filled in.

## Environment

- Record browser and version, operating system, viewport dimensions, and whether Loom was opened from `file://` or the development server.
- Open Setup from the left sidebar and verify **Save EDN** and **Import EDN** in the target browser, including browsers without the File System Access API. Close Setup and confirm the previous search query and results remain unchanged.
- Switch between the Updated, Opened, Search, and Tag browser pages. Confirm Updated shows the newest `:updated-at` first, Opened keeps the most recently opened item first even after its card closes, and Search shows the shared title/tag/content groups. Activate a tag on a displayed item and confirm the Tag page opens with that exact tag, lists every matching item once, and moves focus to the Tag tab; confirm the unselected prompt is visible before choosing a tag. With more than eight matches, use Previous and Next and confirm the page status and disabled boundary controls; clear and change the search query and confirm pagination resets to page one.
- Paste a screenshot with focus on the page, an open note, and a Markdown field; confirm each paste creates an image-only item titled `Screenshot: item:<uuid>` at the top without changing the note. Type `![[` and confirm image items appear with thumbnails; select one and confirm the note shows the image in a read-only transclusion with no source header. Confirm raw `[[file:` completion excludes the private image, reload restores it from IndexedDB, and deleting the image item removes its blob. Attach an ordinary file and confirm its downloadable reference.
- Use **Export files** and confirm `loom-files.json` downloads; import it into a clean browser profile and confirm existing `[[file:...]]` references resolve. Try a malformed bundle and confirm the store is unchanged and a local error appears.

## Workspace and keyboard

- Open several items from search and links; confirm earlier cards, drafts, and scroll positions remain intact.
- Use the icon-only **Close all items** toolbar control with several cards open; confirm every card closes without deleting data, the control has a visible tooltip and accessible name, search receives focus, and unsaved edits trigger a confirmation first.
- Close and delete cards independently; confirm the remaining active card receives focus, or search receives focus when none remain.
- Try deleting an item linked or transcluded by other items; confirm a modal lists each source once, Open all opens those cards without deleting the target, and Cancel dismisses the modal and retains both the target and focus. Confirm references in inline/fenced code do not trigger the warning. For an unreferenced item and a new-item draft, confirm Loom shows its own Delete/Discard and Cancel dialog rather than a browser confirmation; Cancel retains the card and Delete or Discard removes it.
- Navigate back and forward; confirm deleted IDs are skipped without errors.
- Complete the main workflow using only the keyboard: search, open, edit, apply, cancel, close, close all, delete, save, import, back, and forward.
- Confirm labels, status announcements, visible focus, and error messages are usable with a screen reader.

## Editing and rendering

- Click an item title and confirm the heading becomes a focused title field in the same header position, with no duplicate title field in the content form; apply and cancel both restore the expected heading.
- Render headings, lists, quotes, tables, code examples, links, whole-item and section transclusion; confirm `![[item:...]]` content appears without a border or source label, has no action buttons, and refreshes after editing its source.
- Insert `[[item:...]]` links by typing `[[`; verify the picker groups title/tag matches first, works by mouse and keyboard, inserts only the stable-ID reference, and closes with Escape.
- Start editing an item with tags used by other cards, focus the Tags field, and confirm the suggestion list filters while typing, excludes tags already entered, inserts the mouse/`Enter`/`Tab` choice in place of the current token, and closes with Escape.
- Open a tagged item and confirm its keyword labels appear above the content in presentation mode, disappear while editing alongside the Tags field, and refresh after Apply or Cancel; confirm an untagged item shows no empty tag list.
- Use every formatting-toolbar control with a selection, a multi-line selection, and a collapsed cursor; confirm only the intended Markdown changes, focus returns to the field, and Ctrl/Cmd+B and Ctrl/Cmd+I work.
- Insert an executable block from the toolbar, enter code, Apply, and confirm the rendered output replaces the source at the same top height as the single translucent Edit control until the item is edited again; confirm the Edit control becomes fully visible on hover and focus.
- Rename a linked item and confirm every Markdown link displays the new title without rewriting source; attempt to delete it and confirm the reference warning lists the source rather than resolving by title or deleting immediately.
- Confirm link-like text in inline code, `clojure` examples, display-only fences, and executable source stays inert.
- Confirm raw HTML, unsafe URLs, unsupported images, and unsupported Hiccup remain inert or produce local diagnostics.
- Confirm an item transcluding itself and an indirect cycle across multiple items both show a local diagnostic without breaking sibling content; repeat with a section target. Confirm nesting limits also fail locally.
- Open two snippet editors in one item, change the second, and verify save and leave protection still detect the draft.
- Exercise Paredit operations with nested delimiters, strings, comments, and partial forms; verify surrounding Markdown is unchanged.
- Slurp and barf reader-prefixed forms such as `#(inc %)`, `#{:x}`, `#"a b"`, `'x`, and `@x`; confirm each moves as one form. Barf a form after a comment and confirm the comment is retained and the cursor stays on the moved form.
- With the cursor inside a list preceded by another expression, press Ctrl+Shift+Right and confirm backward slurp pulls that expression into the list without moving the cursor. Press Ctrl+Shift+Left and confirm backward barf expels the first form to the left while keeping the cursor in place. Repeat with `[]` and `{}` and confirm the delimiters stay balanced.
- Put the cursor immediately after a closed collection but before its parent's closing delimiter, with a form after the parent, as in `(a [b]|) c`; press Ctrl+Right and confirm the parent slurps the following form instead of moving the inner collection's close over `)`.
- Type a comment, string, keyword, number, built-in call, and special form in a snippet editor; confirm the classic Courier New monospace glyphs are used, colors and the custom caret update while typing, no native caret is visible, and text and caret stay aligned after wrapping and scrolling. Select text or move focus away and confirm the custom caret disappears; return focus and confirm it reappears at the saved position.
- Place the cursor after each of `)`, `]`, `}`, and the closing `"`, press Backspace, and confirm the source is unchanged while the cursor moves left. Repeat before each opening delimiter with Delete and confirm the cursor moves right.
- Focus a snippet editor and type `ma`, `fil`, and `loom/`; confirm the completion list filters, the adjacent panel shows each selected symbol's signature and description, arrows move the active entry, and `Enter`, `Tab`, and mouse selection insert only the symbol without changing surrounding Markdown. Confirm `Escape` dismisses the list, `Ctrl/Cmd+Space` opens it with an empty prefix, suggestions stay hidden in strings, comments, and selections, and closing the snippet editor removes the panel.
- Evaluate `(+ 1 2)` at the end of the form with `Ctrl/Cmd+Enter`; confirm the bottom output area shows `3` and the item body remains unchanged. Define `(defn greet [name] (str "Hello " name))`, then evaluate `(greet "Loom")`; confirm the function is available and redefining it changes a later call. Confirm errors and unfinished-token diagnostics remain local to the bottom area.
- Use a snippet to read `(loom/items)` and `(loom/item id)`; confirm every item has creation and modification timestamps plus referenced and transcluded target summaries, including both canonical and legacy links, while code examples and malformed references are excluded.
- In two different items, evaluate `(loom/current-item-id)` and `(loom/current-item)` automatically and with `Ctrl/Cmd+Enter`; confirm each returns its own hosting item, never the selected card or another open item, and that snippets in contexts without a host return `nil`.
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
- Confirm the left sidebar contains only New Item, Setup, and the Updated, Opened, Search, and Tag browser pages, with no folders, graph view, dashboard, or unrequested panel. Verify the four tab labels and clickable tag chips fit at desktop and narrow widths, page controls remain reachable, and focus moves to the Search or Tag tab when that page is selected programmatically or from a tag.
