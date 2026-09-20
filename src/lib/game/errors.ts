/**
 * The notebook's own complaints.
 *
 * **It never sees the truth.** `findErrors` takes a frame and a notebook and
 * nothing else, which is not a convention but the guarantee: a function with
 * no access to `World` cannot leak one, however it is later edited. The Check
 * button is the thing that compares with the truth, it costs the player
 * something, and it answers one bit (`solver/hint.ts#notebookIsSound`). These
 * are free, and so they must be worth nothing to a player mining them for
 * answers.
 *
 * **Only states that cannot be completed are flagged**, which is the plan's
 * rule and the reason the list is short. A notebook that is merely wrong —
 * the player has crossed out the room somebody was really in — is a perfectly
 * consistent notebook, and saying so would be the Check for free. What is
 * flagged is a notebook that no assignment of people to rooms could satisfy,
 * because that is a bookkeeping slip rather than a wrong belief, and a player
 * who has boxed themselves in wants to know before they spend an hour inside
 * the box.
 *
 * The plan listed four such states. There are six, and the two extra ones —
 * a person pencilled into a room the case file bars them from, and more
 * suspects in a room than it holds — are the same kind of thing seen against
 * the case file rather than against the movement rule. Both are decidable
 * from the notebook alone, both are certainly uncompletable, and leaving
 * them out would have meant the status bar staying silent about a mark that
 * flatly contradicts a rule printed on the briefing screen.
 *
 * Capacity counts **suspects only**, deliberately. It counts the living, and
 * the player does not know which hour the victim died in, so including the
 * victim could flag a notebook that is perfectly legal with a body in the
 * corner. Suspects alone are a lower bound on the living, which is all the
 * check needs to be sound.
 */

import { canMove, capacityOf } from "$lib/engine/axioms";
import { bit, fullMask, onlyBit } from "$lib/engine/bits";
import type {
  CaseFrame,
  Glossary,
  PersonId,
  RoomId,
  SlotIndex,
} from "$lib/engine/types";
import { defaultGlossary } from "$lib/engine/solver/explain";
import type { Notebook } from "./notebook";

export type NotebookErrorKind =
  | "empty-cell"
  | "movement"
  | "barred-room"
  | "capacity"
  | "no-suspects"
  | "no-slots";

export interface NotebookError {
  kind: NotebookErrorKind;
  /** One sentence for the status bar. */
  text: string;
  /** The cells to light up. Empty for the two that are about a list. */
  cells: { p: PersonId; t: SlotIndex }[];
  /** The rooms to light up on the map, if any. */
  rooms: RoomId[];
}

/**
 * Every uncompletable state the notebook is currently in.
 *
 * Ordered by kind, and within a kind by person and then slot, so that the
 * status bar does not shuffle its sentence every time an unrelated mark is
 * made.
 */
