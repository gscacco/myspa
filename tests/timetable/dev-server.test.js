import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { contentTypeFor, directoryRedirect, resolveStaticPath } from '../../tools/static-routes.js';

const root = resolve('.');

test('development server resolves timetable stylesheet and favicon with browser-compatible MIME types', () => {
  const stylesheet = resolveStaticPath(root, '/timetable/css/style.css');
  const favicon = resolveStaticPath(root, '/timetable/favicon.svg');
  assert.equal(stylesheet, join(root, 'timetable/css/style.css'));
  assert.equal(favicon, join(root, 'timetable/favicon.svg'));
  assert.equal(contentTypeFor(stylesheet), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor(favicon), 'image/svg+xml');
  assert.equal(resolveStaticPath(root, '/%2e%2e%2fpackage.json'), null, 'static paths cannot escape the development root');
});

test('development server redirects directory URLs to a trailing slash while preserving query strings', () => {
  assert.equal(directoryRedirect('/timetable?view=class', true), '/timetable/?view=class');
  assert.equal(directoryRedirect('/timetable/', true), null);
  assert.equal(directoryRedirect('/timetable/index.html', false), null);
});
