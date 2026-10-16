import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyword, readEDN, writeEDN } from '../../timetable/js/edn-codec.js';

test('EDN codec round-trips the documented timetable value types', () => {
  const value = {
    schemaVersion: 1,
    name: 'Orario è valido',
    enabled: true,
    empty: null,
    lessonIds: ['lesson:0', 'lesson:1'],
    importStatus: keyword('verified'),
    source: { format: 'orario-facile-ofd', dayIndex: 2.5 },
  };
  assert.deepEqual(readEDN(writeEDN(value)), value);
});

test('EDN reader accepts whitespace, commas, and line comments', () => {
  assert.deepEqual(readEDN('{:days ["Mon", "Tue"] ; days\n :version 1}'), { days: ['Mon', 'Tue'], version: 1 });
});

test('EDN reader rejects trailing forms, malformed input, and duplicate map keys', () => {
  for (const source of ['{} {}', '{:a 1', '{:a 1 :a 2}', '[1 2]]']) {
    assert.throws(() => readEDN(source), /EDN/i, source);
  }
});

test('EDN reader explicitly rejects forms outside its documented interchange subset', () => {
  for (const source of ['#{1 2}', '(1 2)', 'symbol', '#unknown 1', '1/2']) {
    assert.throws(() => readEDN(source), /unsupported|EDN/i, source);
  }
});

test('EDN keyword values remain distinct from strings', () => {
  assert.notDeepEqual(readEDN(':verified'), 'verified');
  assert.deepEqual(readEDN(writeEDN(keyword('verified'))), keyword('verified'));
});

test('EDN writer rejects non-finite numbers and unsupported JavaScript values', () => {
  assert.throws(() => writeEDN(Infinity), /finite/i);
  assert.throws(() => writeEDN(new Set([1])), /unsupported/i);
});
