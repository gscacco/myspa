import { findAlternatives } from './solver.js';
import { createProposal } from './proposals.js';
import { createTimetableHistory } from './history.js';

function node(document, tag, className, text = '') {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

function timeLabel(timetable, time, durationPeriods = 1) {
  if (!time) return 'Senza orario';
  const day = timetable.calendar.days[time.dayIndex]?.name || `Giorno ${time.dayIndex + 1}`;
  const start = timetable.calendar.periods[time.periodIndex]?.beginMinute;
  const end = timetable.calendar.periods[time.periodIndex + durationPeriods - 1]?.endMinute;
  const format = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return start == null || end == null ? day : `${day}, ${format(start)}–${format(end)}`;
}

function entityName(timetable, collection, id) {
  return timetable.entities[collection].find(entity => entity.id === id)?.name || 'Non assegnata';
}

/** Owns proposal preview, explicit application, cancellation, and undo controls. */
export function createTimetableEditor({ document = globalThis.document, getTimetable = () => null, onApply = () => {}, confirm = document?.defaultView?.confirm?.bind(document.defaultView) } = {}) {
  if (!document) throw new TypeError('A document is required to mount the timetable editor.');
  const panel = document.querySelector('#editor-panel');
  const searchButton = document.querySelector('#find-alternatives');
  const cancelButton = document.querySelector('#cancel-search');
  const depthSelect = document.querySelector('#search-depth');
  const list = document.querySelector('#proposal-list');
  const impact = document.querySelector('#proposal-impact');
  const status = document.querySelector('#edit-status');
  const applyButton = document.querySelector('#apply-proposal');
  const undoButton = document.querySelector('#undo-change');
  if (![panel, searchButton, cancelButton, depthSelect, list, impact, status, applyButton, undoButton].every(Boolean)) {
    throw new Error('Timetable editing controls are missing.');
  }

  let timetable = getTimetable();
  let history = timetable ? createTimetableHistory(timetable) : null;
  let selectedLessonId = null;
  let controller = null;
  let activeSearch = Promise.resolve(null);
  let selectedOption = null;
  const options = new Map();

  function renderUndo() { undoButton.disabled = !history?.canUndo; }

  function clearOptions() {
    options.clear();
    selectedOption = null;
    list.replaceChildren();
    impact.replaceChildren(node(document, 'p', 'muted', 'Scegli un’alternativa per confrontarne gli effetti.'));
    applyButton.disabled = true;
  }

  function currentLesson() { return timetable?.lessons.find(item => item.id === selectedLessonId); }

  function showOption(id) {
    selectedOption = options.get(id) || null;
    for (const button of list.querySelectorAll('.proposal-option')) button.setAttribute('aria-pressed', String(button.dataset.optionId === id));
    impact.replaceChildren();
    if (!selectedOption) {
      impact.append(node(document, 'p', 'muted', 'Scegli un’alternativa per confrontarne gli effetti.'));
      applyButton.disabled = true;
      return;
    }
    const { suggestion } = selectedOption;
    impact.append(node(document, 'p', 'proposal-rationale', suggestion.rationale));
    const changes = node(document, 'ul', 'proposal-changes');
    for (const change of suggestion.changes) {
      const lesson = timetable.lessons.find(item => item.id === change.lessonId);
      if (!lesson) continue;
      const subject = entityName(timetable, 'subjects', lesson.subjectId);
      const classNames = lesson.classIds.map(id => entityName(timetable, 'classes', id)).join(', ') || 'Classe non assegnata';
      const teacherNames = lesson.teacherIds.map(id => entityName(timetable, 'teachers', id)).join(', ') || 'Docente non assegnato';
      const from = timeLabel(timetable, lesson.assignedTime, lesson.durationPeriods);
      const to = timeLabel(timetable, change.assignedTime, lesson.durationPeriods);
      changes.append(node(document, 'li', '', `${subject} · ${classNames} · ${teacherNames}: ${from} → ${to}`));
    }
    impact.append(changes);
    const hardText = suggestion.remainingHard
      ? `Vincoli rispettati per le lezioni coinvolte. Restano ${suggestion.remainingHard} segnalazioni preesistenti su altre lezioni.`
      : 'Vincoli obbligatori: rispettati sulle lezioni coinvolte.';
    impact.append(node(document, 'p', 'proposal-hard-status', hardText));
    const preferenceText = suggestion.softAfter < suggestion.softBefore
      ? `Le preferenze indesiderate migliorano (${suggestion.softBefore} → ${suggestion.softAfter}).`
      : suggestion.softAfter > suggestion.softBefore
        ? `Le preferenze indesiderate peggiorano (${suggestion.softBefore} → ${suggestion.softAfter}).`
        : `Le preferenze indesiderate restano invariate (${suggestion.softAfter}).`;
    impact.append(node(document, 'p', 'proposal-soft-status', preferenceText));
    applyButton.disabled = false;
  }

  function addSuggestion(suggestion) {
    const id = String(options.size);
    const proposal = createProposal(timetable, suggestion);
    options.set(id, { proposal, suggestion });
    const first = suggestion.changes[0];
    const firstLesson = timetable.lessons.find(item => item.id === first.lessonId);
    const button = node(document, 'button', 'proposal-option', `${timeLabel(timetable, first.assignedTime, firstLesson?.durationPeriods)} · ${suggestion.changes.length} ${suggestion.changes.length === 1 ? 'lezione' : 'lezioni'} coinvolte`);
    button.type = 'button';
    button.dataset.optionId = id;
    button.dataset.periodIndex = String(first.assignedTime.periodIndex);
    button.dataset.changeCount = String(suggestion.changes.length);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => showOption(id));
    list.append(button);
  }

  async function search() {
    const lesson = currentLesson();
    if (!lesson || !timetable) return null;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    clearOptions();
    searchButton.disabled = true;
    cancelButton.disabled = false;
    status.textContent = 'Ricerca alternative compatibili…';
    const maxMoves = { immediate: 1, local: 3, chain: 5 }[depthSelect.value] || 1;
    const result = await findAlternatives(timetable, lesson.id, {
      maxMoves,
      signal: activeController.signal,
      onProgress: progress => { status.textContent = `Controllo ${progress.visited} possibilità · ${progress.suggestions} alternative trovate`; },
      onSuggestion: addSuggestion,
    });
    if (controller !== activeController) return result;
    controller = null;
    searchButton.disabled = false;
    cancelButton.disabled = true;
    status.textContent = result.cancelled
      ? `Ricerca annullata. ${result.suggestions.length} alternative parziali conservate; l’orario corrente non è cambiato.`
      : result.suggestions.length
        ? `${result.suggestions.length} alternative verificate${result.limitReached ? ' (risultati parziali)' : ''}.`
        : 'Nessuna alternativa compatibile trovata entro il limite di ricerca.';
    if (!result.suggestions.length) list.append(node(document, 'li', 'muted', 'Nessuna proposta applicabile.'));
    return result;
  }

  searchButton.addEventListener('click', () => { activeSearch = search(); });
  cancelButton.addEventListener('click', () => {
    if (!controller) return;
    controller.abort();
    status.textContent = 'Annullamento ricerca…';
  });
  applyButton.addEventListener('click', () => {
    if (!selectedOption || !history) return;
    if (selectedOption.proposal.changes.length > 1) {
      const affected = selectedOption.proposal.changes.length;
      if (typeof confirm !== 'function' || !confirm(`Applicare la modifica coordinata a ${affected} lezioni?`)) {
        status.textContent = 'Proposta coordinata non applicata.';
        return;
      }
    }
    try {
      const next = history.apply(selectedOption.proposal);
      const lessonId = selectedLessonId;
      status.textContent = 'Modifica applicata. Verifica l’orario nelle viste di classe e docente.';
      clearOptions();
      renderUndo();
      timetable = next;
      onApply(next, lessonId, 'apply');
    } catch (error) {
      status.textContent = error.message || 'La proposta non è più applicabile. Cerca nuove alternative.';
      clearOptions();
    }
  });
  undoButton.addEventListener('click', () => {
    if (!history?.undo()) return;
    const restored = history.current;
    const lessonId = selectedLessonId;
    timetable = restored;
    clearOptions();
    renderUndo();
    status.textContent = 'Modifica annullata; l’orario precedente è stato ripristinato.';
    onApply(restored, lessonId, 'undo');
  });

  return {
    selectLesson(lessonId) {
      selectedLessonId = lessonId;
      controller?.abort();
      controller = null;
      clearOptions();
      const lesson = currentLesson();
      searchButton.disabled = !lesson;
      status.textContent = !lesson
        ? 'Seleziona una lezione per esplorare alternative.'
        : lesson.assignedTime
          ? 'Puoi cercare spostamenti compatibili per questa lezione.'
          : 'Puoi cercare un primo orario compatibile per questa lezione.';
      renderUndo();
    },
    setTimetable(next) {
      controller?.abort();
      controller = null;
      timetable = next;
      history = next ? createTimetableHistory(next) : null;
      selectedLessonId = null;
      searchButton.disabled = true;
      cancelButton.disabled = true;
      clearOptions();
      status.textContent = 'Seleziona una lezione per esplorare alternative.';
      renderUndo();
    },
    get searchComplete() { return activeSearch; },
  };
}
