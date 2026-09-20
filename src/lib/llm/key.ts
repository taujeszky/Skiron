/**
 * Where the browser's API key comes from, and the only place that knows.
 *
 * Invariant 9 says the key never enters a file, a URL or a log. What it may
 * enter is this machine's `localStorage`, which is what the plan asks for and
 * what makes the app usable without a backend: the alternative, Ascendant's
 * in-memory-only key, means re-pasting it on every reload, and a player who
 * has to do that stops using the feature.
 *
 * Three rules hold the invariant up:
 *
 * 1. The key lives under its own storage slot, never inside `Settings`. A
 *    settings object gets exported, copied into bug reports and written on
 *    every toggle; a key in it leaves with all of that.
 * 2. `.env.local` is read **only in development**. Vite inlines `VITE_*` into
 *    the bundle at build time, so a key present in a production build
 *    environment would ship inside the JavaScript every visitor downloads.
 *    Ascendant's `useGame.ts` carries the same guard and the same comment; it
 *    is the sharpest edge in this file.
 * 3. Nothing here returns the key to anything but a `KeySource` handed
 *    straight to a provider at call time.
 */

import { KEYS, readText, removeText, writeText } from "../game/storage";
import { type KeySource, looksLikeKey } from "./provider";

/**
 * The key from `.env.local`, in development only.
 *
 * Wrapped because `import.meta.env` is a Vite construct: the authoring CLI
 * runs under vite-node and has it, but a plain `node` context would not, and
 * this must degrade to "no key" rather than to a crash at import time.
 */
function envKey(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (!env || env.DEV !== true) return null;
    const value = env.VITE_GEMINI_API_KEY;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  } catch {
    return null;
  }
}

/** The key this browser has been given, if any. */
export function storedKey(): string | null {
  const value = readText(KEYS.key);
  return value !== null && value.trim() !== "" ? value.trim() : null;
}

/**
 * Keep a key, having checked it is shaped like one.
 *
 * Returns false for anything that is not, so the settings screen can say so
 * instead of storing a typo that fails as a 403 an hour later.
 */
export function storeKey(value: string): boolean {
  const trimmed = value.trim();
  if (!looksLikeKey(trimmed)) return false;
  writeText(KEYS.key, trimmed);
  return true;
}

export function forgetKey(): void {
  removeText(KEYS.key);
}

/** Is there a key to use? Drives whether the setting box appears at all. */
export function hasKey(): boolean {
  return storedKey() !== null || envKey() !== null;
}

/**
 * The source handed to a provider.
 *
 * A function, not a value: it is called at the moment of the request, so
 * pasting a key takes effect at once, forgetting one takes effect at once,
 * and nothing between here and the wire holds a copy.
 *
 * The stored key wins over the development one, so that testing what a player
 * would experience does not silently use the developer's key.
 */
export function browserKey(): KeySource {
  return () => storedKey() ?? envKey();
}

/**
 * The sentence shown beside the input. Stated plainly because "no backend"
 * cuts both ways: nothing of the player's reaches us, and nothing protects
 * the key but this machine.
 */
export const KEY_NOTICE =
  "Kept on this machine and sent straight from your browser to Google. " +
  "Skiron has no server, so it never passes through anything of ours.";
