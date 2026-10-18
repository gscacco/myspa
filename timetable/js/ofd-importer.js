import { TIMETABLE_SCHEMA_VERSION } from './domain.js';
import { validateTimetable } from './validation.js';

const ENTITIES = Object.freeze({
  teachers: { definition: 'TEACHER', data: 'TEACHERDATA', reference: 'TEACHER', idPrefix: 'teacher' },
  rooms: { definition: 'ROOM', data: 'ROOMDATA', reference: 'ROOM', idPrefix: 'room' },
  classes: { definition: 'CLASS', data: 'CLASSDATA', reference: 'CLASS', idPrefix: 'class' },
  subjects: { definition: 'SUBJECT', data: 'SUBJECTDATA', reference: 'SUBJECT', idPrefix: 'subject' },
});

const SUPPORTED_TAGS = new Set((
  'DOCUMENT VERSION ID PERIOD NAME MODULE SITE SUBJECT ROOM CLASS TEACHER SEX PERIODDATA PERIODDATA TIMEGRID TIMEUNIT DAYS HOURS CIRCULARITY DAY SHORTNAME LONGNAME HOUR BEGIN END PRINTBEGIN ' +
  'TEACHERDATA ROOMDATA CLASSDATA SUBJECTDATA NUMBER MIN MAX WEIGHT DISTMIN DISTMAX FORCELEFT FORCERIGHT AVOIDAMGAP FREEDAYS TIMEFRAMES UNAVAIL DESIRED UNDESIRED ' +
  'BACKCOLOR FORECOLOR LINK SUBJECTA SUBJECTB PARAM CODE CUSTOM PRIORITY OPTIMIZED LOCKED FIXED ALLOW LESSON DURATION ALIGN PAUSE GROUP TIME ' +
  'WEEK WEEKS WEEKDATA SITEDATA MODULEDATA'
).split(/\s+/));

export class OFDImportError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'OFDImportError';
    this.diagnostics = diagnostics;
  }
}

function fail(message, path = '') {
  throw new OFDImportError(path ? `${message} (${path})` : message, [
    { severity: 'error', code: 'invalid-ofd', message, path },
  ]);
}

function normalizedEncoding(name) {
  const value = name.toLowerCase().replace(/_/g, '-');
  if (['latin1', 'latin-1', 'iso-8859-1', 'us-ascii', 'ascii', 'windows-1252', 'cp1252'].includes(value)) return 'windows-1252';
  if (['utf8', 'utf-8'].includes(value)) return 'utf-8';
  if (['utf-16', 'utf-16le', 'utf-16be'].includes(value)) return value;
  return name;
}

function decodeInput(input) {
  if (typeof input === 'string') {
    const declaredEncoding = /<\?xml\b[^>]*\bencoding\s*=\s*['"]([^'"]+)['"]/i.exec(input)?.[1] || null;
    return { text: input, declaredEncoding, decodedEncoding: 'unicode-string', encodingMismatch: false };
  }
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) throw new OFDImportError('Choose an OFD file or provide XML bytes.');

  let offset = 0, bomEncoding = null;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { offset = 3; bomEncoding = 'utf-8'; }
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { offset = 2; bomEncoding = 'utf-16le'; }
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { offset = 2; bomEncoding = 'utf-16be'; }

  const declarationText = new TextDecoder('windows-1252').decode(bytes.subarray(offset, Math.min(bytes.length, offset + 512)));
  const declaredEncoding = /<\?xml\b[^>]*\bencoding\s*=\s*['"]([^'"]+)['"]/i.exec(declarationText)?.[1] || null;
  const highBytes = bytes.subarray(offset).some(byte => byte > 0x7f);
  let selected = bomEncoding || normalizedEncoding(declaredEncoding || 'utf-8');
  let encodingMismatch = false;
  if (!bomEncoding && declaredEncoding && ['us-ascii', 'ascii'].includes(declaredEncoding.toLowerCase()) && highBytes) {
    selected = 'windows-1252';
    encodingMismatch = true;
  } else if (bomEncoding && declaredEncoding && normalizedEncoding(declaredEncoding) !== bomEncoding
    && !(bomEncoding === 'utf-16le' && normalizedEncoding(declaredEncoding) === 'utf-16')) {
    encodingMismatch = true;
  }
  let text;
  try {
    text = new TextDecoder(selected, { fatal: selected === 'utf-8' || selected.startsWith('utf-16') }).decode(bytes.subarray(offset));
  } catch (error) {
    throw new OFDImportError(`OFD character encoding could not be decoded (${declaredEncoding || selected}): ${error.message}`);
  }
  return { text, declaredEncoding, decodedEncoding: selected, encodingMismatch };
}

