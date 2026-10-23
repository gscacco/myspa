# Loom requirements traceability and test design

**Status:** Approved test design. Every `LT-*` automated test and `LM-*` manual/review check below is planned; none is claimed to exist or pass. The stable requirement statements are in [requirements.md](requirements.md). The expected behavior is detailed in [loom-design.md](loom-design.md).

The test titles below are acceptance assertions, not implementation descriptions. In Phase C, each approved feature starts by adding its named tests and observing the expected failure before changing implementation. Update this table with actual test paths and results as features land. Do not weaken a requirement to match an implementation.

| Requirement | Planned acceptance test ID, path, and assertion |
| --- | --- |
| LOOM-001 | `LT-001` — `tests/loom/standalone.test.js`: build `dist/loom.html`, boot it with a `file://` JSDOM URL, find inline assets and Scittle, and find no required external runtime URL. `LT-001R` — existing `tests/e2e/dist.test.js` and `tests/timetable/standalone.test.js` still pass. |
| LOOM-002 | `LT-002` — `tests/loom/model.test.js`: create, rename, reorder, and delete items; assert immutable UUID identity, unique IDs, duplicate-title support, and timestamp updates. |
| LOOM-003 | `LT-003` — `tests/loom/edn.test.js`: round-trip the versioned schema and keywords; reject malformed/trailing EDN, unsupported versions, unknown fields, duplicate IDs, and invalid workspace references. `LT-003I` — `tests/loom/persistence.test.js`: failed/cancelled import leaves current edits intact and export/import restores saved items and workspace. |
| LOOM-004 | `LT-004` — `tests/loom/workspace.test.js`: open and focus three cards, follow a link, then close one; assert the other cards, source scroll position, and edit draft remain. |
| LOOM-005 | `LT-005` — `tests/loom/navigation.test.js`: Markdown and Hiccup `loom:` links open the ID target despite duplicate or changed titles; missing targets show local diagnostics. |
| LOOM-006 | `LT-006` — `tests/loom/search.test.js`: title, tag, and body queries return the right items; opening a result retains cards; empty/no-result states and keyboard activation work. |
| LOOM-007 | `LT-007` — `tests/loom/history.test.js`: back/forward restore card order and focus after open/close/focus transitions, skip deleted IDs, and EDN import restores saved open-card order. |
| LOOM-008 | `LT-008` — `tests/loom/transclusion.test.js`: whole-item embed keeps source ID and source action; editing the source refreshes the embed without changing parent Markdown or unrelated embeds. |
| LOOM-009 | `LT-009` — `tests/loom/transclusion.test.js`: resolve heading slugs and duplicates, stop at the next peer heading, render nested embeds, and bound missing sections, cycles, and depth overflow locally. |
| LOOM-010 | `LT-010` — `tests/loom/transclusion-edit.test.js`: Edit source opens the source card at the section; editing parent text does not alter source text. |
| LOOM-011 | `LT-011` — `tests/loom/markdown-renderer.test.js`: render the documented Markdown token set; raw HTML stays inert, ordinary code fences stay code, and unsupported images do not fetch content. |
| LOOM-012 | `LT-012` — `tests/loom/snippet-syntax.test.js`: only exact `cljs loom` fences become runnable snippets and insert result slots at their source positions; ordinary `cljs` fences and inline code remain inert examples. |
| LOOM-013 | `LT-013` — `tests/loom/snippet-trust.test.js`: import, open, search, preview, and transclude a side-effecting snippet without running it; Run executes only that source version, and a new session starts inert. |
| LOOM-014 | `LT-014` — `tests/loom/loom-api.test.js`: compose `items` tag queries, `item` reads, `link` results, and `data` wrappers in ordinary SCI forms; verify documented return types and IDs. |
| LOOM-015 | `LT-015` — `tests/loom/result-renderer.test.js`: distinguish text, scalars, keywords, maps, data vectors, Hiccup nodes, and collections; generated item links open cards. |
| LOOM-016 | `LT-016` — `tests/loom/hiccup-renderer.test.js`: render each supported element family, allowed attributes, nested children, and fragments; malformed or unknown structures show a local error. |
| LOOM-017 | `LT-017` — `tests/loom/render-security.test.js`: reject script/iframe/style elements, `on*` and unsafe attributes, DOM/function values, reserved data attributes, and `javascript:`/`data:` links; arbitrary strings stay text nodes. |
| LOOM-018 | `LT-018` — `tests/loom/snippet-errors.test.js`: syntax, SCI evaluation, and result-rendering failures show safe messages at the failing fence while adjacent content and other cards continue to render. |
| LOOM-019 | `LT-019` — `tests/loom/dependencies.test.js`: item-ID reads and tag-index subscriptions rerun only affected active snippets; unrelated body edits cause no query rerun; nested transclusions update transitively; generated output is absent from EDN export. |
| LOOM-020 | `LT-020` — `tests/loom/snippet-lifecycle.test.js`: containing Markdown edit clears old output and subscriptions, Run reactivates the new version, closing a card disposes subscriptions, and an error remains retryable. |
| LOOM-021 | `LT-021` — `tests/loom/paredit.test.js`: nested delimiter types, strings with escapes, comments, partial forms, pairing, deletion, slurp, barf, splice, wrap, and indentation. `LT-021R` — existing `tests/unit/paredit.test.js` and Paredit cases in `tests/integration/app.test.js` remain passing. |
| LOOM-022 | `LT-022` — `tests/loom/snippet-editor.test.js`: edit/apply/cancel within one fence; assert surrounding Markdown bytes, item ID, open cards, focus, scroll, and concurrent-edit warning. |
| LOOM-023 | `LT-023` — `tests/loom/workspace.test.js`: selected, editing, error, search, and empty card states have labelled DOM landmarks and state classes. `LM-001` — `docs/loom-manual-checks.md`: inspect readability and overflow at narrow and desktop widths. |
| LOOM-024 | `LT-024` — `tests/loom/keyboard.test.js`: use keyboard events for every named action; verify focus restoration, labels, and status announcements. `LM-002` — manual keyboard and screen-reader walkthrough. |
| LOOM-025 | `LT-025` — `tests/loom/import-security.test.js`: EDN forms and hostile Markdown import as inert data, unsafe markup/URLs stay inert, and no code runs until Run. `LM-003` — review Run and README trust wording against the actual SCI interop capability. |
| LOOM-026 | `LT-026` — existing `tests/unit/*.test.js`, `tests/integration/*.test.js`, `tests/e2e/*.test.js`, and `tests/timetable/*.test.js`: full regression and both existing standalone builds pass after shared extraction. |
| LOOM-027 | `LM-004` — documentation review of `README.md`, `docs/requirements.md`, `docs/loom-design.md`, and current tests: English text and instructions describe only delivered behavior and record actual commands/results. |
| LOOM-028 | `LT-028` — `tests/loom/standalone.test.js`: mounted app exposes item workspace, no mandatory folder/graph/dashboard UI, and no external framework runtime. `LM-005` — final dependency and Git diff review checks every added package and file against the approved scope. |

