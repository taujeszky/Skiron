import { describe, it, expect } from "vitest";
import {
  barredFromRoom,
  canMove,
  isLegal,
  presentMask,
} from "../axioms";
import { clueHolds, holds, validBody } from "../clues";
import { RNG } from "../rng";
import { corridorPlan, frameOf, gridPlan, worldOf } from "../testkit";
import type {
  Answer,
  CaseFrame,
  CaseRules,
  Clue,
  ClueBody,
  PersonId,
  RoomId,
  SlotIndex,
  World,
} from "../types";
import { noRules } from "../types";
import {
  answerKey,
  answerPossible,
  answers,
  cellPossible,
  findWorld,
} from "./exhaustive";

/* --------------------------------------------------------- small helpers */

let serial = 0;

function fact(body: ClueBody): Clue {
  return { id: `f${serial++}`, body, source: { kind: "fact" } };
}

function says(speaker: PersonId, body: ClueBody): Clue {
  return { id: `s${serial++}`, body, source: { kind: "testimony", speaker } };
}

function keysOf(list: readonly Answer[]): string[] {
  return list.map(answerKey);
}

/** Every hand-built world goes through here, so a typo cannot pass as data. */
function legal(frame: CaseFrame, world: World): World {
  if (!isLegal(frame, world)) throw new Error("test world is not legal");
  return world;
}

/* ============================================================ hand-built */

/*
 * Three rooms in a line, 0 - 1 - 2. Three suspects (p0, p1, p2) and the
 * victim (p3). Three slots. The body is found in room 0.
 *
 *         t=0 t=1 t=2
 *   p0      2   1   0   the killer: walks down the corridor and strikes
 *   p1      2   2   2
 *   p2      1   1   1
 *   p3(V)   0   0   0   killed in slot 2, where he had sat all evening
 *
 * `PINS` nails down everybody but the killer, which leaves an answer set
 * small enough to work out on paper — and that is the point of this file's
 * first two tests: they are hand-computed, not solver-computed.
 */
const CORRIDOR = corridorPlan(3);
const HOUSE = frameOf({
  plan: CORRIDOR,
  suspects: 3,
  slots: 3,
  murderRoom: 0,
});
const HOUSE_LYING = frameOf({
  plan: CORRIDOR,
  suspects: 3,
  slots: 3,
  murderRoom: 0,
  lying: true,
});

const TRUTH = legal(
  HOUSE,
  worldOf(
    [
      [2, 1, 0],
      [2, 2, 2],
      [1, 1, 1],
      [0, 0, 0],
    ],
    0,
    2,
  ),
);

const PINS: Clue[] = [
  fact({ kind: "Stayed", p: 3, r: 0, t1: 0, t2: 2 }),
  fact({ kind: "Stayed", p: 1, r: 2, t1: 0, t2: 2 }),
  fact({ kind: "Stayed", p: 2, r: 1, t1: 0, t2: 2 }),
];

