import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOFD, withoutOFDAssignments } from '../../timetable/js/ofd-importer.js';
import { optimizeTimetable } from '../../timetable/js/optimization.js';
import { analyzeSchedule } from '../../timetable/js/schedule.js';
import { optimizationScope } from '../../timetable/js/optimization-scope.js';
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
const { timetable: optimizationTimetable, excludedLessons } = optimizationScope(timetable);

const startedAt = performance.now();
let firstFeasibleMs = null;
let bestObjective = null;
let initialObjective = null;
let progressEvents = 0;
let maxFeasibilityDepth = 0;
let feasibilityAttempts = 0;
let geneticGenerations = 0;
let geneticPopulation = 0;
let geneticMutationRate = null;
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
    if (progress.phase === 'genetic') {
      geneticGenerations = Math.max(geneticGenerations, Number(progress.generation) || 0);
      geneticPopulation = Math.max(geneticPopulation, Number(progress.population) || 0);
      if (Number.isFinite(progress.mutationRate)) geneticMutationRate = progress.mutationRate;
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
if (result.assignments instanceof Map && result.assignments.size === optimizationTimetable.lessons.length) {
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) if (result.assignments.has(lesson.id)) lesson.assignedTime = result.assignments.get(lesson.id);
  hardErrors = analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length;
  assert.equal(hardErrors, 0, 'optimizer returned a hard-invalid assignment');
}
let partialHardErrors = null;
if (result.diagnosticPartial) {
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) {
    if (result.diagnosticPartial.assignments.has(lesson.id)) {
      lesson.assignedTime = result.diagnosticPartial.assignments.get(lesson.id);
    }
  }
  partialHardErrors = analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length;
  assert.equal(partialHardErrors, 0, 'diagnostic partial assignments must remain hard-valid');
}

const report = {
  project: basename(projectPath),
  algorithm,
  seed,
  lessons: timetable.lessons.length,
  optimizedLessons: optimizationTimetable.lessons.length,
  excludedUnknownClassLessons: excludedLessons.length,
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
  geneticGenerations: result.generations ?? geneticGenerations,
  geneticPopulation: result.populationCount ?? geneticPopulation,
  geneticPopulationSize: result.populationSize ?? (algorithm === 'genetic' ? 8 : null),
  geneticMutationRate,
  diagnosticPartial: result.diagnosticPartial ? {
    assignedCount: result.diagnosticPartial.assignedCount,
    unassignedCount: result.diagnosticPartial.unassignedCount,
    zeroDomainCount: result.diagnosticPartial.zeroDomainCount,
    remainingDomainHistogram: result.diagnosticPartial.remainingDomainHistogram,
    smallestRemainingDomains: result.diagnosticPartial.smallestRemainingDomains,
    partialHardErrors,
  } : null,
  failureCauses: result.failureCauses || [],
  hardErrors,
  progressEvents,
};
console.log(`TIMETABLE_OPTIMIZATION_PERF ${JSON.stringify(report)}`);
if (process.env.TIMETABLE_PERF_OUTPUT && result.diagnosticPartial) {
  await writeFile(process.env.TIMETABLE_PERF_OUTPUT, JSON.stringify({
    ...report,
    partialAssignments: Object.fromEntries(result.diagnosticPartial.assignments),
    partialRestart: result.diagnosticPartial.restart,
  }, null, 2));
}
assert.ok(['solved', 'time-limit', 'cancelled', 'unsatisfiable', 'limit'].includes(result.status));
