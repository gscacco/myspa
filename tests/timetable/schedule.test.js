import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSchedule } from '../../timetable/js/schedule.js';
import { timetableFixture } from './helpers.js';

test('schedule analysis finds overlapping teacher, class, and room assignments across lesson durations', () => {
  const timetable = timetableFixture();
  const before = structuredClone(timetable);
  const result = analyzeSchedule(timetable);
  const collisions = result.issues.filter(issue => issue.code === 'resource-collision' && issue.periodIndex === 1);
  assert.deepEqual(new Set(collisions.map(issue => issue.resourceType)), new Set(['teacher', 'class', 'room']));
  assert.ok(collisions.every(issue => issue.lessonIds.length === 2));
  assert.deepEqual(timetable, before, 'analysis is read-only');
});

test('schedule analysis reports unavailable slots, soft preferences, and unassigned lessons with navigation IDs', () => {
  const result = analyzeSchedule(timetableFixture());
  assert.ok(result.issues.some(issue => issue.code === 'unavailable-time' && issue.lessonIds.includes('lesson:2')));
  assert.ok(result.issues.some(issue => issue.code === 'soft-preference' && issue.lessonIds.includes('lesson:1')));
  assert.ok(result.issues.some(issue => issue.code === 'unassigned-lesson' && issue.lessonIds.includes('lesson:4')));
  assert.equal(result.summary.unassignedLessons, 1);
  assert.ok(result.summary.hardConflicts >= 4);
});

test('schedule analysis ignores unassigned lessons for resource collisions and tolerates missing room assignments', () => {
  const result = analyzeSchedule(timetableFixture());
  assert.ok(result.issues.filter(issue => issue.code === 'resource-collision').every(issue => !issue.lessonIds.includes('lesson:4')));
  assert.equal(result.issues.some(issue => issue.resourceType === 'room' && issue.lessonIds.includes('lesson:4')), false);
});

test('schedule analysis does not invent class conflicts for UNKNOWN placeholders', () => {
  const timetable = timetableFixture();
  timetable.entities.classes.push({ id: 'class:unknown', name: 'UNKNOWN', placeholder: 'unknown' });
  timetable.lessons[0].classIds = ['class:unknown'];
  timetable.lessons[2].classIds = ['class:unknown'];
  timetable.lessons[2].assignedTime = { dayIndex: 0, periodIndex: 0, sourceValue: '0.0' };
  const result = analyzeSchedule(timetable);
  assert.equal(result.issues.some(issue => issue.code === 'resource-collision' && issue.resourceType === 'class'), false);
});
