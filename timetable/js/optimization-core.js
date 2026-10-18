import { analyzeSchedule } from './schedule.js';
import { recalculateAssignments } from './recalculator.js';

export const OBJECTIVE_WEIGHTS = Object.freeze({ undesiredSlot: 100, missedPreferredSlot: 25 });

export function normalizeObjectiveWeights(weights = {}) {
  const normalized = {
    undesiredSlot: weights.undesiredSlot ?? OBJECTIVE_WEIGHTS.undesiredSlot,
    missedPreferredSlot: weights.missedPreferredSlot ?? OBJECTIVE_WEIGHTS.missedPreferredSlot,
  };
  if (Object.values(normalized).some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Objective weights must be finite, non-negative numbers.');
  }
  return normalized;
}

function resources(lesson) {
  return [...new Set([...(lesson.teacherIds || []), ...(lesson.classIds || []), ...(lesson.roomIds || [])])];
}

function resourceMap(timetable) {
  return new Map(['teachers', 'classes', 'rooms'].flatMap(type => (timetable.entities[type] || []).map(entity => [entity.id, entity])));
}

function slotPenalty(timetable, lesson, time, entities, weights = OBJECTIVE_WEIGHTS) {
  let penalty = 0;
  const scopes = [lesson, ...resources(lesson).map(id => entities.get(id))];
  for (let offset = 0; offset < lesson.durationPeriods; offset++) {
    const slot = `${time.dayIndex}.${time.periodIndex + offset}`;
    for (const scope of scopes) {
      const undesired = scope?.constraints?.timeframes?.undesired || scope?.timeframes?.undesired || [];
      const desired = scope?.constraints?.timeframes?.desired || scope?.timeframes?.desired || [];
      if (undesired.includes(slot)) penalty += weights.undesiredSlot;
      if (desired.length && !desired.includes(slot)) penalty += weights.missedPreferredSlot;
    }
  }
  return penalty;
}

export function objectiveValue(timetable, assignments = new Map(timetable.lessons.map(lesson => [lesson.id, lesson.assignedTime])), weights = OBJECTIVE_WEIGHTS) {
  return objectiveBreakdown(timetable, assignments, weights).total;
}

/** Upper bound for a complete schedule: each lesson independently takes its most expensive calendar slot. */
export function objectiveUpperBound(timetable, weights = OBJECTIVE_WEIGHTS) {
  weights = normalizeObjectiveWeights(weights);
  const entities = resourceMap(timetable);
  return timetable.lessons.reduce((total, lesson) => {
    const allowedTimes = timeSlots(timetable, lesson).filter(time => timeframeAllows(timetable, lesson, time));
    const maximum = allowedTimes.reduce((best, time) =>
      Math.max(best, slotPenalty(timetable, lesson, time, entities, weights)), 0);
    return total + maximum;
  }, 0);
}

function scoreFromCounts(counts, weights = OBJECTIVE_WEIGHTS) {
  const penalties = {
    avoidedSlots: counts.avoidedSlotHits * weights.undesiredSlot,
    missedPreferences: counts.missedPreferenceHits * weights.missedPreferredSlot,
    unassignedLessons: counts.unassignedLessons * weights.undesiredSlot * 100,
  };
  return { counts, penalties, total: Object.values(penalties).reduce((sum, value) => sum + value, 0) };
}

function lessonObjectiveCounts(timetable, lesson, time, entities, weights = OBJECTIVE_WEIGHTS) {
  const counts = { avoidedSlotHits: 0, missedPreferenceHits: 0, unassignedLessons: 0 };
  if (!time) { counts.unassignedLessons = 1; return counts; }
  const scopes = [lesson, ...resources(lesson).map(id => entities.get(id))];
  for (let offset = 0; offset < lesson.durationPeriods; offset++) {
    const slot = `${time.dayIndex}.${time.periodIndex + offset}`;
    for (const scope of scopes) {
      const undesired = scope?.constraints?.timeframes?.undesired || scope?.timeframes?.undesired || [];
      const desired = scope?.constraints?.timeframes?.desired || scope?.timeframes?.desired || [];
      if (undesired.includes(slot)) counts.avoidedSlotHits++;
      if (desired.length && !desired.includes(slot)) counts.missedPreferenceHits++;
    }
  }
  return counts;
}

function addCounts(...countsList) {
  const keys = ['avoidedSlotHits', 'missedPreferenceHits', 'unassignedLessons'];
  return Object.fromEntries(keys.map(key => [key, countsList.reduce((sum, counts) => sum + counts[key], 0)]));
}

