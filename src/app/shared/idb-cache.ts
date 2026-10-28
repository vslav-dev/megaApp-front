import { isStaleCacheKey, isUserScopedCacheKey } from '@app/shared/cache';
import { DIARY_DAYS_STORE_NAME, IDB_STORE_SCHEMA_CHECKPOINTS, METRIC_SERIES_STORE_NAME } from '@app/shared/const';

const DB_NAME = 'megaapp-idb-cache';
const DB_VERSION = 3;
const STORE_NAME = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }

      for (const [storeName, checkpoint] of Object.entries(IDB_STORE_SCHEMA_CHECKPOINTS)) {
        if (oldVersion >= checkpoint) continue;
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error(`Error reading from IndexedDB for key "${key}":`, error);
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error(`Error writing to IndexedDB for key "${key}":`, error);
  }
}

export async function idbRemove(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error(`Error removing from IndexedDB for key "${key}":`, error);
  }
}

async function collectKvKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error listing IndexedDB kv keys:', error);
    return [];
  }
}

async function removeKvKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('Error removing IndexedDB kv keys:', error);
  }
}

// Mirrors purgeStaleCacheVersions() (cache.ts) for the kv store — same registry, same staleness
// rule, just scanned via a key cursor instead of Object.keys(localStorage).
export async function idbPurgeStaleKvEntries(): Promise<void> {
  const keys = await collectKvKeys();
  await removeKvKeys(keys.filter(isStaleCacheKey));
}

// Mirrors clearAllUserScopedCaches() (cache.ts) for the kv store — called on logout.
export async function idbClearAllUserScopedKvEntries(): Promise<void> {
  const keys = await collectKvKeys();
  await removeKvKeys(keys.filter(isUserScopedCacheKey));
}

// Separate store, keyed directly by dateISO (lexicographically sortable) — unlike the single
// blob per key in `kv`, one row per day, so a single day's write never touches any other day,
// and a date range can be read with a native IDBKeyRange.bound cursor scan.

export async function idbSetDay<T>(dateISO: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIARY_DAYS_STORE_NAME, 'readwrite');
      tx.objectStore(DIARY_DAYS_STORE_NAME).put(value, dateISO);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error(`Error writing diary day "${dateISO}" to IndexedDB:`, error);
  }
}

export async function idbGetDay<T>(dateISO: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(DIARY_DAYS_STORE_NAME, 'readonly');
      const request = tx.objectStore(DIARY_DAYS_STORE_NAME).get(dateISO);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error(`Error reading diary day "${dateISO}" from IndexedDB:`, error);
    return null;
  }
}

export async function idbClearDays(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIARY_DAYS_STORE_NAME, 'readwrite');
      tx.objectStore(DIARY_DAYS_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('Error clearing diary days from IndexedDB:', error);
  }
}

// Another dedicated store, one record per metric series — keyed by the same
// "granularity:service:name" string metrics.service.ts already uses in memory
// (see MetricsService.seriesKey). Unlike foodDiaryDays, this key carries no
// business meaning of its own, so it's free-form on our side.

export async function idbSetMetricSeries<T>(seriesKey: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(METRIC_SERIES_STORE_NAME, 'readwrite');
      tx.objectStore(METRIC_SERIES_STORE_NAME).put(value, seriesKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error(`Error writing metric series "${seriesKey}" to IndexedDB:`, error);
  }
}

export async function idbGetAllMetricSeries<T>(): Promise<T[]> {
  try {
    const db = await openDb();
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(METRIC_SERIES_STORE_NAME, 'readonly');
      const request = tx.objectStore(METRIC_SERIES_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error reading metric series from IndexedDB:', error);
    return [];
  }
}

export async function idbClearMetricSeries(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(METRIC_SERIES_STORE_NAME, 'readwrite');
      tx.objectStore(METRIC_SERIES_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('Error clearing metric series from IndexedDB:', error);
  }
}
