/** IndexedDB-backed attachment metadata and blobs used by Loom item references. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTACHMENT_KEYS = new Set(['id', 'name', 'type', 'size', 'blob', 'created-at']);
const ATTACHMENT_DB = 'loom';
const ATTACHMENT_STORE = 'attachments';

function isBlob(value) {
  return value && typeof value === 'object' && typeof value.arrayBuffer === 'function'
    && typeof value.size === 'number' && typeof value.type === 'string';
}

function safeFilename(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255
    && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

export function normalizeAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Attachment must be a map');
  for (const key of Object.keys(value)) if (!ATTACHMENT_KEYS.has(key)) throw new TypeError(`Attachment has an unknown field: ${key}`);
  if (typeof value.id !== 'string' || !UUID.test(value.id)) throw new TypeError('Attachment ID must be a UUID string');
  if (!safeFilename(value.name)) throw new TypeError('Attachment name must be a safe nonempty filename');
  if (typeof value.type !== 'string' || value.type.length > 255 || /[\u0000-\u001f\u007f]/.test(value.type)) {
    throw new TypeError('Attachment type must be a valid MIME type');
  }
  if (!isBlob(value.blob)) throw new TypeError('Attachment blob must be a Blob');
  if (!Number.isInteger(value.size) || value.size < 0 || value.size !== value.blob.size) {
    throw new TypeError('Attachment size must match its blob');
  }
  if (typeof value['created-at'] !== 'string' || !Number.isFinite(Date.parse(value['created-at']))
    || new Date(value['created-at']).toISOString() !== value['created-at']) {
    throw new TypeError('Attachment created-at must be a UTC ISO timestamp');
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type || 'application/octet-stream',
    size: value.size,
    blob: value.blob,
    'created-at': value['created-at'],
  };
}

export function createAttachmentRecord(file, { id, now = new Date().toISOString() } = {}) {
  if (!isBlob(file)) throw new TypeError('Attachment source must be a File or Blob');
  const name = typeof file.name === 'string' && file.name.trim() ? file.name : 'attachment';
  return normalizeAttachment({ id, name, type: file.type || 'application/octet-stream', size: file.size, blob: file, 'created-at': now });
}

export function isImageAttachment(attachment) {
  return typeof attachment?.type === 'string' && attachment.type.toLocaleLowerCase().startsWith('image/');
}

export function attachmentReference(id, { image = false } = {}) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('Attachment ID must be a UUID string');
  return `${image ? '!' : ''}[[file:${id}]]`;
}

function cloneAttachment(record) { return { ...record }; }

export function createMemoryAttachmentStore(initial = []) {
  const values = new Map();
  const store = {
    persistent: false,
    async put(value) {
      const record = normalizeAttachment(value);
      values.set(record.id, record);
      return cloneAttachment(record);
    },
    async list() { return [...values.values()].map(cloneAttachment); },
    async delete(id) {
      if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('Attachment ID must be a UUID string');
      values.delete(id);
    },
    async importMany(records) {
      const normalized = records.map(normalizeAttachment);
      for (const record of normalized) values.set(record.id, record);
      return normalized.length;
    },
  };
  for (const record of initial) values.set(record.id, normalizeAttachment(record));
  return store;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

export function createIndexedDBAttachmentStore(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new TypeError('IndexedDB is unavailable');
  let databasePromise;
  const database = () => {
    databasePromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(ATTACHMENT_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open the Loom attachment database'));
      request.onblocked = () => reject(new Error('The Loom attachment database is blocked by another tab'));
    });
    return databasePromise;
  };

  async function transaction(mode, action) {
    const db = await database();
    const tx = db.transaction(ATTACHMENT_STORE, mode);
    const done = transactionDone(tx);
    const request = action(tx.objectStore(ATTACHMENT_STORE));
    const value = request ? await requestResult(request) : undefined;
    await done;
    return value;
  }

  return {
    persistent: true,
    async put(value) {
      const record = normalizeAttachment(value);
      await transaction('readwrite', store => store.put(record));
      return cloneAttachment(record);
    },
    async list() {
      const records = await transaction('readonly', store => store.getAll());
      return records.map(normalizeAttachment).map(cloneAttachment);
    },
    async delete(id) {
      if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('Attachment ID must be a UUID string');
      await transaction('readwrite', store => store.delete(id));
    },
    async importMany(records) {
      const normalized = records.map(normalizeAttachment);
      await transaction('readwrite', store => { for (const record of normalized) store.put(record); });
      return normalized.length;
    },
  };
}

export function createAttachmentStore({ indexedDB = null } = {}) {
  return indexedDB && typeof indexedDB.open === 'function'
    ? createIndexedDBAttachmentStore(indexedDB)
    : createMemoryAttachmentStore();
}
