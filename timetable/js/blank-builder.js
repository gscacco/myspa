import { createBlankTimetable } from './blank-timetable.js';

const CONFIG = {
  teacher: { plural: 'teachers', label: 'docente' },
  class: { plural: 'classes', label: 'classe' },
  subject: { plural: 'subjects', label: 'materia' },
  room: { plural: 'rooms', label: 'aula' },
};

function node(document, tag, className, text = '') {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

/** Manages the manual zero-start setup flow and returns a validated native model. */
export function createBlankTimetableBuilder({ document = globalThis.document, onCreate = () => false } = {}) {
  const startButton = document.querySelector('#open-blank-builder');
  const card = document.querySelector('#import-card');
  const currentCard = document.querySelector('.current-card');
  const timetableWorkspace = document.querySelector('#timetable-workspace');
  const form = document.querySelector('#blank-builder');
  const backButton = document.querySelector('#cancel-blank-builder');
  const status = document.querySelector('#blank-builder-status');
  const createButton = document.querySelector('#create-new-timetable');
  const addLessonButton = document.querySelector('#add-new-lesson');
  const lessonList = document.querySelector('#new-lesson-list');
  const selects = {
    subject: document.querySelector('#lesson-subject'),
    teacher: document.querySelector('#lesson-teacher'),
    class: document.querySelector('#lesson-class'),
    room: document.querySelector('#lesson-room'),
  };
  if (![startButton, card, currentCard, form, backButton, status, createButton, addLessonButton, lessonList, ...Object.values(selects)].every(Boolean)) {
    throw new Error('The zero-start timetable builder is missing required controls.');
  }

  const entities = { teachers: [], classes: [], subjects: [], rooms: [] };
  let lessons = [];
  let previousWorkspaceHidden = true;
  const lessonSubject = document.querySelector('#lesson-subject');

  function show() {
    previousWorkspaceHidden = timetableWorkspace.hidden;
    card.hidden = true; currentCard.hidden = true; form.hidden = false;
    timetableWorkspace.hidden = true;
    form.scrollIntoView?.({ block: 'start' });
    document.querySelector('#new-timetable-name').focus();
  }

  function hide({ created = false } = {}) {
    form.hidden = true; card.hidden = created; currentCard.hidden = false;
    timetableWorkspace.hidden = created ? false : previousWorkspaceHidden;
  }

  function updateLessonSelects() {
    for (const [key, select] of Object.entries(selects)) {
      const prior = select.value;
      const values = entities[CONFIG[key].plural];
      select.replaceChildren();
      const prompt = node(document, 'option', '', key === 'room' ? 'Senza aula' : `Seleziona ${CONFIG[key].label}`);
      prompt.value = '';
      select.append(prompt);
      for (const value of values) {
        const option = node(document, 'option', '', value); option.value = value; select.append(option);
      }
      if (values.includes(prior)) select.value = prior;
    }
    addLessonButton.disabled = !selects.subject.value || !selects.teacher.value || !selects.class.value;
  }

  function renderEntities(type) {
    const config = CONFIG[type];
    const list = document.querySelector(`#new-${type}-list`);
    list.replaceChildren();
    entities[config.plural].forEach((name, index) => {
      const row = node(document, 'li', 'blank-item');
      row.append(node(document, 'span', '', name));
      const remove = node(document, 'button', 'blank-remove', 'Rimuovi');
      remove.type = 'button'; remove.setAttribute('aria-label', `Rimuovi ${config.label} ${name}`);
      remove.addEventListener('click', () => {
        entities[config.plural].splice(index, 1);
        const key = { teachers: 'teacher', classes: 'class', subjects: 'subject', rooms: 'room' }[config.plural];
        lessons = lessons.filter(lesson => !((key === 'teacher' && lesson.teacher === name)
          || (key === 'class' && lesson.class === name) || (key === 'subject' && lesson.subject === name)
          || (key === 'room' && lesson.room === name)));
        renderEntities(type); renderLessons(); updateLessonSelects();
        status.textContent = `Rimosso ${config.label}; le lezioni che lo usavano sono state rimosse dalla bozza.`;
      });
      row.append(remove); list.append(row);
    });
  }

  function renderLessons() {
    lessonList.replaceChildren();
    lessons.forEach((lesson, index) => {
      const row = node(document, 'li', 'blank-item');
      row.append(node(document, 'span', '', `${lesson.subject} · ${lesson.teacher} · ${lesson.class}${lesson.room ? ` · ${lesson.room}` : ''} · ${lesson.durationPeriods} ${lesson.durationPeriods === 1 ? 'ora' : 'ore'}`));
      const remove = node(document, 'button', 'blank-remove', 'Rimuovi');
      remove.type = 'button'; remove.setAttribute('aria-label', `Rimuovi lezione ${lesson.subject}, ${lesson.class}`);
      remove.addEventListener('click', () => { lessons.splice(index, 1); renderLessons(); updateCreateAvailability(); });
      row.append(remove); lessonList.append(row);
    });
    updateCreateAvailability();
  }

  function updateCreateAvailability() {
    createButton.disabled = lessons.length === 0;
  }

  for (const [type, config] of Object.entries(CONFIG)) {
    const input = document.querySelector(`#new-${type}-name`);
    const button = document.querySelector(`#add-new-${type}`);
    button.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) { status.textContent = `Inserisci il nome ${config.label}.`; input.focus(); return; }
      const values = entities[config.plural];
      if (values.some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        status.textContent = `Il nome ${name} è già presente.`; input.focus(); return;
      }
      values.push(name); input.value = ''; renderEntities(type); updateLessonSelects();
      status.textContent = `${config.label[0].toLocaleUpperCase()}${config.label.slice(1)} aggiunto.`;
      input.focus();
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); button.click(); } });
  }

  for (const select of Object.values(selects)) select.addEventListener('change', updateLessonSelects);
  addLessonButton.addEventListener('click', () => {
    if (addLessonButton.disabled) return;
    lessons.push({
      subject: selects.subject.value,
      teacher: selects.teacher.value,
      class: selects.class.value,
      room: selects.room.value,
      durationPeriods: Number(document.querySelector('#lesson-duration').value),
    });
    renderLessons();
    status.textContent = 'Lezione aggiunta alla bozza.';
  });

  createButton.addEventListener('click', () => {
    try {
      const count = Number(document.querySelector('#new-period-count').value);
      const unitMinutes = Number(document.querySelector('#new-unit-minutes').value);
      const [hours, minutes] = document.querySelector('#new-start-time').value.split(':').map(Number);
      const startMinute = hours * 60 + minutes;
      const periodCount = Math.trunc(count);
      const periods = Array.from({ length: periodCount }, (_, index) => ({
        beginMinute: startMinute + index * unitMinutes,
        endMinute: startMinute + (index + 1) * unitMinutes,
      }));
      if (!Number.isInteger(count) || count < 1 || count > 16 || !Number.isInteger(unitMinutes) || unitMinutes < 15 || unitMinutes > 180
        || !Number.isFinite(startMinute) || startMinute < 0 || startMinute + periodCount * unitMinutes > 1440) {
        throw new Error('Controlla inizio, durata e numero delle ore del calendario.');
      }
      const timetable = createBlankTimetable({
        name: document.querySelector('#new-timetable-name').value,
        days: document.querySelector('#new-days').value.split(',').map(day => day.trim()).filter(Boolean),
        unitMinutes,
        periods,
        teachers: entities.teachers,
        classes: entities.classes,
        subjects: entities.subjects,
        rooms: entities.rooms,
        lessons,
      });
      if (onCreate(timetable)) hide({ created: true });
    } catch (error) {
      status.textContent = error.message || 'Controlla i dati della nuova scuola.';
    }
  });
  startButton.addEventListener('click', show);
  backButton.addEventListener('click', hide);
  updateLessonSelects();
  return { show, hide };
}
