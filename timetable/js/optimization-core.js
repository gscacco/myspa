import { analyzeSchedule } from './schedule.js';
import { recalculateAssignments } from './recalculator.js';

export const OBJECTIVE_WEIGHTS = Object.freeze({ undesiredSlot: 100, missedPreferredSlot: 25, changedSourceSlot: 1 });

function resources(lesson) {
  return [...new Set([...(lesson.teacherIds || []), ...(lesson.classIds || []), ...(lesson.roomIds || [])])];
}

function resourceMap(timetable) {
  return new Map(['teachers', 'classes', 'rooms'].flatMap(type => (timetable.entities[type] || []).map(entity => [entity.id, entity])));
}

function slotPenalty(timetable, lesson, time, entities, useSourceHints = true) {
  let penalty = 0;
  const scopes = [lesson, ...resources(lesson).map(id => entities.get(id))];
  for (let offset = 0; offset < lesson.durationPeriods; offset++) {
    const slot = `${time.dayIndex}.${time.periodIndex + offset}`;
    for (const scope of scopes) {
      const undesired = scope?.constraints?.timeframes?.undesired || scope?.timeframes?.undesired || [];
      const desired = scope?.constraints?.timeframes?.desired || scope?.timeframes?.desired || [];
      if (undesired.includes(slot)) penalty += OBJECTIVE_WEIGHTS.undesiredSlot;
      if (desired.length && !desired.includes(slot)) penalty += OBJECTIVE_WEIGHTS.missedPreferredSlot;
    }
  }
  const hint = useSourceHints ? timetable.source?.assignmentHints?.[lesson.id] : null;
  if (hint && (hint.dayIndex !== time.dayIndex || hint.periodIndex !== time.periodIndex)) penalty += OBJECTIVE_WEIGHTS.changedSourceSlot;
  return penalty;
}

export function objectiveValue(timetable, assignments = new Map(timetable.lessons.map(lesson => [lesson.id, lesson.assignedTime])), useSourceHints = true) {
  const entities = resourceMap(timetable);
  return timetable.lessons.reduce((sum, lesson) => {
    const time = assignments.get(lesson.id);
    return sum + (time ? slotPenalty(timetable, lesson, time, entities, useSourceHints) : OBJECTIVE_WEIGHTS.undesiredSlot * 100);
  }, 0);
}

function timeSlots(timetable, lesson) {
  return timetable.calendar.days.flatMap(day => timetable.calendar.periods
    .filter(period => period.index + lesson.durationPeriods <= timetable.calendar.periods.length)
    .map(period => ({ dayIndex: day.index, periodIndex: period.index, sourceValue: `${day.index}.${period.index}` })));
}

function timeframeAllows(timetable, lesson, time) {
  const ids = new Set(resources(lesson));
  const scoped = ['teachers', 'classes', 'rooms'].flatMap(type => timetable.entities[type] || []).filter(entity => ids.has(entity.id));
  const unavailable = new Set([...(lesson.timeframes?.unavailable || []), ...scoped.flatMap(entity => entity.constraints?.timeframes?.unavailable || [])]);
  for (let offset = 0; offset < lesson.durationPeriods; offset++) {
    if (unavailable.has(`${time.dayIndex}.${time.periodIndex + offset}`)) return false;
  }
  return true;
}

function occupancy(timetable, assignments, ignoredLessonId = null) {
  const occupied = new Set();
  for (const lesson of timetable.lessons) {
    if (lesson.id === ignoredLessonId) continue;
    const time = assignments.get(lesson.id);
    if (!time) continue;
    for (const id of resources(lesson)) for (let offset = 0; offset < lesson.durationPeriods; offset++) {
      occupied.add(`${id}|${time.dayIndex}.${time.periodIndex + offset}`);
    }
  }
  return occupied;
}

