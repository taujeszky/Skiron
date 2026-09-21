/**
 * Everything that outlives a tab, behind one small module.
 *
 * Two reasons it is a module and not a scatter of `localStorage` calls. The
 * plan wants a Tauri shell to be able to replace the backing store without
 * the game noticing, so there is a `KeyValue` interface and one place that
 * picks an implementation. And `localStorage` throws — Safari in private
 * mode, a browser with site data blocked, a quota that is full — so every
 * call has to be wrapped, and wrapping it once is the only way to be sure.
 *
 * **What is read back is validated, not cast.** A value in a browser's
 * storage was written by whatever version of Skiron that person last ran, and
 * `JSON.parse(...) as Save` would hand the game a save with a notebook of the
 * wrong shape and no symptom until a cell was drawn. The parsers below check
 * the shape they claim, and `storage.test.ts` feeds them corrupt input to
 * prove they can say no — a validator that cannot reject is the wave-3
 * lesson wearing a different hat.
 */

import { MAX_PEOPLE, MAX_ROOMS, MAX_SLOTS } from "$lib/engine/types";
import type { PresetName } from "$lib/engine/types";
import {
  defaultSettings,
  emptyDifficultyStats,
  emptyStats,
} from "./types";
import { IMAGE_QUALITIES } from "$lib/llm/models";
import type { ImageQuality } from "$lib/llm/models";
import type {
  AccusationRecord,
  ChatTurn,
  DifficultyStats,
  NotebookData,
  Save,
  Settings,
  Stats,
  ThemeChoice,
} from "./types";

/* ------------------------------------------------------------- the backend */

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** The prefix every key carries, so the app shares an origin politely. */
const PREFIX = "skiron:";

export const KEYS = {
  settings: `${PREFIX}settings`,
  stats: `${PREFIX}stats`,
  save: `${PREFIX}save`,
  /**
   * The API key, deliberately NOT a field of `Settings`.
   *
   * Settings are JSON, are written on every toggle, and are the obvious thing
   * to export or paste into a bug report. A key kept in that object would
   * leave with any of them. Its own slot means the only code that can read it
   * is the code that asked for it by name (invariant 9, and `llm/key.ts`).
   */
  key: `${PREFIX}key`,
} as const;

export function memoryStore(): KeyValue {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

/**
 * `localStorage`, or null where there isn't one.
 *
 * The write probe is deliberate: a browser can expose `localStorage` and
 * throw on every `setItem`, and finding that out at the first save is finding
 * it out too late to fall back quietly.
 */
export function browserStore(): KeyValue | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = `${PREFIX}probe`;
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          /* full or blocked: the game plays on, it just forgets */
        }
      },
      remove: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          /* as above */
        }
      },
    };
  } catch {
    return null;
  }
}

let backend: KeyValue = memoryStore();
/** True when the picked backend actually outlives the tab. */
let durable = false;

/** Called once at startup, and by tests. Returns whether storage persists. */
export function useStore(store: KeyValue | null): boolean {
  backend = store ?? memoryStore();
  durable = store !== null;
  return durable;
}

export function storageIsDurable(): boolean {
  return durable;
}

/** Pick the real backend. Safe to call in Node, where it picks memory. */
export function initStorage(): boolean {
  return useStore(browserStore());
}

