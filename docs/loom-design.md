# Loom design decisions

**Status:** Approved design. These contracts describe planned behavior, not implemented behavior.

There is no existing ADR format in this repository. This document records the decisions that would otherwise need several ADRs. Revisions that materially change the contracts below require approval before implementation.

## Application boundary and build

Loom will live under `loom/`, with its own HTML shell, CSS, JavaScript entry point, and modules. `tools/build-loom.js` will follow the existing esbuild single-file pattern and embed the pinned Scittle bundle. `npm run build:loom` will generate ignored `dist/loom.html`; the existing `build` and `build:timetable` commands retain their meanings. The development server already serves paths under the repository root. Nix remains a development convenience only.

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

The shared strict EDN subset supports keyword and string map keys, vectors, strings, keyword values, finite numbers, booleans, and nil; it does not evaluate forms. Schema validation rejects unsupported versions, unknown fields, invalid UUIDs/times/tags, duplicate IDs, and workspace IDs absent from the imported item set. Markdown references to missing items are allowed and diagnosed when rendered. Import parses and validates before any replacement, then confirms replacement if there are unsaved edits. Export writes the current model as `.edn`, using the browser file picker when available and a download fallback. There is no initial IndexedDB or automatic save promise. The UI marks unsaved changes and warns before leaving.

The shipped HTML starts with an empty knowledge base. User data is kept in a separate EDN file; saving user content never injects it into an executable HTML artifact. This also allows data to move to a newer Loom build without carrying older application code.

## Workspace and search

The primary surface is a horizontally scrollable set of independently closable item cards. On narrow screens, cards stack in reading order. Opening a link or search result focuses an existing card or adds a card while preserving the others and their edit/scroll state. The workspace has search, new item, and back/forward actions, but no mandatory sidebar, folders, dashboard, or graph.

Search matches case-folded title, tag name, and body text. It uses a derived in-memory index updated for changed items and limits the displayed result list. Results identify the matching item and are keyboard operable. A navigation history entry records open card IDs, their order, and the active ID for open, close, and focus transitions. Back/forward restore those snapshots; stale IDs from subsequently deleted items are skipped. The current workspace order and active ID are included in EDN export.

## Markdown links and transclusion

Loom accepts normal Markdown syntax. The Loom-specific meaning is confined to URLs with the `loom:` scheme:

```markdown
[Related idea](loom:550e8400-e29b-41d4-a716-446655440000)
![Embedded idea](loom:550e8400-e29b-41d4-a716-446655440000)
![Selected section](loom:550e8400-e29b-41d4-a716-446655440000#heading-slug)
```

A Markdown link opens a card. A Markdown image with a `loom:` target transcludes content; its alternative text is an accessible label. Other image targets are shown as inert links/labels in the initial release. The source item ID remains in the rendered embed, and a visible source action opens the source card. An Edit source action navigates to its source and the requested section. The embedded DOM is derived from the current source model and is never written into the parent body.

A section begins at the target heading and ends before the next heading of equal or higher level. Heading slugs are computed from case-folded heading text with spaces collapsed to hyphens and punctuation removed; repeated headings receive `-2`, `-3`, and so on in source order. A changed heading may invalidate its old link and produces a local missing-section diagnostic. Nested embeds are resolved recursively. The renderer tracks `(item ID, section slug)` along its current path to detect cycles and imposes a maximum depth of 16. A failed embed does not stop sibling content. Transcluded executable fences remain inert and link to the source; transclusion does not run source code indirectly.

## Markdown and Hiccup DOM rendering

One maintained Markdown parser will provide a token/AST representation. Loom will create DOM nodes from supported tokens; it will not insert user-authored Markdown or snippet output through `innerHTML`. Raw Markdown HTML is displayed as inert text. The supported initial Markdown surface is paragraphs, headings, emphasis, strong text, lists, block quotes, thematic breaks, inline code, fenced code, links, and Loom transclusion. Unsupported constructs receive text or a local diagnostic, never active HTML.

Hiccup is a vector whose first value is a keyword naming an allowed element, optionally followed by a map with keyword attribute keys and then children. Allowed elements are `p`, `span`, `div`, `section`, `article`, `aside`, `h1` through `h6`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `em`, `strong`, `b`, `i`, `small`, `br`, `hr`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, and `a`. Children can be supported Hiccup nodes, text/scalars, or ordered collections of children. Empty values render nothing. A collection of Hiccup nodes renders as a fragment. An unsupported tag, attribute value, or malformed node raises a local rendering error.

