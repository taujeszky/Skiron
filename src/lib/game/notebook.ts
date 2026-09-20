/**
 * The notebook as the player edits it: pencil marks, undo and redo.
 *
 * The data structure itself belongs to the engine (`solver/hint.ts#Notebook`)
 * because the Check and the hint system both read it and neither may depend
 * on the UI. What lives here is everything the engine has no opinion about —
 * what a click on a cell means, and how to take it back.
 *
 * **Every operation returns a new notebook.** The engine's `ruleOut` and
 * `apply` mutate in place, which is right for a solver filling a grid in a
 * loop and wrong for an undo stack, where the whole mechanism is that the
 * previous value still exists. A notebook is `people × slots` numbers plus
 * two ints — eight rows of eight at the very largest — so copying one is
 * cheaper than reasoning about who else holds a reference to it.
 *
 * `NotebookData` in `types.ts` is the same shape seen from storage. They are
 * structurally identical on purpose: a notebook round-trips through JSON
 * without a codec, which is the only part of a save that does.
 */

import { bit, bitsOf, fullMask, onlyBit, popcount } from "$lib/engine/bits";
import { apply, newNotebook } from "$lib/engine/solver/hint";
import type { Notebook } from "$lib/engine/solver/hint";
import { solve } from "$lib/engine/solver/solve";
import type { Conclusion } from "$lib/engine/solver/state";
import type {
  CaseFrame,
  Clue,
  PersonId,
  RoomId,
  SlotIndex,
} from "$lib/engine/types";

export type { Notebook };

/* --------------------------------------------------------------- copying */

export function cloneNotebook(n: Notebook): Notebook {
  return {
    ruledOut: n.ruledOut.map((row) => row.slice()),
    clearedSuspects: n.clearedSuspects,
    ruledOutSlots: n.ruledOutSlots,
  };
}

export function notebookEquals(a: Notebook, b: Notebook): boolean {
  if (a.clearedSuspects !== b.clearedSuspects) return false;
  if (a.ruledOutSlots !== b.ruledOutSlots) return false;
  if (a.ruledOut.length !== b.ruledOut.length) return false;
  for (let p = 0; p < a.ruledOut.length; p++) {
    if (a.ruledOut[p].length !== b.ruledOut[p].length) return false;
    for (let t = 0; t < a.ruledOut[p].length; t++) {
      if (a.ruledOut[p][t] !== b.ruledOut[p][t]) return false;
    }
  }
  return true;
}

/**
 * Does this notebook fit this case?
 *
 * The one check `storage.ts` cannot make, because it parses the save before
 * the case has been rebuilt from the id inside it. A notebook of the wrong
 * shape is not a recoverable save; it is a save from a different case.
 */
export function notebookFits(frame: CaseFrame, n: Notebook): boolean {
  if (n.ruledOut.length !== frame.people) return false;
  for (const row of n.ruledOut) if (row.length !== frame.slots) return false;
  const rooms = fullMask(frame.plan.rooms.length);
  for (const row of n.ruledOut) for (const cell of row) if ((cell & ~rooms) !== 0) return false;
  if ((n.clearedSuspects & ~fullMask(frame.suspects)) !== 0) return false;
  if ((n.ruledOutSlots & ~fullMask(frame.slots)) !== 0) return false;
  return true;
}

/* ----------------------------------------------------------- reading it */

export interface CellState {
  /** The rooms still allowed, ascending. */
  open: RoomId[];
  /** The one room left, or -1 when the cell is not settled. */
  set: RoomId;
  /** Nothing is left: the player has crossed out everywhere. */
  empty: boolean;
}

export function cellState(
  frame: CaseFrame,
  n: Notebook,
  p: PersonId,
  t: SlotIndex,
): CellState {
  const mask = fullMask(frame.plan.rooms.length) & ~n.ruledOut[p][t];
  return { open: bitsOf(mask), set: onlyBit(mask), empty: mask === 0 };
}

export function isCleared(n: Notebook, s: PersonId): boolean {
  return (n.clearedSuspects & bit(s)) !== 0;
}

export function isSlotRuledOut(n: Notebook, t: SlotIndex): boolean {
  return (n.ruledOutSlots & bit(t)) !== 0;
}

/** The suspects still in the frame, ascending. */
export function suspectsLeft(frame: CaseFrame, n: Notebook): PersonId[] {
  return bitsOf(fullMask(frame.suspects) & ~n.clearedSuspects);
}

