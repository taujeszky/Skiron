/**
 * The case ID: a whole puzzle in a dozen characters.
 *
 * `SK1-N-3f9k2a` is codec version 1, the normal preset, seed `3f9k2a`. A case
 * is a pure function of its ID, so the ID is the share link, the bug report
 * and the regression fixture all at once. That is why the string this module
 * hands the RNG is frozen: see `seedFor`.
 */

import type { PresetName } from "./types";

/**
 * Bump this when the ID text, the seed string, the RNG, the generator's
 * iteration order or any generation step changes — anything that makes an old
 * ID rebuild a different case. Old IDs then parse (so the app can say "that
 * case is from an older Skiron") but must not be regenerated as if they were
 * current.
 */
export const CASE_ID_VERSION = 1;

export interface CaseId {
  version: number;
  preset: PresetName;
  /** Lowercase base36, 1-12 characters. */
  seed: string;
}

/**
 * Preset to letter, in one place. Nothing else may spell these out: the
 * letters travel inside every shared ID, so a second copy is a second chance
 * to get them wrong.
 */
export const PRESET_LETTERS: Readonly<Record<PresetName, string>> = {
  easy: "E",
  normal: "N",
  hard: "H",
  expert: "X",
};

/** The inverse of `PRESET_LETTERS`. Case-insensitive; null if unknown. */
export function presetForLetter(letter: string): PresetName | null {
  const want = letter.toUpperCase();
  for (const name of Object.keys(PRESET_LETTERS) as PresetName[]) {
    if (PRESET_LETTERS[name] === want) return name;
  }
  return null;
}

/** Seeds are lowercase base36 and short enough to read aloud. */
const SEED_RE = /^[0-9a-z]{1,12}$/;

/**
 * Uppercased before matching, so parsing is case-insensitive. The version is
 * digits without a leading zero, so `SK01-N-a` is malformed rather than a
 * second spelling of `SK1-N-a`.
 */
const ID_RE = /^SK([1-9][0-9]{0,2})-([A-Z])-([0-9A-Z]{1,12})$/;

/** "SK1-N-3f9k2a" — version, one-letter preset, seed. */
export function formatCaseId(id: CaseId): string {
  const letter = PRESET_LETTERS[id.preset];
  // Throwing here rather than emitting an unparseable string: a bad ID would
  // otherwise only surface as a dead share link on someone else's machine.
  if (letter === undefined) throw new Error(`unknown preset "${id.preset}"`);
  if (!Number.isInteger(id.version) || id.version < 1 || id.version > 999) {
    throw new Error(`case id version ${id.version} is out of range`);
  }
  if (!SEED_RE.test(id.seed)) {
    throw new Error(
      `seed "${id.seed}" is not 1-12 lowercase base36 characters`,
    );
  }
  return `SK${id.version}-${letter}-${id.seed}`;
}

/** null on anything malformed; tolerant of case and surrounding whitespace. */
export function parseCaseId(text: string): CaseId | null {
  const m = ID_RE.exec(text.trim().toUpperCase());
  if (m === null) return null;
  const preset = presetForLetter(m[2]);
  if (preset === null) return null;
  // Any version parses, not just the current one, so that the app can tell a
  // stale ID from a typo.
  return { version: Number(m[1]), preset, seed: m[3].toLowerCase() };
}

/**
 * The RNG seed string for one generation attempt.
 *
 * FROZEN. Every shared ID and every shipped case pack rebuilds itself through
 * this exact string, so changing the shape — the order, the separator, the
 * spelling of the preset — silently turns every old ID into a different case.
 * If it must change, bump `CASE_ID_VERSION` in the same commit. A test pins
 * the string so an accidental edit fails loudly.
 */
export function seedFor(id: CaseId, attempt: number): string {
  return `${id.version}:${id.preset}:${id.seed}:${attempt}`;
}

/**
 * An id at the current version from a seed the caller supplies. It takes the
 * seed rather than inventing one so that `engine/` stays free of entropy —
 * `util/entropy.ts#randomCaseId` is the impure convenience, and it lives
 * outside the engine precisely so the purity test can be absolute.
 */
export function newCaseId(preset: PresetName, seed: string): CaseId {
  return { version: CASE_ID_VERSION, preset, seed };
}
