import { importOFD, OFDImportError } from './ofd-importer.js';
import { importTimetableEDN, exportTimetableEDN, EDNImportError } from './edn-importer.js';
import { createTimetableViews } from './views.js';
import { createTimetableEditor } from './editor.js';
import { createEmptySchool, createSchoolWorkbench, evaluateConstraintStatus } from './school-workbench.js';
import { parseConstraintCSV, parseRosterCSV } from './roster-importer.js';
import { getCalculationReadiness, validateTimetable } from './validation.js';
import { TIMETABLE_VERSION } from './version.js';
import { optimizationScope } from './optimization-scope.js';
import { createTimetablePersistence } from './persistence.js';
import { objectiveValue, objectiveUpperBound } from './optimization-core.js';

const numberFormat = new Intl.NumberFormat('it-IT');
const percentFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const rosterWarningCodes = new Set(['encoding-mismatch', 'period-name-mismatch', 'unsupported-structure', 'unsupported-attribute']);

function element(document, tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text != null) node.textContent = String(text);
  return node;
}

function diagnosticText(item) {
  if (item.code === 'encoding-mismatch') return `La codifica dichiarata (${item.declaredEncoding || ''}) non corrisponde ai byte del file; è stata usata ${item.decodedEncoding || 'una codifica compatibile'}.`;
  if (item.code === 'period-name-mismatch') return 'Il nome del documento e quello dei dati non coincidono; entrambi sono conservati.';
  if (item.code === 'unassigned-lessons') return `${numberFormat.format(item.details?.count ?? 0)} lezioni senza orario assegnato nel file.`;
  if (item.code === 'assignments-omitted') return `${numberFormat.format(item.details?.count ?? 0)} collocazioni del file non importate; le posizioni originali non sono usate nei calcoli.`;
  if (item.code === 'unsupported-structure') return `Elemento OFD non riconosciuto ${item.details?.tags?.join(', ') || item.path || ''}: resta conservato nel sorgente.`;
  if (item.code === 'unsupported-attribute') return `Attributo OFD non riconosciuto ${item.path || ''}: resta conservato nel sorgente.`;
  if (item.code === 'unsupported-schema-version') return `Versione dello schema EDN non supportata (${item.path}).`;
  if (item.code === 'missing-reference') return `Riferimento a un elemento mancante (${item.path}).`;
  if (item.code === 'duplicate-id' || item.code === 'duplicate-name') return `Identificatore o nome duplicato (${item.path}).`;
  if (item.code === 'invalid-assignment' || item.code === 'invalid-timeframe') return `Orario fuori dal calendario dichiarato (${item.path}).`;
  if (item.code === 'invalid-duration') return `Durata della lezione non valida (${item.path}).`;
  if (item.code === 'invalid-shape' || item.code === 'empty-calendar') return `Dati mancanti o con formato non valido (${item.path}).`;
  if (item.code === 'invalid-ofd' && /Duplicate/i.test(item.message)) return `Dato duplicato: ${item.message.replace(/^Duplicate\s+/i, '')}`;
  if (item.code === 'invalid-ofd' && /Missing required/i.test(item.message)) return `Manca un campo obbligatorio: ${item.message.replace(/^Missing required\s+/i, '')}`;
  if (item.code === 'invalid-ofd' && /refers to missing/i.test(item.message)) return `Il file contiene un riferimento non presente (${item.path}).`;
  if (item.code === 'invalid-ofd' && /time value|timeframe/i.test(item.message)) return `Un orario o una disponibilità non rientra nel calendario (${item.path}).`;
  return item.message;
}

