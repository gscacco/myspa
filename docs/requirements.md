# Loom requirements

**Status:** Approved requirements. Implementation is in progress; see traceability for delivered cases.

This document defines the initial Loom scope. `LOOM-001` through `LOOM-028` are stable requirement identifiers. A change to a requirement's meaning requires review before implementation; identifiers must not be reused. Planned tests and their links to these requirements are in [requirements-traceability.md](requirements-traceability.md). The proposed technical contracts are in [loom-design.md](loom-design.md).

## Application and data

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| LOOM-001 | Build Loom from this repository as `dist/loom.html`, using the existing Node and esbuild toolchain. | The artifact starts from `file://` with embedded CSS, JavaScript, and Scittle and no required external runtime assets or Nix installation. Foglio and Timetable keep their existing build commands. |
| LOOM-002 | Represent knowledge as independent items with immutable, unique IDs, a title, Markdown body, tags, and creation and modification timestamps. | Renaming or reordering an item preserves its ID and incoming references. Duplicate titles are allowed; duplicate IDs are rejected. |
| LOOM-003 | Persist a versioned knowledge base automatically in browser-local storage and as strict EDN files with explicit import and export. | Committed items and workspace state reload after reopening the page; supported values round-trip; unsupported schema versions, malformed EDN, duplicate IDs, and invalid workspace references are rejected before replacing live data. Corrupt local data is ignored, and local-write failures are reported. Unapplied drafts are reported before replacement or leaving. |
| LOOM-004 | Provide a shared, vertically stacked workspace where multiple items can remain open and be closed or focused independently, without a mandatory hierarchy or graph view. | The most recently opened item is at the top; opening a linked or searched item retains existing cards and their scroll/edit context; closing one card leaves the others open. |
| LOOM-005 | Resolve item links by ID rather than title or display position. | Markdown and generated Hiccup links open the target item in the workspace; a missing target produces a local diagnostic. |
| LOOM-006 | Provide fast incremental search as a direct entry point to items. | Case-insensitive partial matches are grouped with title/tag matches before content-only matches, each item appears once, and selecting a result opens it without clearing the workspace; empty and no-result states are explained. |
| LOOM-007 | Maintain workspace exploration history. | Back and forward revisit prior open-card and active-card states; saved open-card order survives an EDN export/import. Deleted item IDs in old history do not crash navigation. |

## Authoring, references, and rendering

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| LOOM-008 | Support whole-item transclusion by stable item ID. | Embedded content identifies its source, links to it, and updates when that source changes; the parent does not store generated copies. |
| LOOM-009 | Support section transclusion and nested transclusion with cycle and depth protection. | Heading targets resolve deterministically; missing sections, cycles, and excessive nesting display bounded, local diagnostics while unrelated content renders. |
| LOOM-010 | Make editing of transcluded content explicit. | An edit action opens the source item and its relevant section; editing the parent never silently writes to the source. |
| LOOM-011 | Render ordinary Markdown from a maintained parser through safe DOM construction. | Common text formatting, headings, lists, quotes, links, and code examples render; raw HTML is inert, and unsafe links or unsupported media do not execute. |
| LOOM-012 | Distinguish executable ClojureScript snippets from ordinary Markdown code examples using an exact, documented fence marker. | Only a fence whose info string is exactly `cljs loom` is executable; a `cljs` fence and inline code remain examples. Its result appears at the fence's position. |
| LOOM-013 | Require an explicit user Run action for each snippet before executing it. | Importing, opening, previewing, searching, and transcluding items never execute snippets. Running one snippet authorizes that snippet for its current source version during the current session only. |
| LOOM-014 | Expose a documented ClojureScript item and navigation API. | `loom.core/items`, `loom.core/item`, `loom.core/link`, and `loom.core/data` work with ordinary ClojureScript expressions, preserve item IDs, and return the documented value types. |
| LOOM-015 | Render snippet results according to value type. | Strings and scalar values become text, ordinary data has an EDN presentation, supported Hiccup becomes DOM, and collections of Hiccup nodes render in order. Generated links navigate in Loom. |
| LOOM-016 | Support a documented Hiccup subset of elements, attributes, nested children, and collections. | Supported structures render predictably; unknown tags, malformed nodes, and unsupported values show a local error rather than being treated as HTML source. |
| LOOM-017 | Apply safe attribute and URL rules to both Markdown and Hiccup rendering. | Event handlers, active content tags, unsafe URL schemes, and unapproved attributes are rejected; no arbitrary snippet-returned string is assigned to `innerHTML`. |
| LOOM-018 | Isolate snippet errors. | A parse, evaluation, or rendering error appears at the failing snippet with an actionable message and does not prevent the rest of the item or workspace from rendering. |
| LOOM-019 | Track dependencies for active snippets and transclusions. | Changes to an item read by ID or to a subscribed item-list/tag index refresh affected output; unrelated content changes do not rerun unrelated snippets. Output is derived rather than persisted. |
| LOOM-020 | Define a bounded lifecycle for snippet evaluation. | Editing an item's Markdown body invalidates its active snippets until Run is pressed again; card closure removes subscriptions; an evaluation error leaves the snippet recoverable. |

## Editing, experience, and integration

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| LOOM-021 | Reuse Foglio's actual structural editing operations for ClojureScript snippets, with necessary corrections and regression coverage. | Pairing, protected deletion, slurp, barf, splice, wrap, and indentation work on nested forms and respect strings, escapes, and line comments. |
| LOOM-022 | Keep snippet editing scoped to its source fence and preserve navigation context. | Applying or cancelling a snippet edit preserves surrounding Markdown, item ID, open cards, focus, and scroll position. |
| LOOM-023 | Present a narrow search sidebar, a spacious stacked-card workspace, and clear search, source, error, and editing states across desktop and narrow viewports. | The sidebar is limited to search, grouped results, and New Item; item boundaries, focus, active state, and errors remain legible without a dashboard or unrequested panels. |
| LOOM-024 | Support keyboard access and meaningful feedback. | Search, open, close, back, forward, Run, edit, save, import, and source navigation are keyboard operable with visible focus and programmatic labels/status. |
| LOOM-025 | Treat imported EDN and Markdown as data, and make the executable-code trust boundary clear. | EDN import cannot evaluate forms; Markdown and Hiccup results cannot inject active DOM; documentation and the Run control explain that executed SCI code has browser JavaScript interop and is trusted code. |
| LOOM-026 | Preserve existing Foglio and Timetable behavior when shared code is extracted. | Their full relevant test suites and standalone builds pass, including existing EDN and Paredit cases. |
| LOOM-027 | Keep technical documentation in English and synchronized with delivered behavior. | README launch, storage, execution, and authoring instructions match the implemented artifact; planned features are labelled as planned until delivered. |
| LOOM-028 | Keep Loom standalone within the existing SPA project without a new framework, folder requirement, widget language, or graph visualization. | Dependency and final-diff review show only justified additions; navigation remains item-based and no graph or mandatory folder UI appears. |

## Scope and change control

The initial release has no plugin loader, collaboration service, graph visualization, mandatory folders, HTML authoring mode, or automatic execution of imported code. A maintained Markdown parser is the only proposed new runtime package; its exact selection and lockfile change will be reviewed in the rendering feature. Browser-local storage is the automatic recovery format, while EDN files remain the portable interchange format. These boundaries do not relax the requirements above.

Each implementation feature must follow tests first, an observed expected failure, the smallest passing implementation, targeted and relevant regression runs, documentation and traceability updates, and approval before the next implementation step. No feature branch merges into `master` without approval.