describe("a hand-built case with an answer set worked out on paper", () => {
  it("issues only clues that are true of the truth", () => {
    for (const clue of PINS) {
      expect(clueHolds(HOUSE, clue, TRUTH)).toBe(true);
    }
  });

  it("leaves p0 and all three slots open when only the others are pinned", () => {
    // p1 never leaves room 2 and p2 never leaves room 1, so neither can ever
    // be alone with the body in room 0: the culprit must be p0. Every slot is
    // still open to him — he can start in room 0, or walk to it in one or two
    // steps — so the answer set is exactly his three.
    expect(keysOf(answers(HOUSE, PINS))).toEqual(["c0t0", "c0t1", "c0t2"]);
  });

  it("collapses to the truth once p0's opening move is known", () => {
    // Add "p0 was in room 2 at eight". Slot 0 is out because he was not in
    // room 0, and slot 1 is out because room 2 does not touch room 0 — a
    // corridor has no short cut. Only the true answer survives.
    const tight = [...PINS, fact({ kind: "At", p: 0, t: 0, r: 2 })];
    expect(keysOf(answers(HOUSE, tight))).toEqual(["c0t2"]);
    expect(answerPossible(HOUSE, tight, { culprit: 0, slot: 2 })).toBe(true);
    expect(answerPossible(HOUSE, tight, { culprit: 0, slot: 1 })).toBe(false);
    expect(answerPossible(HOUSE, tight, { culprit: 1, slot: 2 })).toBe(false);
  });

  it("hands back a witness world that stands on its own", () => {
    const world = findWorld(HOUSE, PINS, { culprit: 0, slot: 1 });
    expect(world).not.toBeNull();
    if (world === null) return;
    expect(world.culprit).toBe(0);
    expect(world.murderSlot).toBe(1);
    expect(isLegal(HOUSE, world)).toBe(true);
    for (const clue of PINS) expect(clueHolds(HOUSE, clue, world)).toBe(true);
    expect(presentMask(HOUSE, world, 0, 1)).toBe(1);
  });

  it("refuses an answer that names a non-suspect or a slot off the clock", () => {
    expect(answerPossible(HOUSE, PINS, { culprit: 3, slot: 0 })).toBe(false);
    expect(answerPossible(HOUSE, PINS, { culprit: 0, slot: 9 })).toBe(false);
  });
});

/* ================================================================= lying */

describe("lying, where the answer turns on dropping the culprit's words", () => {
  // p0's alibi: "I was in room 2 at ten." In the truth he was in room 0 with
  // the body, so it is a lie — and in the true world it is vacuously true,
  // because there the speaker IS the culprit (rule 7).
  const ALIBI = says(0, { kind: "At", p: 0, t: 2, r: 2 });
  const WITH_ALIBI = [...PINS, ALIBI];

  it("is a lie that the true world still satisfies", () => {
    expect(holds(ALIBI.body, HOUSE_LYING, TRUTH)).toBe(false);
    expect(clueHolds(HOUSE_LYING, ALIBI, TRUTH)).toBe(true);
    expect(clueHolds(HOUSE, ALIBI, TRUTH)).toBe(false);
  });

  it("believes the alibi when lying is off, and convicts the wrong hour", () => {
    // Taken at face value the alibi rules out slots 1 and 2: he cannot be in
    // room 0 at ten, and he cannot get from room 0 at nine to room 2 at ten.
    // Slot 0 is all that is left — and it is not what happened.
    expect(keysOf(answers(HOUSE, WITH_ALIBI))).toEqual(["c0t0"]);
    expect(
      answerPossible(HOUSE, WITH_ALIBI, { culprit: 0, slot: 2 }),
    ).toBe(false);
  });

  it("drops the alibi when lying is on, and keeps the truth in the set", () => {
    // The same words, from a case where the killer may lie: for the candidate
    // "p0 did it" the statement says nothing at all, so his three slots come
    // back. Nobody else's candidacy changes, because the facts still pin them.
    expect(keysOf(answers(HOUSE_LYING, WITH_ALIBI))).toEqual([
      "c0t0",
      "c0t1",
      "c0t2",
    ]);
    expect(
      answerPossible(HOUSE_LYING, WITH_ALIBI, { culprit: 0, slot: 2 }),
    ).toBe(true);
  });

  it("still believes an innocent saying exactly the same thing", () => {
    // Rule 7 drops only the *candidate's* testimony. p1 accusing p0 of being
    // in room 2 binds every candidate but p1 — and p1 is pinned out of room 0
    // by a fact, so the case closes on slot 0 again.
    const fromP1 = [...PINS, says(1, { kind: "At", p: 0, t: 2, r: 2 })];
    expect(keysOf(answers(HOUSE_LYING, fromP1))).toEqual(["c0t0"]);
  });
});

/* ====================================== the naive reference, per scenario */

