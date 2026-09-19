import { describe, it, expect } from "vitest";
import { bit, popcount } from "../../bits";
import { corridorPlan, frameOf } from "../../testkit";
import { answers } from "../exhaustive";
import { culpritMask } from "../state";
import { solve } from "../solve";
import type { CaseFrame, Clue, ClueBody, PersonId } from "../../types";

/**
 * One minimal position per rule, in both directions: a board where the rule
 * must fire, and the same board with the one card removed that made it fire.
 *
 * The negative half is the half that earns its keep. A rule that fires when
 * it should not is unsound, and the oracle in `solver.test.ts` catches that
 * across thousands of random cases; what random cases are bad at is telling
 * you *which* rule did it, or noticing that a rule has quietly stopped firing
 * at all. These say both, in a position small enough to read.
 *
 * Every position is also checked against the exhaustive solver, so a test
 * that encodes a wrong expectation fails rather than enshrining it.
 */

let n = 0;
function fact(body: ClueBody): Clue {
  return { id: `f${n++}`, body, source: { kind: "fact" } };
}
function says(speaker: PersonId, body: ClueBody): Clue {
  return { id: `s${n++}`, body, source: { kind: "testimony", speaker } };
}

/** Solve, and insist the position is a real one: no contradiction, and the
 * exhaustive solver agrees an answer exists. */
function run(frame: CaseFrame, clues: Clue[], maxTier?: number) {
  const r = solve(frame, clues, maxTier === undefined ? {} : { maxTier });
  expect(r.contradiction, "the position itself is contradictory").toBe(false);
  expect(answers(frame, clues).length, "no legal answer at all").toBeGreaterThan(0);
  return r;
}

/* ================================================== tier 2 — counting ==== */

describe("tier 2: occupied-last-one", () => {
  // Three rooms in a line, two suspects, the body in room 2.
  const frame = frameOf({
    plan: corridorPlan(3),
    suspects: 2,
    slots: 2,
    murderRoom: 2,
  });
  const occupied = fact({ kind: "Occupied", r: 0, t: 0 });

  it("fires when only one person is left who could have been there", () => {
    // The victim cannot be in room 0 at slot 0 (the body is in room 2 in the
    // last slot and room 0 is two doors away), and this card puts suspect 1
    // in room 2. So the somebody in room 0 can only be suspect 0.
    const r = run(frame, [occupied, fact({ kind: "At", p: 1, t: 0, r: 2 })]);
    expect(r.state.dom[0][0]).toBe(bit(0));
  });

  it("does not fire while two people could still have been there", () => {
    const r = run(frame, [occupied]);
    expect(popcount(r.state.dom[0][0])).toBeGreaterThan(1);
    expect(popcount(r.state.dom[1][0])).toBeGreaterThan(1);
  });
});

describe("tier 2: count-exact", () => {
  it("excludes everyone else once the count is filled", () => {
    // Exactly two living people in room 0 at slot 0, and two are named, so
    // suspect 2 was elsewhere.
    const frame = frameOf({
      plan: corridorPlan(3),
      suspects: 3,
      slots: 2,
      murderRoom: 2,
    });
    const clues = [
      fact({ kind: "Count", r: 0, t: 0, k: 2 }),
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
      fact({ kind: "At", p: 1, t: 0, r: 0 }),
    ];
    const r = run(frame, clues);
    expect(r.state.dom[2][0] & bit(0)).toBe(0);
  });

  it("does not exclude anyone while the count is unfilled", () => {
    const frame = frameOf({
      plan: corridorPlan(3),
      suspects: 3,
      slots: 2,
      murderRoom: 2,
    });
    const clues = [
      fact({ kind: "Count", r: 0, t: 0, k: 2 }),
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
    ];
    const r = run(frame, clues);
    expect(r.state.dom[2][0] & bit(0)).not.toBe(0);
  });

  it("forces everyone in when only the count can make it up", () => {
    // Exactly two in room 2 at slot 0. The victim is ruled out by a card, so
    // the only two people left who could be there both were.
    const frame = frameOf({
      plan: corridorPlan(3),
      suspects: 2,
      slots: 3,
      murderRoom: 0,
    });
    const clues = [
      fact({ kind: "Count", r: 2, t: 0, k: 2 }),
      fact({ kind: "NotAt", p: 2, t: 0, r: 2 }),
    ];
    const r = run(frame, clues);
    expect(r.state.dom[0][0]).toBe(bit(2));
    expect(r.state.dom[1][0]).toBe(bit(2));
  });

  it("forces nobody while a third person could still make up the count", () => {
    const frame = frameOf({
      plan: corridorPlan(3),
      suspects: 2,
      slots: 3,
      murderRoom: 0,
    });
    const r = run(frame, [fact({ kind: "Count", r: 2, t: 0, k: 2 })]);
    expect(popcount(r.state.dom[0][0])).toBeGreaterThan(1);
  });
});

describe("tier 2: count-capacity", () => {
  const plan = corridorPlan(3);
  const pinned = fact({ kind: "At", p: 0, t: 0, r: 1 });

  it("empties a full room of everybody else", () => {
    const frame = frameOf({
      plan,
      suspects: 2,
      slots: 2,
      murderRoom: 0,
      rules: { closures: [], doorBars: [], roomBars: [], capacities: [{ room: 1, max: 1 }] },
    });
    const r = run(frame, [pinned]);
    expect(r.state.dom[1][0] & bit(1)).toBe(0);
  });

  it("says nothing about a room with room to spare", () => {
    const frame = frameOf({
      plan,
      suspects: 2,
      slots: 2,
      murderRoom: 0,
      rules: { closures: [], doorBars: [], roomBars: [], capacities: [{ room: 1, max: 2 }] },
    });
    const r = run(frame, [pinned]);
    expect(r.state.dom[1][0] & bit(1)).not.toBe(0);
  });
});

