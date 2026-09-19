/**
 * Tier 2 — counting.
 *
 * The deductions that need more than one row of the notebook at a time: how
 * many people a room held and who that leaves over, which slot is the last
 * one a visit could still have happened in, and the two people a card puts in
 * the same room without saying which.
 *
 * SOUNDNESS, and the one trap in this tier. Every count here is a count of
 * the **living** (ARCHITECTURE.md §2): the victim counts until the murder
 * slot, and the body never counts at all. So a room with a body in it can be
 * empty, and "exactly two people were in the library" says nothing about a
 * corpse lying there. A counting rule that reads `dom[victim]` raw is the
 * classic way to make this tier unsound, which is why the victim is reached
 * only through `mayBeLivingIn` / `mustBeLivingIn`, and why turning "was not a
 * living presence here" into an elimination happens in exactly one place,
 * `ruleOutLiving` below.
 *
 * That statement splits, as it must, into two readings the state cannot yet
 * tell apart: either the victim was not in that room, or the victim was
 * already dead. A rule may act only when the state has ruled one of them out.
 */

import { bit, bitsOf, fullMask, onlyBit, popcount } from "../../bits";
import type { Clue, ClueId, PersonId, RoomId, SlotIndex } from "../../types";
import type { Cell, Deduction, Premises, RuleId } from "../state";
import {
  activeClues,
  contradict,
  didChange,
  killPairs,
  mayBeLivingIn,
  mustBeLivingIn,
  removeRooms,
  restrict,
  slotMask,
} from "../state";

export const TIER = 2;

export function tier2(d: Deduction): boolean {
  return didChange(d, () => {
    for (const clue of activeClues(d.ctx, d.state)) {
      applyClue(d, clue);
      if (d.state.contradiction) return;
    }
    // Capacities are case-file rules, so the frame is their authoritative
    // copy and they bite whether or not a card for them was ever dealt.
    for (const cap of d.ctx.frame.rules.capacities) {
      atMostLiving(d, cap.room, cap.max, []);
      if (d.state.contradiction) return;
    }
  });
}

/* -------------------------------------------------------------- counting */

/** Slots strictly after `t`, as a slot mask. */
function after(t: SlotIndex): number {
  return ~fullMask(t + 1);
}

/** Slots up to and including `t`, as a slot mask. */
function upTo(t: SlotIndex): number {
  return fullMask(t + 1);
}

/** Everyone who may still be a living presence in `r` at `t`. */
function canBeIn(d: Deduction, r: RoomId, t: SlotIndex): number {
  let m = 0;
  for (let p = 0; p < d.ctx.frame.people; p++) {
    if (mayBeLivingIn(d.ctx, d.state, p, t, r)) m |= bit(p);
  }
  return m;
}

/**
 * Everyone who certainly is a living presence in `r` at `t`. A subset of
 * `canBeIn` by construction: `mustBeLivingIn` is the stricter test on both
 * halves, the room and the living.
 */
function mustBeIn(d: Deduction, r: RoomId, t: SlotIndex): number {
  let m = 0;
  for (let p = 0; p < d.ctx.frame.people; p++) {
    if (mustBeLivingIn(d.ctx, d.state, p, t, r)) m |= bit(p);
  }
  return m;
}

/** The cells a counting step read: everybody it weighed, in that slot. */
function cellsOf(people: number, t: SlotIndex): Cell[] {
  return bitsOf(people).map((p) => ({ p, t }));
}

/** One person's whole row: what a `Visited` step had to look at. */
function rowCells(p: PersonId, slots: number): Cell[] {
  const out: Cell[] = [];
  for (let t = 0; t < slots; t++) out.push({ p, t });
  return out;
}

/**
 * `p` was **not** a living presence in `r` at `t`.
 *
 * For a suspect that is simply "p was elsewhere". For the victim it is a
 * disjunction — elsewhere, or already dead — so it may only be acted on when
 * the state has ruled out one side:
 *
 *  - every surviving murder slot is later than `t`, so the victim was alive
 *    then and therefore was elsewhere; or
 *  - the victim cannot have been anywhere but `r`, so they were already dead,
 *    which bounds the murder slot at `t`.
 *
 * When neither holds nothing follows, and saying nothing is the whole job.
 */
function ruleOutLiving(
  d: Deduction,
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
  rule: RuleId,
  premises: Premises,
): void {
  const V = d.ctx.frame.victim;
  if (p !== V) {
    removeRooms(d, p, t, bit(r), rule, TIER, premises);
    return;
  }
  const live = slotMask(d.state);
  if (live !== 0 && (live & ~after(t)) === 0) {
    removeRooms(d, V, t, bit(r), rule, TIER, premises);
  } else if (d.state.dom[V][t] === bit(r)) {
    killPairs(d, (_, slot) => (after(t) & bit(slot)) !== 0, rule, TIER, premises);
  }
}

/**
 * `p` **was** a living presence in `r` at `t`. For the victim that is also a
 * statement about the murder slot: they were still alive, so it came later.
 */
function forceLivingIn(
  d: Deduction,
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
  rule: RuleId,
  premises: Premises,
): void {
  restrict(d, p, t, bit(r), rule, TIER, premises);
  if (p === d.ctx.frame.victim) {
    killPairs(d, (_, slot) => (upTo(t) & bit(slot)) !== 0, rule, TIER, premises);
  }
}

