import { TIMETABLE_SCHEMA_VERSION } from './domain.js';
import { updateTimeframeConstraint } from './constraints.js';

const COLLECTION_LABELS = Object.freeze({ teachers: 'Docente', classes: 'Classe', subjects: 'Materia', rooms: 'Aula', students: 'Studente' });
const COLLECTION_IMPORTED = Object.freeze({ teachers: 'docenti importati', classes: 'classi importate', subjects: 'materie importate', rooms: 'aule importate', students: 'studenti importati' });
const COLLECTION_TYPES = Object.freeze({ teachers: 'teacher', classes: 'class', subjects: 'subject', rooms: 'room', students: 'student' });
const CONSTRAINT_PAGE_SIZE = 80;
const normalizedName = value => String(value || '').trim().toLocaleLowerCase();
const normalizedSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
const idPart = value => String(value || 'ofd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ofd';

export function createEmptySchool() {
  const days = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];
  return {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    name: 'Nuova scuola',
    description: '',
    source: { format: 'native', version: '1', xml: '', unsupportedStructures: [], lessonImports: [] },
    calendar: {
      unitMinutes: 60,
      days: days.map((name, index) => ({ index, name, shortName: name.slice(0, 3).toLocaleUpperCase() })),
      periods: Array.from({ length: 6 }, (_, index) => ({ index, beginMinute: 480 + index * 60, endMinute: 540 + index * 60 })),
    },
    entities: { teachers: [], classes: [], subjects: [], rooms: [], students: [] },
    lessons: [], links: [], parameters: [],
  };
}

export function evaluateConstraintStatus(timetable, constraint) {
  if (!['teachers', 'classes'].includes(constraint?.scope)
    || !['unavailable', 'undesired', 'desired'].includes(constraint?.kind)) return 'unverified';
  const match = /^(\d+)\.(\d+)$/.exec(String(constraint.slot || ''));
  if (!match) return 'unverified';
  const dayIndex = Number(match[1]);
  const periodIndex = Number(match[2]);
  if (!timetable.calendar.days.some(day => day.index === dayIndex)
    || !timetable.calendar.periods.some(period => period.index === periodIndex)) return 'unverified';
  const owner = timetable.entities[constraint.scope]?.find(item => item.id === constraint.id);
  if (!owner) return 'unverified';
  const relatedLessons = timetable.lessons.filter(lesson => constraint.scope === 'teachers'
    ? lesson.teacherIds?.includes(constraint.id)
    : lesson.classIds?.includes(constraint.id));
  const occupied = relatedLessons.some(lesson => {
    if (!lesson.assignedTime) return false;
    const sameDay = lesson.assignedTime.dayIndex === dayIndex;
    const coversPeriod = periodIndex >= lesson.assignedTime.periodIndex
      && periodIndex < lesson.assignedTime.periodIndex + lesson.durationPeriods;
    return sameDay && (constraint.kind === 'unavailable'
      ? coversPeriod
      : lesson.assignedTime.periodIndex === periodIndex);
  });
  if (occupied) return constraint.kind === 'desired' ? 'satisfied' : 'unsatisfied';
  if (relatedLessons.some(lesson => !lesson.assignedTime)) return 'pending';
  return constraint.kind === 'desired' ? 'unsatisfied' : 'satisfied';
}

