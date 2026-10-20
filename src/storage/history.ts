import type { SetRecord } from '../engine/summary';

// Workout history in IndexedDB: stays in this browser on this computer, never uploaded.

const DB_NAME = 'formcoach';
const STORE = 'sets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Could not open history storage'));
    };
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('History update was cancelled'));
  });
}

export async function saveSet(rec: SetRecord): Promise<void> {
  await run('readwrite', (s) => s.put(rec));
}

/** All sets, newest first. */
export async function listSets(): Promise<SetRecord[]> {
  const all = await run<SetRecord[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function deleteSet(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

export async function clearSets(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}
