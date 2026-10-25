# Loom design decisions

**Status:** Approved design. Implementation is in progress; see traceability for delivered behavior.

There is no existing ADR format in this repository. This document records the decisions that would otherwise need several ADRs. Revisions that materially change the contracts below require approval before implementation.

## Application boundary and build

Loom will live under `loom/`, with its own HTML shell, CSS, JavaScript entry point, and modules. `tools/build-loom.js` will follow the existing esbuild single-file pattern and embed the pinned Scittle bundle. The artifact also embeds the Scittle version, copyright, EPL-1.0 license, and upstream-source attribution; the full license and redistribution notice are tracked in `licenses/EPL-1.0.txt` and `THIRD_PARTY_NOTICES.md`. `npm run build:loom` will generate ignored `dist/loom.html`; the existing `build` and `build:timetable` commands retain their meanings. The development server already serves paths under the repository root. Nix remains a development convenience only.

The generic, tested Paredit operations in Foglio and the strict EDN codec in Timetable should be extracted into `shared/js/` with their existing import paths kept as re-exports. This avoids making Loom depend on another application's UI while preserving its tested implementation. Foglio's textarea DOM adapter and spreadsheet-specific completion are not copied into Loom. Loom uses the same Scittle distribution and a Loom-specific runtime bridge; it does not import Foglio's `sheet.core` functions or its workbook namespace.

## Durable model and import

The canonical user file is UTF-8 EDN. The initial schema is:

```clojure
{:schema-version 1
 :items [{:id "550e8400-e29b-41d4-a716-446655440000"
          :title "An item"
          :body "Markdown source"
          :tags [:clojure]
          :created-at "2026-10-23T00:00:00.000Z"
          :updated-at "2026-10-23T00:00:00.000Z"}]
 :workspace {:open-ids ["550e8400-e29b-41d4-a716-446655440000"]
             :active-id "550e8400-e29b-41d4-a716-446655440000"}}
```

Item IDs are UUID strings generated with browser cryptographic randomness. IDs never change on title, tag, body, or position edits. Titles need not be unique. Tags are EDN keywords, not strings. Times are UTC ISO 8601 strings. `:items` order is a display/default order, not identity. `:open-ids` contains each open ID at most once, and `:active-id` is nil when no card is open. A deleted item's old Markdown references remain broken references until edited; deletion removes it from saved workspace state. Exploration back/forward stacks and generated snippet output are transient and are not serialized.

The shared strict EDN subset supports keyword and string map keys, vectors, strings, keyword values, finite numbers, booleans, and nil; it does not evaluate forms. Schema validation rejects unsupported versions, unknown fields, invalid UUIDs/times/tags, duplicate IDs, and workspace IDs absent from the imported item set. Markdown references to missing items are allowed and diagnosed when rendered. Import parses and validates before any replacement, then confirms replacement if there are unsaved edits. Export writes the current model as `.edn`, using the browser file picker when available and a download fallback.

After every committed item, deletion, import, or workspace transition, Loom writes the same validated EDN representation to browser `localStorage` under `loom.knowledge-base`. On boot, valid stored data replaces the empty initial model and restores both items and open-card order. Corrupt stored data is ignored rather than partially loaded. A storage read or write failure leaves in-memory editing available and is surfaced in the status area. Applied changes are locally durable and do not trigger a leave warning; unapplied item and snippet drafts still do.

The shipped HTML starts with an empty knowledge base when no local data exists. User data is kept in browser-local storage and may also be exported to a separate EDN file; saving user content never injects it into an executable HTML artifact. This also allows data to move to a newer Loom build without carrying older application code.

## Workspace and search

The primary surface is a vertical stack of independently closable item cards beside a narrow search sidebar. The most recently opened item is at the top. Opening a link or search result moves an existing card to the top or adds a card while preserving the others and their edit/scroll state. The sidebar contains only the New Item button, the search field, and grouped results. There are no folders, dashboard, or graph views.

Search updates while the user types and matches case-folded partial title, tag name, and body text. Title/tag matches are grouped before content-only matches, every item appears once, and result metadata shows the matching tag or a content excerpt. Results identify the matching item and are keyboard operable. A navigation history entry records open card IDs, their order, and the active ID for open, close, and focus transitions. Back/forward restore those snapshots; stale IDs from subsequently deleted items are skipped. The current workspace order and active ID are included in EDN export.

Display-mode cards expose Edit, Close, and Delete SVG actions in their upper-right corner. Editing mode replaces them with Apply, Cancel Changes, and Delete and adds a Markdown formatting toolbar. Apply creates or updates exactly one item; Cancel restores the saved version or discards a new draft; Close only removes a card from the workspace. New items remain in memory until Apply and are never persisted to local storage or EDN as drafts.