function children(element, tag) {
  return Array.from(element?.children || []).filter(child => child.localName === tag);
}

function one(element, tag, path, { required = false } = {}) {
  const matches = children(element, tag);
  if (matches.length > 1) fail(`Expected at most one <${tag}> element.`, path);
  if (!matches.length && required) fail(`Missing required <${tag}> element.`, path);
  return matches[0] || null;
}

function attribute(element, name, path, { required = true } = {}) {
  const value = element?.getAttribute(name);
  if ((value == null || value === '') && required) fail(`Missing required ${name} attribute.`, path);
  return value;
}

function valueOf(element, path, options) {
  return attribute(element, 'value', path, options);
}

function integer(value, path, { minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) fail(`Expected an integer, got ${String(value)}.`, path);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) fail(`Invalid integer ${value}.`, path);
  return parsed;
}

function slot(value, path, dayCount, periodCount) {
  const match = /^(\d+)\.(\d+)$/.exec(value || '');
  if (!match) fail(`Cannot interpret OFD time value ${String(value)} as day.period.`, path);
  const dayIndex = Number(match[1]), periodIndex = Number(match[2]);
  if (dayIndex >= dayCount || periodIndex >= periodCount) fail(`Time value ${value} is outside the declared time grid.`, path);
  return { dayIndex, periodIndex, sourceValue: value };
}

function readTimeframes(element, path, calendar) {
  const result = { unavailable: [], desired: [], undesired: [] };
  if (!element) return result;
  const tags = { UNAVAIL: 'unavailable', DESIRED: 'desired', UNDESIRED: 'undesired' };
  for (const child of Array.from(element.children)) {
    const key = tags[child.localName];
    if (!key) continue;
    const raw = valueOf(child, `${path}/${child.localName}`);
    slot(raw, `${path}/${child.localName}`, calendar.days.length, calendar.periods.length);
    result[key].push(raw);
  }
  return result;
}

function collectUnsupported(document, diagnostics) {
  const unsupportedStructures = [];
  const unsupportedTags = new Map();
  const unsupportedAttributes = new Map();
  const visit = (element, parentPath, index) => {
    const path = `${parentPath}/${element.localName}[${index}]`;
    if (!SUPPORTED_TAGS.has(element.localName)) {
      unsupportedStructures.push({ tag: element.localName, path });
      unsupportedTags.set(element.localName, (unsupportedTags.get(element.localName) || 0) + 1);
    }
    for (const name of element.getAttributeNames()) {
      if (name !== 'value') unsupportedAttributes.set(name, (unsupportedAttributes.get(name) || 0) + 1);
    }
    const counts = new Map();
    for (const child of Array.from(element.children)) {
      const childIndex = counts.get(child.localName) || 0;
      counts.set(child.localName, childIndex + 1);
      visit(child, path, childIndex);
    }
  };
  visit(document.documentElement, '', 0);
  if (unsupportedTags.size) diagnostics.push({
    severity: 'warning', code: 'unsupported-structure',
    message: `${unsupportedStructures.length} elementi OFD non interpretati sono conservati nel sorgente (${[...unsupportedTags.keys()].slice(0, 12).join(', ')}${unsupportedTags.size > 12 ? ', …' : ''}).`,
    details: { count: unsupportedStructures.length, tags: [...unsupportedTags.keys()] },
    path: unsupportedStructures[0]?.path || 'DOCUMENT',
  });
  if (unsupportedAttributes.size) diagnostics.push({
    severity: 'warning', code: 'unsupported-attribute',
    message: `Attributi OFD non interpretati conservati nel sorgente (${[...unsupportedAttributes.keys()].join(', ')}).`,
    details: { counts: Object.fromEntries(unsupportedAttributes) }, path: 'DOCUMENT',
  });
  return unsupportedStructures;
}

