# Timetable domain and OFD support

## Application state

The timetable is independent from DOM and view state. Schema version 1 contains:

- `schemaVersion`, `name`, and `source` metadata;
- a `calendar` with minute-based day and period boundaries;
- `entities.teachers`, `rooms`, `classes`, `subjects`, and optional `students`; each roster uses stable IDs and students reference their class;
- `lessons` with source order, subject, teacher/class/room references, duration, slot assignment, source flags, and timeframes;
- subject `links` and raw-valued `parameters`.

Teacher and class constraints retain their observed minimum/maximum, weight, distribution, gap, free-day, and availability fields. Room metadata and availability, subject colors and weights, the top-level period/site/module catalogues, inter-subject links, and all parameter fields are represented. The importer preserves fields even when their hard/soft semantics are not established by the sample.

The source has no explicit lesson IDs. IDs such as `lesson:0` are generated from source order and are stable only for that unchanged document. Entity IDs use source names and are stable while those names remain unchanged. Unknown OFD structures and the decoded original XML are retained under `source`; the importer does not export OFD or claim byte-for-byte round trips.

Roster imports retain their source under `source.rosterImports`, including the original decoded OFD source or CSV text. OFD/CSV actions add only the selected roster; they do not replace lessons or other school data. The sample OFD contains no student roster, so students must currently come from CSV. Unknown CSV columns remain in each imported entity's `sourceData` and in the preserved source text.

Schema version 1 is the initial interchange contract. Incompatible model changes must increment the version; imports and exports reject unknown versions until an explicit migration is implemented. The current validator does not silently normalize unknown values.

## EDN interchange

The application codec supports maps with keyword keys, vectors, strings, keyword values, finite decimal numbers, booleans, `nil`, whitespace, commas, and line comments. It rejects lists, sets, symbols, tagged literals, character literals, ratios, duplicate keys, malformed forms, and trailing input. This is the documented timetable interchange subset, not a general EDN implementation. Schema validation runs after parsing and before use. The codec does not evaluate forms.

## Observed OFD boundary

The importer is based on `OR_30_SETT.ofd`, an XML document with version `5000`. It recognizes the observed entity, lesson, calendar, timeframe, link, and parameter elements. Slot strings such as `1.2` are interpreted as zero-based day and period indexes because that interpretation matches the sample's six-by-six grid; more OFD samples are needed before calling it a general format rule. Unsupported XML elements and attributes are warnings and remain in the preserved source. Other OFD versions are rejected pending evidence.

The supplied file declares `us-ascii` while containing non-ASCII comment bytes. Byte imports report this mismatch and decode those bytes as Windows-1252 (the same mapping as ISO-8859-1 for the bytes present). DTD declarations are rejected and external entities are never resolved. The original file is read-only; import preserves decoded source text, not original byte identity. No OFD export or complete-format compatibility is claimed.

`timetable/fixtures/conflict-demo.edn` and `unsupported-demo.ofd` are explicitly synthetic examples for testing conflicts, preferences, unassigned lessons, and unknown XML. They are not real school timetables or evidence of other OFD variants.

## Schedule analysis and views

The read-only analyzer checks simultaneous teacher, class, and room use across each lesson's duration, assigned timeframes marked unavailable, undesired starting slots, and unassigned lessons. These are direct checks only: constraints such as MIN/MAX, distribution, gaps, free days, links, LOCKED, FIXED, and broader preferences are preserved as source data but are not interpreted as hard or soft rules yet. Counts describe detected issue rows; one conflict spanning multiple periods can produce multiple rows.

The interface follows the local Chronos Stitch mockups: persistent left navigation, a compact school/status bar, cobalt actions, white work surfaces, and focused pages for teachers, classes and study plans, students, rooms, lesson requirements, constraints, calculation, and the timetable. It opens on teachers for a new school. School tabs remain directly clickable; calculation is reachable at any time, while its start button stays disabled until teachers, classes, subjects, valid lesson requirements, and at least one lesson are present. No external font, icon, or CSS service is loaded at runtime.

Teachers, classes, rooms, and students have contextual roster import actions. Teachers/classes/rooms accept OFD or CSV; students accept CSV, and an OFD selection reports that the observed sample does not provide student records. CSV headings accept Italian names such as `nome`, `classe`, `docente`, `aula`, `cognome`; student rows require a class that already exists. Imports are staged, validated, and explicitly applied. Existing entries are not overwritten; duplicate OFD names are counted, CSV duplicates and missing class references are reported. If an OFD timeframe falls outside the current project's calendar, it remains in `sourceData.ofdTimeframes` and the preserved OFD source, with a warning that it is not active. Original input and unrecognized CSV columns are preserved in EDN. The global **Importa / esporta EDN** action is reserved for the complete project and requires confirmation before replacing existing data.

