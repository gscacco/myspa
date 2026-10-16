# Timetable usability checklist

This checklist supports a short review with a timetable coordinator. It is not a substitute for observing school staff using their own timetable.

## Setup

For the source app, run `npm run dev` and open `http://localhost:8080/timetable/`. To check the packaged app, run `npm run build:timetable` and open `dist/timetable.html` directly. Use `OR_30_SETT.ofd` for the real timetable, `timetable/fixtures/conflict-demo.edn` for the explicitly synthetic conflict scenario, and `timetable/fixtures/unsupported-demo.ofd` for an OFD with one preserved unknown element. The supplied OFD contains no direct conflicts, so the synthetic file is needed for conflict and chain exercises.

## Repeatable staff walkthrough

1. [ ] Load `OR_30_SETT.ofd`. Confirm the report shows 1,714 lessons, six unassigned lessons, and the encoding warning before loading. Confirm the loaded status and timetable become visible.
2. [ ] Choose a class, teacher, or room. Find one lesson and inspect its subject, participants, room, time, and duration.
3. [ ] Load `conflict-demo.edn`. Select `Matematica` for `Classe 1`; inspect the teacher collision and verify the issue names the teacher and both affected lessons.
4. [ ] Select `lesson:demo-1`, compare immediate and chain search results, and describe which lessons move and whether undesired-time preferences change.
5. [ ] Apply a one-lesson proposal. Verify the new time in class and teacher views, and confirm the active view stays selected after apply.
6. [ ] Undo. Verify the old time returns in both views and the unsaved status updates.
7. [ ] On the full sample, start a longer search and cancel while progress is shown. Confirm the current timetable remains unchanged and any partial proposals remain unapplied.
8. [ ] With a timetable loaded, stage `unsupported-demo.ofd`. Confirm the `FUTURE_RULE` warning is actionable, cancel the staged import, and verify the loaded timetable remains available. Repeat with malformed XML to see the fatal error path.

## Added assignment and constraint workflow

1. [ ] Import `OR_30_SETT.ofd` with “senza gli orari assegnati”. Confirm 1,714 lessons show as unassigned while teachers, classes, constraints, and original source data remain available.
2. [ ] Run “Ricalcola tutte le assegnazioni”. Review progress and the full-schedule proposal, cancel once to verify preservation, then run again and explicitly apply. Verify class and teacher views and test undo.
3. [ ] Add an unavailable period to a teacher, edit it to another period, delete it, and undo. Confirm any resulting conflict is visible and the recalculation respects the updated rule.
4. [ ] Disable the original-time preference and observe whether the search finds a solution within its documented attempt cap; do not present a limit result as a valid timetable.

## Start-from-zero and issue triage

1. [ ] Choose “Crea orario da zero”; enter school calendar, teachers, classes, subjects, optional rooms, and lesson requirements. Confirm no assignments or sample data are invented.
2. [ ] Create the timetable, confirm it opens in the main workspace, then use “Avvia calcolo automatico”. Review the proposed full assignment and explicitly apply or cancel it.
3. [ ] Confirm the workspace shows only the issue-count button, open it, filter by severity/category/search, and follow a lesson link back to the selected lesson.

After each session, record the staff role, browser, task completion, points of hesitation, and any data-safety concern. Do not mark a scenario successful solely because the corresponding automated test passes.

## Automated evidence in this prototype

The repository tests simulate the original eight workflows and the added import-without-placements, full-recalculation proposal/confirmation/cancellation, constraint add/edit/delete/undo, and real-sample import flows with jsdom. They cover a synthetic conflict cause, alternative comparison and bounded chain repair, apply across class/teacher views, exact undo, and failed/unsupported imports preserving current data. The standalone test opens the generated file with a `file://` URL and imports the real supplied OFD.

Current automated result: **all scenarios covered by automated tests pass**. A walkthrough with school staff has **not yet been conducted**, so human usability remains unvalidated. The sample has zero direct hard conflicts; conflict repair is assessed with the synthetic demo, not invented sample data.
