import { OPTIMIZATION_WEIGHTS } from './solver.js';
import { optimizationScope } from './optimization-scope.js';

function resources(lesson) {
  return new Set([...(lesson.teacherIds || []), ...(lesson.classIds || [])]);
}

function constraintSlots(lesson, resourceIds, resourceEntities) {
  const scoped = resourceIds.map(id => resourceEntities.get(id)).filter(Boolean);
  return {
    unavailable: new Set(scoped.flatMap(entity => entity.constraints?.timeframes?.unavailable || [])),
    undesired: new Set(scoped.flatMap(entity => entity.constraints?.timeframes?.undesired || [])),
  };
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}

function bitCount32(value) {
  value >>>= 0;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function buildDomains(timetable, resourceIdsByLesson, resourceEntities, seed = null, randomizeOrder = false, candidateOrdering = null) {
  const random = seed == null ? null : seededRandom(seed);
  const slots = timetable.calendar.days.flatMap(day => timetable.calendar.periods.map(period => ({
    dayIndex: day.index, periodIndex: period.index, sourceValue: `${day.index}.${period.index}`,
  })));
  const domains = new Map();
  for (const lesson of timetable.lessons) {
    const restrictions = constraintSlots(lesson, resourceIdsByLesson.get(lesson.id), resourceEntities);
    const domain = slots.filter(time => {
      if (time.periodIndex + lesson.durationPeriods > timetable.calendar.periods.length) return false;
      for (let offset = 0; offset < lesson.durationPeriods; offset++) {
        if (restrictions.unavailable.has(`${time.dayIndex}.${time.periodIndex + offset}`)) return false;
      }
      return true;
    }).map(time => {
      let cost = 0;
      for (let offset = 0; offset < lesson.durationPeriods; offset++) {
        const key = `${time.dayIndex}.${time.periodIndex + offset}`;
        if (restrictions.undesired.has(key)) cost += OPTIMIZATION_WEIGHTS.undesiredSlot;
      }
      return { time, cost, tieBreak: random ? random() : 0 };
    }).sort((left, right) => randomizeOrder ? left.tieBreak - right.tieBreak
      : left.cost - right.cost
        || (random ? left.tieBreak - right.tieBreak : left.time.dayIndex - right.time.dayIndex || left.time.periodIndex - right.time.periodIndex));
    domains.set(lesson.id, domain);
  }
  return domains;
}

/** Finds a complete assignment with bounded randomized restarts; it does not claim global optimality. */
async function recalculateAssignmentsAttempt(timetable, {
  signal,
  onProgress = () => {},
  maxNodes = 250_000,
  seed = null,
  randomizeOrder = false,
  randomizeVariables = false,
  candidateOrdering = null,
  variableOrdering = 'degree',
} = {}) {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) throw new RangeError('maxNodes must be a positive integer.');
  if (!timetable?.lessons?.length) return { status: 'solved', assignments: new Map(), visited: 0, softCost: 0 };
  if (signal?.aborted) return { status: 'cancelled', visited: 0 };

  const startedAt = Date.now();
  const diagnostics = {
    maxDepth: 0,
    backtracks: 0,
    domainFilters: 0,
    domainMaskWordsExamined: 0,
    domainValuesPruned: 0,
    domainWipeouts: 0,
    compatibilityChecks: 0,
    domainBuildMs: 0,
    preprocessingMs: 0,
    searchMs: 0,
  };
  const reportProgress = (assigned = assignments.size) => onProgress({
    visited, total: ordered.length, assigned, maxAssigned: diagnostics.maxDepth,
    diagnostics: { ...diagnostics }, elapsedMs: Date.now() - startedAt,
  });

  const resourceEntities = new Map(['teachers', 'classes', 'rooms'].flatMap(type => timetable.entities[type].map(entity => [entity.id, entity])));
  const resourceDescriptions = new Map([
    ...timetable.entities.teachers.map(entity => [entity.id, { id: entity.id, type: 'teacher', name: entity.name }]),
    ...timetable.entities.classes.map(entity => [entity.id, { id: entity.id, type: 'class', name: entity.name }]),
    ...timetable.entities.rooms.map(entity => [entity.id, { id: entity.id, type: 'room', name: entity.name }]),
  ]);
  const subjectNames = new Map(timetable.entities.subjects.map(entity => [entity.id, entity.name]));
  const resourceIdsByLesson = new Map(timetable.lessons.map(lesson => [lesson.id, [...resources(lesson)]]));
  const effectiveCandidateOrdering = candidateOrdering || (randomizeOrder ? 'random' : 'pressure');
  if (!['random', 'lcv', 'pressure'].includes(effectiveCandidateOrdering)) throw new RangeError('candidateOrdering must be random, lcv, or pressure.');
  if (!['degree', 'domain-loss'].includes(variableOrdering)) throw new RangeError('variableOrdering must be degree or domain-loss.');
  const preprocessingStarted = Date.now();
  const domains = buildDomains(timetable, resourceIdsByLesson, resourceEntities, seed, randomizeOrder, effectiveCandidateOrdering);
  diagnostics.domainBuildMs = Date.now() - preprocessingStarted;
  const emptyDomainLesson = timetable.lessons.find(lesson => domains.get(lesson.id).length === 0);
  if (emptyDomainLesson) {
    const subject = timetable.entities.subjects.find(item => item.id === emptyDomainLesson.subjectId);
    return {
      status: 'unsatisfiable', visited: 0,
      reason: { type: 'empty-domain', lessonName: subject?.name || 'Una lezione' },
    };
  }
  const lessonsById = new Map(timetable.lessons.map(lesson => [lesson.id, lesson]));
  const degree = new Map(timetable.lessons.map(lesson => [lesson.id, 0]));
  const resourceMembers = new Map();
  for (const lesson of timetable.lessons) for (const id of resourceIdsByLesson.get(lesson.id)) {
    if (!resourceMembers.has(id)) resourceMembers.set(id, []);
    resourceMembers.get(id).push(lesson.id);
  }
  const periodCount = timetable.calendar.periods.length;
  const calendarCapacity = timetable.calendar.days.length * periodCount;
  for (const [resourceId, lessonIds] of resourceMembers) {
    const entity = resourceEntities.get(resourceId);
    const unavailable = new Set(entity?.constraints?.timeframes?.unavailable || []);
    const demand = lessonIds.reduce((sum, id) => sum + lessonsById.get(id).durationPeriods, 0);
    const capacity = calendarCapacity - unavailable.size;
    if (demand > capacity) return {
      status: 'unsatisfiable', visited: 0,
      reason: { type: 'resource-capacity', resourceName: entity?.name || resourceId, demand, capacity },
    };
  }
  if (candidateOrdering === 'pressure' || (!randomizeOrder && candidateOrdering == null)) {
    const pressureByResource = new Map([...resourceMembers.keys()].map(id => [id, new Uint32Array(calendarCapacity)]));
    const ownPressureByLesson = new Map();
    for (const lesson of timetable.lessons) {
      const ownPressure = new Map();
      for (const resourceId of resourceIdsByLesson.get(lesson.id)) {
        const counts = new Uint32Array(calendarCapacity);
        for (const candidate of domains.get(lesson.id)) for (let offset = 0; offset < lesson.durationPeriods; offset++) {
          const slot = candidate.time.dayIndex * periodCount + candidate.time.periodIndex + offset;
          counts[slot]++;
        }
        ownPressure.set(resourceId, counts);
        const total = pressureByResource.get(resourceId);
        for (let slot = 0; slot < calendarCapacity; slot++) total[slot] += counts[slot];
      }
      ownPressureByLesson.set(lesson.id, ownPressure);
    }
    for (const lesson of timetable.lessons) {
      const ownPressure = ownPressureByLesson.get(lesson.id);
      const candidates = domains.get(lesson.id);
      for (const candidate of candidates) {
        let pressure = 0;
        for (const resourceId of resourceIdsByLesson.get(lesson.id)) {
          const total = pressureByResource.get(resourceId);
          const own = ownPressure.get(resourceId);
          for (let offset = 0; offset < lesson.durationPeriods; offset++) {
            const slot = candidate.time.dayIndex * periodCount + candidate.time.periodIndex + offset;
            pressure += total[slot] - own[slot];
          }
        }
        candidate.pressure = pressure;
      }
      candidates.sort((left, right) => left.pressure - right.pressure || left.cost - right.cost
        || left.tieBreak - right.tieBreak
        || left.time.dayIndex - right.time.dayIndex || left.time.periodIndex - right.time.periodIndex);
    }
  }
  for (const members of resourceMembers.values()) for (const id of members) degree.set(id, degree.get(id) + members.length - 1);
  const ordered = [...timetable.lessons].sort((a, b) => degree.get(b.id) - degree.get(a.id)
    || a.id.localeCompare(b.id));
  const selectorRandom = seededRandom(seed == null ? 1 : seed ^ 0x85ebca6b);
  const selectionTieBreak = new Map(ordered.map(lesson => [lesson.id, selectorRandom()]));
  const neighborsByLesson = new Map(ordered.map(lesson => {
    const neighbors = new Set();
    for (const resourceId of resourceIdsByLesson.get(lesson.id)) {
      for (const neighborId of resourceMembers.get(resourceId) || []) neighbors.add(neighborId);
    }
    neighbors.delete(lesson.id);
    return [lesson.id, [...neighbors]];
  }));
  const liveDegree = new Map(ordered.map(lesson => [lesson.id, neighborsByLesson.get(lesson.id).length]));
  const assignments = new Map();
  const domainStateByLesson = new Map();
  let maxDomainSize = 0;
  for (const lesson of ordered) {
    const candidates = domains.get(lesson.id);
    const wordCount = Math.ceil(candidates.length / 32);
    const availableMask = new Uint32Array(wordCount);
    availableMask.fill(0xffffffff);
    if (candidates.length % 32) availableMask[wordCount - 1] = (2 ** (candidates.length % 32) - 1) >>> 0;
    const conflictMasksBySlot = Array.from({ length: calendarCapacity }, () => new Uint32Array(wordCount));
    candidates.forEach((candidate, candidateIndex) => {
      const wordIndex = candidateIndex >>> 5;
      const candidateBit = 1 << (candidateIndex & 31);
      for (let offset = 0; offset < lesson.durationPeriods; offset++) {
        const slot = candidate.time.dayIndex * periodCount + candidate.time.periodIndex + offset;
        conflictMasksBySlot[slot][wordIndex] |= candidateBit;
      }
    });
    domainStateByLesson.set(lesson.id, { availableMask, availableCount: candidates.length, conflictMasksBySlot });
    maxDomainSize = Math.max(maxDomainSize, candidates.length);
  }
  const domainBuckets = Array.from({ length: maxDomainSize + 1 }, () => new Set());
  function addToBucket(lessonId, size) { domainBuckets[size].add(lessonId); }
  function removeFromBucket(lessonId, size) { domainBuckets[size].delete(lessonId); }
  for (const lesson of ordered) addToBucket(lesson.id, domains.get(lesson.id).length);
  diagnostics.preprocessingMs = Date.now() - preprocessingStarted - diagnostics.domainBuildMs;
  let visited = 0, cancelled = false, limitReached = false, softCost = 0;
  let diagnosticPartial = null;
  const wipeoutCauses = new Map();

  function captureDiagnosticPartial(preferDeadEnd = false) {
    if (diagnosticPartial && assignments.size < diagnosticPartial.assignedCount) return;
    if (diagnosticPartial && assignments.size === diagnosticPartial.assignedCount && !preferDeadEnd) return;
    const remaining = [];
    const domainHistogram = {};
    for (const lesson of ordered) {
      if (assignments.has(lesson.id)) continue;
      const remainingDomainSize = domainStateByLesson.get(lesson.id).availableCount;
      domainHistogram[remainingDomainSize] = (domainHistogram[remainingDomainSize] || 0) + 1;
      remaining.push({ lesson, remainingDomainSize });
    }
    const smallestDomains = [...remaining]
      .sort((left, right) => left.remainingDomainSize - right.remainingDomainSize || left.lesson.id.localeCompare(right.lesson.id))
      .slice(0, 30)
      .map(({ lesson, remainingDomainSize }) => ({
        lessonId: lesson.id,
        subject: subjectNames.get(lesson.subjectId) || lesson.subjectId,
        teachers: (lesson.teacherIds || []).map(id => resourceEntities.get(id)?.name || id),
        classes: (lesson.classIds || []).map(id => resourceEntities.get(id)?.name || id),
        rooms: (lesson.roomIds || []).map(id => resourceEntities.get(id)?.name || id),
        durationPeriods: lesson.durationPeriods,
        remainingDomainSize,
      }));
    const zeroDomainCount = domainHistogram[0] || 0;
    if (diagnosticPartial && assignments.size === diagnosticPartial.assignedCount
      && zeroDomainCount <= diagnosticPartial.zeroDomainCount) return;
    diagnosticPartial = {
      assignedCount: assignments.size,
      assignments: new Map(assignments),
      unassignedCount: remaining.length,
      zeroDomainCount,
      remainingDomainHistogram: domainHistogram,
      smallestRemainingDomains: smallestDomains,
    };
  }

  function recordWipeout(blockingLesson, blockedLessonId, time) {
    const commonResourceIds = resourceIdsByLesson.get(blockingLesson.id)
      .filter(id => resourceIdsByLesson.get(blockedLessonId).includes(id))
      .sort();
    const key = `${blockingLesson.id}|${blockedLessonId}|${commonResourceIds.join(',')}|${time.dayIndex}.${time.periodIndex}`;
    let cause = wipeoutCauses.get(key);
    if (!cause) {
      cause = {
        blockingLessonId: blockingLesson.id,
        blockedLessonId,
        blockingTime: { dayIndex: time.dayIndex, periodIndex: time.periodIndex },
        sharedResources: commonResourceIds.map(id => resourceDescriptions.get(id) || { id, type: 'resource', name: id }),
        count: 0,
      };
      wipeoutCauses.set(key, cause);
    }
    cause.count++;
  }

  function candidateIndicesInLeastConstrainingOrder(lesson, state, candidates) {
    if (effectiveCandidateOrdering !== 'lcv') return null;
    const periodCount = timetable.calendar.periods.length;
    const neighborIds = neighborsByLesson.get(lesson.id).filter(id => !assignments.has(id));
    const impactByCandidate = new Map();
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      if (!(state.availableMask[candidateIndex >>> 5] & (1 << (candidateIndex & 31)))) continue;
      const candidate = candidates[candidateIndex];
      const occupiedSlots = Array.from({ length: lesson.durationPeriods }, (_, offset) =>
        candidate.time.dayIndex * periodCount + candidate.time.periodIndex + offset);
      let impact = 0;
      for (const neighborId of neighborIds) {
        const neighborState = domainStateByLesson.get(neighborId);
        for (let wordIndex = 0; wordIndex < neighborState.availableMask.length; wordIndex++) {
          let blocked = 0;
          for (const slot of occupiedSlots) blocked |= neighborState.conflictMasksBySlot[slot][wordIndex];
          impact += bitCount32(neighborState.availableMask[wordIndex] & blocked);
        }
      }
      impactByCandidate.set(candidateIndex, impact);
    }
    return [...impactByCandidate.keys()].sort((left, right) => impactByCandidate.get(left) - impactByCandidate.get(right)
      || Number(candidates[right].preferred) - Number(candidates[left].preferred)
      || candidates[left].cost - candidates[right].cost
      || candidates[left].tieBreak - candidates[right].tieBreak);
  }

  async function visit() {
    diagnostics.maxDepth = Math.max(diagnostics.maxDepth, assignments.size);
    captureDiagnosticPartial();
    if (assignments.size === ordered.length) return true;
    if (signal?.aborted) { cancelled = true; return false; }

    // Pick the smallest nonempty domain from size buckets instead of rescanning
    // all remaining lessons at every search node.
    let selectedLesson = null;
    let selectedDomain = null;
    for (let size = 0; size < domainBuckets.length; size++) {
      const bucket = domainBuckets[size];
      if (!bucket.size) continue;
      if (size === 0) return false;
      let bestLiveDegree = -1;
      let bestStaticDegree = -1;
      let bestTieBreak = -1;
      let bestRandomizedScore = -Infinity;
      let bestDomainLoss = -Infinity;
      for (const lessonId of bucket) {
        const currentLiveDegree = liveDegree.get(lessonId);
        const currentStaticDegree = degree.get(lessonId);
        const currentTieBreak = selectionTieBreak.get(lessonId);
        let domainLoss = 0;
        if (variableOrdering === 'domain-loss') {
          const state = domainStateByLesson.get(lessonId);
          const initialDomainSize = domains.get(lessonId).length;
          domainLoss = initialDomainSize ? (initialDomainSize - state.availableCount) / initialDomainSize : 0;
        }
        const randomizedScore = currentLiveDegree * (0.5 + selectorRandom()) + currentStaticDegree * 0.05;
        if ((variableOrdering === 'domain-loss' && (domainLoss > bestDomainLoss
          || (domainLoss === bestDomainLoss && currentLiveDegree > bestLiveDegree)
          || (domainLoss === bestDomainLoss && currentLiveDegree === bestLiveDegree && currentTieBreak > bestTieBreak)))
          || (variableOrdering === 'degree' && randomizeVariables && randomizedScore > bestRandomizedScore)
          || (variableOrdering === 'degree' && !randomizeVariables && (currentLiveDegree > bestLiveDegree
          || (currentLiveDegree === bestLiveDegree && currentStaticDegree > bestStaticDegree)
          || (currentLiveDegree === bestLiveDegree && currentStaticDegree === bestStaticDegree && currentTieBreak > bestTieBreak)))) {
          selectedLesson = lessonsById.get(lessonId);
          bestLiveDegree = currentLiveDegree;
          bestStaticDegree = currentStaticDegree;
          bestTieBreak = currentTieBreak;
          bestRandomizedScore = randomizedScore;
          bestDomainLoss = domainLoss;
        }
      }
      selectedDomain = domains.get(selectedLesson.id);
      break;
    }
    if (!selectedLesson) return assignments.size === ordered.length;

    const selectedState = domainStateByLesson.get(selectedLesson.id);
    removeFromBucket(selectedLesson.id, selectedState.availableCount);
    const candidateIndices = candidateIndicesInLeastConstrainingOrder(selectedLesson, selectedState, selectedDomain);
    for (let choiceIndex = 0; choiceIndex < (candidateIndices?.length ?? selectedDomain.length); choiceIndex++) {
      const candidateIndex = candidateIndices ? candidateIndices[choiceIndex] : choiceIndex;
      const candidateBit = 1 << (candidateIndex & 31);
      if ((selectedState.availableMask[candidateIndex >>> 5] & candidateBit) === 0) continue;
      const candidate = selectedDomain[candidateIndex];
      if (signal?.aborted) { cancelled = true; addToBucket(selectedLesson.id, selectedState.availableCount); return false; }
      if (visited >= maxNodes) { limitReached = true; addToBucket(selectedLesson.id, selectedState.availableCount); return false; }
      visited++;
      if (visited % 128 === 0) {
        reportProgress();
        await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) { cancelled = true; addToBucket(selectedLesson.id, selectedState.availableCount); return false; }
      }
      assignments.set(selectedLesson.id, candidate.time);
      // Count an assignment even if forward checking detects the dead end before visit().
      diagnostics.maxDepth = Math.max(diagnostics.maxDepth, assignments.size);
      const reducedDegrees = [];
      for (const neighborId of neighborsByLesson.get(selectedLesson.id)) {
        if (assignments.has(neighborId)) continue;
        reducedDegrees.push(neighborId);
        liveDegree.set(neighborId, liveDegree.get(neighborId) - 1);
      }
      const changedDomains = [];
      let possible = true;
      const occupiedSlots = [];
      for (let offset = 0; offset < selectedLesson.durationPeriods; offset++) {
        occupiedSlots.push(candidate.time.dayIndex * periodCount + candidate.time.periodIndex + offset);
      }
      for (const neighborId of neighborsByLesson.get(selectedLesson.id)) {
        if (assignments.has(neighborId)) continue;
        const neighborState = domainStateByLesson.get(neighborId);
        const oldMask = neighborState.availableMask;
        let nextMask = null;
        let nextCount = 0;
        diagnostics.domainFilters++;
        for (let wordIndex = 0; wordIndex < oldMask.length; wordIndex++) {
          diagnostics.domainMaskWordsExamined++;
          let blocked = 0;
          for (const slot of occupiedSlots) {
            blocked |= neighborState.conflictMasksBySlot[slot][wordIndex];
            diagnostics.compatibilityChecks++;
          }
          const nextWord = (oldMask[wordIndex] & ~blocked) >>> 0;
          nextCount += bitCount32(nextWord);
          if (nextWord !== oldMask[wordIndex]) {
            if (!nextMask) nextMask = oldMask.slice();
            nextMask[wordIndex] = nextWord;
          }
        }
        if (nextMask) {
          diagnostics.domainValuesPruned += neighborState.availableCount - nextCount;
          changedDomains.push([neighborId, oldMask, neighborState.availableCount]);
          removeFromBucket(neighborId, neighborState.availableCount);
          neighborState.availableMask = nextMask;
          neighborState.availableCount = nextCount;
          addToBucket(neighborId, nextCount);
        }
        if (!nextCount) {
          diagnostics.domainWipeouts++;
          recordWipeout(selectedLesson, neighborId, candidate.time);
          possible = false;
          break;
        }
      }
      if (!possible) captureDiagnosticPartial(true);
      softCost += candidate.cost;
      const solved = possible && await visit();
      if (solved) return true;
      diagnostics.backtracks++;
      softCost -= candidate.cost;
      assignments.delete(selectedLesson.id);
      for (const neighborId of reducedDegrees) liveDegree.set(neighborId, liveDegree.get(neighborId) + 1);
      for (let index = changedDomains.length - 1; index >= 0; index--) {
        const [lessonId, mask, count] = changedDomains[index];
        const state = domainStateByLesson.get(lessonId);
        removeFromBucket(lessonId, state.availableCount);
        state.availableMask = mask;
        state.availableCount = count;
        addToBucket(lessonId, count);
      }
      if (cancelled || limitReached) {
        addToBucket(selectedLesson.id, selectedState.availableCount);
        return false;
      }
    }
    addToBucket(selectedLesson.id, selectedState.availableCount);
    return false;
  }

  const solved = await visit();
  diagnostics.searchMs = Date.now() - startedAt - diagnostics.domainBuildMs - diagnostics.preprocessingMs;
  reportProgress(solved ? ordered.length : assignments.size);
  const resultDiagnostics = { ...diagnostics, elapsedMs: Date.now() - startedAt };
  const failures = [...wipeoutCauses.values()].sort((left, right) => right.count - left.count
    || left.blockingLessonId.localeCompare(right.blockingLessonId)
    || left.blockedLessonId.localeCompare(right.blockedLessonId));
  if (solved) return { status: 'solved', assignments: new Map(assignments), visited, softCost, diagnostics: resultDiagnostics };
  return {
    status: cancelled ? 'cancelled' : limitReached ? 'limit' : 'unsatisfiable',
    visited, diagnostics: resultDiagnostics, diagnosticPartial, wipeoutCauses: failures,
  };
}

