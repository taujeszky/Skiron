/**
 * Where a written case is kept between sittings.
 *
 * A skin is a few kilobytes of prose per case and a player may collect
 * dozens, which is more than `localStorage` should be asked to hold beside
 * the save and the settings. So: IndexedDB, keyed by the formatted case id.
 *
 * **Why this is a second module and not a wider `KeyValue`.** `game/storage.ts`
 * is synchronous on purpose — the settings path, the save path and the stats
 * path all read during startup and during a keystroke, and making them async
 * would spread `await` through the controller for the sake of one feature
 * that can perfectly well be slow. So this has the same shape and its own
 * promise-returning methods, and a Tauri shell later swaps this one file.
 *
 * Everything read back is validated. A skin comes off disk as JSON that some
 * earlier version of this code wrote, and a half-valid one must degrade to
 * "no skin" — the engine's own sentences — rather than to a crash or to a
 * card that says "was in undefined at nine".
 */

import type { CaseSkin, SkinFidelity, SkinPerson, SkinRoom } from "./skin/schema";
import { SKIN_SCHEMA_VERSION } from "./skin/schema";

export interface SkinSummary {
  id: string;
  title: string;
  setting: string;
  language: string;
}

export interface SkinStore {
  get(id: string): Promise<CaseSkin | null>;
  put(id: string, skin: CaseSkin): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<SkinSummary[]>;
  clear(): Promise<void>;
}

const DB_NAME = "skiron";
const DB_VERSION = 1;
const STORE = "skins";

/* ------------------------------------------------------------ validation */

function str(value: unknown, max = 4000): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function strArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const item of value) {
    const text = str(item);
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

function rooms(value: unknown): SkinRoom[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const out: SkinRoom[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const name = str(item.name, 200);
    const code = str(item.code, 8);
    if (name === null || code === null) return null;
    out.push({ name, code, description: str(item.description) ?? "" });
  }
  return out;
}

function people(value: unknown): SkinPerson[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const out: SkinPerson[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const name = str(item.name, 200);
    if (name === null) return null;
    out.push({
      name,
      role: str(item.role) ?? "",
      bio: str(item.bio) ?? "",
      voice: str(item.voice) ?? "",
      motive: str(item.motive) ?? "",
      portrait: str(item.portrait) ?? "",
    });
  }
  return out;
}

function prose(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(value as Record<string, unknown>)) {
    if (!/^c\d+$/.test(id)) return null;
    const body = str(text, 4000);
    if (body === null) return null;
    out[id] = body;
  }
  return out;
}

function fidelity(value: unknown): SkinFidelity {
  const empty: SkinFidelity = { checked: 0, verified: 0, retried: 0, fallback: [] };
  if (typeof value !== "object" || value === null) return empty;
  const item = value as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    checked: count(item.checked),
    verified: count(item.verified),
    retried: count(item.retried),
    fallback: strArray(item.fallback, 4000) ?? [],
  };
}

/**
 * Read a stored skin, or refuse it.
 *
 * Refusal is not a failure: a case with no skin is a case in the engine's own
 * words, which is the state the whole game shipped in at the end of wave 4.
 */
export function parseSkin(value: unknown): CaseSkin | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const bag = value as Record<string, unknown>;

  // A skin written by a newer version may have fields this code cannot honour.
  // An older one is the same problem in reverse. Neither is worth guessing at.
  if (bag.schemaVersion !== SKIN_SCHEMA_VERSION) return null;

  const skinRooms = rooms(bag.rooms);
  const skinPeople = people(bag.people);
  const slots = strArray(bag.slots, 32);
  const written = prose(bag.prose);
  const title = str(bag.title, 200);
  if (!skinRooms || !skinPeople || !slots || !written || title === null) return null;

  return {
    schemaVersion: SKIN_SCHEMA_VERSION,
    language: str(bag.language, 16) ?? "en",
    setting: str(bag.setting, 500) ?? "",
    title,
    place: str(bag.place, 300) ?? "",
    era: str(bag.era, 200) ?? "",
    styleGuide: str(bag.styleGuide) ?? "",
    rooms: skinRooms,
    slots,
    people: skinPeople,
    prose: written,
    silence: strArray(bag.silence, 16) ?? [],
    briefing: str(bag.briefing, 4000) ?? "",
    scene: str(bag.scene) ?? "",
    summingUp: str(bag.summingUp, 8000),
    fidelity: fidelity(bag.fidelity),
  };
}

/* --------------------------------------------------------------- backends */

export function memorySkins(): SkinStore {
  const map = new Map<string, CaseSkin>();
  return {
    get: async (id) => map.get(id) ?? null,
    put: async (id, skin) => void map.set(id, skin),
    remove: async (id) => void map.delete(id),
    list: async () =>
      [...map.entries()].map(([id, skin]) => ({
        id,
        title: skin.title,
        setting: skin.setting,
        language: skin.language,
      })),
    clear: async () => void map.clear(),
  };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb refused to open"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb refused"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function indexedDbSkins(): SkinStore | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async get(id) {
      try {
        return parseSkin(await run<unknown>("readonly", (store) => store.get(id)));
      } catch {
        return null;
      }
    },
    async put(id, skin) {
      try {
        // Structured clone handles the object; a skin is plain data by design.
        await run("readwrite", (store) => store.put(skin, id));
      } catch {
        /* a full or blocked database is not a reason to lose the case */
      }
    },
    async remove(id) {
      try {
        await run("readwrite", (store) => store.delete(id));
      } catch {
        /* as above */
      }
    },
    async list() {
      try {
        const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
        const values = await run<unknown[]>("readonly", (store) => store.getAll());
        const out: SkinSummary[] = [];
        keys.forEach((key, i) => {
          const skin = parseSkin(values[i]);
          if (skin) {
            out.push({
              id: String(key),
              title: skin.title,
              setting: skin.setting,
              language: skin.language,
            });
          }
        });
        return out;
      } catch {
        return [];
      }
    },
    async clear() {
      try {
        await run("readwrite", (store) => store.clear());
      } catch {
        /* as above */
      }
    },
  };
}

/* ---------------------------------------------------------- the singleton */

let store: SkinStore = memorySkins();

/** Called at startup, and by tests. */
export function useSkins(next: SkinStore | null): void {
  store = next ?? memorySkins();
}

export function initSkins(): void {
  useSkins(indexedDbSkins());
}

export function skins(): SkinStore {
  return store;
}
