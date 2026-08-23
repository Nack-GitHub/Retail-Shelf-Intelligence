"use client";

/* The offline queue.
 *
 * Reps work in shops with concrete walls and no signal. Anything they do
 * there has to survive being closed, backgrounded, or losing the tab — which
 * rules out memory and rules out sessionStorage for a 2 MB photo. IndexedDB
 * is the only browser store that takes Blobs.
 *
 * Written by hand rather than pulled from npm: it is one object store and
 * four operations, and the dependency would be larger than the code.
 *
 * Every operation carries the Idempotency-Key it will be replayed with, so a
 * drain interrupted halfway and restarted cannot double-count a capture. */

const DB_NAME = "shelfeye";
const DB_VERSION = 1;
const STORE = "queue";

export type QueueKind = "CAPTURE" | "VERIFY" | "TASK" | "CHECKOUT";
export type QueueStatus = "PENDING" | "UPLOADING" | "FAILED" | "DONE";

export interface QueuedOperation {
  /** doubles as the Idempotency-Key sent to the server */
  id: string;
  kind: QueueKind;
  /** what the user will see in the sync list */
  label: string;
  /** resolved to a name by the sync screen, which already loads the route */
  storeId: string;
  /** JSON payload for the endpoint this replays */
  payload: Record<string, unknown>;
  /** the photo itself, for CAPTURE operations */
  blob?: Blob;
  queuedAt: string;
  attempts: number;
  status: QueueStatus;
  errorCode?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function enqueue(
  operation: Omit<QueuedOperation, "queuedAt" | "attempts" | "status">,
): Promise<QueuedOperation> {
  const record: QueuedOperation = {
    ...operation,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    status: "PENDING",
  };
  await tx("readwrite", (store) => store.put(record));
  return record;
}

export function list(): Promise<QueuedOperation[]> {
  return tx<QueuedOperation[]>("readonly", (store) => store.getAll()).then((rows) =>
    rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
  );
}

export async function update(id: string, patch: Partial<QueuedOperation>): Promise<void> {
  const existing = await tx<QueuedOperation | undefined>("readonly", (store) => store.get(id));
  if (!existing) return;
  await tx("readwrite", (store) => store.put({ ...existing, ...patch }));
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

/** Is IndexedDB usable at all?
 *
 *  Private browsing in some browsers exposes the API and then fails on open.
 *  Callers fall back to sending immediately rather than pretending to queue —
 *  a queue that silently drops a rep's work is worse than no queue. */
export async function isAvailable(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    (await open()).close();
    return true;
  } catch {
    return false;
  }
}