The formatting toolbar offers bold, italic, strikethrough, inline code, heading, bulleted list, blockquote, item-link, and executable-code actions. It transforms only the selected range or current line/cursor in the Markdown textarea, returns focus to the field, and preserves the surrounding source. Bold and italic also respond to Ctrl/Cmd+B and Ctrl/Cmd+I. The executable-code action inserts a `clojurescript` fence and places the cursor in its code body.

## Markdown links and transclusion

Loom accepts normal Markdown syntax plus a stable-ID item reference extension. The canonical link source contains only the target UUID:

```markdown
[[item:550e8400-e29b-41d4-a716-446655440000]]
```

The parser resolves the ID against the current item store and renders the target's current title. Renaming the target changes the displayed link without rewriting the source. A missing target renders a local unresolved-link indicator; title matching is never used as a fallback. The extension is recognized only in ordinary Markdown inline contexts, not in inline code, fenced examples, executable source, escaped syntax, or malformed references. The older URL form remains supported for compatibility:

```markdown
[Related idea](loom:550e8400-e29b-41d4-a716-446655440000)
![Embedded idea](loom:550e8400-e29b-41d4-a716-446655440000)
![Selected section](loom:550e8400-e29b-41d4-a716-446655440000#heading-slug)
```

Typing `[[` in the item Markdown editor opens an item-search popup near the cursor. It reuses the sidebar's search implementation, keeps title/tag matches before content-only matches, supports mouse and keyboard selection, and dismisses with Escape. Selection replaces only the triggering `[[` and inserts the canonical stable-ID reference, preserving unrelated text and drafts.

A Markdown link opens a card. A Markdown image with a `loom:` target transcludes content; its alternative text is an accessible label. Other image targets are shown as inert links/labels in the initial release. The source item ID remains in the rendered embed, and a visible source action opens the source card. An Edit source action navigates to its source and the requested section. The embedded DOM is derived from the current source model and is never written into the parent body.

A section begins at the target heading and ends before the next heading of equal or higher level. Heading slugs are computed from case-folded heading text with spaces collapsed to hyphens and punctuation removed; repeated headings receive `-2`, `-3`, and so on in source order. A changed heading may invalidate its old link and produces a local missing-section diagnostic. Nested embeds are resolved recursively. The renderer tracks `(item ID, section slug)` along its current path to detect cycles and imposes a maximum depth of 16. A failed embed does not stop sibling content. Transcluded executable fences remain inert and link to the source; transclusion does not run source code indirectly.

## Markdown and Hiccup DOM rendering

One maintained Markdown parser will provide a token/AST representation. Loom will create DOM nodes from supported tokens; it will not insert user-authored Markdown or snippet output through `innerHTML`. Raw Markdown HTML is displayed as inert text. The supported initial Markdown surface is paragraphs, headings, emphasis, strong text, lists, block quotes, thematic breaks, inline code, fenced code, links, and Loom transclusion. Unsupported constructs receive text or a local diagnostic, never active HTML.

The rendering feature selected `marked` 18.1.1 as that parser. Loom consumes its lexer tokens and constructs DOM nodes itself; it does not use Marked's HTML output as DOM input.

Hiccup is a vector whose first value is a keyword naming an allowed element, optionally followed by a map with keyword attribute keys and then children. Allowed elements are `p`, `span`, `div`, `section`, `article`, `aside`, `h1` through `h6`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `em`, `strong`, `b`, `i`, `small`, `br`, `hr`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, and `a`. Children can be supported Hiccup nodes, text/scalars, or ordered collections of children. Empty values render nothing. A collection of Hiccup nodes renders as a fragment. An unsupported tag, attribute value, or malformed node raises a local rendering error.

Allowed attributes are `class`, `title`, `aria-*`, and non-reserved `data-*`; anchors may also have `href`, and table cells may have positive integer `colspan`/`rowspan`. Snippet-provided `id`, `style`, `on*`, `src`, `srcdoc`, `target`, DOM nodes, functions, and other attributes are rejected. `data-loom-*` is reserved for application navigation. `href` accepts a validated `loom:` item ID, `https:`, `http:`, or `mailto:`. External links receive safe `rel`/`target` values set by Loom. The same URL checks apply to Markdown links. An arbitrary string result is a text node, never markup.

The result contract is: nil renders nothing; strings, numbers, booleans, and keywords render as text; a recognized Hiccup vector renders as a node; a sequence of Hiccup nodes renders as a fragment; other EDN data renders in a readable `<pre>`. `loom/data` (also `loom.core/data`) explicitly forces EDN display for a data vector that could otherwise look like Hiccup. The renderer receives the original SCI value or a typed representation, not a blind `clj->js` conversion that loses keyword/data distinctions. Rendering imposes finite node and depth budgets to avoid runaway output.

The implemented bridge serializes normalized SCI results as EDN and reads them with the shared strict codec. It converts finite sequential results to vectors while preserving keywords, maps, and scalar types. A sequential result over 1000 values reports an error instead of truncating silently. This conversion is presentation-specific; it does not turn returned strings into HTML.