/**
 * Every world there is, by exhaustive product over `loc`, filtered by
 * `isLegal` and `clueHolds`. Quite unusable on a real case and completely
 * beyond doubt on a small one, which is exactly the trade a reference wants:
 * it shares no code with the solver but the two definitions the solver is
 * supposed to be honouring.
 */
function naiveWorlds(frame: CaseFrame, clues: readonly Clue[]): World[] {
  const P = frame.people;
  const T = frame.slots;
  const R = frame.plan.rooms.length;
  const cells = P * T;
  const digits = new Array<number>(cells).fill(0);
  const out: World[] = [];

  for (;;) {
    const loc: RoomId[][] = [];
    for (let p = 0; p < P; p++) loc.push(digits.slice(p * T, p * T + T));
    for (let c = 0; c < frame.suspects; c++) {
      for (let t = 0; t < T; t++) {
        const world: World = { loc, culprit: c, murderSlot: t };
        if (!isLegal(frame, world)) continue;
        if (!clues.every((clue) => clueHolds(frame, clue, world))) continue;
        out.push({
          loc: loc.map((row) => [...row]),
          culprit: c,
          murderSlot: t,
        });
      }
    }
    let i = cells - 1;
    while (i >= 0) {
      digits[i]++;
      if (digits[i] < R) break;
      digits[i] = 0;
      i--;
    }
    if (i < 0) break;
  }
  return out;
}

function naiveAnswerKeys(worlds: readonly World[]): string[] {
  const keys = new Set<string>();
  for (const w of worlds) {
    keys.add(answerKey({ culprit: w.culprit, slot: w.murderSlot }));
  }
  return [...keys].sort();
}

/*
 * Three rooms in a line again, but only two suspects and three slots, so the
 * product is 3^9 grids: small enough to enumerate outright.
 *
 * The truth every satisfiable scenario below is built from:
 *
 *         t=0 t=1 t=2
 *   p0      0   1   1   the killer
 *   p1      2   2   2
 *   p2(V)   1   1   1   killed in slot 1, in the room he never left
 */
const TINY_PLAN = corridorPlan(3);
const DOOR_01 = 0;
const DOOR_12 = 1;

function tiny(opts: { lying?: boolean; rules?: CaseRules } = {}): CaseFrame {
  return frameOf({
    plan: TINY_PLAN,
    suspects: 2,
    slots: 3,
    murderRoom: 1,
    lying: opts.lying ?? false,
    rules: opts.rules ?? noRules(),
  });
}

const TINY = tiny();
const TINY_LYING = tiny({ lying: true });
const TINY_RULES = tiny({
  rules: {
    closures: [{ door: DOOR_12, from: 1, to: 2 }],
    doorBars: [],
    roomBars: [{ person: 1, room: 0 }],
    capacities: [{ room: 2, max: 1 }],
  },
});

const TINY_TRUTH = legal(
  TINY,
  worldOf(
    [
      [0, 1, 1],
      [2, 2, 2],
      [1, 1, 1],
    ],
    0,
    1,
  ),
);

const RING = frameOf({
  plan: gridPlan(2, 2),
  suspects: 2,
  slots: 3,
  murderRoom: 3,
});

