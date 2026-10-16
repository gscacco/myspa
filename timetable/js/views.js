import { analyzeSchedule } from './schedule.js';

const MODE_CONFIG = Object.freeze({
  class: { collection: 'classes', field: 'classIds', singular: 'classe', plural: 'classi' },
  teacher: { collection: 'teachers', field: 'teacherIds', singular: 'docente', plural: 'docenti' },
  room: { collection: 'rooms', field: 'roomIds', singular: 'aula', plural: 'aule' },
});

const MODE_LABELS = { class: 'Classe', teacher: 'Docente', room: 'Aula' };
const RESOURCE_LABELS = { teacher: 'docente', class: 'classe', room: 'aula', lesson: 'lezione' };

function make(document, tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
  const remainder = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${remainder}`;
}

function sourceWarningText(item) {
  if (item.code === 'encoding-mismatch') return `Codifica XML dichiarata ${item.declaredEncoding}; lettura eseguita come ${item.decodedEncoding}.`;
  if (item.code === 'unsupported-structure') return `Elemento OFD non riconosciuto conservato (${item.path}).`;
  if (item.code === 'unsupported-attribute') return `Attributo OFD non riconosciuto conservato (${item.path}).`;
  if (item.code === 'period-name-mismatch') return 'Il nome del documento e quello dei dati non coincidono; entrambi sono conservati.';
  if (item.code === 'unassigned-lessons') return item.details?.count != null ? `${item.details.count} lezioni senza orario assegnato nel file.` : item.message;
  return item.path ? `${item.message} (${item.path})` : item.message;
}

function issueText(item, timetable) {
  const day = item.dayIndex == null ? '' : timetable.calendar.days[item.dayIndex]?.name || '';
  const period = item.periodIndex == null ? null : timetable.calendar.periods[item.periodIndex];
  const time = period ? `${day}, ${formatTime(period.beginMinute)}` : day;
  if (item.code === 'resource-collision') return `Conflitto: ${RESOURCE_LABELS[item.resourceType] || 'risorsa'} ${item.resourceName} coinvolto in più lezioni contemporanee (${time}).`;
  if (item.code === 'unavailable-time') return `Conflitto: ${RESOURCE_LABELS[item.resourceType] || 'risorsa'} ${item.resourceName} non disponibile (${time}).`;
  if (item.code === 'soft-preference') return `Avviso: orario indesiderato per ${RESOURCE_LABELS[item.resourceType] || 'risorsa'} ${item.resourceName} (${time}).`;
  if (item.code === 'unassigned-lesson') return 'Avviso: lezione senza orario assegnato.';
  return item.message;
}

/** Renders read-only class, teacher, and room schedules and navigable diagnostics. */
export function createTimetableViews({ document = globalThis.document, onLessonSelect = () => {} } = {}) {
  if (!document) throw new TypeError('A document is required to render timetable views.');
  const workspace = document.querySelector('#timetable-workspace');
  const controls = document.querySelector('#view-controls');
  const entityLabel = document.querySelector('#entity-label');
  const entitySelect = document.querySelector('#entity-select');
  const grid = document.querySelector('#schedule-grid');
  const status = document.querySelector('#schedule-status');
  const details = document.querySelector('#lesson-details');
  const issuesList = document.querySelector('#issues-list');
  const sourceWarnings = document.querySelector('#source-warnings');
  const sourceWarningSummary = document.querySelector('#source-warning-summary');
  const viewButtons = [...(controls?.querySelectorAll('[data-view]') || [])];
  if (![workspace, controls, entityLabel, entitySelect, grid, status, details, issuesList, sourceWarnings, sourceWarningSummary].every(Boolean)
    || Object.keys(MODE_CONFIG).some(mode => !viewButtons.some(button => button.dataset.view === mode))) {
    throw new Error('Timetable view screen is missing required controls.');
  }

  let timetable = null;
  let diagnostics = [];
  let analysis = { issues: [], summary: { hardConflicts: 0, softWarnings: 0, unassignedLessons: 0 } };
  let mode = 'class';
  let selectedLessonId = null;
  const selectedByMode = { class: null, teacher: null, room: null };

  function currentEntities() {
    return timetable?.entities?.[MODE_CONFIG[mode].collection] || [];
  }

  function activeEntity() {
    return currentEntities().find(entity => entity.id === selectedByMode[mode]);
  }

  function lessonFor(id) {
    return timetable.lessons.find(lesson => lesson.id === id);
  }

  function entityFor(id, collection) {
    return timetable.entities[collection].find(entity => entity.id === id);
  }

  function ensureSelection() {
    const items = currentEntities();
    if (items.some(entity => entity.id === selectedByMode[mode])) return;
    const selected = selectedLessonId && lessonFor(selectedLessonId);
    const field = MODE_CONFIG[mode].field;
    selectedByMode[mode] = selected?.[field]?.find(id => items.some(entity => entity.id === id)) || items[0]?.id || '';
  }

  function renderEntitySelect() {
    entityLabel.textContent = MODE_LABELS[mode];
    entitySelect.setAttribute('aria-label', `Seleziona ${MODE_LABELS[mode].toLowerCase()}`);
    entitySelect.replaceChildren();
    for (const entity of currentEntities()) {
      const option = make(document, 'option', '', entity.name);
      option.value = entity.id;
      entitySelect.append(option);
    }
    ensureSelection();
    entitySelect.value = selectedByMode[mode] || '';
    entitySelect.disabled = currentEntities().length === 0;
  }

  function lessonConflicts() {
    const result = new Map();
    for (const item of analysis.issues) {
      for (const id of item.lessonIds) {
        if (!result.has(id)) result.set(id, []);
        result.get(id).push(item);
      }
    }
    return result;
  }

  function visibleLessons() {
    const entity = activeEntity();
    if (!entity) return [];
    const { field } = MODE_CONFIG[mode];
    return timetable.lessons.filter(lesson => lesson[field]?.includes(entity.id) && lesson.assignedTime);
  }

  function assignLanes(lessons) {
    const byDay = new Map();
    for (const lesson of lessons) {
      const day = lesson.assignedTime.dayIndex;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(lesson);
    }
    const result = new Map();
    let maxLanes = 1;
    for (const [day, items] of byDay) {
      items.sort((a, b) => a.assignedTime.periodIndex - b.assignedTime.periodIndex
        || b.durationPeriods - a.durationPeriods || a.sourceIndex - b.sourceIndex);
      const laneEnd = [];
      for (const lesson of items) {
        const start = lesson.assignedTime.periodIndex;
        let lane = laneEnd.findIndex(end => end <= start);
        if (lane < 0) lane = laneEnd.length;
        laneEnd[lane] = start + lesson.durationPeriods;
        result.set(lesson.id, lane);
      }
      maxLanes = Math.max(maxLanes, laneEnd.length);
    }
    return { byDay, laneByLesson: result, maxLanes };
  }

  function renderGrid() {
    grid.replaceChildren();
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', `Orario per ${MODE_LABELS[mode].toLowerCase()}: ${activeEntity()?.name || 'nessun elemento'}`);
    const { days, periods } = timetable.calendar;
    grid.style.gridTemplateColumns = `76px repeat(${Math.max(days.length, 1)}, minmax(154px, 1fr))`;
    grid.style.gridTemplateRows = `36px repeat(${Math.max(periods.length, 1)}, minmax(64px, auto))`;
    grid.append(make(document, 'div', 'grid-corner', 'Ora'));
    for (const [index, day] of days.entries()) {
      const header = make(document, 'div', 'day-heading', day.name);
      header.style.gridColumn = String(index + 2);
      header.style.gridRow = '1';
      grid.append(header);
    }

    for (const [index, period] of periods.entries()) {
      const time = make(document, 'div', 'time-heading', `${formatTime(period.beginMinute)}–${formatTime(period.endMinute)}`);
      time.style.gridColumn = '1';
      time.style.gridRow = String(index + 2);
      grid.append(time);
    }

    const visible = visibleLessons();
    const { laneByLesson, maxLanes } = assignLanes(visible);
    const conflictsByLesson = lessonConflicts();
    for (const [dayIndex, day] of days.entries()) {
      const column = make(document, 'div', 'day-column');
      column.setAttribute('role', 'group');
      column.setAttribute('aria-label', day.name);
      column.style.gridColumn = String(dayIndex + 2);
      column.style.gridRow = `2 / span ${periods.length}`;
      column.style.gridTemplateColumns = `repeat(${maxLanes}, minmax(0, 1fr))`;
      column.style.gridTemplateRows = `repeat(${periods.length}, minmax(64px, auto))`;
      for (const [periodIndex, period] of periods.entries()) {
        const slot = make(document, 'div', 'slot-background');
        slot.setAttribute('aria-hidden', 'true');
        slot.style.gridColumn = '1 / -1';
        slot.style.gridRow = String(periodIndex + 1);
        column.append(slot);
      }
      for (const lesson of visible.filter(item => item.assignedTime.dayIndex === dayIndex)) {
        const subject = entityFor(lesson.subjectId, 'subjects')?.name || 'Materia non assegnata';
        const teacherNames = lesson.teacherIds.map(id => entityFor(id, 'teachers')?.name || id).join(', ') || 'Docente non assegnato';
        const classNames = lesson.classIds.map(id => entityFor(id, 'classes')?.name || id).join(', ') || 'Classe non assegnata';
        const roomNames = lesson.roomIds.map(id => entityFor(id, 'rooms')?.name || id).join(', ') || 'Aula non assegnata';
        const start = periods[lesson.assignedTime.periodIndex];
        const end = periods[lesson.assignedTime.periodIndex + lesson.durationPeriods - 1];
        const timeText = `${formatTime(start.beginMinute)}–${formatTime(end.endMinute)}`;
        const related = conflictsByLesson.get(lesson.id) || [];
        const hasConflict = related.some(item => item.severity === 'error');
        const hasWarning = related.some(item => item.severity === 'warning');
        const card = make(document, 'button', `lesson-card${hasConflict ? ' has-conflict' : hasWarning ? ' has-warning' : ''}`);
        card.type = 'button';
        card.dataset.lessonId = lesson.id;
        card.style.gridColumn = String((laneByLesson.get(lesson.id) || 0) + 1);
        card.style.gridRow = `${lesson.assignedTime.periodIndex + 1} / span ${lesson.durationPeriods}`;
        card.setAttribute('aria-label', `${subject}, ${timeText}, ${teacherNames}, ${classNames}, ${roomNames}${hasConflict ? ', conflitto' : ''}`);
        card.setAttribute('aria-pressed', selectedLessonId === lesson.id ? 'true' : 'false');
        card.append(make(document, 'strong', 'lesson-subject', subject));
        card.append(make(document, 'span', 'lesson-people', `${teacherNames} · ${classNames}`));
        card.append(make(document, 'span', 'lesson-room', roomNames));
        card.append(make(document, 'span', 'lesson-time', timeText));
        if (hasConflict) card.append(make(document, 'span', 'lesson-status', '⚠ Conflitto'));
        else if (hasWarning) card.append(make(document, 'span', 'lesson-status', '! Avviso'));
        column.append(card);
      }
      grid.append(column);
    }
  }

  function renderDetails() {
    const lesson = selectedLessonId && lessonFor(selectedLessonId);
    details.replaceChildren();
    if (!lesson) {
      delete details.dataset.selectedLessonId;
      details.append(make(document, 'p', 'muted', 'Seleziona una lezione per vederne i dettagli.'));
      return;
    }
    details.dataset.selectedLessonId = lesson.id;
    const day = lesson.assignedTime && timetable.calendar.days[lesson.assignedTime.dayIndex];
    const start = lesson.assignedTime && timetable.calendar.periods[lesson.assignedTime.periodIndex];
    const end = lesson.assignedTime && timetable.calendar.periods[lesson.assignedTime.periodIndex + lesson.durationPeriods - 1];
    const values = [
      ['Materia', entityFor(lesson.subjectId, 'subjects')?.name || 'Non assegnata'],
      ['Docente', lesson.teacherIds.map(id => entityFor(id, 'teachers')?.name || id).join(', ') || 'Non assegnato'],
      ['Classe', lesson.classIds.map(id => entityFor(id, 'classes')?.name || id).join(', ') || 'Non assegnata'],
      ['Aula', lesson.roomIds.map(id => entityFor(id, 'rooms')?.name || id).join(', ') || 'Non assegnata'],
      ['Orario', day && start && end ? `${day.name}, ${formatTime(start.beginMinute)}–${formatTime(end.endMinute)}` : 'Senza orario assegnato'],
      ['Durata', `${lesson.durationPeriods} ${lesson.durationPeriods === 1 ? 'ora' : 'ore'}`],
    ];
    const list = make(document, 'dl', 'lesson-facts');
    for (const [label, value] of values) {
      const row = make(document, 'div');
      row.append(make(document, 'dt', '', label), make(document, 'dd', '', value));
      list.append(row);
    }
    const related = lessonConflicts().get(lesson.id) || [];
    let notices = null;
    if (related.length) {
      notices = make(document, 'ul', 'detail-notices');
      for (const item of related) notices.append(make(document, 'li', item.severity, issueText(item, timetable)));
    }
    details.append(list);
    if (notices) details.append(notices);
  }

  function renderIssues() {
    issuesList.replaceChildren();
    for (const item of analysis.issues) {
      const row = make(document, 'li', `schedule-issue ${item.severity}`);
      const label = make(document, 'strong', 'issue-kind', item.severity === 'error' ? 'Conflitto' : 'Avviso');
      const description = make(document, 'span', 'issue-description', issueText(item, timetable));
      row.append(label, description);
      for (const lessonId of item.lessonIds) {
        const lesson = lessonFor(lessonId);
        const subject = entityFor(lesson?.subjectId, 'subjects')?.name || lessonId;
        const classNames = lesson?.classIds.map(id => entityFor(id, 'classes')?.name || id).join(', ') || 'Classe non assegnata';
        const assignment = lesson?.assignedTime;
        const day = assignment && timetable.calendar.days[assignment.dayIndex];
        const start = assignment && timetable.calendar.periods[assignment.periodIndex];
        const end = assignment && timetable.calendar.periods[assignment.periodIndex + lesson.durationPeriods - 1];
        const time = day && start && end ? `${day.name} ${formatTime(start.beginMinute)}–${formatTime(end.endMinute)}` : 'Senza orario';
        const navigationLabel = `${subject} · ${classNames} · ${time}`;
        const link = make(document, 'button', 'issue-link', `Vai a ${navigationLabel}`);
        link.type = 'button';
        link.setAttribute('aria-label', `Apri lezione: ${navigationLabel}`);
        link.dataset.lessonId = lessonId;
        row.append(link);
      }
      issuesList.append(row);
    }
    if (!analysis.issues.length) issuesList.append(make(document, 'li', 'muted', 'Nessun conflitto diretto o lezione senza orario rilevati.'));

    sourceWarnings.replaceChildren();
    for (const item of diagnostics) {
      const row = make(document, 'li', item.severity || 'info', sourceWarningText(item));
      const label = make(document, 'strong', '', item.severity === 'error' ? 'Errore: ' : item.severity === 'warning' ? 'Avviso: ' : 'Info: ');
      row.prepend(label);
      sourceWarnings.append(row);
    }
    sourceWarningSummary.textContent = diagnostics.length
      ? `${diagnostics.filter(item => item.severity === 'warning').length} avvisi di importazione.`
      : 'Nessun avviso di importazione.';
    status.textContent = `${analysis.summary.hardConflicts} conflitti · ${analysis.summary.softWarnings} avvisi orari · ${analysis.summary.unassignedLessons} lezioni senza orario`;
  }

  function renderAll() {
    if (!timetable) return;
    workspace.hidden = false;
    ensureSelection();
    renderEntitySelect();
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === mode));
    renderGrid();
    renderDetails();
    renderIssues();
  }

  function selectLesson(lessonId, { navigate = false } = {}) {
    const lesson = lessonFor(lessonId);
    if (!lesson) return false;
    const activeElement = document.activeElement;
    const preserveGridFocus = !navigate && grid.contains(activeElement) && activeElement.dataset.lessonId === lessonId;
    selectedLessonId = lessonId;
    if (navigate) {
      const field = MODE_CONFIG[mode].field;
      const entities = currentEntities();
      const relevant = lesson[field]?.find(id => entities.some(entity => entity.id === id));
      if (relevant) selectedByMode[mode] = relevant;
      else {
        const fallback = ['class', 'teacher', 'room'].find(candidate => lesson[MODE_CONFIG[candidate].field]?.length);
        if (fallback) {
          mode = fallback;
          selectedByMode[mode] = lesson[MODE_CONFIG[mode].field][0];
        }
      }
    }
    renderAll();
    onLessonSelect(lesson);
    const target = [...grid.querySelectorAll('[data-lesson-id]')].find(node => node.dataset.lessonId === lessonId);
    if (navigate) {
      target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      if (target) target.focus();
      else details.focus();
    } else if (preserveGridFocus) {
      target?.focus();
    }
    return true;
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button || !MODE_CONFIG[button.dataset.view]) return;
    const previousMode = mode;
    mode = button.dataset.view;
    if (mode !== previousMode && selectedLessonId) {
      const lesson = lessonFor(selectedLessonId);
      const related = lesson[MODE_CONFIG[mode].field]?.find(id => currentEntities().some(entity => entity.id === id));
      if (related) selectedByMode[mode] = related;
    }
    renderAll();
  });
  entitySelect.addEventListener('change', () => {
    selectedByMode[mode] = entitySelect.value;
    renderGrid();
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-lesson-id]');
    if (button) selectLesson(button.dataset.lessonId);
  });
  issuesList.addEventListener('click', event => {
    const button = event.target.closest('[data-lesson-id]');
    if (button) selectLesson(button.dataset.lessonId, { navigate: true });
  });

  return {
    render(nextTimetable, nextDiagnostics = []) {
      timetable = nextTimetable;
      diagnostics = [...nextDiagnostics];
      analysis = analyzeSchedule(timetable);
      selectedLessonId = null;
      selectedByMode.class = null;
      selectedByMode.teacher = null;
      selectedByMode.room = null;
      mode = 'class';
      renderAll();
    },
    selectLesson,
    get selectedLessonId() { return selectedLessonId; },
    get mode() { return mode; },
    get analysis() { return analysis; },
  };
}