## Executable snippets, API, and trust

Only a fenced Markdown block whose complete info string is `clojurescript` is executable. The legacy `cljs loom` marker remains supported. A `clojure` fence is display-only and receives DOM-safe syntax highlighting, while plain `cljs`, other fenced code, and inline code are ordinary examples. A snippet may contain ordinary ClojureScript forms; the last form's value is rendered at that fence. Standard ClojureScript functions, `let`, `fn`, threading, and collection composition remain available through Scittle/SCI. Snippets run in one session-scoped `loom.user` namespace requiring `loom` and the compatibility namespace `loom.core`; definitions can be shared in that session but are not stored as generated output. Loom supplies:

| Function | Contract and dependency |
| --- | --- |
| `(loom/items)` or `(loom/items {:tag :clojure})` | Returns a vector of item summary maps containing `:id`, `:title`, and `:tags`. The unfiltered call depends on the metadata index; a tag-filtered call depends on that tag's membership and matching summaries. It does not return bodies. |
| `(loom/item id)` | Returns the full item map or nil and records a dependency on that item ID, including body and metadata. |
| `(loom/link id)` or `(loom/link id label)` | Returns a supported Hiccup anchor for a validated item ID. The renderer supplies the current target title, and the link uses the same navigation and missing-target behavior as Markdown links. It does not open the item until the user activates it. |
| `(loom/data value)` | Returns an explicit EDN-display result wrapper, preserving the distinction between data and a Hiccup-shaped vector. |

The same functions are available as `loom.core/items`, `loom.core/item`, `loom.core/link`, and `loom.core/data` for existing snippets. For example, a snippet can return `(into [:ul] (map (fn [{:keys [id title]}] [:li (loom/link id title)]) (sort-by :title (loom/items {:tag :clojure}))))`.

Executable blocks run automatically whenever their item is rendered in display mode. Item editing exposes the Markdown source instead of the rendered result; Apply reruns snippets from the edited source, while Cancel restores the saved display. Display mode hides the source block and shows its output. Upper-right SVG controls switch between **View result** and **Edit code**; the source editor exposes matching icon-only **Apply code** and **Cancel** actions. Transcluded executable fences remain inert. An active, visible snippet may rerun after changes to dependencies observed through `loom/items`, `loom/item`, or rendered Loom links. Dependencies use a shared item-key convention, so direct Hiccup anchors and `loom/link` results behave consistently. A tag query reruns on membership or matching title/tag changes, not on an unrelated body's edit. An item-ID read or rendered link reruns when that target changes. The update queue coalesces multiple changes from one edit, reevaluates only affected snippets, and never persists generated output. Closing a card disposes its subscriptions. Parse, evaluation, and rendering errors stay at the failing fence and are retried on the next render.

SCI code can reach browser JavaScript through `js/globalThis`. Neither SCI nor Hiccup is a security sandbox. A snippet can have side effects outside the tracked Loom API, and those effects or cross-snippet definitions cannot be dependency-tracked or undone. Because rendering executes snippets automatically, imported or newly opened executable content must be trusted before it is displayed. Documentation and the interface state this boundary. Long-running trusted code may block the browser main thread; a worker or restricted runtime is outside the initial scope.

## Editing and verification boundary

Markdown source is edited as Markdown, with the formatting toolbar operating on the textarea selection. A `clojurescript` or legacy `cljs loom` fence also has a focused structural editor that edits only its code span. Its Paredit operations are extracted from Foglio and tested against nested delimiters, escaped strings, comments, and malformed partial forms before integration. The textarea and `aria-hidden` highlight layer reuse Foglio's absolute-overlay structure: both share embedded JetBrains Mono, disabled ligatures, 14 px text, 21 px line height, identical padding, no soft wrapping, and synchronized two-axis scrolling. Long lines scroll horizontally, and the surrounding field is vertically resizable. `build:loom` converts the vendored WOFF2 sources to data URLs so the standalone document remains offline. When Backspace or Delete would remove a single structural delimiter at a collapsed cursor, the editor moves the cursor across that delimiter instead and leaves the source intact. Round, square, and curly delimiters and double quotes follow the same rule. Apply replaces only the fence body at its known source offsets and immediately reruns the rendered item; Cancel leaves the body unchanged. Both preserve open cards, the originating item, focus, and scroll context. A conflict between a draft and changed source is reported before applying.

Node unit tests cover pure model, codec, parser mapping, dependency, and Paredit behavior. JSDOM integration tests cover workspace, editing, accessibility hooks, errors, import, and rendering. A built-artifact JSDOM test covers offline boot, real Scittle execution from a `file://` URL, embedded assets, and Scittle attribution. Existing `npm run check`, `npm run build:timetable`, and `npm run test:e2e:timetable` remain regression gates. A real-browser keyboard, narrow-viewport, and file import/export walkthrough is required before a usability claim. See [requirements-traceability.md](requirements-traceability.md) for planned test IDs.
