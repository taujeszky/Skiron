import { describe, it, expect } from "vitest";
import { bit, popcount } from "../../bits";
import { RNG } from "../../rng";
import { isLegal } from "../../axioms";
import { buildFloorPlan } from "../../map";
import { holds } from "../../clues";
import { simulateTruth } from "../../world/simulate";
import { corridorPlan, frameOf } from "../../testkit";
import { noRules } from "../../types";
import { answers } from "../exhaustive";
import { RULE_IDS, culpritMask } from "../state";
import { solve } from "../solve";
import type { RuleId } from "../state";
import type { SolveResult } from "../solve";
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

/** Did this rule actually do anything in that run? */
function fired(r: SolveResult, rule: RuleId): boolean {
  return r.steps.some((st) => st.rule === rule);
}

/**
 * A rule, with a board where it must fire and a board where it must not.
 *
 * Reading the step record rather than the resulting state is what makes the
 * negative half worth anything: a state assertion cannot tell "this rule did
 * not fire" from "some other rule reached the same conclusion first".
 */
function bothWays(
  name: RuleId,
  frame: CaseFrame,
  when: Clue[],
  unless: Clue[],
  maxTier?: number,
) {
  describe(name, () => {
    it("fires where it must", () => {
      expect(fired(run(frame, when, maxTier), name)).toBe(true);
    });
    it("stays quiet where it must not", () => {
      expect(fired(run(frame, unless, maxTier), name)).toBe(false);
    });
  });
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

/* ================================================= tier 0 — placement ==== */

/**
 * Four rooms in a line (0-1-2-3), three suspects, the victim is person 3,
 * four hours, the body in room 2.
 *
 * Every rule below gets the same board, so the two positions differ only by
 * the cards on the table — which is what makes the pairs readable together.
 */
const line = frameOf({ plan: corridorPlan(4), suspects: 3, slots: 4, murderRoom: 2 });
const VICTIM = line.victim;

describe("tier 0 rules", () => {
  bothWays(
    "clue-at",
    line,
    [fact({ kind: "At", p: 0, t: 0, r: 1 })],
    [fact({ kind: "NotAt", p: 0, t: 0, r: 1 })],
  );

  bothWays(
    "clue-not-at",
    line,
    [fact({ kind: "NotAt", p: 0, t: 0, r: 1 })],
    [fact({ kind: "At", p: 0, t: 0, r: 1 })],
  );

  bothWays(
    "clue-stayed",
    line,
    [fact({ kind: "Stayed", p: 0, r: 1, t1: 0, t2: 2 })],
    [fact({ kind: "At", p: 0, t: 0, r: 1 })],
  );

  bothWays(
    "clue-saw",
    line,
    [fact({ kind: "Saw", p: 0, q: 1, t: 0, r: 1 })],
    // `Together` is the same sighting with the room left out, and the room is
    // exactly what this rule needs.
    [fact({ kind: "Together", p: 0, q: 1, t: 0 })],
  );

  bothWays(
    "clue-alone",
    line,
    [fact({ kind: "AloneIn", p: 0, t: 0, r: 1 })],
    [fact({ kind: "At", p: 0, t: 0, r: 1 })],
  );

  bothWays(
    "clue-empty",
    line,
    [fact({ kind: "Empty", r: 1, t: 0 })],
    [fact({ kind: "Occupied", r: 1, t: 0 })],
  );

  bothWays(
    "clue-never-visited",
    line,
    [fact({ kind: "NeverVisited", p: 0, r: 1 })],
    [fact({ kind: "Visited", p: 0, r: 1 })],
  );

  bothWays(
    "clue-alive-at",
    line,
    [fact({ kind: "AliveAt", t: 1 })],
    [fact({ kind: "At", p: 0, t: 0, r: 1 })],
  );

  bothWays(
    "clue-death-window",
    line,
    [fact({ kind: "DeathWindow", a: 1, b: 2 })],
    [fact({ kind: "AliveAt", t: 0 })],
  );

  bothWays(
    "victim-seen-alive",
    line,
    // Somebody had the victim in sight, so the victim was still breathing.
    [fact({ kind: "Saw", p: 0, q: VICTIM, t: 1, r: 1 })],
    // The same card between two suspects says nothing about the victim.
    [fact({ kind: "Saw", p: 0, q: 1, t: 1, r: 1 })],
  );

  bothWays(
    "body-at-end",
    line,
    // With nothing on the table at all, the body is still in the room it was
    // found in when the evening ends.
    [],
    // ... unless a card has already put it there, and then the rule has
    // nothing left to say.
    [fact({ kind: "At", p: VICTIM, t: line.slots - 1, r: 2 })],
  );

  bothWays(
    "opportunity",
    line,
    // Suspect 0 was at the far end of the house in the first hour, so the
    // first hour is not one they could have done it in.
    [fact({ kind: "At", p: 0, t: 0, r: 0 })],
    [],
    0,
  );

  bothWays(
    "witness-in-room",
    line,
    // Suspect 0 cannot have been anywhere but the body's room at that hour,
    // so at that hour nobody else can have been the killer.
    [fact({ kind: "At", p: 0, t: 1, r: 2 })],
    [fact({ kind: "At", p: 0, t: 1, r: 1 })],
  );

  bothWays(
    "sealed-after",
    line,
    [fact({ kind: "At", p: 0, t: 1, r: 2 })],
    // The same card in the first hour: there are no earlier hours for the
    // rule to seal off.
    [fact({ kind: "At", p: 0, t: 0, r: 2 })],
  );

  bothWays(
    "sealed-back",
    line,
    // The murder was over by the second hour, so for the rest of the evening
    // the body's room held nobody but the body and the killer.
    [fact({ kind: "DeathWindow", a: 0, b: 1 })],
    [],
    0,
  );

  bothWays(
    "victim-not-yet-dead",
    line,
    // The victim was somewhere other than the room they were found in, so
    // they had not been killed yet.
    [fact({ kind: "At", p: VICTIM, t: 1, r: 0 })],
    [],
    0,
  );
});

/* ================================================== tier 1 — movement ==== */

describe("tier 1 rules", () => {
  // Four rooms in a line with the body at the far end: room 0 cannot reach
  // room 3 in one step, so where the body lies in the last hour bites
  // backwards along everybody's timeline.
  const far = frameOf({ plan: corridorPlan(4), suspects: 2, slots: 2, murderRoom: 3 });
  // Three rooms with the body in the middle one. Every room has a door to
  // room 1, so nothing about reaching the body narrows anything — which is
  // what makes this the board on which movement is silent.
  const hub = frameOf({ plan: corridorPlan(3), suspects: 2, slots: 2, murderRoom: 1 });

  it("reach-forward fires where it must", () => {
    // Pinned to one end of the house, suspect 0 cannot be at the other end
    // an hour later.
    expect(fired(run(far, [fact({ kind: "At", p: 0, t: 0, r: 0 })]), "reach-forward"))
      .toBe(true);
  });

  it("reach-backward fires where it must", () => {
    // The body is in the far room at the last hour, so an hour earlier it
    // was somewhere a door away from it, and not just anywhere.
    expect(fired(run(far, []), "reach-backward")).toBe(true);
  });

  it("neither fires when every room already leads where it must", () => {
    // Both negatives share a board rather than a card, because movement is
    // not something a card switches on: it is silent exactly when the house
    // makes it silent. Here every room has a door to the body's room, so
    // nothing about reaching it narrows anything.
    const r = run(hub, []);
    expect(fired(r, "reach-forward")).toBe(false);
    expect(fired(r, "reach-backward")).toBe(false);
  });
});

/* ======================================== every rule, at least somewhere == */

interface Shape {
  suspects: number;
  rooms: number;
  slots: number;
  lying: boolean;
  /** Give the house room capacities the truth already respects. */
  caps: boolean;
}

/** A generated case with a thin scatter of true cards, plus a lie or two. */
function randomCase(
  seed: string,
  size: Shape,
  density: number,
): { frame: CaseFrame; clues: Clue[] } | null {
  const rng = new RNG(seed);
  const plan = buildFloorPlan(rng, { rooms: size.rooms });
  const res = simulateTruth(
    rng,
    {
      plan,
      rules: noRules(),
      suspects: size.suspects,
      slots: size.slots,
      lying: size.lying,
    },
    { minMeetings: 0, minVictimCompany: 0 },
  );
  if (!res) return null;
  const world = res.world;
  let frame = res.frame;
  if (size.caps) {
    // Built from the truth, so the case stays legal and the rules stay true.
    const rules = noRules();
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      if (!rng.chance(0.5)) continue;
      let worst = 0;
      for (let t = 0; t < frame.slots; t++) {
        let n = 0;
        for (let p = 0; p < frame.people; p++) {
          const living = p !== frame.victim || t < world.murderSlot;
          if (world.loc[p][t] === r && living) n++;
        }
        if (n > worst) worst = n;
      }
      rules.capacities.push({ room: r, max: Math.max(1, worst) });
    }
    const framed = { ...frame, rules };
    if (isLegal(framed, world)) frame = framed;
  }
  const out: Clue[] = [];
  const add = (body: ClueBody, speaker: number | null) => {
    if (!holds(body, frame, world)) return;
    if (!rng.chance(density)) return;
    out.push({
      id: `g${out.length}`,
      body,
      source: speaker === null ? { kind: "fact" } : { kind: "testimony", speaker },
    });
  };
  const R = frame.plan.rooms.length;
  for (let p = 0; p < frame.people; p++) {
    const teller = p < frame.suspects ? p : null;
    for (let t = 0; t < frame.slots; t++) {
      for (let r = 0; r < R; r++) {
        add({ kind: "At", p, t, r }, teller);
        add({ kind: "NotAt", p, t, r }, teller);
        add({ kind: "AloneIn", p, t, r }, teller);
      }
    }
    for (let r = 0; r < R; r++) {
      add({ kind: "Visited", p, r }, teller);
      add({ kind: "NeverVisited", p, r }, teller);
    }
    for (let t1 = 0; t1 + 1 < frame.slots; t1++) {
      for (let t2 = t1 + 1; t2 < frame.slots; t2++) {
        for (let r = 0; r < R; r++) add({ kind: "Stayed", p, r, t1, t2 }, teller);
      }
    }
  }
  for (let p = 0; p < frame.people; p++) {
    for (let q = p + 1; q < frame.people; q++) {
      const teller = p < frame.suspects ? p : null;
      for (let t = 0; t < frame.slots; t++) {
        add({ kind: "Together", p, q, t }, teller);
        for (let r = 0; r < R; r++) add({ kind: "Saw", p, q, t, r }, teller);
      }
    }
  }
  for (let r = 0; r < R; r++) {
    for (let t = 0; t < frame.slots; t++) {
      add({ kind: "Occupied", r, t }, null);
      add({ kind: "Empty", r, t }, null);
      for (let k = 0; k <= frame.people; k++) add({ kind: "Count", r, t, k }, null);
    }
  }
  for (let t = 0; t < frame.slots; t++) add({ kind: "AliveAt", t }, null);
  for (let a = 0; a < frame.slots; a++) {
    for (let b = a; b < frame.slots; b++) add({ kind: "DeathWindow", a, b }, null);
  }
  for (const cap of frame.rules.capacities) {
    add({ kind: "Capacity", r: cap.room, k: cap.max }, null);
  }
  // The trust tier needs somebody to have lied, and only the culprit may.
  if (size.lying) {
    for (let t = 0; t < frame.slots; t++) {
      for (let r = 0; r < R; r++) {
        const body: ClueBody = { kind: "At", p: world.culprit, t, r };
        if (holds(body, frame, world) || !rng.chance(0.08)) continue;
        out.push({
          id: `l${out.length}`,
          body,
          source: { kind: "testimony", speaker: world.culprit },
        });
      }
    }
  }
  return { frame, clues: rng.shuffle(out) };
}

