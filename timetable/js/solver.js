import { analyzeSchedule } from './schedule.js';

const RESOURCE_FIELDS = Object.freeze([
  ['teacherIds', 'teachers'], ['classIds', 'classes'], ['roomIds', 'rooms'],
]);
export const OPTIMIZATION_WEIGHTS = Object.freeze({ undesiredSlot: 100, movedLesson: 1 });

function clone(value) {
  return structuredClone(value);
}

function withAssignments(timetable, assignments) {
  const candidate = clone(timetable);
  for (const lesson of candidate.lessons) {
    if (assignments.has(lesson.id)) lesson.assignedTime = clone(assignments.get(lesson.id));
  }
  return candidate;
}

function issueKey(item) {
  return [item.code, item.resourceType, item.resourceId, item.dayIndex, item.periodIndex, [...item.lessonIds].sort().join(',')].join('|');
}

function assignmentIssues(timetable, lesson, time, assignments) {
  const issues = [];
  const entities = new Map();
  for (const collection of ['teachers', 'classes', 'rooms']) {
    for (const entity of timetable.entities?.[collection] || []) entities.set(entity.id, entity);
  }
  const lessonSlots = [];
  for (let offset = 0; offset < lesson.durationPeriods; offset++) lessonSlots.push(time.periodIndex + offset);
  for (const periodIndex of lessonSlots) {
    const slot = `${time.dayIndex}.${periodIndex}`;
    if (lesson.timeframes?.unavailable?.includes(slot)) {
      issues.push({ code: 'unavailable-time', resourceType: 'lesson', resourceId: lesson.id, resourceName: lesson.id, dayIndex: time.dayIndex, periodIndex, lessonIds: [lesson.id] });
    }
    for (const [field, collection] of RESOURCE_FIELDS) {
      for (const id of new Set(lesson[field] || [])) {
        const entity = entities.get(id);
        if (entity?.constraints?.timeframes?.unavailable?.includes(slot)) {
          issues.push({ code: 'unavailable-time', resourceType: collection.slice(0, -1), resourceId: id, resourceName: entity.name, dayIndex: time.dayIndex, periodIndex, lessonIds: [lesson.id] });
        }
      }
    }
  }

  for (const other of timetable.lessons) {
    if (other.id === lesson.id) continue;
    const otherTime = assignments.get(other.id);
    if (!otherTime || otherTime.dayIndex !== time.dayIndex) continue;
    const overlaps = lessonSlots.some(period => period >= otherTime.periodIndex && period < otherTime.periodIndex + other.durationPeriods);
    if (!overlaps) continue;
    for (const [field, collection] of RESOURCE_FIELDS) {
      const otherIds = new Set(other[field] || []);
      for (const id of new Set(lesson[field] || [])) {
        if (!otherIds.has(id)) continue;
        const entity = entities.get(id);
        const periodIndex = Math.max(time.periodIndex, otherTime.periodIndex);
        issues.push({
          code: 'resource-collision', resourceType: collection.slice(0, -1), resourceId: id,
          resourceName: entity?.name || id, dayIndex: time.dayIndex, periodIndex,
          lessonIds: [lesson.id, other.id].sort(),
        });
      }
    }
  }
  const unique = new Map(issues.map(item => [issueKey(item), item]));
  return [...unique.values()];
}

function affectedIssues(timetable, assignments, moved) {
  const unique = new Map();
  for (const id of moved) {
    const lesson = timetable.lessons.find(item => item.id === id);
    const time = assignments.get(id);
    if (!lesson || !time) continue;
    for (const item of assignmentIssues(timetable, lesson, time, assignments)) unique.set(issueKey(item), item);
  }
  return [...unique.values()];
}

function assignedTime(dayIndex, periodIndex) {
  return { dayIndex, periodIndex, sourceValue: `${dayIndex}.${periodIndex}` };
}

function sameTime(left, right) {
  return left?.dayIndex === right?.dayIndex && left?.periodIndex === right?.periodIndex;
}

function softViolations(timetable) {
  const entities = new Map();
  for (const collection of ['teachers', 'classes', 'rooms']) {
    for (const entity of timetable.entities?.[collection] || []) entities.set(entity.id, entity);
  }
  let count = 0;
  for (const lesson of timetable.lessons || []) {
    if (!lesson.assignedTime) continue;
    for (let offset = 0; offset < lesson.durationPeriods; offset++) {
      const slot = `${lesson.assignedTime.dayIndex}.${lesson.assignedTime.periodIndex + offset}`;
      const resourceIds = new Set(RESOURCE_FIELDS.flatMap(([field]) => lesson[field] || []));
      const scopes = [lesson, ...[...resourceIds].map(id => entities.get(id))];
      for (const scope of scopes) {
        const undesired = scope?.constraints?.timeframes?.undesired || scope?.timeframes?.undesired || [];
        if (undesired.includes(slot)) count++;
      }
    }
  }
  return count;
}

function assignmentsFor(timetable) {
  return new Map(timetable.lessons.map(lesson => [lesson.id, clone(lesson.assignedTime)]));
}

function candidateSlots(timetable, lesson) {
  const slots = [];
  for (const day of timetable.calendar.days) {
    for (const period of timetable.calendar.periods) {
      if (period.index + lesson.durationPeriods <= timetable.calendar.periods.length) {
        slots.push(assignedTime(day.index, period.index));
      }
    }
  }
  return slots;
}