function fits(lesson, time, occupied) {
  return resources(lesson).every(id => Array.from({ length: lesson.durationPeriods }, (_, offset) =>
    !occupied.has(`${id}|${time.dayIndex}.${time.periodIndex + offset}`)).every(Boolean));
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function hardValid(timetable, assignments) {
  const candidate = structuredClone(timetable);
  for (const lesson of candidate.lessons) lesson.assignedTime = assignments.get(lesson.id) || null;
  return analyzeSchedule(candidate).issues.every(issue => issue.severity !== 'error');
}

/** Feasibility is absolute; only hard-valid moves enter this soft-objective descent. */
async function runLocalOptimization(timetable, {
  signal,
  timeLimitMs = 30_000,
  maxObjective = 0,
  seed = 1,
  onProgress = () => {},
  recalculate = recalculateAssignments,
  useSourceHints = true,
} = {}) {
  if (!Number.isFinite(timeLimitMs) || timeLimitMs < 0) throw new RangeError('timeLimitMs must be a non-negative number.');
  if (!Number.isFinite(maxObjective) || maxObjective < 0) throw new RangeError('maxObjective must be a non-negative number.');
  const started = Date.now();
  if (signal?.aborted) return { status: 'cancelled', iterations: 0 };
  if (timeLimitMs === 0) return { status: 'time-limit', iterations: 0 };
  if (!timetable.lessons.length) return { status: 'solved', assignments: new Map(), iterations: 0, objective: 0, initialObjective: 0 };

  let assignments = new Map(timetable.lessons.map(lesson => [lesson.id, lesson.assignedTime]));
  let calculatedSeed = false;
  let seedIterations = 0;
  if (assignments.size !== timetable.lessons.length || [...assignments.values()].some(time => !time) || !hardValid(timetable, assignments)) {
    const result = await recalculate(timetable, { signal, useSourceHints, onProgress: progress => onProgress({ phase: 'feasibility', ...progress }) });
    if (result.status !== 'solved') return { status: signal?.aborted ? 'cancelled' : result.status, iterations: result.visited || 0 };
    assignments = result.assignments;
    calculatedSeed = true;
    // Count the complete-assignment check as work visible in the iteration counter.
    seedIterations = result.visited || 0;
  }
  const initialObjective = objectiveValue(timetable, assignments, useSourceHints);
  let bestObjective = initialObjective;
  let iterations = 1 + (calculatedSeed ? seedIterations : 0);
  let improved = true;
  const entities = resourceMap(timetable);
  const random = seededRandom(seed);
  const lessons = shuffled(timetable.lessons, random);
  const candidateSlots = new Map(timetable.lessons.map(lesson => [lesson.id, shuffled(timeSlots(timetable, lesson), random)]));
  onProgress({ phase: 'search', iterations, bestObjective, initialObjective });

  while (improved && bestObjective > maxObjective) {
    improved = false;
    for (const lesson of lessons) {
      if (signal?.aborted) return { status: 'cancelled', iterations, assignments, objective: bestObjective, initialObjective };
      if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', iterations, assignments, objective: bestObjective, initialObjective };
      const current = assignments.get(lesson.id);
      const occupied = occupancy(timetable, assignments, lesson.id);
      let selected = current;
      let selectedPenalty = slotPenalty(timetable, lesson, current, entities, useSourceHints);
      for (const time of candidateSlots.get(lesson.id)) {
        iterations++;
        if (time.dayIndex === current.dayIndex && time.periodIndex === current.periodIndex) continue;
        if (timeframeAllows(timetable, lesson, time) && fits(lesson, time, occupied)) {
          const penalty = slotPenalty(timetable, lesson, time, entities, useSourceHints);
          if (penalty < selectedPenalty) { selected = time; selectedPenalty = penalty; }
        }
        if (iterations % 64 === 0) {
          onProgress({ phase: 'search', iterations, bestObjective, initialObjective });
          await new Promise(resolve => setTimeout(resolve, 0));
          if (signal?.aborted) return { status: 'cancelled', iterations, assignments, objective: bestObjective, initialObjective };
          if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', iterations, assignments, objective: bestObjective, initialObjective };
        }
      }
      if (selected !== current) {
        assignments.set(lesson.id, selected);
        bestObjective += selectedPenalty - slotPenalty(timetable, lesson, current, entities, useSourceHints);
        improved = true;
        onProgress({ phase: 'search', iterations, bestObjective, initialObjective });
        if (bestObjective <= maxObjective) break;
      }
    }
  }
  return { status: 'solved', assignments: new Map(assignments), iterations, objective: bestObjective, initialObjective, calculatedSeed };
}

export async function optimizeLocally(timetable, options = {}) {
  const timeLimitMs = options.timeLimitMs ?? 30_000;
  if (!Number.isFinite(timeLimitMs) || timeLimitMs < 0) throw new RangeError('timeLimitMs must be a non-negative number.');
  if (options.signal?.aborted) return { status: 'cancelled', iterations: 0 };
  if (timeLimitMs === 0) return { status: 'time-limit', iterations: 0 };
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeLimitMs);
  try {
    const result = await runLocalOptimization(timetable, { ...options, signal: controller.signal });
    return timedOut && result.status === 'cancelled' ? { ...result, status: 'time-limit' } : result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