Names are edited in place; a blank row adds entries, and Ctrl+Delete removes a selected lesson, constraint, or student. Student entries retain a stable ID and class reference. OFD fields not supported by the roster importer are retained in the source record; they are not interpreted by the solver.

On the supplied sample, direct analysis found 0 hard conflicts, 4 undesired-time warnings, and 6 unassigned lessons. One local run with Node 24.21.0 and jsdom measured 3,429 ms for import, 28 ms for analysis, and 69 ms for rendering. These measurements are local structural-test observations, not browser performance claims or targets.

## Safe editing and incremental search

The edit panel is attached to the selected lesson. It can place an unassigned lesson, suggest a direct move, or relocate a short chain of lessons. A proposal is only a preview until **Applica proposta** is activated. Coordinated changes that move multiple lessons require confirmation. Every apply checks that the complete timetable still matches the proposal's original signature, validates the schema, and rejects any hard conflict involving a moved lesson. It does not add new collisions; pre-existing issues on unrelated lessons are retained and called out in the preview. Undo restores the previous domain value exactly. Modified data remains in memory until EDN export.

The hard rules implemented by search are teacher, class, and room collisions across lesson durations plus unavailable timeframes on lessons and those resources. Other preserved OFD fields—including LOCKED/FIXED, MIN/MAX, distribution, gaps, free days, links, and broader preferences—are not interpreted by the solver yet.

Soft scoring is explicit and subordinate to hard feasibility: each undesired period occurrence costs 100 points, each missed desired period costs 25, and each changed source OFD placement costs 1 when source hints are enabled. Lower scores are better. The calculation page shows the best objective found, iteration count, live progress chart, time limit, objective threshold, and requested worker count. It shows a complete assignment only as a proposal, and never applies it during search. Web Workers run independent seeded searches when available; otherwise the interface reports a local fallback. The heuristic does not establish a global optimum.

Search is deterministic and bounded. The UI offers immediate search (one moved lesson), local repair (up to three total), and a longer chain (up to five total), with a 500-node search cap and at most 12 suggestions. The search yields to the browser event loop during exploration, can be cancelled, and keeps valid partial results. These are heuristic alternatives, not a proof of global optimality. A cancellation or rejected proposal never mutates the current timetable.

The **Vincoli** sheet lets staff add, edit, and delete unavailable (hard), undesirable (soft), and preferred (soft) periods on a lesson, teacher, class, or room. Edits take effect immediately, are included in EDN export, and the latest school-sheet edit can be undone. A new hard restriction can flag an existing placement; the conflict appears in the timetable and recalculation respects the restriction. Other OFD rules such as MIN/MAX, distribution, free days, and links remain preserved but are not editable or enforced by this prototype.

The calculation screen first finds a hard-valid complete assignment, then makes improving local moves while keeping every hard constraint satisfied. Iterations count feasibility-search attempts and candidate slot evaluations. The chart tracks best-so-far objective, so it never rises. The time limit, stop threshold, and worker count are configurable. A complete result remains a proposal until explicitly reviewed and applied; cancelling or reaching the time limit preserves the current timetable. The algorithm is heuristic, bounded by the selected time, and makes no global-optimum claim.

One Node 24.21.0/jsdom run on the supplied 877,947-byte sample (1,714 lessons) imported in 3,168 ms, then found one hard-valid immediate alternative for `lesson:8` in 108 ms after 22 search visits (`maxMoves: 1`, `maxResults: 1`, `maxNodes: 60`). Conditions are local structural tests, not browser performance claims or targets.

## Current import workflow

For development, run `npm run dev` from the repository root and open the printed timetable URL, `http://localhost:8080/timetable/`. The static server redirects `/timetable` to `/timetable/`, serves CSS with the correct MIME type, and serves the development favicon. For a standalone file, run `npm run build:timetable` and open `dist/timetable.html`; its markup, CSS, JavaScript, and SVG favicon are embedded, with no runtime network or backend requirement.

To start from zero, edit the school sheets directly. Add teachers, classes, subjects, optional rooms, students, and lesson requirements using each grid's blank row; the default calendar is Monday–Friday with six 60-minute periods. Repeated weekly lessons are separate rows. Navigate directly to **Calcolo & Motore** at any time; its start button activates only when required data is valid. Review and confirm the proposal before applying it. The secondary **Importa / esporta EDN** action handles whole-project EDN files only.

The **Avvisi e conflitti** button shows the number of unresolved schedule and import issues. Open it to filter by severity, category, or search text; lesson links return to the timetable and select the affected lesson. The issue list is not shown on the timetable workspace by default.

Import the relevant roster from its own sheet; use whole-project EDN import/export from the secondary action. Select a lesson, choose a local search breadth, compare an alternative, and explicitly apply it. **Annulla ultima modifica** restores the prior schedule or school edit. Run all automated tests with `npm test`; timetable tests use `npm run test:timetable`. See [USABILITY.md](USABILITY.md) for the repeatable staff checklist and the limits of the current evaluation.