export function findErrors(
  frame: CaseFrame,
  n: Notebook,
  glossary: Glossary = defaultGlossary(frame),
): NotebookError[] {
  const out: NotebookError[] = [];
  const all = fullMask(frame.plan.rooms.length);
  const settled: number[][] = [];

  for (let p = 0; p < frame.people; p++) {
    settled.push([]);
    for (let t = 0; t < frame.slots; t++) {
      const open = all & ~n.ruledOut[p][t];
      settled[p].push(onlyBit(open));
      if (open === 0) {
        out.push({
          kind: "empty-cell",
          text:
            `${glossary.personName(p)} has nowhere left to be in ` +
            `${glossary.slotLabel(t)} — every room is crossed out.`,
          cells: [{ p, t }],
          rooms: [],
        });
      }
    }
  }

  // A room the case file bars, pencilled in as the only possibility.
  for (const barred of frame.rules.roomBars) {
    for (let t = 0; t < frame.slots; t++) {
      if (settled[barred.person]?.[t] !== barred.room) continue;
      out.push({
        kind: "barred-room",
        text:
          `The case file says ${glossary.personName(barred.person)} was never in ` +
          `${glossary.roomName(barred.room)}, but the notebook puts them there in ` +
          `${glossary.slotLabel(t)}.`,
        cells: [{ p: barred.person, t }],
        rooms: [barred.room],
      });
    }
  }

  // Two settled cells with no legal step between them.
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t + 1 < frame.slots; t++) {
      const from = settled[p][t];
      const to = settled[p][t + 1];
      if (from < 0 || to < 0) continue;
      if (canMove(frame, p, from, to, t)) continue;
      out.push({
        kind: "movement",
        text:
          `${glossary.personName(p)} cannot get from ${glossary.roomName(from)} in ` +
          `${glossary.slotLabel(t)} to ${glossary.roomName(to)} in ` +
          `${glossary.slotLabel(t + 1)}.`,
        cells: [
          { p, t },
          { p, t: t + 1 },
        ],
        rooms: from === to ? [from] : [from, to],
      });
    }
  }

  // More suspects in a room than it holds.
  for (let t = 0; t < frame.slots; t++) {
    const count = new Map<RoomId, PersonId[]>();
    for (let s = 0; s < frame.suspects; s++) {
      const r = settled[s][t];
      if (r < 0) continue;
      const list = count.get(r);
      if (list) list.push(s);
      else count.set(r, [s]);
    }
    for (const [r, people] of count) {
      const max = capacityOf(frame, r);
      if (people.length <= max) continue;
      out.push({
        kind: "capacity",
        text:
          `${glossary.roomName(r)} holds ${max}, and the notebook puts ` +
          `${people.length} people in it in ${glossary.slotLabel(t)}.`,
        cells: people.map((p) => ({ p, t })),
        rooms: [r],
      });
    }
  }

  if ((fullMask(frame.suspects) & ~n.clearedSuspects) === 0) {
    out.push({
      kind: "no-suspects",
      text: "Every suspect is crossed off, and one of them did it.",
      cells: [],
      rooms: [],
    });
  }

  if ((fullMask(frame.slots) & ~n.ruledOutSlots) === 0) {
    out.push({
      kind: "no-slots",
      text: "Every hour is crossed off, and the murder happened in one of them.",
      cells: [],
      rooms: [],
    });
  }

  return out;
}

/** Is the cell one that some error names? For the grid's red wash. */
export function errorCells(errors: readonly NotebookError[]): Set<string> {
  const out = new Set<string>();
  for (const e of errors) for (const c of e.cells) out.add(`${c.p}:${c.t}`);
  return out;
}

/** The suspects a notebook still allows, as a mask. Used by the accusation. */
export function openSuspects(frame: CaseFrame, n: Notebook): number {
  return fullMask(frame.suspects) & ~n.clearedSuspects;
}

export function openSlots(frame: CaseFrame, n: Notebook): number {
  return fullMask(frame.slots) & ~n.ruledOutSlots;
}

/** Has the notebook narrowed the answer to exactly one pair? */
export function notebookAnswer(
  frame: CaseFrame,
  n: Notebook,
): { culprit: PersonId; slot: SlotIndex } | null {
  const culprit = onlyBit(openSuspects(frame, n));
  const slot = onlyBit(openSlots(frame, n));
  if (culprit < 0 || slot < 0) return null;
  return { culprit, slot };
}

/** For the grid header: is this person's whole row settled? */
export function rowSettled(frame: CaseFrame, n: Notebook, p: PersonId): boolean {
  const all = fullMask(frame.plan.rooms.length);
  for (let t = 0; t < frame.slots; t++) {
    if (onlyBit(all & ~n.ruledOut[p][t]) < 0) return false;
  }
  return true;
}

/** Who the notebook places in a room in a slot, for the map's solid tokens. */
export function placedIn(
  frame: CaseFrame,
  n: Notebook,
  t: SlotIndex,
): Map<RoomId, PersonId[]> {
  const all = fullMask(frame.plan.rooms.length);
  const out = new Map<RoomId, PersonId[]>();
  for (let p = 0; p < frame.people; p++) {
    const r = onlyBit(all & ~n.ruledOut[p][t]);
    if (r < 0) continue;
    const list = out.get(r);
    if (list) list.push(p);
    else out.set(r, [p]);
  }
  return out;
}

/** Who the notebook still allows in a room in a slot, minus the settled ones. */
export function candidatesIn(
  frame: CaseFrame,
  n: Notebook,
  t: SlotIndex,
): Map<RoomId, PersonId[]> {
  const all = fullMask(frame.plan.rooms.length);
  const out = new Map<RoomId, PersonId[]>();
  for (let p = 0; p < frame.people; p++) {
    const open = all & ~n.ruledOut[p][t];
    if (onlyBit(open) >= 0) continue;
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      if ((open & bit(r)) === 0) continue;
      const list = out.get(r);
      if (list) list.push(p);
      else out.set(r, [p]);
    }
  }
  return out;
}
