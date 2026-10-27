import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttachmentBundle, writeAttachmentBundle } from '../../loom/js/attachment-bundle.js';

const FILE = '660e8400-e29b-41d4-a716-446655440000';

test('attachment bundles round-trip file metadata and bytes', async () => {
  const blob = new Blob(['hello attachment'], { type: 'text/plain' });
  const source = await writeAttachmentBundle([{
    id: FILE,
    name: 'hello.txt',
    type: 'text/plain',
    size: blob.size,
    blob,
    'created-at': '2026-10-26T00:00:00.000Z',
  }]);
  const parsed = JSON.parse(source);
  assert.equal(parsed['schema-version'], 1);
  assert.equal(parsed.files[0].id, FILE);
  assert.equal(parsed.files[0].name, 'hello.txt');

  const [record] = await parseAttachmentBundle(source);
  assert.equal(record.id, FILE);
  assert.equal(record.name, 'hello.txt');
  assert.equal(record.type, 'text/plain');
  assert.equal(record.size, blob.size);
  assert.equal(await record.blob.text(), 'hello attachment');
});

test('attachment bundle import rejects malformed identities and byte counts', async () => {
  const source = JSON.stringify({
    'schema-version': 1,
    files: [{ id: 'bad', name: 'x.txt', type: 'text/plain', size: 1, 'created-at': '2026-10-26T00:00:00.000Z', data: 'eA==' }],
  });
  await assert.rejects(() => parseAttachmentBundle(source), /attachment ID/i);
  const mismatch = source.replace('"bad"', `"${FILE}"`).replace('"size":1', '"size":2');
  await assert.rejects(() => parseAttachmentBundle(mismatch), /size/i);
  await assert.rejects(() => parseAttachmentBundle('{"schema-version":2,"files":[]}'), /schema version/i);
});
