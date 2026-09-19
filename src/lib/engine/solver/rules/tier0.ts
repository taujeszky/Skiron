/**
 * Tier 0 — placement.
 *
 * What one card says about one person's whereabouts, plus the murder axioms.
 * Nothing here counts people or walks the timeline; that is tiers 1 and 2.
 *
 * SOUNDNESS. Every elimination below has to hold in *every* legal world that
 * satisfies the active clues. The two places that is easy to get wrong:
 *
 *  - The victim. `AloneIn` and `Empty` count the living (ARCHITECTURE.md §2),
 *    so they say nothing about a room the body happens to lie in. A rule may
 *    only push the victim out of a room when the surviving pairs agree the
 *    victim was still alive, and may only conclude the victim was dead when
 *    the victim is *forced* into that room.
 *  - Trust. Only active clues are read — facts, and testimony from suspects
 *    who have been cleared. The driver restarts from tier 0 whenever anything
 *    changes, so a clue that becomes trusted later is picked up then.
 */

import { bit, bitsOf, fullMask } from "../../bits";
import type { Clue, PersonId, RoomId, SlotIndex } from "../../types";
import type { Deduction, Premises } from "../state";
import {
  AXIOMS_ONLY,
  activeClues,
  culpritMask,
  didChange,
  fromClue,
  killPairs,
  pairCount,
  pairs,
  removeRooms,
  restrict,
  slotMask,
} from "../state";

export const TIER = 0;

export function tier0(d: Deduction): boolean {
  return didChange(d, () => {
    for (const clue of activeClues(d.ctx, d.state)) {
      applyClue(d, clue);
      if (d.state.contradiction) return;
    }
    murderAxioms(d);
  });
}

/* ------------------------------------------------------------ direct clues */

/** Slots strictly after `t`, as a slot mask. */
function after(t: SlotIndex): number {
  return ~fullMask(t + 1);
}

/** Slots up to and including `t`, as a slot mask. */
function upTo(t: SlotIndex): number {
  return fullMask(t + 1);
}

/**
 * Some clue says `p` had company in slot `t`. If `p` is the victim, they were
 * alive then, so the murder came later.
 */
function seenAlive(d: Deduction, clue: Clue, who: PersonId[], t: SlotIndex) {
  if (!who.includes(d.ctx.frame.victim)) return;
  killPairs(
    d,
    (_, slot) => (upTo(t) & bit(slot)) !== 0,
    "victim-seen-alive",
    TIER,
    fromClue(clue, [{ p: d.ctx.frame.victim, t }]),
  );
}

/**
 * A room that holds no living person in slot `t` — from `Empty`, or from the
 * "and nobody else" half of `AloneIn`.
 *
 * Suspects are simply pushed out. The victim is only pushed out when every
 * surviving pair puts the murder after `t`, because a corpse does not count
 * as somebody being there; and if the victim turns out to be *stuck* in that
 * room in that slot, the reading flips — they must already have been dead.
 */
function noLivingSoulIn(
  d: Deduction,
  r: RoomId,
  t: SlotIndex,
  except: PersonId | null,
  rule: "clue-alone" | "clue-empty",
  premises: Premises,
) {
  const { frame } = d.ctx;
  for (let q = 0; q < frame.suspects; q++) {
    if (q === except) continue;
    removeRooms(d, q, t, bit(r), rule, TIER, premises);
  }
  const V = frame.victim;
  if (except === V) return;
  const live = slotMask(d.state);
  if (live !== 0 && (live & ~after(t)) === 0) {
    // every surviving murder slot is later than t, so the victim was alive
    removeRooms(d, V, t, bit(r), rule, TIER, premises);
  } else if (d.state.dom[V][t] === bit(r)) {
    // the victim cannot be anywhere else, so they were already dead
    killPairs(
      d,
      (_, slot) => (after(t) & bit(slot)) !== 0,
      rule,
      TIER,
      premises,
    );
  }
}

