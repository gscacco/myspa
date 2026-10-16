import { findAlternatives } from './solver.js';
import { recalculateAssignments } from './recalculator.js';
import { updateTimeframeConstraint } from './constraints.js';
import { analyzeSchedule } from './schedule.js';
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
export function createTimetableEditor({ document = globalThis.document, getTimetable = () => null, onApply = () => {}, confirm = document?.defaultView?.confirm?.bind(document.defaultView), recalculator = recalculateAssignments } = {}) {
  if (!document) throw new TypeError('A document is required to mount the timetable editor.');
  const panel = document.querySelector('#editor-panel');
  const searchButton = document.querySelector('#find-alternatives');
  const cancelButton = document.querySelector('#cancel-search');
  const depthSelect = document.querySelector('#search-depth');
  const list = document.querySelector('#proposal-list');
  const impact = document.querySelector('#proposal-impact');
  const status = document.querySelector('#edit-status');
  const calculationStatus = document.querySelector('#recalculation-status');
  const reviewCalculationButton = document.querySelector('#review-recalculation');
  const applyButton = document.querySelector('#apply-proposal');
  const undoButton = document.querySelector('#undo-change');
  const recalculateButton = document.querySelector('#recalculate-all');
  const cancelRecalculationButton = document.querySelector('#cancel-recalculation');
  const sourceHintToggle = document.querySelector('#prefer-source-hints');
  const constraintFilter = document.querySelector('#constraint-filter');
  const constraintTarget = document.querySelector('#constraint-target');
  const constraintKind = document.querySelector('#constraint-kind');
  const constraintDay = document.querySelector('#constraint-day');
  const constraintPeriod = document.querySelector('#constraint-period');
  const addConstraintButton = document.querySelector('#add-constraint');
  const constraintStatus = document.querySelector('#constraint-status');
  const constraintList = document.querySelector('#constraint-list');
  if (![panel, searchButton, cancelButton, depthSelect, list, impact, status, applyButton, undoButton,
    calculationStatus, reviewCalculationButton, recalculateButton, cancelRecalculationButton, sourceHintToggle, constraintFilter, constraintTarget, constraintKind, constraintDay,
    constraintPeriod, addConstraintButton, constraintStatus, constraintList].every(Boolean)) {
    throw new Error('Timetable editing controls are missing.');
  }

  let timetable = getTimetable();
  let history = timetable ? createTimetableHistory(timetable) : null;
  let selectedLessonId = null;
  let controller = null;
  let recalculationController = null;
  let activeSearch = Promise.resolve(null);
  let activeRecalculation = Promise.resolve(null);
  let selectedOption = null;
  let editingConstraint = null;
  const options = new Map();

  function renderUndo() { undoButton.disabled = !history?.canUndo; }

  function updateCalculationControl() {
    recalculateButton.disabled = !timetable?.lessons?.length || Boolean(recalculationController);
    recalculateButton.textContent = timetable?.lessons?.length && timetable.lessons.every(lesson => !lesson.assignedTime)
      ? 'Avvia calcolo automatico' : 'Ricalcola assegnazioni';
  }

  function clearOptions() {
    options.clear();
    selectedOption = null;
    list.replaceChildren();
    impact.replaceChildren(node(document, 'p', 'muted', 'Scegli un’alternativa per confrontarne gli effetti.'));
    applyButton.disabled = true;
  }

  function currentLesson() { return timetable?.lessons.find(item => item.id === selectedLessonId); }

  function selectedConstraintTarget() {
    const [scope, ...idParts] = constraintTarget.value.split('|');
    return { scope, id: idParts.join('|') };
  }

  function constraintFrames(target) {
    if (target.scope === 'lesson') return target.item.timeframes || {};
    return target.item.constraints?.timeframes || {};
  }

  function renderConstraintList() {
    constraintList.replaceChildren();
    if (!timetable || !constraintTarget.value) return;
    const target = selectedConstraintTarget();
    const collections = { teacher: 'teachers', class: 'classes', room: 'rooms' };
    target.item = target.scope === 'lesson'
      ? timetable.lessons.find(item => item.id === target.id)
      : timetable.entities[collections[target.scope]]?.find(item => item.id === target.id);
    if (!target.item) return;
    const values = constraintFrames(target)[constraintKind.value] || [];
    for (const slot of values) {
      const [dayIndex, periodIndex] = slot.split('.').map(Number);
      const day = timetable.calendar.days[dayIndex]?.name || `Giorno ${dayIndex + 1}`;
      const period = timetable.calendar.periods[periodIndex];
      const hhmm = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const row = node(document, 'li', 'constraint-row');
      row.append(node(document, 'span', '', `${day} · ${period ? hhmm(period.beginMinute) : `ora ${periodIndex + 1}`}`));
      const edit = node(document, 'button', 'constraint-edit', 'Modifica');
      edit.type = 'button'; edit.setAttribute('aria-label', `Modifica vincolo ${day}, ora ${periodIndex + 1}`);
      edit.addEventListener('click', () => {
        editingConstraint = { ...target, kind: constraintKind.value, slot };
        constraintTarget.value = `${target.scope}|${target.id}`;
        constraintKind.value = editingConstraint.kind;
        constraintDay.value = String(dayIndex);
        constraintPeriod.value = String(periodIndex);
        addConstraintButton.textContent = 'Salva vincolo';
        constraintStatus.textContent = 'Modifica in corso; salva per aggiornare il vincolo.';
      });
      const remove = node(document, 'button', 'constraint-delete', 'Elimina');
      remove.type = 'button'; remove.setAttribute('aria-label', `Elimina vincolo ${day}, ora ${periodIndex + 1}`);
      remove.addEventListener('click', () => commitConstraint({ ...target, kind: constraintKind.value, action: 'delete', slot }));
      row.append(edit, remove);
      constraintList.append(row);
    }
  }

  function refreshConstraintControls() {
    const enabled = Boolean(timetable);
    for (const control of [constraintFilter, constraintTarget, constraintKind, constraintDay, constraintPeriod, addConstraintButton]) control.disabled = !enabled;
    if (!enabled) {
      constraintTarget.replaceChildren(); constraintDay.replaceChildren(); constraintPeriod.replaceChildren(); constraintList.replaceChildren();
      return;
    }
    const previousTarget = constraintTarget.value;
    const options = [];
    const addOption = (value, label) => options.push({ value, label });
    for (const lesson of timetable.lessons) {
      const subject = entityName(timetable, 'subjects', lesson.subjectId);
      const classes = lesson.classIds.map(id => entityName(timetable, 'classes', id)).join(', ');
      addOption(`lesson|${lesson.id}`, `Lezione · ${subject}${classes ? ` · ${classes}` : ''}`);
    }
    for (const [scope, collection, label] of [['teacher', 'teachers', 'Docente'], ['class', 'classes', 'Classe'], ['room', 'rooms', 'Aula']]) {
      for (const entity of timetable.entities[collection] || []) addOption(`${scope}|${entity.id}`, `${label} · ${entity.name}`);
    }
    const filter = constraintFilter.value.trim().toLocaleLowerCase();
    const visibleOptions = options.filter(item => !filter || item.label.toLocaleLowerCase().includes(filter) || item.value.toLocaleLowerCase().includes(filter));
    constraintTarget.replaceChildren(...visibleOptions.map(item => {
      const option = node(document, 'option', '', item.label); option.value = item.value; return option;
    }));
    addConstraintButton.disabled = visibleOptions.length === 0;
    if (visibleOptions.some(item => item.value === previousTarget)) constraintTarget.value = previousTarget;
    else if (selectedLessonId && visibleOptions.some(item => item.value === `lesson|${selectedLessonId}`)) constraintTarget.value = `lesson|${selectedLessonId}`;
    const priorDay = constraintDay.value, priorPeriod = constraintPeriod.value;
    constraintDay.replaceChildren(...timetable.calendar.days.map(day => {
      const option = node(document, 'option', '', day.name); option.value = String(day.index); return option;
    }));
    constraintPeriod.replaceChildren(...timetable.calendar.periods.map(period => {
      const option = node(document, 'option', '', `${String(Math.floor(period.beginMinute / 60)).padStart(2, '0')}:${String(period.beginMinute % 60).padStart(2, '0')}`);
      option.value = String(period.index); return option;
    }));
    if ([...constraintDay.options].some(option => option.value === priorDay)) constraintDay.value = priorDay;
    if ([...constraintPeriod.options].some(option => option.value === priorPeriod)) constraintPeriod.value = priorPeriod;
    renderConstraintList();
    if (!visibleOptions.length) constraintStatus.textContent = 'Nessun elemento corrisponde al filtro.';
  }

  function commitConstraint({ scope, id, kind, action, slot, from }) {
    try {
      const next = updateTimeframeConstraint(timetable, { scope, id, kind, action, slot, from });
      timetable = history.commit(next);
      editingConstraint = null;
      addConstraintButton.textContent = 'Aggiungi vincolo';
      clearOptions(); renderUndo(); refreshConstraintControls();
      const conflicts = analyzeSchedule(timetable).issues.filter(item => item.severity === 'error').length;
      constraintStatus.textContent = conflicts
        ? `Vincolo salvato. ${conflicts} conflitti sono evidenziati nell’orario.`
        : 'Vincolo salvato; il ricalcolo terrà conto delle indisponibilità.';
      status.textContent = 'Vincolo aggiornato. Le modifiche sono annullabili e vanno esportate in EDN per salvarle.';
      onApply(timetable, selectedLessonId, 'constraint');
    } catch (error) {
      constraintStatus.textContent = error.message || 'Vincolo non valido.';
    }
  }

  constraintTarget.addEventListener('change', () => { editingConstraint = null; addConstraintButton.textContent = 'Aggiungi vincolo'; renderConstraintList(); });
  constraintFilter.addEventListener('input', () => { editingConstraint = null; addConstraintButton.textContent = 'Aggiungi vincolo'; refreshConstraintControls(); });
  constraintKind.addEventListener('change', () => { editingConstraint = null; addConstraintButton.textContent = 'Aggiungi vincolo'; renderConstraintList(); });
  addConstraintButton.addEventListener('click', () => {
    const target = selectedConstraintTarget();
    const slot = `${constraintDay.value}.${constraintPeriod.value}`;
    commitConstraint({ ...target, kind: constraintKind.value, action: editingConstraint ? 'update' : 'add', slot, from: editingConstraint?.slot });
  });

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
    if (selectedOption.fullRecalculation) {
      impact.append(node(document, 'p', '', `${suggestion.changes.length} lezioni riceveranno una nuova assegnazione. Il modello corrente resterà invariato fino alla conferma.`));
    } else {
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
    }
    const hardText = selectedOption.fullRecalculation
      ? 'Assegnazione completa trovata: i vincoli rigidi supportati sono rispettati.'
      : suggestion.remainingHard
      ? `Vincoli rispettati per le lezioni coinvolte. Restano ${suggestion.remainingHard} segnalazioni preesistenti su altre lezioni.`
      : 'Vincoli obbligatori: rispettati sulle lezioni coinvolte.';
    impact.append(node(document, 'p', 'proposal-hard-status', hardText));
    const preferenceText = selectedOption.fullRecalculation
      ? `Preferenze di fascia indesiderata: penalità ${suggestion.softAfter}. La ricerca si ferma alla prima assegnazione valida entro il limite; non garantisce l’ottimo globale.`
      : suggestion.softAfter < suggestion.softBefore
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

  function addFullScheduleProposal(result) {
    const changes = timetable.lessons.map(lesson => ({ lessonId: lesson.id, assignedTime: result.assignments.get(lesson.id) }));
    if (changes.every(change => {
      const before = timetable.lessons.find(lesson => lesson.id === change.lessonId)?.assignedTime;
      return before?.dayIndex === change.assignedTime?.dayIndex && before?.periodIndex === change.assignedTime?.periodIndex;
    })) {
      status.textContent = 'L’assegnazione attuale è già completa e rispetta i vincoli rigidi supportati.';
      calculationStatus.textContent = status.textContent;
      return false;
    }
    const suggestion = {
      changes,
      rationale: `Ricalcolo completo rispettando indisponibilità e collisioni di docenti, classi e aule${sourceHintToggle.checked ? '; le posizioni originali conservate sono solo preferenze iniziali' : ''}. Le altre regole OFD restano conservate ma non sono applicate dal prototipo.`,
      softBefore: 0,
      softAfter: result.softCost,
    };
    const id = String(options.size);
    const proposal = createProposal(timetable, suggestion);
    options.set(id, { proposal, suggestion, fullRecalculation: true });
    const button = node(document, 'button', 'proposal-option', `Riassegnazione completa · ${changes.length} lezioni`);
    button.type = 'button'; button.dataset.optionId = id; button.dataset.changeCount = String(changes.length);
    button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => showOption(id));
    list.append(button);
    reviewCalculationButton.hidden = false;
    return true;
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

  async function recalculate() {
    if (!timetable?.lessons.length || recalculationController) return null;
    controller?.abort(); controller = null;
    recalculationController = new AbortController();
    const activeController = recalculationController;
    clearOptions();
    searchButton.disabled = true; recalculateButton.disabled = true;
    cancelButton.disabled = true; cancelRecalculationButton.disabled = false;
    status.textContent = 'Ricalcolo completo in corso…';
    calculationStatus.textContent = 'Ricerca di un’assegnazione completa…';
    reviewCalculationButton.hidden = true;
    const result = await recalculator(timetable, {
      signal: activeController.signal,
      useSourceHints: sourceHintToggle.checked,
      onProgress: progress => {
        const message = `Ricalcolo: ${progress.assigned}/${progress.total} lezioni · ${progress.visited} tentativi`;
        status.textContent = message; calculationStatus.textContent = message;
      },
    });
    if (recalculationController !== activeController) return result;
    recalculationController = null;
    searchButton.disabled = !currentLesson(); updateCalculationControl();
    cancelRecalculationButton.disabled = true;
    if (result.status === 'solved') {
      const added = addFullScheduleProposal(result);
      if (added) status.textContent = 'Assegnazione completa pronta. Verifica il riepilogo e conferma prima di applicarla.';
    } else if (result.status === 'cancelled') status.textContent = 'Calcolo annullato; l’orario corrente è rimasto invariato.';
    else if (result.status === 'limit') status.textContent = `Ricerca interrotta al limite (${result.visited} tentativi); nessuna assegnazione applicata.`;
    else status.textContent = 'Nessuna assegnazione completa compatibile trovata; l’orario corrente è rimasto invariato.';
    calculationStatus.textContent = status.textContent;
    if (result.status !== 'solved') list.append(node(document, 'li', 'muted', 'Nessuna proposta applicabile.'));
    return result;
  }

  searchButton.addEventListener('click', () => { activeSearch = search(); });
  recalculateButton.addEventListener('click', () => { activeRecalculation = recalculate(); });
  reviewCalculationButton.addEventListener('click', () => {
    panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    list.querySelector('.proposal-option')?.click();
    applyButton.focus();
  });
  cancelButton.addEventListener('click', () => {
    if (!controller) return;
    controller.abort();
    status.textContent = 'Annullamento ricerca…';
  });
  cancelRecalculationButton.addEventListener('click', () => {
    recalculationController?.abort();
    status.textContent = 'Annullamento ricalcolo…';
  });
  applyButton.addEventListener('click', () => {
    if (!selectedOption || !history) return;
    if (selectedOption.fullRecalculation || selectedOption.proposal.changes.length > 1) {
      const affected = selectedOption.proposal.changes.length;
      const message = selectedOption.fullRecalculation
        ? `Sostituire tutte le assegnazioni con il ricalcolo per ${affected} lezioni?`
        : `Applicare la modifica coordinata a ${affected} lezioni?`;
      if (typeof confirm !== 'function' || !confirm(message)) {
        status.textContent = 'Proposta non applicata.';
        return;
      }
    }
    try {
      const next = history.apply(selectedOption.proposal);
      const lessonId = selectedLessonId;
      status.textContent = 'Modifica applicata. Verifica l’orario nelle viste di classe e docente.';
      calculationStatus.textContent = status.textContent;
      reviewCalculationButton.hidden = true;
      clearOptions();
      renderUndo();
      timetable = next;
      updateCalculationControl();
      refreshConstraintControls();
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
    calculationStatus.textContent = 'Ultima modifica annullata.';
    reviewCalculationButton.hidden = true;
    updateCalculationControl();
    clearOptions();
    renderUndo();
    refreshConstraintControls();
    status.textContent = 'Modifica annullata; l’orario precedente è stato ripristinato.';
    onApply(restored, lessonId, 'undo');
  });

  updateCalculationControl();
  refreshConstraintControls();

  return {
    selectLesson(lessonId) {
      selectedLessonId = lessonId;
      controller?.abort();
      controller = null;
      clearOptions();
      const lesson = currentLesson();
      searchButton.disabled = !lesson;
      refreshConstraintControls();
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
      recalculationController?.abort();
      recalculationController = null;
      timetable = next;
      history = next ? createTimetableHistory(next) : null;
      selectedLessonId = null;
      searchButton.disabled = true;
      cancelButton.disabled = true;
      updateCalculationControl();
      cancelRecalculationButton.disabled = true;
      reviewCalculationButton.hidden = true;
      calculationStatus.textContent = '';
      clearOptions();
      editingConstraint = null;
      status.textContent = 'Seleziona una lezione per esplorare alternative.';
      constraintStatus.textContent = next ? 'Puoi gestire indisponibilità e fasce da evitare.' : 'Importa un orario per gestire i vincoli.';
      addConstraintButton.textContent = 'Aggiungi vincolo';
      refreshConstraintControls();
      renderUndo();
    },
    get searchComplete() { return activeSearch; },
    get recalculationComplete() { return activeRecalculation; },
  };
}
