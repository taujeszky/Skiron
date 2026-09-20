/**
 * The small decisions every component would otherwise make for itself.
 *
 * Colour is the one worth spelling out. `app.css` carries an ordered palette
 * `--p0` to `--p7` and a `--victim`, and a person's index picks one — so a
 * token on the map, a row in the notebook and a name on a card are the same
 * colour without anything having to agree about it. The palette is defined in
 * both themes, so nothing here needs to know which is up.
 *
 * **Colour is never the only carrier.** Every token also shows a letter and
 * every pencil mark a three-letter room code, because the plan says so and
 * because a fifth of the people who might play this cannot tell `--p1` from
 * `--p4`.
 */

import type { CaseFrame, PersonId, RoomId, SlotIndex } from "$lib/engine/types";

export function personColor(frame: CaseFrame, p: PersonId): string {
  return p === frame.victim ? "var(--victim)" : `var(--p${p % 8})`;
}

const LETTERS = "ABCDEFGH";

/** The one glyph a token can carry. The victim gets a cross, not a letter. */
export function personGlyph(frame: CaseFrame, p: PersonId): string {
  return p === frame.victim ? "†" : (LETTERS[p] ?? String(p + 1));
}

/* -------------------------------------------------- wave 7: the monogram */

/**
 * The same palette as `app.css`, in hex.
 *
 * Duplicated, which is a cost worth naming. `personColor` returns
 * `var(--p0)`, and a CSS variable resolves against the document — perfect
 * inside the app, useless in a standalone SVG, which is what a fallback
 * avatar has to be if it is ever to sit in an `<img>` beside a real portrait.
 * So the literal values live here too, and `look.test.ts` asserts the two
 * lists have the same length. They are the light theme's; a monogram keeps
 * one appearance in both, because an `<img>` cannot see the theme and a
 * portrait beside it will not change either.
 */
export const PALETTE = [
  "#2f6c7d",
  "#a2542b",
  "#4a6b25",
  "#7a4f8c",
  "#b0812a",
  "#29617f",
  "#8c3a5a",
  "#3d6b5c",
];

export const VICTIM_COLOR = "#6b6357";

export function personHex(frame: CaseFrame, p: PersonId): string {
  return p === frame.victim ? VICTIM_COLOR : (PALETTE[p % PALETTE.length] ?? VICTIM_COLOR);
}

/**
 * What a monogram says: initials where there is a name, the token's letter
 * where there is not.
 *
 * At most two characters. A case played in the engine's own words has no
 * names at all, so this has to work from nothing — which is also the state
 * every case was in until wave 5, and the reason the letter stays the
 * fallback rather than being replaced by one.
 */
export function personInitials(frame: CaseFrame, p: PersonId, name?: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter((w) => w !== "");
  // Honorifics carry no information and would make half a Victorian cast
  // read "MR". Dropped only when something follows them.
  const useful = words.filter(
    (w) => !/^(mr|mrs|ms|miss|dr|sir|lady|lord|prof|professor|rev|capt|captain)\.?$/i.test(w),
  );
  const from = useful.length > 0 ? useful : words;
  const letters = from
    .slice(0, 2)
    .map((w) => [...w][0] ?? "")
    .join("")
    .toUpperCase();
  return letters !== "" ? letters : personGlyph(frame, p);
}

/** Escapes the five characters that would otherwise break the markup. */
function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A person as a coin, as a standalone SVG.
 *
 * Deterministic, which the plan asks for and which is worth more than it
 * sounds: the same person is the same picture on the briefing, in the cast
 * strip and beside their replies, without anything having to cache or agree.
 * No randomness, no date, no layout measurement — the same three inputs give
 * the same string, byte for byte, and `look.test.ts` holds that.
 */
export function monogramSvg(frame: CaseFrame, p: PersonId, name?: string, size = 128): string {
  const tone = personHex(frame, p);
  const text = personInitials(frame, p, name);
  const half = size / 2;
  // Scaled to the box rather than fixed, so one function serves a 22px token
  // and a 128px portrait. Two letters need to be smaller than one.
  const font = Math.round(size * (text.length > 1 ? 0.36 : 0.46));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${xml(name ?? text)}">`,
    `<rect width="${size}" height="${size}" fill="${tone}"/>`,
    `<text x="${half}" y="${half}" fill="#ffffff" fill-opacity="0.92" font-family="Georgia, 'Times New Roman', serif" font-size="${font}" font-weight="600" text-anchor="middle" dominant-baseline="central">${xml(text)}</text>`,
    `</svg>`,
  ].join("");
}

/**
 * The same, as something an `<img src>` will take.
 *
 * `encodeURIComponent` rather than base64: it is smaller for markup, it is
 * readable in devtools, and it avoids `btoa`, which throws on any character
 * outside Latin-1 — and a cast written in another language is exactly what
 * wave 9 is for.
 */
export function monogramUrl(frame: CaseFrame, p: PersonId, name?: string, size = 128): string {
  return `data:image/svg+xml,${encodeURIComponent(monogramSvg(frame, p, name, size))}`;
}

/** Rooms in reading order, for a menu or a filter. */
export function roomIds(frame: CaseFrame): RoomId[] {
  return frame.plan.rooms.map((r) => r.id);
}

export function slotIndexes(frame: CaseFrame): SlotIndex[] {
  return Array.from({ length: frame.slots }, (_, t) => t);
}

export function suspectIds(frame: CaseFrame): PersonId[] {
  return Array.from({ length: frame.suspects }, (_, s) => s);
}

/** Everybody, victim last — the notebook's row order. */
export function peopleIds(frame: CaseFrame): PersonId[] {
  return Array.from({ length: frame.people }, (_, p) => p);
}

/**
 * A phone is anything under this. Used for the pane tabs and for turning the
 * three columns into one; the CSS does the same thing at the same number, and
 * the number lives here so the two cannot drift.
 */
export const NARROW = 900;
