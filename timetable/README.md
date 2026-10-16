# Timetable domain and OFD support

## Application state

The timetable is independent from DOM and view state. Schema version 1 contains:

- `schemaVersion`, `name`, and `source` metadata;
- a `calendar` with minute-based day and period boundaries;
- `entities.teachers`, `rooms`, `classes`, and `subjects`, with stable type-prefixed IDs derived from unique source names;
- `lessons` with source order, subject, teacher/class/room references, duration, slot assignment, source flags, and timeframes;
- subject `links` and raw-valued `parameters`.

Teacher and class constraints retain their observed minimum/maximum, weight, distribution, gap, free-day, and availability fields. Room metadata and availability, subject colors and weights, the top-level period/site/module catalogues, inter-subject links, and all parameter fields are represented. The importer preserves fields even when their hard/soft semantics are not established by the sample.

The source has no explicit lesson IDs. IDs such as `lesson:0` are generated from source order and are stable only for that unchanged document. Entity IDs use source names and are stable while those names remain unchanged. Unknown OFD structures and the decoded original XML are retained under `source`; the importer does not export OFD or claim byte-for-byte round trips.

Schema version 1 is the initial interchange contract. Incompatible model changes must increment the version; imports and exports reject unknown versions until an explicit migration is implemented. The current validator does not silently normalize unknown values.

## EDN interchange

The application codec supports maps with keyword keys, vectors, strings, keyword values, finite decimal numbers, booleans, `nil`, whitespace, commas, and line comments. It rejects lists, sets, symbols, tagged literals, character literals, ratios, duplicate keys, malformed forms, and trailing input. This is the documented timetable interchange subset, not a general EDN implementation. Schema validation runs after parsing and before use. The codec does not evaluate forms.

## Observed OFD boundary

The importer is based on `OR_30_SETT.ofd`, an XML document with version `5000`. It recognizes the observed entity, lesson, calendar, timeframe, link, and parameter elements. Slot strings such as `1.2` are interpreted as zero-based day and period indexes because that interpretation matches the sample's six-by-six grid; more OFD samples are needed before calling it a general format rule. Unsupported XML elements and attributes are warnings and remain in the preserved source. Other OFD versions are rejected pending evidence.

The supplied file declares `us-ascii` while containing non-ASCII comment bytes. Byte imports report this mismatch and decode those bytes as Windows-1252 (the same mapping as ISO-8859-1 for the bytes present). DTD declarations are rejected and external entities are never resolved. The original file is read-only; import preserves decoded source text, not original byte identity. No OFD export or complete-format compatibility is claimed.

## Schedule analysis and views

The read-only analyzer checks simultaneous teacher, class, and room use across each lesson's duration, assigned timeframes marked unavailable, undesired starting slots, and unassigned lessons. These are direct checks only: constraints such as MIN/MAX, distribution, gaps, free days, links, LOCKED, FIXED, and broader preferences are preserved as source data but are not interpreted as hard or soft rules yet. Counts describe detected issue rows; one conflict spanning multiple periods can produce multiple rows.

The timetable is the primary workspace after loading. Users can view schedules by class, teacher, or room, select lessons for details, and follow issue links to affected lessons. Switching views retains the selected lesson when that lesson has a corresponding entity. Unassigned lessons remain reachable from diagnostics and are shown in their details rather than placed into a fabricated time slot. Import warnings remain visible.

On the supplied sample, direct analysis found 0 hard conflicts, 4 undesired-time warnings, and 6 unassigned lessons. One local run with Node 24.21.0 and jsdom measured 3,429 ms for import, 28 ms for analysis, and 69 ms for rendering. These measurements are local structural-test observations, not browser performance claims or targets.

## Safe editing and incremental search

The edit panel is attached to the selected lesson. It can place an unassigned lesson, suggest a direct move, or relocate a short chain of lessons. A proposal is only a preview until **Applica proposta** is activated. Coordinated changes that move multiple lessons require confirmation. Every apply checks that the complete timetable still matches the proposal's original signature, validates the schema, and rejects any hard conflict involving a moved lesson. It does not add new collisions; pre-existing issues on unrelated lessons are retained and called out in the preview. Undo restores the previous domain value exactly. Modified data remains in memory until EDN export.

The hard rules implemented by search are teacher, class, and room collisions across lesson durations plus unavailable timeframes on lessons and those resources. Other preserved OFD fields—including LOCKED/FIXED, MIN/MAX, distribution, gaps, free days, links, and desired slots—are not treated as hard rules yet. `desired` preferences are preserved but not scored.

Soft scoring is explicit and subordinate to hard feasibility: each undesired period occurrence contributes 100 points for the lesson and each distinct assigned teacher, class, or room; each moved lesson contributes 1 point. Lower scores rank first, then fewer moved lessons, then calendar order. The panel explains which lessons change and whether undesired preferences improve or deteriorate; the score itself is not shown as the only rationale.

Search is deterministic and bounded. The UI offers immediate search (one moved lesson), local repair (up to three total), and a longer chain (up to five total), with a 500-node search cap and at most 12 suggestions. The search yields to the browser event loop during exploration, can be cancelled, and keeps valid partial results. These are heuristic alternatives, not a proof of global optimality. A cancellation or rejected proposal never mutates the current timetable.

One Node 24.21.0/jsdom run on the supplied 877,947-byte sample (1,714 lessons) imported in 3,168 ms, then found one hard-valid immediate alternative for `lesson:8` in 108 ms after 22 search visits (`maxMoves: 1`, `maxResults: 1`, `maxNodes: 60`). Conditions are local structural tests, not browser performance claims or targets.

## Current import workflow

Run `npm run dev` from the repository root and open `http://localhost:8080/timetable/`. Choose an `.ofd` or `.edn` file, review counts and warnings, then explicitly load it. Select a lesson, choose a search breadth, compare a proposal, and explicitly apply it. **Annulla ultima modifica** restores the prior schedule. Export the current timetable with **Esporta EDN**. This is a development source screen served locally; the single-file standalone build is planned for Step 4. The application uses no backend or runtime network services. Run all tests with `npm test`; timetable-only tests use `npm run test:timetable`.