/** Owns pending/current import state; only an explicit action replaces current data. */
export function createTimetableApp({ document = globalThis.document, DOMParser = document?.defaultView?.DOMParser, confirm = document?.defaultView?.confirm?.bind(document.defaultView), importer = source => importOFD(source, { DOMParser }), indexedDB = document?.defaultView?.indexedDB } = {}) {
  if (!document) throw new TypeError('A document is required to mount the timetable import screen.');
  const report = document.querySelector('#import-report');
  const importActions = document.querySelector('.import-actions');
  const summary = document.querySelector('#import-summary');
  const diagnosticsList = document.querySelector('#import-diagnostics');
  const applyButton = document.querySelector('#apply-import');
  const cancelButton = document.querySelector('#cancel-import');
  const currentStatus = document.querySelector('#current-status');
  const topbarCoverage = document.querySelector('#topbar-constraint-coverage');
  const topbarCoverageValue = document.querySelector('#topbar-constraint-coverage-value');
  const importCard = document.querySelector('#import-card');
  const detailPanel = document.querySelector('#entity-detail-panel');
  const detailTitle = document.querySelector('#entity-detail-title');
  const detailContent = document.querySelector('#entity-detail-content');
  const detailActions = document.querySelector('#entity-detail-actions');
  const detailBackButton = document.querySelector('#detail-back');
  const detailResizer = document.querySelector('#detail-resizer');
  const confirmationOverlay = document.querySelector('#confirmation-overlay');
  const confirmationTitle = document.querySelector('#confirmation-title');
  const confirmationMessage = document.querySelector('#confirmation-message');
  const confirmationCancel = document.querySelector('#confirmation-cancel');
  const confirmationAccept = document.querySelector('#confirmation-accept');
  const appWorkspace = document.querySelector('.workspace');
  const versionOutput = document.querySelector('#app-version');
  const persistence = createTimetablePersistence(indexedDB);
  const schoolDescription = document.querySelector('#school-description');
  const resetProjectButton = document.querySelector('#reset-project');
  const resetProjectStatus = document.querySelector('#reset-project-status');
  const externalOFDInput = document.querySelector('#external-ofd-file');
  const externalOFDApply = document.querySelector('#apply-external-ofd');
  const externalOFDStatus = document.querySelector('#external-ofd-status');
  const pdfType = document.querySelector('#pdf-output-type');
  const pdfEntityWrap = document.querySelector('#pdf-entity-wrap');
  const pdfEntitySelect = document.querySelector('#pdf-entity-select');
  const printButton = document.querySelector('#print-timetable');
  const pdfPrintContent = document.querySelector('#pdf-print-content');
  if (![report, summary, diagnosticsList, applyButton, cancelButton, currentStatus, importCard, appWorkspace, detailPanel, detailTitle, detailContent, detailActions, detailBackButton, detailResizer, confirmationOverlay, confirmationTitle, confirmationMessage, confirmationCancel, confirmationAccept, resetProjectButton, resetProjectStatus].every(Boolean)) {
    throw new Error('Timetable import screen is missing a required accessible control.');
  }
  if (versionOutput) versionOutput.textContent = `v${TIMETABLE_VERSION}`;

  function detailWidthLimits() {
    const style = document.defaultView.getComputedStyle(appWorkspace);
    const padding = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
    const max = Math.min(960, appWorkspace.clientWidth - padding - 320 - 12);
    return { min: 250, max: Math.max(250, max) };
  }
  function setDetailWidth(width) {
    const limits = detailWidthLimits();
    const nextWidth = Math.round(Math.max(limits.min, Math.min(limits.max, width)));
    appWorkspace.style.setProperty('--detail-panel-width', `${nextWidth}px`);
    detailResizer.setAttribute('aria-valuemax', String(limits.max));
    detailResizer.setAttribute('aria-valuenow', String(nextWidth));
    detailResizer.setAttribute('aria-valuetext', `${nextWidth} pixel`);
  }
  const currentDetailWidth = () => {
    const configured = parseFloat(document.defaultView.getComputedStyle(appWorkspace).getPropertyValue('--detail-panel-width'));
    return configured || detailPanel.getBoundingClientRect().width || 320;
  };
  let resizingPointerId = null;
  detailResizer.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    resizingPointerId = event.pointerId;
    detailResizer.setPointerCapture?.(event.pointerId);
    document.body.classList.add('is-resizing-details');
    event.preventDefault();
  });
  detailResizer.addEventListener('pointermove', event => {
    if (resizingPointerId !== event.pointerId) return;
    setDetailWidth(detailPanel.getBoundingClientRect().right - event.clientX);
  });
  const finishDetailResize = event => {
    if (resizingPointerId !== event.pointerId) return;
    resizingPointerId = null;
    document.body.classList.remove('is-resizing-details');
    if (detailResizer.hasPointerCapture?.(event.pointerId)) detailResizer.releasePointerCapture(event.pointerId);
  };
  detailResizer.addEventListener('pointerup', finishDetailResize);
  detailResizer.addEventListener('pointercancel', finishDetailResize);
  detailResizer.addEventListener('lostpointercapture', finishDetailResize);
  detailResizer.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setDetailWidth(currentDetailWidth() + (event.key === 'ArrowLeft' ? 24 : -24));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const limits = detailWidthLimits();
      setDetailWidth(event.key === 'Home' ? limits.max : limits.min);
    }
  });

  let current = createEmptySchool();
  let currentDiagnostics = [];
  let pending = null;
  let pendingRoster = null;
  let pendingLessons = null;
  let pendingOFD = null;
  let pendingExternalCSV = new Map();
  let stagingGeneration = 0;
  let views;
  let editor;
  let activeScreen = 'teachers';
  let activeSchoolView = 'teachers';
  let activeDetail = null;
  let moveSuggestionGeneration = 0;
  let detailNavigationStack = [];
  let navigatingToEntity = false;
  let hasUnexportedChanges = false;
  let hasEditedDuringLoad = false;
  let saveGeneration = 0;
  let pendingConfirmation = null;
  let confirmationReturnFocus = null;
  function readObjectiveWeights() {
    const undesiredWeight = Number(document.querySelector('#optimization-weight-undesired')?.value);
    const preferredWeight = Number(document.querySelector('#optimization-weight-preferred')?.value);
    const weights = { undesiredSlot: undesiredWeight, missedPreferredSlot: preferredWeight };
    return Object.values(weights).every(value => Number.isInteger(value) && value >= 0 && value <= 1000) ? weights : null;
  }
  function qualityPercent(objective, maximum) {
    return maximum > 0 ? Math.max(0, Math.min(100, (1 - objective / maximum) * 100)) : objective === 0 ? 100 : null;
  }
  function updateConstraintCoverage() {
    if (!topbarCoverage || !topbarCoverageValue) return;
    const { optimizableLessons } = optimizationScope(current);
    if (!optimizableLessons.length) {
      topbarCoverage.hidden = true;
      return;
    }
    const weights = readObjectiveWeights();
    if (!weights) {
      topbarCoverageValue.textContent = '—';
      topbarCoverage.hidden = false;
      return;
    }
    const quality = qualityPercent(objectiveValue(current, undefined, weights), objectiveUpperBound(current, weights));
    topbarCoverageValue.textContent = quality == null ? '—' : `${percentFormat.format(quality)}%`;
    topbarCoverage.hidden = false;
  }
  function closeConfirmation(accepted) {
    if (confirmationOverlay.hidden) return;
    const action = pendingConfirmation;
    const returnFocus = confirmationReturnFocus;
    pendingConfirmation = null;
    confirmationReturnFocus = null;
    confirmationOverlay.hidden = true;
    if (accepted) action?.onConfirm?.();
    else action?.onCancel?.();
    const target = returnFocus?.isConnected ? returnFocus : detailTitle;
    if (target?.isConnected) target.focus();
  }
  function requestConfirmation({ title, message, confirmLabel = 'Conferma', onConfirm, onCancel }) {
    confirmationTitle.textContent = title;
    confirmationMessage.textContent = message;
    confirmationAccept.textContent = confirmLabel;
    pendingConfirmation = { onConfirm, onCancel };
    confirmationReturnFocus = document.activeElement;
    confirmationOverlay.hidden = false;
    confirmationCancel.focus();
  }
  function confirmProposal(message) {
    return new Promise(resolve => {
      requestConfirmation({
        title: message.startsWith('Sostituire tutte le assegnazioni') ? 'Applicare il ricalcolo?' : 'Applicare la modifica?',
        message,
        confirmLabel: message.startsWith('Sostituire tutte le assegnazioni') ? 'Applica orario' : 'Applica modifica',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
  confirmationCancel.addEventListener('click', () => closeConfirmation(false));
  confirmationAccept.addEventListener('click', () => closeConfirmation(true));
  confirmationOverlay.addEventListener('click', event => {
    if (event.target === confirmationOverlay) closeConfirmation(false);
  });
  document.addEventListener('keydown', event => {
    if (confirmationOverlay.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(false); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey && document.activeElement === confirmationCancel) confirmationAccept.focus();
      else if (!event.shiftKey && document.activeElement === confirmationAccept) confirmationCancel.focus();
      else (event.shiftKey ? confirmationCancel : confirmationAccept).focus();
    }
  });
  const saveStateBadge = document.querySelector('.draft-badge');
  for (const input of document.querySelectorAll('#optimization-weight-undesired, #optimization-weight-preferred')) {
    input.addEventListener('input', updateConstraintCoverage);
    input.addEventListener('change', () => {
      updateConstraintCoverage();
      if (activeDetail?.type === 'lessons' && !detailPanel.hidden) openEntityDetail(activeDetail);
    });
  }
  function markUnsavedChanges() {
    hasUnexportedChanges = true;
    hasEditedDuringLoad = true;
    currentStatus.textContent = 'Modifiche non esportate';
    if (saveStateBadge) saveStateBadge.textContent = 'Salvataggio…';
    const generation = ++saveGeneration;
    persistence.save(current).then(saved => {
      if (generation !== saveGeneration) return;
      if (saveStateBadge) saveStateBadge.textContent = saved ? 'Salvato' : 'Solo in memoria';
      hasUnexportedChanges = false;
    }).catch(() => {
      if (generation === saveGeneration && saveStateBadge) saveStateBadge.textContent = 'Salvataggio non riuscito';
    });
  }
  function markChangesExported() {
    hasUnexportedChanges = false;
    if (saveStateBadge) saveStateBadge.textContent = 'Salvato';
  }
  const unknownCount = (timetable, collection, lessonField) => {
    const unknownIds = new Set((timetable.entities?.[collection] || []).filter(item => item.placeholder === 'unknown').map(item => item.id));
    return timetable.lessons.filter(lesson => lessonField === 'subjectId'
      ? unknownIds.has(lesson.subjectId)
      : (lesson[lessonField] || []).some(id => unknownIds.has(id))).length;
  };
  const schoolWorkbench = createSchoolWorkbench({
    document,
    onDetail: detail => {
      if (!navigatingToEntity) detailNavigationStack = [];
      openEntityDetail(detail);
    },
    onChange: next => {
      current = next;
      const activeLessonWarnings = (next.source.lessonImports || []).flatMap(item => item.diagnostics || [])
        .filter(item => String(item.code || '').startsWith('lesson-'));
      const currentLessonWarnings = activeLessonWarnings.flatMap(item => {
        if (item.code === 'lesson-without-class') {
          const count = unknownCount(next, 'classes', 'classIds');
          return count ? [{ ...item, message: `${count} attività OFD usano la classe UNKNOWN: sono escluse dal calcolo e restano disponibili per la gestione separata.` }] : [];
        }
        if (item.code === 'lesson-without-subject') {
          const count = unknownCount(next, 'subjects', 'subjectId');
          return count ? [{ ...item, message: `${count} lezioni OFD non hanno una materia; usano UNKNOWN e non bloccano il calcolo.` }] : [];
        }
        return [item];
      });
      currentDiagnostics = [...currentDiagnostics.filter(item => !String(item.code || '').startsWith('lesson-')), ...currentLessonWarnings];
      editor?.setTimetable(current);
      if (views) refreshViews(true);
      if (activeDetail && !detailPanel.hidden) openEntityDetail(activeDetail);
      updateCalculationReadiness();
      document.querySelector('#topbar-school-name').textContent = current.name;
      document.querySelector('#school-name').value = current.name;
      if (schoolDescription) schoolDescription.value = current.description || '';
      markUnsavedChanges();
      exportButton.disabled = false;
      exportToolsButton.disabled = false;
      refreshPDFControls();
    },
  });
  editor = createTimetableEditor({
    document,
    getTimetable: () => current,
    confirm: confirmProposal,
    onApply: (next, _lessonId, action) => {
      current = next;
      schoolWorkbench.setTimetable(current);
      markUnsavedChanges();
      // A full recalculation replaces assignments only after the operator confirms it.
      refreshViews(action !== 'recalculation');
      if (action === 'recalculation') {
        const { optimizableLessons } = optimizationScope(current);
        const realClasses = new Map(current.entities.classes
          .filter(item => item.placeholder !== 'unknown')
          .map(item => [item.id, item]));
        const classLessonCounts = new Map();
        for (const lesson of optimizableLessons) {
          if (!lesson.assignedTime) continue;
          for (const id of new Set(lesson.classIds || [])) {
            if (realClasses.has(id)) classLessonCounts.set(id, (classLessonCounts.get(id) || 0) + 1);
          }
        }
        const classId = [...classLessonCounts].sort((left, right) => right[1] - left[1])[0]?.[0];
        if (classId) views.showEntitySchedule('class', classId);
        else views.showSchedule();
        detailNavigationStack = [];
        activeDetail = null;
        showScreen('schedule');
        // Keep the view and the visible screen in sync after leaving calculation.
        views.showSchedule();
        if (!detailPanel.hidden) showEmptyDetail();
        const assignedCount = optimizableLessons.filter(lesson => lesson.assignedTime).length;
        const visibleCount = document.querySelectorAll('#schedule-grid [data-lesson-id]').length;
        const className = realClasses.get(classId)?.name;
        const feedback = visibleCount
          ? `Orario applicato: ${numberFormat.format(assignedCount)} lezioni assegnate; ${numberFormat.format(visibleCount)} visualizzate${className ? ` per ${className}` : ''}.`
          : `Orario applicato: ${numberFormat.format(assignedCount)} di ${numberFormat.format(optimizableLessons.length)} lezioni assegnate, ma nessuna è visibile nella tabella.`;
        document.querySelector('#recalculation-status').textContent = feedback;
        document.querySelector('#edit-status').textContent = feedback;
        document.querySelector('#schedule-status').textContent = feedback;
      }
      if (activeDetail && !detailPanel.hidden) openEntityDetail(activeDetail);
    },
  });
  views = createTimetableViews({ document,
    onBeforeLessonNavigate: () => {
      detailNavigationStack.push({ label: 'Avvisi e conflitti', state: captureDetailContext() });
      updateDetailBackButton();
    },
    onLessonSelect: (lesson, { navigate = false } = {}) => {
    if (!navigate) detailNavigationStack = [];
    editor.selectLesson(lesson.id);
    openEntityDetail({ type: 'lessons', id: lesson.id });
  },
    onManualPreview: (lessonId, assignedTime, swapWithLessonId) => editor.previewManualMove(
      lessonId, assignedTime, swapWithLessonId, readObjectiveWeights() || undefined,
    ),
    onManualDrop: (lessonId, assignedTime, swapWithLessonId) => {
      const result = swapWithLessonId
        ? editor.swapLessons(lessonId, swapWithLessonId, readObjectiveWeights() || undefined)
        : editor.moveLesson(lessonId, assignedTime, readObjectiveWeights() || undefined);
      if (!result.valid) editor.setManualStatus(result.reason);
    },
  });
  schoolWorkbench.setTimetable(current);
  editor.setTimetable(current);
  views.render(current, currentDiagnostics);

  for (const panel of document.querySelectorAll('#school-page [data-school-panel]')) {
    const tools = panel.querySelector('.sheet-tools');
    const table = panel.querySelector('.school-grid');
    if (!tools || !table?.querySelector('[data-grid-column-filter]')) continue;
    const toggle = element(document, 'button', { type: 'button', class: 'secondary-button column-filter-toggle', 'aria-expanded': 'false' });
    toggle.textContent = 'Filtri per colonna';
    toggle.addEventListener('click', () => {
      const expanded = panel.classList.toggle('column-filters-open');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Nascondi filtri per colonna' : 'Filtri per colonna';
    });
    tools.append(toggle);
  }

  function updateCalculationReadiness() {
    const missing = getCalculationReadiness(current);
    const output = document.querySelector('#calculation-readiness');
    const button = document.querySelector('#recalculate-all');
    if (output) {
      output.replaceChildren();
      output.dataset.state = missing.length ? 'blocked' : 'ready';
      const title = element(document, 'strong');
      title.textContent = missing.length ? 'Calcolo disabilitato: completa questi requisiti.' : 'Requisiti completi.';
      output.append(title);

      const blockers = [];
      const destinations = new Map();
      const addDestination = (screen, label) => destinations.set(screen, label);
      if (missing.includes('teachers')) { blockers.push('Aggiungi almeno un docente nella scheda Docenti.'); addDestination('teachers', 'Aggiungi docenti'); }
      if (missing.includes('classes')) { blockers.push('Aggiungi almeno una classe nella scheda Classi.'); addDestination('classes', 'Aggiungi classi'); }
      if (missing.includes('subjects')) { blockers.push('Aggiungi almeno una materia nella scheda Classi → Materie.'); addDestination('classes', 'Aggiungi materie'); }
      if (missing.includes('lessons')) { blockers.push('Definisci almeno una lezione collegando materia, docente e classe.'); addDestination('lessons', 'Definisci lezioni'); }
      if (missing.includes('lesson-details')) {
        const ids = collection => new Set((Array.isArray(current.entities?.[collection]) ? current.entities[collection] : []).map(item => item.id));
        const teacherIds = ids('teachers'), classIds = ids('classes'), subjectIds = ids('subjects');
        const lessons = current.lessons;
        const withoutSubject = lessons.filter(item => !subjectIds.has(item.subjectId)).length;
        const withoutTeacher = lessons.filter(item => !item.teacherIds?.length || item.teacherIds.some(id => !teacherIds.has(id))).length;
        const withoutClass = lessons.filter(item => !item.classIds?.length || item.classIds.some(id => !classIds.has(id))).length;
        const gaps = [withoutSubject && `${withoutSubject} senza materia`, withoutTeacher && `${withoutTeacher} senza docente`, withoutClass && `${withoutClass} senza classe`].filter(Boolean);
        blockers.push(`${lessons.filter(item => !subjectIds.has(item.subjectId) || !item.teacherIds?.length || item.teacherIds.some(id => !teacherIds.has(id)) || !item.classIds?.length || item.classIds.some(id => !classIds.has(id))).length} lezioni incomplete${gaps.length ? `: ${gaps.join(', ')}` : ''}.`);
        addDestination('lessons', 'Completa lezioni');
      }
      if (missing.includes('invalid-data')) {
        const errors = validateTimetable(current).errors;
        const describe = issue => {
          if (issue.code === 'invalid-timeframe') return 'Un vincolo usa una fascia fuori dal calendario.';
          if (issue.code === 'invalid-assignment') return 'Un orario assegnato non rientra nel calendario.';
          if (issue.code === 'invalid-duration') return 'Una lezione ha una durata non valida.';
          if (issue.code === 'duplicate-name' || issue.code === 'duplicate-id') return 'Ci sono nomi o identificativi duplicati.';
          if (issue.code === 'missing-reference') return 'Una lezione o uno studente punta a un elemento mancante.';
          if (issue.path?.startsWith('calendar')) return 'Il calendario ha giorni o fasce orarie non validi.';
          return 'Ci sono dati non validi da correggere prima del calcolo.';
        };
        const messages = [...new Set(errors.map(describe))];
        blockers.push(...messages.slice(0, 3));
        if (messages.length > 3) blockers.push(`Altri ${messages.length - 3} tipi di errore da correggere.`);
        if (errors.some(issue => issue.path?.startsWith('lessons'))) addDestination('lessons', 'Controlla lezioni');
        if (errors.some(issue => issue.path?.includes('timeframes'))) addDestination('constraints', 'Controlla vincoli');
      }

      if (blockers.length) {
        const list = element(document, 'ul', { class: 'calculation-blockers' });
        blockers.forEach(message => { const item = element(document, 'li'); item.textContent = message; list.append(item); });
        output.append(list);
        if (destinations.size) {
          const actions = element(document, 'div', { class: 'readiness-actions', 'aria-label': 'Vai ai dati da completare' });
          for (const [screen, label] of destinations) {
            const action = element(document, 'button', { type: 'button', class: 'secondary-button', 'data-readiness-screen': screen });
            action.textContent = label;
            action.addEventListener('click', () => showScreen(screen));
            actions.append(action);
          }
          output.append(actions);
        }
      } else {
        const ready = element(document, 'p', { class: 'calculation-readiness-note' });
        const unknownClasses = unknownCount(current, 'classes', 'classIds');
        const unknownSubjects = unknownCount(current, 'subjects', 'subjectId');
        ready.textContent = unknownClasses || unknownSubjects
          ? `Calcolo disponibile. ${unknownClasses ? `${unknownClasses} attività con classe UNKNOWN saranno escluse e conservate.` : ''}${unknownSubjects ? ` ${unknownSubjects} attività con materia UNKNOWN restano nel calcolo se hanno una classe reale.` : ''}`
          : 'Il motore calcola le assegnazioni: non serve inserire giorno e ora a mano.';
        output.append(ready);
      }
      if (missing.length) {
        const note = element(document, 'p', { class: 'calculation-readiness-note' });
        note.textContent = 'Le aule e i vincoli aggiuntivi sono facoltativi; gli orari vengono assegnati dal motore.';
        output.append(note);
      }
    }
    if (button && !editor?.recalculationRunning) button.disabled = missing.length > 0;
  }

  function showScreen(screen) {
    const schoolViews = ['teachers', 'classes', 'rooms', 'lessons', 'constraints'];
    if (!['schedule', 'calculation', ...schoolViews, 'settings', 'pdf'].includes(screen)) screen = 'teachers';
    if (schoolViews.includes(screen)) activeSchoolView = screen;
    activeScreen = screen;
    if (screen === 'schedule' && views.screen !== 'schedule') views.showSchedule();
    const showDetails = !['calculation', 'settings', 'pdf'].includes(screen);
    detailPanel.hidden = !showDetails;
    detailResizer.hidden = !showDetails;
    appWorkspace.classList.toggle('has-detail-panel', showDetails);
    appWorkspace.classList.toggle('without-details-panel', !showDetails);
    if (!activeDetail) showEmptyDetail();
    document.querySelector('#school-page').hidden = !schoolViews.includes(screen);
    document.querySelector('#settings-page').hidden = screen !== 'settings';
    importCard.hidden = screen !== 'settings';
    document.querySelector('#calculation-page').hidden = screen !== 'calculation';
    document.querySelector('#timetable-workspace').hidden = screen !== 'schedule';
    document.querySelector('#pdf-page').hidden = screen !== 'pdf';
    document.querySelector('.current-card').hidden = true;
    document.querySelector('#issues-page').hidden = true;
    document.querySelector('#structure-page').hidden = true;
    for (const panel of document.querySelectorAll('[data-school-panel]')) {
      panel.hidden = !schoolViews.includes(screen)
        || !(panel.dataset.schoolPanel === screen || (screen === 'classes' && panel.dataset.schoolPanel === 'classes'));
    }
    const schoolCopy = {
      teachers: ['Docenti', 'Docenti assegnabili alle lezioni.'],
      classes: ['Classi e Materie', 'Classi e materie associate alle lezioni.'],
      rooms: ['Aule', 'Aule associate alle lezioni.'],
      lessons: ['Lezioni', 'Lezioni e risorse da assegnare nell’orario.'],
      constraints: ['Vincoli', 'Vincoli temporali condivisi da tutti gli elementi.'],
    }[screen] || ['Docenti', 'Docenti assegnabili alle lezioni.'];
    document.querySelector('#school-view-label').textContent = schoolCopy[0];
    document.querySelector('#school-heading').textContent = schoolCopy[0];
    document.querySelector('#school-heading-intro').textContent = schoolCopy[1];
    for (const button of document.querySelectorAll('[data-screen]')) {
      const active = button.dataset.screen === screen;
      button.setAttribute('aria-pressed', String(active));
    }
    document.documentElement.dataset.activeScreen = screen;
    if (screen === 'schedule') document.querySelector('#timetable-heading').setAttribute('tabindex', '-1');
    editor.setScreen(screen, activeDetail);
  }
  function refreshViews(preserveContext = false) {
    views.render(current, currentDiagnostics, { preserveContext });
    updateConstraintCoverage();
    if (activeScreen !== 'schedule') document.querySelector('#timetable-workspace').hidden = true;
  }
  for (const button of document.querySelectorAll('[data-screen]')) button.addEventListener('click', () => {
    detailNavigationStack = [];
    activeDetail = null;
    if (button.dataset.screen === 'schedule') views.clearLessonSelection();
    showScreen(button.dataset.screen);
  });
  document.querySelector('#go-to-schedule')?.addEventListener('click', () => showScreen('schedule'));
  document.querySelector('#school-name').addEventListener('change', event => {
    const name = event.currentTarget.value.trim();
    if (!name) { event.currentTarget.value = current.name; return; }
    schoolWorkbench.setName(name);
    document.querySelector('#topbar-school-name').textContent = name;
    markUnsavedChanges();
    exportButton.disabled = false;
    exportToolsButton.disabled = false;
    refreshViews(true);
  });
  schoolDescription?.addEventListener('change', event => {
    schoolWorkbench.setDescription(event.currentTarget.value);
    event.currentTarget.value = current.description || '';
  });
  showScreen('teachers');
  updateCalculationReadiness();

  function addDetailSection(title, lines) {
    const section = element(document, 'section', { class: 'entity-detail-section' });
    const heading = element(document, 'h3'); heading.textContent = title; section.append(heading);
    if (!lines.length) {
      const empty = element(document, 'p', { class: 'muted' }); empty.textContent = 'Nessun dato.'; section.append(empty);
    } else {
      const list = element(document, 'ul');
      for (const line of lines) { const item = element(document, 'li'); item.textContent = line; list.append(item); }
      section.append(list);
    }
    detailContent.append(section);
  }

  function addLessonSection(title, lessons, contextCollection = null, contextId = null) {
    const section = element(document, 'section', { class: 'entity-detail-section' });
    const heading = element(document, 'h3'); heading.textContent = title; section.append(heading);
    if (!lessons.length) {
      const empty = element(document, 'p', { class: 'muted' }); empty.textContent = 'Nessun dato.'; section.append(empty);
      detailContent.append(section);
      return;
    }
    const list = element(document, 'ul', { class: 'entity-lesson-list' });
    const appendEntityLink = (parent, collection, id, className = '') => {
      const linked = current.entities[collection]?.find(item => item.id === id);
      if (!linked) return false;
      const button = element(document, 'button', { type: 'button', class: `detail-link ${className}`.trim(), title: `Apri i dettagli di ${collectionLabels[collection] || collection} ${linked.name}` });
      button.textContent = linked.name;
      button.addEventListener('click', () => navigateToEntity(collection, id));
      parent.append(button);
      return true;
    };
    const collectionLabels = { teachers: 'docente', classes: 'classe', subjects: 'materia', rooms: 'aula' };
    const separator = parent => parent.append(document.createTextNode(' · '));
    for (const lesson of lessons) {
      const row = element(document, 'li');
      let hasPart = false;
      const addPart = callback => {
        if (hasPart) separator(row);
        const before = row.childNodes.length;
        const added = callback();
        if (added === false) {
          if (hasPart) row.lastChild.remove();
          return;
        }
        if (row.childNodes.length > before) hasPart = true;
      };
      if (!(contextCollection === 'subjects' && lesson.subjectId === contextId)) {
        addPart(() => appendEntityLink(row, 'subjects', lesson.subjectId, 'detail-link-subject'));
      }
      if (lesson.assignedTime) {
        const day = current.calendar.days[lesson.assignedTime.dayIndex]?.name || 'Giorno';
        const start = current.calendar.periods[lesson.assignedTime.periodIndex];
        const end = current.calendar.periods[lesson.assignedTime.periodIndex + lesson.durationPeriods - 1];
        const formatMinute = minute => Number.isFinite(minute)
          ? `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
          : '';
        addPart(() => {
          const button = element(document, 'button', { type: 'button', class: 'detail-link', title: 'Apri la lezione nell’elenco' }, `${day} ${formatMinute(start?.beginMinute)}–${formatMinute(end?.endMinute)}`);
          button.addEventListener('click', () => navigateToEntity('lessons', lesson.id));
          row.append(button);
        });
      } else addPart(() => row.append(document.createTextNode('Senza orario')));
      for (const [collection, ids] of [['classes', lesson.classIds || []], ['teachers', lesson.teacherIds || []], ['rooms', lesson.roomIds || []]]) {
        const remaining = ids.filter(id => !(contextCollection === collection && id === contextId));
        for (const id of remaining) addPart(() => appendEntityLink(row, collection, id));
      }
      list.append(row);
    }
    section.append(list);
    detailContent.append(section);
  }

  function addClassScheduleSection(classId) {
    const section = element(document, 'section', { class: 'entity-detail-section class-schedule-section' });
    const heading = element(document, 'h3'); heading.textContent = 'Orario della classe'; section.append(heading);
    const scroll = element(document, 'div', {
      class: 'calendar-scroll entity-detail-calendar-scroll',
      role: 'region',
      tabindex: '0',
      'aria-label': 'Griglia orario della classe, scorribile',
    });
    const matrix = element(document, 'div', { class: 'calendar-grid entity-detail-calendar-grid' });
    if (!views.renderMatrix('class', classId, matrix, { compact: true })) {
      const empty = element(document, 'p', { class: 'muted' }, 'Orario della classe non disponibile.');
      section.append(empty);
    } else {
      for (const card of matrix.querySelectorAll('.lesson-card[data-lesson-id]')) {
        card.draggable = false;
        card.addEventListener('click', () => {
          detailNavigationStack.push({ label: 'Orario della classe', state: captureDetailContext() });
          updateDetailBackButton();
          openEntityDetail({ type: 'lessons', id: card.dataset.lessonId, source: 'global-constraints' });
        });
      }
      scroll.append(matrix);
      section.append(scroll);
    }
    detailContent.append(section);
  }

  function detailContextLabel() {
    if (activeScreen !== 'schedule') return ({ teachers: 'Docenti', classes: 'Classi e materie', rooms: 'Aule', constraints: 'Vincoli' })[activeScreen];
    return 'Orario';
  }

  function captureDetailContext() {
    const panels = [...document.querySelectorAll(`[data-school-panel="${activeSchoolView}"]`)];
    const selectedRow = document.activeElement?.closest?.('tr');
    const filters = panels.flatMap(panel => [...panel.querySelectorAll('input[type="search"]')].map(input => ({ id: input.id, value: input.value })));
    const scrollPositions = panels.flatMap((panel, panelIndex) => [...panel.querySelectorAll('.sheet-scroll')]
      .map((node, index) => ({ panelIndex, index, top: node.scrollTop, left: node.scrollLeft })));
    return {
      screen: activeScreen,
      schoolView: activeSchoolView,
      viewState: views.getNavigationState(),
      detail: activeDetail ? structuredClone(activeDetail) : null,
      filters,
      scrollPositions,
      selectedRow: selectedRow ? { entityId: selectedRow.dataset.entityId, lessonId: selectedRow.dataset.lessonId } : null,
      issueFilters: ['issue-severity', 'issue-category', 'issue-search'].map(id => ({ id, value: document.getElementById(id)?.value || '' })),
      selectedIssueLesson: document.activeElement?.closest?.('[data-lesson-id]')?.dataset.lessonId || null,
      pageY: document.defaultView?.scrollY || 0,
    };
  }

  function restoreDetailContext(context) {
    if (!context) return;
    showScreen(context.screen === 'school' ? context.schoolView : context.screen);
    if (context.screen === 'schedule') views.restoreNavigationState(context.viewState);
    const panels = [...document.querySelectorAll(`[data-school-panel="${context.schoolView}"]`)];
    for (const item of context.filters || []) {
      const input = document.getElementById(item.id);
      if (input && input.value !== item.value) {
        input.value = item.value;
        input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
      }
    }
    for (const item of context.issueFilters || []) {
      const input = document.getElementById(item.id);
      if (input && input.value !== item.value) {
        input.value = item.value;
        input.dispatchEvent(new document.defaultView.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
    }
    (context.scrollPositions || []).forEach(position => {
      const node = panels[position.panelIndex]?.querySelectorAll('.sheet-scroll')[position.index];
      if (node) { node.scrollTop = position.top; node.scrollLeft = position.left; }
    });
    activeDetail = context.detail;
    if (activeDetail) openEntityDetail(activeDetail);
    else showEmptyDetail();
    document.defaultView?.scrollTo?.({ top: context.pageY });
    if (context.selectedRow) {
      const row = panels.flatMap(panel => [...panel.querySelectorAll('tbody tr')]).find(item => item.dataset.entityId === context.selectedRow.entityId || item.dataset.lessonId === context.selectedRow.lessonId);
      navigatingToEntity = true;
      row?.focus?.({ preventScroll: true });
      navigatingToEntity = false;
    }
    if (context.selectedIssueLesson) {
      const item = [...document.querySelectorAll('#issues-list [data-lesson-id]')].find(node => node.dataset.lessonId === context.selectedIssueLesson);
      item?.focus?.({ preventScroll: true });
    }
  }

  function showEmptyDetail() {
    moveSuggestionGeneration++;
    activeDetail = null;
    detailTitle.textContent = 'Dettagli';
    detailContent.replaceChildren();
    const message = element(document, 'p', { class: 'muted' });
    message.textContent = 'Seleziona un elemento nell’elenco per vederne i dettagli.';
    detailContent.append(message);
    detailActions.replaceChildren();
    updateDetailBackButton();
  }

  function appendContextConstraints(collection, id, owner, selectedConstraint = null, { compactSelection = false } = {}) {
    const scope = ({ teachers: 'teacher', classes: 'class', rooms: 'room', lessons: 'lesson' })[collection];
    if (!scope || !owner) return;
    const frames = collection === 'lessons' ? owner.timeframes || {} : owner.constraints?.timeframes || {};
    const section = element(document, 'section', { class: 'entity-detail-section contextual-constraints' });
    const compact = Boolean(compactSelection && selectedConstraint);
    const heading = element(document, 'h3'); heading.textContent = compact ? 'Azioni sul vincolo' : 'Vincoli'; section.append(heading);
    const labels = { unavailable: 'Hard · Indisponibilità', undesired: 'Soft · Da evitare', desired: 'Soft · Preferita' };
    const makeOption = (value, text) => {
      const option = element(document, 'option', { value });
      option.textContent = text;
      return option;
    };
    const formatSlot = slot => {
      const match = /^(\d+)\.(\d+)$/.exec(String(slot || ''));
      const dayIndex = match ? Number(match[1]) : null;
      const periodIndex = match ? Number(match[2]) : null;
      const day = current.calendar.days.find(item => item.index === dayIndex)?.name || 'Giorno non specificato';
      const period = current.calendar.periods.find(item => item.index === periodIndex);
      const formatTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const time = period ? `${formatTime(period.beginMinute)}–${formatTime(period.endMinute)}` : 'Ora non specificata';
      return `${day} · ${time}`;
    };
    const list = element(document, 'ul', { class: 'context-constraint-list' });
    const selectedSlot = selectedConstraint && /^(\d+)\.(\d+)$/.exec(String(selectedConstraint.slot || ''));
    const selectedSlotValid = selectedSlot
      && current.calendar.days.some(day => day.index === Number(selectedSlot[1]))
      && current.calendar.periods.some(period => period.index === Number(selectedSlot[2]));
    const editState = { value: selectedSlotValid && !compact ? { ...selectedConstraint } : null };
    const kindSelect = element(document, 'select', { 'aria-label': 'Categoria del vincolo' });
    for (const [value, labelText] of Object.entries(labels)) kindSelect.append(makeOption(value, labelText));
    const daySelect = element(document, 'select', { 'aria-label': 'Giorno del vincolo' });
    for (const day of current.calendar.days) daySelect.append(makeOption(String(day.index), day.name));
    const periodSelect = element(document, 'select', { 'aria-label': 'Fascia oraria del vincolo' });
    for (const period of current.calendar.periods) {
      const formatTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      periodSelect.append(makeOption(String(period.index), `${formatTime(period.beginMinute)}–${formatTime(period.endMinute)}`));
    }
    const save = element(document, 'button', { type: 'button', class: 'secondary-button' });
    save.textContent = 'Salva vincolo';
    const status = element(document, 'p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
    const resetForm = () => {
      editState.value = null;
      kindSelect.disabled = false;
      save.textContent = 'Salva vincolo';
      form.hidden = true;
    };
    if (editState.value) {
      kindSelect.value = editState.value.kind;
      daySelect.value = String(Number(editState.value.slot.split('.')[0]));
      periodSelect.value = String(Number(editState.value.slot.split('.')[1]));
    }
    const applyConstraintSave = slot => {
      const previousDetail = activeDetail;
      try {
        if (editState.value && activeDetail?.type === 'constraint') {
          activeDetail = { type: 'constraint', constraint: { ...activeDetail.constraint, kind: kindSelect.value, slot } };
        }
        if (editState.value.kind !== kindSelect.value) {
          schoolWorkbench.updateConstraintGroup({
            records: [{ scope: collection, id, kind: editState.value.kind, slot: editState.value.slot }],
            kind: kindSelect.value,
            periodIndex: Number(slot.split('.')[1]),
            targetSlots: [slot],
          });
        } else schoolWorkbench.updateConstraint({ scope, id, kind: kindSelect.value, action: 'update', slot, from: editState.value.slot });
        resetForm();
      } catch (error) { activeDetail = previousDetail; status.textContent = error.message; }
    };
    const beginEdit = (kind, slot) => {
      editState.value = { kind, slot };
      kindSelect.value = kind; kindSelect.disabled = false;
      daySelect.value = String(Number(slot.split('.')[0])); periodSelect.value = String(Number(slot.split('.')[1]));
      save.textContent = 'Salva vincolo';
      form.hidden = false;
    };
    const appendActions = (kind, slot, parent) => {
      const edit = element(document, 'button', { type: 'button', class: 'detail-link' }, 'Modifica');
      edit.addEventListener('click', () => beginEdit(kind, slot));
      const remove = element(document, 'button', { type: 'button', class: 'detail-link' }, 'Elimina');
      remove.addEventListener('click', () => {
        requestConfirmation({
          title: 'Eliminare questo vincolo?',
          message: `Eliminare “${labels[kind]}” di ${formatSlot(slot)}?`,
          confirmLabel: 'Elimina vincolo',
          onConfirm: () => {
            try { schoolWorkbench.updateConstraint({ scope, id, kind, action: 'delete', slot }); }
            catch (error) { status.textContent = error.message; }
          },
        });
      });
      parent.append(edit, remove);
    };
    const actions = element(document, 'div', { class: 'constraint-detail-actions' });
    if (compact) {
      if (selectedSlotValid) appendActions(selectedConstraint.kind, selectedConstraint.slot, actions);
    } else for (const kind of ['unavailable', 'undesired', 'desired']) for (const slot of frames[kind] || []) {
      const slotMatch = /^(\d+)\.(\d+)$/.exec(String(slot || ''));
      const editableSlot = slotMatch && current.calendar.days.some(day => day.index === Number(slotMatch[1]))
        && current.calendar.periods.some(period => period.index === Number(slotMatch[2]));
      const row = element(document, 'li', { class: `constraint-category-${kind}` });
      const text = element(document, 'span');
      text.textContent = `${labels[kind]} · ${formatSlot(slot)}`;
      row.append(text);
      if (editableSlot) appendActions(kind, slot, row);
      list.append(row);
    }
    if (!compact && !list.children.length) list.append(element(document, 'li', { class: 'muted' }, 'Nessun vincolo associato.'));
    const form = element(document, 'div', { class: 'context-constraint-form' });
    const field = (labelText, control) => {
      const label = element(document, 'label', { class: 'context-constraint-field' });
      label.append(document.createTextNode(labelText), control);
      return label;
    };
    form.append(field('Tipo di vincolo', kindSelect), field('Giorno', daySelect), field('Fascia oraria', periodSelect), save, status);
    form.hidden = !editState.value;
    const saveConstraint = () => {
      if (!editState.value) return;
      const slot = `${daySelect.value}.${periodSelect.value}`;
      if (slot !== editState.value.slot || kindSelect.value !== editState.value.kind) {
        requestConfirmation({
          title: 'Confermare la modifica del vincolo?',
          message: `${kindSelect.value !== editState.value.kind ? `Cambiare in “${labels[kindSelect.value]}”` : 'Spostare il vincolo'} da ${formatSlot(editState.value.slot)} a ${formatSlot(slot)}?`,
          confirmLabel: 'Salva modifica',
          onConfirm: () => applyConstraintSave(slot),
        });
        return;
      }
      applyConstraintSave(slot);
    };
    save.addEventListener('click', saveConstraint);
    if (!['teacher', 'class'].includes(scope)) {
      section.append(element(document, 'p', { class: 'constraint-scope-note' }, 'Il solver corrente non verifica i vincoli di questo ambito.'));
    }
    section.append(compact ? actions : list, form);
    detailContent.append(section);
  }

  function updateDetailBackButton() {
    detailBackButton.hidden = detailNavigationStack.length === 0;
    detailBackButton.textContent = detailBackButton.hidden ? '' : `← Torna a ${detailNavigationStack.at(-1).label}`;
  }

  detailBackButton.addEventListener('click', () => {
    const context = detailNavigationStack.pop();
    if (!context) return;
    restoreDetailContext(context.state);
  });

  function navigateToEntity(collection, id) {
    const screenByCollection = { teachers: 'teachers', classes: 'classes', subjects: 'classes', students: 'classes', rooms: 'rooms' };
    if (collection === 'lessons') {
      detailNavigationStack.push({ label: detailContextLabel() || 'elenco', state: captureDetailContext() });
      showScreen('schedule');
      views.selectLesson(id, { navigate: true });
      return;
    }
    const screen = screenByCollection[collection];
    if (!screen) return;
    detailNavigationStack.push({ label: detailContextLabel() || 'elenco', state: captureDetailContext() });
    updateDetailBackButton();
    showScreen(screen);
    openEntityDetail({ type: collection, id });

    const table = document.querySelector(`#school-grid-${collection}`);
    if (!table) return;
    const globalFilter = document.querySelector(`#school-filter-${collection}`);
    if (globalFilter?.value) {
      globalFilter.value = '';
      globalFilter.dispatchEvent(new Event('input', { bubbles: true }));
    }
    for (const filter of table.querySelectorAll('[data-grid-column-filter]')) {
      if (!filter.value) continue;
      filter.value = '';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const row = [...table.querySelectorAll('tbody tr')].find(item => item.dataset.entityId === id || item.dataset.lessonId === id);
    if (!row) return;
    document.querySelector('.detail-target-row')?.classList.remove('detail-target-row');
    row.classList.add('detail-target-row');
    row.tabIndex = -1;
    navigatingToEntity = true;
    row.focus({ preventScroll: true });
    navigatingToEntity = false;
    row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  function appendLessonMoveSuggestions(lesson, generation) {
    const section = element(document, 'section', { class: 'entity-detail-section lesson-move-suggestions' });
    const heading = element(document, 'h3', {}, 'Spostamenti e scambi che migliorano la copertura');
    const status = element(document, 'p', { class: 'muted', role: 'status', 'aria-live': 'polite' }, 'Calcolo delle destinazioni…');
    status.dataset.state = 'loading';
    const list = element(document, 'ul', { class: 'lesson-move-suggestion-list' });
    section.append(heading, status, list);
    detailContent.append(section);

    const weights = readObjectiveWeights();
    if (!weights) {
      status.dataset.state = 'invalid-weights';
      status.textContent = 'Imposta pesi validi nel Calcolo per valutare la copertura.';
      return;
    }
    const maximum = objectiveUpperBound(current, weights);
    const slots = current.calendar.days.flatMap(day => current.calendar.periods.map(period => ({
      dayIndex: day.index,
      periodIndex: period.index,
    })));
    const proposals = [];
    const currentSlot = lesson.assignedTime && `${lesson.assignedTime.dayIndex}.${lesson.assignedTime.periodIndex}`;
    const candidates = slots
      .filter(slot => `${slot.dayIndex}.${slot.periodIndex}` !== currentSlot)
      .map(slot => ({ action: 'move', slot }));
    const visibleLessonIds = views.getVisibleLessonIds?.() || [];
    const visibleLessons = visibleLessonIds
      .filter(id => id !== lesson.id)
      .map(id => current.lessons.find(item => item.id === id))
      .filter(item => item?.assignedTime)
      .filter(item => `${item.assignedTime.dayIndex}.${item.assignedTime.periodIndex}` !== currentSlot);
    for (const target of visibleLessons) {
      candidates.push({ action: 'swap', slot: target.assignedTime, targetLesson: target });
    }
    let cursor = 0;
    const formatTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const formatSlot = time => {
      const day = current.calendar.days.find(item => item.index === time.dayIndex);
      const period = current.calendar.periods.find(item => item.index === time.periodIndex);
      return `${day?.name || 'Giorno non specificato'} ${period ? formatTime(period.beginMinute) : 'Ora non specificata'}`;
    };
    const processBatch = () => {
      if (generation !== moveSuggestionGeneration || !section.isConnected
        || activeDetail?.type !== 'lessons' || activeDetail.id !== lesson.id) return;
      const end = Math.min(cursor + 3, candidates.length);
      for (; cursor < end; cursor++) {
        const candidate = candidates[cursor];
        const preview = candidate.action === 'swap'
          ? editor.previewManualMove(lesson.id, null, candidate.targetLesson.id, weights)
          : editor.previewManualMove(lesson.id, candidate.slot, null, weights);
        if (!preview.valid || preview.softAfter >= preview.softBefore) continue;
        const before = qualityPercent(preview.softBefore, maximum);
        const after = qualityPercent(preview.softAfter, maximum);
        if (before == null || after == null || after <= before) continue;
        proposals.push({ ...candidate, before, after, improvement: after - before });
      }
      status.textContent = `Valutate ${cursor} di ${candidates.length} destinazioni…`;
      if (cursor < candidates.length) {
        document.defaultView.setTimeout(processBatch, 0);
        return;
      }

      proposals.sort((left, right) => right.improvement - left.improvement
        || left.slot.dayIndex - right.slot.dayIndex
        || left.slot.periodIndex - right.slot.periodIndex
        || left.action.localeCompare(right.action)
        || String(left.targetLesson?.id || '').localeCompare(String(right.targetLesson?.id || '')));
      list.replaceChildren();
      status.dataset.state = 'ready';
      if (!proposals.length) {
        status.textContent = 'Nessuno spostamento o scambio disponibile aumenta la copertura senza introdurre nuovi conflitti hard.';
        return;
      }
      status.textContent = `${proposals.length} ${proposals.length === 1 ? 'proposta' : 'proposte'} disponibili. Accetta una destinazione per applicarla.`;
      for (const proposal of proposals) {
        const row = element(document, 'li', { class: 'lesson-move-suggestion' });
        const copy = element(document, 'p', { class: 'lesson-move-suggestion-copy' });
        const from = lesson.assignedTime ? formatSlot(lesson.assignedTime) : 'Senza orario';
        const targetClass = (proposal.targetLesson?.classIds || [])
          .map(id => current.entities.classes.find(item => item.id === id)?.name)
          .filter(Boolean).join(', ');
        const targetLabel = proposal.targetLesson
          ? `${current.entities.subjects.find(item => item.id === proposal.targetLesson.subjectId)?.name || 'Lezione'}${targetClass ? ` · ${targetClass}` : ''} · ${formatSlot(proposal.slot)}`
          : formatSlot(proposal.slot);
        const movement = proposal.action === 'swap' ? `${from} ↔ ${targetLabel}` : `${from} → ${targetLabel}`;
        copy.textContent = `${movement} · Copertura ${percentFormat.format(proposal.before)}% → ${percentFormat.format(proposal.after)}% (+${percentFormat.format(proposal.improvement)} punti percentuali)`;
        const accept = element(document, 'button', { type: 'button', class: 'secondary-button lesson-move-accept' }, proposal.action === 'swap' ? 'Accetta e scambia' : 'Accetta e sposta');
        accept.addEventListener('click', () => {
          if (activeDetail?.type !== 'lessons' || activeDetail.id !== lesson.id) return;
          const latestWeights = readObjectiveWeights();
          const latestMaximum = latestWeights ? objectiveUpperBound(current, latestWeights) : 0;
          const latest = latestWeights && (proposal.action === 'swap'
            ? editor.previewManualMove(lesson.id, null, proposal.targetLesson.id, latestWeights)
            : editor.previewManualMove(lesson.id, proposal.slot, null, latestWeights));
          const latestBefore = latest?.valid ? qualityPercent(latest.softBefore, latestMaximum) : null;
          const latestAfter = latest?.valid ? qualityPercent(latest.softAfter, latestMaximum) : null;
          if (!latest?.valid || latestBefore == null || latestAfter == null || latestAfter <= latestBefore) {
            status.textContent = 'La proposta è cambiata con l’orario o i pesi attuali. Aggiorno le destinazioni…';
            openEntityDetail(activeDetail);
            return;
          }
          const result = proposal.action === 'swap'
            ? editor.swapLessons(lesson.id, proposal.targetLesson.id, latestWeights)
            : editor.moveLesson(lesson.id, proposal.slot, latestWeights);
          if (!result.valid) status.textContent = result.reason;
        });
        row.append(copy, accept);
        list.append(row);
      }
    };
    document.defaultView.setTimeout(processBatch, 0);
  }

  function openEntityDetail(detail) {
    const fromGlobalConstraintList = detail.source === 'global-constraints';
    let constraint = detail.type === 'constraint' ? detail.constraint : null;
    const constraintGroup = detail.type === 'constraint-group' ? detail.group : null;
    const collectionLabels = { teachers: 'Docente', classes: 'Classe', subjects: 'Materia', rooms: 'Aula', students: 'Studente', lessons: 'Lezione' };
    const collection = constraintGroup?.scope || (detail.type === 'constraint' ? constraint.scope : detail.type);
    const targetId = detail.id || constraint?.id || constraintGroup?.id;
    const entity = collection === 'lessons'
      ? current.lessons.find(item => item.id === targetId)
      : collection === 'students' ? current.entities.students?.find(item => item.id === targetId)
        : current.entities[collection]?.find(item => item.id === targetId);
    if (constraint) {
      const owner = collection === 'lessons' ? entity : current.entities[collection]?.find(item => item.id === targetId);
      const frames = owner?.constraints?.timeframes || owner?.timeframes;
      if (!owner || !frames?.[constraint.kind]?.includes(constraint.slot)) { showEmptyDetail(); return; }
      const name = collection === 'lessons' ? current.entities.subjects.find(item => item.id === owner.subjectId)?.name || 'Lezione' : owner.name;
      constraint = { ...constraint, name };
      detail = { type: 'constraint', constraint, ...(fromGlobalConstraintList ? { source: 'global-constraints' } : {}) };
    }
    if (constraintGroup) {
      const frames = collection === 'lessons' ? entity?.timeframes : entity?.constraints?.timeframes;
      const groupIsCurrent = entity && constraintGroup.records.length
        && constraintGroup.records.every(record => record.id === constraintGroup.id && record.scope === constraintGroup.scope && frames?.[record.kind]?.includes(record.slot));
      if (!groupIsCurrent) { showEmptyDetail(); return; }
    }
    if (!entity && !constraint) { showEmptyDetail(); return; }
    const detailGeneration = ++moveSuggestionGeneration;
    activeDetail = detail;
    const nameOf = (name, id) => current.entities[name]?.find(item => item.id === id)?.name || 'Non assegnato';
    const relatedLessons = constraint
      ? collection === 'lessons' ? current.lessons.filter(item => item.id === constraint.id)
        : collection === 'teachers' ? current.lessons.filter(item => item.teacherIds?.includes(constraint.id))
          : collection === 'classes' ? current.lessons.filter(item => item.classIds?.includes(constraint.id))
            : current.lessons.filter(item => item.roomIds?.includes(constraint.id))
      : collection === 'lessons' ? [entity]
        : collection === 'students' ? current.lessons.filter(item => item.classIds?.includes(entity.classId))
          : collection === 'subjects' ? current.lessons.filter(item => item.subjectId === entity.id)
            : collection === 'teachers' ? current.lessons.filter(item => item.teacherIds?.includes(entity.id))
              : collection === 'classes' ? current.lessons.filter(item => item.classIds?.includes(entity.id))
                : current.lessons.filter(item => item.roomIds?.includes(entity.id));
    const lessonIds = new Set(relatedLessons.map(item => item.id));
    const analysis = views.analysis;
    const relevantIssues = analysis.issues.filter(item => (item.lessonIds || []).some(id => lessonIds.has(id))
      && (!constraint && collection !== 'lessons' && collection !== 'subjects' && collection !== 'students'
        ? item.resourceId === entity.id
        : true));
    const label = collectionLabels[collection] || 'Vincolo';
    detailTitle.textContent = constraint ? `Vincolo · ${constraint.name}` : constraintGroup ? `Gruppo · ${label} · ${entity.name}` : collection === 'lessons' ? 'Dettaglio lezione' : `${label} · ${entity.name}`;
    detailContent.replaceChildren(); detailActions.replaceChildren(); detailPanel.hidden = false;
    appWorkspace.classList.add('has-detail-panel');
    updateDetailBackButton();
    if (constraint) {
      const kindLabels = { unavailable: 'Hard · Indisponibilità', undesired: 'Soft · Da evitare', desired: 'Soft · Preferita' };
      const [dayIndex, periodIndex] = constraint.slot.split('.').map(Number);
      const dayName = current.calendar.days.find(item => item.index === dayIndex)?.name || 'Giorno non specificato';
      const period = current.calendar.periods.find(item => item.index === periodIndex);
      const time = period ? `${String(Math.floor(period.beginMinute / 60)).padStart(2, '0')}:${String(period.beginMinute % 60).padStart(2, '0')}` : 'Ora non specificata';
      const slotIsSpecified = Number.isInteger(dayIndex) && Number.isInteger(periodIndex)
        && current.calendar.days.some(item => item.index === dayIndex)
        && current.calendar.periods.some(item => item.index === periodIndex);
      const status = evaluateConstraintStatus(current, { scope: collection, id: targetId, kind: constraint.kind, slot: constraint.slot });
      const statusLabels = { satisfied: 'Vincolo rispettato', unsatisfied: 'Vincolo non rispettato', pending: 'Da verificare', unverified: 'Esito non verificabile' };
      const outcome = status === 'unverified'
        ? slotIsSpecified ? 'Questo ambito non è verificato dal solver corrente.' : 'Giorno o ora non specificati.'
        : status === 'pending' ? 'Ci sono lezioni senza orario assegnato.'
          : status === 'unsatisfied'
            ? constraint.kind === 'desired' ? 'Nessuna lezione è assegnata a questa fascia preferita.'
              : constraint.kind === 'undesired' ? 'Una lezione occupa questa fascia da evitare.'
                : 'Una lezione occupa questa fascia indisponibile.'
            : constraint.kind === 'desired' ? 'Una lezione è assegnata in questa fascia preferita.'
              : 'Nessuna lezione occupa questa fascia.';
      addDetailSection('Esito', [`${kindLabels[constraint.kind] || constraint.kind} · ${dayName}, ${time}`, statusLabels[status], outcome]);
      if (fromGlobalConstraintList) appendContextConstraints(collection, targetId, entity, constraint, { compactSelection: true });
      else appendContextConstraints(collection, targetId, entity, constraint);
      if (fromGlobalConstraintList && collection === 'classes') addClassScheduleSection(targetId);
    } else if (constraintGroup) {
      const kindLabels = { unavailable: 'Hard · Indisponibilità', undesired: 'Soft · Da evitare', desired: 'Soft · Preferita' };
      const period = current.calendar.periods.find(item => item.index === constraintGroup.periodIndex);
      const formatTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const groupLabel = `${kindLabels[constraintGroup.kind] || constraintGroup.kind} · ${period ? formatTime(period.beginMinute) : 'Ora non specificata'}`;
      addDetailSection('Gruppo di vincoli', [`${groupLabel} · ${constraintGroup.records.length} occorrenze`]);
      if (fromGlobalConstraintList && collection === 'classes') addClassScheduleSection(targetId);

      const editable = constraintGroup.records.every(record => {
        const match = /^(\d+)\.(\d+)$/.exec(String(record.slot || ''));
        return match && current.calendar.days.some(day => day.index === Number(match[1])) && current.calendar.periods.some(item => item.index === Number(match[2]));
      }) && Boolean(period);
      if (editable) {
        const section = element(document, 'section', { class: 'entity-detail-section constraint-group-editor' });
        const heading = element(document, 'h3'); heading.textContent = 'Modifica il gruppo'; section.append(heading);
        const kindSelect = element(document, 'select', { 'aria-label': 'Categoria del gruppo' });
        for (const [value, text] of Object.entries(kindLabels)) {
          const option = element(document, 'option', { value }, text);
          kindSelect.append(option);
        }
        kindSelect.value = constraintGroup.kind;
        const periodSelect = element(document, 'select', { 'aria-label': 'Fascia oraria del gruppo' });
        for (const item of current.calendar.periods) {
          const option = element(document, 'option', { value: String(item.index) }, `${formatTime(item.beginMinute)}–${formatTime(item.endMinute)}`);
          periodSelect.append(option);
        }
        periodSelect.value = String(constraintGroup.periodIndex);
        const save = element(document, 'button', { type: 'button', class: 'secondary-button' }, 'Aggiorna tutte le occorrenze');
        const status = element(document, 'p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
        save.addEventListener('click', () => {
          const nextKind = kindSelect.value;
          const nextPeriodIndex = Number(periodSelect.value);
          const nextPeriod = current.calendar.periods.find(item => item.index === nextPeriodIndex);
          const nextRecords = constraintGroup.records.map(record => ({ ...record, kind: nextKind, slot: `${Number(record.slot.split('.')[0])}.${nextPeriodIndex}` }));
          const previousDetail = activeDetail;
          activeDetail = { type: 'constraint-group', group: { ...constraintGroup, kind: nextKind, periodIndex: nextPeriodIndex, period: nextPeriod, records: nextRecords } };
          try { schoolWorkbench.updateConstraintGroup({ records: constraintGroup.records, kind: nextKind, periodIndex: nextPeriodIndex }); }
          catch (error) { activeDetail = previousDetail; status.textContent = error.message; }
        });
        section.append(kindSelect, periodSelect, save, status);
        detailContent.append(section);
      } else {
        addDetailSection('Modifica il gruppo', ['Le occorrenze senza giorno o fascia restano visibili, ma non possono essere modificate insieme finché non hanno valori validi nel calendario.']);
      }
      if (!fromGlobalConstraintList && collection === 'lessons') appendContextConstraints(collection, targetId, entity);
      else if (!fromGlobalConstraintList && ['teachers', 'classes', 'rooms'].includes(collection)) appendContextConstraints(collection, targetId, entity);
      const removeGroup = element(document, 'button', { type: 'button', class: 'secondary-button danger-button constraint-group-delete' }, 'Elimina gruppo');
      const deleteStatus = element(document, 'p', { class: 'muted entity-action-status', role: 'status', 'aria-live': 'polite' });
      removeGroup.addEventListener('click', () => requestConfirmation({
        title: 'Eliminare il gruppo di vincoli?',
        message: `Eliminare tutte le ${constraintGroup.records.length} occorrenze di “${groupLabel}”?`,
        confirmLabel: 'Elimina gruppo',
        onConfirm: () => {
          try { schoolWorkbench.deleteConstraintGroup(constraintGroup.records); }
          catch (error) { deleteStatus.textContent = error.message; }
        },
      }));
      detailContent.append(removeGroup, deleteStatus);
    } else if (collection === 'lessons') {
      const lesson = entity;
      addLessonSection('Lezione', [lesson]);
      addDetailSection('Durata', [`${lesson.durationPeriods} ${lesson.durationPeriods === 1 ? 'ora' : 'ore'}`]);
      appendLessonMoveSuggestions(lesson, detailGeneration);
      if (!fromGlobalConstraintList) appendContextConstraints(collection, targetId, entity);
    } else {
      if (fromGlobalConstraintList && collection === 'classes') addClassScheduleSection(targetId);
      else {
        const entityLessons = collection === 'classes'
          ? relatedLessons
          : relatedLessons.filter(lesson => lesson.assignedTime);
        entityLessons.sort((left, right) => (left.assignedTime?.dayIndex ?? Number.MAX_SAFE_INTEGER) - (right.assignedTime?.dayIndex ?? Number.MAX_SAFE_INTEGER)
          || (left.assignedTime?.periodIndex ?? Number.MAX_SAFE_INTEGER) - (right.assignedTime?.periodIndex ?? Number.MAX_SAFE_INTEGER)
          || String(left.id).localeCompare(right.id, 'en', { numeric: true }));
        addLessonSection(collection === 'classes' ? 'Orario della classe' : 'Lezioni in orario', entityLessons, collection, entity?.id || constraint?.id);
      }
      if (!fromGlobalConstraintList && ['teachers', 'classes', 'rooms'].includes(collection)) appendContextConstraints(collection, targetId, entity);
    }

    if (relevantIssues.length && !(fromGlobalConstraintList && ['teachers', 'classes'].includes(collection))) {
      addDetailSection('Violazioni e avvisi', relevantIssues.map(issue => {
        const kind = issue.severity === 'error' ? 'Non rispettato' : 'Preferenza mancata';
        const resource = { teacher: 'docente', class: 'classe', room: 'aula', lesson: 'lezione' }[issue.resourceType] || 'risorsa';
        const description = issue.code === 'resource-collision' ? `conflitto di ${resource}: più lezioni contemporanee`
          : issue.code === 'unavailable-time' ? `${resource} non disponibile`
            : issue.code === 'soft-preference' ? `fascia da evitare per ${resource}`
              : issue.code === 'unassigned-lesson' ? 'lezione senza orario assegnato' : issue.message;
        const day = issue.dayIndex == null ? '' : ` · ${current.calendar.days[issue.dayIndex]?.name || ''}`;
        return `${kind}: ${description}${day}`;
      }));
    }

  }

  function renderDiagnostics(items) {
    diagnosticsList.replaceChildren();
    for (const item of items) {
      const row = element(document, 'li', { class: `diagnostic ${item.severity || 'info'}` });
      const title = element(document, 'strong');
      title.textContent = item.severity === 'error' ? 'Errore' : item.severity === 'warning' ? 'Avviso' : 'Informazione';
      row.append(title, document.createTextNode(diagnosticText(item)));
      diagnosticsList.append(row);
    }
  }

  function renderSummary(counts) {
    summary.replaceChildren();
    const labels = [
      ['Lezioni', counts.lessons], ['Assegnate', counts.assignedLessons], ['Senza orario', counts.unassignedLessons],
      ['Docenti', counts.teachers], ['Classi', counts.classes], ['Aule', counts.rooms], ['Materie', counts.subjects], ['Studenti', counts.students || 0],
    ];
    for (const [label, value] of labels) {
      const wrapper = element(document, 'div');
      const term = element(document, 'dt'), detail = element(document, 'dd');
      term.textContent = label;
      detail.textContent = numberFormat.format(value);
      wrapper.append(term, detail);
      summary.append(wrapper);
    }
    summary.hidden = false;
  }

  function showError(error) {
    pending = null;
    report.dataset.state = 'error';
    let userMessage = error.message || 'Il file non è stato importato.';
    if (error instanceof OFDImportError || error instanceof EDNImportError) {
      if (/Malformed OFD XML/i.test(userMessage)) userMessage = 'Il file XML non è valido o è incompleto. Verifica il file e riprova.';
      else if (/DTD|external entit/i.test(userMessage)) userMessage = 'Il file contiene una dichiarazione DTD non supportata.';
      else if (/version .*not verified/i.test(userMessage)) userMessage = 'Questa versione OFD non è ancora supportata.';
      else userMessage = 'Importazione non riuscita. Controlla i dettagli; l’orario corrente è rimasto invariato.';
    }
    report.replaceChildren(document.createTextNode(userMessage));
    importActions.hidden = true;
    summary.hidden = true;
    summary.replaceChildren();
    const items = (error instanceof OFDImportError || error instanceof EDNImportError) && error.diagnostics.length
      ? error.diagnostics
      : [{ severity: 'error', code: 'import-error', message: error.message || 'Controlla il file e riprova.' }];
    renderDiagnostics(items);
    applyButton.disabled = true;
    cancelButton.disabled = true;
  }

  async function stageWith(file, load) {
    if (!file) return false;
    const generation = stagingGeneration;
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    importActions.hidden = true;
    report.dataset.state = 'checking';
    report.textContent = `Controllo di ${file.name || 'file del progetto'}…`;
    summary.hidden = true;
    summary.replaceChildren();
    diagnosticsList.replaceChildren();
    try {
      if (typeof file.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const result = await load(file);
      if (generation !== stagingGeneration) return false;
      pending = result;
      renderSummary(result.summary);
      renderDiagnostics(result.diagnostics);
      report.dataset.state = result.diagnostics.some(item => item.severity === 'warning') ? 'warning' : 'ready';
      report.textContent = `${file.name || 'File del progetto'} verificato. Controlla il riepilogo e conferma il caricamento.`;
      applyButton.disabled = false;
      cancelButton.disabled = false;
      importActions.hidden = false;
      return true;
    } catch (error) {
      if (generation !== stagingGeneration) return false;
      showError(error);
      return false;
    }
  }

  function stageEDNFile(file) {
    return stageWith(file, async selected => {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
      return importTimetableEDN(source);
    });
  }

  async function stageExternalOFD(file) {
    const generation = stagingGeneration;
    pendingOFD = null;
    externalOFDApply.disabled = true;
    externalOFDStatus.textContent = `Controllo di ${file?.name || 'file'}…`;
    try {
      if (!/\.ofd$/i.test(file?.name || '')) throw new Error('Seleziona un file OFD.');
      if (typeof file.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const result = await importer(new Uint8Array(await file.arrayBuffer()));
      if (generation !== stagingGeneration) return false;
      const sections = [...document.querySelectorAll('[data-ofd-section]:checked')].map(input => input.dataset.ofdSection);
      if (!sections.length) throw new Error('Seleziona almeno una sezione da importare.');
      if (sections.includes('lessons')) {
        const documentId = result.timetable.source.documentId;
        const matchesSource = item => (documentId && item.source?.documentId === documentId) || (file.name && item.filename === file.name);
        const alreadyImported = (current.source.lessonImports || []).some(matchesSource)
          || (current.source.rosterImports || []).some(item => item.sections?.includes('lessons') && matchesSource(item));
        if (alreadyImported) throw new Error('Le lezioni di questo file OFD risultano già importate.');
        const missing = { teachers: new Set(), classes: new Set(), rooms: new Set() };
        const sourceNames = Object.fromEntries(['teachers', 'classes', 'rooms'].map(collection => [collection,
          new Map((result.timetable.entities[collection] || []).map(item => [item.id, item.name]))]));
        for (const lesson of result.timetable.lessons) for (const collection of Object.keys(missing)) {
          const field = collection === 'teachers' ? 'teacherIds' : collection === 'classes' ? 'classIds' : 'roomIds';
          for (const id of lesson[field] || []) {
            const name = sourceNames[collection].get(id);
            if (!name) continue;
            const exists = current.entities[collection].some(item => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
            const selected = sections.includes(collection);
            const included = selected && (result.timetable.entities[collection] || []).some(item => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
            if (!exists && !included) missing[collection].add(name);
          }
        }
        const missingLabels = Object.entries(missing).filter(([, values]) => values.size)
          .map(([collection, values]) => `${collection === 'teachers' ? 'docenti' : collection === 'classes' ? 'classi' : 'aule'}: ${[...values].slice(0, 3).join(', ')}`).join('; ');
        if (missingLabels) throw new Error(`Per importare le lezioni, seleziona anche le relative anagrafiche o importale prima (${missingLabels}).`);
      }
      pendingOFD = { result, sections, filename: file.name || '' };
      const counts = sections.map(section => {
        const count = section === 'lessons' ? result.timetable.lessons.length : result.timetable.entities[section]?.length || 0;
        const labels = {
          teachers: count === 1 ? 'docente' : 'docenti', rooms: count === 1 ? 'aula' : 'aule',
          subjects: count === 1 ? 'materia' : 'materie', classes: count === 1 ? 'classe' : 'classi',
          constraints: 'vincoli', lessons: count === 1 ? 'lezione' : 'lezioni',
        };
        return `${section === 'constraints' ? '' : `${count} `}${labels[section] || section}`;
      }).join(' · ');
      externalOFDStatus.textContent = `${file.name || 'File OFD'} verificato: ${counts}. Conferma per importare.`;
      externalOFDApply.disabled = false;
      return true;
    } catch (error) {
      if (generation !== stagingGeneration) return false;
      externalOFDStatus.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  function applyExternalOFD() {
    if (!pendingOFD) return false;
    try {
      const result = schoolWorkbench.importOFDSections(pendingOFD.result, pendingOFD.sections, {
        format: 'orario-facile-ofd-sections', filename: pendingOFD.filename,
        source: pendingOFD.result.timetable.source,
        diagnostics: pendingOFD.result.diagnostics.map(item => ({ severity: item.severity || 'info', code: item.code || '', message: item.message || '' })),
      });
      currentDiagnostics.push(...(result.lessonsDiagnostics || []));
      const imported = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
      externalOFDStatus.textContent = `${imported} elementi importati · ${result.constraintsImported} vincoli applicati${result.constraintsSkipped ? ` · ${result.constraintsSkipped} fasce non compatibili ignorate` : ''}.`;
      pendingOFD = null;
      externalOFDApply.disabled = true;
      externalOFDInput.value = '';
      updateCalculationReadiness();
      refreshViews(true);
      return true;
    } catch (error) {
      externalOFDStatus.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  async function stageExternalCSV(collection, file) {
    const generation = stagingGeneration;
    const status = document.querySelector(`[data-external-csv-status="${collection}"]`);
    const apply = document.querySelector(`[data-external-csv-apply="${collection}"]`);
    if (!status || !apply) return false;
    pendingExternalCSV.delete(collection);
    apply.disabled = true;
    status.textContent = `Controllo di ${file?.name || 'file'}…`;
    try {
      if (!/\.csv$/i.test(file?.name || '')) throw new Error('Seleziona un file CSV.');
      if (typeof file.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (generation !== stagingGeneration) return false;
      const parsed = collection === 'constraints'
        ? parseConstraintCSV(source, current)
        : parseRosterCSV(source, collection, current);
      const items = parsed.items;
      const sourceInfo = { format: `csv-${collection}`, filename: file.name || '', content: source };
      pendingExternalCSV.set(collection, { items, sourceInfo });
      apply.disabled = !items.length;
      status.textContent = `${items.length} ${collection === 'constraints' ? 'vincoli' : collection === 'subjects' ? 'materie' : collection} pronti. Conferma per importarli.`;
      return true;
    } catch (error) {
      if (generation !== stagingGeneration) return false;
      status.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  function applyExternalCSV(collection) {
    const staged = pendingExternalCSV.get(collection);
    if (!staged) return false;
    try {
      const result = collection === 'constraints'
        ? schoolWorkbench.applyConstraints(staged.items, staged.sourceInfo)
        : schoolWorkbench.importEntities(collection, staged.items, staged.sourceInfo);
      document.querySelector(`[data-external-csv-status="${collection}"]`).textContent = `${result.imported} ${collection === 'constraints' ? 'vincoli' : 'elementi'} importati.`;
      document.querySelector(`[data-external-csv-apply="${collection}"]`).disabled = true;
      document.querySelector(`[data-external-csv="${collection}"]`).value = '';
      pendingExternalCSV.delete(collection);
      updateCalculationReadiness();
      refreshViews(true);
      return true;
    } catch (error) {
      document.querySelector(`[data-external-csv-status="${collection}"]`).textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  async function stageRosterFile(collection, file) {
    const generation = stagingGeneration;
    const status = document.querySelector(`[data-roster-status="${collection}"]`);
    const apply = document.querySelector(`[data-roster-apply="${collection}"]`);
    if (!status || !apply || !['teachers', 'classes', 'rooms', 'students'].includes(collection)) return false;
    pendingRoster = null;
    for (const action of document.querySelectorAll('[data-roster-apply]')) action.disabled = true;
    status.textContent = `Controllo di ${file?.name || 'file'}…`;
    try {
      if (typeof file?.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let items, warning = '', sourceInfo, calendar = null;
      if (/\.ofd$/i.test(file.name || '')) {
        if (collection === 'students') throw new Error('Il file OFD non fornisce un’anagrafica studenti; scegli un CSV con nome e classe.');
        const result = await importer(bytes);
        const adoptCalendar = !current.lessons.length && !current.source?.calendarSourceId;
        const importCalendar = adoptCalendar ? result.timetable.calendar : current.calendar;
        if (adoptCalendar) calendar = structuredClone(result.timetable.calendar);
        items = structuredClone(result.timetable.entities[collection]);
        warning = result.diagnostics.filter(item => item.severity === 'warning' && rosterWarningCodes.has(item.code)).map(diagnosticText).join(' ');
        let outsideCalendar = 0;
        for (const item of items) {
          const frames = item.constraints?.timeframes;
          if (!frames) continue;
          for (const kind of ['unavailable', 'desired', 'undesired']) {
            const values = frames[kind] || [];
            const active = values.filter(slot => {
              const [day, period] = slot.split('.').map(Number);
              return day < importCalendar.days.length && period < importCalendar.periods.length;
            });
            const preserved = values.filter(slot => !active.includes(slot));
            if (preserved.length) {
              outsideCalendar += preserved.length;
              item.sourceData ||= {};
              item.sourceData.ofdTimeframes ||= {};
              item.sourceData.ofdTimeframes[kind] = preserved;
              frames[kind] = active;
            }
          }
        }
        if (outsideCalendar) warning += `${warning ? ' ' : ''}${outsideCalendar} vincoli temporali fuori dal calendario corrente sono conservati nei dati sorgente, ma non applicabili al calcolo.`;
        sourceInfo = {
          format: 'orario-facile-ofd-roster', filename: file.name || '', collection, source: result.timetable.source,
          diagnostics: result.diagnostics.map(item => ({ severity: item.severity || 'info', code: item.code || '', message: item.message || '' })),
        };
      } else {
        const csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        ({ items } = parseRosterCSV(csv, collection, current));
        sourceInfo = { format: 'csv-roster', filename: file.name || '', collection, content: csv };
      }
      if (generation !== stagingGeneration) return false;
      const existing = new Set(current.entities[collection].map(item => item.name.trim().toLocaleLowerCase()));
      const duplicates = items.filter(item => existing.has(item.name.trim().toLocaleLowerCase())).length;
      pendingRoster = { collection, items, sourceInfo, calendar };
      apply.disabled = items.length === 0;
      const labels = { teachers: 'docenti pronti', classes: 'classi pronte', rooms: 'aule pronte', students: 'studenti pronti' };
      status.textContent = `${items.length} ${labels[collection]}${duplicates ? `; ${duplicates} già presenti` : ''}.${warning ? ` ${warning}` : ''} Conferma per aggiungerli.`;
      return true;
    } catch (error) {
      if (generation !== stagingGeneration) return false;
      status.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  async function stageLessonsFile(file) {
    const generation = stagingGeneration;
    const status = document.querySelector('[data-lessons-status]');
    const apply = document.querySelector('[data-lessons-apply]');
    if (!status || !apply) return false;
    pendingLessons = null;
    apply.disabled = true;
    status.textContent = `Controllo di ${file?.name || 'file'}…`;
    try {
      if (!/\.ofd$/i.test(file?.name || '')) throw new Error('Seleziona un file OFD.');
      if (typeof file?.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const result = await importer(new Uint8Array(await file.arrayBuffer()));
      if (generation !== stagingGeneration) return false;
      const documentId = result.timetable.source.documentId;
      const alreadyImported = (current.source.lessonImports || []).some(item =>
        (documentId && item.source?.documentId === documentId) || (file.name && item.filename === file.name));
      if (alreadyImported) throw new Error('Le lezioni di questo file OFD risultano già importate.');
      const sourceEntities = result.timetable.entities;
      const currentEntities = current.entities;
      const byName = collection => new Map(currentEntities[collection].map(item => [item.name.trim().toLocaleLowerCase(), item]));
      const sources = Object.fromEntries(['teachers', 'classes', 'rooms'].map(collection => [
        collection, new Map(sourceEntities[collection].map(item => [item.id, item.name])),
      ]));
      const targetNames = Object.fromEntries(['teachers', 'classes', 'rooms'].map(collection => [collection, byName(collection)]));
      const missing = { teachers: new Set(), classes: new Set(), rooms: new Set() };
      const lessons = result.timetable.lessons.map(lesson => {
        const mapped = { ...structuredClone(lesson), assignedTime: null };
        for (const collection of ['teachers', 'classes', 'rooms']) {
          const field = collection === 'teachers' ? 'teacherIds' : collection === 'classes' ? 'classIds' : 'roomIds';
          mapped[field] = lesson[field].flatMap(id => {
            const name = sources[collection].get(id);
            const target = targetNames[collection].get(String(name || '').trim().toLocaleLowerCase());
            if (!target) { if (name) missing[collection].add(name); return []; }
            return [target.id];
          });
        }
        return mapped;
      });
      const missingLabels = Object.entries(missing).filter(([, values]) => values.size)
        .map(([collection, values]) => `${collection === 'teachers' ? 'docenti' : collection === 'classes' ? 'classi' : 'aule'}: ${[...values].slice(0, 3).join(', ')}`).join('; ');
      if (missingLabels) throw new Error(`Importa prima dal foglio corrispondente gli elementi richiesti (${missingLabels}).`);

      const normalized = value => String(value || '').trim().toLocaleLowerCase();
      const adoptCalendar = !current.lessons.length && !current.source?.calendarSourceId;
      const importCalendar = adoptCalendar ? result.timetable.calendar : current.calendar;
      const sameCalendar = result.timetable.calendar.days.length === importCalendar.days.length
        && result.timetable.calendar.periods.length === importCalendar.periods.length
        && result.timetable.calendar.periods.every((period, index) => period.beginMinute === importCalendar.periods[index]?.beginMinute && period.endMinute === importCalendar.periods[index]?.endMinute);
      const existingSubjects = new Set(currentEntities.subjects.map(item => normalized(item.name)));
      const subjects = sourceEntities.subjects.map(item => structuredClone(item));
      let preservedTimeframes = 0;
      for (const lesson of lessons) {
        if (!sameCalendar) {
          const frames = lesson.timeframes;
          if (Object.values(frames || {}).some(values => values?.length)) {
            lesson.sourceData = { ...(lesson.sourceData || {}), ofdTimeframes: structuredClone(frames) };
            lesson.timeframes = { unavailable: [], desired: [], undesired: [] };
            preservedTimeframes++;
          }
        }
      }
      const unknownClassIds = new Set(sourceEntities.classes.filter(item => item.placeholder === 'unknown').map(item => item.id));
      const lessonsWithoutClass = lessons.filter(lesson => !lesson.classIds.length || lesson.classIds.some(id => unknownClassIds.has(id))).length;
      const sourceSubjectIds = new Set(sourceEntities.subjects.map(item => item.id));
      const unknownSubjectIds = new Set(sourceEntities.subjects.filter(item => item.placeholder === 'unknown').map(item => item.id));
      const lessonsWithoutSubject = lessons.filter(lesson => !lesson.subjectId || !sourceSubjectIds.has(lesson.subjectId) || unknownSubjectIds.has(lesson.subjectId)).length;
      const warnings = [
        lessonsWithoutClass && { severity: 'warning', code: 'lesson-without-class', message: `${lessonsWithoutClass} attività OFD usano la classe UNKNOWN; saranno escluse dal calcolo e conservate per la gestione separata.` },
        lessonsWithoutSubject && { severity: 'warning', code: 'lesson-without-subject', message: `${lessonsWithoutSubject} lezioni OFD non hanno una materia; useranno UNKNOWN e il calcolo potrà procedere.` },
        preservedTimeframes && { severity: 'warning', code: 'lesson-timeframes-preserved', message: `${preservedTimeframes} lezioni hanno vincoli temporali conservati nei dati sorgente perché il calendario è diverso.` },
      ].filter(Boolean);
      const warning = warnings.map(item => item.message).join(' ');
      pendingLessons = {
        lessons, subjects, warning, diagnostics: warnings,
        calendar: adoptCalendar ? structuredClone(result.timetable.calendar) : null,
        sourceInfo: {
          format: 'orario-facile-ofd-lessons', filename: file.name || '',
          source: result.timetable.source,
          diagnostics: [...result.diagnostics, ...warnings].map(item => ({ severity: item.severity || 'info', code: item.code || '', message: item.message || '' })),
        },
      };
      apply.disabled = lessons.length === 0;
      const lessonCount = `${lessons.length} ${lessons.length === 1 ? 'lezione pronta' : 'lezioni pronte'}`;
      const subjectCount = subjects.filter(item => !existingSubjects.has(normalized(item.name))).length;
      status.textContent = `${lessonCount}${subjectCount ? ` · ${subjectCount} ${subjectCount === 1 ? 'materia da aggiungere' : 'materie da aggiungere'}` : ''}.${warning ? ` ${warning}` : ''} Conferma per importarle senza assegnazione.`;
      return true;
    } catch (error) {
      if (generation !== stagingGeneration) return false;
      status.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  function applyLessonsImport() {
    if (!pendingLessons) return false;
    const staged = pendingLessons;
    currentDiagnostics.push(...staged.diagnostics);
    const { imported, subjects } = schoolWorkbench.importLessons(staged.lessons, staged.subjects, staged.sourceInfo, staged.calendar);
    document.querySelector('[data-lessons-status]').textContent = `${imported} lezioni importate${subjects ? ` · ${subjects} materie aggiunte` : ''}; collocazioni da ricalcolare.${staged.warning ? ` ${staged.warning}` : ''}`;
    pendingLessons = null;
    document.querySelector('[data-lessons-apply]').disabled = true;
    document.querySelector('#lesson-ofd-file').value = '';
    return true;
  }

  function applyRosterImport(collection) {
    if (!pendingRoster || pendingRoster.collection !== collection) return false;
    const { imported, duplicates } = schoolWorkbench.importEntities(collection, pendingRoster.items, pendingRoster.sourceInfo, pendingRoster.calendar);
    const status = document.querySelector(`[data-roster-status="${collection}"]`);
    status.textContent = `${imported} elementi importati${duplicates ? `; ${duplicates} duplicati già presenti` : ''}.`;
    pendingRoster = null;
    document.querySelector(`[data-roster-apply="${collection}"]`).disabled = true;
    document.querySelector(`#roster-file-${collection}`).value = '';
    return true;
  }

  function applyImport() {
    if (!pending) return false;
    const hasSchoolData = current.lessons.length || Object.values(current.entities).some(items => items.length);
    if (hasSchoolData && typeof confirm === 'function' && !confirm('Sostituire i dati della scuola attualmente aperta?')) return false;
    current = { ...pending.timetable, description: pending.timetable.description || '' };
    currentDiagnostics = [...pending.diagnostics];
    currentDiagnostics.push(...(current.source.lessonImports || []).flatMap(item => item.diagnostics || [])
      .filter(item => String(item.code || '').startsWith('lesson-')));
    schoolWorkbench.setTimetable(current);
    editor.setTimetable(current);
    updateCalculationReadiness();
    refreshViews();
    document.querySelector('#school-name').value = current.name;
    if (schoolDescription) schoolDescription.value = current.description;
    document.querySelector('#topbar-school-name').textContent = current.name;
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    importActions.hidden = true;
    const excluded = unknownCount(current, 'classes', 'classIds');
    const unassigned = current.lessons.filter(lesson => !lesson.assignedTime
      && !lesson.classIds?.some(id => current.entities.classes.find(item => item.id === id)?.placeholder === 'unknown')).length;
    currentStatus.textContent = `Caricato: ${current.name} · ${numberFormat.format(current.lessons.length)} attività · ${numberFormat.format(unassigned)} da assegnare · ${numberFormat.format(excluded)} escluse (classe UNKNOWN)`;
    markUnsavedChanges();
    appWorkspace.classList.add('has-timetable');
    exportButton.disabled = false;
    exportToolsButton.disabled = false;
    refreshPDFControls();
    report.dataset.state = 'ready';
    report.textContent = 'Orario caricato. I dati originali del file sono conservati nel modello.';
    showScreen(current.lessons.some(lesson => lesson.assignedTime) ? 'schedule' : 'teachers');
    return true;
  }

  function resetProject() {
    if (typeof confirm !== 'function' || !confirm('Cancellare tutti i dati della scuola e ripartire da zero? Questa operazione non è annullabile.')) return false;

    stagingGeneration++;
    pending = null;
    pendingRoster = null;
    pendingLessons = null;
    pendingOFD = null;
    pendingExternalCSV.clear();
    current = createEmptySchool();
    currentDiagnostics = [];
    activeDetail = null;
    detailNavigationStack = [];

    for (const input of document.querySelectorAll('input[type="file"]')) input.value = '';
    applyButton.disabled = true;
    cancelButton.disabled = true;
    summary.hidden = true;
    summary.replaceChildren();
    diagnosticsList.replaceChildren();
    report.dataset.state = 'ready';
    report.textContent = 'Progetto azzerato. Nessun dato importato è in attesa.';
    importActions.hidden = true;
    externalOFDApply.disabled = true;
    for (const button of document.querySelectorAll('[data-external-csv-apply], [data-roster-apply], [data-lessons-apply]')) button.disabled = true;
    for (const panel of document.querySelectorAll('[data-roster-panel], [data-lessons-panel]')) panel.hidden = true;
    for (const status of document.querySelectorAll('[data-roster-status], [data-external-csv-status], [data-lessons-status]')) status.textContent = 'Nessuna importazione in attesa.';
    externalOFDStatus.textContent = '';

    schoolWorkbench.setTimetable(current);
    editor.setTimetable(current);
    appWorkspace.classList.remove('has-timetable');
    document.querySelector('#topbar-school-name').textContent = current.name;
    document.querySelector('#school-name').value = current.name;
    if (schoolDescription) schoolDescription.value = current.description;
    currentStatus.textContent = 'Nuova scuola pronta';
    document.querySelector('#schedule-status').textContent = '';
    document.querySelector('#edit-status').textContent = 'Seleziona una lezione per esplorare alternative.';
    pdfPrintContent.replaceChildren();
    pdfPrintContent.hidden = true;
    showEmptyDetail();
    updateCalculationReadiness();
    refreshViews();
    refreshPDFControls();
    markUnsavedChanges();
    resetProjectStatus.textContent = 'Dati cancellati. Il progetto è pronto per ripartire da zero.';
    return true;
  }

  function cancelImport() {
    if (!pending) return false;
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    importActions.hidden = true;
    summary.hidden = true;
    summary.replaceChildren();
    diagnosticsList.replaceChildren();
    report.dataset.state = '';
    report.textContent = 'Importazione annullata; l’orario corrente è invariato.';
    return true;
  }

  function refreshPDFControls() {
    if (!pdfType || !pdfEntitySelect || !pdfEntityWrap) return;
    const type = pdfType.value;
    const selectedEntityId = pdfEntitySelect.value;
    const collection = { teacher: 'teachers', class: 'classes', room: 'rooms' }[type];
    pdfEntityWrap.hidden = !collection;
    pdfEntitySelect.replaceChildren();
    for (const entity of collection ? current.entities[collection] || [] : []) {
      pdfEntitySelect.append(element(document, 'option', { value: entity.id }, entity.name));
    }
    if ([...pdfEntitySelect.options].some(option => option.value === selectedEntityId)) pdfEntitySelect.value = selectedEntityId;
    pdfEntitySelect.disabled = Boolean(collection) && !pdfEntitySelect.options.length;
    if (printButton) printButton.disabled = !current.lessons.length || !collection || !pdfEntitySelect.value;
  }

  function renderPrintableTimetable() {
    const type = pdfType.value;
    const collection = { teacher: 'teachers', class: 'classes', room: 'rooms' }[type];
    const entity = current.entities[collection]?.find(item => item.id === pdfEntitySelect.value);
    if (!entity) return false;
    pdfPrintContent.replaceChildren();
    pdfPrintContent.hidden = false;
    const heading = element(document, 'h1', {}, current.name);
    const description = element(document, 'p', {}, `${{ teacher: 'Docente', class: 'Classe', room: 'Aula' }[type]} · ${entity.name}`);
    const matrix = element(document, 'div', { class: 'calendar-grid print-calendar-grid' });
    if (!views.renderMatrix(type, entity.id, matrix)) return false;
    pdfPrintContent.append(heading, description, matrix);
    document.defaultView?.print?.();
    return true;
  }

  function setExternalImportMode() {
    const format = document.querySelector('#external-import-format')?.value || 'ofd';
    document.querySelector('#external-ofd-panel').hidden = format !== 'ofd';
    document.querySelector('#external-csv-panel').hidden = format !== 'csv';
  }

  const ednInput = document.querySelector('#edn-file');
  const importEDNButton = document.querySelector('#import-edn-tools');
  const exportButton = document.querySelector('#export-edn-tools');
  const exportToolsButton = exportButton;
  if (!ednInput || !importEDNButton || !exportButton) throw new Error('EDN interchange controls are missing.');
  importEDNButton.addEventListener('click', () => ednInput.click());
  ednInput.addEventListener('change', () => {
    const file = ednInput.files?.[0];
    if (file) void stageEDNFile(file);
    ednInput.value = '';
  });
  applyButton.addEventListener('click', applyImport);
  cancelButton.addEventListener('click', cancelImport);
  resetProjectButton.addEventListener('click', resetProject);
  document.querySelector('#external-import-format').addEventListener('change', setExternalImportMode);
  setExternalImportMode();
  externalOFDInput.addEventListener('change', () => {
    const file = externalOFDInput.files?.[0];
    if (file) void stageExternalOFD(file).finally(() => { externalOFDInput.value = ''; });
  });
  externalOFDApply.addEventListener('click', applyExternalOFD);
  for (const input of document.querySelectorAll('[data-external-csv]')) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void stageExternalCSV(input.dataset.externalCsv, file).finally(() => { input.value = ''; });
    });
  }
  for (const apply of document.querySelectorAll('[data-external-csv-apply]')) {
    apply.addEventListener('click', () => applyExternalCSV(apply.dataset.externalCsvApply));
  }
  pdfType?.addEventListener('change', refreshPDFControls);
  pdfEntitySelect?.addEventListener('change', refreshPDFControls);
  printButton?.addEventListener('click', renderPrintableTimetable);
  document.defaultView?.addEventListener('afterprint', () => { pdfPrintContent.hidden = true; });
  refreshPDFControls();
  for (const collection of ['teachers', 'classes', 'rooms', 'students']) {
    const input = document.querySelector(`#roster-file-${collection}`);
    const open = document.querySelector(`[data-roster-open="${collection}"]`);
    const apply = document.querySelector(`[data-roster-apply="${collection}"]`);
    const cancel = document.querySelector(`[data-roster-cancel="${collection}"]`);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void stageRosterFile(collection, file).finally(() => { input.value = ''; });
    });
    open.addEventListener('click', () => {
      const panel = document.querySelector(`[data-roster-panel="${collection}"]`);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) input.focus();
    });
    apply.addEventListener('click', () => applyRosterImport(collection));
    cancel.addEventListener('click', () => {
      pendingRoster = null; input.value = ''; apply.disabled = true;
      document.querySelector(`[data-roster-status="${collection}"]`).textContent = 'Importazione annullata; la scuola è rimasta invariata.';
    });
  }
  const lessonInput = document.querySelector('#lesson-ofd-file');
  const lessonOpen = document.querySelector('[data-lessons-open]');
  const lessonPanel = document.querySelector('[data-lessons-panel]');
  const lessonApply = document.querySelector('[data-lessons-apply]');
  lessonOpen.addEventListener('click', () => {
    lessonPanel.hidden = !lessonPanel.hidden;
    if (!lessonPanel.hidden) lessonInput.focus();
  });
  lessonInput.addEventListener('change', () => {
    const file = lessonInput.files?.[0];
    if (file) void stageLessonsFile(file).finally(() => { lessonInput.value = ''; });
  });
  lessonApply.addEventListener('click', applyLessonsImport);
  document.querySelector('[data-lessons-cancel]').addEventListener('click', () => {
    pendingLessons = null; lessonInput.value = ''; lessonApply.disabled = true;
    document.querySelector('[data-lessons-status]').textContent = 'Importazione annullata; la scuola è rimasta invariata.';
  });
  currentStatus.textContent = 'Nuova scuola pronta';
  exportButton.addEventListener('click', handleExportEDN);

  function handleExportEDN() {
    try {
      if (exportEDN()) {
        markChangesExported();
        report.dataset.state = 'ready';
        report.textContent = 'Progetto esportato.';
      }
    } catch (error) {
      showError(error);
    }
  }

  function exportEDN() {
    if (!current) return null;
    const source = exportTimetableEDN(current);
    const view = document.defaultView;
    if (view?.URL?.createObjectURL) {
      const url = view.URL.createObjectURL(new view.Blob([source], { type: 'application/edn;charset=utf-8' }));
      const anchor = element(document, 'a', { href: url, download: `${String(current.name || 'orario').replace(/[\\/:*?"<>|]/g, '_')}.edn` });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
    }
    return source;
  }

  const ready = persistence.load().then(saved => {
    if (!saved || hasEditedDuringLoad) return current;
    const validation = validateTimetable(saved);
    if (validation.errors.length) {
      if (saveStateBadge) saveStateBadge.textContent = 'Archivio locale non valido';
      return current;
    }
    current = { ...saved, description: saved.description || '' };
    current.entities.students ||= [];
    currentDiagnostics = (current.source.lessonImports || []).flatMap(item => item.diagnostics || []);
    schoolWorkbench.setTimetable(current);
    editor.setTimetable(current);
    views.render(current, currentDiagnostics);
    updateConstraintCoverage();
    document.querySelector('#school-name').value = current.name;
    if (schoolDescription) schoolDescription.value = current.description;
    document.querySelector('#topbar-school-name').textContent = current.name;
    exportButton.disabled = false;
    showScreen(current.lessons.some(lesson => lesson.assignedTime) ? 'schedule' : 'teachers');
    updateCalculationReadiness();
    refreshPDFControls();
    if (saveStateBadge) saveStateBadge.textContent = 'Salvato';
    return current;
  }).catch(() => {
    if (saveStateBadge) saveStateBadge.textContent = 'Archivio locale non disponibile';
    return current;
  });

  return {
    stageRosterFile,
    stageLessonsFile,
    stageEDNFile,
    stageExternalOFD,
    applyExternalOFD,
    stageExternalCSV,
    applyExternalCSV,
    applyImport,
    resetProject,
    cancelImport,
    exportEDN,
    views,
    editor,
    get timetable() { return current; },
    get diagnostics() { return currentDiagnostics; },
    get pendingTimetable() { return pending?.timetable || null; },
    get pendingRoster() { return pendingRoster; },
    get pendingLessons() { return pendingLessons; },
    applyLessonsImport,
    applyRosterImport,
    get activeScreen() { return activeScreen; },
    showScreen,
    schoolWorkbench,
    ready,
  };
}
