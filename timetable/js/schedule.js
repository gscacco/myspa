const RESOURCE_FIELDS = Object.freeze([
  ['teacher', 'teacherIds', 'teachers'],
  ['class', 'classIds', 'classes'],
  ['room', 'roomIds', 'rooms'],
]);

function entityMaps(timetable) {
  const result = {};
  for (const collection of ['teachers', 'classes', 'rooms', 'subjects']) {
    result[collection] = new Map((timetable.entities?.[collection] || []).map(entity => [entity.id, entity]));
  }
  return result;
}

function issue(code, severity, fields) {
  return { code, severity, ...fields };
}

/** Read-only direct schedule analysis for timetable consultation. */
export function analyzeSchedule(timetable) {
  const issues = [];
  const maps = entityMaps(timetable);
  const occupancy = new Map();

  for (const lesson of timetable.lessons || []) {
    if (!lesson.assignedTime) {
      issues.push(issue('unassigned-lesson', 'warning', { lessonIds: [lesson.id], message: 'Lesson has no assigned time.' }));
      continue;
    }
    const { dayIndex, periodIndex } = lesson.assignedTime;
    for (let offset = 0; offset < lesson.durationPeriods; offset++) {
      const period = periodIndex + offset;
      const sourceSlot = `${dayIndex}.${period}`;
      for (const [resourceType, field] of RESOURCE_FIELDS) {
        for (const resourceId of new Set(lesson[field] || [])) {
          const collection = resourceType === 'teacher' ? 'teachers' : resourceType === 'class' ? 'classes' : 'rooms';
          const entity = maps[collection].get(resourceId);
          if (resourceType === 'class' && entity?.placeholder === 'unknown') {
            if (entity.constraints?.timeframes?.unavailable?.includes(sourceSlot)) {
              issues.push(issue('unavailable-time', 'error', {
                resourceType, resourceId, resourceName: entity.name, dayIndex, periodIndex: period,
                lessonIds: [lesson.id], message: 'Lesson is assigned during an unavailable slot.',
              }));
            }
            continue;
          }
          const key = `${resourceType}|${resourceId}|${dayIndex}|${period}`;
          let occupant = occupancy.get(key);
          if (!occupant) {
            occupant = { resourceType, resourceId, dayIndex, periodIndex: period, lessonIds: new Set() };
            occupancy.set(key, occupant);
          }
          occupant.lessonIds.add(lesson.id);

          if (entity?.constraints?.timeframes?.unavailable?.includes(sourceSlot)) {
            issues.push(issue('unavailable-time', 'error', {
              resourceType, resourceId, resourceName: entity.name, dayIndex, periodIndex: period,
              lessonIds: [lesson.id], message: 'Lesson is assigned during an unavailable slot.',
            }));
          }
        }
      }
      if (lesson.timeframes?.unavailable?.includes(sourceSlot)) {
        issues.push(issue('unavailable-time', 'error', {
          resourceType: 'lesson', resourceId: lesson.id, resourceName: lesson.id, dayIndex, periodIndex: period,
          lessonIds: [lesson.id], message: 'Lesson is assigned during its unavailable slot.',
        }));
      }
    }
    const startSlot = `${dayIndex}.${periodIndex}`;
    const preferenceScopes = [
      ...RESOURCE_FIELDS.flatMap(([resourceType, field]) => {
        const collection = resourceType === 'teacher' ? 'teachers' : resourceType === 'class' ? 'classes' : 'rooms';
        return (lesson[field] || []).map(resourceId => ({ entity: maps[collection].get(resourceId), resourceType, resourceId }));
      }),
      { entity: { id: lesson.id, name: lesson.id, constraints: { timeframes: lesson.timeframes } }, resourceType: 'lesson', resourceId: lesson.id },
    ];
    for (const { entity, resourceType, resourceId } of preferenceScopes) {
      if (entity?.constraints?.timeframes?.undesired?.includes(startSlot)) {
        issues.push(issue('soft-preference', 'warning', {
          resourceType, resourceId, resourceName: entity.name, dayIndex, periodIndex,
          lessonIds: [lesson.id], message: 'Lesson uses a time marked as undesired.',
        }));
      }
    }
  }

  for (const occupant of occupancy.values()) {
    const lessonIds = [...occupant.lessonIds].sort();
    if (lessonIds.length < 2) continue;
    const collection = occupant.resourceType === 'teacher' ? 'teachers' : occupant.resourceType === 'class' ? 'classes' : 'rooms';
    const entity = maps[collection].get(occupant.resourceId);
    issues.push(issue('resource-collision', 'error', {
      ...occupant,
      resourceName: entity?.name || occupant.resourceId,
      lessonIds,
      message: 'Multiple lessons use the same resource at the same time.',
    }));
  }

  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => (a.dayIndex ?? Number.MAX_SAFE_INTEGER) - (b.dayIndex ?? Number.MAX_SAFE_INTEGER)
    || (a.periodIndex ?? Number.MAX_SAFE_INTEGER) - (b.periodIndex ?? Number.MAX_SAFE_INTEGER)
    || severityOrder[a.severity] - severityOrder[b.severity]
    || a.code.localeCompare(b.code)
    || String(a.resourceName || a.lessonIds[0]).localeCompare(String(b.resourceName || b.lessonIds[0])));

  return {
    issues,
    summary: {
      hardConflicts: issues.filter(item => item.severity === 'error').length,
      softWarnings: issues.filter(item => item.code === 'soft-preference').length,
      unassignedLessons: issues.filter(item => item.code === 'unassigned-lesson').length,
    },
  };
}