/** The hours still open, ascending. */
export function slotsLeft(frame: CaseFrame, n: Notebook): SlotIndex[] {
  return bitsOf(fullMask(frame.slots) & ~n.ruledOutSlots);
}

/**
 * How far along the notebook is, as a fraction.
 *
 * Marks made over marks there are to make. It is a progress bar and nothing
 * more — a full grid is not a solved case and an empty one is not a lost
 * cause — so it counts crossings-out rather than trying to measure certainty.
 */
export function progress(frame: CaseFrame, n: Notebook): number {
  const rooms = frame.plan.rooms.length;
  const total = frame.people * frame.slots * (rooms - 1) + frame.suspects - 1 + frame.slots - 1;
  if (total <= 0) return 0;
  let made = 0;
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t < frame.slots; t++) {
      made += Math.min(popcount(n.ruledOut[p][t]), rooms - 1);
    }
  }
  made += Math.min(popcount(n.clearedSuspects), frame.suspects - 1);
  made += Math.min(popcount(n.ruledOutSlots), frame.slots - 1);
  return Math.min(1, made / total);
}

/* ----------------------------------------------------------- editing it */

/** Cross a room out of a cell, or put it back. */
export function toggleRoom(
  n: Notebook,
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
): Notebook {
  const out = cloneNotebook(n);
  out.ruledOut[p][t] ^= bit(r);
  return out;
}

/**
 * Settle a cell on one room — or, if it is already settled on that room,
 * open it up again.
 *
 * The second half is what makes the grid usable with one gesture: a player
 * who sets the wrong room would otherwise have to clear the cell and start
 * over, and on a phone that is three taps to undo one.
 */
export function setRoom(
  frame: CaseFrame,
  n: Notebook,
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
): Notebook {
  const all = fullMask(frame.plan.rooms.length);
  const out = cloneNotebook(n);
  out.ruledOut[p][t] = out.ruledOut[p][t] === (all & ~bit(r)) ? 0 : all & ~bit(r);
  return out;
}

/** Rub out every mark in a cell. */
export function clearCell(n: Notebook, p: PersonId, t: SlotIndex): Notebook {
  const out = cloneNotebook(n);
  out.ruledOut[p][t] = 0;
  return out;
}

export function toggleCleared(n: Notebook, s: PersonId): Notebook {
  const out = cloneNotebook(n);
  out.clearedSuspects ^= bit(s);
  return out;
}

export function toggleSlot(n: Notebook, t: SlotIndex): Notebook {
  const out = cloneNotebook(n);
  out.ruledOutSlots ^= bit(t);
  return out;
}

/** Back to blank. */
export function resetNotebook(frame: CaseFrame): Notebook {
  return newNotebook(frame);
}

/* --------------------------------------------------------- the auto-notes */

/**
 * Everything the collected cards say outright.
 *
 * Tier 0 and no further, which is the whole design of the setting: the
 * direct consequences of a card are bookkeeping a player would resent doing
 * by hand, and anything above tier 0 is the puzzle. `solve` with `maxTier: 0`
 * is exactly that line, and it is the engine's line rather than one drawn
 * here, so the two cannot drift.
 */
export function autoNotes(
  frame: CaseFrame,
  cards: readonly Clue[],
  n: Notebook,
): Notebook {
  const out = cloneNotebook(n);
  const result = solve(frame, cards, { maxTier: 0 });
  for (const step of result.steps) apply(frame, out, step.conclusion);
  return out;
}

/** Write one deduction down, as an obedient player would. Used by hints. */
export function applyConclusion(
  frame: CaseFrame,
  n: Notebook,
  c: Conclusion,
): Notebook {
  const out = cloneNotebook(n);
  apply(frame, out, c);
  return out;
}

/* ------------------------------------------------------------- undo/redo */

export interface History {
  past: Notebook[];
  present: Notebook;
  future: Notebook[];
}

/**
 * How many states back the player can go.
 *
 * Deep enough that nobody hits it in a case, shallow enough that a stuck key
 * cannot grow the heap without bound. At the largest frame a notebook is
 * about 70 numbers, so 200 of them is a few kilobytes.
 */
export const HISTORY_LIMIT = 200;

export function newHistory(present: Notebook): History {
  return { past: [], present, future: [] };
}

/**
 * Record a new state.
 *
 * A no-op edit is dropped rather than pushed. Clicking a cell that is
 * already what you clicked for should not cost an undo, and auto-notes fires
 * on every collected card whether or not it has anything to add.
 */
export function push(h: History, next: Notebook): History {
  if (notebookEquals(h.present, next)) return h;
  const past = [...h.past, h.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
  };
}
