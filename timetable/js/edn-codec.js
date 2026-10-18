/** Strict EDN interchange codec for timetable schema values. */

const KEYWORD_PATTERN = /^[A-Za-z_*+!?'<>=$%&.-][A-Za-z0-9_*+!?'<>=$%&./-]*$/;

export class EDNKeyword {
  constructor(name) {
    if (typeof name !== 'string' || !KEYWORD_PATTERN.test(name)) throw new TypeError(`Invalid EDN keyword: ${name}`);
    this.name = name;
    Object.freeze(this);
  }
}

export const keyword = name => new EDNKeyword(name.replace(/^:/, ''));

function isPlainMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof EDNKeyword) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function quoteString(value) {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function printValue(value, indent) {
  if (value === null) return 'nil';
  if (value instanceof EDNKeyword) return ':' + value.name;
  if (typeof value === 'string') return quoteString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('EDN supports only finite numbers');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const childIndent = indent + 2;
    return '[\n' + value.map(item => ' '.repeat(childIndent) + printValue(item, childIndent)).join('\n') + '\n' + ' '.repeat(indent) + ']';
  }
  if (isPlainMap(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const childIndent = indent + 2;
    return '{\n' + entries.map(([key, item]) => {
      const printedKey = KEYWORD_PATTERN.test(key) ? ':' + key : quoteString(key);
      return ' '.repeat(childIndent) + printedKey + ' ' + printValue(item, childIndent);
    }).join('\n') + '\n' + ' '.repeat(indent) + '}';
  }
  throw new TypeError('EDN writer encountered an unsupported value');
}

/** Writes maps, vectors, strings, keyword values, finite numbers, booleans, and nil. */
export function writeEDN(value) {
  return printValue(value, 0);
}

/** Reads the documented interchange subset and rejects all unconsumed or unsupported input. */
export function readEDN(source) {
  if (typeof source !== 'string') throw new TypeError('EDN input must be a string');
  let index = 0;
  const fail = message => { throw new SyntaxError(`EDN: ${message} at position ${index}`); };

  function skipSpace() {
    while (index < source.length) {
      const char = source[index];
      if (char === ',' || /\s/u.test(char)) { index++; continue; }
      if (char === ';') {
        while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
        continue;
      }
      break;
    }
  }

  function readString() {
    index++;
    let result = '';
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') return result;
      if (char !== '\\') { result += char; continue; }
      if (index >= source.length) fail('unfinished string escape');
      const escape = source[index++];
      const escapes = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      if (Object.hasOwn(escapes, escape)) { result += escapes[escape]; continue; }
      if (escape === 'u') {
        const hex = source.slice(index, index + 4);
        if (!/^[\da-f]{4}$/i.test(hex)) fail('invalid Unicode escape');
        result += String.fromCharCode(parseInt(hex, 16));
        index += 4;
        continue;
      }
      fail(`unsupported string escape \\${escape}`);
    }
    fail('unterminated string');
  }

  function readVector() {
    index++;
    const result = [];
    for (;;) {
      skipSpace();
      if (index >= source.length) fail('unterminated vector');
      if (source[index] === ']') { index++; return result; }
      result.push(readValue());
    }
  }

  function readMap() {
    index++;
    const result = {};
    for (;;) {
      skipSpace();
      if (index >= source.length) fail('unterminated map');
      if (source[index] === '}') { index++; return result; }
      const key = readValue();
      if (!(key instanceof EDNKeyword) && typeof key !== 'string') fail('map keys must be keywords or strings in the timetable interchange subset');
      const keyName = key instanceof EDNKeyword ? key.name : key;
      skipSpace();
      if (index >= source.length || source[index] === '}') fail('map has a key without a value');
      if (Object.hasOwn(result, keyName)) fail(`duplicate map key ${JSON.stringify(keyName)}`);
      Object.defineProperty(result, keyName, { value: readValue(), enumerable: true, writable: true, configurable: true });
    }
  }

  function readAtom() {
    const start = index;
    while (index < source.length && !/[\s,\[\]{}()";]/u.test(source[index])) index++;
    if (start === index) fail(`unexpected character ${JSON.stringify(source[index])}`);
    const token = source.slice(start, index);
    if (token === 'nil') return null;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token.startsWith(':')) {
      try { return keyword(token.slice(1)); } catch { fail(`invalid keyword ${token}`); }
    }
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) fail('number is outside the supported finite range');
      return value;
    }
    fail(`unsupported form ${token}`);
  }

  function readValue() {
    skipSpace();
    const char = source[index];
    if (char === '"') return readString();
    if (char === '[') return readVector();
    if (char === '{') return readMap();
    if (char === undefined) fail('expected a value');
    if (char === '(' || char === '#' || char === '\\' || char === '^' || char === '`' || char === '~' || char === '@') {
      fail(`unsupported reader form starting with ${char}`);
    }
    return readAtom();
  }

  const value = readValue();
  skipSpace();
  if (index !== source.length) fail('trailing input');
  return value;
}
