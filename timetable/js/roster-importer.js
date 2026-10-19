import { updateTimeframeConstraint } from './constraints.js';

const ALIASES = Object.freeze({
  teachers: { name: ['docente', 'insegnante', 'teacher'], first: ['nome', 'name'], last: ['cognome', 'surname'] },
  classes: { name: ['nome', 'classe', 'class'] },
  subjects: { name: ['nome', 'materia', 'subject'] },
  rooms: { name: ['nome', 'aula', 'room'] },
  students: { name: ['studente', 'alunno'], first: ['nome', 'name'], last: ['cognome', 'surname'], class: ['classe', 'class'] },
});

function parseRows(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Il CSV è vuoto.');
  const firstLine = source.split(/\r?\n/, 1)[0];
  const delimiterCount = needle => {
    let quoted = false, count = 0;
    for (let index = 0; index < firstLine.length; index++) {
      if (firstLine[index] === '"' && firstLine[index + 1] === '"' && quoted) index++;
      else if (firstLine[index] === '"') quoted = !quoted;
      else if (firstLine[index] === needle && !quoted) count++;
    }
    return count;
  };
  const delimiter = delimiterCount(';') > delimiterCount(',') ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false, quoteClosed = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoteClosed) {
      if (char === delimiter) { row.push(field); field = ''; quoteClosed = false; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[index + 1] === '\n') index++;
        row.push(field); field = ''; quoteClosed = false;
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
      } else if (char === ' ' || char === '\t') continue;
      else throw new Error('Formato CSV non valido: testo dopo le virgolette.');
      continue;
    }
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; quoteClosed = true; }
      else field += char;
    } else if (char === '"') {
      if (field) throw new Error('Formato CSV non valido: virgolette fuori posizione.');
      quoted = true;
    } else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('Formato CSV non valido: virgolette non chiuse.');
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  if (!rows.length) throw new Error('Il CSV non contiene righe.');
  const headers = rows.shift().map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim());
  if (headers.some(value => !value) || new Set(headers.map(value => value.toLocaleLowerCase())).size !== headers.length) {
    throw new Error('Intestazioni CSV mancanti o duplicate.');
  }
  return { headers, rows };
}

function column(headers, aliases) {
  return headers.findIndex(header => aliases.includes(header.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()));
}

/** Imports an explicit roster CSV; unknown columns are retained as sourceData. */
export function parseRosterCSV(source, collection, timetable) {
  const config = ALIASES[collection];
  if (!config) throw new TypeError(`Import CSV non previsto per ${collection}.`);
  const { headers, rows } = parseRows(source);
  const nameColumn = column(headers, config.name);
  const splitName = ['students', 'teachers'].includes(collection) && nameColumn < 0;
  const firstColumn = splitName ? column(headers, config.first) : -1;
  const lastColumn = splitName ? column(headers, config.last) : -1;
  const classColumn = collection === 'students' ? column(headers, config.class) : -1;
  if (nameColumn < 0 && (firstColumn < 0 || lastColumn < 0)) throw new Error(`Il CSV deve contenere una colonna ${collection === 'students' ? 'studente oppure nome e cognome' : 'nome/docente oppure nome e cognome'}.`);
  if (collection === 'students' && classColumn < 0) throw new Error('Il CSV studenti deve contenere la colonna classe.');
  const existingNames = new Set((timetable.entities[collection] || []).map(item => item.name.trim().toLocaleLowerCase()));
  const items = [], seen = new Set();
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== headers.length) throw new Error(`Riga ${rowIndex + 2}: numero di colonne diverso dall’intestazione.`);
    const value = nameColumn >= 0 ? row[nameColumn].trim() : `${row[firstColumn].trim()} ${row[lastColumn].trim()}`.trim();
    if (!value) throw new Error(`Riga ${rowIndex + 2}: nome mancante.`);
    const normalized = value.toLocaleLowerCase();
    if (seen.has(normalized)) throw new Error(`Riga ${rowIndex + 2}: nome duplicato “${value}”.`);
    seen.add(normalized);
    const used = new Set([nameColumn, firstColumn, lastColumn, classColumn].filter(index => index >= 0));
    const item = { name: value };
    if (used.size < headers.length) item.sourceData = Object.fromEntries(headers.filter((_, index) => !used.has(index)).map((header, index) => [header, row[headers.indexOf(header)]]));
    if (collection === 'students') {
      const className = row[classColumn].trim();
      const schoolClass = timetable.entities.classes.find(entry => entry.name.trim().toLocaleLowerCase() === className.toLocaleLowerCase());
      if (!schoolClass) throw new Error(`Riga ${rowIndex + 2}: classe “${className}” non presente nella scuola.`);
      item.classId = schoolClass.id;
    }
    if (existingNames.has(normalized)) throw new Error(`Il nome “${value}” esiste già nella scuola.`);
    items.push(item);
  }
  return { items, warnings: [] };
}

