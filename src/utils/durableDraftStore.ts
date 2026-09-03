const DURABLE_DRAFT_DB_NAME = "warwick_durable_drafts_v1";
const DURABLE_DRAFT_DB_VERSION = 1;
const DURABLE_DRAFT_STORE = "drafts";
const DURABLE_DRAFT_FALLBACK_PREFIX = "warwick_durable_draft_v1:";

interface DurableDraftRecord<T> {
  key: string;
  value: T;
  updatedAt: string;
  schemaVersion: 1;
}

let databasePromise: Promise<IDBDatabase | null> | null = null;
const writeChains = new Map<string, Promise<void>>();

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
function fallbackStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function fallbackKey(key: string): string {
  return `${DURABLE_DRAFT_FALLBACK_PREFIX}${key}`;
}
async function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") return null;

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DURABLE_DRAFT_DB_NAME, DURABLE_DRAFT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DURABLE_DRAFT_STORE)) {
        database.createObjectStore(DURABLE_DRAFT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}
function buildRecord<T>(key: string, value: T): DurableDraftRecord<T> {
  return {
    key,
    value,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function writeFallbackRecord<T>(record: DurableDraftRecord<T>): void {
  const storage = fallbackStorage();
  if (!storage) throw new Error("No durable browser storage is available for this draft.");
  storage.setItem(fallbackKey(record.key), JSON.stringify(record));
}

async function writeRecord<T>(record: DurableDraftRecord<T>): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    writeFallbackRecord(record);
    return;
  }

  try {
    const transaction = database.transaction(DURABLE_DRAFT_STORE, "readwrite");
    transaction.objectStore(DURABLE_DRAFT_STORE).put(record);
    await transactionDone(transaction);
  } catch (error) {
    try {
      writeFallbackRecord(record);
    } catch {
      throw new Error("Unable to persist draft in browser durable storage.", { cause: error });
    }
  }
}
function enqueueKeyWrite(key: string, write: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  writeChains.set(key, next);
  const cleanup = () => {
    if (writeChains.get(key) === next) writeChains.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

export function saveDurableDraft<T>(key: string, value: T): Promise<void> {
  return enqueueKeyWrite(key, () => writeRecord(buildRecord(key, value)));
}

function parseFallbackRecord<T>(key: string): DurableDraftRecord<T> | null {
  const storage = fallbackStorage();
  const raw = storage?.getItem(fallbackKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DurableDraftRecord<T>;
    return parsed?.key === key && parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}
function isNewerRecord<T>(
  candidate: DurableDraftRecord<T>,
  current: DurableDraftRecord<T> | undefined
): boolean {
  return current === undefined || candidate.updatedAt >= current.updatedAt;
}

export async function listDurableDrafts<T>(
  prefix: string
): Promise<Array<{ key: string; value: T }>> {
  // IndexedDB and the synchronous fallback can both contain a record for the
  // same key after an interrupted/failing IndexedDB write. Choose by the
  // record timestamp instead of letting whichever store is read first win.
  const records = new Map<string, DurableDraftRecord<T>>();
  const consider = (record: DurableDraftRecord<T> | null | undefined): void => {
    if (
      !record ||
      record.schemaVersion !== 1 ||
      typeof record.key !== "string" ||
      !record.key.startsWith(prefix)
    ) {
      return;
    }
    if (isNewerRecord(record, records.get(record.key))) {
      records.set(record.key, record);
    }
  };

  const database = await openDatabase();
  if (database) {
    try {
      const transaction = database.transaction(DURABLE_DRAFT_STORE, "readonly");
      const request = transaction.objectStore(DURABLE_DRAFT_STORE).getAll();
      const stored = (await requestToPromise(request)) as Array<DurableDraftRecord<T>>;
      await transactionDone(transaction);
      for (const record of stored) consider(record);
    } catch {
      // Compatibility fallback below remains available when IndexedDB is unavailable.
    }
  }

  const storage = fallbackStorage();
  if (storage) {
    for (let index = 0; index < storage.length; index += 1) {
      const storageKey = storage.key(index);
      if (!storageKey?.startsWith(DURABLE_DRAFT_FALLBACK_PREFIX)) continue;
      const key = storageKey.slice(DURABLE_DRAFT_FALLBACK_PREFIX.length);
      if (!key.startsWith(prefix)) continue;
      consider(parseFallbackRecord<T>(key));
    }
  }

  return [...records.values()].map((record) => ({ key: record.key, value: record.value }));
}

export async function loadDurableDraft<T>(key: string): Promise<T | null> {
  await writeChains.get(key)?.catch(() => undefined);
  const database = await openDatabase();
  let indexedRecord: DurableDraftRecord<T> | undefined;
  if (database) {
    try {
      const transaction = database.transaction(DURABLE_DRAFT_STORE, "readonly");
      const request = transaction.objectStore(DURABLE_DRAFT_STORE).get(key);
      const record = (await requestToPromise(request)) as DurableDraftRecord<T> | undefined;
      await transactionDone(transaction);
      if (record?.schemaVersion === 1) indexedRecord = record;
    } catch {
      // Compatibility fallback below remains durable and explicit.
    }
  }

  const fallback = parseFallbackRecord<T>(key);
  const record = fallback && isNewerRecord(fallback, indexedRecord) ? fallback : indexedRecord;
  if (!record) return null;

  if (database && fallback && record === fallback) {
    await writeRecord(fallback);
    try {
      fallbackStorage()?.removeItem(fallbackKey(key));
    } catch {
      // The IndexedDB copy is already durable; cleanup can be retried later.
    }
  }
  return record.value;
}
async function clearRecord(key: string): Promise<void> {
  const database = await openDatabase();
  let indexedDbCleared = false;
  if (database) {
    try {
      const transaction = database.transaction(DURABLE_DRAFT_STORE, "readwrite");
      transaction.objectStore(DURABLE_DRAFT_STORE).delete(key);
      await transactionDone(transaction);
      indexedDbCleared = true;
    } catch {
      indexedDbCleared = false;
    }
  }

  const storage = fallbackStorage();
  try {
    storage?.removeItem(fallbackKey(key));
  } catch (error) {
    if (!indexedDbCleared) {
      throw new Error("Unable to clear durable draft after server acknowledgement.", {
        cause: error,
      });
    }
  }
  if (!indexedDbCleared && !storage) {
    throw new Error("Unable to clear durable draft after server acknowledgement.");
  }
}

export function clearDurableDraft(key: string): Promise<void> {
  return enqueueKeyWrite(key, () => clearRecord(key));
}