interface Scenario {
  name: string;
  frame: CaseFrame;
  clues: Clue[];
  /** A deliberately contradictory set is allowed to have no worlds at all. */
  empty?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "no clues at all", frame: TINY, clues: [] },
  {
    name: "facts that pin two people",
    frame: TINY,
    clues: [
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
      fact({ kind: "Stayed", p: 1, r: 2, t1: 0, t2: 2 }),
    ],
  },
  {
    name: "heads counted in rooms",
    frame: TINY,
    clues: [
      fact({ kind: "Empty", r: 0, t: 1 }),
      fact({ kind: "Occupied", r: 1, t: 0 }),
      fact({ kind: "Count", r: 2, t: 1, k: 1 }),
    ],
  },
  {
    name: "company and comings and goings",
    frame: TINY,
    clues: [
      fact({ kind: "AloneIn", p: 1, t: 0, r: 2 }),
      fact({ kind: "NotAt", p: 0, t: 2, r: 0 }),
      fact({ kind: "Visited", p: 0, r: 1 }),
      fact({ kind: "NeverVisited", p: 1, r: 0 }),
    ],
  },
  {
    name: "the victim's clock",
    frame: TINY,
    clues: [
      fact({ kind: "AliveAt", t: 0 }),
      fact({ kind: "DeathWindow", a: 0, b: 1 }),
    ],
  },
  {
    name: "a sighting that names a room",
    frame: TINY,
    clues: [
      fact({ kind: "Saw", p: 0, q: 2, t: 0, r: 1 }),
      fact({ kind: "Together", p: 0, q: 2, t: 0 }),
    ],
  },
  {
    name: "a testimony dropped from its speaker's candidacy",
    frame: TINY_LYING,
    clues: [
      fact({ kind: "Stayed", p: 1, r: 2, t1: 0, t2: 2 }),
      says(0, { kind: "At", p: 0, t: 2, r: 0 }),
    ],
  },
  {
    name: "the same testimony, believed",
    frame: TINY,
    clues: [
      fact({ kind: "Stayed", p: 1, r: 2, t1: 0, t2: 2 }),
      says(0, { kind: "At", p: 0, t: 2, r: 0 }),
    ],
  },
  {
    name: "case-file rules on the frame and on cards",
    frame: TINY_RULES,
    clues: [
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
      fact({ kind: "DoorClosed", door: DOOR_12, from: 1, to: 2 }),
      fact({ kind: "BarredRoom", p: 1, r: 0 }),
      fact({ kind: "Capacity", r: 2, k: 1 }),
    ],
  },
  {
    name: "rule clues the frame has never heard of",
    frame: TINY,
    clues: [
      fact({ kind: "DoorClosed", door: DOOR_01, from: 0, to: 2 }),
      fact({ kind: "BarredDoor", p: 1, door: DOOR_12 }),
    ],
  },
  {
    name: "a flat contradiction",
    frame: TINY,
    clues: [
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
      fact({ kind: "At", p: 0, t: 0, r: 2 }),
    ],
    empty: true,
  },
  {
    name: "a house with a cycle in it",
    frame: RING,
    clues: [
      fact({ kind: "At", p: 0, t: 0, r: 0 }),
      fact({ kind: "Occupied", r: 3, t: 1 }),
    ],
  },
];

describe("against a naive enumeration of every legal world", () => {
  for (const s of SCENARIOS) {
    it(`agrees on ${s.name}`, () => {
      const worlds = naiveWorlds(s.frame, s.clues);
      if (s.empty) expect(worlds).toHaveLength(0);
      else expect(worlds.length).toBeGreaterThan(0);

      expect(keysOf(answers(s.frame, s.clues))).toEqual(
        naiveAnswerKeys(worlds),
      );

      for (let p = 0; p < s.frame.people; p++) {
        for (let t = 0; t < s.frame.slots; t++) {
          for (let r = 0; r < s.frame.plan.rooms.length; r++) {
            const naive = worlds.some((w) => w.loc[p][t] === r);
            expect([p, t, r, cellPossible(s.frame, s.clues, p, t, r)]).toEqual([
              p,
              t,
              r,
              naive,
            ]);
          }
        }
      }
    });
  }

  it("makes cellPossible and a pinned findWorld the same question", () => {
    for (const s of SCENARIOS.slice(0, 8)) {
      const found = answers(s.frame, s.clues);
      for (let p = 0; p < s.frame.people; p++) {
        for (let t = 0; t < s.frame.slots; t++) {
          for (let r = 0; r < s.frame.plan.rooms.length; r++) {
            const pinned = found.some((a) => {
              const w = findWorld(s.frame, s.clues, a, { p, t, r });
              return w !== null && w.loc[p][t] === r;
            });
            expect(cellPossible(s.frame, s.clues, p, t, r)).toBe(pinned);
          }
        }
      }
    }
  });
});

