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

## Performance baseline

One local import of the supplied 877,947-byte file took 3,035 ms with Node 24.21.0 and jsdom's `DOMParser`, producing 1,714 lessons. This is a structural-test baseline, not a browser performance claim. Record browser measurements before setting or reporting a user-facing load target.

## Current import workflow

Run `npm run dev` from the repository root and open `http://localhost:8080/timetable/`. Choose an `.ofd` or `.edn` file, review counts and warnings, then explicitly load it. Export the current timetable with **Esporta EDN**. This is a development source screen served locally; the single-file standalone build is planned for Step 4. Class, teacher, room views, editing, and optimization are planned for later steps. The application uses no backend or runtime network services.