// Some OFD 12055 exports contain literal '<' characters inside quoted values.
// Repair only those attribute values for the parser; keep the imported source intact.
function escapeLessThanInAttributes(xml) {
  let output = '';
  let inTag = false;
  let quote = '';
  for (let index = 0; index < xml.length; index++) {
    const rest = xml.slice(index);
    if (!inTag && (rest.startsWith('<!--') || rest.startsWith('<![CDATA[') || rest.startsWith('<?'))) {
      const endToken = rest.startsWith('<!--') ? '-->' : rest.startsWith('<![CDATA[') ? ']]>' : '?>';
      const end = xml.indexOf(endToken, index + endToken.length);
      const finish = end < 0 ? xml.length : end + endToken.length;
      output += xml.slice(index, finish);
      index = finish - 1;
      continue;
    }
    const char = xml[index];
    if (!inTag && char === '<') inTag = true;
    if (inTag && quote && char === '<') output += '&lt;';
    else output += char;
    if (inTag && quote) {
      if (char === quote) quote = '';
    } else if (inTag && (char === '"' || char === "'")) quote = char;
    else if (inTag && char === '>') inTag = false;
  }
  return output;
}

function readDefinitions(root, type, config) {
  const records = children(root, config.definition).map((element, index) => {
    const path = `${config.definition}[${index}]`;
    const name = valueOf(one(element, 'NAME', path, { required: true }), `${path}/NAME`);
    const record = { id: `${config.idPrefix}:${name}`, name };
    if (type === 'teachers') {
      const sex = one(element, 'SEX', path);
      if (sex) record.sex = valueOf(sex, `${path}/SEX`);
    }
    return record;
  });
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.name)) fail(`Duplicate ${type.slice(0, -1)} name ${record.name}.`, config.definition);
    seen.add(record.name);
  }
  return records;
}

function numericFields(dataElement, fields, path) {
  const result = {};
  for (const [tag, key] of fields) {
    const child = one(dataElement, tag, path);
    if (child) result[key] = integer(valueOf(child, `${path}/${tag}`), `${path}/${tag}`);
  }
  return result;
}

function dataByName(parent, config) {
  const result = new Map();
  children(parent, config.data).forEach((data, index) => {
    const itemPath = `${config.data}[${index}]`;
    const ref = one(data, config.reference, itemPath, { required: true });
    const name = valueOf(ref, `${itemPath}/${config.reference}`);
    if (result.has(name)) fail(`Duplicate ${config.data} record for ${name}.`, itemPath);
    result.set(name, { element: data, path: itemPath });
  });
  return result;
}

function attachEntityData(entities, dataIndex, config, calendar) {
  const constraintFields = [
    ['MIN', 'minimum'], ['MAX', 'maximum'], ['WEIGHT', 'weight'],
    ['DISTMIN', 'distributionMinimum'], ['DISTMAX', 'distributionMaximum'],
    ['FORCELEFT', 'forceLeft'], ['FORCERIGHT', 'forceRight'],
    ['AVOIDAMGAP', 'avoidMorningGap'], ['FREEDAYS', 'freeDays'],
  ];
  for (const entity of entities) {
    const data = dataIndex.get(entity.name);
    if (!data) continue;
    if (config.idPrefix === 'subject') {
      entity.preferences = numericFields(data.element, [['BACKCOLOR', 'backgroundColor'], ['FORECOLOR', 'foregroundColor'], ['WEIGHT', 'weight']], data.path);
      continue;
    }
    const fields = config.idPrefix === 'room' ? [['NUMBER', 'number']] : constraintFields;
    const constraints = numericFields(data.element, fields, data.path);
    const directFrames = one(data.element, 'TIMEFRAMES', data.path);
    let timeframeElement = directFrames;
    let timeframePath = `${data.path}/TIMEFRAMES`;
    if (!timeframeElement) {
      const weekData = children(data.element, 'WEEKDATA').find(item =>
        children(item, 'WEEK').some(week => valueOf(week, `${data.path}/WEEKDATA/WEEK`) === '0'));
      timeframeElement = weekData && one(weekData, 'TIMEFRAMES', `${data.path}/WEEKDATA`);
      if (timeframeElement) timeframePath = `${data.path}/WEEKDATA/TIMEFRAMES`;
    }
    constraints.timeframes = readTimeframes(timeframeElement, timeframePath, calendar);
    entity.constraints = constraints;
  }
}

function references(lesson, tag, idPrefix, path, { required = false } = {}) {
  const result = children(lesson, tag).map((element, index) => {
    const refPath = `${path}/${tag}[${index}]`;
    const name = valueOf(one(element, 'NAME', refPath, { required: true }), `${refPath}/NAME`);
    return `${idPrefix}:${name}`;
  });
  if (required && !result.length) fail(`Lesson requires at least one <${tag}> reference.`, path);
  return result;
}

