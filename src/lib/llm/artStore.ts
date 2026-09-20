/**
 * Where a case's pictures are kept between sittings.
 *
 * `skinStore.ts`'s sibling, and the same argument: a skin is kilobytes and
 * localStorage would groan, and an image is a hundred times that again, so it
 * is not even a question. Blobs go in IndexedDB, keyed `<case id>:<subject>`.
 *
 * **What is stored is bytes and a MIME type, not a URL.** An object URL is
 * alive only as long as the document that made it, so storing one would
 * produce a case whose portraits worked until reload and then quietly showed
 * nothing. `imageUrl` mints one on the way out and `releaseUrl` hands it back,
 * and the controller is the only thing that calls either.
 *
 * Reads are validated like everything else off disk. A half-written record
 * degrades to "no picture", which is a monogram — the state every case was in
 * through wave 6, and a perfectly good one.
 */

import { hasIndexedDb, run } from "./idb";
import type { ImageResult } from "./provider";

const STORE = "art";

/** What an image costs at 2K before WebP; a sanity bound, not a policy. */
const MAX_BYTES = 8 * 1024 * 1024;

export interface StoredImage {
  mime: string;
  bytes: Uint8Array;
}

export interface ArtStore {
  get(id: string, key: string): Promise<StoredImage | null>;
  put(id: string, key: string, image: ImageResult): Promise<void>;
  /** Every subject stored for this case, so a resume knows what to skip. */
  keys(id: string): Promise<string[]>;
  removeCase(id: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The storage key.
 *
 * A case id contains no colon — `caseId.ts` formats it as
 * `SK1-<preset>-<seed>` — so the split is unambiguous and `keys` can filter by
 * prefix without a second index.
 */
export function artKey(id: string, key: string): string {
  return `${id}:${key}`;
}

export function parseImage(value: unknown): StoredImage | null {
  if (typeof value !== "object" || value === null) return null;
  const bag = value as Record<string, unknown>;
  const mime = typeof bag.mime === "string" ? bag.mime : "";
  if (!/^image\/[\w.+-]+$/.test(mime)) return null;

  const raw = bag.bytes;
  // Structured clone preserves a `Uint8Array`, but a record written by an
  // older build, or hand-edited, could be an ArrayBuffer or an array.
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : null;
  if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  return { mime, bytes };
}

/* --------------------------------------------------------------- backends */

export function memoryArt(): ArtStore {
  const map = new Map<string, StoredImage>();
  return {
    get: async (id, key) => map.get(artKey(id, key)) ?? null,
    put: async (id, key, image) =>
      void map.set(artKey(id, key), { mime: image.mime, bytes: image.bytes }),
    keys: async (id) =>
      [...map.keys()].filter((k) => k.startsWith(`${id}:`)).map((k) => k.slice(id.length + 1)),
    removeCase: async (id) => {
      for (const k of [...map.keys()]) if (k.startsWith(`${id}:`)) map.delete(k);
    },
    clear: async () => void map.clear(),
  };
}

export function indexedDbArt(): ArtStore | null {
  if (!hasIndexedDb()) return null;
  return {
    async get(id, key) {
      try {
        return parseImage(await run<unknown>(STORE, "readonly", (s) => s.get(artKey(id, key))));
      } catch {
        return null;
      }
    },
    async put(id, key, image) {
      try {
        await run(STORE, "readwrite", (s) =>
          s.put({ mime: image.mime, bytes: image.bytes }, artKey(id, key)),
        );
      } catch {
        // A full quota is the likeliest failure here by some distance, and it
        // must cost a picture and nothing else.
      }
    },
    async keys(id) {
      try {
        const all = await run<IDBValidKey[]>(STORE, "readonly", (s) => s.getAllKeys());
        return all
          .map(String)
          .filter((k) => k.startsWith(`${id}:`))
          .map((k) => k.slice(id.length + 1));
      } catch {
        return [];
      }
    },
    async removeCase(id) {
      try {
        const all = await run<IDBValidKey[]>(STORE, "readonly", (s) => s.getAllKeys());
        for (const k of all.map(String)) {
          if (k.startsWith(`${id}:`)) await run(STORE, "readwrite", (s) => s.delete(k));
        }
      } catch {
        /* as above */
      }
    },
    async clear() {
      try {
        await run(STORE, "readwrite", (s) => s.clear());
      } catch {
        /* as above */
      }
    },
  };
}

/* ------------------------------------------------------------ object URLs */

/**
 * A URL the browser can put in an `<img>`, or null where there is no DOM.
 *
 * Null rather than a data URI on purpose: a data URI of a megabyte of PNG in
 * a Svelte prop is re-parsed on every render, and the tests run in Node where
 * neither exists. The caller shows a monogram when this is null, which is the
 * same branch it takes before the image has arrived.
 */
export function imageUrl(image: StoredImage): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  if (typeof Blob === "undefined") return null;
  // A fresh copy: the stored array is backed by the record IndexedDB handed
  // back, and `Blob` keeping a reference into it is not something to rely on.
  return URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mime }));
}

export function releaseUrl(url: string | null | undefined): void {
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

/* ---------------------------------------------------------- the singleton */

let store: ArtStore = memoryArt();

/** Called at startup, and by tests. */
export function useArt(next: ArtStore | null): void {
  store = next ?? memoryArt();
}

export function initArt(): void {
  useArt(indexedDbArt());
}

export function art(): ArtStore {
  return store;
}