/** Checks the selected lesson's proposed time against direct hard constraints. */
export function validateAssignment(timetable, lessonId, nextTime) {
  const lesson = timetable.lessons.find(item => item.id === lessonId);
  if (!lesson) return { valid: false, issues: [{ code: 'missing-lesson', lessonIds: [lessonId] }] };
  if (!Number.isInteger(nextTime?.dayIndex) || nextTime.dayIndex < 0 || nextTime.dayIndex >= timetable.calendar.days.length
    || !Number.isInteger(nextTime?.periodIndex) || nextTime.periodIndex < 0
    || nextTime.periodIndex + lesson.durationPeriods > timetable.calendar.periods.length) {
    return { valid: false, issues: [{ code: 'invalid-time', lessonIds: [lessonId] }] };
  }
  const time = assignedTime(nextTime.dayIndex, nextTime.periodIndex);
  const assignments = assignmentsFor(timetable);
  assignments.set(lessonId, time);
  const issues = assignmentIssues(timetable, lesson, time, assignments);
  const before = softViolations(timetable);
  const after = softViolations(withAssignments(timetable, assignments));
  return { valid: issues.length === 0, issues, softBefore: before, softAfter: after };
}

/**
 * Searches deterministic, bounded moves. maxMoves includes the selected lesson;
 * maxMoves=1 is immediate validation, 3 is local repair, and 5 allows longer chains.
 */
export async function findAlternatives(timetable, lessonId, {
  maxMoves = 1,
  maxResults = 12,
  maxNodes = 500,
  signal,
  onProgress = () => {},
  onSuggestion = () => {},
} = {}) {
  const target = timetable.lessons.find(item => item.id === lessonId);
  if (!target) return { suggestions: [], cancelled: false, visited: 0, reason: 'missing-lesson' };
  if (!Number.isInteger(maxMoves) || maxMoves < 1) throw new RangeError('maxMoves must be a positive integer.');
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new RangeError('maxResults must be a positive integer.');
  if (!Number.isInteger(maxNodes) || maxNodes < 1) throw new RangeError('maxNodes must be a positive integer.');
  const original = assignmentsFor(timetable);
  const baselineHard = analyzeSchedule(timetable).issues.filter(item => item.severity === 'error');
  const beforeSoft = softViolations(timetable);
  const suggestions = [];
  const seen = new Set();
  let visited = 0;
  let cancelled = false;
  let limitReached = false;

  async function search(state, moved) {
    if (cancelled || suggestions.length >= maxResults || limitReached) return;
    if (signal?.aborted) { cancelled = true; return; }
    const violations = affectedIssues(timetable, state, moved);
    if (!violations.length) {
      if (!moved.has(lessonId)) return;
      const schedule = withAssignments(timetable, state);
      const changes = [...moved]
        .map(id => ({ lessonId: id, assignedTime: clone(state.get(id)) }))
        .sort((a, b) => (a.lessonId === lessonId ? -1 : b.lessonId === lessonId ? 1 : 0)
          || (timetable.lessons.findIndex(item => item.id === a.lessonId) - timetable.lessons.findIndex(item => item.id === b.lessonId)));
      const key = changes.map(item => `${item.lessonId}@${item.assignedTime.dayIndex}.${item.assignedTime.periodIndex}`).join('|');
      if (seen.has(key)) return;
      seen.add(key);
      const afterSoft = softViolations(schedule);
      const suggestion = {
        changes,
        hardValid: true,
        remainingHard: baselineHard.filter(item => !item.lessonIds.some(id => moved.has(id))).length,
        softBefore: beforeSoft,
        softAfter: afterSoft,
        score: afterSoft * OPTIMIZATION_WEIGHTS.undesiredSlot + changes.length * OPTIMIZATION_WEIGHTS.movedLesson,
        rationale: changes.length === 1 ? 'La lezione può essere spostata senza conflitti.' : `Sposta ${changes.length - 1} lezioni coinvolte per liberare questo orario.`,
      };
      suggestions.push(suggestion);
      onSuggestion(suggestion);
      return;
    }

    const issue = violations.find(item => item.lessonIds.some(id => moved.has(id)));
    if (!issue || issue.code !== 'resource-collision') return;
    const blockerId = issue.lessonIds.find(id => !moved.has(id));
    const blocker = timetable.lessons.find(item => item.id === blockerId);
    if (!blocker || moved.size >= maxMoves) return;

    for (const slot of candidateSlots(timetable, blocker)) {
      if (sameTime(slot, state.get(blockerId))) continue;
      visited++;
      onProgress({ visited, suggestions: suggestions.length });
      if (signal?.aborted) { cancelled = true; return; }
      if (visited > maxNodes) { limitReached = true; return; }
      const nextState = new Map(state);
      nextState.set(blockerId, slot);
      const nextMoved = new Set(moved);
      nextMoved.add(blockerId);
      await search(nextState, nextMoved);
      if (cancelled || suggestions.length >= maxResults || limitReached) return;
      if (visited % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Immediate alternatives are attempted first, in calendar order.
  for (const slot of candidateSlots(timetable, target)) {
    if (sameTime(slot, original.get(lessonId))) continue;
    visited++;
    onProgress({ visited, suggestions: suggestions.length });
    if (signal?.aborted) { cancelled = true; break; }
    if (visited > maxNodes) { limitReached = true; break; }
    const state = new Map(original);
    state.set(lessonId, slot);
    await search(state, new Set([lessonId]));
    if (cancelled || suggestions.length >= maxResults || limitReached) break;
    if (visited % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }

  suggestions.sort((a, b) => a.score - b.score || a.changes.length - b.changes.length
    || a.changes[0].assignedTime.dayIndex - b.changes[0].assignedTime.dayIndex
    || a.changes[0].assignedTime.periodIndex - b.changes[0].assignedTime.periodIndex);
  return {
    suggestions,
    cancelled,
    visited,
    limitReached: limitReached || suggestions.length >= maxResults,
    reason: suggestions.length ? null : 'no-feasible-alternative',
  };
}