describe("tier 2: visited-last-slot", () => {
  it("pins the visit when only one slot is left for it", () => {
    const frame = frameOf({
      plan: corridorPlan(3),
      suspects: 2,
      slots: 3,
      murderRoom: 0,
    });
    const clues = [
      fact({ kind: "Visited", p: 0, r: 2 }),
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
      fact({ kind: "At", p: 0, t: 1, r: 1 }),
    ];
    const r = run(frame, clues);
    expect(r.state.dom[0][2]).toBe(bit(2));
  });

  it("pins nothing while two slots could hold the visit", () => {
    const frame = frameOf({
      plan: corridorPlan(3),
      suspects: 2,
      slots: 4,
      murderRoom: 0,
    });
    const clues = [
      fact({ kind: "Visited", p: 0, r: 2 }),
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
    ];
    const r = run(frame, clues);
    expect(popcount(r.state.dom[0][2])).toBeGreaterThan(1);
  });
});

describe("tier 2: together-same-room", () => {
  const frame = frameOf({
    plan: corridorPlan(3),
    suspects: 2,
    slots: 2,
    murderRoom: 0,
  });
  const together = fact({ kind: "Together", p: 0, q: 1, t: 0 });

  it("carries one person's room across to the other", () => {
    const r = run(frame, [together, fact({ kind: "At", p: 0, t: 0, r: 1 })]);
    expect(r.state.dom[1][0]).toBe(bit(1));
  });

  it("says nothing when neither room is known", () => {
    const r = run(frame, [together]);
    expect(popcount(r.state.dom[1][0])).toBeGreaterThan(1);
  });
});

/* ===================================================== tier 3 — trust ==== */

describe("tier 3: self-incrimination", () => {
  // Four rooms in a line, three suspects, the body in room 1, lying on.
  const plan = corridorPlan(4);
  const frame = frameOf({ plan, suspects: 3, slots: 3, murderRoom: 1, lying: true });
  const seen = fact({ kind: "At", p: 1, t: 0, r: 3 });

  it("names the liar as the culprit", () => {
    // Suspect 1 claims to have been in room 0 at the first hour; the case
    // file puts them in room 3. An innocent suspect 1 would have been
    // telling the truth, so suspect 1 is not innocent.
    const clues = [seen, says(1, { kind: "At", p: 1, t: 0, r: 0 })];
    const r = run(frame, clues);
    expect(culpritMask(r.state)).toBe(bit(1));
    expect(r.tier).toBe(3);
    // and the independent solver agrees that only suspect 1 is possible
    expect(new Set(answers(frame, clues).map((a) => a.culprit))).toEqual(new Set([1]));
  });

  it("does not fire when the story holds up", () => {
    const clues = [seen, says(1, { kind: "At", p: 1, t: 0, r: 3 })];
    const r = run(frame, clues);
    expect(popcount(culpritMask(r.state))).toBeGreaterThan(1);
    expect(r.tier).toBeLessThan(3);
  });
});

describe("tier 3: conflict-pair", () => {
  const plan = corridorPlan(3);
  const frame = frameOf({ plan, suspects: 3, slots: 3, murderRoom: 2, lying: true });

  it("clears everyone else when two stories cannot both stand", () => {
    // Both claim the same room, alone, in the same hour. One of them is
    // lying, and only the culprit lies — so the culprit is one of the two.
    const clues = [
      says(0, { kind: "AloneIn", p: 0, t: 0, r: 0 }),
      says(1, { kind: "AloneIn", p: 1, t: 0, r: 0 }),
    ];
    const r = run(frame, clues);
    expect(culpritMask(r.state)).toBe(bit(0) | bit(1));
    expect(r.tier).toBe(3);
    expect(new Set(answers(frame, clues).map((a) => a.culprit))).toEqual(
      new Set([0, 1]),
    );
  });

  it("does not fire when the two stories sit side by side", () => {
    const clues = [
      says(0, { kind: "AloneIn", p: 0, t: 0, r: 0 }),
      says(1, { kind: "AloneIn", p: 1, t: 0, r: 1 }),
    ];
    const r = run(frame, clues);
    expect(culpritMask(r.state) & bit(2)).not.toBe(0);
    expect(r.tier).toBeLessThan(3);
  });
});

describe("tier 3 sits out cases without lying", () => {
  it("never grades a truthful case as a trust deduction", () => {
    // The same board as self-incrimination, but with lying off every
    // testimony binds outright, so the case is contradictory rather than
    // informative — which is exactly why the tier must not claim it.
    const plan = corridorPlan(4);
    const frame = frameOf({ plan, suspects: 3, slots: 3, murderRoom: 1 });
    const clues = [
      fact({ kind: "At", p: 1, t: 0, r: 3 }),
      says(1, { kind: "At", p: 1, t: 0, r: 0 }),
    ];
    const r = solve(frame, clues);
    expect(r.contradiction).toBe(true);
    expect(answers(frame, clues)).toEqual([]);
    expect(r.tier).toBeLessThan(3);
  });
});
