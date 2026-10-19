function entityName(timetable, collection, id) {
  return timetable.entities[collection]?.find(item => item.id === id)?.name || '';
}

function lessonNames(timetable, lesson) {
  return {
    subject: entityName(timetable, 'subjects', lesson.subjectId),
    teachers: (lesson.teacherIds || []).map(id => entityName(timetable, 'teachers', id)).filter(Boolean).join(', '),
    classes: (lesson.classIds || []).map(id => entityName(timetable, 'classes', id)).filter(Boolean).join(', '),
    rooms: (lesson.roomIds || []).map(id => entityName(timetable, 'rooms', id)).filter(Boolean).join(', '),
  };
}

/** Returns the existing timetable entries in printable order for one output scope. */
export function printableLessons(timetable, type = 'general', entityId = '') {
  if (!['general', 'teacher', 'class', 'room'].includes(type)) throw new TypeError('Formato PDF non supportato.');
  const field = { teacher: 'teacherIds', class: 'classIds', room: 'roomIds' }[type];
  const lessons = timetable.lessons.filter(lesson => !entityId || lesson[field]?.includes(entityId));
  const sortName = lesson => {
    const names = lessonNames(timetable, lesson);
    return names.classes || names.teachers || names.rooms || names.subject;
  };
  return lessons.map(lesson => {
    const names = lessonNames(timetable, lesson);
    const time = lesson.assignedTime;
    const day = time ? timetable.calendar.days[time.dayIndex]?.name || '' : 'Senza orario';
    const start = time && timetable.calendar.periods[time.periodIndex];
    const end = time && timetable.calendar.periods[time.periodIndex + lesson.durationPeriods - 1];
    const format = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    return {
      lessonId: lesson.id,
      dayIndex: time?.dayIndex ?? Number.MAX_SAFE_INTEGER,
      periodIndex: time?.periodIndex ?? Number.MAX_SAFE_INTEGER,
      day,
      time: start && end ? `${format(start.beginMinute)}–${format(end.endMinute)}` : '—',
      className: names.classes,
      subject: names.subject,
      teachers: names.teachers,
      rooms: names.rooms,
      sortName: sortName(lesson),
    };
  }).sort((a, b) => a.dayIndex - b.dayIndex || a.periodIndex - b.periodIndex || a.sortName.localeCompare(b.sortName, 'it'));
}
