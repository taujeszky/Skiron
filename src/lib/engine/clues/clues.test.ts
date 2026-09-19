import { describe, it, expect } from "vitest";
import { isLegal } from "../axioms";
import { frameOf, gridPlan, worldOf } from "../testkit";
import type {
  CaseFrame,
  Clue,
  ClueBody,
  ClueKind,
  DoorId,
  FloorPlan,
  RoomId,
  World,
} from "../types";
import {
  CLUE_KINDS,
  canonical,
  clueCanonical,
  clueHolds,
  clueMentions,
  clueTopicKeys,
  holds,
  moduleFor,
  normalise,
  topicKeys,
  validBody,
} from "./index";

/*
 * One house, two evenings.
 *
 *   0 1 2      Six rooms, a door on every shared wall. The body is found in
 *   3 4 5      room 4. Three suspects (p0, p1, p2) and the victim (p3).
 *
 * In world A the killer leaves the body behind; in world B he sits with it.
 * That pair of grids is the whole living/dead split in one picture.
 */

const PLAN = gridPlan(3, 2);
const FRAME = frameOf({ plan: PLAN, suspects: 3, slots: 4, murderRoom: 4 });
const LYING = frameOf({
  plan: PLAN,
  suspects: 3,
  slots: 4,
  murderRoom: 4,
  lying: true,
});

/** Every hand-built world goes through here, so a typo cannot pass as data. */
function legal(frame: CaseFrame, world: World): World {
  if (!isLegal(frame, world)) throw new Error("test world is not legal");
  return world;
}

function doorOf(plan: FloorPlan, a: RoomId, b: RoomId): DoorId {
  const e = plan.doorBetween[a * plan.rooms.length + b];
  if (e < 0) throw new Error(`no door between ${a} and ${b}`);
  return e;
}

const D14 = doorOf(PLAN, 1, 4);
const D45 = doorOf(PLAN, 4, 5);

//        t=0  t=1  t=2  t=3
// p0       1    4    4    1   the killer, who leaves
// p1       1    1    0    0
// p2       5    5    2    1
// p3(V)    5    5    4    4   killed in slot 2
const WORLD = legal(
  FRAME,
  worldOf(
    [
      [1, 4, 4, 1],
      [1, 1, 0, 0],
      [5, 5, 2, 1],
      [5, 5, 4, 4],
    ],
    0,
    2,
  ),
);

//        t=0  t=1  t=2  t=3
// p0       0    0    0    0
// p1       1    4    4    4   the killer, who stays
// p2       2    2    2    2
// p3(V)    5    4    4    4   killed in slot 1
const STAYS = legal(
  FRAME,
  worldOf(
    [
      [0, 0, 0, 0],
      [1, 4, 4, 4],
      [2, 2, 2, 2],
      [5, 4, 4, 4],
    ],
    1,
    1,
  ),
);

const worldName = (w: World): string => (w === WORLD ? "A" : "B");

/* ------------------------------------------------------------ the worlds */

describe("the test worlds", () => {
  it("are legal", () => {
    expect(isLegal(FRAME, WORLD)).toBe(true);
    expect(isLegal(FRAME, STAYS)).toBe(true);
    // Lying changes what a testimony demands, never what a world may be.
    expect(isLegal(LYING, WORLD)).toBe(true);
  });
});

/* ------------------------------------------------------------ evaluation */

