import { OPTIMIZATION_WEIGHTS } from './solver.js';

function resources(lesson, unknownClassIds = new Set()) {
  return new Set([...(lesson.teacherIds || []), ...(lesson.classIds || []).filter(id => !unknownClassIds.has(id)), ...(lesson.roomIds || [])]);
}

function constraintSlots(lesson, timetable, unknownClassIds) {
  const ids = resources(lesson, unknownClassIds);
  const entities = [...timetable.entities.teachers, ...timetable.entities.classes, ...timetable.entities.rooms];
  const scoped = entities.filter(entity => ids.has(entity.id));
  return {
    unavailable: new Set([
      ...(lesson.timeframes?.unavailable || []),
      ...scoped.flatMap(entity => entity.constraints?.timeframes?.unavailable || []),
    ]),
    undesired: new Set([
      ...(lesson.timeframes?.undesired || []),
      ...scoped.flatMap(entity => entity.constraints?.timeframes?.undesired || []),
    ]),
  };
}

function slotKey(time) { return `${time.dayIndex}.${time.periodIndex}`; }

function buildDomains(timetable, useSourceHints) {
  const unknownClassIds = new Set(timetable.entities.classes.filter(entity => entity.placeholder === 'unknown').map(entity => entity.id));
  const slots = timetable.calendar.days.flatMap(day => timetable.calendar.periods.map(period => ({
    dayIndex: day.index, periodIndex: period.index, sourceValue: `${day.index}.${period.index}`,
  })));
  const domains = new Map();
  for (const lesson of timetable.lessons) {
    const restrictions = constraintSlots(lesson, timetable, unknownClassIds);
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
      const hint = useSourceHints ? timetable.source?.assignmentHints?.[lesson.id] : null;
      const sourcePreferred = hint?.dayIndex === time.dayIndex && hint?.periodIndex === time.periodIndex;
      return { time, cost, sourcePreferred };
    }).sort((left, right) => Number(right.sourcePreferred) - Number(left.sourcePreferred) || left.cost - right.cost
      || left.time.dayIndex - right.time.dayIndex || left.time.periodIndex - right.time.periodIndex);
    domains.set(lesson.id, domain);
  }
  return domains;
}

/** Finds one complete assignment within a bounded deterministic search; it does not claim global optimality. */
export async function recalculateAssignments(timetable, {
  signal,
  onProgress = () => {},
  maxNodes = 250_000,
  useSourceHints = true,
} = {}) {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) throw new RangeError('maxNodes must be a positive integer.');
  if (!timetable?.lessons?.length) return { status: 'solved', assignments: new Map(), visited: 0, softCost: 0 };
  if (signal?.aborted) return { status: 'cancelled', visited: 0 };

  const domains = buildDomains(timetable, useSourceHints);
  if ([...domains.values()].some(domain => domain.length === 0)) return { status: 'unsatisfiable', visited: 0 };
  const degree = new Map(timetable.lessons.map(lesson => [lesson.id, 0]));
  const unknownClassIds = new Set(timetable.entities.classes.filter(entity => entity.placeholder === 'unknown').map(entity => entity.id));
  const resourceMembers = new Map();
  for (const lesson of timetable.lessons) for (const id of resources(lesson, unknownClassIds)) {
    if (!resourceMembers.has(id)) resourceMembers.set(id, []);
    resourceMembers.get(id).push(lesson.id);
  }
  for (const members of resourceMembers.values()) for (const id of members) degree.set(id, degree.get(id) + members.length - 1);
  const ordered = [...timetable.lessons].sort((a, b) => domains.get(a.id).length - domains.get(b.id).length
    || degree.get(b.id) - degree.get(a.id)
    || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  const assignments = new Map();
  const occupied = new Set();
  let visited = 0, cancelled = false, limitReached = false, softCost = 0;

  function compatible(lesson, time) {
    for (const id of resources(lesson, unknownClassIds)) for (let offset = 0; offset < lesson.durationPeriods; offset++) {
      if (occupied.has(`${id}|${time.dayIndex}.${time.periodIndex + offset}`)) return false;
    }
    return true;
  }

  function occupy(lesson, time, add) {
    for (const id of resources(lesson, unknownClassIds)) for (let offset = 0; offset < lesson.durationPeriods; offset++) {
      const key = `${id}|${time.dayIndex}.${time.periodIndex + offset}`;
      if (add) occupied.add(key); else occupied.delete(key);
    }
  }

  async function visit(index) {
    if (index === ordered.length) return true;
    if (signal?.aborted) { cancelled = true; return false; }
    const lesson = ordered[index];
    for (const candidate of domains.get(lesson.id)) {
      if (signal?.aborted) { cancelled = true; return false; }
      visited++;
      if (visited > maxNodes) { limitReached = true; return false; }
      if (visited % 128 === 0) {
        onProgress({ visited, total: ordered.length, assigned: index });
        await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) { cancelled = true; return false; }
      }
      if (!compatible(lesson, candidate.time)) continue;
      assignments.set(lesson.id, candidate.time);
      occupy(lesson, candidate.time, true);
      softCost += candidate.cost;
      const solved = await visit(index + 1);
      if (solved) return true;
      softCost -= candidate.cost;
      occupy(lesson, candidate.time, false);
      assignments.delete(lesson.id);
      if (cancelled || limitReached) return false;
    }
    return false;
  }

  const solved = await visit(0);
  onProgress({ visited, total: ordered.length, assigned: solved ? ordered.length : assignments.size });
  if (solved) return { status: 'solved', assignments: new Map(assignments), visited, softCost };
  return { status: cancelled ? 'cancelled' : limitReached ? 'limit' : 'unsatisfiable', visited };
}