/** Exact weighted-score breakdown, updated incrementally as lessons move. */
export function objectiveBreakdown(timetable, assignments, weights = OBJECTIVE_WEIGHTS) {
  weights = normalizeObjectiveWeights(weights);
  const entities = resourceMap(timetable);
  const counts = addCounts(...timetable.lessons.map(lesson =>
    lessonObjectiveCounts(timetable, lesson, assignments.get(lesson.id), entities, weights)));
  return scoreFromCounts(counts, weights);
}

function replaceLessonContribution(current, previous, next, weights = OBJECTIVE_WEIGHTS) {
  const keys = ['avoidedSlotHits', 'missedPreferenceHits', 'unassignedLessons'];
  return scoreFromCounts(Object.fromEntries(keys.map(key => [key, current.counts[key] - previous[key] + next[key]])), weights);
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

function occupancy(timetable, assignments, ignoredLessonId = null, alsoIgnoredLessonId = null) {
  const occupied = new Set();
  for (const lesson of timetable.lessons) {
    if (lesson.id === ignoredLessonId || lesson.id === alsoIgnoredLessonId) continue;
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
  objectiveWeights = OBJECTIVE_WEIGHTS,
  onProgress = () => {},
  recalculate = recalculateAssignments,
} = {}) {
  if (!Number.isFinite(timeLimitMs) || timeLimitMs < 0) throw new RangeError('timeLimitMs must be a non-negative number.');
  if (!Number.isFinite(maxObjective) || maxObjective < 0) throw new RangeError('maxObjective must be a non-negative number.');
  const weights = normalizeObjectiveWeights(objectiveWeights);
  const started = Date.now();
  if (signal?.aborted) return { status: 'cancelled', iterations: 0 };
  if (timeLimitMs === 0) return { status: 'time-limit', iterations: 0 };
  if (!timetable.lessons.length) return { status: 'solved', assignments: new Map(), iterations: 0, objective: 0, initialObjective: 0 };

  let assignments = new Map(timetable.lessons.map(lesson => [lesson.id, lesson.assignedTime]));
  let calculatedSeed = false;
  let seedIterations = 0;
  if (assignments.size !== timetable.lessons.length || [...assignments.values()].some(time => !time) || !hardValid(timetable, assignments)) {
    const remainingMs = Math.max(0, timeLimitMs - (Date.now() - started));
    if (!remainingMs) return { status: 'time-limit', iterations: 0 };
    const feasibilityController = new AbortController();
    const abortFeasibility = () => feasibilityController.abort();
    signal?.addEventListener('abort', abortFeasibility, { once: true });
    const feasibilityTimer = setTimeout(abortFeasibility, Math.min(remainingMs, 2_147_000_000));
    let result;
    try {
      result = await recalculate(timetable, {
        signal: feasibilityController.signal,
        // Interactive feasibility uses bounded restarts until the configured
        // deadline, rather than exhausting one deterministic search tree.
        maxNodes: Number.MAX_SAFE_INTEGER,
        restartAfterNodes: 25_000,
        maxRestarts: Number.MAX_SAFE_INTEGER,
        seed,
        randomizeOrder: true,
        randomizeVariables: true,
        onProgress: progress => onProgress({ phase: 'feasibility', ...progress }),
      });
    } finally {
      clearTimeout(feasibilityTimer);
      signal?.removeEventListener('abort', abortFeasibility);
    }
    const feasibilityTimedOut = feasibilityController.signal.aborted && !signal?.aborted;
    if (result.status !== 'solved') return {
      status: signal?.aborted ? 'cancelled' : feasibilityTimedOut ? 'time-limit' : result.status,
      iterations: result.visited || 0,
      reason: result.reason,
    };
    assignments = result.assignments;
    calculatedSeed = true;
    // Count the complete-assignment check as work visible in the iteration counter.
    seedIterations = result.visited || 0;
  }
  let currentBreakdown = objectiveBreakdown(timetable, assignments, weights);
  const initialObjective = currentBreakdown.total;
  let currentObjective = currentBreakdown.total;
  let bestObjective = currentObjective;
  let bestBreakdown = currentBreakdown;
  let bestAssignments = new Map(assignments);
  let iterations = 1 + (calculatedSeed ? seedIterations : 0);
  const entities = resourceMap(timetable);
  const random = seededRandom(seed);
  const lessons = shuffled(timetable.lessons, random);
  const candidateSlots = new Map(timetable.lessons.map(lesson => [lesson.id, shuffled(timeSlots(timetable, lesson), random)]));
  const lessonById = new Map(lessons.map(lesson => [lesson.id, lesson]));
  const lessonsByResource = new Map();
  for (const lesson of lessons) for (const id of resources(lesson)) {
    if (!lessonsByResource.has(id)) lessonsByResource.set(id, []);
    lessonsByResource.get(id).push(lesson.id);
  }
  const relatedLessons = new Map(lessons.map(lesson => [lesson.id, new Set()]));
  for (const ids of lessonsByResource.values()) for (const id of ids) {
    for (const otherId of ids) if (otherId !== id) relatedLessons.get(id).add(otherId);
  }
  onProgress({ phase: 'search', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective });

  async function perturbAssignments(round, stagnation) {
    const steps = Math.min(6000, Math.max(500, lessons.length * (1 + Math.min(stagnation, 4))));
    const startingTemperature = 120 + Math.min(stagnation, 8) * 55;
    let accepted = 0;
    let pairedAccepted = 0;
    onProgress({ phase: 'perturbation', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, round, stagnation });
    for (let step = 0; step < steps; step++) {
      if (step % 32 === 0) {
        onProgress({ phase: 'perturbation', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, round, stagnation, accepted, pairedAccepted });
        await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) return 'cancelled';
        if (Date.now() - started >= timeLimitMs) return 'time-limit';
      }
      const lesson = lessons[Math.floor(random() * lessons.length)];
      const current = assignments.get(lesson.id);
      const partnerIds = [...relatedLessons.get(lesson.id)];
      const partner = random() < 0.55 && partnerIds.length
        ? lessonById.get(partnerIds[Math.floor(random() * partnerIds.length)]) : null;
      iterations++;
      const temperature = startingTemperature - (startingTemperature - 8) * step / Math.max(1, steps - 1);
      let delta = Infinity;
      let move = null;

      if (partner) {
        const partnerTime = assignments.get(partner.id);
        if (current.dayIndex !== partnerTime.dayIndex || current.periodIndex !== partnerTime.periodIndex) {
          const occupied = occupancy(timetable, assignments, lesson.id, partner.id);
          if (timeframeAllows(timetable, lesson, partnerTime) && timeframeAllows(timetable, partner, current)
            && fits(lesson, partnerTime, occupied) && fits(partner, current, occupied)) {
            const cells = new Set();
            for (const id of resources(lesson)) for (let offset = 0; offset < lesson.durationPeriods; offset++) cells.add(`${id}|${partnerTime.dayIndex}.${partnerTime.periodIndex + offset}`);
            let overlaps = false;
            for (const id of resources(partner)) for (let offset = 0; offset < partner.durationPeriods; offset++) {
              if (cells.has(`${id}|${current.dayIndex}.${current.periodIndex + offset}`)) { overlaps = true; break; }
            }
            if (!overlaps) {
              const oldLesson = lessonObjectiveCounts(timetable, lesson, current, entities, weights);
              const oldPartner = lessonObjectiveCounts(timetable, partner, partnerTime, entities, weights);
              const nextLesson = lessonObjectiveCounts(timetable, lesson, partnerTime, entities, weights);
              const nextPartner = lessonObjectiveCounts(timetable, partner, current, entities, weights);
              delta = (nextLesson.avoidedSlotHits + nextPartner.avoidedSlotHits - oldLesson.avoidedSlotHits - oldPartner.avoidedSlotHits) * weights.undesiredSlot
                + (nextLesson.missedPreferenceHits + nextPartner.missedPreferenceHits - oldLesson.missedPreferenceHits - oldPartner.missedPreferenceHits) * weights.missedPreferredSlot;
              move = { lesson, partner, current, partnerTime, oldLesson, oldPartner, nextLesson, nextPartner };
            }
          }
        }
      }

      if (!move) {
        const choices = candidateSlots.get(lesson.id);
        const time = choices[Math.floor(random() * choices.length)];
        if (time.dayIndex === current.dayIndex && time.periodIndex === current.periodIndex) continue;
        const occupied = occupancy(timetable, assignments, lesson.id);
        if (!timeframeAllows(timetable, lesson, time) || !fits(lesson, time, occupied)) continue;
        const oldContribution = lessonObjectiveCounts(timetable, lesson, current, entities, weights);
        const nextContribution = lessonObjectiveCounts(timetable, lesson, time, entities, weights);
        delta = (nextContribution.avoidedSlotHits - oldContribution.avoidedSlotHits) * weights.undesiredSlot
          + (nextContribution.missedPreferenceHits - oldContribution.missedPreferenceHits) * weights.missedPreferredSlot;
        move = { lesson, current, time, oldContribution, nextContribution };
      }

      if (delta > 0 && random() >= Math.exp(-delta / temperature)) continue;
      if (move.partner) {
        assignments.set(move.lesson.id, move.partnerTime);
        assignments.set(move.partner.id, move.current);
        currentBreakdown = replaceLessonContribution(currentBreakdown, move.oldLesson, move.nextLesson, weights);
        currentBreakdown = replaceLessonContribution(currentBreakdown, move.oldPartner, move.nextPartner, weights);
        pairedAccepted++;
      } else {
        assignments.set(move.lesson.id, move.time);
        currentBreakdown = replaceLessonContribution(currentBreakdown, move.oldContribution, move.nextContribution, weights);
      }
      currentObjective = currentBreakdown.total;
      accepted++;
      if (currentObjective < bestObjective) {
        bestObjective = currentObjective;
        bestBreakdown = currentBreakdown;
        bestAssignments = new Map(assignments);
      }
    }
    onProgress({ phase: 'perturbation', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, round, stagnation, accepted, pairedAccepted });
    return 'ready';
  }

  async function repairBlock(round, stagnation) {
    const sizeLevel = Math.min(6, Math.floor(stagnation / 2));
    const blockSize = Math.min(64, 2 ** (2 + sizeLevel));
    const selectedIds = new Set();
    const frontier = [];
    const addLesson = id => {
      if (selectedIds.has(id)) return;
      selectedIds.add(id);
      for (const relatedId of relatedLessons.get(id) || []) if (!selectedIds.has(relatedId)) frontier.push(relatedId);
    };
    addLesson(lessons[Math.floor(random() * lessons.length)].id);
    while (selectedIds.size < blockSize) {
      while (frontier.length && selectedIds.has(frontier.at(-1))) frontier.pop();
      if (!frontier.length) {
        const remaining = lessons.filter(lesson => !selectedIds.has(lesson.id));
        if (!remaining.length) break;
        addLesson(remaining[Math.floor(random() * remaining.length)].id);
      } else {
        const index = Math.floor(random() * frontier.length);
        const [id] = frontier.splice(index, 1);
        addLesson(id);
      }
    }

    const blockLessons = [...selectedIds].map(id => lessonById.get(id));
    const blockSet = new Set(selectedIds);
    const blockTimetable = { ...timetable, lessons: blockLessons, entities: structuredClone(timetable.entities) };
    const unknownClassIds = new Set((timetable.entities.classes || []).filter(entity => entity.placeholder === 'unknown').map(entity => entity.id));
    const fixedSlots = new Map();
    for (const lesson of timetable.lessons) {
      if (blockSet.has(lesson.id)) continue;
      const time = assignments.get(lesson.id);
      if (!time) continue;
      for (const id of resources(lesson)) {
        if (unknownClassIds.has(id)) continue;
        if (!fixedSlots.has(id)) fixedSlots.set(id, new Set());
        for (let offset = 0; offset < lesson.durationPeriods; offset++) fixedSlots.get(id).add(`${time.dayIndex}.${time.periodIndex + offset}`);
      }
    }
    for (const collection of ['teachers', 'classes', 'rooms']) for (const entity of blockTimetable.entities[collection] || []) {
      const reserved = fixedSlots.get(entity.id);
      if (!reserved?.size) continue;
      entity.constraints ||= { timeframes: { unavailable: [], desired: [], undesired: [] } };
      entity.constraints.timeframes ||= { unavailable: [], desired: [], undesired: [] };
      const timeframes = entity.constraints.timeframes;
      timeframes.unavailable = [...new Set([...(timeframes.unavailable || entity.timeframes?.unavailable || []), ...reserved])];
    }

    const bestBefore = bestObjective;
    onProgress({ phase: 'block', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, round, blockSize });
    let visited = 0;
    const repaired = await recalculate(blockTimetable, {
      signal,
      seed: (seed + 0x9e3779b9 + round) >>> 0,
      randomizeOrder: true,
      maxNodes: Number.MAX_SAFE_INTEGER,
      onProgress: progress => {
        const count = Number(progress.visited) || 0;
        iterations += Math.max(0, count - visited);
        visited = count;
        onProgress({ phase: 'block', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, round, blockSize, assigned: progress.assigned, total: progress.total });
      },
    });
    iterations += Math.max(0, (repaired.visited || 0) - visited);
    if (repaired.status !== 'solved') return signal?.aborted ? 'cancelled' : 'ready';

    const candidateAssignments = new Map(assignments);
    for (const [id, time] of repaired.assignments) candidateAssignments.set(id, time);
    if (!hardValid(timetable, candidateAssignments)) return 'ready';
    const candidateBreakdown = objectiveBreakdown(timetable, candidateAssignments, weights);
    const delta = candidateBreakdown.total - currentObjective;
    const temperature = 180 + Math.min(stagnation, 8) * 100;
    if (delta > 0 && random() >= Math.exp(-delta / temperature)) return 'ready';

    assignments = candidateAssignments;
    currentBreakdown = candidateBreakdown;
    currentObjective = candidateBreakdown.total;
    if (currentObjective < bestObjective) {
      bestObjective = currentObjective;
      bestBreakdown = currentBreakdown;
      bestAssignments = new Map(assignments);
      stagnation = 0;
      onProgress({ phase: 'search', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective });
    }
    return 'ready';
  }

  let restart = 0;
  let perturbationRound = 0;
  let stagnation = 0;
  while (bestObjective > maxObjective) {
    const bestAtCycleStart = bestObjective;
    let improved = true;
    while (improved && currentObjective > maxObjective) {
      improved = false;
      for (const lesson of lessons) {
        if (signal?.aborted) return { status: 'cancelled', iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
        if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
        const current = assignments.get(lesson.id);
        const occupied = occupancy(timetable, assignments, lesson.id);
        let selected = current;
        let selectedPenalty = slotPenalty(timetable, lesson, current, entities, weights);
        for (const time of candidateSlots.get(lesson.id)) {
          iterations++;
          if (time.dayIndex === current.dayIndex && time.periodIndex === current.periodIndex) continue;
          if (timeframeAllows(timetable, lesson, time) && fits(lesson, time, occupied)) {
            const penalty = slotPenalty(timetable, lesson, time, entities, weights);
            if (penalty < selectedPenalty) { selected = time; selectedPenalty = penalty; }
          }
          if (iterations % 64 === 0) {
            onProgress({ phase: 'search', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective });
            await new Promise(resolve => setTimeout(resolve, 0));
            if (signal?.aborted) return { status: 'cancelled', iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
            if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
          }
        }
        if (selected !== current) {
          const previousContribution = lessonObjectiveCounts(timetable, lesson, current, entities, weights);
          const nextContribution = lessonObjectiveCounts(timetable, lesson, selected, entities, weights);
          assignments.set(lesson.id, selected);
          currentBreakdown = replaceLessonContribution(currentBreakdown, previousContribution, nextContribution, weights);
          currentObjective = currentBreakdown.total;
          improved = true;
          if (currentObjective < bestObjective) {
            bestObjective = currentObjective;
            bestBreakdown = currentBreakdown;
            bestAssignments = new Map(assignments);
          }
          onProgress({ phase: 'search', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective });
          if (currentObjective <= maxObjective) break;
        }
      }
    }
    if (bestObjective <= maxObjective) break;
    if (signal?.aborted) return { status: 'cancelled', iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
    if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };

    perturbationRound++;
    stagnation = bestObjective < bestAtCycleStart ? 0 : stagnation + 1;
    if (perturbationRound % 4 !== 0) {
      const bestBeforeShake = bestObjective;
      const perturbationStatus = await perturbAssignments(perturbationRound, stagnation);
      if (perturbationStatus !== 'ready') return { status: perturbationStatus, iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
      if (bestObjective < bestBeforeShake) stagnation = 0;
      continue;
    }

    if (perturbationRound % 8 === 4) {
      const bestBeforeBlock = bestObjective;
      const blockStatus = await repairBlock(perturbationRound, stagnation);
      if (blockStatus !== 'ready') return { status: blockStatus, iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective };
      if (bestObjective < bestBeforeBlock) stagnation = 0;
      continue;
    }

    restart++;
    onProgress({ phase: 'restart', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, restart });
    let restartVisited = 0;
    const restarted = await recalculate(timetable, {
      signal,
      seed: (seed + restart) >>> 0,
      randomizeOrder: true,
      maxNodes: Number.MAX_SAFE_INTEGER,
      onProgress: progress => {
        const visited = Number(progress.visited) || 0;
        iterations += Math.max(0, visited - restartVisited);
        restartVisited = visited;
        onProgress({ phase: 'restart', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, restart, assigned: progress.assigned, total: progress.total });
      },
    });
    iterations += Math.max(0, (restarted.visited || 0) - restartVisited);
    if (restarted.status !== 'solved') {
      const status = signal?.aborted ? 'cancelled' : restarted.status;
      return { status, iterations, assignments: bestAssignments, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, reason: restarted.reason };
    }
    assignments = restarted.assignments;
    currentBreakdown = objectiveBreakdown(timetable, assignments, weights);
    currentObjective = currentBreakdown.total;
    if (currentObjective < bestObjective) {
      bestObjective = currentObjective;
      bestBreakdown = currentBreakdown;
      bestAssignments = new Map(assignments);
      stagnation = 0;
      onProgress({ phase: 'search', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective });
    }
  }
  return { status: 'solved', assignments: bestAssignments, iterations, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, calculatedSeed, restarts: restart, perturbationRounds: perturbationRound };
}

async function runGeneticOptimization(timetable, {
  signal,
  timeLimitMs = 30_000,
  maxObjective = 0,
  seed = 1,
  objectiveWeights = OBJECTIVE_WEIGHTS,
  initialAssignments = null,
  onProgress = () => {},
  recalculate = recalculateAssignments,
} = {}) {
  const started = Date.now();
  const weights = normalizeObjectiveWeights(objectiveWeights);
  const populationSize = 8;
  const random = seededRandom(seed);
  const lessons = timetable.lessons;
  if (!lessons.length) return { status: 'solved', assignments: new Map(), iterations: 0, objective: 0, initialObjective: 0 };

  const entities = resourceMap(timetable);
  const candidateSlots = new Map(lessons.map(lesson => [lesson.id, timeSlots(timetable, lesson)]));
  const resourceDegrees = new Map(lessons.map(lesson => [lesson.id, 0]));
  const resourceMembers = new Map();
  for (const lesson of lessons) for (const id of resources(lesson)) {
    if (!resourceMembers.has(id)) resourceMembers.set(id, []);
    resourceMembers.get(id).push(lesson.id);
  }
  for (const members of resourceMembers.values()) for (const id of members) resourceDegrees.set(id, resourceDegrees.get(id) + members.length - 1);

  let iterations = 0;
  let initialObjective;
  let seedIndex = 0;
  let lastFailure = null;
  let feasibilityAssigned = 0;
  let feasibilityTotal = lessons.length;
  const population = [];
  const seen = new Set();
  const signature = assignments => lessons.map(lesson => {
    const time = assignments.get(lesson.id);
    return time ? `${time.dayIndex}.${time.periodIndex}` : '-';
  }).join('|');
  const addIndividual = assignments => {
    if (!(assignments instanceof Map) || assignments.size !== lessons.length) return false;
    const key = signature(assignments);
    if (seen.has(key)) return false;
    seen.add(key);
    const breakdown = objectiveBreakdown(timetable, assignments, weights);
    const individual = { assignments: new Map(assignments), breakdown, objective: breakdown.total };
    population.push(individual);
    if (initialObjective == null) initialObjective = individual.objective;
    return true;
  };
  const occupyLesson = (lesson, time, occupied) => {
    for (const id of resources(lesson)) for (let offset = 0; offset < lesson.durationPeriods; offset++) {
      occupied.add(`${id}|${time.dayIndex}.${time.periodIndex + offset}`);
    }
  };

  async function createRandomSchedule() {
    const remainingMs = timeLimitMs - (Date.now() - started);
    if (signal?.aborted || remainingMs <= 0) return null;
    let reportedVisited = 0;
    const feasibilityController = new AbortController();
    const abortFeasibility = () => feasibilityController.abort();
    signal?.addEventListener('abort', abortFeasibility, { once: true });
    const feasibilityTimer = setTimeout(abortFeasibility, Math.min(remainingMs, 2_147_000_000));
    let result;
    try {
      result = await recalculate(timetable, {
        signal: feasibilityController.signal,
        seed: (seed + 0x9e3779b9 + seedIndex++) >>> 0,
        randomizeOrder: true,
        randomizeVariables: true,
        maxNodes: Number.MAX_SAFE_INTEGER,
        restartAfterNodes: 25_000,
        maxRestarts: Number.MAX_SAFE_INTEGER,
        onProgress: progress => {
          const visited = Number(progress.visited) || 0;
          iterations += Math.max(0, visited - reportedVisited);
          reportedVisited = visited;
          feasibilityAssigned = Math.max(feasibilityAssigned, Number(progress.maxAssigned ?? progress.assigned) || 0);
          feasibilityTotal = Number(progress.total) || feasibilityTotal;
          onProgress({
            phase: 'feasibility', iterations, initialObjective,
            assigned: feasibilityAssigned, total: feasibilityTotal,
            restart: progress.restart, attempt: progress.attempt, diagnostics: progress.diagnostics,
          });
        },
      });
    } finally {
      clearTimeout(feasibilityTimer);
      signal?.removeEventListener('abort', abortFeasibility);
    }
    iterations += Math.max(0, (result.visited || 0) - reportedVisited);
    if (result.status === 'solved') return result.assignments;
    lastFailure = result.status === 'cancelled' && !signal?.aborted
      ? { ...result, status: 'time-limit' }
      : result;
    return null;
  }

  if (initialAssignments instanceof Map && initialAssignments.size === lessons.length
    && lessons.every(lesson => initialAssignments.has(lesson.id)) && hardValid(timetable, initialAssignments)) {
    addIndividual(initialAssignments);
  }
  const existingAssignments = new Map(lessons.map(lesson => [lesson.id, lesson.assignedTime]));
  if (existingAssignments.size === lessons.length && [...existingAssignments.values()].every(Boolean)
    && hardValid(timetable, existingAssignments)) addIndividual(existingAssignments);
  while (population.length < populationSize && !population.some(item => item.objective <= maxObjective)
    && Date.now() - started < timeLimitMs && !signal?.aborted) {
    const first = population[Math.floor(random() * population.length)];
    const second = population[Math.floor(random() * population.length)];
    let assignments = population.length && random() < 0.75 ? crossover(first, second, 0.3) : null;
    if (!assignments) assignments = await createRandomSchedule();
    if (!assignments) break;
    addIndividual(assignments);
  }
  if (!population.length) {
    return { status: signal?.aborted ? 'cancelled' : lastFailure?.status || 'time-limit', iterations, objective: undefined, initialObjective, reason: lastFailure?.reason, feasibilityAssigned, feasibilityTotal };
  }

  const bestFromPopulation = () => [...population].sort((left, right) => left.objective - right.objective)[0];
  let best = bestFromPopulation();
  let bestAssignments = new Map(best.assignments);
  let bestBreakdown = best.breakdown;
  let bestObjective = best.objective;
  initialObjective ??= bestObjective;

  function crossover(first, second, mutationRate) {
    const randomTies = new Map(lessons.map(lesson => [lesson.id, random()]));
    const ordered = [...lessons].sort((left, right) => resourceDegrees.get(right.id) - resourceDegrees.get(left.id)
      || randomTies.get(left.id) - randomTies.get(right.id));
    const child = new Map();
    const occupied = new Set();
    for (const lesson of ordered) {
      const mutate = random() < mutationRate;
      const inherited = mutate ? [] : [first.assignments.get(lesson.id), second.assignments.get(lesson.id)].filter(Boolean);
      const slots = shuffled(candidateSlots.get(lesson.id), random);
      const choices = [];
      const visited = new Set();
      for (const time of [...shuffled(inherited, random), ...slots]) {
        const key = `${time.dayIndex}.${time.periodIndex}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (!timeframeAllows(timetable, lesson, time) || !fits(lesson, time, occupied)) continue;
        choices.push({ time, penalty: slotPenalty(timetable, lesson, time, entities, weights), inherited: inherited.some(item => item.dayIndex === time.dayIndex && item.periodIndex === time.periodIndex) });
      }
      if (!choices.length) return null;
      const minimum = Math.min(...choices.map(choice => choice.penalty));
      const inheritedChoices = choices.filter(choice => choice.inherited);
      const pool = !mutate && inheritedChoices.length && random() < 0.65
        ? inheritedChoices.filter(choice => choice.penalty <= Math.min(...inheritedChoices.map(item => item.penalty)) + weights.undesiredSlot)
        : choices.filter(choice => choice.penalty <= minimum + (mutate
          ? weights.undesiredSlot + weights.missedPreferredSlot : weights.missedPreferredSlot));
      const selected = pool[Math.floor(random() * pool.length)];
      child.set(lesson.id, selected.time);
      occupyLesson(lesson, selected.time, occupied);
    }
    return child;
  }

  function tournament() {
    let selected = population[Math.floor(random() * population.length)];
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidate = population[Math.floor(random() * population.length)];
      if (candidate.objective < selected.objective) selected = candidate;
    }
    return selected;
  }

  let generation = 0;
  let stagnantGenerations = 0;
  onProgress({ phase: 'genetic', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generation });
  while (bestObjective > maxObjective) {
    if (signal?.aborted) return { status: 'cancelled', assignments: bestAssignments, iterations, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generations: generation };
    if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', assignments: bestAssignments, iterations, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generations: generation };
    generation++;
    const bestAtStart = bestObjective;
    const mutationRate = Math.min(0.4, 0.08 + stagnantGenerations * 0.04);
    const offspring = [];
    const elites = [...population].sort((left, right) => left.objective - right.objective).slice(0, 2);
    offspring.push(...elites.map(item => ({ ...item, assignments: new Map(item.assignments) })));
    while (offspring.length < populationSize) {
      const first = tournament();
      const second = tournament();
      let assignments = crossover(first, second, mutationRate);
      if (!assignments && random() < 0.35) assignments = await createRandomSchedule();
      if (!assignments) assignments = new Map(first.assignments);
      const breakdown = objectiveBreakdown(timetable, assignments, weights);
      offspring.push({ assignments, breakdown, objective: breakdown.total });
      iterations++;
      if (breakdown.total < bestObjective) {
        bestObjective = breakdown.total;
        bestBreakdown = breakdown;
        bestAssignments = new Map(assignments);
      }
      if (bestObjective <= maxObjective) break;
      if (offspring.length % 2 === 0) {
        onProgress({ phase: 'genetic', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generation, population: offspring.length, populationSize, mutationRate });
        await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) return { status: 'cancelled', assignments: bestAssignments, iterations, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generations: generation };
        if (Date.now() - started >= timeLimitMs) return { status: 'time-limit', assignments: bestAssignments, iterations, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generations: generation };
      }
    }

    population.length = 0;
    seen.clear();
    for (const individual of [...offspring, ...elites].sort((left, right) => left.objective - right.objective)) {
      const key = signature(individual.assignments);
      if (seen.has(key)) continue;
      seen.add(key);
      population.push(individual);
      if (population.length === populationSize) break;
    }
    if (bestObjective < bestAtStart) stagnantGenerations = 0;
    else stagnantGenerations++;
    onProgress({ phase: 'genetic', iterations, bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generation, population: population.length, populationSize, mutationRate });
  }
  return { status: 'solved', assignments: bestAssignments, iterations, objective: bestObjective, objectiveBreakdown: bestBreakdown, initialObjective, generations: generation };
}

async function runMixedOptimization(timetable, options) {
  const started = Date.now();
  const cutoffMs = options.geneticStartAfterMs;
  let localResult = { status: 'time-limit', iterations: 0 };
  if (cutoffMs > 0) {
    const phaseController = new AbortController();
    const abortPhase = () => phaseController.abort();
    options.signal?.addEventListener('abort', abortPhase, { once: true });
    const cutoffTimer = setTimeout(abortPhase, cutoffMs);
    try {
      localResult = await runLocalOptimization(timetable, {
        ...options,
        algorithm: 'local',
        signal: phaseController.signal,
        timeLimitMs: cutoffMs,
        onProgress: progress => options.onProgress({
          ...progress, algorithmStage: 'classic', stageElapsedMs: Date.now() - started,
        }),
      });
    } finally {
      clearTimeout(cutoffTimer);
      options.signal?.removeEventListener('abort', abortPhase);
    }
  }
  if (options.signal?.aborted) return { ...localResult, status: 'cancelled' };
  if (localResult.status === 'solved') return { ...localResult, algorithmStage: 'classic' };
  if (localResult.status === 'unsatisfiable' || localResult.reason?.type === 'resource-capacity' || localResult.reason?.type === 'empty-domain') return localResult;

  while (!options.signal?.aborted && Date.now() - started < cutoffMs) {
    const stageElapsedMs = Date.now() - started;
    options.onProgress({
      phase: 'mixed-classic-wait', algorithmStage: 'classic', stageElapsedMs,
      iterations: localResult.iterations || 0, bestObjective: localResult.objective,
      objectiveBreakdown: localResult.objectiveBreakdown, initialObjective: localResult.initialObjective,
    });
    await new Promise(resolve => setTimeout(resolve, Math.min(250, cutoffMs - stageElapsedMs)));
  }
  if (options.signal?.aborted) return { ...localResult, status: 'cancelled' };

  const elapsedMs = Date.now() - started;
  const remainingMs = Math.max(0, options.timeLimitMs - elapsedMs);
  if (!remainingMs) return { ...localResult, status: 'time-limit' };
  options.onProgress({
    phase: 'mixed-transition', algorithmStage: 'genetic', iterations: localResult.iterations || 0,
    bestObjective: localResult.objective, objectiveBreakdown: localResult.objectiveBreakdown,
    initialObjective: localResult.initialObjective, stageElapsedMs: 0,
  });
  const geneticStarted = Date.now();
  const geneticResult = await runGeneticOptimization(timetable, {
    ...options,
    timeLimitMs: remainingMs,
    initialAssignments: localResult.assignments,
    onProgress: progress => options.onProgress({
      ...progress,
      iterations: (localResult.iterations || 0) + (progress.iterations || 0),
      initialObjective: localResult.initialObjective ?? progress.initialObjective,
      algorithmStage: 'genetic',
      stageElapsedMs: Date.now() - geneticStarted,
    }),
  });
  const classicObjective = localResult.objective;
  const geneticIsBetter = Number.isFinite(geneticResult.objective)
    && (!Number.isFinite(classicObjective) || geneticResult.objective <= classicObjective);
  const selected = geneticIsBetter ? geneticResult : localResult;
  return {
    ...selected,
    status: geneticResult.status,
    iterations: (localResult.iterations || 0) + (geneticResult.iterations || 0),
    initialObjective: localResult.initialObjective ?? geneticResult.initialObjective,
    reason: selected.reason ?? geneticResult.reason,
    algorithmStage: 'genetic',
  };
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
    const runner = options.algorithm === 'genetic' ? runGeneticOptimization
      : options.algorithm === 'mixed' ? runMixedOptimization : runLocalOptimization;
    const result = await runner(timetable, { ...options, signal: controller.signal });
    return timedOut && result.status === 'cancelled' ? { ...result, status: 'time-limit' } : result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