function readLessons(periodData, entities, calendar) {
  const names = Object.fromEntries(Object.entries(ENTITIES).map(([type]) => [
    type, new Map(entities[type].map(entity => [entity.name, entity.id])),
  ]));
  const ids = Object.fromEntries(Object.entries(ENTITIES).map(([type]) => [
    type, new Set(entities[type].map(entity => entity.id)),
  ]));
  const ensureUnknown = collection => {
    let entity = entities[collection].find(item => item.placeholder === 'unknown')
      || entities[collection].find(item => item.name.trim().toLocaleUpperCase() === 'UNKNOWN');
    if (!entity) {
      const prefix = ENTITIES[collection].idPrefix;
      const occupied = new Set(Object.values(entities).flatMap(items => Array.isArray(items) ? items.map(item => item.id) : []));
      let id = `${prefix}:unknown`, suffix = 2;
      while (occupied.has(id)) id = `${prefix}:unknown-${suffix++}`;
      entity = { id, name: 'UNKNOWN' };
      entities[collection].push(entity);
    }
    entity.placeholder = 'unknown';
    names[collection].set('UNKNOWN', entity.id);
    ids[collection].add(entity.id);
    return entity.id;
  };
  return children(periodData, 'LESSON').map((element, index) => {
    const path = `PERIODDATA/LESSON[${index}]`;
    const lessonWeek = one(element, 'WEEK', path);
    if (lessonWeek && valueOf(lessonWeek, `${path}/WEEK`) !== '0') fail('Only one-week OFD calendars are supported.', `${path}/WEEK`);
    const subjectElement = one(element, 'SUBJECT', path);
    const subject = subjectElement ? valueOf(subjectElement, `${path}/SUBJECT`, { required: false }) : null;
    const durationPeriods = integer(valueOf(one(element, 'DURATION', path, { required: true }), `${path}/DURATION`), `${path}/DURATION`, { minimum: 1 });
    const teacherIds = references(element, 'TEACHER', 'teacher', path, { required: true });
    const classIds = references(element, 'GROUP', 'class', path);
    const roomIds = references(element, 'ROOM', 'room', path);
    const unknown = [
      ...(subject && !names.subjects.has(subject) ? [`subject ${subject}`] : []),
      ...teacherIds.filter(id => !ids.teachers.has(id)).map(id => `teacher ${id.slice(8)}`),
      ...classIds.filter(id => !ids.classes.has(id)).map(id => `class ${id.slice(6)}`),
      ...roomIds.filter(id => !ids.rooms.has(id)).map(id => `room ${id.slice(5)}`),
    ];
    if (unknown.length) fail(`Lesson refers to missing ${unknown.join(', ')}.`, path);
    if (!classIds.length) classIds.push(ensureUnknown('classes'));

    const rawTime = one(element, 'TIME', path);
    let assignedTime = null;
    if (rawTime) {
      const raw = valueOf(rawTime, `${path}/TIME`);
      assignedTime = slot(raw, `${path}/TIME`, calendar.days.length, calendar.periods.length);
      if (assignedTime.periodIndex + durationPeriods > calendar.periods.length) fail('Lesson duration runs beyond the declared day.', `${path}/TIME`);
    }
    const textValue = (tag, required = false) => {
      const child = one(element, tag, path, { required });
      return child ? valueOf(child, `${path}/${tag}`) : null;
    };
    const timeframe = one(element, 'TIMEFRAMES', path);
    const rawAlignment = textValue('ALIGN');
    const rawPause = textValue('PAUSE');
    const lesson = {
      id: `lesson:${index}`,
      sourceIndex: index,
      subjectId: subject ? names.subjects.get(subject) : ensureUnknown('subjects'),
      teacherIds,
      classIds,
      roomIds,
      durationPeriods,
      site: textValue('SITE'),
      module: textValue('MODULE'),
      alignment: rawAlignment == null ? null : integer(rawAlignment, `${path}/ALIGN`),
      pause: rawPause == null ? null : integer(rawPause, `${path}/PAUSE`),
      assignedTime,
      timeframes: readTimeframes(timeframe, `${path}/TIMEFRAMES`, calendar),
    };
    return lesson;
  });
}

