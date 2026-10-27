/** Portable JSON bundles for exporting and importing all Loom attachment blobs. */

import { normalizeAttachment } from './attachments.js';

export const ATTACHMENT_BUNDLE_VERSION = 1;

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(data, type) {
  if (typeof data !== 'string' || data.length > 400_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new TypeError('Attachment data must be valid base64');
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function writeAttachmentBundle(records) {
  const files = [];
  for (const value of records) {
    const record = normalizeAttachment(value);
    files.push({
      id: record.id,
      name: record.name,
      type: record.type,
      size: record.size,
      'created-at': record['created-at'],
      data: await blobToBase64(record.blob),
    });
  }
  return JSON.stringify({ 'schema-version': ATTACHMENT_BUNDLE_VERSION, files }, null, 2);
}

export async function parseAttachmentBundle(source) {
  let value;
  try { value = JSON.parse(source); } catch { throw new TypeError('Attachment bundle must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Attachment bundle must be an object');
  if (value['schema-version'] !== ATTACHMENT_BUNDLE_VERSION) throw new TypeError('Unsupported attachment bundle schema version');
  if (!Array.isArray(value.files) || value.files.length > 10_000) throw new TypeError('Attachment bundle files must be a bounded array');
  const ids = new Set(), records = [];
  for (const file of value.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new TypeError('Attachment bundle entry must be an object');
    const blob = base64ToBlob(file.data, file.type);
    const record = normalizeAttachment({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      blob,
      'created-at': file['created-at'],
    });
    if (ids.has(record.id)) throw new TypeError(`Duplicate attachment ID: ${record.id}`);
    ids.add(record.id);
    records.push(record);
  }
  return records;
}