describe("tier 3 is about testimony, or it is not tier 3", () => {
  const SHAPES: Shape[] = [
    { suspects: 4, rooms: 6, slots: 6, lying: true, caps: false },
    { suspects: 5, rooms: 7, slots: 7, lying: true, caps: true },
  ];

  /** Every card the player holds, with the statements thrown away. */
  function factsOnly(clues: Clue[]): Clue[] {
    return clues.filter((c) => c.source.kind === "fact");
  }

  it("never fires on a notebook that holds no statements at all", () => {
    // The defect this guards against is not unsoundness — the deduction is
    // valid either way. It is that the case would be graded Hard for a
    // matter of trust on a table with nobody's word on it.
    //
    // Said plainly, because it matters when reading a green suite: this is a
    // statement of the property, not a tight test of the guard. The guard is
    // structural (allSpeak in tier3.ts), and 32,000 facts-only cases over
    // 160 shapes and five densities were searched with it removed without
    // finding one in which it is what does the preventing. So deleting the
    // guard would not turn this red. It stays because it costs a scan of the
    // clue list, and because a reviewer produced a case where the rule fired
    // on a suspect who had never spoken.
    let cases = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const size of SHAPES) {
        for (const density of [0.02, 0.05, 0.1]) {
          const c = randomCase(`silent:${seed}:${size.rooms}:${density}`, size, density);
          if (!c) continue;
          const clues = factsOnly(c.clues);
          cases++;
          const r = solve(c.frame, clues);
          expect(fired(r, "self-incrimination"), `seed ${seed}`).toBe(false);
          expect(fired(r, "conflict-pair"), `seed ${seed}`).toBe(false);
          // Tier 4 may still be needed; what must not happen is a grade of
          // 3, which would mean the case was called a matter of trust.
          expect(r.tier).not.toBe(3);
        }
      }
    }
    expect(cases).toBeGreaterThan(100);
  });

  it("still fires once the same cases carry statements", () => {
    // Guard the guard: the assertions above would hold for a tier 3 that had
    // stopped working altogether.
    let withSpeech = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const size of SHAPES) {
        for (const density of [0.02, 0.05, 0.1]) {
          const c = randomCase(`silent:${seed}:${size.rooms}:${density}`, size, density);
          if (!c) continue;
          const r = solve(c.frame, c.clues);
          if (fired(r, "self-incrimination") || fired(r, "conflict-pair")) withSpeech++;
        }
      }
    }
    expect(withSpeech).toBeGreaterThan(10);
  });

  it("only ever names suspects the player has actually heard from", () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const size of SHAPES) {
        const c = randomCase(`heard:${seed}:${size.rooms}`, size, 0.05);
        if (!c) continue;
        const spoke = new Set(
          c.clues
            .filter((x) => x.source.kind === "testimony")
            .map((x) => (x.source as { speaker: PersonId }).speaker),
        );
        for (const st of solve(c.frame, c.clues).steps) {
          if (st.rule !== "self-incrimination" && st.rule !== "conflict-pair") continue;
          for (const p of st.premises.assumedInnocent ?? []) {
            expect(spoke.has(p), `tier 3 named silent suspect ${p}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("rule coverage", () => {
  it("has a case in which each rule actually fires", () => {
    // The census the minimal positions cannot give on their own. A rule that
    // quietly stops firing is invisible to the soundness oracle, which can
    // only ever complain about eliminations that were made — and the tier-4
    // rules need a corpus to reach at all, so they are covered here rather
    // than by a hand-built board.
    const seen = new Set<RuleId>();
    const SHAPES: Shape[] = [
      { suspects: 3, rooms: 4, slots: 4, lying: false, caps: false },
      { suspects: 3, rooms: 4, slots: 4, lying: false, caps: true },
      { suspects: 4, rooms: 6, slots: 6, lying: true, caps: false },
      { suspects: 4, rooms: 6, slots: 6, lying: true, caps: true },
      { suspects: 5, rooms: 7, slots: 7, lying: true, caps: true },
    ];
    let cases = 0;
    for (let seed = 0; seed < 25; seed++) {
      for (const size of SHAPES) {
        // A spread of densities: the rarest rules live at one end of it.
        // `visited-last-slot` fires in about one case in thirty.
        for (const density of [0.02, 0.05, 0.1]) {
          const c = randomCase(`census:${seed}:${size.rooms}:${density}:${size.caps}`, size, density);
          if (!c) continue;
          cases++;
          for (const step of solve(c.frame, c.clues).steps) seen.add(step.rule);
        }
      }
    }
    expect(cases).toBeGreaterThan(300);
    const missing = (RULE_IDS as RuleId[]).filter((r) => !seen.has(r));
    expect(missing, `rules that never fired: ${missing.join(", ")}`).toEqual([]);
  });
});
