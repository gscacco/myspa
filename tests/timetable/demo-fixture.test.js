import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { importTimetableEDN } from '../../timetable/js/edn-importer.js';
import { analyzeSchedule } from '../../timetable/js/schedule.js';
import { findAlternatives } from '../../timetable/js/solver.js';

const fixturePath = fileURLToPath(new URL('../../timetable/fixtures/conflict-demo.edn', import.meta.url));

test('synthetic EDN demo contains a diagnosable conflict and supports a hard-valid repair', async () => {
  const { timetable } = importTimetableEDN(await readFile(fixturePath, 'utf8'));
  assert.equal(timetable.name, 'Synthetic coordination demo');
  const analysis = analyzeSchedule(timetable);
  assert.ok(analysis.issues.some(issue => issue.code === 'resource-collision' && issue.resourceType === 'teacher'));
  assert.ok(analysis.issues.some(issue => issue.code === 'unassigned-lesson'));

  const result = await findAlternatives(timetable, 'lesson:demo-1', { maxMoves: 3, maxResults: 4 });
  assert.ok(result.suggestions.length > 0);
  assert.ok(result.suggestions.every(item => item.hardValid));
});