/* =============================================================== property */

/** The rooms `p` may stand in at `t + 1`, coming from `from`. */
function roomsFrom(
  frame: CaseFrame,
  p: PersonId,
  from: RoomId,
  t: SlotIndex,
): RoomId[] {
  const out: RoomId[] = [];
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    if (barredFromRoom(frame, p, r)) continue;
    if (canMove(frame, p, from, r, t)) out.push(r);
  }
  return out;
}

/** The rooms `p` may have come from at `t`, to be in `to` at `t + 1`. */
function roomsInto(
  frame: CaseFrame,
  p: PersonId,
  to: RoomId,
  t: SlotIndex,
): RoomId[] {
  const out: RoomId[] = [];
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    if (barredFromRoom(frame, p, r)) continue;
    if (canMove(frame, p, r, to, t)) out.push(r);
  }
  return out;
}

/**
 * A legal evening, built rather than searched for: the body walked backwards
 * out of the room it was found in, the killer placed on top of it at `t*`,
 * and the innocents walked forwards under one ban — keep out of `r*` once the
 * murder has happened. `isLegal` still has the last word, because capacities
 * and the like are easier to check than to respect.
 *
 * This is the oracle's own test data on purpose: it must not lean on
 * `world/simulate.ts`, whose output it will later be used to certify.
 */
function randomWorld(rng: RNG, frame: CaseFrame): World | null {
  const T = frame.slots;
  const V = frame.victim;
  const rStar = frame.murderRoom;
  const c = rng.int(frame.suspects);
  const tStar = rng.int(T);

  const loc: RoomId[][] = [];
  for (let p = 0; p < frame.people; p++) loc.push(new Array<RoomId>(T).fill(0));

  for (let t = tStar; t < T; t++) loc[V][t] = rStar;
  for (let t = tStar - 1; t >= 0; t--) {
    const opts = roomsInto(frame, V, loc[V][t + 1], t);
    if (opts.length === 0) return null;
    loc[V][t] = rng.pick(opts);
  }

  loc[c][tStar] = rStar;
  for (let t = tStar - 1; t >= 0; t--) {
    const opts = roomsInto(frame, c, loc[c][t + 1], t);
    if (opts.length === 0) return null;
    loc[c][t] = rng.pick(opts);
  }
  for (let t = tStar + 1; t < T; t++) {
    const opts = roomsFrom(frame, c, loc[c][t - 1], t - 1);
    if (opts.length === 0) return null;
    loc[c][t] = rng.pick(opts);
  }

  for (let p = 0; p < frame.people; p++) {
    if (p === c || p === V) continue;
    const open = (r: RoomId, t: SlotIndex): boolean =>
      !barredFromRoom(frame, p, r) && !(t >= tStar && r === rStar);
    const first: RoomId[] = [];
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      if (open(r, 0)) first.push(r);
    }
    if (first.length === 0) return null;
    loc[p][0] = rng.pick(first);
    for (let t = 1; t < T; t++) {
      const opts = roomsFrom(frame, p, loc[p][t - 1], t - 1).filter((r) =>
        open(r, t),
      );
      if (opts.length === 0) return null;
      loc[p][t] = rng.pick(opts);
    }
  }

  const world: World = { loc, culprit: c, murderSlot: tStar };
  return isLegal(frame, world) ? world : null;
}

