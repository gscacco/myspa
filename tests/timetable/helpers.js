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
