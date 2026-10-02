export type OfflineEntry = {
  id: string;
  companyId: number;
  companyName: string;
  kind: "production" | "breakdown";
  createdAt: string;
  data: Record<string, string | number>;
};

const DB_NAME = "tmm-offline-v1";
const STORE = "entries";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function operation<T>(mode: IDBTransactionMode, perform: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = perform(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const listOfflineEntries = () => operation<OfflineEntry[]>("readonly", store => store.getAll());
export const saveOfflineEntry = (entry: OfflineEntry) => operation<IDBValidKey>("readwrite", store => store.put(entry));
export const removeOfflineEntry = (id: string) => operation<undefined>("readwrite", store => store.delete(id));
