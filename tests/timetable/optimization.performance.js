import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOFD, withoutOFDAssignments } from '../../timetable/js/ofd-importer.js';
import { optimizeTimetable } from '../../timetable/js/optimization.js';
import { analyzeSchedule } from '../../timetable/js/schedule.js';
import { domParser } from './helpers.js';

const defaultProject = fileURLToPath(new URL('../../Orario definitivo_26-27.ofd', import.meta.url));
const projectPath = process.env.TIMETABLE_PERF_OFD || process.argv[2] || defaultProject;
const timeLimitMs = Math.max(1_000, (Number(process.env.TIMETABLE_OPTIMIZATION_SECONDS) || 15) * 1_000);
const seed = Number(process.env.TIMETABLE_PERF_SEED) || 1;
const algorithm = process.env.TIMETABLE_OPTIMIZATION_ALGORITHM || 'local';

await access(projectPath);
const imported = importOFD(await readFile(projectPath), { DOMParser: domParser });
const { timetable } = withoutOFDAssignments(imported);
assert.ok(timetable.lessons.length >= 1_000, 'benchmark needs a school-sized timetable');
assert.ok(timetable.lessons.every(lesson => lesson.assignedTime == null), 'source placements must not seed the calculation');

const startedAt = performance.now();
let firstFeasibleMs = null;
let bestObjective = null;
let initialObjective = null;
let progressEvents = 0;
let maxFeasibilityDepth = 0;
let feasibilityAttempts = 0;
const result = await optimizeTimetable(timetable, {
  workers: 1,
  timeLimitMs,
  seed,
  algorithm,
  geneticStartAfterMs: Math.min(10_000, Math.max(1, timeLimitMs - 1)),
  onProgress: progress => {
    progressEvents++;
    if (progress.phase === 'feasibility') {
      maxFeasibilityDepth = Math.max(maxFeasibilityDepth, Number(progress.maxAssigned ?? progress.assigned) || 0);
      feasibilityAttempts = Math.max(feasibilityAttempts, Number(progress.attempt) || 0);
    }
    if (Number.isFinite(progress.initialObjective)) initialObjective ??= progress.initialObjective;
    if (Number.isFinite(progress.bestObjective)) bestObjective = progress.bestObjective;
    if (firstFeasibleMs == null && progress.phase === 'feasibility'
      && Number(progress.maxAssigned ?? progress.assigned) >= Number(progress.total)) {
      firstFeasibleMs = Math.round(performance.now() - startedAt);
    }
  },
});
const elapsedMs = Math.round(performance.now() - startedAt);
let hardErrors = null;
if (result.assignments instanceof Map && result.assignments.size === timetable.lessons.length) {
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) lesson.assignedTime = result.assignments.get(lesson.id);
  hardErrors = analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length;
  assert.equal(hardErrors, 0, 'optimizer returned a hard-invalid assignment');
}

const report = {
  project: basename(projectPath),
  algorithm,
  seed,
  lessons: timetable.lessons.length,
  status: result.status,
  elapsedMs,
  firstFeasibleMs,
  optimizationMs: firstFeasibleMs == null ? null : Math.max(0, elapsedMs - firstFeasibleMs),
  iterations: result.iterations,
  initialObjective: result.initialObjective ?? initialObjective,
  objective: result.objective ?? bestObjective,
  objectiveBreakdown: result.objectiveBreakdown,
  maxFeasibilityDepth,
  feasibilityAttempts,
  hardErrors,
  progressEvents,
};
console.log(`TIMETABLE_OPTIMIZATION_PERF ${JSON.stringify(report)}`);
assert.ok(['solved', 'time-limit', 'cancelled', 'unsatisfiable', 'limit'].includes(result.status));