const HOLDS: ReadonlyArray<[ClueBody, World, boolean]> = [
  // At / NotAt — raw `loc`, so they speak of the body too.
  [{ kind: "At", p: 0, t: 0, r: 1 }, WORLD, true],
  [{ kind: "At", p: 0, t: 0, r: 4 }, WORLD, false],
  [{ kind: "At", p: 3, t: 3, r: 4 }, WORLD, true],
  [{ kind: "NotAt", p: 0, t: 0, r: 4 }, WORLD, true],
  [{ kind: "NotAt", p: 0, t: 0, r: 1 }, WORLD, false],

  // Stayed
  [{ kind: "Stayed", p: 2, r: 5, t1: 0, t2: 1 }, WORLD, true],
  [{ kind: "Stayed", p: 1, r: 1, t1: 0, t2: 2 }, WORLD, false],
  [{ kind: "Stayed", p: 3, r: 4, t1: 2, t2: 3 }, WORLD, true],

  // Visited / NeverVisited
  [{ kind: "Visited", p: 0, r: 4 }, WORLD, true],
  [{ kind: "Visited", p: 1, r: 4 }, WORLD, false],
  [{ kind: "Visited", p: 0, r: 4 }, STAYS, false],
  [{ kind: "NeverVisited", p: 1, r: 4 }, WORLD, true],
  [{ kind: "NeverVisited", p: 0, r: 4 }, WORLD, false],

  // Saw — the living only, and never oneself.
  [{ kind: "Saw", p: 0, q: 1, t: 0, r: 1 }, WORLD, true],
  [{ kind: "Saw", p: 0, q: 1, t: 1, r: 1 }, WORLD, false],
  [{ kind: "Saw", p: 2, q: 3, t: 0, r: 5 }, WORLD, true],
  [{ kind: "Saw", p: 0, q: 3, t: 2, r: 4 }, WORLD, false],
  [{ kind: "Saw", p: 0, q: 0, t: 0, r: 1 }, WORLD, false],

  // Together
  [{ kind: "Together", p: 0, q: 1, t: 0 }, WORLD, true],
  [{ kind: "Together", p: 0, q: 1, t: 1 }, WORLD, false],
  [{ kind: "Together", p: 2, q: 3, t: 1 }, WORLD, true],
  [{ kind: "Together", p: 0, q: 3, t: 2 }, WORLD, false],

  // AloneIn
  [{ kind: "AloneIn", p: 0, t: 2, r: 4 }, WORLD, true],
  [{ kind: "AloneIn", p: 1, t: 2, r: 0 }, WORLD, true],
  [{ kind: "AloneIn", p: 1, t: 0, r: 1 }, WORLD, false],
  [{ kind: "AloneIn", p: 2, t: 0, r: 5 }, WORLD, false],

  // Occupied / Empty — the murder room after the murder.
  [{ kind: "Occupied", r: 4, t: 2 }, WORLD, true],
  [{ kind: "Occupied", r: 4, t: 3 }, WORLD, false],
  [{ kind: "Occupied", r: 4, t: 3 }, STAYS, true],
  [{ kind: "Empty", r: 4, t: 3 }, WORLD, true],
  [{ kind: "Empty", r: 4, t: 2 }, WORLD, false],
  [{ kind: "Empty", r: 4, t: 3 }, STAYS, false],

  // Count
  [{ kind: "Count", r: 1, t: 0, k: 2 }, WORLD, true],
  [{ kind: "Count", r: 1, t: 0, k: 3 }, WORLD, false],
  [{ kind: "Count", r: 4, t: 3, k: 0 }, WORLD, true],

  // AliveAt / DeathWindow
  [{ kind: "AliveAt", t: 1 }, WORLD, true],
  [{ kind: "AliveAt", t: 2 }, WORLD, false],
  [{ kind: "AliveAt", t: 0 }, STAYS, true],
  [{ kind: "AliveAt", t: 1 }, STAYS, false],
  [{ kind: "DeathWindow", a: 1, b: 3 }, WORLD, true],
  [{ kind: "DeathWindow", a: 0, b: 1 }, WORLD, false],
  [{ kind: "DeathWindow", a: 2, b: 2 }, WORLD, true],

  // Case-file rules, read as formulas over the world.
  [{ kind: "DoorClosed", door: D14, from: 1, to: 2 }, WORLD, true],
  [{ kind: "DoorClosed", door: D14, from: 0, to: 1 }, WORLD, false],
  [{ kind: "DoorClosed", door: D14, from: 0, to: 3 }, WORLD, false],
  [{ kind: "DoorClosed", door: D45, from: 1, to: 2 }, WORLD, false],
  [{ kind: "BarredDoor", p: 1, door: D14 }, WORLD, true],
  [{ kind: "BarredDoor", p: 0, door: D14 }, WORLD, false],
  [{ kind: "BarredRoom", p: 1, r: 4 }, WORLD, true],
  [{ kind: "BarredRoom", p: 0, r: 4 }, WORLD, false],
  [{ kind: "Capacity", r: 1, k: 2 }, WORLD, true],
  [{ kind: "Capacity", r: 1, k: 1 }, WORLD, false],
  [{ kind: "Capacity", r: 4, k: 1 }, WORLD, true],
];

