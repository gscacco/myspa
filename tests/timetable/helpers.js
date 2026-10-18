import { JSDOM } from 'jsdom';

export const domParser = new JSDOM('').window.DOMParser;

export function minimalOFD({ lesson = '', additions = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOCUMENT>
  <VERSION value="5000"/><ID value="test-1"/>
  <PERIOD><NAME value="Test timetable"/></PERIOD>
  <SUBJECT><NAME value="Math"/></SUBJECT>
  <TEACHER><NAME value="T1"/><SEX value="X"/></TEACHER>
  <ROOM><NAME value="R1"/></ROOM>
  <CLASS><NAME value="C1"/></CLASS>
  <PERIODDATA>
    <PERIOD value="Test timetable"/>
    <TIMEGRID><TIMEUNIT value="60"/><DAYS value="1"/><HOURS value="2"/><CIRCULARITY value="0"/>
      <DAY><SHORTNAME value="MON"/><LONGNAME value="Monday"/></DAY>
      <HOUR><BEGIN value="480"/><END value="540"/><PRINTBEGIN value="1"/></HOUR>
      <HOUR><BEGIN value="540"/><END value="600"/><PRINTBEGIN value="1"/></HOUR>
    </TIMEGRID>
    <TEACHERDATA><TEACHER value="T1"/><MIN value="1"/><MAX value="4"/><WEIGHT value="2"/><DISTMIN value="0"/><DISTMAX value="0"/><FORCELEFT value="0"/><FORCERIGHT value="0"/><AVOIDAMGAP value="1"/><FREEDAYS value="0"/><TIMEFRAMES/></TEACHERDATA>
    <ROOMDATA><ROOM value="R1"/><NUMBER value="1"/><TIMEFRAMES/></ROOMDATA>
    <CLASSDATA><CLASS value="C1"/><MIN value="1"/><MAX value="4"/><WEIGHT value="2"/><DISTMIN value="0"/><DISTMAX value="0"/><FORCELEFT value="0"/><FORCERIGHT value="0"/><AVOIDAMGAP value="1"/><FREEDAYS value="0"/><TIMEFRAMES/></CLASSDATA>
    <SUBJECTDATA><SUBJECT value="Math"/><BACKCOLOR value="0"/><FORECOLOR value="0"/><WEIGHT value="0"/></SUBJECTDATA>
    ${lesson}
    ${additions}
  </PERIODDATA>
</DOCUMENT>`;
}

export function lessonXML({
  subject = 'Math', teacher = 'T1', group = 'C1', room = 'R1', duration = '1', time = '0.0',
  teachers = null, groups = null, rooms = null, timeframes = '',
} = {}) {
  const refs = (tag, values) => values.map(value => `<${tag}><NAME value="${value}"/></${tag}>`).join('');
  return `<LESSON><SUBJECT value="${subject}"/><DURATION value="${duration}"/><SITE value="UNICA"/><MODULE value="STANDARD"/><ALIGN value="1"/><PAUSE value="0"/>${refs('TEACHER', teachers ?? [teacher])}${groups === null ? (group ? refs('GROUP', [group]) : '') : refs('GROUP', groups)}${rooms === null ? (room ? refs('ROOM', [room]) : '') : refs('ROOM', rooms)}<TIMEFRAMES>${timeframes}</TIMEFRAMES>${time == null ? '' : `<TIME value="${time}"/>`}</LESSON>`;
}

export function timetableFixture() {
  return {
    schemaVersion: 1,
    name: 'Staff timetable',
    source: { format: 'orario-facile-ofd', version: '5000', documentId: 'view-test', xml: '<DOCUMENT/>' },
    calendar: {
      unitMinutes: 60,
      days: [{ index: 0, shortName: 'MON', name: 'Monday' }, { index: 1, shortName: 'TUE', name: 'Tuesday' }],
      periods: [
        { index: 0, beginMinute: 480, endMinute: 540 },
        { index: 1, beginMinute: 540, endMinute: 600 },
        { index: 2, beginMinute: 600, endMinute: 660 },
      ],
    },
    entities: {
      teachers: [
        { id: 'teacher:T1', name: 'Teacher One', constraints: { timeframes: { unavailable: [], desired: [], undesired: ['0.1', '1.2'] } } },
        { id: 'teacher:T2', name: 'Teacher Two', constraints: { timeframes: { unavailable: ['0.1'], desired: [], undesired: [] } } },
      ],
      classes: [{ id: 'class:C1', name: 'Class One' }, { id: 'class:C2', name: 'Class Two' }],
      rooms: [{ id: 'room:R1', name: 'Room One' }, { id: 'room:R2', name: 'Room Two' }],
      subjects: [{ id: 'subject:MATH', name: 'Mathematics' }, { id: 'subject:HIST', name: 'History' }],
    },
    lessons: [
      { id: 'lesson:0', sourceIndex: 0, subjectId: 'subject:MATH', teacherIds: ['teacher:T1'], classIds: ['class:C1'], roomIds: ['room:R1'], durationPeriods: 2, assignedTime: { dayIndex: 0, periodIndex: 0, sourceValue: '0.0' }, timeframes: { unavailable: [], desired: [], undesired: [] } },
      { id: 'lesson:1', sourceIndex: 1, subjectId: 'subject:HIST', teacherIds: ['teacher:T1'], classIds: ['class:C2'], roomIds: ['room:R1'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' }, timeframes: { unavailable: [], desired: [], undesired: [] } },
      { id: 'lesson:2', sourceIndex: 2, subjectId: 'subject:MATH', teacherIds: ['teacher:T2'], classIds: ['class:C1'], roomIds: ['room:R2'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' }, timeframes: { unavailable: [], desired: [], undesired: [] } },
      { id: 'lesson:3', sourceIndex: 3, subjectId: 'subject:HIST', teacherIds: ['teacher:T1'], classIds: ['class:C2'], roomIds: ['room:R2'], durationPeriods: 1, assignedTime: { dayIndex: 1, periodIndex: 2, sourceValue: '1.2' }, timeframes: { unavailable: [], desired: [], undesired: [] } },
      { id: 'lesson:4', sourceIndex: 4, subjectId: 'subject:MATH', teacherIds: ['teacher:T2'], classIds: ['class:C2'], roomIds: [], durationPeriods: 1, assignedTime: null, timeframes: { unavailable: [], desired: [], undesired: [] } },
    ],
    links: [],
    parameters: [],
  };
}

export function solverFixture({ chain = false } = {}) {
  const slotCount = chain ? 4 : 3;
  const lessons = chain ? [
    { id: 'target', sourceIndex: 0, subjectId: 'subject:MATH', teacherIds: ['teacher:T1'], classIds: ['class:C1'], roomIds: ['room:R1'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 0, sourceValue: '0.0' }, timeframes: { unavailable: ['0.2', '0.3'], desired: [], undesired: [] } },
    { id: 'blocker-1', sourceIndex: 1, subjectId: 'subject:HIST', teacherIds: ['teacher:T1'], classIds: ['class:C2'], roomIds: ['room:R2'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 1, sourceValue: '0.1' }, timeframes: { unavailable: ['0.0', '0.3'], desired: [], undesired: [] } },
    { id: 'blocker-2', sourceIndex: 2, subjectId: 'subject:MATH', teacherIds: ['teacher:T1'], classIds: ['class:C3'], roomIds: ['room:R3'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 2, sourceValue: '0.2' }, timeframes: { unavailable: ['0.0', '0.1'], desired: [], undesired: [] } },
  ] : [
    { id: 'target', sourceIndex: 0, subjectId: 'subject:MATH', teacherIds: ['teacher:T1'], classIds: ['class:C1'], roomIds: ['room:R1'], durationPeriods: 1, assignedTime: { dayIndex: 0, periodIndex: 0, sourceValue: '0.0' }, timeframes: { unavailable: [], desired: [], undesired: [] } },
  ];
  return {
    schemaVersion: 1,
    name: 'Solver test',
    source: { format: 'fixture', version: '1', xml: '<SOURCE/>' },
    calendar: { unitMinutes: 60, days: [{ index: 0, shortName: 'MON', name: 'Monday' }], periods: Array.from({ length: slotCount }, (_, index) => ({ index, beginMinute: 480 + 60 * index, endMinute: 540 + 60 * index })) },
    entities: {
      teachers: [{ id: 'teacher:T1', name: 'Teacher One', constraints: { timeframes: { unavailable: [], desired: [], undesired: chain ? [] : ['0.1'] } } }],
      classes: Array.from({ length: chain ? 3 : 1 }, (_, index) => ({
        id: `class:C${index + 1}`, name: `Class ${index + 1}`,
        ...(chain ? { constraints: { timeframes: { unavailable: [
          ['0.2', '0.3'], ['0.0', '0.3'], ['0.0', '0.1'],
        ][index], desired: [], undesired: [] } } } : {}),
      })),
      rooms: Array.from({ length: chain ? 3 : 1 }, (_, index) => ({ id: `room:R${index + 1}`, name: `Room ${index + 1}` })),
      subjects: [{ id: 'subject:MATH', name: 'Mathematics' }, { id: 'subject:HIST', name: 'History' }],
    },
    lessons,
    links: [],
    parameters: [],
  };
}
