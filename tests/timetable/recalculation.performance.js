import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recalculateAssignments } from '../../timetable/js/recalculator.js';
import { objectiveBreakdown } from '../../timetable/js/optimization-core.js';
import { analyzeSchedule } from '../../timetable/js/schedule.js';
import { importOFD, withoutOFDAssignments } from '../../timetable/js/ofd-importer.js';
import { domParser } from './helpers.js';

const defaultProject = fileURLToPath(new URL('../../Orario definitivo_26-27.ofd', import.meta.url));
const projectPath = process.env.TIMETABLE_PERF_OFD || process.argv[2] || defaultProject;
const durationSeconds = Math.max(1, Number(process.env.TIMETABLE_PERF_SECONDS) || 15);
const randomizeOrder = process.env.TIMETABLE_PERF_RANDOMIZE !== '0';
const randomizeVariables = process.env.TIMETABLE_PERF_RANDOM_VARIABLES !== '0';
const variableOrdering = process.env.TIMETABLE_PERF_VARIABLE_ORDERING || 'degree';
const restartAfterNodes = Math.max(1, Number(process.env.TIMETABLE_PERF_RESTART_NODES) || 50_000);
const maxNodes = Number(process.env.TIMETABLE_PERF_MAX_NODES) || Number.MAX_SAFE_INTEGER;
const seeds = (process.env.TIMETABLE_PERF_SEEDS || process.env.TIMETABLE_PERF_SEED || '1')
  .split(',').map(value => Number(value.trim())).filter(Number.isInteger);
const candidateOrderings = (process.env.TIMETABLE_PERF_ORDERINGS || 'random')
  .split(',').map(value => value.trim()).filter(value => ['random', 'lcv', 'pressure'].includes(value));

await access(projectPath);
const imported = importOFD(await readFile(projectPath), { DOMParser: domParser });
const { timetable } = withoutOFDAssignments(imported);
assert.ok(timetable.lessons.length >= 1_000, 'benchmark needs a school-sized timetable');
assert.ok(timetable.lessons.every(lesson => lesson.assignedTime == null), 'source placements must not seed the calculation');

assert.ok(seeds.length && candidateOrderings.length, 'benchmark needs at least one seed and candidate ordering');
const benchmarkResults = [];
for (const candidateOrdering of candidateOrderings) for (const seed of seeds) {
  const controller = new AbortController();
  const startedAt = performance.now();
  const samples = [];
  const timer = setTimeout(() => controller.abort(), durationSeconds * 1000);
  let result;
  try {
    result = await recalculateAssignments(timetable, {
      signal: controller.signal,
      maxNodes,
      maxRestarts: Number.MAX_SAFE_INTEGER,
      restartAfterNodes,
      seed,
      randomizeOrder,
      randomizeVariables,
      candidateOrdering,
      variableOrdering,
      onProgress: progress => samples.push({
        elapsedMs: progress.elapsedMs,
        visited: progress.visited,
        depth: progress.maxAssigned,
        diagnostics: progress.diagnostics,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = performance.now() - startedAt;
  const diagnostics = result.diagnostics || samples.at(-1)?.diagnostics || {};
  const depthBySecond = [];
  for (const sample of samples) {
    const second = Math.floor(sample.elapsedMs / 1_000);
    depthBySecond[second] = Math.max(depthBySecond[second] || 0, sample.depth || 0);
  }
  let objective = null, hardErrors = null;
  if (result.status === 'solved') {
    assert.equal(result.assignments.size, timetable.lessons.length);
    objective = objectiveBreakdown(timetable, result.assignments).total;
    const candidate = structuredClone(timetable);
    for (const lesson of candidate.lessons) lesson.assignedTime = result.assignments.get(lesson.id);
    hardErrors = analyzeSchedule(candidate).issues.filter(issue => issue.severity === 'error').length;
    assert.equal(hardErrors, 0, 'solver returned a hard-invalid assignment');
  }
  const report = {
    project: basename(projectPath), seed, candidateOrdering, variableOrdering,
    randomizeOrder, randomizeVariables, restartAfterNodes, maxNodes,
    lessons: timetable.lessons.length, status: result.status,
    restarts: diagnostics.restarts, elapsedMs: Math.round(elapsedMs),
    preparationMs: (diagnostics.domainBuildMs || 0) + (diagnostics.preprocessingMs || 0),
    searchMs: diagnostics.searchMs || 0,
    visited: result.visited,
    nodesPerSecond: Math.round((result.visited || 0) * 1000 / Math.max(1, elapsedMs)),
    maxDepth: diagnostics.maxDepth || Math.max(0, ...samples.map(sample => sample.depth || 0)),
    maxDepthPercent: Math.round(100 * (diagnostics.maxDepth || 0) / timetable.lessons.length),
    depthBySecond, objective, hardErrors,
    backtracks: diagnostics.backtracks,
    domainFilters: diagnostics.domainFilters,
    domainMaskWordsExamined: diagnostics.domainMaskWordsExamined,
    domainValuesPruned: diagnostics.domainValuesPruned,
    domainWipeouts: diagnostics.domainWipeouts,
    compatibilityChecks: diagnostics.compatibilityChecks,
    progressSamples: samples.length,
  };
  benchmarkResults.push(report);
  console.log(`TIMETABLE_PERF ${JSON.stringify(report)}`);

  assert.ok(['solved', 'cancelled', 'limit', 'unsatisfiable'].includes(result.status), `unexpected result: ${result.status}`);
  assert.ok(Number.isFinite(report.nodesPerSecond));
}

const median = values => {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
for (const candidateOrdering of candidateOrderings) {
  const samples = benchmarkResults.filter(item => item.candidateOrdering === candidateOrdering);
  console.log(`TIMETABLE_PERF_SUMMARY ${JSON.stringify({
    candidateOrdering, variableOrdering, randomizeVariables,
    runs: samples.length,
    successRate: samples.filter(item => item.status === 'solved').length / samples.length,
    medianElapsedMs: median(samples.map(item => item.elapsedMs)),
    medianNodesPerSecond: median(samples.map(item => item.nodesPerSecond)),
    medianMaxDepthPercent: median(samples.map(item => item.maxDepthPercent)),
    medianObjective: median(samples.map(item => item.objective).filter(Number.isFinite)),
  })}`);
}
