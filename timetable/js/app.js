import { importOFD, withoutOFDAssignments, OFDImportError } from './ofd-importer.js';
import { importTimetableEDN, exportTimetableEDN, EDNImportError } from './edn-importer.js';
import { createTimetableViews } from './views.js';
import { createTimetableEditor } from './editor.js';
import { createBlankTimetableBuilder } from './blank-builder.js';

const numberFormat = new Intl.NumberFormat('it-IT');

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
  const input = document.querySelector('#ofd-file');
  const omitAssignments = document.querySelector('#ofd-without-assignments');
  const report = document.querySelector('#import-report');
  const summary = document.querySelector('#import-summary');
  const diagnosticsList = document.querySelector('#import-diagnostics');
  const applyButton = document.querySelector('#apply-import');
  const cancelButton = document.querySelector('#cancel-import');
  const currentStatus = document.querySelector('#current-status');
  const importCard = document.querySelector('#import-card');
  const changeButton = document.querySelector('#change-timetable');
  const appWorkspace = document.querySelector('.workspace');
  if (![input, omitAssignments, report, summary, diagnosticsList, applyButton, cancelButton, currentStatus, importCard, changeButton, appWorkspace].every(Boolean)) {
    throw new Error('Timetable import screen is missing a required accessible control.');
  }

  let current = null;
  let currentDiagnostics = [];
  let pending = null;
  let views;
  const blankBuilder = createBlankTimetableBuilder({
    document,
    onCreate: timetable => {
      pending = {
        timetable,
        diagnostics: [],
        summary: {
          teachers: timetable.entities.teachers.length,
          classes: timetable.entities.classes.length,
          rooms: timetable.entities.rooms.length,
          subjects: timetable.entities.subjects.length,
          lessons: timetable.lessons.length,
          assignedLessons: 0,
          unassignedLessons: timetable.lessons.length,
        },
      };
      return applyImport();
    },
  });
  const editor = createTimetableEditor({
    document,
    getTimetable: () => current,
    onApply: (next, lessonId, action) => {
      current = next;
      const stateLabel = action === 'undo' ? 'Modifica annullata' : 'Modifiche applicate';
      currentStatus.textContent = `${stateLabel} · Esporta EDN per salvarle`;
      views.render(current, currentDiagnostics, { preserveContext: true });
      if (lessonId) views.selectLesson(lessonId, { navigate: true, notify: false });
    },
  });
  views = createTimetableViews({ document, onLessonSelect: lesson => editor.selectLesson(lesson.id) });

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
      ['Docenti', counts.teachers], ['Classi', counts.classes], ['Aule', counts.rooms], ['Materie', counts.subjects],
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
    report.textContent = `Controllo di ${file.name || 'file OFD'}…`;
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
      report.textContent = `${file.name || 'File OFD'} verificato. Controlla il riepilogo e conferma il caricamento.`;
      applyButton.disabled = false;
      cancelButton.disabled = false;
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }

  function stageFile(file) {
    return stageWith(file, async selected => {
      const result = await importer(new Uint8Array(await selected.arrayBuffer()));
      return omitAssignments.checked ? withoutOFDAssignments(result) : result;
    });
  }

  function stageEDNFile(file) {
    return stageWith(file, async selected => {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
      return importTimetableEDN(source);
    });
  }

  function applyImport() {
    if (!pending) return false;
    if (current && typeof confirm === 'function' && !confirm('Sostituire l’orario attualmente caricato con quello verificato?')) return false;
    current = pending.timetable;
    currentDiagnostics = [...pending.diagnostics];
    editor.setTimetable(current);
    views.render(current, currentDiagnostics);
    pending = null;
    applyButton.disabled = true;
    cancelButton.disabled = true;
    const unassigned = current.lessons.filter(lesson => !lesson.assignedTime).length;
    currentStatus.textContent = `Caricato: ${current.name} · ${numberFormat.format(current.lessons.length)} lezioni · ${numberFormat.format(unassigned)} da assegnare`;
    importCard.hidden = true;
    appWorkspace.classList.add('has-timetable');
    changeButton.hidden = false;
    changeButton.textContent = 'Carica un altro orario';
    changeButton.setAttribute('aria-expanded', 'false');
    exportButton.disabled = false;
    report.dataset.state = 'ready';
    report.textContent = 'Orario caricato. I dati originali del file sono conservati nel modello.';
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

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void stageFile(file);
    input.value = '';
  });
  const ednInput = document.querySelector('#edn-file');
  const exportButton = document.querySelector('#export-edn');
  if (!ednInput || !exportButton) throw new Error('EDN interchange controls are missing.');
  ednInput.addEventListener('change', () => {
    const file = ednInput.files?.[0];
    if (file) void stageEDNFile(file);
    ednInput.value = '';
  });
  applyButton.addEventListener('click', applyImport);
  cancelButton.addEventListener('click', cancelImport);
  changeButton.addEventListener('click', () => {
    const open = importCard.hidden;
    importCard.hidden = !open;
    changeButton.textContent = open ? 'Nascondi importazione' : 'Carica un altro orario';
    changeButton.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  });
  exportButton.addEventListener('click', () => {
    try {
      if (exportEDN()) {
        report.dataset.state = 'ready';
        report.textContent = 'Dati esportati in formato EDN.';
      }
    } catch (error) {
      showError(error);
    }
  });

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
    stageFile,
    stageEDNFile,
    applyImport,
    cancelImport,
    exportEDN,
    views,
    editor,
    blankBuilder,
    get timetable() { return current; },
    get diagnostics() { return currentDiagnostics; },
    get pendingTimetable() { return pending?.timetable || null; },
  };
}
