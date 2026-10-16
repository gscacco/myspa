import { optimizeLocally } from './optimization-core.js';

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

function normalizeOptions({ workers = 1, timeLimitMs = 30_000, maxObjective = 0, seed = 1 } = {}) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw new RangeError('workers must be an integer from 1 to 8.');
  if (!Number.isFinite(timeLimitMs) || timeLimitMs < 0) throw new RangeError('timeLimitMs must be a non-negative number.');
  if (!Number.isFinite(maxObjective) || maxObjective < 0) throw new RangeError('maxObjective must be a non-negative number.');
  return { workers, timeLimitMs, maxObjective, seed };
}

/** Runs independent seeded searches in Web Workers when available; results remain proposals. */
export async function optimizeTimetable(timetable, options = {}) {
  const normalized = normalizeOptions(options);
  const { signal, onProgress = () => {}, workerFactory = defaultWorkerFactory } = options;
  if (signal?.aborted) return { status: 'cancelled', iterations: 0, workersUsed: 0 };
  if (normalized.workers === 1) {
    return { ...await optimizeLocally(timetable, { ...normalized, useSourceHints: options.useSourceHints, signal, onProgress }), workersUsed: 1 };
  }
  const workerCandidates = [];
  try { for (let index = 0; index < normalized.workers; index++) workerCandidates.push(workerFactory()); }
  catch {
    workerCandidates.forEach(worker => worker?.terminate?.());
    return { ...await optimizeLocally(timetable, { ...normalized, useSourceHints: options.useSourceHints, signal, onProgress }), workersUsed: 1, workersFallback: true };
  }
  if (workerCandidates.some(worker => !worker)) {
    for (const worker of workerCandidates) worker?.terminate?.();
    return { ...await optimizeLocally(timetable, { ...normalized, useSourceHints: options.useSourceHints, signal, onProgress }), workersUsed: 1, workersFallback: true };
  }

  let iterations = 0;
  let bestObjective = Infinity;
  let initialObjective = null;
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
      resolve({ ...result, iterations, workersUsed: workers.length });
    };
    const abort = () => {
      workers.forEach(worker => worker.postMessage({ type: 'cancel' }));
      settle({ status: 'cancelled', objective: Number.isFinite(bestObjective) ? bestObjective : undefined, initialObjective });
    };
    signal?.addEventListener('abort', abort, { once: true });
    workers.forEach((worker, index) => {
      worker.addEventListener('message', event => {
        const message = event.data || {};
        if (message.type === 'progress') {
          iterations += Math.max(0, message.progress.iterations - (worker.lastIterations || 0));
          worker.lastIterations = message.progress.iterations;
          initialObjective ??= message.progress.initialObjective;
          bestObjective = Math.min(bestObjective, message.progress.bestObjective);
          onProgress({ phase: message.progress.phase, iterations, bestObjective, initialObjective, workersCompleted: results.length, workersTotal: workers.length });
        } else if (message.type === 'result') {
          const result = message.result;
          if (result.iterations > (worker.lastIterations || 0)) iterations += result.iterations - (worker.lastIterations || 0);
          worker.lastIterations = result.iterations;
          if (Number.isFinite(result.objective)) bestObjective = Math.min(bestObjective, result.objective);
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
      worker.postMessage({ type: 'start', timetable, options: { ...normalized, useSourceHints: options.useSourceHints, seed: normalized.seed + index } });
    });
  });
}