function applyClue(d: Deduction, clue: Clue): void {
  const { frame } = d.ctx;
  const b = clue.body;
  switch (b.kind) {
    case "At":
      restrict(d, b.p, b.t, bit(b.r), "clue-at", TIER, fromClue(clue));
      return;

    case "NotAt":
      removeRooms(d, b.p, b.t, bit(b.r), "clue-not-at", TIER, fromClue(clue));
      return;

    case "Stayed": {
      const lo = Math.min(b.t1, b.t2);
      const hi = Math.max(b.t1, b.t2);
      for (let t = lo; t <= hi; t++) {
        restrict(d, b.p, t, bit(b.r), "clue-stayed", TIER, fromClue(clue));
      }
      return;
    }

    case "Saw":
      restrict(d, b.p, b.t, bit(b.r), "clue-saw", TIER, fromClue(clue));
      restrict(d, b.q, b.t, bit(b.r), "clue-saw", TIER, fromClue(clue));
      seenAlive(d, clue, [b.p, b.q], b.t);
      return;

    case "Together":
      // The rooms must match, but that is a two-person argument and belongs to
      // tier 2. All tier 0 takes from it is that both were alive.
      seenAlive(d, clue, [b.p, b.q], b.t);
      return;

    case "AloneIn":
      restrict(d, b.p, b.t, bit(b.r), "clue-alone", TIER, fromClue(clue));
      // "Alone" counts the living, so the one person there was alive — which
      // matters when that person is the victim.
      seenAlive(d, clue, [b.p], b.t);
      noLivingSoulIn(d, b.r, b.t, b.p, "clue-alone", fromClue(clue));
      return;

    case "Empty":
      noLivingSoulIn(d, b.r, b.t, null, "clue-empty", fromClue(clue));
      return;

    case "NeverVisited":
      for (let t = 0; t < frame.slots; t++) {
        removeRooms(
          d,
          b.p,
          t,
          bit(b.r),
          "clue-never-visited",
          TIER,
          fromClue(clue),
        );
      }
      return;

    case "BarredRoom":
      // Normally already folded into the initial domains via `frame.rules`;
      // applied again so a rule card that never reached the frame still bites.
      for (let t = 0; t < frame.slots; t++) {
        removeRooms(
          d,
          b.p,
          t,
          bit(b.r),
          "clue-never-visited",
          TIER,
          fromClue(clue),
        );
      }
      return;

    case "AliveAt":
      killPairs(
        d,
        (_, slot) => (upTo(b.t) & bit(slot)) !== 0,
        "clue-alive-at",
        TIER,
        fromClue(clue),
      );
      return;

    case "DeathWindow": {
      const lo = Math.min(b.a, b.b);
      const hi = Math.max(b.a, b.b);
      const inside = fullMask(hi + 1) & ~fullMask(lo);
      killPairs(
        d,
        (_, slot) => (inside & bit(slot)) === 0,
        "clue-death-window",
        TIER,
        fromClue(clue),
      );
      return;
    }

    // Counting and span clues are tiers 1 and 2; door and capacity rules reach
    // the solver through `frame.rules`, which `movementMasks` already folds in.
    case "Occupied":
    case "Count":
    case "Visited":
    case "DoorClosed":
    case "BarredDoor":
    case "Capacity":
      return;
  }
}

/* ----------------------------------------------------------- murder axioms */

function murderAxioms(d: Deduction): void {
  const { frame } = d.ctx;
  const V = frame.victim;
  const rStar = frame.murderRoom;
  const T = frame.slots;

  // The murder is in some slot, and from then on the body is in r*. The last
  // slot is at or after every candidate, so the body is certainly there.
  restrict(d, V, T - 1, bit(rStar), "body-at-end", TIER, AXIOMS_ONLY);

  // The killer was in r* in the murder slot, and so was the victim.
  killPairs(
    d,
    (s, t) =>
      (d.state.dom[s][t] & bit(rStar)) === 0 ||
      (d.state.dom[V][t] & bit(rStar)) === 0,
    "opportunity",
    TIER,
    AXIOMS_ONLY,
  );

  // The victim was not in r* in slot t, so they had not died yet.
  for (let t = 0; t < T; t++) {
    if ((d.state.dom[V][t] & bit(rStar)) !== 0) continue;
    killPairs(
      d,
      (_, slot) => (upTo(t) & bit(slot)) !== 0,
      "victim-not-yet-dead",
      TIER,
      { clues: [], cells: [{ p: V, t }] },
    );
  }

  // Somebody is stuck in the murder room. In that slot they can only be the
  // killer (rule 4), and no earlier slot can be the murder either, because an
  // innocent may not be in that room afterwards (rule 5).
  for (let q = 0; q < frame.suspects; q++) {
    for (let tq = 0; tq < T; tq++) {
      if (d.state.dom[q][tq] !== bit(rStar)) continue;
      const where: Premises = { clues: [], cells: [{ p: q, t: tq }] };
      // rule 4: in that slot the only living soul in r* is the killer
      killPairs(d, (s, t) => s !== q && t === tq, "witness-in-room", TIER, where);
      // rule 5: and an innocent may not be there after the murder either
      killPairs(d, (s, t) => s !== q && t < tq, "sealed-after", TIER, where);
    }
  }

  // Once the latest possible murder slot has passed, the murder has certainly
  // happened: the body is in r*, and anyone already cleared is not.
  const live = slotMask(d.state);
  if (live !== 0) {
    const latest = Math.max(...bitsOf(live));
    const cleared = d.ctx.allSuspects & ~culpritMask(d.state);
    for (let t = latest; t < T; t++) {
      restrict(d, V, t, bit(rStar), "sealed-back", TIER, AXIOMS_ONLY);
      for (const q of bitsOf(cleared)) {
        removeRooms(d, q, t, bit(rStar), "sealed-back", TIER, AXIOMS_ONLY);
      }
    }
  }

  // The endgame: one pair left, so the killer and the victim are both pinned
  // to the murder room in that slot.
  if (pairCount(d.state) === 1) {
    const only = pairs(d.state)[0];
    restrict(d, only.culprit, only.slot, bit(rStar), "opportunity", TIER, AXIOMS_ONLY);
    restrict(d, V, only.slot, bit(rStar), "opportunity", TIER, AXIOMS_ONLY);
  }
}
