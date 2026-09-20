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