function readTimeGrid(periodData) {
  const grid = one(periodData, 'TIMEGRID', 'PERIODDATA', { required: true });
  const unitMinutes = integer(valueOf(one(grid, 'TIMEUNIT', 'PERIODDATA/TIMEGRID', { required: true }), 'TIMEGRID/TIMEUNIT'), 'TIMEGRID/TIMEUNIT', { minimum: 1 });
  const dayCount = integer(valueOf(one(grid, 'DAYS', 'TIMEGRID', { required: true }), 'TIMEGRID/DAYS'), 'TIMEGRID/DAYS', { minimum: 1 });
  const periodCount = integer(valueOf(one(grid, 'HOURS', 'TIMEGRID', { required: true }), 'TIMEGRID/HOURS'), 'TIMEGRID/HOURS', { minimum: 1 });
  const circularity = integer(valueOf(one(grid, 'CIRCULARITY', 'TIMEGRID', { required: true }), 'TIMEGRID/CIRCULARITY'), 'TIMEGRID/CIRCULARITY', { minimum: 0 });
  const weeksElement = one(grid, 'WEEKS', 'TIMEGRID') || one(periodData, 'WEEKS', 'PERIODDATA');
  const weekCount = weeksElement ? integer(valueOf(weeksElement, 'TIMEGRID/WEEKS'), 'TIMEGRID/WEEKS', { minimum: 1 }) : 1;
  if (weekCount !== 1) fail(`This timetable model supports one week; the OFD file declares ${weekCount}.`, 'TIMEGRID/WEEKS');
  const dayElements = children(grid, 'DAY').length ? children(grid, 'DAY') : children(periodData, 'DAY');
  const nestedHours = dayElements.map(day => children(day, 'HOUR'));
  const gridHours = children(grid, 'HOUR');
  const periodElements = gridHours.length ? gridHours : (nestedHours[0] || []);
  const days = dayElements.map((day, index) => ({
    index,
    shortName: valueOf(one(day, 'SHORTNAME', `TIMEGRID/DAY[${index}]`, { required: true }), `TIMEGRID/DAY[${index}]/SHORTNAME`),
    name: valueOf(one(day, 'LONGNAME', `TIMEGRID/DAY[${index}]`, { required: true }), `TIMEGRID/DAY[${index}]/LONGNAME`),
  }));
  const periods = periodElements.map((hour, index) => ({
    index,
    beginMinute: integer(valueOf(one(hour, 'BEGIN', `TIMEGRID/HOUR[${index}]`, { required: true }), `TIMEGRID/HOUR[${index}]/BEGIN`), `TIMEGRID/HOUR[${index}]/BEGIN`, { minimum: 0 }),
    endMinute: integer(valueOf(one(hour, 'END', `TIMEGRID/HOUR[${index}]`, { required: true }), `TIMEGRID/HOUR[${index}]/END`), `TIMEGRID/HOUR[${index}]/END`, { minimum: 0 }),
    printBegin: integer(valueOf(one(hour, 'PRINTBEGIN', `TIMEGRID/HOUR[${index}]`, { required: true }), `TIMEGRID/HOUR[${index}]/PRINTBEGIN`), `TIMEGRID/HOUR[${index}]/PRINTBEGIN`, { minimum: 0 }) !== 0,
  }));
  if (days.length !== dayCount) fail(`TIMEGRID declares ${dayCount} days but contains ${days.length}.`, 'TIMEGRID/DAY');
  if (periods.length !== periodCount) fail(`TIMEGRID declares ${periodCount} periods but contains ${periods.length}.`, 'TIMEGRID/HOUR');
  if (!gridHours.length && nestedHours.some(hours => hours.length !== periodCount)) {
    fail('Each day must contain the declared number of periods.', 'PERIODDATA/DAY/HOUR');
  }
  const calendar = { unitMinutes, days, periods, circularity };
  for (const [index, period] of periods.entries()) {
    if (period.endMinute <= period.beginMinute) fail('Period end must follow its start.', `TIMEGRID/HOUR[${index}]`);
  }
  return calendar;
}

