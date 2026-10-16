import { importOFD, OFDImportError } from './ofd-importer.js';
import { importTimetableEDN, exportTimetableEDN, EDNImportError } from './edn-importer.js';
import { createTimetableViews } from './views.js';
import { createTimetableEditor } from './editor.js';
import { createEmptySchool, createSchoolWorkbench } from './school-workbench.js';
import { parseRosterCSV } from './roster-importer.js';
import { getCalculationReadiness, validateTimetable } from './validation.js';

const numberFormat = new Intl.NumberFormat('it-IT');
const rosterWarningCodes = new Set(['encoding-mismatch', 'period-name-mismatch', 'unsupported-structure', 'unsupported-attribute']);

function element(document, tag, attributes = {}) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function diagnosticText(item) {
  if (item.code === 'encoding-mismatch') return `La codifica dichiarata (${item.declaredEncoding || ''}) non corrisponde ai byte del file; è stata usata ${item.decodedEncoding || 'una codifica compatibile'}.`;
  if (item.code === 'period-name-mismatch') return 'Il nome del documento e quello dei dati non coincidono; entrambi sono conservati.';
  if (item.code === 'unassigned-lessons') return `${numberFormat.format(item.details?.count ?? 0)} lezioni senza orario assegnato nel file.`;
  if (item.code === 'assignments-omitted') return `${numberFormat.format(item.details?.count ?? 0)} collocazioni OFD omesse; docenti, classi e vincoli sono conservati. Gli orari originali restano disponibili solo come preferenze iniziali del ricalcolo.`;
  if (item.code === 'unsupported-structure') return `Elemento OFD non riconosciuto ${item.path || ''}: resta conservato nel sorgente.`;
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
export function createTimetableApp({ document = globalThis.document, DOMParser = document?.defaultView?.DOMParser, confirm = document?.defaultView?.confirm?.bind(document.defaultView), importer = source => importOFD(source, { DOMParser }) } = {}) {
  if (!document) throw new TypeError('A document is required to mount the timetable import screen.');
  const report = document.querySelector('#import-report');
  const summary = document.querySelector('#import-summary');
  const diagnosticsList = document.querySelector('#import-diagnostics');
  const applyButton = document.querySelector('#apply-import');
  const cancelButton = document.querySelector('#cancel-import');
  const currentStatus = document.querySelector('#current-status');
  const importCard = document.querySelector('#import-card');
  const appWorkspace = document.querySelector('.workspace');
  if (![report, summary, diagnosticsList, applyButton, cancelButton, currentStatus, importCard, appWorkspace].every(Boolean)) {
    throw new Error('Timetable import screen is missing a required accessible control.');
  }

  let current = createEmptySchool();
  let currentDiagnostics = [];
  let pending = null;
  let pendingRoster = null;
  let pendingLessons = null;
  let views;
  let editor;
  let activeScreen = 'school';
  let activeSchoolView = 'teachers';
  const schoolWorkbench = createSchoolWorkbench({
    document,
    onChange: next => {
      current = next;
      const activeLessonWarnings = (next.source.lessonImports || []).flatMap(item => item.diagnostics || [])
        .filter(item => String(item.code || '').startsWith('lesson-'));
      const currentLessonWarnings = getCalculationReadiness(next).includes('lesson-details')
        ? activeLessonWarnings
        : activeLessonWarnings.filter(item => item.code !== 'lesson-without-class');
      currentDiagnostics = [...currentDiagnostics.filter(item => !String(item.code || '').startsWith('lesson-')), ...currentLessonWarnings];
      editor?.setTimetable(current);
      if (views) refreshViews(true);
      updateCalculationReadiness();
      document.querySelector('#topbar-school-name').textContent = current.name;
      document.querySelector('#school-name').value = current.name;
      currentStatus.textContent = 'Modifiche alla scuola · Esporta EDN per salvarle';
      exportButton.disabled = false;
      exportToolsButton.disabled = false;
    },
  });
  editor = createTimetableEditor({
    document,
    getTimetable: () => current,
    confirm,
    onApply: (next, _lessonId, action) => {
      current = next;
      schoolWorkbench.setTimetable(current);
      const stateLabel = action === 'undo' ? 'Modifica annullata' : 'Modifiche applicate';
      currentStatus.textContent = `${stateLabel} · Esporta EDN per salvarle`;
      refreshViews(true);
    },
  });
  views = createTimetableViews({ document, onLessonSelect: lesson => editor.selectLesson(lesson.id) });
  schoolWorkbench.setTimetable(current);
  editor.setTimetable(current);
  views.render(current, currentDiagnostics);

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
        ready.textContent = 'Il motore calcola le assegnazioni: non serve inserire giorno e ora a mano.';
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
    const schoolViews = ['teachers', 'classes', 'students', 'lessons', 'rooms', 'constraints'];
    if (schoolViews.includes(screen)) {
      activeSchoolView = screen;
      screen = 'school';
    }
    activeScreen = screen;
    if (screen === 'schedule' && views.screen !== 'schedule') views.showSchedule();
    if (screen !== 'school') {
      importCard.hidden = true;
      importToolsButton?.setAttribute('aria-expanded', 'false');
    }
    document.querySelector('#school-page').hidden = screen !== 'school';
    document.querySelector('#calculation-page').hidden = screen !== 'calculation';
    document.querySelector('#timetable-workspace').hidden = screen !== 'schedule';
    document.querySelector('.current-card').hidden = screen !== 'schedule' || !current.lessons.length;
    document.querySelector('#issues-page').hidden = true;
    document.querySelector('#structure-page').hidden = true;
    for (const panel of document.querySelectorAll('[data-school-panel]')) panel.hidden = panel.dataset.schoolPanel !== activeSchoolView;
    document.querySelector('#school-view-label').textContent = ({ teachers: 'Docenti', classes: 'Classi', students: 'Studenti', lessons: 'Lezioni', rooms: 'Aule', constraints: 'Vincoli' })[activeSchoolView] || 'Docenti';
    for (const button of document.querySelectorAll('[data-screen]')) {
      const active = button.dataset.screen === screen || (screen === 'school' && button.dataset.screen === activeSchoolView);
      button.setAttribute('aria-pressed', String(active));
    }
    document.documentElement.dataset.screen = screen;
    if (screen === 'calculation') document.querySelector('#recalculate-all').focus();
    if (screen === 'schedule') document.querySelector('#timetable-heading').setAttribute('tabindex', '-1');
  }
  function refreshViews(preserveContext = false) {
    views.render(current, currentDiagnostics, { preserveContext });
    if (activeScreen !== 'schedule') document.querySelector('#timetable-workspace').hidden = true;
  }
  for (const button of document.querySelectorAll('[data-screen]')) button.addEventListener('click', () => showScreen(button.dataset.screen));
  document.querySelector('#go-to-schedule')?.addEventListener('click', () => showScreen('schedule'));
  const importToolsButton = document.querySelector('#show-import-tools');
  importToolsButton?.addEventListener('click', () => {
    showScreen('school');
    importCard.hidden = !importCard.hidden;
    importToolsButton.setAttribute('aria-expanded', String(!importCard.hidden));
    if (!importCard.hidden) ednInput.focus();
  });
  document.querySelector('#school-name').addEventListener('change', event => {
    const name = event.currentTarget.value.trim();
    if (!name) { event.currentTarget.value = current.name; return; }
    schoolWorkbench.setName(name);
    document.querySelector('#topbar-school-name').textContent = name;
    document.querySelector('#school-heading').dataset.name = name;
    currentStatus.textContent = `Scuola: ${name} · Esporta EDN per salvarla`;
    exportButton.disabled = false;
    exportToolsButton.disabled = false;
    refreshViews(true);
  });
  showScreen('school');
  updateCalculationReadiness();

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
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    report.dataset.state = 'checking';
    report.textContent = `Controllo di ${file.name || 'file EDN'}…`;
    summary.hidden = true;
    summary.replaceChildren();
    diagnosticsList.replaceChildren();
    try {
      if (typeof file.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const result = await load(file);
      pending = result;
      renderSummary(result.summary);
      renderDiagnostics(result.diagnostics);
      report.dataset.state = result.diagnostics.some(item => item.severity === 'warning') ? 'warning' : 'ready';
      report.textContent = `${file.name || 'File EDN'} verificato. Controlla il riepilogo e conferma il caricamento.`;
      applyButton.disabled = false;
      cancelButton.disabled = false;
      return true;
    } catch (error) {
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

  async function stageRosterFile(collection, file) {
    const status = document.querySelector(`[data-roster-status="${collection}"]`);
    const apply = document.querySelector(`[data-roster-apply="${collection}"]`);
    if (!status || !apply || !['teachers', 'classes', 'rooms', 'students'].includes(collection)) return false;
    pendingRoster = null;
    for (const action of document.querySelectorAll('[data-roster-apply]')) action.disabled = true;
    status.textContent = `Controllo di ${file?.name || 'file'}…`;
    try {
      if (typeof file?.arrayBuffer !== 'function') throw new Error('Il browser non può leggere il file selezionato.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let items, warning = '', sourceInfo;
      if (/\.ofd$/i.test(file.name || '')) {
        if (collection === 'students') throw new Error('Il file OFD non fornisce un’anagrafica studenti; scegli un CSV con nome e classe.');
        const result = await importer(bytes);
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
              return day < current.calendar.days.length && period < current.calendar.periods.length;
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
      const existing = new Set(current.entities[collection].map(item => item.name.trim().toLocaleLowerCase()));
      const duplicates = items.filter(item => existing.has(item.name.trim().toLocaleLowerCase())).length;
      pendingRoster = { collection, items, sourceInfo };
      apply.disabled = items.length === 0;
      const labels = { teachers: 'docenti pronti', classes: 'classi pronte', rooms: 'aule pronte', students: 'studenti pronti' };
      status.textContent = `${items.length} ${labels[collection]}${duplicates ? `; ${duplicates} già presenti` : ''}.${warning ? ` ${warning}` : ''} Conferma per aggiungerli.`;
      return true;
    } catch (error) {
      status.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  async function stageLessonsFile(file) {
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
        const mapped = { ...structuredClone(lesson), assignedTime: null, sourceAssignment: lesson.assignedTime };
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
      const sameCalendar = result.timetable.calendar.days.length === current.calendar.days.length
        && result.timetable.calendar.periods.length === current.calendar.periods.length
        && result.timetable.calendar.periods.every((period, index) => period.beginMinute === current.calendar.periods[index]?.beginMinute && period.endMinute === current.calendar.periods[index]?.endMinute);
      const existingSubjects = new Set(currentEntities.subjects.map(item => normalized(item.name)));
      const subjects = sourceEntities.subjects.map(item => structuredClone(item));
      let omittedHints = 0, preservedTimeframes = 0;
      for (const lesson of lessons) {
        if (!sameCalendar) {
          if (lesson.sourceAssignment) omittedHints++;
          const frames = lesson.timeframes;
          if (Object.values(frames || {}).some(values => values?.length)) {
            lesson.sourceData = { ...(lesson.sourceData || {}), ofdTimeframes: structuredClone(frames) };
            lesson.timeframes = { unavailable: [], desired: [], undesired: [] };
            preservedTimeframes++;
          }
          lesson.sourceAssignment = null;
        }
      }
      const lessonsWithoutClass = lessons.filter(lesson => !lesson.classIds.length).length;
      const warnings = [
        lessonsWithoutClass && { severity: 'warning', code: 'lesson-without-class', message: `${lessonsWithoutClass} lezioni OFD non hanno una classe; saranno conservate, ma il calcolo richiede di completare il riferimento.` },
        omittedHints && { severity: 'warning', code: 'lesson-calendar-mismatch', message: `${omittedHints} orari originali non sono stati usati come suggerimenti perché il calendario è diverso.` },
        preservedTimeframes && { severity: 'warning', code: 'lesson-timeframes-preserved', message: `${preservedTimeframes} lezioni hanno vincoli temporali conservati nei dati sorgente perché il calendario è diverso.` },
      ].filter(Boolean);
      const warning = warnings.map(item => item.message).join(' ');
      pendingLessons = {
        lessons, subjects, warning, diagnostics: warnings, sourceInfo: {
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
      status.textContent = `Importazione non riuscita: ${error.message} La scuola è rimasta invariata.`;
      return false;
    }
  }

  function applyLessonsImport() {
    if (!pendingLessons) return false;
    const staged = pendingLessons;
    currentDiagnostics.push(...staged.diagnostics);
    const { imported, subjects } = schoolWorkbench.importLessons(staged.lessons, staged.subjects, staged.sourceInfo);
    document.querySelector('[data-lessons-status]').textContent = `${imported} lezioni importate${subjects ? ` · ${subjects} materie aggiunte` : ''}; collocazioni da ricalcolare.${staged.warning ? ` ${staged.warning}` : ''}`;
    pendingLessons = null;
    document.querySelector('[data-lessons-apply]').disabled = true;
    document.querySelector('#lesson-ofd-file').value = '';
    return true;
  }

  function applyRosterImport(collection) {
    if (!pendingRoster || pendingRoster.collection !== collection) return false;
    const { imported, duplicates } = schoolWorkbench.importEntities(collection, pendingRoster.items, pendingRoster.sourceInfo);
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
    current = pending.timetable;
    currentDiagnostics = [...pending.diagnostics];
    currentDiagnostics.push(...(current.source.lessonImports || []).flatMap(item => item.diagnostics || [])
      .filter(item => String(item.code || '').startsWith('lesson-')));
    schoolWorkbench.setTimetable(current);
    editor.setTimetable(current);
    updateCalculationReadiness();
    refreshViews();
    document.querySelector('#school-name').value = current.name;
    document.querySelector('#topbar-school-name').textContent = current.name;
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    const unassigned = current.lessons.filter(lesson => !lesson.assignedTime).length;
    currentStatus.textContent = `Caricato: ${current.name} · ${numberFormat.format(current.lessons.length)} lezioni · ${numberFormat.format(unassigned)} da assegnare`;
    document.querySelector('.current-card').hidden = false;
    importCard.hidden = true;
    appWorkspace.classList.add('has-timetable');
    exportButton.disabled = false;
    exportToolsButton.disabled = false;
    report.dataset.state = 'ready';
    report.textContent = 'Orario caricato. I dati originali del file sono conservati nel modello.';
    showScreen(current.lessons.some(lesson => lesson.assignedTime) ? 'schedule' : 'school');
    return true;
  }

  function cancelImport() {
    if (!pending) return false;
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    summary.hidden = true;
    summary.replaceChildren();
    diagnosticsList.replaceChildren();
    report.dataset.state = '';
    report.textContent = 'Importazione annullata; l’orario corrente è invariato.';
    return true;
  }

  const ednInput = document.querySelector('#edn-file');
  const exportButton = document.querySelector('#export-edn');
  const exportToolsButton = document.querySelector('#export-edn-tools');
  if (!ednInput || !exportButton || !exportToolsButton) throw new Error('EDN interchange controls are missing.');
  ednInput.addEventListener('change', () => {
    const file = ednInput.files?.[0];
    if (file) void stageEDNFile(file);
    ednInput.value = '';
  });
  applyButton.addEventListener('click', applyImport);
  cancelButton.addEventListener('click', cancelImport);
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
  currentStatus.textContent = 'Nuova scuola pronta · aggiungi classi, docenti e lezioni';
  exportButton.addEventListener('click', () => {
    handleExportEDN();
  });
  exportToolsButton.addEventListener('click', () => { handleExportEDN(); });

  function handleExportEDN() {
    try {
      if (exportEDN()) {
        report.dataset.state = 'ready';
        report.textContent = 'Dati esportati in formato EDN.';
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

  return {
    stageRosterFile,
    stageLessonsFile,
    stageEDNFile,
    applyImport,
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
  };
}