/**
 * Exactly `k` living people were in `r` at `t`.
 *
 * Two halves, and they are the same thought from each end. If `k` people are
 * already pinned there, nobody else can be — the room is full. If only `k`
 * people could possibly be there, then all of them were, because there is
 * nobody else left to make up the number.
 */
function exactlyLiving(
  d: Deduction,
  r: RoomId,
  t: SlotIndex,
  k: number,
  clues: ClueId[],
): void {
  const can = canBeIn(d, r, t);
  const must = mustBeIn(d, r, t);
  const premises: Premises = { clues, cells: cellsOf(can | must, t) };
  if (popcount(must) > k || popcount(can) < k) {
    contradict(d, "count-exact", TIER, premises);
    return;
  }
  if (popcount(must) === k) {
    for (const p of bitsOf(can & ~must)) {
      ruleOutLiving(d, p, t, r, "count-exact", premises);
      if (d.state.contradiction) return;
    }
  }
  if (popcount(can) === k) {
    for (const p of bitsOf(can & ~must)) {
      forceLivingIn(d, p, t, r, "count-exact", premises);
      if (d.state.contradiction) return;
    }
  }
}

/**
 * At most `k` living people were in `r`, in every slot. Only the first half
 * of `exactlyLiving` follows from a ceiling: once `k` are pinned there the
 * room is full, but an under-full room says nothing about anybody.
 */
function atMostLiving(
  d: Deduction,
  r: RoomId,
  k: number,
  clues: ClueId[],
): void {
  for (let t = 0; t < d.ctx.frame.slots; t++) {
    const must = mustBeIn(d, r, t);
    if (popcount(must) > k) {
      contradict(d, "count-capacity", TIER, { clues, cells: cellsOf(must, t) });
      return;
    }
    if (popcount(must) !== k) continue;
    const can = canBeIn(d, r, t);
    const premises: Premises = { clues, cells: cellsOf(must, t) };
    for (const p of bitsOf(can & ~must)) {
      ruleOutLiving(d, p, t, r, "count-capacity", premises);
      if (d.state.contradiction) return;
    }
  }
}

/* ------------------------------------------------------------- the clues */

function applyClue(d: Deduction, clue: Clue): void {
  const { frame } = d.ctx;
  const everyone = d.ctx.allSuspects | bit(frame.victim);
  const b = clue.body;
  switch (b.kind) {
    case "Occupied": {
      // Somebody living was there. When only one person is left who could
      // have been, it was them — "everyone else is accounted for elsewhere",
      // which is this tier's signature deduction.
      const can = canBeIn(d, b.r, b.t);
      if (can === 0) {
        contradict(d, "occupied-last-one", TIER, {
          clues: [clue.id],
          cells: cellsOf(everyone, b.t),
        });
        return;
      }
      const only = onlyBit(can);
      if (only < 0) return;
      forceLivingIn(d, only, b.t, b.r, "occupied-last-one", {
        clues: [clue.id],
        cells: cellsOf(everyone & ~bit(only), b.t),
      });
      return;
    }

    case "Count":
      exactlyLiving(d, b.r, b.t, b.k, [clue.id]);
      return;

    case "Capacity":
      // Normally already applied from `frame.rules`; applied again so that a
      // rule card which never reached the frame still bites.
      atMostLiving(d, b.r, b.k, [clue.id]);
      return;

    case "Visited": {
      // The visit happened in some slot. When only one slot still allows the
      // room, that is the slot. `Visited` reads a timeline raw, so a corpse
      // counts as a visit and no liveness test applies here.
      let slots = 0;
      for (let t = 0; t < frame.slots; t++) {
        if ((d.state.dom[b.p][t] & bit(b.r)) !== 0) slots |= bit(t);
      }
      const premises: Premises = {
        clues: [clue.id],
        cells: rowCells(b.p, frame.slots),
      };
      if (slots === 0) {
        contradict(d, "visited-last-slot", TIER, premises);
        return;
      }
      const only = onlyBit(slots);
      if (only < 0) return;
      restrict(d, b.p, only, bit(b.r), "visited-last-slot", TIER, premises);
      return;
    }

    case "Together": {
      // The room is not named, but it is the same one, so each domain may be
      // cut down to what the other allows. Repeated to a fixpoint with tier 1
      // that is what "they were together, and she could not have reached the
      // cellar" says. Sound whatever the liveness, because the card asserts
      // the two rooms are equal; tier 0 has already taken the liveness half.
      const shared = d.state.dom[b.p][b.t] & d.state.dom[b.q][b.t];
      restrict(d, b.p, b.t, shared, "together-same-room", TIER, {
        clues: [clue.id],
        cells: [{ p: b.q, t: b.t }],
      });
      if (d.state.contradiction) return;
      restrict(d, b.q, b.t, shared, "together-same-room", TIER, {
        clues: [clue.id],
        cells: [{ p: b.p, t: b.t }],
      });
      return;
    }

    // Everything else belongs to tier 0 or tier 1.
    case "At":
    case "NotAt":
    case "Stayed":
    case "Saw":
    case "AloneIn":
    case "Empty":
    case "NeverVisited":
    case "AliveAt":
    case "DeathWindow":
    case "DoorClosed":
    case "BarredDoor":
    case "BarredRoom":
      return;
  }
}