Allowed attributes are `class`, `title`, `aria-*`, and non-reserved `data-*`; anchors may also have `href`, and table cells may have positive integer `colspan`/`rowspan`. Snippet-provided `id`, `style`, `on*`, `src`, `srcdoc`, `target`, DOM nodes, functions, and other attributes are rejected. `data-loom-*` is reserved for application navigation. `href` accepts a validated `loom:` item ID, `https:`, `http:`, or `mailto:`. External links receive safe `rel`/`target` values set by Loom. The same URL checks apply to Markdown links. An arbitrary string result is a text node, never markup.

The result contract is: nil renders nothing; strings, numbers, booleans, and keywords render as text; a recognized Hiccup vector renders as a node; a sequence of Hiccup nodes renders as a fragment; other EDN data renders in a readable `<pre>`. `loom.core/data` explicitly forces EDN display for a data vector that could otherwise look like Hiccup. The renderer receives the original SCI value or a typed representation, not a blind `clj->js` conversion that loses keyword/data distinctions. Rendering imposes finite node and depth budgets to avoid runaway output.

## Executable snippets, API, and trust

Only a fenced Markdown block whose complete info string is `cljs loom` is executable. A plain `cljs` fence, other fenced code, and inline code are examples. A snippet may contain ordinary ClojureScript forms; the last form's value is rendered at that fence. Standard ClojureScript functions, `let`, `fn`, threading, and collection composition remain available through Scittle/SCI. Snippets run in one session-scoped `loom.user` namespace requiring `loom.core`; definitions can be shared in that session but are not stored as generated output. Loom supplies:

| Function | Contract and dependency |
| --- | --- |
| `(loom.core/items)` or `(loom.core/items {:tag :clojure})` | Returns a vector of item summary maps containing `:id`, `:title`, and `:tags`. The unfiltered call depends on the metadata index; a tag-filtered call depends on that tag's membership and matching summaries. It does not return bodies. |
| `(loom.core/item id)` | Returns the full item map or nil and records a dependency on that item ID, including body and metadata. |
| `(loom.core/link id label)` | Returns a supported Hiccup anchor for a validated item ID. It does not open the item until the user activates the rendered link. |
| `(loom.core/data value)` | Returns an explicit EDN-display result wrapper, preserving the distinction between data and a Hiccup-shaped vector. |

For example, a snippet can return `(into [:ul] (map (fn [{:keys [id title]}] [:li (loom.core/link id title)]) (sort-by :title (loom.core/items {:tag :clojure}))))`.

Every snippet initially shows a Run control and no evaluated output. Importing, opening, searching, previewing, and transcluding never execute it. Run authorizes that exact source version of that snippet for the current session. Any edit to its containing item's Markdown body invalidates the item's active snippets, avoiding ambiguous fence identity after offsets shift; each edited snippet must be run again. An active, visible snippet may rerun after changes to dependencies observed through `loom.core/items` or `loom.core/item`. A tag query reruns on membership or matching title/tag changes, not on an unrelated body's edit. An item-ID read reruns when that item changes. The update queue coalesces multiple changes from one edit, reevaluates only affected active snippets, and never persists generated output. Closing a card disposes its subscriptions. Parse, evaluation, and rendering errors stay at the failing fence; retry uses Run.

SCI code can reach browser JavaScript through `js/globalThis`. Neither SCI nor Hiccup is a security sandbox. A snippet can have side effects outside the tracked Loom API, and those effects or cross-snippet definitions cannot be dependency-tracked or undone. Users should run only code they trust. Loom will not auto-run imported or newly opened snippets, and the Run control and documentation will state this boundary. Long-running trusted code may block the browser main thread; a worker or restricted runtime is outside the initial scope.

## Editing and verification boundary

Markdown source is edited as Markdown. A `cljs loom` fence has a focused structural editor that edits only its code span. Its Paredit operations are extracted from Foglio and tested against nested delimiters, escaped strings, comments, and malformed partial forms before integration. Apply replaces only the fence body at its known source offsets; Cancel leaves the body unchanged. Both preserve open cards, the originating item, focus, and scroll context. A conflict between a draft and changed source is reported before applying.

Node unit tests cover pure model, codec, parser mapping, dependency, and Paredit behavior. JSDOM integration tests cover workspace, editing, accessibility hooks, errors, import, and rendering. A built-artifact JSDOM test covers offline boot and embedded assets. Existing `npm run check`, `npm run build:timetable`, and `npm run test:e2e:timetable` remain regression gates. A real-browser keyboard, narrow-viewport, and file import/export walkthrough is required before a usability claim. See [requirements-traceability.md](requirements-traceability.md) for planned test IDs.
