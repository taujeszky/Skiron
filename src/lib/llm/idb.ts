/**
 * The one IndexedDB database this app opens, and the two stores in it.
 *
 * Extracted from `skinStore.ts` when wave 7 needed a second store, because
 * the shape it had was a trap with two jaws and both of them are silent:
 *
 * - **The version.** `onupgradeneeded` fires only when the version rises. A
 *   second store added without bumping `DB_VERSION` is never created for
 *   anybody who has opened the app before — which is everybody with a saved
 *   case, and nobody running the tests.
 * - **The store name.** `run()` used to hard-code `"skins"` inside
 *   `db.transaction(...)`, so a call meant for the art store would have read
 *   and written skins. Not an error; just the wrong data, forever.
 *
 * Both are closed by there being exactly one list of stores and one `run`
 * that is told which to use. Adding a third store means adding it to `STORES`
 * and bumping `DB_VERSION` in the same edit, and the two live on adjacent
 * lines so that is hard to half-do.
 */

const DB_NAME = "skiron";

/**
 * Bumped from 1 when wave 7 added `art`.
 *
 * Raise this whenever `STORES` grows. An existing database at a lower version
 * gets `onupgradeneeded` and the missing stores; one at a *higher* version
 * (a browser that has run a newer build) refuses to open, and every caller
 * here treats that as "no storage", which degrades to a case with no pictures
 * rather than to a crash.
 */
export const DB_VERSION = 2;

export const STORES = ["skins", "art"] as const;
export type StoreName = (typeof STORES)[number];

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Every store, not just the new one: a database created at version 2
      // has never had `skins` either.
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb refused to open"));
  });
}

export function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = work(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb refused"));
        transaction.oncomplete = () => db.close();
      }),
  );
}