## Security and regression emphasis

- `LT-003`, `LT-017`, and `LT-025` are import and DOM-injection gates. Include hostile strings containing closing tags, unsafe schemes, event attributes, unsupported EDN forms, and malformed Hiccup.
- `LT-013`, `LT-018`, `LT-019`, and `LT-020` cover the code trust and reevaluation boundary, including observed evaluation counts and local error recovery.
- `LT-021R` and `LT-026` protect Foglio and Timetable when shared modules move. Keep their existing tests at their current import paths.
- `LT-001` tests the built artifact, not merely source modules. `LM-001` and `LM-002` are needed because JSDOM cannot establish real layout or assistive-technology usability.

## Planned execution gates

Targeted test commands will be `node --import ./tools/load-scittle.js --test tests/loom/<feature>.test.js` where SCI is needed, and `node --test tests/loom/<feature>.test.js` otherwise. The repository's existing full gate is `npm run check`; Timetable's separate artifact gates are `npm run build:timetable` and `npm run test:e2e:timetable`. Loom will gain `npm run build:loom` and a named Loom test script only when their implementation exists. These are planned commands, not Phase B results.

Before each implementation commit or merge, inspect `git status`, review the relevant diff, and record the actual targeted and full-gate results. No Loom test listed here has been run because no Loom test has yet been written.
