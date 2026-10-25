import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const SOURCE = new URL('../../loom/js/', import.meta.url);

test('Loom browser source modules only use resolvable import specifiers', async () => {
  const files = (await readdir(SOURCE)).filter(name => name.endsWith('.js'));
  const bare = [];
  for (const name of files) {
    const source = await readFile(new URL(name, SOURCE), 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) bare.push(`${name}: ${specifier}`);
    }
  }
  assert.deepEqual(bare, [], `Browser-native modules cannot resolve bare specifiers:\n${bare.join('\n')}`);
});

test('Loom source declares an inline favicon', async () => {
  const html = await readFile(new URL('../../loom/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/i);
});