function readRaw(key: string): unknown {
  // The backend's own `get` is wrapped too, but `useStore` takes any
  // implementation — a Tauri store, a test double — and a read that throws
  // must not be the thing that stops the app from starting.
  try {
    const text = backend.get(key);
    if (text === null) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  try {
    backend.set(key, JSON.stringify(value));
  } catch {
    /* a value with a cycle in it is a bug here, not a reason to crash */
  }
}

/* ------------------------------------------------------------ raw strings */

/**
 * Read and write a plain string on the same backend the rest of this module
 * uses, with no JSON layer and no validator.
 *
 * Exists for the API key, which is a string rather than a structure and must
 * not pass through `Settings`. Kept here rather than in `llm/` so that there
 * is still exactly one module in the app that talks to storage.
 */
export function readText(key: string): string | null {
  try {
    return backend.get(key);
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string): void {
  try {
    backend.set(key, value);
  } catch {
    /* a full or locked-down store is not a reason to crash */
  }
}

export function removeText(key: string): void {
  try {
    backend.remove(key);
  } catch {
    /* as above */
  }
}

/* ------------------------------------------------------------- validators */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function int(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi
    ? v
    : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function intArray(v: unknown, lo: number, hi: number, max: number): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: number[] = [];
  for (const item of v) {
    const n = int(item, lo, hi);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function stringArray(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  for (const item of v) if (typeof item !== "string" || item.length > 64) return null;
  return v as string[];
}

const THEMES: readonly ThemeChoice[] = ["light", "dark", "auto"];
/**
 * Imported rather than re-listed, so adding a quality in `models.ts` cannot
 * leave this validator quietly rejecting it — which would read as the setting
 * refusing to save.
 */
const QUALITIES: readonly ImageQuality[] = IMAGE_QUALITIES;
const PRESETS: readonly PresetName[] = ["easy", "normal", "hard", "expert"];

/* -------------------------------------------------------------- settings */

export function parseSettings(v: unknown): Settings {
  const d = defaultSettings();
  if (!isObject(v)) return d;
  const theme = THEMES.find((t) => t === v.theme) ?? d.theme;
  return {
    theme,
    autoNotes: bool(v.autoNotes, d.autoNotes),
    showCanonical: bool(v.showCanonical, d.showCanonical),
    confirmAccusation: bool(v.confirmAccusation, d.confirmAccusation),
    linkScrubber: bool(v.linkScrubber, d.linkScrubber),
    // A save written before wave 7 has no quality at all, and lands on the
    // default — which is `off`, so an upgrade never starts spending.
    imageQuality: QUALITIES.find((q) => q === v.imageQuality) ?? d.imageQuality,
  };
}

/**
 * Settings are the one thing read leniently: an unknown field falls back to
 * its default rather than throwing the lot away, because losing somebody's
 * theme over a field they have never heard of is a worse outcome than
 * carrying a stale flag.
 */
export function loadSettings(): Settings {
  return parseSettings(readRaw(KEYS.settings));
}

export function saveSettings(s: Settings): void {
  writeRaw(KEYS.settings, s);
}

/* ----------------------------------------------------------------- stats */

function parseDifficultyStats(v: unknown): DifficultyStats {
  const d = emptyDifficultyStats();
  if (!isObject(v)) return d;
  const bestMs = int(v.bestMs, 0, Number.MAX_SAFE_INTEGER);
  const bestActions = int(v.bestActions, 0, 100000);
  return {
    started: int(v.started, 0, 1e9) ?? d.started,
    solved: int(v.solved, 0, 1e9) ?? d.solved,
    atPar: int(v.atPar, 0, 1e9) ?? d.atPar,
    bestMs,
    bestActions,
    totalMs: int(v.totalMs, 0, Number.MAX_SAFE_INTEGER) ?? d.totalMs,
    hints: int(v.hints, 0, 1e9) ?? d.hints,
    wrong: int(v.wrong, 0, 1e9) ?? d.wrong,
    streak: int(v.streak, 0, 1e9) ?? d.streak,
    bestStreak: int(v.bestStreak, 0, 1e9) ?? d.bestStreak,
  };
}

export function parseStats(v: unknown): Stats {
  const out = emptyStats();
  if (!isObject(v)) return out;
  for (const name of PRESETS) out[name] = parseDifficultyStats(v[name]);
  return out;
}

export function loadStats(): Stats {
  return parseStats(readRaw(KEYS.stats));
}

export function saveStats(s: Stats): void {
  writeRaw(KEYS.stats, s);
}

/* ------------------------------------------------------------------ save */

/**
 * The one value parsed strictly: a malformed save is discarded, because
 * half-reading one puts the player back into a case with a notebook that
 * does not match the grid they are looking at.
 *
 * It is checked against the engine's own maxima rather than against a live
 * case, because the save is read before the case is rebuilt — the case id is
 * in the save. `controller.ts` checks the notebook's dimensions against the
 * rebuilt frame afterwards, which is the check this one cannot do.
 */
export function parseSave(v: unknown): Save | null {
  if (!isObject(v)) return null;
  if (typeof v.id !== "string" || v.id.length === 0 || v.id.length > 32) return null;

  const notebook = parseNotebook(v.notebook);
  if (notebook === null) return null;

  const collected = stringArray(v.collected, 4096);
  if (collected === null) return null;
  const spent = stringArray(v.spent, 4096);
  if (spent === null) return null;

  const wrong = parseAccusations(v.wrong);
  if (wrong === null) return null;

  const hints = int(v.hints, 0, 1e6);
  const checks = int(v.checks, 0, 1e6);
  const ms = int(v.ms, 0, Number.MAX_SAFE_INTEGER);
  if (hints === null || checks === null || ms === null) return null;

  // The pack name becomes a URL path segment in `packLoader.ts`, so it is
  // checked here rather than trusted: a save is a value a browser hands back,
  // and `/cases/../../something/manifest.json` is the shape of the mistake.
  // Absent, empty or malformed all mean the same thing — a generated case.
  const pack =
    typeof v.pack === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v.pack)
      ? v.pack
      : undefined;

  const save: Save = {
    id: v.id,
    collected,
    spent,
    notebook,
    wrong,
    hints,
    checks,
    ms,
    solved: bool(v.solved, false),
    chat: parseChat(v.chat),
  };
  if (pack !== undefined) save.pack = pack;
  return save;
}

/** A long interrogation, bounded so a corrupt save cannot be a huge one. */
const MAX_CHAT_TURNS = 400;
const MAX_TURN_TEXT = 2000;

/**
 * The transcript, read turn by turn and **never** fatal.
 *
 * Every other field in a save is strict: a malformed one throws the whole
 * save away, because a half-read save puts a player back into a case with a
 * notebook that does not match the grid. The transcript is the one exception,
 * on purpose. It is decoration — the cards are canon and are rebuilt from the
 * ids — and losing somebody's notebook because a line of chat came back
 * wrong would be the validator doing more damage than the corruption.
 *
 * So a bad turn is dropped and the rest is kept, and a save written before
 * wave 6 (with no `chat` at all) reads as an empty transcript rather than as
 * a refusal.
 */
function parseChat(v: unknown): ChatTurn[] {
  if (!Array.isArray(v)) return [];
  const out: ChatTurn[] = [];
  for (const item of v.slice(0, MAX_CHAT_TURNS)) {
    if (!isObject(item)) continue;
    const who = int(item.who, 0, MAX_PEOPLE - 1);
    if (who === null) continue;
    const from = item.from;
    if (from !== "player" && from !== "suspect" && from !== "note") continue;
    const text = item.text;
    if (typeof text !== "string" || text === "" || text.length > MAX_TURN_TEXT) continue;
    const cards = item.cards === undefined ? [] : stringArray(item.cards, 64);
    if (cards === null) continue;
    out.push(cards.length > 0 ? { who, from, text, cards } : { who, from, text });
  }
  return out;
}

function parseNotebook(v: unknown): NotebookData | null {
  if (!isObject(v)) return null;
  if (!Array.isArray(v.ruledOut) || v.ruledOut.length > MAX_PEOPLE) return null;
  const ruledOut: number[][] = [];
  for (const row of v.ruledOut) {
    // A room mask is a non-negative int below 2^MAX_ROOMS. A negative one
    // would be `fullMask` of 32 rooms, which no frame can produce.
    const cells = intArray(row, 0, (1 << MAX_ROOMS) - 1, MAX_SLOTS);
    if (cells === null) return null;
    ruledOut.push(cells);
  }
  const clearedSuspects = int(v.clearedSuspects, 0, (1 << MAX_PEOPLE) - 1);
  const ruledOutSlots = int(v.ruledOutSlots, 0, (1 << MAX_SLOTS) - 1);
  if (clearedSuspects === null || ruledOutSlots === null) return null;
  return { ruledOut, clearedSuspects, ruledOutSlots };
}

function parseAccusations(v: unknown): AccusationRecord[] | null {
  if (!Array.isArray(v) || v.length > 1024) return null;
  const out: AccusationRecord[] = [];
  for (const item of v) {
    if (!isObject(item)) return null;
    const culprit = int(item.culprit, 0, MAX_PEOPLE - 1);
    const slot = int(item.slot, 0, MAX_SLOTS - 1);
    if (culprit === null || slot === null) return null;
    out.push({ culprit, slot });
  }
  return out;
}

export function loadSave(): Save | null {
  return parseSave(readRaw(KEYS.save));
}

export function writeSave(s: Save): void {
  writeRaw(KEYS.save, s);
}

export function clearSave(): void {
  try {
    backend.remove(KEYS.save);
  } catch {
    /* see writeRaw */
  }
}
