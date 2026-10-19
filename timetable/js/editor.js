import { findAlternatives } from './solver.js';
import { optimizeTimetable } from './optimization.js';
import { updateTimeframeConstraint } from './constraints.js';
import { analyzeSchedule } from './schedule.js';
import { createProposal, evaluateManualMove, evaluateManualSwap } from './proposals.js';
import { createTimetableHistory } from './history.js';
import { getCalculationReadiness } from './validation.js';
import { objectiveUpperBound } from './optimization-core.js';
import { optimizationScope } from './optimization-scope.js';

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
export function createTimetableEditor({ document = globalThis.document, getTimetable = () => null, onApply = () => {}, confirm = document?.defaultView?.confirm?.bind(document.defaultView), recalculator = optimizeTimetable } = {}) {
  if (!document) throw new TypeError('A document is required to mount the timetable editor.');
  const panel = document.querySelector('#editor-panel');
  const searchButton = document.querySelector('#find-alternatives');
  const cancelButton = document.querySelector('#cancel-search');
  const depthSelect = document.querySelector('#search-depth');
  const list = document.querySelector('#proposal-list');
  const impact = document.querySelector('#proposal-impact');
  const status = document.querySelector('#edit-status');
  const calculationStatus = document.querySelector('#recalculation-status');
  const iterationOutput = document.querySelector('#optimization-iteration');
  const objectiveOutput = document.querySelector('#optimization-objective');
  const objectiveQualityOutput = document.querySelector('#optimization-quality');
  const objectiveQualityBaseOutput = document.querySelector('#optimization-quality-base');
  const objectiveBreakdownOutput = document.querySelector('#optimization-objective-breakdown');
  const optimizationStatus = document.querySelector('#optimization-status');
  const objectivePath = document.querySelector('#objective-chart-line');
  const objectiveEmpty = document.querySelector('#objective-chart-empty');
  const algorithmInput = document.querySelector('#optimization-algorithm');
  const mixedCutoffWrap = document.querySelector('#optimization-mixed-cutoff-wrap');
  const mixedCutoffInput = document.querySelector('#optimization-mixed-cutoff');
  const timeLimitInput = document.querySelector('#optimization-time-limit');
  const targetInput = document.querySelector('#optimization-target');
  const workersInput = document.querySelector('#optimization-workers');
  const undesiredWeightInput = document.querySelector('#optimization-weight-undesired');
  const preferredWeightInput = document.querySelector('#optimization-weight-preferred');
  const reviewCalculationButton = document.querySelector('#review-recalculation');
  const applyButton = document.querySelector('#apply-proposal');
  const undoButton = document.querySelector('#undo-change');
  const redoButton = document.querySelector('#redo-change');
  const constraintUndoButton = document.querySelector('#undo-constraint-change');
  const recalculateButton = document.querySelector('#recalculate-all');
  const cancelRecalculationButton = document.querySelector('#cancel-recalculation');
  const constraintFilter = document.querySelector('#constraint-filter');
  const constraintTarget = document.querySelector('#constraint-target');
  const constraintKind = document.querySelector('#constraint-kind');
  const constraintDay = document.querySelector('#constraint-day');
  const constraintPeriod = document.querySelector('#constraint-period');
  const addConstraintButton = document.querySelector('#add-constraint');
  const constraintStatus = document.querySelector('#constraint-status');
  const constraintList = document.querySelector('#constraint-list');
  if (![panel, searchButton, cancelButton, depthSelect, list, impact, status, applyButton, undoButton, redoButton, constraintUndoButton,
    calculationStatus, iterationOutput, objectiveOutput, objectiveQualityOutput, objectiveQualityBaseOutput, objectiveBreakdownOutput, optimizationStatus, objectivePath, objectiveEmpty, algorithmInput, mixedCutoffWrap, mixedCutoffInput, timeLimitInput, targetInput, workersInput, undesiredWeightInput, preferredWeightInput,
    reviewCalculationButton, recalculateButton, cancelRecalculationButton, constraintFilter, constraintTarget, constraintKind, constraintDay,
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
  let objectiveHistory = [];
  const percentFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

  function updateMixedOptions() {
    mixedCutoffWrap.hidden = algorithmInput.value !== 'mixed';
    mixedCutoffInput.max = String(Math.max(1, Number(timeLimitInput.value) - 1));
  }
  algorithmInput.addEventListener('change', updateMixedOptions);
  timeLimitInput.addEventListener('input', updateMixedOptions);
  updateMixedOptions();

  function renderObjectiveQuality(objective, maximum) {
    if (!Number.isFinite(objective) || !Number.isFinite(maximum)) {
      objectiveQualityOutput.textContent = '—';
      objectiveQualityBaseOutput.textContent = '';
      return;
    }
    const quality = maximum > 0 ? Math.max(0, Math.min(100, (1 - objective / maximum) * 100)) : objective === 0 ? 100 : null;
    objectiveQualityOutput.textContent = quality == null ? '—' : `${percentFormat.format(quality)}%`;
    objectiveQualityBaseOutput.textContent = maximum > 0 ? `su ${Number(maximum).toLocaleString('it-IT')} punti teorici` : 'nessuna penalità possibile';
  }

  function renderUndo() {
    undoButton.disabled = !history?.canUndo;
    redoButton.disabled = !history?.canRedo;
    constraintUndoButton.disabled = !history?.canUndo;
  }

  function updateCalculationControl() {
    const ready = getCalculationReadiness(timetable).length === 0;
    recalculateButton.disabled = !ready || Boolean(recalculationController);
    recalculateButton.textContent = ready && timetable.lessons.every(lesson => !lesson.assignedTime)
      ? 'Avvia calcolo automatico' : 'Ricalcola assegnazioni';
  }

  function renderObjectiveBreakdown(breakdown) {
    if (!breakdown) return;
    const { counts, penalties } = breakdown;
    const parts = [
      counts.avoidedSlotHits && `${Number(counts.avoidedSlotHits).toLocaleString('it-IT')} violazioni da evitare (${Number(penalties.avoidedSlots).toLocaleString('it-IT')} punti)`,
      counts.missedPreferenceHits && `${Number(counts.missedPreferenceHits).toLocaleString('it-IT')} preferenze mancate (${Number(penalties.missedPreferences).toLocaleString('it-IT')} punti)`,
      counts.unassignedLessons && `${Number(counts.unassignedLessons).toLocaleString('it-IT')} lezioni non assegnate (${Number(penalties.unassignedLessons).toLocaleString('it-IT')} punti)`,
    ].filter(Boolean);
    objectiveBreakdownOutput.textContent = parts.length ? `Composizione: ${parts.join(' · ')}.` : 'Composizione: nessuna penalità.';
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

  function constraintTargetValue(scope, id) {
    const normalized = ({ teachers: 'teacher', classes: 'class', rooms: 'room', lessons: 'lesson' })[scope] || scope;
    const value = `${normalized}|${id}`;
    return [...constraintTarget.options].some(option => option.value === value) ? value : '';
  }

  function scopeForValue(value) { return value.split('|', 1)[0]; }

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
    const addOption = (value, label, frames = {}) => options.push({
      value, label, hasTimeframes: Object.values(frames).some(values => Array.isArray(values) && values.length > 0),
    });
    for (const lesson of timetable.lessons) {
      const subject = entityName(timetable, 'subjects', lesson.subjectId);
      const classes = lesson.classIds.map(id => entityName(timetable, 'classes', id)).join(', ');
      addOption(`lesson|${lesson.id}`, `Lezione · ${subject}${classes ? ` · ${classes}` : ''}`, lesson.timeframes);
    }
    for (const [scope, collection, label] of [['teacher', 'teachers', 'Docente'], ['class', 'classes', 'Classe'], ['room', 'rooms', 'Aula']]) {
      for (const entity of timetable.entities[collection] || []) addOption(`${scope}|${entity.id}`, `${label} · ${entity.name}`, entity.constraints?.timeframes);
    }
    const filter = constraintFilter.value.trim().toLocaleLowerCase();
    const visibleOptions = options.filter(item => !filter || item.label.toLocaleLowerCase().includes(filter) || item.value.toLocaleLowerCase().includes(filter));
    constraintTarget.replaceChildren(...visibleOptions.map(item => {
      const option = node(document, 'option', '', item.label); option.value = item.value; return option;
    }));
    addConstraintButton.disabled = visibleOptions.length === 0;
    if (visibleOptions.some(item => item.value === previousTarget)) constraintTarget.value = previousTarget;
    else if (selectedLessonId && visibleOptions.some(item => item.value === `lesson|${selectedLessonId}`)) constraintTarget.value = `lesson|${selectedLessonId}`;
    else constraintTarget.value = (visibleOptions.find(item => item.hasTimeframes) || visibleOptions[0])?.value || '';
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
      ? `Penalità soft: ${Number(suggestion.softAfter).toLocaleString('it-IT')} punti tra fasce da evitare e preferenze mancate. La ricerca si ferma alla prima assegnazione valida entro il limite; non garantisce l’ottimo globale.`
      : suggestion.softAfter < suggestion.softBefore
      ? `Le penalità soft migliorano (${suggestion.softBefore} → ${suggestion.softAfter}).`
      : suggestion.softAfter > suggestion.softBefore
        ? `Le penalità soft peggiorano (${suggestion.softBefore} → ${suggestion.softAfter}).`
        : `Le penalità soft restano invariate (${suggestion.softAfter}).`;
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
    const { optimizableLessons, excludedLessons } = optimizationScope(timetable);
    const changes = optimizableLessons.map(lesson => ({ lessonId: lesson.id, assignedTime: result.assignments.get(lesson.id) }));
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
      rationale: `Ricalcolo completo di ${changes.length} lezioni con classe reale, rispettando indisponibilità, collisioni e preferenze temporali supportate. ${excludedLessons.length} attività con classe UNKNOWN sono escluse e restano invariate.`,
      softBefore: 0,
      softAfter: result.objective ?? result.objectiveBreakdown?.total ?? 0,
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
      : result.reason === 'excluded-lesson'
        ? 'Attività associata alla classe UNKNOWN: è esclusa dal calcolo e resta disponibile per la gestione separata.'
      : result.suggestions.length
        ? `${result.suggestions.length} alternative verificate${result.limitReached ? ' (risultati parziali)' : ''}.`
        : 'Nessuna alternativa compatibile trovata entro il limite di ricerca.';
    if (!result.suggestions.length) list.append(node(document, 'li', 'muted', 'Nessuna proposta applicabile.'));
    return result;
  }

  async function recalculate() {
    if (!timetable?.lessons.length || recalculationController) return null;
    const { optimizableLessons, excludedLessons } = optimizationScope(timetable);
    if (!optimizableLessons.length) {
      clearOptions();
      status.textContent = `Nessuna attività con classe reale da ottimizzare. ${excludedLessons.length} attività con classe UNKNOWN restano conservate e invariate.`;
      calculationStatus.textContent = status.textContent;
      optimizationStatus.textContent = 'Nessuna attività da calcolare';
      return { status: 'no-eligible-lessons', assignments: new Map(), activeLessonCount: 0, excludedLessonCount: excludedLessons.length };
    }
    const timeLimitSeconds = Number(timeLimitInput.value);
    const geneticStartAfterSeconds = Number(mixedCutoffInput.value);
    const maxObjective = Number(targetInput.value);
    const workers = Number(workersInput.value);
    const objectiveWeights = {
      undesiredSlot: Number(undesiredWeightInput.value),
      missedPreferredSlot: Number(preferredWeightInput.value),
    };
    if (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 1 || timeLimitSeconds > 3600
      || !Number.isFinite(maxObjective) || maxObjective < 0
      || Object.values(objectiveWeights).some(value => !Number.isInteger(value) || value < 0 || value > 1000)
      || !Number.isInteger(workers) || workers < 1 || workers > 8
      || (algorithmInput.value === 'mixed' && (!Number.isInteger(geneticStartAfterSeconds) || geneticStartAfterSeconds < 1 || geneticStartAfterSeconds >= timeLimitSeconds))) {
      calculationStatus.textContent = 'Controlla i parametri: il taglio genetico deve essere inferiore al tempo totale; pesi 0–1000, tempo 1–3600 secondi, obiettivo non negativo, worker 1–8.';
      optimizationStatus.textContent = 'Parametri non validi';
      return { status: 'invalid-options' };
    }
    controller?.abort(); controller = null;
    recalculationController = new AbortController();
    const activeController = recalculationController;
    clearOptions();
    const advancedCalculation = document.querySelector('.calculation-advanced');
    if (advancedCalculation) advancedCalculation.open = true;
    searchButton.disabled = true; recalculateButton.disabled = true;
    cancelButton.disabled = true; cancelRecalculationButton.disabled = false;
    status.textContent = 'Ricalcolo completo in corso…';
    calculationStatus.textContent = 'Preparazione della ricerca…';
    iterationOutput.textContent = '0';
    objectiveOutput.textContent = '—';
    renderObjectiveQuality(NaN, NaN);
    objectiveBreakdownOutput.textContent = `Punteggio ponderato: ${objectiveWeights.undesiredSlot} punti per fascia da evitare, ${objectiveWeights.missedPreferredSlot} per preferenza mancata. Meno è meglio; zero è ideale.`;
    optimizationStatus.textContent = 'Avvio';
    objectiveHistory = [];
    objectivePath.setAttribute('d', '');
    objectiveEmpty.hidden = false;
    reviewCalculationButton.hidden = true;
    const timeLimitMs = timeLimitSeconds * 1000;
    const objectiveMaximum = objectiveUpperBound(timetable, objectiveWeights);
    const searchSeed = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
    const result = await recalculator(timetable, {
      signal: activeController.signal,
      timeLimitMs,
      maxObjective,
      workers,
      algorithm: algorithmInput.value,
      geneticStartAfterMs: geneticStartAfterSeconds * 1000,
      objectiveWeights,
      seed: searchSeed,
      onProgress: progress => {
        const iteration = progress.iterations ?? progress.visited ?? 0;
        const objective = progress.bestObjective;
        iterationOutput.textContent = Number(iteration).toLocaleString('it-IT');
        if (Number.isFinite(objective)) {
          objectiveOutput.textContent = Number(objective).toLocaleString('it-IT');
          renderObjectiveQuality(objective, objectiveMaximum);
          if (!objectiveHistory.length || objective < objectiveHistory.at(-1)) objectiveHistory.push(objective);
          if (objectiveHistory.length > 60) objectiveHistory = objectiveHistory.filter((_, index) => index % 2 === 0);
          const maximum = Math.max(1, ...objectiveHistory);
          const points = objectiveHistory.map((value, index) => `${objectiveHistory.length === 1 ? 0 : index * 720 / (objectiveHistory.length - 1)},${160 - value / maximum * 145}`);
          objectivePath.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'} ${point}`).join(' '));
          objectiveEmpty.hidden = true;
        }
        if (progress.phase === 'feasibility') {
          const assigned = Number(progress.feasibilityAssigned ?? progress.maxAssigned ?? progress.assigned ?? 0).toLocaleString('it-IT');
          const total = Number(progress.feasibilityTotal ?? progress.total ?? optimizableLessons.length).toLocaleString('it-IT');
          const geneticPhase = progress.algorithmStage === 'genetic' || (!progress.algorithmStage && algorithmInput.value === 'genetic');
          const phaseLabel = geneticPhase ? 'Genetico · ricerca soluzione valida' : algorithmInput.value === 'mixed' ? 'Classico · ricerca soluzione valida' : 'Ricerca soluzione valida';
          const attempt = Number(progress.feasibilityAttempt ?? progress.attempt ?? 1);
          const attemptLabel = attempt > 1 ? ` · tentativo ${attempt.toLocaleString('it-IT')}` : '';
          objectiveBreakdownOutput.textContent = `${phaseLabel}${attemptLabel} · avanzamento massimo ${assigned}/${total} lezioni ottimizzabili${excludedLessons.length ? ` · ${excludedLessons.length} escluse (classe UNKNOWN)` : ''}. La scomposizione del costo compare appena è completa la prima assegnazione.`;
        } else renderObjectiveBreakdown(progress.objectiveBreakdown);
        const workerLabel = progress.workersTotal ? ` · worker ${progress.workersCompleted || 0}/${progress.workersTotal}` : '';
        const stageLabel = algorithmInput.value === 'mixed' ? progress.algorithmStage === 'genetic' ? 'Genetico · ' : progress.algorithmStage === 'classic' ? 'Classico · ' : '' : '';
        const message = `${stageLabel}Iterazione ${Number(iteration).toLocaleString('it-IT')}${Number.isFinite(objective) ? ` · obiettivo ${Number(objective).toLocaleString('it-IT')}` : ''}${workerLabel}`;
        status.textContent = message; calculationStatus.textContent = message;
        const stageSeconds = Math.floor(Number(progress.stageElapsedMs || 0) / 1000).toLocaleString('it-IT');
        const cutoffLabel = `${Number(geneticStartAfterSeconds).toLocaleString('it-IT')} s`;
        optimizationStatus.textContent = progress.phase === 'mixed-transition' ? 'Avvio genetico dalla soluzione classica'
          : algorithmInput.value === 'mixed' && progress.algorithmStage === 'classic' ? `Classico · ${stageSeconds}/${cutoffLabel}`
            : algorithmInput.value === 'mixed' && progress.algorithmStage === 'genetic' && progress.phase !== 'feasibility' ? `Genetico · generazione ${Number(progress.generation || 0).toLocaleString('it-IT')}`
          : progress.phase === 'feasibility' ? `${progress.algorithmStage === 'genetic' || algorithmInput.value === 'genetic' ? 'Preparazione genetica' : 'Ricerca soluzione valida'}${Number(progress.feasibilityAttempt ?? progress.attempt) > 1 ? ` · tentativo ${Number(progress.feasibilityAttempt ?? progress.attempt).toLocaleString('it-IT')}` : ''}`
          : progress.phase === 'restart' ? `Nuovo tentativo ${Number(progress.restart || 0).toLocaleString('it-IT')}`
            : progress.phase === 'block' ? `Riorganizzo ${Number(progress.blockSize || 0).toLocaleString('it-IT')} lezioni`
              : progress.phase === 'perturbation' ? `Uscita dal minimo locale · scossa ${Number(progress.round || 0).toLocaleString('it-IT')}`
                : progress.phase === 'genetic' ? `Generazione ${Number(progress.generation || 0).toLocaleString('it-IT')}` : 'In miglioramento';
      },
    });
    if (recalculationController !== activeController) return result;
    recalculationController = null;
    searchButton.disabled = !currentLesson(); updateCalculationControl();
    cancelRecalculationButton.disabled = true;
    if (result.objective != null) objectiveOutput.textContent = Number(result.objective).toLocaleString('it-IT');
    renderObjectiveQuality(Number(result.objective), objectiveMaximum);
    if (result.iterations != null) iterationOutput.textContent = Number(result.iterations).toLocaleString('it-IT');
    renderObjectiveBreakdown(result.objectiveBreakdown);
    const hasCompleteProposal = result.assignments instanceof Map
      && optimizableLessons.every(lesson => result.assignments.has(lesson.id) && result.assignments.get(lesson.id));
    if ((result.status === 'solved' && hasCompleteProposal) || (hasCompleteProposal && ['cancelled', 'time-limit'].includes(result.status))) {
      const added = addFullScheduleProposal(result);
      if (added && result.status === 'solved') status.textContent = result.objective === 0
        ? `Obiettivo zero raggiunto: ottimo globale dimostrato · ${Number(result.iterations || 0).toLocaleString('it-IT')} iterazioni. Proposta pronta.`
        : `Soglia richiesta raggiunta (obiettivo ${Number(result.objective || 0).toLocaleString('it-IT')}); ottimo globale non dimostrato. Proposta pronta.`;
      else if (added && result.status === 'cancelled') status.textContent = `Calcolo fermato; la proposta valida trovata è pronta da applicare. L’orario corrente è invariato.`;
      else if (added && result.status === 'time-limit') status.textContent = `Tempo limite raggiunto; migliore proposta trovata: ${Number(result.objective ?? 0).toLocaleString('it-IT')} punti. Ottimo globale non dimostrato.`;
    } else if (result.status === 'no-eligible-lessons') status.textContent = `Nessuna attività con classe reale da ottimizzare. ${excludedLessons.length} attività con classe UNKNOWN restano conservate e invariate.`;
    else if (result.status === 'solved') status.textContent = 'Il motore ha restituito un risultato incompleto; nessuna proposta è stata preparata.';
    else if (result.status === 'cancelled') status.textContent = Number.isFinite(result.feasibilityTotal)
      ? `Calcolo fermato durante la preparazione: ${Number(result.feasibilityAssigned || 0).toLocaleString('it-IT')}/${Number(result.feasibilityTotal).toLocaleString('it-IT')} lezioni assegnate; nessuna proposta completa.`
      : `Calcolo fermato a ${Number(result.iterations || 0).toLocaleString('it-IT')} iterazioni; l’orario corrente è invariato.`;
    else if (result.status === 'time-limit') status.textContent = `Tempo limite raggiunto; non è stata trovata una proposta completa.`;
    else if (result.status === 'limit') status.textContent = `Ricerca interrotta al limite (${result.visited} tentativi); nessuna assegnazione applicata.`;
    else if (result.reason?.type === 'resource-capacity') status.textContent = `${result.reason.resourceName}: ${result.reason.demand} fasce richieste, ma il calendario ne consente al massimo ${result.reason.capacity}.`;
    else if (result.reason?.type === 'empty-domain') status.textContent = `${result.reason.lessonName}: nessuna fascia disponibile. Controlla durata e indisponibilità.`;
    else status.textContent = 'Nessuna assegnazione completa compatibile trovata; l’orario corrente è rimasto invariato.';
    calculationStatus.textContent = status.textContent;
    optimizationStatus.textContent = result.workersFallback ? 'Concluso · calcolo locale'
      : result.status === 'solved' ? result.objective === 0 ? 'Ottimo globale dimostrato' : 'Soglia raggiunta · ottimo non dimostrato'
        : result.status === 'cancelled' ? 'Fermato'
          : result.status === 'time-limit' ? 'Tempo esaurito'
          : result.status === 'limit' ? 'Limite di ricerca raggiunto'
            : result.reason?.type === 'resource-capacity' ? 'Capacità insufficiente'
              : result.reason?.type === 'empty-domain' ? 'Nessuna fascia disponibile' : 'Nessuna soluzione';
    if (!hasCompleteProposal) list.append(node(document, 'li', 'muted', 'Nessuna proposta applicabile.'));
    return result;
  }

  searchButton.addEventListener('click', () => { activeSearch = search(); });
  recalculateButton.addEventListener('click', () => { activeRecalculation = recalculate(); });
  reviewCalculationButton.addEventListener('click', () => applyLatestRecalculation());
  cancelButton.addEventListener('click', () => {
    if (!controller) return;
    controller.abort();
    status.textContent = 'Annullamento ricerca…';
  });
  cancelRecalculationButton.addEventListener('click', () => {
    recalculationController?.abort();
    status.textContent = 'Annullamento ricalcolo…';
  });
  function applySelectedProposal() {
    if (!selectedOption || !history) return;
    const option = selectedOption;
    const applyOption = () => {
      try {
        const fullRecalculation = option.fullRecalculation;
        const next = history.apply(option.proposal);
        const lessonId = selectedLessonId;
        status.textContent = fullRecalculation ? 'Orario applicato e visualizzato.' : 'Modifica applicata. Consulta l’orario aggiornato.';
        calculationStatus.textContent = status.textContent;
        reviewCalculationButton.hidden = true;
        clearOptions();
        renderUndo();
        timetable = next;
        updateCalculationControl();
        refreshConstraintControls();
        onApply(next, lessonId, fullRecalculation ? 'recalculation' : 'apply');
      } catch (error) {
        status.textContent = error.message || 'La proposta non è più applicabile. Cerca nuove alternative.';
        clearOptions();
      }
    };
    if (option.fullRecalculation || option.proposal.changes.length > 1) {
      const affected = option.proposal.changes.length;
      const message = option.fullRecalculation
        ? `Sostituire tutte le assegnazioni con il ricalcolo per ${affected} ${affected === 1 ? 'lezione' : 'lezioni'}?`
        : `Applicare la modifica coordinata a ${affected} lezioni?`;
      if (typeof confirm !== 'function') {
        status.textContent = 'Proposta non applicata.';
        return;
      }
      const confirmation = confirm(message);
      if (confirmation && typeof confirmation.then === 'function') {
        status.textContent = 'In attesa di conferma…';
        return confirmation.then(accepted => {
          if (!accepted || selectedOption !== option) {
            status.textContent = 'Proposta non applicata.';
            return;
          }
          applyOption();
        }, error => {
          status.textContent = error?.message || 'Proposta non applicata.';
        });
      }
      if (!confirmation) {
        status.textContent = 'Proposta non applicata.';
        return;
      }
    }
    applyOption();
  }
  applyButton.addEventListener('click', applySelectedProposal);

  function applyLatestRecalculation() {
    const fullOption = [...options.values()].reverse().find(item => item.fullRecalculation);
    if (!fullOption) return false;
    selectedOption = fullOption;
    applySelectedProposal();
    return true;
  }
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
  redoButton.addEventListener('click', () => {
    if (!history?.redo()) return;
    const restored = history.current;
    const lessonId = selectedLessonId;
    timetable = restored;
    updateCalculationControl();
    clearOptions();
    renderUndo();
    refreshConstraintControls();
    status.textContent = 'Modifica ripristinata.';
    onApply(restored, lessonId, 'redo');
  });
  constraintUndoButton.addEventListener('click', () => undoButton.click());

  function tryManualEdit(evaluate, description) {
    try {
      const result = evaluate(timetable);
      const next = history.commit(result.timetable);
      timetable = next;
      clearOptions();
      renderUndo();
      updateCalculationControl();
      refreshConstraintControls();
      const delta = result.softAfter - result.softBefore;
      status.textContent = delta > 0
        ? `${description} accettata. Penalità soft aumentata da ${result.softBefore} a ${result.softAfter} punti (+${delta}).`
        : delta < 0
          ? `${description} accettata. Penalità soft ridotta da ${result.softBefore} a ${result.softAfter} punti (${delta}).`
          : `${description} accettata. Penalità soft invariata (${result.softAfter} punti).`;
      onApply(next, selectedLessonId, 'manual');
      return { valid: true, worsensSoft: delta > 0, softBefore: result.softBefore, softAfter: result.softAfter };
    } catch (error) {
      return { valid: false, reason: error.message || 'La modifica viola un vincolo hard.' };
    }
  }

  updateCalculationControl();
  refreshConstraintControls();

  return {
    applyLatestRecalculation() {
      return applyLatestRecalculation();
    },
    selectLesson(lessonId) {
      selectedLessonId = lessonId;
      controller?.abort();
      controller = null;
      clearOptions();
      const lesson = currentLesson();
      panel.hidden = !lesson;
      searchButton.disabled = !lesson;
      refreshConstraintControls();
      status.textContent = !lesson
        ? 'Seleziona una lezione per esplorare alternative.'
        : lesson.assignedTime
          ? 'Puoi cercare spostamenti compatibili per questa lezione.'
          : 'Puoi cercare un primo orario compatibile per questa lezione.';
      renderUndo();
    },
    previewManualMove(lessonId, assignedTime, swapWithLessonId = null) {
      try {
        const result = swapWithLessonId
          ? evaluateManualSwap(timetable, lessonId, swapWithLessonId)
          : evaluateManualMove(timetable, lessonId, assignedTime);
        return { valid: true, worsensSoft: result.softAfter > result.softBefore };
      } catch (error) {
        return { valid: false, reason: error.message || 'La modifica viola un vincolo hard.' };
      }
    },
    moveLesson(lessonId, assignedTime) {
      return tryManualEdit(model => evaluateManualMove(model, lessonId, assignedTime), 'Spostamento');
    },
    swapLessons(firstLessonId, secondLessonId) {
      return tryManualEdit(model => evaluateManualSwap(model, firstLessonId, secondLessonId), 'Scambio');
    },
    setManualStatus(message) { status.textContent = message || 'Modifica non applicata.'; },
    setScreen(screen, detail) {
      panel.hidden = screen !== 'schedule' || detail?.type !== 'lessons';
    },
    showConstraintsFor(scope, id, selected = null) {
      const target = constraintTargetValue(scope, id);
      if (!target) return false;
      constraintFilter.value = '';
      refreshConstraintControls();
      constraintTarget.value = target;
      if (selected) {
        constraintKind.value = selected.kind;
        constraintDay.value = String(Number(selected.slot.split('.')[0]));
        constraintPeriod.value = String(Number(selected.slot.split('.')[1]));
        editingConstraint = { ...selected, scope: scopeForValue(target), id };
        addConstraintButton.textContent = 'Salva vincolo';
      } else {
        editingConstraint = null;
        addConstraintButton.textContent = 'Aggiungi vincolo';
      }
      refreshConstraintControls();
      return true;
    },
    deleteSelectedConstraint(scope, id, kind, slot) {
      commitConstraint({ scope, id, kind, action: 'delete', slot });
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
      constraintStatus.textContent = next ? 'Puoi gestire indisponibilità e preferenze temporali.' : 'Importa un orario per gestire i vincoli.';
      addConstraintButton.textContent = 'Aggiungi vincolo';
      refreshConstraintControls();
      renderUndo();
    },
    get searchComplete() { return activeSearch; },
    get recalculationComplete() { return activeRecalculation; },
  };
}
