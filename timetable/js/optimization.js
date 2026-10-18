import { normalizeObjectiveWeights, optimizeLocally } from './optimization-core.js';
import { optimizationScope } from './optimization-scope.js';

function defaultWorkerFactory() {
  const inline = globalThis.document?.querySelector('#optimization-worker-source')?.textContent;
  if (inline && typeof Blob !== 'undefined' && globalThis.URL?.createObjectURL) {
    const url = URL.createObjectURL(new Blob([inline], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.addEventListener('message', event => { if (event.data?.type === 'result') URL.revokeObjectURL(url); });
    return worker;
  }
  if (typeof Worker !== 'undefined') return new Worker(new URL('./optimization-worker.js', import.meta.url), { type: 'module' });
  return null;
}

function normalizeOptions({ workers = 1, timeLimitMs = 30_000, maxObjective = 0, seed = 1, algorithm = 'local', geneticStartAfterMs = 10_000, objectiveWeights } = {}) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw new RangeError('workers must be an integer from 1 to 8.');
  if (!Number.isFinite(timeLimitMs) || timeLimitMs < 0) throw new RangeError('timeLimitMs must be a non-negative number.');
  if (!Number.isFinite(maxObjective) || maxObjective < 0) throw new RangeError('maxObjective must be a non-negative number.');
  if (!['local', 'genetic', 'mixed'].includes(algorithm)) throw new RangeError('algorithm must be local, genetic, or mixed.');
  if (algorithm === 'mixed' && (!Number.isInteger(geneticStartAfterMs) || geneticStartAfterMs < 1
    || geneticStartAfterMs >= timeLimitMs)) {
    throw new RangeError('geneticStartAfterMs must be a positive integer below the total time limit for mixed mode.');
  }
  return { workers, timeLimitMs, maxObjective, seed, algorithm, geneticStartAfterMs, objectiveWeights: normalizeObjectiveWeights(objectiveWeights) };
}

/** Runs independent seeded searches in Web Workers when available; results remain proposals. */
export async function optimizeTimetable(timetable, options = {}) {
  const normalized = normalizeOptions(options);
  const { signal, onProgress = () => {}, workerFactory = defaultWorkerFactory } = options;
  const { timetable: scopedTimetable, optimizableLessons, excludedLessons } = optimizationScope(timetable);
  if (signal?.aborted) return { status: 'cancelled', iterations: 0, workersUsed: 0 };
  if (!optimizableLessons.length) return {
    status: 'no-eligible-lessons', assignments: new Map(), iterations: 0,
    objective: 0, initialObjective: 0, workersUsed: 0,
    activeLessonCount: 0, excludedLessonCount: excludedLessons.length,
  };
  if (normalized.workers === 1) {
    return { ...await optimizeLocally(scopedTimetable, { ...normalized, signal, onProgress }), workersUsed: 1, excludedLessonCount: excludedLessons.length };
  }
  const workerCandidates = [];
  try { for (let index = 0; index < normalized.workers; index++) workerCandidates.push(workerFactory()); }
  catch {
    workerCandidates.forEach(worker => worker?.terminate?.());
    return { ...await optimizeLocally(scopedTimetable, { ...normalized, signal, onProgress }), workersUsed: 1, workersFallback: true, excludedLessonCount: excludedLessons.length };
  }
  if (workerCandidates.some(worker => !worker)) {
    for (const worker of workerCandidates) worker?.terminate?.();
    return { ...await optimizeLocally(scopedTimetable, { ...normalized, signal, onProgress }), workersUsed: 1, workersFallback: true, excludedLessonCount: excludedLessons.length };
  }

  let iterations = 0;
  let bestObjective = Infinity;
  let bestObjectiveBreakdown = null;
  let initialObjective = null;
  let feasibilityAssigned = 0;
  let feasibilityTotal = null;
  let feasibilityAttempt = 1;
  const results = [];
  const workers = workerCandidates;
  const finishWorkers = () => workers.forEach(worker => worker.terminate?.());
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = result => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      finishWorkers();
      resolve({ ...result, iterations, workersUsed: workers.length, activeLessonCount: optimizableLessons.length, excludedLessonCount: excludedLessons.length });
    };
    const abort = () => {
      workers.forEach(worker => worker.postMessage({ type: 'cancel' }));
      settle({ status: 'cancelled', objective: Number.isFinite(bestObjective) ? bestObjective : undefined, objectiveBreakdown: bestObjectiveBreakdown, initialObjective, feasibilityAssigned, feasibilityTotal });
    };
    signal?.addEventListener('abort', abort, { once: true });
    workers.forEach((worker, index) => {
      worker.addEventListener('message', event => {
        const message = event.data || {};
        if (message.type === 'progress') {
          const progress = message.progress || {};
          const progressCount = Number.isFinite(progress.iterations)
            ? progress.iterations
            : Number.isFinite(progress.visited) ? progress.visited : worker.lastIterations || 0;
          iterations += Math.max(0, progressCount - (worker.lastIterations || 0));
          worker.lastIterations = progressCount;
          if (progress.phase === 'feasibility') {
            feasibilityAssigned = Math.max(feasibilityAssigned, Number(progress.maxAssigned ?? progress.assigned) || 0);
            feasibilityTotal = progress.total ?? feasibilityTotal;
            feasibilityAttempt = Math.max(feasibilityAttempt, Number(progress.attempt) || 1);
          }
          if (Number.isFinite(progress.initialObjective)) initialObjective ??= progress.initialObjective;
          if (Number.isFinite(progress.bestObjective) && progress.bestObjective < bestObjective) {
            bestObjective = progress.bestObjective;
            bestObjectiveBreakdown = progress.objectiveBreakdown || bestObjectiveBreakdown;
          }
          onProgress({ phase: progress.phase, algorithmStage: progress.algorithmStage, stageElapsedMs: progress.stageElapsedMs, iterations, bestObjective, objectiveBreakdown: bestObjectiveBreakdown, initialObjective, feasibilityAssigned, feasibilityTotal, feasibilityAttempt, workersCompleted: results.length, workersTotal: workers.length });
        } else if (message.type === 'result') {
          const result = message.result;
          const resultCount = Number.isFinite(result.iterations) ? result.iterations : worker.lastIterations || 0;
          if (resultCount > (worker.lastIterations || 0)) iterations += resultCount - (worker.lastIterations || 0);
          worker.lastIterations = resultCount;
          if (Number.isFinite(result.objective) && result.objective < bestObjective) {
            bestObjective = result.objective;
            bestObjectiveBreakdown = result.objectiveBreakdown || bestObjectiveBreakdown;
          }
          initialObjective ??= result.initialObjective;
          results.push({ ...result, assignments: new Map(result.assignments || []) });
          if (results.length === workers.length) {
            const comparable = results.filter(item => Number.isFinite(item.objective)).sort((a, b) => a.objective - b.objective);
            const solved = comparable.find(item => item.status === 'solved');
            settle(solved || comparable[0] || results[0]);
          }
        } else if (message.type === 'error') {
          if (!settled) { settled = true; signal?.removeEventListener('abort', abort); finishWorkers(); reject(new Error(message.message || 'Calcolo interrotto nel worker.')); }
        }
      });
      worker.addEventListener('error', event => {
        if (!settled) { settled = true; signal?.removeEventListener('abort', abort); finishWorkers(); reject(new Error(event.message || 'Worker non disponibile.')); }
      });
      worker.postMessage({ type: 'start', timetable: scopedTimetable, options: { ...normalized, seed: normalized.seed + index } });
    });
  });
}