/** Every well formed body of every kind that is TRUE in this world. */
function truePool(frame: CaseFrame, world: World): ClueBody[] {
  const T = frame.slots;
  const P = frame.people;
  const R = frame.plan.rooms.length;
  const E = frame.plan.doors.length;
  const all: ClueBody[] = [];

  for (let p = 0; p < P; p++) {
    for (let t = 0; t < T; t++) {
      for (let r = 0; r < R; r++) {
        all.push({ kind: "At", p, t, r });
        all.push({ kind: "NotAt", p, t, r });
        all.push({ kind: "AloneIn", p, t, r });
      }
    }
    for (let r = 0; r < R; r++) {
      all.push({ kind: "Visited", p, r });
      all.push({ kind: "NeverVisited", p, r });
      all.push({ kind: "BarredRoom", p, r });
      for (let t1 = 0; t1 < T; t1++) {
        for (let t2 = t1 + 1; t2 < T; t2++) {
          all.push({ kind: "Stayed", p, r, t1, t2 });
        }
      }
    }
    for (let q = p + 1; q < P; q++) {
      for (let t = 0; t < T; t++) {
        all.push({ kind: "Together", p, q, t });
        for (let r = 0; r < R; r++) all.push({ kind: "Saw", p, q, t, r });
      }
    }
    for (let e = 0; e < E; e++) all.push({ kind: "BarredDoor", p, door: e });
  }

  for (let r = 0; r < R; r++) {
    for (let t = 0; t < T; t++) {
      all.push({ kind: "Occupied", r, t });
      all.push({ kind: "Empty", r, t });
      for (let k = 0; k <= P; k++) all.push({ kind: "Count", r, t, k });
    }
    for (let k = 1; k <= P; k++) all.push({ kind: "Capacity", r, k });
  }

  for (let t = 0; t < T; t++) all.push({ kind: "AliveAt", t });
  for (let a = 0; a < T; a++) {
    for (let b = a; b < T; b++) all.push({ kind: "DeathWindow", a, b });
  }
  for (let e = 0; e < E; e++) {
    for (let from = 0; from < T; from++) {
      for (let to = from + 1; to < T; to++) {
        all.push({ kind: "DoorClosed", door: e, from, to });
      }
    }
  }

  return all.filter((b) => validBody(b, frame) && holds(b, frame, world));
}

/** A statement about the killer's whereabouts that is simply not so. */
function lieFrom(rng: RNG, frame: CaseFrame, world: World): ClueBody {
  const R = frame.plan.rooms.length;
  const t = rng.int(frame.slots);
  const here = world.loc[world.culprit][t];
  const r = (here + 1 + rng.int(R - 1)) % R;
  return { kind: "At", p: world.culprit, t, r };
}

const PROPERTY_FRAMES: { name: string; frame: CaseFrame }[] = [
  {
    name: "a corridor",
    frame: frameOf({
      plan: corridorPlan(4),
      suspects: 3,
      slots: 4,
      murderRoom: 1,
    }),
  },
  {
    name: "a ring of four rooms, with lying",
    frame: frameOf({
      plan: gridPlan(2, 2),
      suspects: 3,
      slots: 4,
      murderRoom: 3,
      lying: true,
    }),
  },
  {
    name: "six rooms under case-file rules, with lying",
    frame: frameOf({
      plan: gridPlan(3, 2),
      suspects: 3,
      slots: 5,
      murderRoom: 4,
      lying: true,
      rules: {
        closures: [{ door: 0, from: 1, to: 3 }],
        doorBars: [],
        roomBars: [{ person: 2, room: 0 }],
        capacities: [{ room: 1, max: 2 }],
      },
    }),
  },
];