export async function recalculateAssignments(timetable, options = {}) {
  const { timetable: scopedTimetable, excludedLessons } = optimizationScope(timetable);
  const {
    maxNodes = 250_000,
    restartAfterNodes = 50_000,
    maxRestarts = 8,
    seed = null,
    randomizeOrder = false,
    randomizeVariables = false,
    signal,
    onProgress = () => {},
  } = options;
  if (!Number.isInteger(maxNodes) || maxNodes < 1) throw new RangeError('maxNodes must be a positive integer.');
  if (!Number.isInteger(restartAfterNodes) || restartAfterNodes < 1) throw new RangeError('restartAfterNodes must be a positive integer.');
  if (!Number.isInteger(maxRestarts) || maxRestarts < 0) throw new RangeError('maxRestarts must be a non-negative integer.');
  if (!scopedTimetable.lessons.length) return {
    status: 'solved', assignments: new Map(), visited: 0, softCost: 0,
    activeLessonCount: 0, excludedLessonCount: excludedLessons.length,
  };

  const startedAt = Date.now();
  const aggregate = {
    maxDepth: 0,
    backtracks: 0,
    domainFilters: 0,
    domainMaskWordsExamined: 0,
    domainValuesPruned: 0,
    domainWipeouts: 0,
    compatibilityChecks: 0,
    domainBuildMs: 0,
    preprocessingMs: 0,
    searchMs: 0,
  };
  let totalVisited = 0;
  let restart = 0;
  let lastResult = null;
  let deepestPartial = null;
  const aggregateWipeouts = new Map();
  while (restart <= maxRestarts && totalVisited < maxNodes) {
    const attemptNodes = Math.min(restartAfterNodes, maxNodes - totalVisited);
    const attemptSeed = seed == null
      ? (restart === 0 ? null : (Date.now() ^ Math.imul(restart, 0x9e3779b9)) >>> 0)
      : (seed + Math.imul(restart, 0x9e3779b9)) >>> 0;
    const attempt = await recalculateAssignmentsAttempt(scopedTimetable, {
      ...options,
      signal,
      maxNodes: attemptNodes,
      seed: attemptSeed,
      randomizeOrder,
      randomizeVariables,
      onProgress: progress => {
        const attemptStats = progress.diagnostics || {};
        const combinedDiagnostics = { ...aggregate };
        for (const key of Object.keys(combinedDiagnostics)) {
          if (key === 'maxDepth') combinedDiagnostics[key] = Math.max(combinedDiagnostics[key], attemptStats[key] || 0);
          else combinedDiagnostics[key] += attemptStats[key] || 0;
        }
        onProgress({
          ...progress,
          visited: totalVisited + progress.visited,
          maxAssigned: Math.max(aggregate.maxDepth, progress.maxAssigned || 0),
          restart,
          attempt: restart + 1,
          diagnostics: combinedDiagnostics,
          elapsedMs: Date.now() - startedAt,
        });
      },
    });
    lastResult = attempt;
    if (attempt.diagnosticPartial && (!deepestPartial || attempt.diagnosticPartial.assignedCount > deepestPartial.assignedCount)) {
      deepestPartial = { ...attempt.diagnosticPartial, restart: restart + 1 };
    }
    for (const cause of attempt.wipeoutCauses || []) {
      const key = `${cause.blockingLessonId}|${cause.blockedLessonId}|${cause.sharedResources.map(item => item.id).join(',')}|${cause.blockingTime.dayIndex}.${cause.blockingTime.periodIndex}`;
      const existing = aggregateWipeouts.get(key);
      if (existing) existing.count += cause.count;
      else aggregateWipeouts.set(key, { ...cause, sharedResources: cause.sharedResources.map(item => ({ ...item })) });
    }
    totalVisited += attempt.visited || 0;
    for (const key of Object.keys(aggregate)) {
      if (key === 'maxDepth') aggregate[key] = Math.max(aggregate[key], attempt.diagnostics?.[key] || 0);
      else aggregate[key] += attempt.diagnostics?.[key] || 0;
    }
    if (attempt.status !== 'limit') break;
    if (totalVisited >= maxNodes || restart >= maxRestarts) break;
    restart++;
  }
  const diagnostics = { ...aggregate, elapsedMs: Date.now() - startedAt, restarts: restart };
  const failureCauses = [...aggregateWipeouts.values()].sort((left, right) => right.count - left.count
    || left.blockingLessonId.localeCompare(right.blockingLessonId)
    || left.blockedLessonId.localeCompare(right.blockedLessonId)).slice(0, 50);
  return {
    ...lastResult,
    status: lastResult?.status === 'limit' ? 'limit' : lastResult?.status,
    visited: totalVisited,
    diagnostics,
    diagnosticPartial: deepestPartial,
    failureCauses,
    activeLessonCount: scopedTimetable.lessons.length,
    excludedLessonCount: excludedLessons.length,
  };
}
