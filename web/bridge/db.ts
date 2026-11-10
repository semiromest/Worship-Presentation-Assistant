// Small IndexedDB wrapper shared by the web bridge. The service worker opens the
// same database with the same version/upgrade (see public/sw.js); keep them in sync.
export const DB_NAME = 'wpa-web';
export const DB_VERSION = 1;
export const KV = 'kv';
export const MEDIA = 'media';

export interface MediaRecord {
  /** `<sha256>.<ext>`; also the last path segment of the media URL. */
  key: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  addedAt: number;
}

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = body(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

export const kvGet = <T>(key: string) => run<T | undefined>(KV, 'readonly', s => s.get(key));
export const kvSet = (key: string, value: unknown) => run(KV, 'readwrite', s => s.put(value, key)).then(() => undefined);
export const kvDelete = (key: string) => run(KV, 'readwrite', s => s.delete(key)).then(() => undefined);

/** All key/value pairs whose key passes `include` (values of skipped keys are never read). */
export function kvEntries(include: (key: string) => boolean): Promise<[string, unknown][]> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const entries: [string, unknown][] = [];
    const request = db.transaction(KV, 'readonly').objectStore(KV).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(entries); return; }
      const key = String(cursor.key);
      if (include(key)) entries.push([key, cursor.value]);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }));
}

/** Metadata of every stored media file; the Blob handles are not read. */
export const mediaList = () => run<MediaRecord[]>(MEDIA, 'readonly', s => s.getAll());

export function mediaDelete(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MEDIA, 'readwrite');
    const store = tx.objectStore(MEDIA);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

export const mediaGet = (key: string) => run<MediaRecord | undefined>(MEDIA, 'readonly', s => s.get(key));
export const mediaHas = (key: string) => run<number>(MEDIA, 'readonly', s => s.count(key)).then(count => count > 0);
export const mediaPut = (record: MediaRecord) => run(MEDIA, 'readwrite', s => s.put(record)).then(() => undefined);
