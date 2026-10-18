/** Activities without a real class remain in the model but are outside schedule optimization. */

export function optimizationScope(timetable) {
  const unknownClassIds = new Set((timetable?.entities?.classes || [])
    .filter(entity => entity.placeholder === 'unknown')
    .map(entity => entity.id));
  const allLessons = Array.isArray(timetable?.lessons) ? timetable.lessons : [];
  const optimizableLessons = [];
  const excludedLessons = [];
  for (const lesson of allLessons) {
    const excluded = (lesson.classIds || []).some(id => unknownClassIds.has(id));
    (excluded ? excludedLessons : optimizableLessons).push(lesson);
  }
  return {
    timetable: { ...timetable, lessons: optimizableLessons },
    optimizableLessons,
    excludedLessons,
  };
}

export function isOptimizableLesson(timetable, lesson) {
  const unknownClassIds = new Set((timetable?.entities?.classes || [])
    .filter(entity => entity.placeholder === 'unknown')
    .map(entity => entity.id));
  return !(lesson?.classIds || []).some(id => unknownClassIds.has(id));
}