function readLinks(periodData, subjectByName) {
  return children(periodData, 'LINK').map((link, index) => {
    const path = `PERIODDATA/LINK[${index}]`;
    const subjectAName = valueOf(one(link, 'SUBJECTA', path, { required: true }), `${path}/SUBJECTA`);
    const subjectBName = valueOf(one(link, 'SUBJECTB', path, { required: true }), `${path}/SUBJECTB`);
    if (!subjectByName.has(subjectAName) || !subjectByName.has(subjectBName)) fail('LINK refers to a missing subject.', path);
    const daysElement = one(link, 'DAYS', path);
    const hoursElement = one(link, 'HOURS', path);
    return {
      subjectAId: subjectByName.get(subjectAName),
      subjectBId: subjectByName.get(subjectBName),
      days: daysElement ? integer(valueOf(daysElement, `${path}/DAYS`), `${path}/DAYS`, { minimum: 0 }) : 0,
      ...(hoursElement ? { hours: integer(valueOf(hoursElement, `${path}/HOURS`), `${path}/HOURS`, { minimum: 0 }) } : {}),
    };
  });
}

function readParameters(periodData) {
  const fields = ['CODE', 'CUSTOM', 'PRIORITY', 'OPTIMIZED', 'LOCKED', 'FIXED', 'ALLOW'];
  return children(periodData, 'PARAM').map((param, index) => {
    const path = `PERIODDATA/PARAM[${index}]`;
    const result = {};
    for (const tag of fields) {
      const child = one(param, tag, path, { required: true });
      result[tag[0].toLowerCase() + tag.slice(1)] = valueOf(child, `${path}/${tag}`);
    }
    return result;
  });
}

