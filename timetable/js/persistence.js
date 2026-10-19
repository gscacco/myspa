const DATABASE_NAME = 'chronos-timetable';
const DATABASE_VERSION = 1;
const STORE_NAME = 'workspace';
const TIMETABLE_KEY = 'current';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Salvataggio locale non riuscito.'));
  });
}

/** IndexedDB persistence for the current school timetable. */
export function createTimetablePersistence(indexedDB = globalThis.indexedDB) {
  if (!indexedDB?.open) return {
    available: false,
    async load() { return null; },
    async save() { return false; },
  };

  let databasePromise;
  const database = () => {
    databasePromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Archivio locale non disponibile.'));
      request.onblocked = () => reject(new Error('Chiudi le altre schede dell’app per aggiornare l’archivio locale.'));
    });
    return databasePromise;
  };

  return {
    available: true,
    async load() {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      return requestResult(transaction.objectStore(STORE_NAME).get(TIMETABLE_KEY));
    },
    async save(timetable) {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const result = requestResult(transaction.objectStore(STORE_NAME).put(structuredClone(timetable), TIMETABLE_KEY));
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('Salvataggio locale non riuscito.'));
        transaction.onabort = () => reject(transaction.error || new Error('Salvataggio locale annullato.'));
      });
      await result;
      return true;
    },
  };
}
