function clone(value) { return structuredClone(value); }

/** Applies one hard or soft timeframe change to a copied timetable model. */
export function updateTimeframeConstraint(timetable, { scope, id, kind, action, slot, from = slot }) {
  if (!['lesson', 'teacher', 'class', 'room'].includes(scope)) throw new TypeError('Ambito del vincolo non supportato.');
  if (!['unavailable', 'undesired', 'desired'].includes(kind)) throw new TypeError('Tipo di vincolo non supportato.');
  if (!['add', 'update', 'delete'].includes(action)) throw new TypeError('Operazione sul vincolo non supportata.');
  const validSlot = value => {
    const match = /^(\d+)\.(\d+)$/.exec(value || '');
    return match && Number(match[1]) < timetable.calendar.days.length && Number(match[2]) < timetable.calendar.periods.length;
  };
  if (action !== 'delete' && !validSlot(slot)) throw new RangeError('L’orario scelto non rientra nel calendario.');
  if (action !== 'add' && !validSlot(from)) throw new RangeError('Il vincolo da modificare non rientra nel calendario.');

  const next = clone(timetable);
  const collection = { teacher: 'teachers', class: 'classes', room: 'rooms' }[scope];
  const target = scope === 'lesson'
    ? next.lessons.find(item => item.id === id)
    : next.entities[collection].find(item => item.id === id);
  if (!target) throw new RangeError('Elemento del vincolo non trovato.');
  if (scope === 'lesson') target.timeframes ||= { unavailable: [], desired: [], undesired: [] };
  else {
    target.constraints ||= {};
    target.constraints.timeframes ||= { unavailable: [], desired: [], undesired: [] };
  }
  const timeframes = scope === 'lesson' ? target.timeframes : target.constraints.timeframes;
  timeframes.unavailable ||= [];
  timeframes.undesired ||= [];
  timeframes.desired ||= [];
  const values = timeframes[kind];
  if (action === 'delete') {
    const index = values.indexOf(from);
    if (index >= 0) values.splice(index, 1);
  } else if (action === 'add') {
    if (!values.includes(slot)) values.push(slot);
  } else {
    const index = values.indexOf(from);
    if (index < 0) throw new RangeError('Il vincolo da modificare non esiste più.');
    values[index] = slot;
    timeframes[kind] = [...new Set(values)];
  }
  return next;
}