/** Parse an OFD XML string or file bytes without executing or resolving embedded content. */
export function importOFD(input, { DOMParser: Parser = globalThis.DOMParser } = {}) {
  if (!Parser) throw new OFDImportError('This environment does not provide an XML DOMParser.');
  const decoded = decodeInput(input);
  if (/<!DOCTYPE\b/i.test(decoded.text)) throw new OFDImportError('OFD documents with DTD declarations are not supported. External entities are never resolved.');
  const diagnostics = [];
  if (decoded.encodingMismatch) {
    diagnostics.push({ severity: 'warning', code: 'encoding-mismatch', message: `The XML encoding declaration (${decoded.declaredEncoding}) does not match the file bytes; decoded as ${decoded.decodedEncoding}.`, declaredEncoding: decoded.declaredEncoding, decodedEncoding: decoded.decodedEncoding, path: 'xml-declaration' });
  }
  const sourceForParser = escapeLessThanInAttributes(decoded.text.replace(/^\uFEFF?\s*<\?xml\b[^?]*\?>/i, ''));
  let document;
  try { document = new Parser().parseFromString(sourceForParser, 'application/xml'); }
  catch (error) { throw new OFDImportError(`Malformed OFD XML: ${error.message}`); }
  const parserError = document.getElementsByTagName('parsererror')[0];
  if (parserError) throw new OFDImportError(`Malformed OFD XML: ${parserError.textContent.trim()}`);
  const root = document.documentElement;
  if (!root || root.localName !== 'DOCUMENT') fail('Expected an OFD DOCUMENT root element.');
  const version = valueOf(one(root, 'VERSION', 'DOCUMENT', { required: true }), 'VERSION');
  if (!['5000', '12055'].includes(version)) throw new OFDImportError(`OFD version ${version} is not verified; this importer supports versions 5000 and 12055 with one week.`);
  const unsupportedStructures = collectUnsupported(document, diagnostics);
  const documentId = valueOf(one(root, 'ID', 'DOCUMENT', { required: true }), 'ID');
  const titleElement = one(one(root, 'PERIOD', 'DOCUMENT', { required: true }), 'NAME', 'PERIOD', { required: true });
  const name = valueOf(titleElement, 'PERIOD/NAME');
  const periodData = one(root, 'PERIODDATA', 'DOCUMENT', { required: true });
  const periodDataName = valueOf(one(periodData, 'PERIOD', 'PERIODDATA', { required: true }), 'PERIODDATA/PERIOD');
  if (periodDataName !== name) diagnostics.push({
    severity: 'warning', code: 'period-name-mismatch', message: 'The document title and PERIODDATA name differ; both values are preserved.',
    documentName: name, periodDataName, path: 'PERIODDATA/PERIOD',
  });
  const calendar = readTimeGrid(periodData);

  const entities = {};
  const dataIndexes = {};
  for (const [type, config] of Object.entries(ENTITIES)) {
    entities[type] = readDefinitions(root, type, config);
    dataIndexes[type] = dataByName(periodData, config);
    for (const [entityName, data] of dataIndexes[type]) {
      if (!entities[type].some(entity => entity.name === entityName)) fail(`${config.data} refers to missing ${type.slice(0, -1)} ${entityName}.`, data.path);
    }
    attachEntityData(entities[type], dataIndexes[type], config, calendar);
  }
  entities.students = [];

  const timetable = {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    name,
    source: {
      format: 'orario-facile-ofd', version, documentId,
      declaredEncoding: decoded.declaredEncoding,
      decodedEncoding: decoded.decodedEncoding,
      catalogues: {
        periodDataName,
        sites: children(root, 'SITE').map((item, index) => valueOf(one(item, 'NAME', `SITE[${index}]`, { required: true }), `SITE[${index}]/NAME`)),
        modules: children(root, 'MODULE').map((item, index) => valueOf(one(item, 'NAME', `MODULE[${index}]`, { required: true }), `MODULE[${index}]/NAME`)),
      },
      xml: decoded.text,
      unsupportedStructures,
    },
    calendar,
    entities,
    lessons: readLessons(periodData, entities, calendar),
    links: readLinks(periodData, new Map(entities.subjects.map(subject => [subject.name, subject.id]))),
    parameters: readParameters(periodData),
  };

  const validation = validateTimetable(timetable);
  if (validation.errors.length) {
    const first = validation.errors[0];
    throw new OFDImportError(`Imported timetable failed validation: ${first.message} (${first.path})`, validation.errors.map(error => ({ ...error, severity: 'error' })));
  }
  const unassigned = timetable.lessons.filter(lesson => lesson.assignedTime === null).length;
  if (unassigned) diagnostics.push({ severity: 'warning', code: 'unassigned-lessons', message: `${unassigned} lessons have no assigned time in the source file.`, details: { count: unassigned }, path: 'PERIODDATA/LESSON' });
  const unknownClasses = new Set(entities.classes.filter(item => item.placeholder === 'unknown').map(item => item.id));
  const unknownSubjects = new Set(entities.subjects.filter(item => item.placeholder === 'unknown').map(item => item.id));
  const lessonsWithoutClass = timetable.lessons.filter(lesson => lesson.classIds.some(id => unknownClasses.has(id))).length;
  const lessonsWithoutSubject = timetable.lessons.filter(lesson => unknownSubjects.has(lesson.subjectId)).length;
  if (lessonsWithoutClass) diagnostics.push({ severity: 'warning', code: 'lesson-without-class', message: `${lessonsWithoutClass} lessons have no class; UNKNOWN was assigned.`, details: { count: lessonsWithoutClass }, path: 'PERIODDATA/LESSON' });
  if (lessonsWithoutSubject) diagnostics.push({ severity: 'warning', code: 'lesson-without-subject', message: `${lessonsWithoutSubject} lessons have no subject; UNKNOWN was assigned.`, details: { count: lessonsWithoutSubject }, path: 'PERIODDATA/LESSON' });
  const summary = {
    teachers: entities.teachers.length,
    rooms: entities.rooms.length,
    classes: entities.classes.length,
    subjects: entities.subjects.length,
    lessons: timetable.lessons.length,
    assignedLessons: timetable.lessons.length - unassigned,
    unassignedLessons: unassigned,
    warningCount: diagnostics.filter(item => item.severity === 'warning').length,
  };
  return { timetable, diagnostics, summary };
}

/** Returns a faithful OFD model with active lesson placements cleared. */
export function withoutOFDAssignments(result) {
  const timetable = structuredClone(result.timetable);
  const cleared = timetable.lessons.filter(lesson => lesson.assignedTime !== null).length;
  for (const lesson of timetable.lessons) lesson.assignedTime = null;
  const diagnostics = (result.diagnostics || []).filter(item => item.code !== 'unassigned-lessons');
  diagnostics.push({
    severity: 'info', code: 'assignments-omitted',
    message: 'Source placements were omitted from the active timetable and are not used by calculations.',
    details: { count: cleared }, path: 'PERIODDATA/LESSON/TIME',
  });
  const summary = {
    ...result.summary,
    assignedLessons: 0,
    unassignedLessons: timetable.lessons.length,
  };
  if (timetable.lessons.length) diagnostics.push({
    severity: 'warning', code: 'unassigned-lessons',
    message: 'All imported lesson placements were omitted.',
    details: { count: timetable.lessons.length }, path: 'PERIODDATA/LESSON',
  });
  summary.warningCount = diagnostics.filter(item => item.severity === 'warning').length;
  return { ...result, timetable, diagnostics, summary };
}
