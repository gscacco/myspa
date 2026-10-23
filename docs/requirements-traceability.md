# Loom requirements traceability and test design

**Status:** Approved test design; foundation in progress. Unimplemented test cases remain planned. The stable requirement statements are in [requirements.md](requirements.md). The expected behavior is detailed in [loom-design.md](loom-design.md).

The test titles below are acceptance assertions, not implementation descriptions. In Phase C, each approved feature starts by adding its named tests and observing the expected failure before changing implementation. Update this table with actual test paths and results as features land. Do not weaken a requirement to match an implementation.

| Requirement | Planned acceptance test ID, path, and assertion |
| --- | --- |
| LOOM-001 | `LT-001` — `tests/loom/standalone.test.js`: build `dist/loom.html`, boot it with a `file://` JSDOM URL, find inline assets and Scittle, and find no required external runtime URL. `LT-001R` — existing `tests/e2e/dist.test.js` and `tests/timetable/standalone.test.js` still pass. |
| LOOM-002 | `LT-002` — `tests/loom/model.test.js`: create, rename, reorder, and delete items; assert immutable UUID identity, unique IDs, duplicate-title support, and timestamp updates. |
| LOOM-003 | `LT-003` — `tests/loom/model.test.js` (implemented): round-trip the versioned schema and keywords; reject malformed/trailing EDN, unsupported versions, unknown fields, duplicate IDs, and invalid workspace references. `LT-003I` — `tests/loom/persistence.test.js` (planned): failed/cancelled import leaves current edits intact and export/import restores saved items and workspace. |
| LOOM-004 | `LT-004` — `tests/loom/workspace.test.js` and `tests/loom/navigation.test.js`: open and focus three cards, follow a link, then close one; assert the other cards, source scroll position, and edit draft remain. Further scroll and keyboard coverage is planned. |
| LOOM-005 | `LT-005` — `tests/loom/navigation.test.js` and `tests/loom/rendering.test.js` (partially implemented): Markdown and direct Hiccup `loom:` links open the ID target; missing Markdown targets show local diagnostics. SCI-generated links remain planned. |
| LOOM-006 | `LT-006` — `tests/loom/workspace.test.js` (partially implemented): title, tag, and body queries open results without clearing cards; no-result state works. Keyboard and empty-query behavior need further coverage. |
| LOOM-007 | `LT-007` — `tests/loom/workspace.test.js` (partially implemented): back/forward restore open cards after navigation; deleted-ID and EDN-import cases remain planned. |
| LOOM-008 | `LT-008` — `tests/loom/rendering.test.js` and `tests/loom/navigation.test.js` (partially implemented): whole-item embed keeps source ID and source action; editing the source refreshes the embed without changing parent Markdown. Unrelated-embed selectivity needs a test. |
| LOOM-009 | `LT-009` — `tests/loom/rendering.test.js`: resolve heading slugs and duplicates, stop at the next peer heading, render nested embeds, and bound missing sections, cycles, and depth overflow locally. |
| LOOM-010 | `LT-010` — `tests/loom/navigation.test.js`: Edit source opens the source card at the section; editing parent text does not alter source text. |
| LOOM-011 | `LT-011` — `tests/loom/rendering.test.js` (partially implemented): render common Markdown tokens; raw HTML stays inert and ordinary code fences stay code. Additional token and unsupported-image coverage is planned. |
| LOOM-012 | `LT-012` — `tests/loom/rendering.test.js` (partially implemented): only exact `cljs loom` fences get Run controls at their positions; ordinary `cljs` fences remain inert. Execution remains planned. |
| LOOM-013 | `LT-013` — `tests/loom/snippet-trust.test.js`: import, open, search, preview, and transclude a side-effecting snippet without running it; Run executes only that source version, and a new session starts inert. |
| LOOM-014 | `LT-014` — `tests/loom/loom-api.test.js`: compose `items` tag queries, `item` reads, `link` results, and `data` wrappers in ordinary SCI forms; verify documented return types and IDs. |
| LOOM-015 | `LT-015` — `tests/loom/rendering.test.js` (partially implemented): distinguish strings, maps, Hiccup nodes, and generated links in the direct renderer. SCI result coverage remains planned. |
| LOOM-016 | `LT-016` — `tests/loom/rendering.test.js` (partially implemented): nested Hiccup elements and safe attributes render; exhaustive element and malformed-value coverage remains planned. |
| LOOM-017 | `LT-017` — `tests/loom/rendering.test.js` (partially implemented): reject active tags, event attributes, and unsafe URLs; arbitrary strings stay text nodes. Additional hostile-value coverage remains planned. |
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

Targeted test commands are `node --import ./tools/load-scittle.js --test tests/loom/<feature>.test.js` where SCI is needed, and `node --test tests/loom/<feature>.test.js` otherwise. The full gate is `npm run check`; separate artifact gates are `npm run build:timetable`, `npm run test:e2e:timetable`, and `npm run build:loom`. `npm run test:loom` runs implemented Loom tests. `npm run test:timetable` includes synthetic OFD cases but excludes the ten tests requiring the external `OR_30_SETT.ofd` fixture. Run those explicitly with `npm run test:integration:ofd` when the fixture is present. Further feature tests and manual gates remain planned.

Before each implementation commit or merge, inspect `git status`, review the relevant diff, and record the actual targeted and full-gate results.

## Foundation evidence and remaining work

`LT-001`, part of `LT-002`, and the data validation portion of `LT-003` have been implemented. `node --test tests/loom/model.test.js` passed 6/6, and `node --test tests/loom/standalone.test.js` passed 1/1 after both first failed because their implementation modules were absent. The rest of each requirement and all other Loom cases remain planned.

The first `npm run check` attempt reached Timetable and failed only the ten tests needing the absent, untracked `OR_30_SETT.ofd` fixture; the other 139 Timetable tests passed. After moving those ten tests into the explicit `npm run test:integration:ofd` selection, `npm run check` passed: Foglio unit 142/142, Foglio integration 56/56, Timetable 139/139, Loom 7/7, Foglio artifact checks 18/18, and Foglio built-artifact tests 6/6. `npm run test:e2e:timetable` passed 1/1. `npm run build:timetable` and `npm run build:loom` passed independently. The external OFD integration command was not run because its fixture is absent.

Workspace tests were added before `loom/js/app.js` and initially failed with `ERR_MODULE_NOT_FOUND`. After implementation, `node --test tests/loom/workspace.test.js` passed 3/3 and `npm run test:loom` passed 10/10. The final `npm run check` passed after the card-order refactor: Foglio unit 142/142, Foglio integration 56/56, Timetable 139/139, Loom 10/10, Foglio artifact checks 18/18, and Foglio built-artifact tests 6/6.

Rendering tests were added before `loom/js/render.js` and initially failed with `ERR_MODULE_NOT_FOUND`; the integration navigation test then failed because the card had no link. The duplicate-heading and Edit source cases also failed for the expected missing behavior before correction. `node --test tests/loom/rendering.test.js` passed 8/8, `node --test tests/loom/navigation.test.js` passed 2/2, and `npm run test:loom` passed 20/20. `npm run check` passed: Foglio unit 142/142, Foglio integration 56/56, Timetable 139/139, Loom 20/20, Foglio artifact checks 18/18, and Foglio built-artifact tests 6/6. `npm audit --omit=dev --json` reported no runtime dependency vulnerabilities; the full audit reported one moderate finding in the existing development dependency `esbuild`.