const SCOPE_NAMES = Object.freeze({
  teacher: ['docente', 'insegnante', 'teacher'],
  class: ['classe', 'class'],
  room: ['aula', 'room'],
  lesson: ['lezione', 'lesson'],
});
const KIND_NAMES = Object.freeze({
  unavailable: ['obbligatorio', 'indisponibile', 'non disponibile', 'unavailable', 'hard'],
  undesired: ['da evitare', 'indesiderata', 'undesired', 'avoid'],
  desired: ['preferita', 'preferenza', 'desired', 'preferred'],
});

/** Reads canonical constraint rows with columns Ambito, Elemento, Vincolo, Giorno, Ora. */
export function parseConstraintCSV(source, timetable) {
  const { headers, rows } = parseRows(source);
  const scopeColumn = column(headers, ['ambito', 'tipo elemento', 'scope', 'categoria']);
  const elementColumn = column(headers, ['elemento', 'nome', 'name']);
  const kindColumn = column(headers, ['vincolo', 'tipo vincolo', 'kind', 'constraint']);
  const dayColumn = column(headers, ['giorno', 'day']);
  const periodColumn = column(headers, ['ora', 'orario', 'periodo', 'time']);
  if ([scopeColumn, elementColumn, kindColumn, dayColumn, periodColumn].some(index => index < 0)) {
    throw new Error('Il CSV vincoli deve contenere Ambito, Elemento, Vincolo, Giorno e Ora.');
  }
  const items = [];
  const seen = new Set();
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== headers.length) throw new Error(`Riga ${rowIndex + 2}: numero di colonne diverso dall’intestazione.`);
    const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
    const scopeText = normalized(row[scopeColumn]);
    const scope = Object.entries(SCOPE_NAMES).find(([, values]) => values.some(value => normalized(value) === scopeText))?.[0];
    const kindText = normalized(row[kindColumn]);
    const kind = Object.entries(KIND_NAMES).find(([, values]) => values.some(value => normalized(value) === kindText))?.[0];
    const elementName = normalized(row[elementColumn]);
    if (!scope || !kind || !elementName) throw new Error(`Riga ${rowIndex + 2}: ambito, elemento o vincolo non riconosciuto.`);
    const collection = { teacher: 'teachers', class: 'classes', room: 'rooms' }[scope];
    const candidates = scope === 'lesson'
      ? timetable.lessons.filter(lesson => {
        const subject = timetable.entities.subjects.find(item => item.id === lesson.subjectId)?.name;
        const schoolClass = (lesson.classIds || []).map(id => timetable.entities.classes.find(item => item.id === id)?.name).filter(Boolean).join(', ');
        return normalized(`${subject || ''} ${schoolClass}`) === elementName || normalized(subject || '') === elementName;
      })
      : (timetable.entities[collection] || []).filter(item => normalized(item.name) === elementName);
    if (candidates.length !== 1) throw new Error(`Riga ${rowIndex + 2}: elemento “${row[elementColumn]}” ${candidates.length ? 'non è univoco' : 'non esiste'} nell’ambito indicato.`);
    const dayValue = normalized(row[dayColumn]);
    const dayIndex = timetable.calendar.days.findIndex((item, index) => normalized(item.name) === dayValue || normalized(item.shortName || '') === dayValue || String(index + 1) === dayValue);
    const periodValue = normalized(row[periodColumn]);
    const periodIndex = timetable.calendar.periods.findIndex((item, index) => {
      const time = `${String(Math.floor(item.beginMinute / 60)).padStart(2, '0')}:${String(item.beginMinute % 60).padStart(2, '0')}`;
      return normalized(time) === periodValue || String(index + 1) === periodValue;
    });
    if (dayIndex < 0 || periodIndex < 0) throw new Error(`Riga ${rowIndex + 2}: giorno o ora non presenti nel calendario.`);
    const item = { scope, id: candidates[0].id, kind, slot: `${dayIndex}.${periodIndex}` };
    const signature = `${item.scope}|${item.id}|${item.kind}|${item.slot}`;
    if (seen.has(signature)) throw new Error(`Riga ${rowIndex + 2}: vincolo duplicato.`);
    seen.add(signature);
    updateTimeframeConstraint(timetable, { ...item, action: 'add' });
    items.push(item);
  }
  return { items, warnings: [] };
}