function element(document, tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

function resourceType(collection) { return collection.slice(0, -1); }
function adoptImportedCalendar(timetable, calendar, sourceInfo) {
  if (!calendar) return;
  timetable.calendar = structuredClone(calendar);
  for (const collection of ['teachers', 'classes', 'rooms']) for (const entity of timetable.entities[collection] || []) {
    const preserved = entity.sourceData?.ofdTimeframes;
    const frames = entity.constraints?.timeframes;
    if (!preserved || !frames) continue;
    for (const kind of ['unavailable', 'desired', 'undesired']) {
      frames[kind] ||= [];
      for (const slot of preserved[kind] || []) {
        const [day, period] = slot.split('.').map(Number);
        if (day < calendar.days.length && period < calendar.periods.length && !frames[kind].includes(slot)) frames[kind].push(slot);
      }
    }
    delete entity.sourceData.ofdTimeframes;
    if (!Object.keys(entity.sourceData).length) delete entity.sourceData;
  }
  timetable.source.calendarSourceId = sourceInfo?.source?.documentId || sourceInfo?.filename || 'ofd';
}

function uniqueId(collection, name, values) {
  const stem = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'elemento';
  let suffix = 1, id = `${COLLECTION_TYPES[collection]}:${stem}-${suffix}`;
  while (values.some(value => value.id === id)) id = `${COLLECTION_TYPES[collection]}:${stem}-${++suffix}`;
  return id;
}

function ensureUnknownEntity(timetable, collection) {
  const values = timetable.entities[collection];
  let unknown = values.find(item => item.placeholder === 'unknown')
    || values.find(item => normalizedName(item.name) === 'unknown');
  if (unknown) return unknown;
  unknown = { id: uniqueId(collection, 'UNKNOWN', values), name: 'UNKNOWN', placeholder: 'unknown' };
  if (collection !== 'subjects') unknown.constraints = { timeframes: { unavailable: [], desired: [], undesired: [] } };
  values.push(unknown);
  return unknown;
}

function appendImportedLessons(timetable, incoming, incomingSubjects, sourceInfo, calendar) {
  const subjects = timetable.entities.subjects;
  const knownNames = new Map(subjects.map(item => [normalizedName(item.name), item]));
  const knownIds = new Set(Object.values(timetable.entities).flat().map(item => item.id));
  const subjectIds = new Map();
  const subjectAdditions = [];
  for (const item of incomingSubjects) {
    const key = normalizedName(item.name);
    const existing = knownNames.get(key);
    if (existing) { subjectIds.set(item.id, existing.id); continue; }
    const next = structuredClone(item);
    if (!next.id || knownIds.has(next.id)) next.id = uniqueId('subjects', next.name, [...subjects, ...subjectAdditions]);
    subjectAdditions.push(next);
    knownNames.set(key, next);
    knownIds.add(next.id);
    subjectIds.set(item.id, next.id);
  }
  for (const item of incomingSubjects) {
    const matched = knownNames.get(normalizedName(item.name));
    if (matched) subjectIds.set(item.id, matched.id);
  }
  const knownLessonIds = new Set(timetable.lessons.map(item => item.id));
  const sourceId = idPart(sourceInfo?.source?.documentId || sourceInfo?.filename || 'ofd');
  const additions = incoming.map(item => {
    const lesson = structuredClone(item);
    lesson.subjectId = subjectIds.get(item.subjectId) || item.subjectId || null;
    lesson.classIds = (item.classIds || []).filter(id => timetable.entities.classes.some(schoolClass => schoolClass.id === id));
    const stem = `lesson:ofd-${sourceId}-${Number.isInteger(item.sourceIndex) ? item.sourceIndex : 'x'}`;
    let id = stem, suffix = 1;
    while (knownLessonIds.has(id)) id = `${stem}-${++suffix}`;
    lesson.id = id;
    knownLessonIds.add(id);
    return lesson;
  });
  if (additions.length || subjectAdditions.length || sourceInfo) {
    subjects.push(...subjectAdditions);
    for (const lesson of additions) {
      if (!subjects.some(item => item.id === lesson.subjectId)) lesson.subjectId = ensureUnknownEntity(timetable, 'subjects').id;
      if (!lesson.classIds.length) lesson.classIds = [ensureUnknownEntity(timetable, 'classes').id];
    }
    timetable.lessons.push(...additions);
    adoptImportedCalendar(timetable, calendar, sourceInfo);
    if (sourceInfo) {
      timetable.source.lessonImports ||= [];
      timetable.source.lessonImports.push(structuredClone(sourceInfo));
    }
  }
  return { imported: additions.length, subjects: subjectAdditions.length };
}

export function createSchoolWorkbench({ document = globalThis.document, onChange = () => {}, onDetail = () => {} } = {}) {
  if (!document) throw new TypeError('A document is required to mount the school workbench.');
  const tables = Object.fromEntries(['teachers', 'classes', 'subjects', 'rooms'].map(key => [key, document.querySelector(`#school-grid-${key}`)]));
  const studentTable = document.querySelector('#school-grid-students');
  const lessonTable = document.querySelector('#school-grid-lessons');
  const lessonGroups = document.querySelector('#school-lesson-groups');
  const lessonViewToggle = document.querySelector('#school-lesson-view-toggle');
  const lessonGroupCount = document.querySelector('#school-lesson-count');
  const lessonGroupModes = document.querySelector('#school-lesson-group-modes');
  const constraintTable = document.querySelector('#school-grid-constraints');
  const constraintFilter = document.querySelector('#school-constraint-filter');
  const constraintGroups = document.querySelector('#school-constraint-groups');
  const constraintViewToggle = document.querySelector('#school-constraint-view-toggle');
  const gridNames = ['teachers', 'classes', 'subjects', 'rooms', 'students', 'lessons', 'constraints'];
  const gridFilters = Object.fromEntries(gridNames.slice(0, -1).map(key => [key, document.querySelector(`#school-filter-${key}`)]));
  const gridFilterCounts = Object.fromEntries(Object.keys(gridFilters).map(key => [key, document.querySelector(`[data-grid-filter-count="${key}"]`)]));
  const columnFilters = Object.fromEntries(gridNames.map(key => [key, []]));
  const sortStates = Object.fromEntries(gridNames.map(key => [key, null]));
  const sortCollator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  const constraintCount = document.querySelector('#school-constraint-count');
  const previousConstraints = document.querySelector('#school-constraint-previous');
  const nextConstraints = document.querySelector('#school-constraint-next');
  const undoButton = document.querySelector('#undo-school-edit');
  const status = document.querySelector('#school-edit-status');
  if ([...Object.values(tables), lessonTable, constraintTable, constraintFilter, constraintCount, previousConstraints, nextConstraints, undoButton, status].some(item => !item)) throw new Error('School workbench controls are missing.');
  const setStatus = (message, state = '') => {
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  };
  let timetable = createEmptySchool();
  let constraintPage = 0;
  let groupedConstraintPage = 0;
  let groupedConstraintView = true;
  let groupedLessonView = Boolean(lessonGroups && lessonViewToggle);
  let lessonGroupMode = 'equivalent';
  const expandedLessonGroups = new Set();
  const collapsedLessonOwners = new Set();
  const collapsedLessonSubjects = new Set();
  let editingEntity = null;
  let selectedDetailKey = null;
  const undoStack = [];

  function remember() {
    undoStack.push({ type: 'snapshot', timetable: structuredClone(timetable) });
    if (undoStack.length > 100) undoStack.shift();
    undoButton.disabled = false;
  }

  function rememberLesson(index, previous, createdUnknownIds = []) {
    undoStack.push({ type: 'lesson', index, previous: previous ? structuredClone(previous) : null, createdUnknownIds });
    if (undoStack.length > 100) undoStack.shift();
    undoButton.disabled = false;
  }

  function commit(message) {
    setStatus(message);
    onChange(timetable);
  }

  function bindDetailRow(row, detail, onEdit = null) {
    row.classList.add('selectable-detail-row');
    row.tabIndex = 0;
    const label = [...row.cells].map(cell => cell.querySelector('input, select')?.value || cell.textContent.trim()).filter(Boolean).join(' · ');
    row.setAttribute('aria-label', `${onEdit ? 'Seleziona per i dettagli; doppio clic per modificare' : 'Apri i dettagli'}: ${label}`);
    const key = detail.type === 'constraint'
      ? `constraint:${detail.constraint.scope}:${detail.constraint.id}:${detail.constraint.kind}:${detail.constraint.slot}`
      : `${detail.type}:${detail.id}`;
    const selectDetail = () => {
      selectedDetailKey = key;
      row.closest('tbody')?.querySelectorAll('.is-selected').forEach(item => {
        item.classList.remove('is-selected');
        item.setAttribute('aria-selected', 'false');
      });
      row.classList.add('is-selected');
      row.setAttribute('aria-selected', 'true');
      onDetail(detail);
    };
    if (selectedDetailKey === key) { row.classList.add('is-selected'); row.setAttribute('aria-selected', 'true'); }
    else row.setAttribute('aria-selected', 'false');
    row.addEventListener('click', selectDetail);
    row.addEventListener('focusin', selectDetail);
    if (onEdit) row.addEventListener('dblclick', onEdit);
    row.addEventListener('keydown', event => {
      if (event.key === 'F2' && onEdit) { event.preventDefault(); onEdit(); return; }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectDetail();
    });
  }

  function editableTable(table, gridName, headers) {
    table.replaceChildren();
    table.dataset.grid = gridName;
    const head = element(document, 'thead');
    const row = element(document, 'tr');
    headers.forEach((label, columnIndex) => {
      const sortState = sortStates[gridName];
      const th = element(document, 'th', { scope: 'col', 'aria-sort': sortState?.columnIndex === columnIndex ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none' });
      const sortLabel = sortState?.columnIndex === columnIndex
        ? `Ordina per ${label}, ordine ${sortState.direction === 'asc' ? 'crescente' : 'decrescente'}`
        : `Ordina per ${label}`;
      const sort = element(document, 'button', { type: 'button', class: 'grid-sort', 'data-grid-sort': gridName, 'data-column-index': columnIndex, 'aria-label': sortLabel }, label);
      const filter = element(document, 'input', { type: 'search', class: 'grid-column-filter', 'data-grid-column-filter': gridName, 'data-column-index': columnIndex, 'aria-label': `Filtra ${label}` });
      filter.value = columnFilters[gridName][columnIndex] || '';
      sort.addEventListener('click', () => {
        const current = sortStates[gridName];
        sortStates[gridName] = current?.columnIndex === columnIndex
          ? { columnIndex, direction: current.direction === 'asc' ? 'desc' : 'asc' }
          : { columnIndex, direction: 'asc' };
        if (gridName === 'constraints') refreshConstraintTable(sort);
        else { renderHeaderSortState(gridName); applyGridFilter(gridName); }
      });
      filter.addEventListener('input', () => {
        columnFilters[gridName][columnIndex] = filter.value;
        if (gridName === 'constraints') refreshConstraintTable(filter);
        else applyGridFilter(gridName);
      });
      const lessonGroupMode = gridName === 'lessons' && columnIndex === 1 ? 'teacher'
        : gridName === 'lessons' && columnIndex === 2 ? 'class'
          : gridName === 'lessons' && columnIndex === 3 ? 'room' : null;
      if (lessonGroupMode) {
        const groupedLabel = lessonGroupMode === 'teacher' ? 'docente' : lessonGroupMode === 'class' ? 'classe' : 'aula';
        const groupButton = element(document, 'button', {
          type: 'button', class: 'grid-group', 'data-lesson-group-mode': lessonGroupMode,
          'aria-label': `Raggruppa le lezioni per ${groupedLabel}`,
          title: `Raggruppa per ${groupedLabel}`,
        }, 'Raggruppa');
        groupButton.addEventListener('click', event => {
          event.stopPropagation();
          setLessonGroupMode(lessonGroupMode);
        });
        th.append(sort, groupButton, filter);
      } else th.append(sort, filter);
      row.append(th);
    });
    head.append(row);
    table.append(head, element(document, 'tbody'));
    return table.querySelector('tbody');
  }

  function renderHeaderSortState(gridName) {
    const state = sortStates[gridName];
    const headers = document.querySelectorAll(`#school-grid-${gridName} thead th`);
    headers.forEach((th, index) => {
      th.setAttribute('aria-sort', state?.columnIndex === index ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      const button = th.querySelector('[data-grid-sort]');
      button?.setAttribute('aria-label', `Ordina per ${button.textContent}${state?.columnIndex === index ? (state.direction === 'asc' ? ', ordine crescente' : ', ordine decrescente') : ''}`);
    });
  }

  function refreshConstraintTable(control) {
    const type = control.matches('[data-grid-sort]') ? 'sort' : 'filter';
    const index = control.dataset.columnIndex;
    const selection = type === 'filter' ? [control.selectionStart, control.selectionEnd] : null;
    constraintPage = 0;
    renderConstraints();
    const replacement = constraintTable.querySelector(type === 'sort'
      ? `[data-grid-sort="constraints"][data-column-index="${index}"]`
      : `[data-grid-column-filter="constraints"][data-column-index="${index}"]`);
    replacement?.focus();
    if (replacement && selection?.[0] != null) replacement.setSelectionRange(...selection);
  }

  function applyGridFilter(gridName) {
    const table = document.querySelector(`#school-grid-${gridName}`);
    const filter = gridFilters[gridName];
    const count = gridFilterCounts[gridName];
    if (!table) return;
    const query = normalizedSearch(filter?.value);
    const columnQueries = columnFilters[gridName].map(normalizedSearch);
    let matching = 0;
    let total = 0;
    for (const row of table.querySelectorAll('tbody tr')) {
      if (row.dataset.newRow === 'true') { row.hidden = false; continue; }
      total++;
      const values = JSON.parse(row.dataset.filterValues || '[]').map(normalizedSearch);
      const visible = (!query || normalizedSearch(row.dataset.search).includes(query))
        && columnQueries.every((value, index) => !value || (values[index] || '').includes(value));
      row.hidden = !visible;
      if (visible) matching++;
    }
    const sort = sortStates[gridName];
    if (sort) {
      const body = table.querySelector('tbody');
      const rows = [...body.querySelectorAll('tr:not([data-new-row="true"])')];
      rows.sort((left, right) => {
        const a = JSON.parse(left.dataset.sortValues || '[]')[sort.columnIndex] || '';
        const b = JSON.parse(right.dataset.sortValues || '[]')[sort.columnIndex] || '';
        return sortCollator.compare(String(a), String(b)) * (sort.direction === 'asc' ? 1 : -1);
      }).forEach(row => body.append(row));
      const fresh = body.querySelector('tr[data-new-row="true"]');
      if (fresh) body.append(fresh);
      renderHeaderSortState(gridName);
    }
    if (count) count.textContent = query ? `${matching} di ${total}` : `${total} elementi`;
    if (gridName === 'lessons') renderLessonGroups();
  }

  function renderEntities(collection) {
    const table = tables[collection];
    const body = editableTable(table, collection, ['Nome', 'Uso']);
    const values = timetable.entities[collection];
    const addRow = (entity, index, fresh = false) => {
      const row = element(document, 'tr', { 'data-row': index, ...(fresh ? { 'data-new-row': 'true' } : {}) });
      if (!fresh) row.dataset.entityId = entity.id;
      const usageCount = fresh ? 0 : timetable.lessons.filter(lesson => lesson[collection === 'teachers' ? 'teacherIds' : collection === 'classes' ? 'classIds' : collection === 'rooms' ? 'roomIds' : 'subjectId']?.includes?.(entity.id) || lesson.subjectId === entity.id).length;
      const usageText = fresh ? 'Nuova riga' : `${usageCount} lezioni`;
      row.dataset.filterValues = JSON.stringify([entity?.name || '', usageText]);
      row.dataset.sortValues = row.dataset.filterValues;
      row.dataset.search = `${entity?.name || ''} ${JSON.stringify(entity || {})} ${usageText} ${fresh ? '' : COLLECTION_LABELS[collection]}`;
      const nameCell = element(document, 'td');
      const isEditing = !fresh && editingEntity?.collection === collection && editingEntity.id === entity.id;
      const input = fresh || isEditing ? element(document, 'input', {
        type: 'text', 'data-field': 'name', 'data-row': index, 'data-grid': collection,
        'aria-label': `${COLLECTION_LABELS[collection]} ${index + 1}`,
        placeholder: fresh ? 'Scrivi per aggiungere…' : '', value: entity?.name || '',
      }) : null;
      nameCell.append(input || element(document, 'span', { class: 'entity-name-display' }, entity.name));
      row.append(nameCell);
      const usageCell = element(document, 'td', { class: 'grid-usage' }, usageText);
      row.append(usageCell);
      body.append(row);
      if (!fresh) bindDetailRow(row, { type: collection, id: entity.id }, () => {
        editingEntity = { collection, id: entity.id };
        render();
        const editor = table.querySelector(`[data-entity-id="${entity.id}"] [data-field="name"]`);
        editor?.focus();
        editor?.select();
      });
      if (!input) return;
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (fresh && !value) return;
        if (values.some(item => item.id !== entity?.id && item.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
          setStatus(`Esiste già ${COLLECTION_LABELS[collection].toLocaleLowerCase()} “${value}”.`, 'warning');
          input.value = entity?.name || '';
          return;
        }
        if (!value && entity) {
          const referenced = timetable.lessons.some(lesson => lesson.teacherIds?.includes(entity.id) || lesson.classIds?.includes(entity.id) || lesson.roomIds?.includes(entity.id) || lesson.subjectId === entity.id)
            || (collection === 'classes' && timetable.entities.students?.some(student => student.classId === entity.id));
          const constrained = ['unavailable', 'desired', 'undesired'].some(kind => entity.constraints?.timeframes?.[kind]?.length);
          if (referenced || constrained) {
            setStatus(`“${entity.name}” è usato da una lezione o ha vincoli: rimuovi prima i riferimenti.`, 'warning');
            input.value = entity.name;
            return;
          }
          editingEntity = null;
          remember();
          values.splice(index, 1);
          render();
          commit(`${COLLECTION_LABELS[collection]} rimosso.`);
          return;
        }
        if (!value) return;
        if (fresh) {
          const next = { id: uniqueId(collection, value, values), name: value };
          if (collection !== 'subjects') next.constraints = { timeframes: { unavailable: [], desired: [], undesired: [] } };
          remember();
          values.push(next);
          render();
          const newInput = table.querySelector('[data-new-row="true"] input');
          newInput?.focus();
          commit(`${COLLECTION_LABELS[collection]} aggiunto.`);
        } else {
          editingEntity = null;
          if (entity.name !== value) {
            remember();
            if (entity.placeholder === 'unknown' && normalizedName(value) !== 'unknown') delete entity.placeholder;
            entity.name = value;
            commit(`${COLLECTION_LABELS[collection]} aggiornato.`);
          }
          render();
          table.querySelector(`[data-entity-id="${entity.id}"]`)?.focus();
        }
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape' && !fresh) {
          event.preventDefault();
          editingEntity = null;
          render();
          table.querySelector(`[data-entity-id="${entity.id}"]`)?.focus();
        }
      });
      input.addEventListener('blur', () => {
        if (fresh || editingEntity?.collection !== collection || editingEntity.id !== entity.id || input.value.trim() !== entity.name) return;
        editingEntity = null;
        input.replaceWith(element(document, 'span', { class: 'entity-name-display' }, entity.name));
      });
    };
    values.forEach((entity, index) => addRow(entity, index));
    addRow(null, values.length, true);
    applyGridFilter(collection);
  }

  function option(select, value, label) {
    const item = element(document, 'option', { value }, label);
    select.append(item);
  }

  function renderStudents() {
    const body = editableTable(studentTable, 'students', ['Nome', 'Classe']);
    const values = timetable.entities.students || (timetable.entities.students = []);
    const addRow = (student, index, fresh = false) => {
      const row = element(document, 'tr', { 'data-row': index, ...(fresh ? { 'data-new-row': 'true' } : {}) });
      const schoolClass = timetable.entities.classes.find(item => item.id === student?.classId);
      row.dataset.filterValues = JSON.stringify([student?.name || '', schoolClass?.name || '']);
      row.dataset.sortValues = row.dataset.filterValues;
      row.dataset.search = `${student?.name || ''} ${schoolClass?.name || ''} ${JSON.stringify(student || {})}`;
      const nameCell = element(document, 'td');
      const name = element(document, 'input', { type: 'text', 'data-field': 'name', 'aria-label': `Studente ${index + 1}`, placeholder: fresh ? 'Scrivi per aggiungere…' : '', value: student?.name || '' });
      nameCell.append(name); row.append(nameCell);
      const classCell = element(document, 'td');
      const select = element(document, 'select', { 'aria-label': `Classe dello studente ${index + 1}` });
      select.append(element(document, 'option', { value: '' }, 'Scegli classe…'));
      timetable.entities.classes.forEach(item => select.append(element(document, 'option', { value: item.id }, item.name)));
      select.value = student?.classId || '';
      classCell.append(select); row.append(classCell); body.append(row);
      const save = () => {
        const value = name.value.trim();
        if (fresh && !value && !select.value) return;
        if (!value || !select.value) { setStatus('Per registrare uno studente servono nome e classe.', 'warning'); return; }
        if (values.some(item => item.id !== student?.id && item.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
          setStatus(`Esiste già lo studente “${value}”.`, 'warning'); name.value = student?.name || ''; return;
        }
        if (fresh) {
          remember(); values.push({ id: uniqueId('students', value, values), name: value, classId: select.value });
          render(); setStatus('Studente aggiunto.'); onChange(timetable);
        } else if (student.name !== value || student.classId !== select.value) {
          remember(); student.name = value; student.classId = select.value; render(); setStatus('Studente aggiornato.'); onChange(timetable);
        }
      };
      name.addEventListener('change', save); select.addEventListener('change', save);
      row.addEventListener('keydown', event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && (event.ctrlKey || event.metaKey) && !fresh) {
          event.preventDefault(); remember(); values.splice(index, 1); render(); setStatus('Studente rimosso.'); onChange(timetable);
        }
        if (event.key === 'Enter' && event.target === name) { event.preventDefault(); name.blur(); }
      });
    };
    values.forEach((student, index) => addRow(student, index));
    addRow(null, values.length, true);
    applyGridFilter('students');
  }

  function renderLessons() {
    const body = editableTable(lessonTable, 'lessons', ['Materia', 'Docente', 'Classe', 'Aula', 'Ore']);
    const values = timetable.lessons;
    const collections = ['subjects', 'teachers', 'classes', 'rooms'];
    const byId = Object.fromEntries(collections.map(collection => [collection, new Map(timetable.entities[collection].map(item => [item.id, item]))]));
    const byName = Object.fromEntries(collections.map(collection => [collection, new Map(timetable.entities[collection].map(item => [normalizedName(item.name), item]))]));
    const choiceLists = Object.fromEntries(['subjects', 'teachers', 'classes', 'rooms'].map(collection => {
      const id = `school-lesson-choices-${collection}`;
      const datalist = element(document, 'datalist', { id });
      timetable.entities[collection].forEach(entity => datalist.append(element(document, 'option', { value: entity.name })));
      lessonTable.parentElement.querySelector(`#${id}`)?.remove();
      lessonTable.parentElement.append(datalist);
      return [collection, id];
    }));
    const appendLesson = state => {
      const row = element(document, 'tr', { 'data-row': state.index, ...(state.fresh ? { 'data-new-row': 'true' } : {}) });
      if (!state.fresh) row.dataset.lessonId = state.lesson.id;
      const fields = [
        ['subjects', 'subjectId', 'Materia'], ['teachers', 'teacherId', 'Docente'],
        ['classes', 'classId', 'Classe'], ['rooms', 'roomId', 'Aula'],
      ];
      const inputs = fields.map(([collection, , label]) => {
        const input = element(document, 'input', { type: 'text', list: choiceLists[collection], 'aria-label': label, placeholder: state.fresh ? 'Scegli…' : '' });
        const cell = element(document, 'td'); cell.append(input); row.append(cell);
        return input;
      });
      const durationCell = element(document, 'td');
      const duration = element(document, 'select', { 'aria-label': 'Durata in ore' });
      [1, 2, 3, 4].forEach(value => option(duration, String(value), String(value)));
      durationCell.append(duration);
      row.append(durationCell); body.append(row);
      const syncRow = () => {
        const lesson = state.lesson;
        inputs[0].value = byId.subjects.get(lesson?.subjectId)?.name || '';
        inputs[1].value = byId.teachers.get(lesson?.teacherIds?.[0])?.name || '';
        inputs[2].value = byId.classes.get(lesson?.classIds?.[0])?.name || '';
        inputs[3].value = byId.rooms.get(lesson?.roomIds?.[0])?.name || '';
        duration.value = String(lesson?.durationPeriods || 1);
        row.dataset.search = normalizedSearch([
          lesson?.id, byId.subjects.get(lesson?.subjectId)?.name,
          byId.teachers.get(lesson?.teacherIds?.[0])?.name,
          byId.classes.get(lesson?.classIds?.[0])?.name,
          byId.rooms.get(lesson?.roomIds?.[0])?.name,
          lesson?.durationPeriods, lesson?.sourceIndex,
        ].join(' '));
        row.dataset.filterValues = JSON.stringify([
          byId.subjects.get(lesson?.subjectId)?.name || '',
          byId.teachers.get(lesson?.teacherIds?.[0])?.name || '',
          byId.classes.get(lesson?.classIds?.[0])?.name || '',
          byId.rooms.get(lesson?.roomIds?.[0])?.name || '',
          lesson?.durationPeriods ?? '',
        ]);
        row.dataset.sortValues = row.dataset.filterValues;
      };
      syncRow();
      if (!state.fresh) bindDetailRow(row, { type: 'lessons', id: state.lesson.id });
      const save = () => {
        const resolved = inputs.map((input, fieldIndex) => {
          const collection = fields[fieldIndex][0];
          return byName[collection].get(normalizedName(input.value));
        });
        if (state.fresh && inputs.slice(0, 3).every(input => !input.value.trim())) return;
        if (!resolved[1] || inputs.some((input, index) => input.value.trim() && !resolved[index])) {
          setStatus('Completa materia, docente e classe scegliendo elementi già presenti nelle griglie.', 'warning');
          if (state.lesson) syncRow();
          return;
        }
        const beforeUnknownIds = new Set(['subjects', 'classes'].flatMap(collection => timetable.entities[collection].map(item => item.id)));
        const subject = resolved[0] || ensureUnknownEntity(timetable, 'subjects');
        const teacher = resolved[1];
        const schoolClass = resolved[2] || ensureUnknownEntity(timetable, 'classes');
        const room = resolved[3];
        const unknownChoices = [['subjects', subject], ['classes', schoolClass]];
        const createdUnknownIds = [];
        for (const [collection, item] of unknownChoices) {
          if (!byId[collection].has(item.id)) {
            byId[collection].set(item.id, item);
            byName[collection].set(normalizedName(item.name), item);
            document.querySelector(`#${choiceLists[collection]}`)?.append(element(document, 'option', { value: item.name }));
            renderEntities(collection);
          }
          if (!beforeUnknownIds.has(item.id)) createdUnknownIds.push(item.id);
        }
        const next = {
          id: state.lesson?.id || `lesson:school-${Date.now()}-${values.length + 1}`,
          sourceIndex: state.lesson?.sourceIndex ?? values.length,
          subjectId: subject.id, teacherIds: [teacher.id], classIds: [schoolClass.id], roomIds: room ? [room.id] : [],
          durationPeriods: Number(duration.value), assignedTime: state.lesson?.assignedTime || null,
          timeframes: state.lesson?.timeframes || { unavailable: [], desired: [], undesired: [] },
        };
        const previous = state.lesson;
        const changed = !previous || previous.subjectId !== next.subjectId
          || previous.teacherIds?.[0] !== next.teacherIds[0] || previous.classIds?.[0] !== next.classIds[0]
          || previous.roomIds?.[0] !== next.roomIds[0] || previous.durationPeriods !== next.durationPeriods;
        if (!changed) return;
        const wasFresh = state.fresh;
        rememberLesson(state.index, previous, createdUnknownIds);
        if (wasFresh) {
          values.push(next);
          state.index = values.length - 1;
          state.fresh = false;
          state.row = row;
          row.dataset.row = String(state.index);
          row.dataset.lessonId = next.id;
          delete row.dataset.newRow;
          bindDetailRow(row, { type: 'lessons', id: next.id });
          const freshState = { index: values.length, lesson: null, fresh: true };
          appendLesson(freshState);
        } else values[state.index] = next;
        state.lesson = next;
        syncRow();
        applyGridFilter('lessons');
        updateEntityUsage();
        if (previous?.subjectId !== next.subjectId && ['unavailable', 'desired', 'undesired'].some(kind => previous?.timeframes?.[kind]?.length)) renderConstraints();
        const usedUnknown = !resolved[0] || !resolved[2];
        commit(wasFresh && usedUnknown
          ? 'Lezione aggiunta; materia o classe mancanti impostate su UNKNOWN.'
          : wasFresh ? 'Requisito lezione aggiunto.' : 'Requisito lezione aggiornato.');
        if (wasFresh) lessonTable.querySelector('[data-new-row="true"] input')?.focus();
      };
      [...inputs, duration].forEach(input => input.addEventListener('change', save));
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target === inputs[2]) {
          event.preventDefault();
          save();
          const visibleRows = [...body.querySelectorAll('tr')].filter(item => !item.hidden);
          const rowIndex = visibleRows.indexOf(row);
          visibleRows[rowIndex + 1]?.querySelector('input[aria-label="Classe"]')?.focus();
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && (event.ctrlKey || event.metaKey) && !state.fresh) {
          if (state.lesson.timeframes?.unavailable?.length || state.lesson.timeframes?.undesired?.length || state.lesson.timeframes?.desired?.length) {
            setStatus('Rimuovi prima i vincoli collegati a questa lezione.', 'warning');
            return;
          }
          event.preventDefault(); remember(); values.splice(state.index, 1); render(); commit('Lezione rimossa.');
        }
      });
    };
    values.forEach((lesson, index) => appendLesson({ lesson, index, fresh: false }));
    appendLesson({ lesson: null, index: values.length, fresh: true });
    applyGridFilter('lessons');
    updateLessonView();
  }

  function lessonGroupingKey(lesson, omit = null) {
    const sortedIds = ids => [...(ids || [])].sort((left, right) => sortCollator.compare(String(left), String(right)));
    const frames = ['unavailable', 'undesired', 'desired'].map(kind => [kind, [...(lesson.timeframes?.[kind] || [])].sort((left, right) => String(left).localeCompare(String(right), 'it', { numeric: true }))]);
    return JSON.stringify([
      lesson.subjectId || '', omit === 'teacher' ? [] : sortedIds(lesson.teacherIds), omit === 'class' ? [] : sortedIds(lesson.classIds), omit === 'room' ? [] : sortedIds(lesson.roomIds),
      lesson.durationPeriods || 1, frames,
    ]);
  }

  function setLessonGroupMode(mode, toggle = false) {
    lessonGroupMode = toggle && lessonGroupMode === mode ? 'equivalent' : mode;
    groupedLessonView = true;
    updateLessonView();
    renderLessonGroups();
  }

  function lessonFrameSummary(lesson) {
    const labels = { unavailable: 'Hard', undesired: 'Soft da evitare', desired: 'Soft preferita' };
    const formatTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    return ['unavailable', 'undesired', 'desired'].flatMap(kind => (lesson.timeframes?.[kind] || []).map(slot => {
      const match = /^(\d+)\.(\d+)$/.exec(String(slot));
      if (!match) return `${labels[kind]} · fascia non specificata`;
      const day = timetable.calendar.days.find(item => item.index === Number(match[1]));
      const period = timetable.calendar.periods.find(item => item.index === Number(match[2]));
      return `${labels[kind]} · ${day?.shortName || day?.name || 'Giorno non specificato'} ${period ? formatTime(period.beginMinute) : 'ora non specificata'}`;
    }));
  }

  function lessonOccurrenceTime(lesson) {
    if (!lesson.assignedTime) return 'Orario non assegnato';
    const day = timetable.calendar.days[lesson.assignedTime.dayIndex]?.name || 'Giorno non specificato';
    const start = timetable.calendar.periods[lesson.assignedTime.periodIndex];
    const end = timetable.calendar.periods[lesson.assignedTime.periodIndex + (lesson.durationPeriods || 1) - 1];
    const format = period => period ? `${String(Math.floor(period.beginMinute / 60)).padStart(2, '0')}:${String(period.beginMinute % 60).padStart(2, '0')}` : '';
    const endTime = end ? `${String(Math.floor(end.endMinute / 60)).padStart(2, '0')}:${String(end.endMinute % 60).padStart(2, '0')}` : '';
    return `${day} ${format(start)}–${endTime}`;
  }

  function updateLessonView() {
    if (!lessonGroups || !lessonViewToggle) return;
    lessonGroups.hidden = !groupedLessonView;
    lessonTable.hidden = groupedLessonView;
    lessonViewToggle.textContent = groupedLessonView ? 'Vista tabellare' : 'Vista raggruppata';
    lessonViewToggle.setAttribute('aria-pressed', String(groupedLessonView));
    if (lessonGroupCount) lessonGroupCount.hidden = !groupedLessonView;
    if (lessonGroupModes) lessonGroupModes.hidden = !groupedLessonView;
    document.querySelectorAll('[data-lesson-group-mode]').forEach(button => {
      const active = button.dataset.lessonGroupMode === lessonGroupMode;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
  }

  function renderLessonGroups() {
    if (!lessonGroups) return;
    lessonGroups.replaceChildren();
    const rows = [...lessonTable.querySelectorAll('tbody tr[data-lesson-id]:not([data-new-row="true"])')].filter(row => !row.hidden);
    const grouped = new Map();
    const lessonIndexes = new Map(timetable.lessons.map((lesson, index) => [lesson.id, index]));
    const lessonsById = new Map(timetable.lessons.map(lesson => [lesson.id, lesson]));
    const ownerMode = ['teacher', 'class', 'room'].includes(lessonGroupMode) ? lessonGroupMode : null;
    const ownerCollection = ownerMode === 'teacher' ? 'teachers' : ownerMode === 'class' ? 'classes' : 'rooms';
    const ownerIdSet = lesson => [...(ownerMode === 'teacher' ? lesson.teacherIds || [] : ownerMode === 'class' ? lesson.classIds || [] : lesson.roomIds || [])]
      .sort((left, right) => sortCollator.compare(String(left), String(right)));
    rows.forEach(row => {
      const lesson = lessonsById.get(row.dataset.lessonId);
      if (!lesson || !lessonIndexes.has(lesson.id)) return;
      const key = lessonGroupingKey(lesson, ownerMode);
      const lessonOwners = ownerMode ? ownerIdSet(lesson).map(id => [id]) : [[]];
      if (ownerMode && !lessonOwners.length) lessonOwners.push([]);
      for (const ownerIds of lessonOwners) {
        const ownerKey = ownerMode ? JSON.stringify(ownerIds) : '';
        const mapKey = ownerMode ? `${ownerKey}\u0000${key}` : key;
        if (!grouped.has(mapKey)) grouped.set(mapKey, { key, stateKey: mapKey, ownerKey, ownerIds, lessonIndexes: [] });
        grouped.get(mapKey).lessonIndexes.push(lessonIndexes.get(lesson.id));
      }
    });
    const nameFor = (collection, id) => timetable.entities[collection].find(item => item.id === id)?.name || 'Non assegnato';
    const namesFor = (collection, ids) => (ids || []).map(id => nameFor(collection, id)).join(', ') || 'Non assegnato';
    const visibleLessonIds = new Set();
    const owners = new Map();
    for (const group of grouped.values()) {
      const ownerKey = ownerMode ? group.ownerKey : '';
      if (!owners.has(ownerKey)) owners.set(ownerKey, { ownerIds: group.ownerIds, groups: [] });
      owners.get(ownerKey).groups.push(group);
    }
    for (const [ownerKey, owner] of owners) {
      let ownerContent = null;
      let subjectGroups = null;
      if (ownerMode) {
        const ownerLessonCount = owner.groups.reduce((count, group) => count + group.lessonIndexes.length, 0);
        const ownerArticle = element(document, 'section', { class: 'lesson-owner' });
        const ownerStateKey = `${ownerMode}:${ownerKey}`;
        const ownerExpanded = !collapsedLessonOwners.has(ownerStateKey);
        const ownerHeader = element(document, 'button', {
          type: 'button', class: 'lesson-owner-toggle', 'aria-expanded': String(ownerExpanded),
          'aria-label': `${ownerExpanded ? 'Nascondi' : 'Mostra'} lezioni per ${namesFor(ownerCollection, owner.ownerIds)}`,
        });
        const ownerName = ownerMode === 'teacher' ? 'Docente' : ownerMode === 'class' ? 'Classe' : 'Aula';
        ownerHeader.append(
          element(document, 'span', { class: 'lesson-owner-name' }, `${ownerName} · ${namesFor(ownerCollection, owner.ownerIds)}`),
          element(document, 'span', { class: 'lesson-group-count' }, `${ownerLessonCount} ${ownerLessonCount === 1 ? 'lezione' : 'lezioni'}`),
        );
        ownerContent = element(document, 'div', { class: 'lesson-owner-groups' });
        ownerContent.hidden = !ownerExpanded;
        subjectGroups = new Map();
        for (const group of owner.groups) {
          const lesson = timetable.lessons[group.lessonIndexes[0]];
          const subjectId = lesson?.subjectId || '';
          if (!subjectGroups.has(subjectId)) subjectGroups.set(subjectId, { subjectId, groups: [] });
          subjectGroups.get(subjectId).groups.push(group);
        }
        for (const [subjectId, subjectGroup] of subjectGroups) {
          const subjectLessons = subjectGroup.groups.flatMap(group => group.lessonIndexes);
          const subjectStateKey = `${ownerMode}:${ownerKey}:${subjectId || 'unknown'}`;
          const subjectExpanded = !collapsedLessonSubjects.has(subjectStateKey);
          const subjectSection = element(document, 'section', { class: 'lesson-subject-group' });
          const subjectHeader = element(document, 'button', {
            type: 'button', class: 'lesson-subject-toggle', 'aria-expanded': String(subjectExpanded),
            'aria-label': `${subjectExpanded ? 'Nascondi' : 'Mostra'} materia ${nameFor('subjects', subjectId)}`,
          });
          subjectHeader.append(
            element(document, 'span', { class: 'lesson-subject-name' }, `Materia · ${nameFor('subjects', subjectId)}`),
            element(document, 'span', { class: 'lesson-group-count' }, `${subjectLessons.length} ${subjectLessons.length === 1 ? 'lezione' : 'lezioni'}`),
          );
          const subjectContent = element(document, 'div', { class: 'lesson-subject-content' });
          subjectContent.hidden = !subjectExpanded;
          subjectHeader.addEventListener('click', () => {
            const expanded = subjectHeader.getAttribute('aria-expanded') !== 'true';
            if (expanded) collapsedLessonSubjects.delete(subjectStateKey);
            else collapsedLessonSubjects.add(subjectStateKey);
            subjectHeader.setAttribute('aria-expanded', String(expanded));
            subjectHeader.setAttribute('aria-label', `${expanded ? 'Nascondi' : 'Mostra'} materia ${nameFor('subjects', subjectId)}`);
            subjectContent.hidden = !expanded;
          });
          subjectSection.append(subjectHeader, subjectContent);
          ownerContent.append(subjectSection);
          subjectGroup.content = subjectContent;
        }
        ownerHeader.addEventListener('click', () => {
          const expanded = ownerHeader.getAttribute('aria-expanded') !== 'true';
          if (expanded) collapsedLessonOwners.delete(ownerStateKey);
          else collapsedLessonOwners.add(ownerStateKey);
          ownerHeader.setAttribute('aria-expanded', String(expanded));
          ownerHeader.setAttribute('aria-label', `${expanded ? 'Nascondi' : 'Mostra'} lezioni per ${namesFor(ownerCollection, owner.ownerIds)}`);
          ownerContent.hidden = !expanded;
        });
        ownerArticle.append(ownerHeader, ownerContent);
        lessonGroups.append(ownerArticle);
      }
      for (const group of owner.groups) {
      const lessons = group.lessonIndexes.map(index => timetable.lessons[index]);
      lessons.forEach(lesson => visibleLessonIds.add(lesson.id));
      const first = lessons[0];
      const subject = nameFor('subjects', first.subjectId);
      const teacherNames = namesFor('teachers', first.teacherIds);
      const classNames = namesFor('classes', first.classIds);
      const roomNames = namesFor('rooms', first.roomIds);
      const article = element(document, 'article', { class: 'lesson-group' });
      const expanded = expandedLessonGroups.has(group.stateKey);
      const header = element(document, 'button', {
        type: 'button', class: 'lesson-group-toggle', 'aria-expanded': String(expanded),
        'aria-label': `${expanded ? 'Nascondi' : 'Mostra'} ${lessons.length} lezioni: ${subject}, ${classNames}`,
      });
      const summary = element(document, 'span', { class: 'lesson-group-info' });
      if (!ownerMode) summary.append(element(document, 'strong', { class: 'lesson-group-subject' }, subject));
      const configParts = [
        ownerMode === 'teacher' ? null : teacherNames,
        ownerMode === 'class' ? null : classNames,
        ownerMode === 'room' ? null : roomNames,
        `${first.durationPeriods || 1} ${(first.durationPeriods || 1) === 1 ? 'ora' : 'ore'}`,
      ].filter(Boolean);
      summary.append(element(document, 'span', { class: 'lesson-group-config' }, configParts.join(' · ')));
      header.append(summary, element(document, 'span', { class: 'lesson-group-count' }, `${lessons.length} ${lessons.length === 1 ? 'lezione' : 'lezioni'}`));
      const occurrences = element(document, 'div', { class: 'lesson-group-occurrences' });
      occurrences.hidden = !expanded;
      const frameSummary = lessonFrameSummary(first);
      if (frameSummary.length) occurrences.append(element(document, 'p', { class: 'lesson-group-constraints' }, frameSummary.join(' · ')));
      for (const index of group.lessonIndexes) {
        const lesson = timetable.lessons[index];
        const lessonNumber = Number.isInteger(lesson.sourceIndex) ? lesson.sourceIndex + 1 : index + 1;
        const occurrence = element(document, 'button', {
          type: 'button', class: `lesson-occurrence${selectedDetailKey === `lessons:${lesson.id}` ? ' is-selected' : ''}`,
          'data-lesson-id': lesson.id, 'aria-label': `Apri dettaglio lezione ${lessonNumber}, ${lessonOccurrenceTime(lesson)}`,
        }, `Lezione ${lessonNumber} · ${lessonOccurrenceTime(lesson)}`);
        occurrence.addEventListener('click', () => {
          selectedDetailKey = `lessons:${lesson.id}`;
          lessonGroups.querySelectorAll('.lesson-occurrence.is-selected').forEach(item => item.classList.remove('is-selected'));
          occurrence.classList.add('is-selected');
          lessonTable.querySelectorAll('tbody .is-selected').forEach(item => {
            item.classList.remove('is-selected');
            item.setAttribute('aria-selected', 'false');
          });
          const row = [...lessonTable.querySelectorAll('tbody tr[data-lesson-id]')].find(item => item.dataset.lessonId === lesson.id);
          row?.classList.add('is-selected');
          row?.setAttribute('aria-selected', 'true');
          onDetail({ type: 'lessons', id: lesson.id });
        });
        occurrences.append(occurrence);
      }
      header.addEventListener('click', () => {
        if (expandedLessonGroups.has(group.stateKey)) expandedLessonGroups.delete(group.stateKey);
        else expandedLessonGroups.add(group.stateKey);
        const isExpanded = expandedLessonGroups.has(group.stateKey);
        header.setAttribute('aria-expanded', String(isExpanded));
        header.setAttribute('aria-label', `${isExpanded ? 'Nascondi' : 'Mostra'} ${lessons.length} lezioni: ${subject}, ${classNames}`);
        occurrences.hidden = !isExpanded;
      });
      article.append(header, occurrences);
      if (ownerMode) {
        const subjectId = first.subjectId || '';
        subjectGroups.get(subjectId)?.content.append(article);
      } else lessonGroups.append(article);
      }
    }
    if (!grouped.size) lessonGroups.append(element(document, 'p', { class: 'muted lesson-groups-empty' }, 'Nessuna lezione corrisponde alla ricerca.'));
    const ownerCount = ownerMode ? owners.size : grouped.size;
    const visibleLessonCount = visibleLessonIds.size;
    if (lessonGroupCount) lessonGroupCount.textContent = `${ownerCount} ${ownerMode ? (ownerMode === 'teacher' ? 'docenti' : 'aule') : 'gruppi'} · ${visibleLessonCount} ${visibleLessonCount === 1 ? 'lezione' : 'lezioni'}`;
  }

  function updateEntityUsage() {
    const counts = Object.fromEntries(['teachers', 'classes', 'subjects', 'rooms'].map(collection => [collection, new Map()]));
    for (const lesson of timetable.lessons) {
      for (const [collection, ids] of [['teachers', lesson.teacherIds || []], ['classes', lesson.classIds || []], ['rooms', lesson.roomIds || []], ['subjects', lesson.subjectId ? [lesson.subjectId] : []]]) {
        for (const id of ids) counts[collection].set(id, (counts[collection].get(id) || 0) + 1);
      }
    }
    for (const collection of Object.keys(counts)) {
      const table = tables[collection];
      timetable.entities[collection].forEach((entity, index) => {
        const row = table.querySelector(`tbody tr[data-row="${index}"]`);
        const usage = row?.querySelector('.grid-usage');
        if (!row || !usage) return;
        usage.textContent = `${counts[collection].get(entity.id) || 0} lezioni`;
        row.dataset.filterValues = JSON.stringify([entity.name, usage.textContent]);
        row.dataset.sortValues = row.dataset.filterValues;
        row.dataset.search = normalizedSearch(`${entity.name} ${COLLECTION_LABELS[collection]} ${usage.textContent} ${JSON.stringify(entity)}`);
      });
      applyGridFilter(collection);
    }
  }

  function allConstraints() {
    const rows = [];
    const addScopes = (collection, scope) => timetable.entities[collection].forEach(entity => {
      for (const kind of ['unavailable', 'undesired', 'desired']) for (const slot of entity.constraints?.timeframes?.[kind] || []) rows.push({ scope, id: entity.id, name: entity.name, kind, slot });
    });
    addScopes('teachers', 'teachers'); addScopes('classes', 'classes'); addScopes('rooms', 'rooms');
    timetable.lessons.forEach(lesson => {
      const subject = timetable.entities.subjects.find(item => item.id === lesson.subjectId)?.name || 'Lezione';
      for (const kind of ['unavailable', 'undesired', 'desired']) for (const slot of lesson.timeframes?.[kind] || []) rows.push({ scope: 'lessons', id: lesson.id, name: subject, kind, slot });
    });
    return rows;
  }

  function constraintTarget(scope, id) {
    return scope === 'lessons' ? timetable.lessons.find(item => item.id === id) : timetable.entities[scope]?.find(item => item.id === id);
  }

  function renderConstraints() {
    const body = editableTable(constraintTable, 'constraints', ['Elemento', 'Vincolo', 'Giorno', 'Ora']);
    const allRows = allConstraints();
    const query = normalizedSearch(constraintFilter.value);
    const scopeLabels = { teachers: 'Docente', classes: 'Classe', rooms: 'Aula', lessons: 'Lezione' };
    const kindLabels = { unavailable: 'Hard · Indisponibilità', undesired: 'Soft · Da evitare', desired: 'Soft · Preferita' };
    const shortDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    const constraintDetails = row => {
      const match = /^(\d+)\.(\d+)$/.exec(String(row.slot || ''));
      const dayIndex = match ? Number(match[1]) : null;
      const periodIndex = match ? Number(match[2]) : null;
      const dayRecord = dayIndex == null ? null : timetable.calendar.days.find(item => item.index === dayIndex);
      const period = periodIndex == null ? null : timetable.calendar.periods.find(item => item.index === periodIndex);
      const day = dayRecord?.name || 'Giorno non specificato';
      const time = period
        ? `${String(Math.floor(period.beginMinute / 60)).padStart(2, '0')}:${String(period.beginMinute % 60).padStart(2, '0')}`
        : 'Ora non specificata';
      const kind = kindLabels[row.kind] || row.kind;
      const scope = scopeLabels[row.scope] || row.scope;
      return { values: [`${scope} · ${row.name}`, kind, day, time], search: `${row.name} ${row.scope} ${scope} ${row.kind} ${kind} ${row.slot || ''} ${day} ${time}`, dayIndex: dayRecord ? dayIndex : null, periodIndex, period };
    };
    const constraintStatus = row => evaluateConstraintStatus(timetable, row);
    const constraintStatusLabel = status => ({ satisfied: 'Rispettato', unsatisfied: 'Non rispettato', pending: 'Da verificare', unverified: 'Esito non verificabile' })[status];
    const columnQueries = columnFilters.constraints.map(normalizedSearch);
    const rows = allRows.filter(row => {
      const details = constraintDetails(row);
      const values = details.values.map(normalizedSearch);
      return (!query || normalizedSearch(details.search).includes(query))
        && columnQueries.every((value, index) => !value || (values[index] || '').includes(value));
    });
    const constraintSort = sortStates.constraints;
    const compareRows = (left, right) => {
      const leftDetails = constraintDetails(left), rightDetails = constraintDetails(right);
      if (constraintSort) {
        const index = constraintSort.columnIndex;
        let compared = index === 2 ? (leftDetails.dayIndex ?? Number.MAX_SAFE_INTEGER) - (rightDetails.dayIndex ?? Number.MAX_SAFE_INTEGER)
          : index === 3 ? (leftDetails.period?.beginMinute ?? Number.MAX_SAFE_INTEGER) - (rightDetails.period?.beginMinute ?? Number.MAX_SAFE_INTEGER)
            : sortCollator.compare(leftDetails.values[index] || '', rightDetails.values[index] || '');
        if (compared) return compared * (constraintSort.direction === 'asc' ? 1 : -1);
      }
      return sortCollator.compare(leftDetails.values[0], rightDetails.values[0])
        || sortCollator.compare(left.kind, right.kind)
        || (leftDetails.period?.beginMinute ?? Number.MAX_SAFE_INTEGER) - (rightDetails.period?.beginMinute ?? Number.MAX_SAFE_INTEGER)
        || (leftDetails.dayIndex ?? Number.MAX_SAFE_INTEGER) - (rightDetails.dayIndex ?? Number.MAX_SAFE_INTEGER)
        || sortCollator.compare(String(left.slot || ''), String(right.slot || ''));
    };
    rows.sort(compareRows);
    const pageCount = Math.max(1, Math.ceil(rows.length / CONSTRAINT_PAGE_SIZE));
    constraintPage = Math.min(constraintPage, pageCount - 1);
    const offset = constraintPage * CONSTRAINT_PAGE_SIZE;
    const pageRows = rows.slice(offset, offset + CONSTRAINT_PAGE_SIZE);
    const groupsByKey = new Map();
    for (const record of rows) {
      const detail = constraintDetails(record);
      const timeKey = detail.period ? `${detail.period.index}:${detail.period.beginMinute}:${detail.period.endMinute}` : `unspecified:${record.slot || ''}`;
      const dayKey = detail.dayIndex == null ? `unspecified:${record.slot || ''}` : 'calendar-days';
      const key = JSON.stringify([record.scope, record.id, record.kind, timeKey, dayKey]);
      if (!groupsByKey.has(key)) groupsByKey.set(key, { key, scope: record.scope, id: record.id, name: record.name, kind: record.kind, periodIndex: detail.periodIndex, period: detail.period, records: [] });
      groupsByKey.get(key).records.push(structuredClone(record));
    }
    const groups = [...groupsByKey.values()];
    const groupSortValue = (group, index) => constraintDetails(group.records[0]).values[index] || '';
    groups.sort((left, right) => {
      if (constraintSort) {
        const index = constraintSort.columnIndex;
        let compared = index === 2
          ? Math.min(...left.records.map(item => constraintDetails(item).dayIndex ?? Number.MAX_SAFE_INTEGER)) - Math.min(...right.records.map(item => constraintDetails(item).dayIndex ?? Number.MAX_SAFE_INTEGER))
          : index === 3 ? (left.period?.beginMinute ?? Number.MAX_SAFE_INTEGER) - (right.period?.beginMinute ?? Number.MAX_SAFE_INTEGER)
            : sortCollator.compare(groupSortValue(left, index), groupSortValue(right, index));
        if (compared) return compared * (constraintSort.direction === 'asc' ? 1 : -1);
      }
      return sortCollator.compare(left.name, right.name)
        || sortCollator.compare(left.scope, right.scope)
        || sortCollator.compare(left.kind, right.kind)
        || (left.period?.beginMinute ?? Number.MAX_SAFE_INTEGER) - (right.period?.beginMinute ?? Number.MAX_SAFE_INTEGER)
        || (left.records[0]?.slot || '').localeCompare(right.records[0]?.slot || '', 'en', { numeric: true });
    });
    const groupPageCount = Math.max(1, Math.ceil(groups.length / CONSTRAINT_PAGE_SIZE));
    groupedConstraintPage = Math.min(groupedConstraintPage, groupPageCount - 1);
    const groupOffset = groupedConstraintPage * CONSTRAINT_PAGE_SIZE;
    const visibleGroups = groups.slice(groupOffset, groupOffset + CONSTRAINT_PAGE_SIZE);
    constraintCount.textContent = groupedConstraintView
      ? (groups.length ? `${groupOffset + 1}–${Math.min(groupOffset + CONSTRAINT_PAGE_SIZE, groups.length)} gruppi · ${rows.length} vincoli` : 'Nessun vincolo')
      : (rows.length ? `${offset + 1}–${Math.min(offset + CONSTRAINT_PAGE_SIZE, rows.length)} di ${rows.length}` : 'Nessun vincolo');
    previousConstraints.disabled = groupedConstraintView ? groupedConstraintPage === 0 : constraintPage === 0;
    nextConstraints.disabled = groupedConstraintView ? groupedConstraintPage >= groupPageCount - 1 : constraintPage >= pageCount - 1;
    if (constraintViewToggle) constraintViewToggle.textContent = groupedConstraintView ? 'Vista tabellare' : 'Vista raggruppata';
    body.hidden = groupedConstraintView;
    if (constraintGroups) {
      constraintGroups.hidden = !groupedConstraintView;
      constraintGroups.replaceChildren();
      const elementsByKey = new Map();
      for (const group of visibleGroups) {
        const elementKey = JSON.stringify([group.scope, group.id]);
        if (!elementsByKey.has(elementKey)) elementsByKey.set(elementKey, { scope: group.scope, id: group.id, name: group.name, groups: [] });
        elementsByKey.get(elementKey).groups.push(group);
      }
      for (const owner of elementsByKey.values()) {
        const section = element(document, 'section', { class: 'constraint-element-group' });
        const ownerButton = element(document, 'button', { type: 'button', class: 'constraint-element-heading', 'aria-label': `Apri dettagli ${scopeLabels[owner.scope] || owner.scope} ${owner.name}` });
        const ownerName = element(document, 'strong', {}, `${scopeLabels[owner.scope] || owner.scope} · ${owner.name}`);
        const ownerCount = element(document, 'span', { class: 'constraint-element-count' }, `${owner.groups.reduce((sum, group) => sum + group.records.length, 0)} vincoli`);
        ownerButton.append(ownerName, ownerCount);
        ownerButton.addEventListener('click', () => onDetail({ type: owner.scope, id: owner.id, source: 'global-constraints' }));
        section.append(ownerButton);
        const kinds = [...new Set(owner.groups.map(group => group.kind))];
        for (const kind of kinds) {
          const typeGroup = element(document, 'section', { class: `constraint-type-group constraint-category-${kind}` });
          const typeHeading = element(document, 'div', { class: 'constraint-type-heading' });
          const typeLabel = element(document, 'span', { class: `constraint-type-label constraint-category-${kind}` }, kindLabels[kind] || kind);
          typeHeading.append(typeLabel);
          typeGroup.append(typeHeading);
          for (const group of owner.groups.filter(item => item.kind === kind)) {
            const article = element(document, 'article', { class: `constraint-group constraint-category-${group.kind}` });
            const heading = element(document, 'div', { class: 'constraint-group-heading' });
            const periodLabel = group.period
              ? `${String(Math.floor(group.period.beginMinute / 60)).padStart(2, '0')}:${String(group.period.beginMinute % 60).padStart(2, '0')}`
              : 'Ora non specificata';
            const selectGroup = element(document, 'button', { type: 'button', class: 'constraint-group-select', 'aria-label': `Dettaglio ${kindLabels[group.kind] || group.kind}, ${periodLabel}` });
            const time = element(document, 'span', { class: 'constraint-group-time' }, periodLabel);
            selectGroup.append(time);
            selectGroup.addEventListener('click', () => onDetail({ type: 'constraint-group', group: structuredClone(group), source: 'global-constraints' }));
            const expand = element(document, 'button', { type: 'button', class: 'constraint-group-expand', 'aria-expanded': 'false' }, `Occorrenze (${group.records.length})`);
            const occurrences = element(document, 'div', { class: 'constraint-occurrences', hidden: '' });
            expand.addEventListener('click', () => {
              const expanded = expand.getAttribute('aria-expanded') === 'true';
              expand.setAttribute('aria-expanded', String(!expanded));
              occurrences.hidden = expanded;
            });
            const days = element(document, 'div', { class: 'constraint-weekdays', 'aria-label': 'Giorni interessati' });
            for (const record of group.records) {
              const detail = constraintDetails(record);
              const status = constraintStatus(record);
              const statusLabel = constraintStatusLabel(status);
              const dayText = detail.dayIndex == null ? 'Giorno n.s.' : shortDays[detail.dayIndex] || `G${detail.dayIndex + 1}`;
              const badge = element(document, detail.dayIndex == null ? 'span' : 'button', {
                ...(detail.dayIndex == null ? {} : { type: 'button', 'aria-label': `Apri vincolo ${detail.values[2]}, ${detail.values[3]} · ${statusLabel}` }),
                class: `constraint-weekday${detail.dayIndex == null ? '' : ` constraint-weekday-button${status === 'satisfied' || status === 'unsatisfied' ? ` constraint-status-${status}` : ''}`}`,
                title: `${detail.values[2]} · ${statusLabel}`,
              }, dayText);
              if (detail.dayIndex != null) badge.addEventListener('click', () => onDetail({ type: 'constraint', constraint: structuredClone(record), source: 'global-constraints' }));
              days.append(badge);
              const statusClass = status === 'satisfied' || status === 'unsatisfied' ? ` constraint-status-${status}` : '';
              const occurrence = element(document, 'button', { type: 'button', class: `constraint-occurrence${statusClass}`, 'aria-label': `Apri vincolo ${detail.values[2]}, ${detail.values[3]} · ${statusLabel}` }, `${detail.values[2]} · ${detail.values[3]} · ${statusLabel}`);
              occurrence.addEventListener('click', () => onDetail({ type: 'constraint', constraint: structuredClone(record), source: 'global-constraints' }));
              occurrences.append(occurrence);
            }
            heading.append(selectGroup, expand);
            article.append(heading, days, occurrences);
            typeGroup.append(article);
          }
          section.append(typeGroup);
        }
        constraintGroups.append(section);
      }
    }
    pageRows.forEach((constraint, index) => {
      const row = element(document, 'tr', { 'data-row': offset + index });
      row.dataset.kind = constraint.kind;
      const details = constraintDetails(constraint);
      row.dataset.filterValues = JSON.stringify(details.values);
      row.dataset.sortValues = row.dataset.filterValues;
      row.dataset.search = normalizedSearch(details.search);
      for (const value of details.values) {
        const cell = element(document, 'td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
      bindDetailRow(row, { type: 'constraint', constraint: structuredClone(constraint) });
    });
  }

  function render() {
    for (const collection of Object.keys(tables)) renderEntities(collection);
    if (studentTable) renderStudents();
    renderLessons();
    renderConstraints();
  }

  for (const [gridName, filter] of Object.entries(gridFilters)) filter?.addEventListener('input', () => applyGridFilter(gridName));
  lessonViewToggle?.addEventListener('click', () => {
    groupedLessonView = !groupedLessonView;
    updateLessonView();
  });
  lessonGroupModes?.querySelectorAll('[data-lesson-group-mode]').forEach(button => {
    button.addEventListener('click', () => setLessonGroupMode(button.dataset.lessonGroupMode, true));
  });
  constraintFilter.addEventListener('input', () => { constraintPage = 0; groupedConstraintPage = 0; renderConstraints(); });
  constraintViewToggle?.addEventListener('click', () => { groupedConstraintView = !groupedConstraintView; renderConstraints(); });
  previousConstraints.addEventListener('click', () => {
    if (groupedConstraintView) groupedConstraintPage = Math.max(0, groupedConstraintPage - 1);
    else constraintPage = Math.max(0, constraintPage - 1);
    renderConstraints();
  });
  nextConstraints.addEventListener('click', () => { if (groupedConstraintView) groupedConstraintPage++; else constraintPage++; renderConstraints(); });
  undoButton.addEventListener('click', () => {
    if (!undoStack.length) return;
    const change = undoStack.pop();
    if (change.type === 'lesson') {
      if (change.previous) timetable.lessons[change.index] = change.previous;
      else timetable.lessons.splice(change.index, 1);
      for (const id of change.createdUnknownIds || []) {
        const used = timetable.lessons.some(lesson => lesson.subjectId === id || lesson.classIds?.includes(id));
        if (used) continue;
        for (const collection of ['subjects', 'classes']) {
          const index = timetable.entities[collection].findIndex(item => item.id === id && item.placeholder === 'unknown');
          if (index >= 0) timetable.entities[collection].splice(index, 1);
        }
      }
    } else timetable = change.timetable;
    undoButton.disabled = !undoStack.length;
    render();
    setStatus('Ultima modifica annullata.');
    onChange(timetable);
  });

  return {
    setTimetable(value) { editingEntity = null; selectedDetailKey = null; timetable = value || createEmptySchool(); timetable.entities.students ||= []; undoStack.length = 0; undoButton.disabled = true; render(); },
    importEntities(collection, incoming = [], sourceInfo = null, calendar = null) {
      const values = timetable.entities[collection];
      if (!Array.isArray(values)) throw new TypeError(`Collezione non importabile: ${collection}.`);
      const knownNames = new Set(values.map(item => item.name.trim().toLocaleLowerCase()));
      const knownIds = new Set(Object.values(timetable.entities).flat().map(item => item.id));
      let duplicates = 0;
      const additions = [];
      for (const item of incoming) {
        if (knownNames.has(item.name.trim().toLocaleLowerCase())) { duplicates++; continue; }
        const next = structuredClone(item);
        if (!next.id || knownIds.has(next.id)) next.id = uniqueId(collection, next.name, [...values, ...additions]);
        if (['teachers', 'classes', 'rooms'].includes(collection)) next.constraints ||= { timeframes: { unavailable: [], desired: [], undesired: [] } };
        additions.push(next); knownNames.add(next.name.trim().toLocaleLowerCase()); knownIds.add(next.id);
      }
      if (additions.length || sourceInfo) {
        remember(); values.push(...additions);
        adoptImportedCalendar(timetable, calendar, sourceInfo);
        if (sourceInfo) {
          timetable.source.rosterImports ||= [];
          timetable.source.rosterImports.push(structuredClone(sourceInfo));
        }
        render();
        setStatus(`${additions.length} ${COLLECTION_IMPORTED[collection] || 'elementi importati'}${duplicates ? `; ${duplicates} duplicati ignorati` : ''}.`);
        onChange(timetable);
      }
      return { imported: additions.length, duplicates };
    },
    importOFDSections(imported, sections, sourceInfo = null) {
      const next = structuredClone(timetable);
      const result = imported?.timetable;
      if (!result) throw new TypeError('Il file OFD non contiene un orario leggibile.');
      const selected = new Set(sections || []);
      if (!selected.size) throw new TypeError('Seleziona almeno una sezione OFD.');
      const empty = !next.lessons.length && Object.values(next.entities).every(items => !items.length);
      if (empty) next.calendar = structuredClone(result.calendar);
      const counts = {};
      const knownIds = new Set(Object.values(next.entities).flat().map(item => item.id));
      for (const collection of ['teachers', 'rooms', 'subjects', 'classes']) {
        if (!selected.has(collection)) { counts[collection] = 0; continue; }
        const values = next.entities[collection];
        let added = 0;
        for (const sourceEntity of result.entities[collection] || []) {
          const existing = values.find(item => normalizedName(item.name) === normalizedName(sourceEntity.name));
          if (existing) continue;
          const entity = structuredClone(sourceEntity);
          if (!entity.id || knownIds.has(entity.id)) entity.id = uniqueId(collection, entity.name, values);
          knownIds.add(entity.id);
          if (['teachers', 'classes', 'rooms'].includes(collection)) {
            if (!selected.has('constraints')) entity.constraints = { timeframes: { unavailable: [], desired: [], undesired: [] } };
            else entity.constraints ||= { timeframes: { unavailable: [], desired: [], undesired: [] } };
          }
          values.push(entity);
          added++;
        }
        counts[collection] = added;
      }
      let constraintsImported = 0, constraintsSkipped = 0;
      if (selected.has('constraints')) {
        for (const collection of ['teachers', 'classes', 'rooms']) {
          const targets = next.entities[collection];
          const sourceTargets = result.entities[collection] || [];
          for (const sourceEntity of sourceTargets) {
            const target = targets.find(item => normalizedName(item.name) === normalizedName(sourceEntity.name));
            if (!target) { constraintsSkipped += 1; continue; }
            target.constraints ||= { timeframes: { unavailable: [], desired: [], undesired: [] } };
            target.constraints.timeframes ||= { unavailable: [], desired: [], undesired: [] };
            const sourceFrames = sourceEntity.constraints?.timeframes || {};
            for (const kind of ['unavailable', 'desired', 'undesired']) {
              target.constraints.timeframes[kind] ||= [];
              for (const sourceSlot of sourceFrames[kind] || []) {
                const [dayIndex, periodIndex] = sourceSlot.split('.').map(Number);
                const sourceDay = result.calendar.days[dayIndex];
                const sourcePeriod = result.calendar.periods[periodIndex];
                const targetDay = next.calendar.days.find((day, index) => day.name === sourceDay?.name || day.shortName === sourceDay?.shortName);
                const targetPeriod = next.calendar.periods.find(period => period.beginMinute === sourcePeriod?.beginMinute && period.endMinute === sourcePeriod?.endMinute);
                if (!targetDay || !targetPeriod) { constraintsSkipped += 1; continue; }
                const slot = `${targetDay.index}.${targetPeriod.index}`;
                if (!target.constraints.timeframes[kind].includes(slot)) target.constraints.timeframes[kind].push(slot);
                constraintsImported++;
              }
            }
          }
        }
      }
      let lessonsDiagnostics = [];
      if (selected.has('lessons')) {
        const documentId = result.source?.documentId;
        const filename = sourceInfo?.filename || '';
        const matchesSource = item => (documentId && item.source?.documentId === documentId) || (filename && item.filename === filename);
        const alreadyImported = (next.source.lessonImports || []).some(matchesSource)
          || (next.source.rosterImports || []).some(item => item.sections?.includes('lessons') && matchesSource(item));
        if (alreadyImported) throw new Error('Le lezioni di questo file OFD risultano già importate.');

        const sourceNames = Object.fromEntries(['teachers', 'classes', 'rooms'].map(collection => [collection,
          new Map((result.entities[collection] || []).map(item => [item.id, item.name]))]));
        const missing = { teachers: new Set(), classes: new Set(), rooms: new Set() };
        const incomingLessons = result.lessons.map(sourceLesson => {
          const lesson = { ...structuredClone(sourceLesson), assignedTime: null };
          for (const collection of Object.keys(missing)) {
            const field = collection === 'teachers' ? 'teacherIds' : collection === 'classes' ? 'classIds' : 'roomIds';
            lesson[field] = (sourceLesson[field] || []).flatMap(id => {
              const name = sourceNames[collection].get(id);
              const target = next.entities[collection].find(item => normalizedName(item.name) === normalizedName(name));
              if (!target) { if (name) missing[collection].add(name); return []; }
              return [target.id];
            });
          }
          return lesson;
        });
        const missingLabels = Object.entries(missing).filter(([, values]) => values.size)
          .map(([collection, values]) => `${collection === 'teachers' ? 'docenti' : collection === 'classes' ? 'classi' : 'aule'}: ${[...values].slice(0, 3).join(', ')}`).join('; ');
        if (missingLabels) throw new Error(`Per importare le lezioni, importa anche le anagrafiche richieste (${missingLabels}).`);

        const adoptCalendar = !next.lessons.length && !next.source?.calendarSourceId;
        const lessonCalendar = adoptCalendar ? result.calendar : next.calendar;
        const sameCalendar = result.calendar.days.length === lessonCalendar.days.length
          && result.calendar.periods.length === lessonCalendar.periods.length
          && result.calendar.periods.every((period, index) => period.beginMinute === lessonCalendar.periods[index]?.beginMinute && period.endMinute === lessonCalendar.periods[index]?.endMinute);
        let preservedTimeframes = 0;
        if (!sameCalendar) for (const lesson of incomingLessons) {
          const frames = lesson.timeframes;
          if (Object.values(frames || {}).some(values => values?.length)) {
            lesson.sourceData = { ...(lesson.sourceData || {}), ofdTimeframes: structuredClone(frames) };
            lesson.timeframes = { unavailable: [], desired: [], undesired: [] };
            preservedTimeframes++;
          }
        }
        const unknownClassIds = new Set(next.entities.classes.filter(item => item.placeholder === 'unknown').map(item => item.id));
        const lessonsWithoutClass = incomingLessons.filter(lesson => !lesson.classIds.length || lesson.classIds.some(id => unknownClassIds.has(id))).length;
        const sourceSubjectIds = new Set((result.entities.subjects || []).map(item => item.id));
        const unknownSubjectIds = new Set((result.entities.subjects || []).filter(item => item.placeholder === 'unknown').map(item => item.id));
        const lessonsWithoutSubject = incomingLessons.filter(lesson => !lesson.subjectId || !sourceSubjectIds.has(lesson.subjectId) || unknownSubjectIds.has(lesson.subjectId)).length;
        lessonsDiagnostics = [
          lessonsWithoutClass && { severity: 'warning', code: 'lesson-without-class', message: `${lessonsWithoutClass} attività OFD usano la classe UNKNOWN; saranno escluse dal calcolo e conservate per la gestione separata.` },
          lessonsWithoutSubject && { severity: 'warning', code: 'lesson-without-subject', message: `${lessonsWithoutSubject} lezioni OFD non hanno una materia; useranno UNKNOWN e il calcolo potrà procedere.` },
          preservedTimeframes && { severity: 'warning', code: 'lesson-timeframes-preserved', message: `${preservedTimeframes} lezioni hanno vincoli temporali conservati nei dati sorgente perché il calendario è diverso.` },
        ].filter(Boolean);
        const lessonSourceInfo = {
          format: 'orario-facile-ofd-lessons', filename,
          source: result.source,
          diagnostics: [...(sourceInfo?.diagnostics || []), ...lessonsDiagnostics],
        };
        const lessonCalendarToAdopt = adoptCalendar ? result.calendar : null;
        const lessonResult = appendImportedLessons(next, incomingLessons, result.entities.subjects || [], lessonSourceInfo, lessonCalendarToAdopt);
        counts.lessons = lessonResult.imported;
        counts.subjects = (counts.subjects || 0) + lessonResult.subjects;
      }
      if (sourceInfo) {
        next.source.rosterImports ||= [];
        next.source.rosterImports.push({ ...structuredClone(sourceInfo), sections: [...selected] });
      }
      if (JSON.stringify(next) !== JSON.stringify(timetable)) {
        remember(); timetable = next; render(); commit('Sezioni OFD importate.');
      }
      return { counts, constraintsImported, constraintsSkipped, lessonsDiagnostics };
    },
    importLessons(incoming = [], incomingSubjects = [], sourceInfo = null, calendar = null) {
      const subjects = timetable.entities.subjects;
      const knownNames = new Map(subjects.map(item => [normalizedName(item.name), item]));
      const knownIds = new Set(Object.values(timetable.entities).flat().map(item => item.id));
      const subjectIds = new Map();
      const subjectAdditions = [];
      for (const item of incomingSubjects) {
        const key = normalizedName(item.name);
        const existing = knownNames.get(key);
        if (existing) { subjectIds.set(item.id, existing.id); continue; }
        const next = structuredClone(item);
        if (!next.id || knownIds.has(next.id)) next.id = uniqueId('subjects', next.name, [...subjects, ...subjectAdditions]);
        subjectAdditions.push(next);
        knownNames.set(key, next);
        knownIds.add(next.id);
        subjectIds.set(item.id, next.id);
      }
      for (const item of incomingSubjects) {
        const matched = knownNames.get(normalizedName(item.name));
        if (matched) subjectIds.set(item.id, matched.id);
      }
      const knownLessonIds = new Set(timetable.lessons.map(item => item.id));
      const sourceId = idPart(sourceInfo?.source?.documentId || sourceInfo?.filename || 'ofd');
      const additions = incoming.map(item => {
        const lesson = structuredClone(item);
        lesson.subjectId = subjectIds.get(item.subjectId) || item.subjectId || null;
        lesson.classIds = (item.classIds || []).filter(id => timetable.entities.classes.some(schoolClass => schoolClass.id === id));
        const stem = `lesson:ofd-${sourceId}-${Number.isInteger(item.sourceIndex) ? item.sourceIndex : 'x'}`;
        let id = stem, suffix = 1;
        while (knownLessonIds.has(id)) id = `${stem}-${++suffix}`;
        lesson.id = id;
        knownLessonIds.add(id);
        return lesson;
      });
      if (additions.length || subjectAdditions.length || sourceInfo) {
        remember();
        subjects.push(...subjectAdditions);
        for (const lesson of additions) {
          if (!subjects.some(item => item.id === lesson.subjectId)) lesson.subjectId = ensureUnknownEntity(timetable, 'subjects').id;
          if (!lesson.classIds.length) lesson.classIds = [ensureUnknownEntity(timetable, 'classes').id];
        }
        timetable.lessons.push(...additions);
        adoptImportedCalendar(timetable, calendar, sourceInfo);
        if (sourceInfo) {
          timetable.source.lessonImports ||= [];
          timetable.source.lessonImports.push(structuredClone(sourceInfo));
        }
        render();
        setStatus(`${additions.length} lezioni importate${subjectAdditions.length ? ` · ${subjectAdditions.length} materie aggiunte` : ''}.`);
        onChange(timetable);
      }
      return { imported: additions.length, subjects: subjectAdditions.length };
    },
    setName(value) { if (value && value !== timetable.name) { remember(); timetable.name = value; commit('Nome scuola aggiornato.'); } },
    setDescription(value) {
      const description = String(value || '').trim();
      if (description !== (timetable.description || '')) { remember(); timetable.description = description; commit('Descrizione scuola aggiornata.'); }
    },
    createEntity(collection, name) {
      const values = timetable.entities[collection];
      const cleanName = String(name || '').trim();
      if (!Array.isArray(values) || !['teachers', 'classes', 'subjects', 'rooms'].includes(collection)) throw new TypeError('Tipo di elemento non gestito.');
      if (!cleanName) throw new TypeError('Inserisci un nome.');
      if (values.some(item => normalizedName(item.name) === normalizedName(cleanName))) throw new TypeError(`Esiste già “${cleanName}”.`);
      const entity = { id: uniqueId(collection, cleanName, values), name: cleanName };
      if (['teachers', 'classes', 'rooms'].includes(collection)) entity.constraints = { timeframes: { unavailable: [], desired: [], undesired: [] } };
      remember(); values.push(entity); render(); commit(`${COLLECTION_LABELS[collection]} aggiunto.`);
      onDetail({ type: collection, id: entity.id });
      return structuredClone(entity);
    },
    updateEntity(collection, id, changes) {
      const entity = timetable.entities[collection]?.find(item => item.id === id);
      if (!entity) throw new RangeError('Elemento non trovato.');
      const name = String(changes?.name ?? entity.name).trim();
      if (!name) throw new TypeError('Il nome non può essere vuoto.');
      if (timetable.entities[collection].some(item => item.id !== id && normalizedName(item.name) === normalizedName(name))) throw new TypeError(`Esiste già “${name}”.`);
      if (name === entity.name) return structuredClone(entity);
      remember(); entity.name = name;
      if (entity.placeholder === 'unknown' && normalizedName(name) !== 'unknown') delete entity.placeholder;
      render(); commit(`${COLLECTION_LABELS[collection]} aggiornato.`);
      return structuredClone(entity);
    },
    deleteEntity(collection, id) {
      const values = timetable.entities[collection];
      const entity = values?.find(item => item.id === id);
      if (!entity) return false;
      const referenced = timetable.lessons.some(lesson => lesson.teacherIds?.includes(id) || lesson.classIds?.includes(id) || lesson.roomIds?.includes(id) || lesson.subjectId === id)
        || (collection === 'classes' && timetable.entities.students?.some(student => student.classId === id));
      if (referenced) throw new TypeError('L’elemento è usato da lezioni o studenti e non può essere eliminato.');
      remember(); values.splice(values.indexOf(entity), 1); render(); commit(`${COLLECTION_LABELS[collection]} rimosso.`);
      return true;
    },
    applyConstraints(constraints, sourceInfo = null) {
      let next = structuredClone(timetable);
      for (const item of constraints || []) next = updateTimeframeConstraint(next, { ...item, action: 'add' });
      if (sourceInfo) {
        next.source.constraintImports ||= [];
        next.source.constraintImports.push(structuredClone(sourceInfo));
      }
      if (JSON.stringify(next) === JSON.stringify(timetable)) return { imported: 0 };
      remember(); timetable = next; render(); commit(`${constraints.length} vincoli importati.`);
      return { imported: constraints.length };
    },
    updateConstraint(change) {
      const next = updateTimeframeConstraint(timetable, change);
      if (JSON.stringify(next) === JSON.stringify(timetable)) return next;
      remember(); timetable = next; render(); commit('Vincolo aggiornato.');
      return structuredClone(timetable);
    },
    deleteConstraintGroup(records = []) {
      if (!records.length) throw new TypeError('Il gruppo non contiene vincoli da eliminare.');
      const scopes = { teachers: 'teacher', classes: 'class', rooms: 'room', lessons: 'lesson' };
      let next = structuredClone(timetable);
      for (const record of records) {
        const scope = scopes[record.scope];
        if (!scope) throw new TypeError('Ambito del vincolo non supportato.');
        const target = record.scope === 'lessons'
          ? next.lessons.find(item => item.id === record.id)
          : next.entities[record.scope]?.find(item => item.id === record.id);
        const frames = record.scope === 'lessons' ? target?.timeframes : target?.constraints?.timeframes;
        if (!frames?.[record.kind]?.includes(record.slot)) throw new TypeError('Un vincolo del gruppo non è più presente.');
        next = updateTimeframeConstraint(next, { scope, id: record.id, kind: record.kind, action: 'delete', slot: record.slot });
      }
      if (JSON.stringify(next) === JSON.stringify(timetable)) return structuredClone(timetable);
      remember(); timetable = next; render(); commit('Gruppo di vincoli eliminato.');
      return structuredClone(timetable);
    },
    updateConstraintGroup({ records = [], kind, periodIndex, targetSlots = [] } = {}) {
      if (!records.length) throw new TypeError('Il gruppo non contiene vincoli da modificare.');
      if (!['unavailable', 'undesired', 'desired'].includes(kind)) throw new TypeError('Tipo di vincolo non supportato.');
      if (!Number.isInteger(periodIndex) || !timetable.calendar.periods.some(period => period.index === periodIndex)) throw new RangeError('La fascia scelta non rientra nel calendario.');
      if (records.every((record, index) => record.kind === kind && /^(\d+)\.(\d+)$/.test(String(record.slot || ''))
        && (targetSlots[index] ? targetSlots[index] === record.slot : Number(record.slot.split('.')[1]) === periodIndex))) return structuredClone(timetable);
      const scopes = { teachers: 'teacher', classes: 'class', rooms: 'room', lessons: 'lesson' };
      let next = structuredClone(timetable);
      for (const record of records) {
        const match = /^(\d+)\.(\d+)$/.exec(String(record.slot || ''));
        if (!match) throw new RangeError('Il gruppo contiene un vincolo senza giorno o fascia modificabile.');
        const dayIndex = Number(match[1]);
        if (!timetable.calendar.days.some(day => day.index === dayIndex)) throw new RangeError('Il gruppo contiene un giorno fuori dal calendario.');
        const scope = scopes[record.scope];
        if (!scope) throw new TypeError('Ambito del vincolo non supportato.');
        next = updateTimeframeConstraint(next, { scope, id: record.id, kind: record.kind, action: 'delete', slot: record.slot });
      }
      for (const [index, record] of records.entries()) {
        const dayIndex = Number(record.slot.split('.')[0]);
        const scope = scopes[record.scope];
        const slot = targetSlots[index] || `${dayIndex}.${periodIndex}`;
        next = updateTimeframeConstraint(next, { scope, id: record.id, kind, action: 'add', slot });
      }
      if (JSON.stringify(next) === JSON.stringify(timetable)) return structuredClone(timetable);
      remember(); timetable = next; render(); commit('Gruppo di vincoli aggiornato.');
      return structuredClone(timetable);
    },
    undo() { if (undoButton.disabled) return false; undoButton.click(); return true; },
    render,
    get timetable() { return timetable; },
  };
}