describe("holds", () => {
  for (const [body, world, want] of HOLDS) {
    it(`${canonical(body)} is ${want} in world ${worldName(world)}`, () => {
      expect(holds(body, FRAME, world)).toBe(want);
    });
  }

  it("covers every kind in both directions", () => {
    for (const kind of CLUE_KINDS) {
      const rows = HOLDS.filter(([b]) => b.kind === kind);
      expect([kind, rows.some(([, , want]) => want)]).toEqual([kind, true]);
      expect([kind, rows.some(([, , want]) => !want)]).toEqual([kind, true]);
    }
  });
});

describe("the living and the dead", () => {
  it("the body is where it fell, but it is not company", () => {
    // Same room, same slot: one clue true, the other false.
    expect(holds({ kind: "At", p: 3, t: 3, r: 4 }, FRAME, WORLD)).toBe(true);
    expect(holds({ kind: "Empty", r: 4, t: 3 }, FRAME, WORLD)).toBe(true);
    expect(holds({ kind: "Occupied", r: 4, t: 3 }, FRAME, WORLD)).toBe(false);
  });

  it("the killer standing over the body is alone", () => {
    expect(holds({ kind: "AloneIn", p: 0, t: 2, r: 4 }, FRAME, WORLD)).toBe(
      true,
    );
    expect(holds({ kind: "AloneIn", p: 1, t: 1, r: 4 }, FRAME, STAYS)).toBe(
      true,
    );
  });

  it("a living victim spoils AloneIn", () => {
    // p2 and the victim share room 5 in slot 0, before the murder.
    expect(holds({ kind: "AloneIn", p: 2, t: 0, r: 5 }, FRAME, WORLD)).toBe(
      false,
    );
  });

  it("nobody sees the victim once the victim is dead", () => {
    for (let t = 2; t < FRAME.slots; t++) {
      for (let p = 0; p < FRAME.suspects; p++) {
        for (let r = 0; r < PLAN.rooms.length; r++) {
          const body: ClueBody = { kind: "Saw", p, q: FRAME.victim, t, r };
          expect([canonical(body), holds(body, FRAME, WORLD)]).toEqual([
            canonical(body),
            false,
          ]);
        }
      }
    }
    // While alive the victim is seen like anybody else.
    expect(holds({ kind: "Saw", p: 2, q: 3, t: 1, r: 5 }, FRAME, WORLD)).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------- canonical */

/** One true, well-formed body per kind, in `CLUE_KINDS` order. */
const SAMPLES: readonly ClueBody[] = [
  { kind: "At", p: 0, t: 0, r: 1 },
  { kind: "NotAt", p: 1, t: 2, r: 4 },
  { kind: "Stayed", p: 2, r: 5, t1: 0, t2: 1 },
  { kind: "Saw", p: 0, q: 1, t: 0, r: 1 },
  { kind: "Together", p: 0, q: 1, t: 0 },
  { kind: "AloneIn", p: 1, t: 2, r: 0 },
  { kind: "Occupied", r: 4, t: 2 },
  { kind: "Empty", r: 4, t: 3 },
  { kind: "Count", r: 1, t: 0, k: 2 },
  { kind: "Visited", p: 0, r: 4 },
  { kind: "NeverVisited", p: 1, r: 4 },
  { kind: "AliveAt", t: 1 },
  { kind: "DeathWindow", a: 1, b: 3 },
  { kind: "DoorClosed", door: D14, from: 1, to: 2 },
  { kind: "BarredDoor", p: 1, door: D14 },
  { kind: "BarredRoom", p: 1, r: 4 },
  { kind: "Capacity", r: 1, k: 2 },
];

describe("the samples", () => {
  it("are one per kind, in registry order", () => {
    expect(SAMPLES.map((b) => b.kind)).toEqual([...CLUE_KINDS]);
  });

  it("are all well formed and all true in world A", () => {
    for (const body of SAMPLES) {
      const name = canonical(body);
      expect([name, validBody(body, FRAME)]).toEqual([name, true]);
      expect([name, holds(body, FRAME, WORLD)]).toEqual([name, true]);
    }
  });
});

describe("canonical", () => {
  it("reads as the clue does", () => {
    expect(canonical({ kind: "At", p: 2, t: 3, r: 5 })).toBe("At(p2,t3,r5)");
    expect(canonical({ kind: "Saw", p: 1, q: 4, t: 2, r: 0 })).toBe(
      "Saw(p1,p4,t2,r0)",
    );
  });

  it("makes the two spellings of a mirrored pair equal", () => {
    expect(canonical({ kind: "Saw", p: 4, q: 1, t: 2, r: 0 })).toBe(
      canonical({ kind: "Saw", p: 1, q: 4, t: 2, r: 0 }),
    );
    expect(canonical({ kind: "Together", p: 3, q: 1, t: 2 })).toBe(
      canonical({ kind: "Together", p: 1, q: 3, t: 2 }),
    );
  });

  it("orders a span either way round", () => {
    expect(canonical({ kind: "Stayed", p: 1, r: 2, t1: 4, t2: 1 })).toBe(
      canonical({ kind: "Stayed", p: 1, r: 2, t1: 1, t2: 4 }),
    );
    expect(canonical({ kind: "DeathWindow", a: 3, b: 1 })).toBe(
      canonical({ kind: "DeathWindow", a: 1, b: 3 }),
    );
    expect(canonical({ kind: "DoorClosed", door: 0, from: 3, to: 1 })).toBe(
      canonical({ kind: "DoorClosed", door: 0, from: 1, to: 3 }),
    );
  });

  it("keeps Saw and Together apart although one implies the other", () => {
    // Wave 5 has to tell "she saw him in the library" from "she was with
    // him", so this must never collapse.
    expect(canonical({ kind: "Saw", p: 1, q: 2, t: 3, r: 0 })).not.toBe(
      canonical({ kind: "Together", p: 1, q: 2, t: 3 }),
    );
  });

  it("distinguishes every kind from every other", () => {
    const seen = new Set(SAMPLES.map(canonical));
    expect(seen.size).toBe(SAMPLES.length);
  });

  it("separates a wrong slot, a wrong room and a swapped person", () => {
    const base = canonical({ kind: "At", p: 0, t: 0, r: 1 });
    expect(canonical({ kind: "At", p: 0, t: 1, r: 1 })).not.toBe(base);
    expect(canonical({ kind: "At", p: 0, t: 0, r: 2 })).not.toBe(base);
    expect(canonical({ kind: "At", p: 1, t: 0, r: 1 })).not.toBe(base);

    const saw = canonical({ kind: "Saw", p: 0, q: 1, t: 0, r: 1 });
    expect(canonical({ kind: "Saw", p: 0, q: 2, t: 0, r: 1 })).not.toBe(saw);
    expect(canonical({ kind: "Saw", p: 0, q: 1, t: 1, r: 1 })).not.toBe(saw);
    expect(canonical({ kind: "Saw", p: 0, q: 1, t: 0, r: 2 })).not.toBe(saw);
  });
});

describe("normalise", () => {
  /** The samples plus every mirrored and reversed spelling among them. */
  const SPELLINGS: readonly ClueBody[] = [
    ...SAMPLES,
    { kind: "Saw", p: 1, q: 0, t: 0, r: 1 },
    { kind: "Together", p: 1, q: 0, t: 0 },
    { kind: "Stayed", p: 2, r: 5, t1: 1, t2: 0 },
    { kind: "DeathWindow", a: 3, b: 1 },
    { kind: "DoorClosed", door: D14, from: 2, to: 1 },
  ];

  for (const body of SPELLINGS) {
    it(`is idempotent on ${canonical(body)}`, () => {
      const once = normalise(body);
      const twice = normalise(once);
      expect(twice).toEqual(once);
      expect(canonical(once)).toBe(canonical(body));
      expect(canonical(twice)).toBe(canonical(body));
    });
  }

  it("leaves the clue meaning what it meant", () => {
    for (const body of SPELLINGS) {
      const name = canonical(body);
      expect([name, holds(normalise(body), FRAME, WORLD)]).toEqual([
        name,
        holds(body, FRAME, WORLD),
      ]);
    }
  });
});

/* -------------------------------------------------------------- registry */

describe("the registry", () => {
  // A kind missing from this table will not compile, which is why it is
  // written out rather than derived.
  const EVERY_KIND: Record<ClueKind, true> = {
    At: true,
    NotAt: true,
    Stayed: true,
    Saw: true,
    Together: true,
    AloneIn: true,
    Occupied: true,
    Empty: true,
    Count: true,
    Visited: true,
    NeverVisited: true,
    AliveAt: true,
    DeathWindow: true,
    DoorClosed: true,
    BarredDoor: true,
    BarredRoom: true,
    Capacity: true,
  };

  it("covers the whole ClueKind union, once each", () => {
    expect([...CLUE_KINDS].sort()).toEqual(Object.keys(EVERY_KIND).sort());
    expect(CLUE_KINDS.length).toBe(17);
    expect(new Set(CLUE_KINDS).size).toBe(CLUE_KINDS.length);
  });

  for (const kind of CLUE_KINDS) {
    it(`files ${kind} under its own name`, () => {
      const mod = moduleFor(kind);
      expect(mod.kind).toBe(kind);
      // Wave 1 fills these five, and no more.
      expect(typeof mod.holds).toBe("function");
      expect(typeof mod.canonical).toBe("function");
      expect(typeof mod.normalise).toBe("function");
      expect(typeof mod.valid).toBe("function");
      expect(typeof mod.topicKeys).toBe("function");
    });
  }
});

/* ------------------------------------------------------------- validBody */

describe("validBody", () => {
  const BAD: ReadonlyArray<[string, ClueBody]> = [
    ["a room off the plan", { kind: "At", p: 0, t: 0, r: 6 }],
    ["a slot off the evening", { kind: "At", p: 0, t: 4, r: 0 }],
    ["a person off the cast", { kind: "At", p: 4, t: 0, r: 0 }],
    ["a negative id", { kind: "At", p: -1, t: 0, r: 0 }],
    ["seeing oneself", { kind: "Saw", p: 1, q: 1, t: 0, r: 0 }],
    ["being with oneself", { kind: "Together", p: 1, q: 1, t: 0 }],
    ["a one-slot Stayed", { kind: "Stayed", p: 0, r: 0, t1: 1, t2: 1 }],
    ["a backwards DeathWindow", { kind: "DeathWindow", a: 3, b: 1 }],
    [
      "a closure that closes nothing",
      { kind: "DoorClosed", door: D14, from: 2, to: 2 },
    ],
    ["a door off the plan", { kind: "BarredDoor", p: 0, door: 99 }],
    ["a count past the cast", { kind: "Count", r: 0, t: 0, k: 5 }],
    ["a negative count", { kind: "Count", r: 0, t: 0, k: -1 }],
    ["a capacity of nobody", { kind: "Capacity", r: 0, k: 0 }],
  ];

  for (const [why, body] of BAD) {
    it(`rejects ${why}`, () => {
      expect(validBody(body, FRAME)).toBe(false);
    });
  }

  const GOOD: ReadonlyArray<[string, ClueBody]> = [
    ["a clue about the victim", { kind: "At", p: 3, t: 3, r: 4 }],
    ["a two-slot Stayed", { kind: "Stayed", p: 0, r: 0, t1: 1, t2: 2 }],
    ["a one-slot DeathWindow", { kind: "DeathWindow", a: 2, b: 2 }],
    ["an empty room", { kind: "Count", r: 0, t: 0, k: 0 }],
    ["the whole cast in one room", { kind: "Count", r: 0, t: 0, k: 4 }],
    ["a capacity of one", { kind: "Capacity", r: 0, k: 1 }],
  ];

  for (const [why, body] of GOOD) {
    it(`accepts ${why}`, () => {
      expect(validBody(body, FRAME)).toBe(true);
    });
  }
});

/* ------------------------------------------------------------ topic keys */

describe("topicKeys", () => {
  const EXPECTED: ReadonlyArray<[ClueBody, string[]]> = [
    [{ kind: "At", p: 0, t: 0, r: 1 }, ["person:0", "room:1", "slot:0"]],
    [{ kind: "NotAt", p: 1, t: 2, r: 4 }, ["person:1", "room:4", "slot:2"]],
    [
      { kind: "Stayed", p: 2, r: 5, t1: 0, t2: 1 },
      ["person:2", "room:5", "slot:0", "slot:1"],
    ],
    [
      { kind: "Saw", p: 0, q: 1, t: 0, r: 1 },
      ["person:0", "person:1", "room:1", "slot:0"],
    ],
    [
      { kind: "Together", p: 0, q: 1, t: 0 },
      ["person:0", "person:1", "slot:0"],
    ],
    [{ kind: "AloneIn", p: 1, t: 2, r: 0 }, ["person:1", "room:0", "slot:2"]],
    [{ kind: "Occupied", r: 4, t: 2 }, ["room:4", "slot:2"]],
    [{ kind: "Empty", r: 4, t: 3 }, ["room:4", "slot:3"]],
    [{ kind: "Count", r: 1, t: 0, k: 2 }, ["room:1", "slot:0"]],
    [{ kind: "Visited", p: 0, r: 4 }, ["person:0", "room:4"]],
    [{ kind: "NeverVisited", p: 1, r: 4 }, ["person:1", "room:4"]],
    [{ kind: "AliveAt", t: 1 }, ["person:3", "slot:1"]],
    [
      { kind: "DeathWindow", a: 1, b: 3 },
      ["person:3", "slot:1", "slot:2", "slot:3"],
    ],
    [
      { kind: "DoorClosed", door: D14, from: 1, to: 2 },
      ["room:1", "room:4", "slot:1", "slot:2"],
    ],
    [{ kind: "BarredDoor", p: 1, door: D14 }, ["person:1", "room:1", "room:4"]],
    [{ kind: "BarredRoom", p: 1, r: 4 }, ["person:1", "room:4"]],
    [{ kind: "Capacity", r: 1, k: 2 }, ["room:1"]],
  ];

  it("has an expectation for every kind", () => {
    expect(EXPECTED.map(([b]) => b.kind)).toEqual([...CLUE_KINDS]);
  });

  for (const [body, want] of EXPECTED) {
    it(`releases ${canonical(body)} on ${want.join(" ")}`, () => {
      expect(topicKeys(body, FRAME)).toEqual(want);
    });
  }

  /*
   * The table above lives on a six-room plan, where every id is a single
   * digit and a string sort and a numeric sort cannot be told apart. They
   * part company at ten rooms, and `MAX_ROOMS` is 16.
   */
  describe("on a sixteen-room plan", () => {
    const BIG_PLAN = gridPlan(4, 4);
    const BIG = frameOf({
      plan: BIG_PLAN,
      suspects: 3,
      slots: 4,
      murderRoom: 0,
    });

    it("puts room 6 before room 10", () => {
      const body: ClueBody = {
        kind: "BarredDoor",
        p: 0,
        door: doorOf(BIG_PLAN, 6, 10),
      };
      expect(topicKeys(body, BIG)).toEqual(["person:0", "room:6", "room:10"]);
    });

    it("groups person, room, slot and sorts each group numerically", () => {
      for (const door of BIG_PLAN.doors) {
        const body: ClueBody = {
          kind: "DoorClosed",
          door: door.id,
          from: 1,
          to: 2,
        };
        const lo = Math.min(door.a, door.b);
        const hi = Math.max(door.a, door.b);
        expect([door.id, topicKeys(body, BIG)]).toEqual([
          door.id,
          [`room:${lo}`, `room:${hi}`, "slot:1", "slot:2"],
        ]);
      }
    });
  });

  it("drops the speaker's own name", () => {
    const clue: Clue = {
      id: "c1",
      body: { kind: "Saw", p: 0, q: 1, t: 0, r: 1 },
      source: { kind: "testimony", speaker: 0 },
    };
    expect(clueTopicKeys(FRAME, clue)).toEqual([
      "person:1",
      "room:1",
      "slot:0",
    ]);
    // A fact has no speaker, so nothing is dropped.
    const fact: Clue = { ...clue, source: { kind: "fact" } };
    expect(clueTopicKeys(FRAME, fact)).toEqual(topicKeys(clue.body, FRAME));
  });
});

/* -------------------------------------------------------------- mentions */

describe("clueMentions", () => {
  it("names a span slot by slot", () => {
    expect(
      clueMentions({ kind: "Stayed", p: 2, r: 5, t1: 0, t2: 2 }, FRAME),
    ).toEqual({ people: [2], rooms: [5], slots: [0, 1, 2], doors: [] });
  });

  it("names a door as a door, not as its rooms", () => {
    expect(
      clueMentions({ kind: "DoorClosed", door: D14, from: 1, to: 2 }, FRAME),
    ).toEqual({ people: [], rooms: [], slots: [1, 2], doors: [D14] });
  });

  it("lists a mirrored pair ascending, once each", () => {
    expect(
      clueMentions({ kind: "Saw", p: 2, q: 1, t: 0, r: 1 }, FRAME),
    ).toEqual({ people: [1, 2], rooms: [1], slots: [0], doors: [] });
  });

  it("names the victim for a clue that is only about him", () => {
    // The notebook highlight and the topic keys come off this one list, so
    // the card that releases on "tell me about the dead man" must light his
    // row as well.
    expect(clueMentions({ kind: "AliveAt", t: 1 }, FRAME)).toEqual({
      people: [FRAME.victim],
      rooms: [],
      slots: [1],
      doors: [],
    });
    expect(clueMentions({ kind: "DeathWindow", a: 1, b: 3 }, FRAME)).toEqual({
      people: [FRAME.victim],
      rooms: [],
      slots: [1, 2, 3],
      doors: [],
    });
  });

  it("agrees with topicKeys, kind by kind", () => {
    // The point of the single list: every person, room and slot a card
    // highlights is a question that releases it, and nothing else is.
    for (const body of SAMPLES) {
      const m = clueMentions(body, FRAME);
      const rooms = new Set(m.rooms);
      for (const e of m.doors) {
        rooms.add(PLAN.doors[e].a);
        rooms.add(PLAN.doors[e].b);
      }
      const want = [
        ...m.people.map((p) => `person:${p}`),
        ...[...rooms].sort((a, b) => a - b).map((r) => `room:${r}`),
        ...m.slots.map((t) => `slot:${t}`),
      ];
      const name = canonical(body);
      expect([name, topicKeys(body, FRAME)]).toEqual([name, want]);
    }
  });
});

/* ------------------------------------------------------- clue and source */

describe("clueCanonical", () => {
  const body: ClueBody = { kind: "At", p: 0, t: 0, r: 1 };

  it("prefixes the source", () => {
    expect(clueCanonical({ id: "a", body, source: { kind: "fact" } })).toBe(
      "fact|At(p0,t0,r1)",
    );
    expect(
      clueCanonical({
        id: "b",
        body,
        source: { kind: "testimony", speaker: 3 },
      }),
    ).toBe("say(p3)|At(p0,t0,r1)");
  });

  it("makes two people saying the same thing two cards", () => {
    const one = clueCanonical({
      id: "a",
      body,
      source: { kind: "testimony", speaker: 1 },
    });
    const two = clueCanonical({
      id: "b",
      body,
      source: { kind: "testimony", speaker: 2 },
    });
    expect(one).not.toBe(two);
  });

  it("ignores the clue id, which is bookkeeping", () => {
    const src = { kind: "fact" } as const;
    expect(clueCanonical({ id: "a", body, source: src })).toBe(
      clueCanonical({ id: "z", body, source: src }),
    );
  });
});

describe("clueHolds", () => {
  // p0 is the culprit in world A, and was in room 4 in slot 2, not room 0.
  const lie: ClueBody = { kind: "At", p: 0, t: 2, r: 0 };
  const byCulprit: Clue = {
    id: "lie",
    body: lie,
    source: { kind: "testimony", speaker: 0 },
  };
  const byInnocent: Clue = {
    id: "same",
    body: lie,
    source: { kind: "testimony", speaker: 1 },
  };
  const asFact: Clue = { id: "fact", body: lie, source: { kind: "fact" } };

  it("is false of the formula itself", () => {
    expect(holds(lie, FRAME, WORLD)).toBe(false);
  });

  it("with lying on, lets the culprit's false statement stand", () => {
    expect(clueHolds(LYING, byCulprit, WORLD)).toBe(true);
  });

  it("with lying on, still binds everybody else", () => {
    expect(clueHolds(LYING, byInnocent, WORLD)).toBe(false);
    expect(clueHolds(LYING, asFact, WORLD)).toBe(false);
  });

  it("with lying off, binds the culprit too", () => {
    expect(clueHolds(FRAME, byCulprit, WORLD)).toBe(false);
    expect(clueHolds(FRAME, byInnocent, WORLD)).toBe(false);
  });

  it("lets a true statement stand whoever says it", () => {
    const truth: ClueBody = { kind: "At", p: 0, t: 2, r: 4 };
    for (const frame of [FRAME, LYING]) {
      for (let s = 0; s < frame.suspects; s++) {
        const clue: Clue = {
          id: `t${s}`,
          body: truth,
          source: { kind: "testimony", speaker: s },
        };
        expect([s, clueHolds(frame, clue, WORLD)]).toEqual([s, true]);
      }
    }
  });

  it("excuses a false statement in exactly one corner of the table", () => {
    // Monotonicity in miniature: nothing the generator could issue from the
    // true world is refused by the true world. The lie rides along so the
    // sweep can actually fail — every sample is true in world A, so on its
    // own it would read `true === true` whatever rule 7 did. A false body is
    // let through when, and only when, lying is on and its speaker is the
    // culprit; the other three corners refuse it.
    const CASES: ReadonlyArray<[ClueBody, boolean]> = [
      ...SAMPLES.map((b): [ClueBody, boolean] => [b, true]),
      [lie, false],
    ];
    for (const [body, trueInWorld] of CASES) {
      const name = canonical(body);
      for (const frame of [FRAME, LYING]) {
        for (let s = 0; s < frame.suspects; s++) {
          const clue: Clue = {
            id: "s",
            body,
            source: { kind: "testimony", speaker: s },
          };
          const excused = frame.lying && s === WORLD.culprit;
          const want = trueInWorld || excused;
          const where = `${name} by p${s}, lying ${frame.lying}`;
          expect([where, clueHolds(frame, clue, WORLD)]).toEqual([where, want]);
        }
      }
    }
  });
});