describe("the true answer is never eliminated", () => {
  for (const { name, frame } of PROPERTY_FRAMES) {
    it(`survives fifty random evenings in ${name}`, () => {
      let evenings = 0;
      for (let seed = 0; seed < 50; seed++) {
        const rng = new RNG(`skiron-oracle-${name}-${seed}`);
        let world: World | null = null;
        for (let attempt = 0; attempt < 40 && world === null; attempt++) {
          world = randomWorld(rng, frame);
        }
        if (world === null) continue;
        evenings++;

        const truth: Answer = {
          culprit: world.culprit,
          slot: world.murderSlot,
        };
        const pool = rng.shuffle(truePool(frame, world));
        expect(pool.length).toBeGreaterThan(0);

        // A handful of true cards: some anonymous physical evidence, some
        // spoken by an innocent. Both bind every candidate the solver will
        // consider, so neither may push the truth out of the set.
        const clues: Clue[] = [];
        const take = 1 + rng.int(8);
        for (let i = 0; i < take && i < pool.length; i++) {
          const body = pool[i];
          if (rng.chance(0.5)) {
            clues.push(fact(body));
            continue;
          }
          const innocents: PersonId[] = [];
          for (let p = 0; p < frame.suspects; p++) {
            if (p !== world.culprit) innocents.push(p);
          }
          clues.push(says(rng.pick(innocents), body));
        }

        // And, where the killer may lie, one statement of his that is false.
        // It is vacuously true in the true world, so the truth stays in.
        if (frame.lying) {
          const lie = says(world.culprit, lieFrom(rng, frame, world));
          expect(holds(lie.body, frame, world)).toBe(false);
          expect(clueHolds(frame, lie, world)).toBe(true);
          clues.push(lie);
        }

        for (const clue of clues) {
          expect(clueHolds(frame, clue, world)).toBe(true);
        }

        const found = answers(frame, clues);
        expect(keysOf(found)).toContain(answerKey(truth));
        expect(answerPossible(frame, clues, truth)).toBe(true);

        const witness = findWorld(frame, clues, truth);
        expect(witness).not.toBeNull();
        if (witness === null) continue;
        expect(isLegal(frame, witness)).toBe(true);
        for (const clue of clues) {
          expect(clueHolds(frame, clue, witness)).toBe(true);
        }

        // Where the truth put somebody is, by construction, somewhere they
        // could have been.
        for (let p = 0; p < frame.people; p++) {
          for (let t = 0; t < frame.slots; t++) {
            expect(cellPossible(frame, clues, p, t, world.loc[p][t])).toBe(
              true,
            );
          }
        }
      }
      expect(evenings).toBeGreaterThan(40);
    });
  }
});

/* ============================================================== the limit */

describe("the node limit", () => {
  it("throws rather than return a result it is not sure of", () => {
    expect(() => answers(HOUSE, PINS, { nodeLimit: 1 })).toThrow(
      /node limit/,
    );
    expect(() => cellPossible(HOUSE, PINS, 0, 0, 0, { nodeLimit: 1 })).toThrow(
      /node limit/,
    );
  });

  it("does not bite on a budget a real case fits inside", () => {
    expect(keysOf(answers(HOUSE, PINS, { nodeLimit: 100_000 }))).toEqual([
      "c0t0",
      "c0t1",
      "c0t2",
    ]);
  });
});

/* ============================================================== hygiene */

describe("housekeeping", () => {
  it("refuses a clue that is not a sentence about this case", () => {
    const nonsense = fact({ kind: "At", p: 9, t: 0, r: 0 });
    expect(() => answers(HOUSE, [nonsense])).toThrow(/not well formed/);
  });

  it("keys answers apart and sorts by culprit then slot", () => {
    expect(answerKey({ culprit: 1, slot: 2 })).toBe("c1t2");
    expect(answerKey({ culprit: 1, slot: 2 })).not.toBe(
      answerKey({ culprit: 2, slot: 1 }),
    );
    // Asserted literally, not against a sorted copy of the solver's own
    // output: that version would have passed on an empty answer set, which is
    // precisely the regression an ordering test is there to catch.
    expect(keysOf(answers(tiny(), []))).toEqual([
      "c0t0",
      "c0t1",
      "c0t2",
      "c1t0",
      "c1t1",
      "c1t2",
    ]);
  });
});
