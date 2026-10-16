import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterIssues, countOpenIssues } from '../../timetable/js/diagnostics.js';

const items = [
  { id: 'teacher-collision', category: 'conflict', severity: 'error', text: 'Conflitto docente Ada', lessonIds: ['lesson:1', 'lesson:2'] },
  { id: 'missing-time', category: 'assignment', severity: 'warning', text: 'Lezione senza orario', lessonIds: ['lesson:3'] },
  { id: 'source-encoding', category: 'import', severity: 'warning', text: 'Codifica OFD diversa', lessonIds: [] },
  { id: 'informational', category: 'import', severity: 'info', text: 'Struttura conservata', lessonIds: [] },
];

test('issue filters combine severity, category, and search; open count excludes information', () => {
  assert.equal(countOpenIssues(items), 3);
  assert.deepEqual(filterIssues(items, { severity: 'warning', category: 'assignment' }).map(item => item.id), ['missing-time']);
  assert.deepEqual(filterIssues(items, { query: 'lesson:2' }).map(item => item.id), ['teacher-collision']);
  assert.deepEqual(filterIssues(items, { category: 'import', query: 'codifica' }).map(item => item.id), ['source-encoding']);
});
