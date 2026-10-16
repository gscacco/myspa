import { TIMETABLE_SCHEMA_VERSION } from './domain.js';

const COLLECTION_LABELS = Object.freeze({ teachers: 'Docente', classes: 'Classe', subjects: 'Materia', rooms: 'Aula', students: 'Studente' });
const COLLECTION_IMPORTED = Object.freeze({ teachers: 'docenti importati', classes: 'classi importate', rooms: 'aule importate', students: 'studenti importati' });
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
    source: { format: 'native', version: '1', xml: '', unsupportedStructures: [], assignmentHints: {}, lessonImports: [] },
    calendar: {
      unitMinutes: 60,
      days: days.map((name, index) => ({ index, name, shortName: name.slice(0, 3).toLocaleUpperCase() })),
      periods: Array.from({ length: 6 }, (_, index) => ({ index, beginMinute: 480 + index * 60, endMinute: 540 + index * 60 })),
    },
    entities: { teachers: [], classes: [], subjects: [], rooms: [], students: [] },
    lessons: [], links: [], parameters: [],
  };
}

function element(document, tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

function resourceType(collection) { return collection.slice(0, -1); }
function uniqueId(collection, name, values) {
  const stem = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'elemento';
  let suffix = 1, id = `${COLLECTION_TYPES[collection]}:${stem}-${suffix}`;
  while (values.some(value => value.id === id)) id = `${COLLECTION_TYPES[collection]}:${stem}-${++suffix}`;
  return id;
}

export function createSchoolWorkbench({ document = globalThis.document, onChange = () => {} } = {}) {
  if (!document) throw new TypeError('A document is required to mount the school workbench.');
  const tables = Object.fromEntries(['teachers', 'classes', 'subjects', 'rooms'].map(key => [key, document.querySelector(`#school-grid-${key}`)]));
  const studentTable = document.querySelector('#school-grid-students');
  const lessonTable = document.querySelector('#school-grid-lessons');
  const constraintTable = document.querySelector('#school-grid-constraints');
  const constraintFilter = document.querySelector('#school-constraint-filter');
  const gridFilters = Object.fromEntries(['teachers', 'classes', 'subjects', 'rooms', 'students', 'lessons'].map(key => [key, document.querySelector(`#school-filter-${key}`)]));
  const gridFilterCounts = Object.fromEntries(Object.keys(gridFilters).map(key => [key, document.querySelector(`[data-grid-filter-count="${key}"]`)]));
  const constraintCount = document.querySelector('#school-constraint-count');
  const previousConstraints = document.querySelector('#school-constraint-previous');
  const nextConstraints = document.querySelector('#school-constraint-next');
  const undoButton = document.querySelector('#undo-school-edit');
  const status = document.querySelector('#school-edit-status');
  if ([...Object.values(tables), lessonTable, constraintTable, constraintFilter, constraintCount, previousConstraints, nextConstraints, undoButton, status].some(item => !item)) throw new Error('School workbench controls are missing.');
  let timetable = createEmptySchool();
  let constraintPage = 0;
  const undoStack = [];

  function remember() {
    undoStack.push({ type: 'snapshot', timetable: structuredClone(timetable) });
    if (undoStack.length > 100) undoStack.shift();
    undoButton.disabled = false;
  }

  function rememberLesson(index, previous) {
    undoStack.push({ type: 'lesson', index, previous: previous ? structuredClone(previous) : null });
    if (undoStack.length > 100) undoStack.shift();
    undoButton.disabled = false;
  }

  function commit(message) {
    status.textContent = message;
    onChange(timetable);
  }

  function editableTable(table, gridName, headers) {
    table.replaceChildren();
    table.dataset.grid = gridName;
    const head = element(document, 'thead');
    const row = element(document, 'tr');
    headers.forEach(label => row.append(element(document, 'th', { scope: 'col' }, label)));
    head.append(row);
    table.append(head, element(document, 'tbody'));
    return table.querySelector('tbody');
  }

  function applyGridFilter(gridName) {
    const table = document.querySelector(`#school-grid-${gridName}`);
    const filter = gridFilters[gridName];
    const count = gridFilterCounts[gridName];
    if (!table) return;
    const query = normalizedSearch(filter?.value);
    let matching = 0;
    let total = 0;
    for (const row of table.querySelectorAll('tbody tr')) {
      if (row.dataset.newRow === 'true') { row.hidden = false; continue; }
      total++;
      const visible = !query || normalizedSearch(row.dataset.search).includes(query);
      row.hidden = !visible;
      if (visible) matching++;
    }
    if (count) count.textContent = query ? `${matching} di ${total}` : `${total} elementi`;
  }

  function renderEntities(collection) {
    const table = tables[collection];
    const body = editableTable(table, collection, ['Nome', 'Uso']);
    const values = timetable.entities[collection];
    const addRow = (entity, index, fresh = false) => {
      const row = element(document, 'tr', { 'data-row': index, ...(fresh ? { 'data-new-row': 'true' } : {}) });
      row.dataset.search = `${entity?.name || ''} ${JSON.stringify(entity || {})} ${fresh ? '' : `${COLLECTION_LABELS[collection]} ${timetable.lessons.filter(lesson => lesson[collection === 'teachers' ? 'teacherIds' : collection === 'classes' ? 'classIds' : collection === 'rooms' ? 'roomIds' : 'subjectId']?.includes?.(entity.id) || lesson.subjectId === entity.id).length} lezioni`}`;
      const nameCell = element(document, 'td');
      const input = element(document, 'input', {
        type: 'text', 'data-field': 'name', 'data-row': index, 'data-grid': collection,
        'aria-label': `${COLLECTION_LABELS[collection]} ${index + 1}`,
        placeholder: fresh ? 'Scrivi per aggiungere…' : '', value: entity?.name || '',
      });
      nameCell.append(input);
      row.append(nameCell);
      const usageCell = element(document, 'td', { class: 'grid-usage' }, fresh ? 'Nuova riga' : `${timetable.lessons.filter(lesson => lesson[collection === 'teachers' ? 'teacherIds' : collection === 'classes' ? 'classIds' : collection === 'rooms' ? 'roomIds' : 'subjectId']?.includes?.(entity.id) || lesson.subjectId === entity.id).length} lezioni`);
      row.append(usageCell);
      body.append(row);
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (fresh && !value) return;
        if (values.some(item => item.id !== entity?.id && item.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
          status.textContent = `Esiste già ${COLLECTION_LABELS[collection].toLocaleLowerCase()} “${value}”.`;
          input.value = entity?.name || '';
          return;
        }
        if (!value && entity) {
          const referenced = timetable.lessons.some(lesson => lesson.teacherIds?.includes(entity.id) || lesson.classIds?.includes(entity.id) || lesson.roomIds?.includes(entity.id) || lesson.subjectId === entity.id)
            || (collection === 'classes' && timetable.entities.students?.some(student => student.classId === entity.id));
          const constrained = ['unavailable', 'desired', 'undesired'].some(kind => entity.constraints?.timeframes?.[kind]?.length);
          if (referenced || constrained) {
            status.textContent = `“${entity.name}” è usato da una lezione o ha vincoli: rimuovi prima i riferimenti.`;
            input.value = entity.name;
            return;
          }
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
        } else if (entity.name !== value) {
          remember();
          entity.name = value;
          commit(`${COLLECTION_LABELS[collection]} aggiornato.`);
          render();
          table.querySelector(`[data-row="${index}"] input`)?.focus();
        }
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
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
        if (!value || !select.value) { status.textContent = 'Per registrare uno studente servono nome e classe.'; return; }
        if (values.some(item => item.id !== student?.id && item.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
          status.textContent = `Esiste già lo studente “${value}”.`; name.value = student?.name || ''; return;
        }
        if (fresh) {
          remember(); values.push({ id: uniqueId('students', value, values), name: value, classId: select.value });
          render(); status.textContent = 'Studente aggiunto.'; onChange(timetable);
        } else if (student.name !== value || student.classId !== select.value) {
          remember(); student.name = value; student.classId = select.value; render(); status.textContent = 'Studente aggiornato.'; onChange(timetable);
        }
      };
      name.addEventListener('change', save); select.addEventListener('change', save);
      row.addEventListener('keydown', event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && (event.ctrlKey || event.metaKey) && !fresh) {
          event.preventDefault(); remember(); values.splice(index, 1); render(); status.textContent = 'Studente rimosso.'; onChange(timetable);
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
      durationCell.append(duration); row.append(durationCell); body.append(row);
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
      };
      syncRow();
      const save = () => {
        const resolved = inputs.map((input, fieldIndex) => {
          const collection = fields[fieldIndex][0];
          return byName[collection].get(normalizedName(input.value));
        });
        if (state.fresh && inputs.slice(0, 3).every(input => !input.value.trim())) return;
        if (resolved.slice(0, 3).some(item => !item)) {
          status.textContent = 'Completa materia, docente e classe scegliendo elementi già presenti nelle griglie.';
          if (state.lesson) syncRow();
          return;
        }
        const [subject, teacher, schoolClass, room] = resolved;
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
        rememberLesson(state.index, previous);
        if (wasFresh) {
          values.push(next);
          state.index = values.length - 1;
          state.fresh = false;
          state.row = row;
          row.dataset.row = String(state.index);
          delete row.dataset.newRow;
          const freshState = { index: values.length, lesson: null, fresh: true };
          appendLesson(freshState);
        } else values[state.index] = next;
        state.lesson = next;
        syncRow();
        applyGridFilter('lessons');
        updateEntityUsage();
        if (previous?.subjectId !== next.subjectId && ['unavailable', 'desired', 'undesired'].some(kind => previous?.timeframes?.[kind]?.length)) renderConstraints();
        commit(wasFresh ? 'Requisito lezione aggiunto.' : 'Requisito lezione aggiornato.');
        if (wasFresh) lessonTable.querySelector('[data-new-row="true"] input')?.focus();
      };
      [...inputs, duration].forEach(input => input.addEventListener('change', save));
      row.addEventListener('keydown', event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && (event.ctrlKey || event.metaKey) && !state.fresh) {
          if (state.lesson.timeframes?.unavailable?.length || state.lesson.timeframes?.undesired?.length || state.lesson.timeframes?.desired?.length) {
            status.textContent = 'Rimuovi prima i vincoli collegati a questa lezione.';
            return;
          }
          event.preventDefault(); remember(); values.splice(state.index, 1); render(); commit('Lezione rimossa.');
        }
      });
    };
    values.forEach((lesson, index) => appendLesson({ lesson, index, fresh: false }));
    appendLesson({ lesson: null, index: values.length, fresh: true });
    applyGridFilter('lessons');
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
        const usage = table.querySelector(`tbody tr[data-row="${index}"] .grid-usage`);
        if (usage) usage.textContent = `${counts[collection].get(entity.id) || 0} lezioni`;
      });
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
    const rows = query ? allRows.filter(row => {
      const [dayIndex, periodIndex] = row.slot.split('.').map(Number);
      const day = timetable.calendar.days.find(item => item.index === dayIndex)?.name || '';
      const period = timetable.calendar.periods.find(item => item.index === periodIndex);
      const time = period ? `${String(Math.floor(period.beginMinute / 60)).padStart(2, '0')}:${String(period.beginMinute % 60).padStart(2, '0')}` : '';
      const kind = { unavailable: 'Obbligatorio', undesired: 'Da evitare', desired: 'Preferita' }[row.kind] || row.kind;
      const scope = { teachers: 'Docente', classes: 'Classe', rooms: 'Aula', lessons: 'Lezione' }[row.scope] || row.scope;
      return normalizedSearch(`${row.name} ${row.scope} ${scope} ${row.kind} ${kind} ${row.slot} ${day} ${time}`).includes(query);
    }) : allRows;
    const pageCount = Math.max(1, Math.ceil(rows.length / CONSTRAINT_PAGE_SIZE));
    constraintPage = Math.min(constraintPage, pageCount - 1);
    const offset = constraintPage * CONSTRAINT_PAGE_SIZE;
    const pageRows = rows.slice(offset, offset + CONSTRAINT_PAGE_SIZE);
    constraintCount.textContent = rows.length ? `${offset + 1}–${Math.min(offset + CONSTRAINT_PAGE_SIZE, rows.length)} di ${rows.length}` : 'Nessun vincolo';
    previousConstraints.disabled = constraintPage === 0;
    nextConstraints.disabled = constraintPage >= pageCount - 1;
    const targets = [];
    for (const scope of ['teachers', 'classes', 'rooms']) for (const item of timetable.entities[scope]) {
      const label = scope === 'teachers' ? 'Docente' : scope === 'classes' ? 'Classe' : 'Aula';
      targets.push({ key: `${scope}|${item.id}`, label: `${label} · ${item.name}` });
    }
    if (timetable.lessons.length <= 100) for (const item of timetable.lessons) {
      targets.push({ key: `lessons|${item.id}`, label: `Lezione · ${timetable.entities.subjects.find(s => s.id === item.subjectId)?.name || item.id}` });
    }
    for (const item of allRows.filter(row => row.scope === 'lessons')) {
      if (!targets.some(target => target.key === `lessons|${item.id}`)) targets.push({ key: `lessons|${item.id}`, label: `Lezione · ${item.name}` });
    }
    const listId = 'school-constraint-targets';
    const datalist = element(document, 'datalist', { id: listId });
    targets.forEach(item => { const choice = element(document, 'option', { value: item.label }); choice.dataset.target = item.key; datalist.append(choice); });
    constraintTable.parentElement.querySelector(`#${listId}`)?.remove();
    constraintTable.parentElement.append(datalist);
    const renderRow = (constraint, index, fresh = false) => {
      const row = element(document, 'tr', { 'data-row': index, ...(fresh ? { 'data-new-row': 'true' } : {}) });
      const target = element(document, 'input', { type: 'text', list: listId, 'aria-label': 'Elemento soggetto al vincolo', placeholder: fresh ? 'Cerca elemento…' : '' });
      target.value = targets.find(item => item.key === `${constraint?.scope}|${constraint?.id}`)?.label || '';
      const kind = element(document, 'select', { 'aria-label': 'Tipo di vincolo' });
      option(kind, '', '—'); option(kind, 'unavailable', 'Obbligatorio'); option(kind, 'undesired', 'Da evitare'); option(kind, 'desired', 'Preferita');
      kind.value = constraint?.kind || '';
      const [dayValue, periodValue] = constraint?.slot?.split('.') || ['', ''];
      const day = element(document, 'select', { 'aria-label': 'Giorno' }); option(day, '', '—');
      timetable.calendar.days.forEach(item => option(day, String(item.index), item.name)); day.value = dayValue;
      const period = element(document, 'select', { 'aria-label': 'Ora' }); option(period, '', '—');
      timetable.calendar.periods.forEach(item => option(period, String(item.index), `${String(Math.floor(item.beginMinute / 60)).padStart(2, '0')}:${String(item.beginMinute % 60).padStart(2, '0')}`)); period.value = periodValue;
      for (const control of [target, kind, day, period]) { const cell = element(document, 'td'); cell.append(control); row.append(cell); }
      body.append(row);
      const save = () => {
        if (fresh && (!target.value || !kind.value || day.value === '' || period.value === '')) return;
        if (!target.value || !kind.value || day.value === '' || period.value === '') return;
        const targetKey = targets.find(item => item.label === target.value)?.key;
        if (!targetKey) { status.textContent = 'Scegli un elemento presente nell’elenco.'; return; }
        const [scope, id] = targetKey.split('|');
        const owner = constraintTarget(scope, id);
        if (!owner) return;
        const old = constraint;
        remember();
        const frames = owner.constraints?.timeframes || owner.timeframes || { unavailable: [], desired: [], undesired: [] };
        if (owner.constraints) owner.constraints.timeframes = frames; else owner.timeframes = frames;
        if (old) frames[old.kind] = (frames[old.kind] || []).filter(slot => slot !== old.slot);
        const slot = `${day.value}.${period.value}`;
        frames[kind.value] ||= [];
        if (!frames[kind.value].includes(slot)) frames[kind.value].push(slot);
        render(); commit(fresh ? 'Vincolo aggiunto.' : 'Vincolo aggiornato.');
      };
      [target, kind, day, period].forEach(control => control.addEventListener('change', save));
      row.addEventListener('keydown', event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && (event.ctrlKey || event.metaKey) && !fresh) {
          event.preventDefault();
          remember();
          const owner = constraintTarget(constraint.scope, constraint.id);
          const frames = owner?.constraints?.timeframes || owner?.timeframes;
          if (frames) frames[constraint.kind] = (frames[constraint.kind] || []).filter(slot => slot !== constraint.slot);
          render(); commit('Vincolo rimosso.');
        }
      });
    };
    pageRows.forEach((constraint, index) => renderRow(constraint, offset + index));
    renderRow(null, offset + pageRows.length, true);
  }

  function render() {
    for (const collection of Object.keys(tables)) renderEntities(collection);
    if (studentTable) renderStudents();
    renderLessons();
    renderConstraints();
  }

  for (const [gridName, filter] of Object.entries(gridFilters)) filter?.addEventListener('input', () => applyGridFilter(gridName));
  constraintFilter.addEventListener('input', () => { constraintPage = 0; renderConstraints(); });
  previousConstraints.addEventListener('click', () => { constraintPage = Math.max(0, constraintPage - 1); renderConstraints(); });
  nextConstraints.addEventListener('click', () => { constraintPage++; renderConstraints(); });
  undoButton.addEventListener('click', () => {
    if (!undoStack.length) return;
    const change = undoStack.pop();
    if (change.type === 'lesson') {
      if (change.previous) timetable.lessons[change.index] = change.previous;
      else timetable.lessons.splice(change.index, 1);
    } else timetable = change.timetable;
    undoButton.disabled = !undoStack.length;
    render();
    status.textContent = 'Ultima modifica annullata.';
    onChange(timetable);
  });

  return {
    setTimetable(value) { timetable = value || createEmptySchool(); timetable.entities.students ||= []; undoStack.length = 0; undoButton.disabled = true; render(); },
    importEntities(collection, incoming = [], sourceInfo = null) {
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
        if (collection !== 'students') next.constraints ||= { timeframes: { unavailable: [], desired: [], undesired: [] } };
        additions.push(next); knownNames.add(next.name.trim().toLocaleLowerCase()); knownIds.add(next.id);
      }
      if (additions.length || sourceInfo) {
        remember(); values.push(...additions);
        if (sourceInfo) {
          timetable.source.rosterImports ||= [];
          timetable.source.rosterImports.push(structuredClone(sourceInfo));
        }
        render();
        status.textContent = `${additions.length} ${COLLECTION_IMPORTED[collection] || 'elementi importati'}${duplicates ? `; ${duplicates} duplicati ignorati` : ''}.`;
        onChange(timetable);
      }
      return { imported: additions.length, duplicates };
    },
    importLessons(incoming = [], incomingSubjects = [], sourceInfo = null) {
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
        const { sourceAssignment = null, ...lesson } = structuredClone(item);
        lesson.subjectId = subjectIds.get(item.subjectId) || item.subjectId;
        const stem = `lesson:ofd-${sourceId}-${Number.isInteger(item.sourceIndex) ? item.sourceIndex : 'x'}`;
        let id = stem, suffix = 1;
        while (knownLessonIds.has(id)) id = `${stem}-${++suffix}`;
        lesson.id = id;
        knownLessonIds.add(id);
        return { lesson, sourceAssignment };
      });
      if (additions.length || subjectAdditions.length || sourceInfo) {
        remember();
        subjects.push(...subjectAdditions);
        timetable.lessons.push(...additions.map(item => item.lesson));
        if (sourceInfo) {
          timetable.source.lessonImports ||= [];
          timetable.source.lessonImports.push(structuredClone(sourceInfo));
        }
        timetable.source.assignmentHints ||= {};
        for (const { lesson, sourceAssignment } of additions) if (sourceAssignment) {
          timetable.source.assignmentHints[lesson.id] = structuredClone(sourceAssignment);
        }
        render();
        status.textContent = `${additions.length} lezioni importate${subjectAdditions.length ? ` · ${subjectAdditions.length} materie aggiunte` : ''}.`;
        onChange(timetable);
      }
      return { imported: additions.length, subjects: subjectAdditions.length };
    },
    setName(value) { if (value && value !== timetable.name) { remember(); timetable.name = value; commit('Nome scuola aggiornato.'); } },
    undo() { if (undoButton.disabled) return false; undoButton.click(); return true; },
    render,
    get timetable() { return timetable; },
  };
}
