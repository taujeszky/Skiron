import { describe, it, expect } from "vitest";
import { isLegal, presentMask } from "../axioms";
import { popcount } from "../bits";
import { buildFloorPlan } from "../map";
import { RNG } from "../rng";
import { noRules } from "../types";
import type { CaseFrame, CaseRules, FloorPlan, World } from "../types";
import { countMeetings, countVictimCompany, simulateTruth } from "./simulate";
import type { SimOptions, TruthResult } from "./simulate";

/** The four size presets the plan names: suspects / rooms / slots. */
const PRESETS = [
  { suspects: 4, rooms: 5, slots: 5 },
  { suspects: 5, rooms: 6, slots: 6 },
  { suspects: 5, rooms: 7, slots: 7 },
  { suspects: 6, rooms: 8, slots: 8 },
];

type Preset = (typeof PRESETS)[number];

/**
 * A whole case from one seed: the plan and the truth share an RNG, as the
 * generator will, so a seed here exercises the same stream the real pipeline
 * does rather than a tidied-up version of it.
 */
function run(
  seed: string,
  preset: Preset,
  opts: SimOptions = {},
  rules: (plan: FloorPlan) => CaseRules = noRules,
): TruthResult | null {
  const rng = new RNG(seed);
  const plan = buildFloorPlan(rng, { rooms: preset.rooms });
  return simulateTruth(
    rng,
    {
      plan,
      rules: rules(plan),
      suspects: preset.suspects,
      slots: preset.slots,
      lying: false,
    },
    opts,
  );
}

/**
 * Rules 4 and 5 again, read off the world by hand. `isLegal` already checks
 * them, but this is the one place where the simulation and the axioms are
 * meant to agree, so it is worth saying twice in different words.
 */
function checkMurder(frame: CaseFrame, world: World): void {
  const V = frame.victim;
  const tStar = world.murderSlot;
  expect(frame.murderRoom).toBe(world.loc[V][tStar]);
  expect(popcount(presentMask(frame, world, frame.murderRoom, tStar))).toBe(1);
  for (let t = tStar; t < frame.slots; t++) {
    expect(world.loc[V][t]).toBe(frame.murderRoom);
    for (let p = 0; p < frame.suspects; p++) {
      if (p === world.culprit) continue;
      expect(world.loc[p][t]).not.toBe(frame.murderRoom);
    }
  }
}

describe("simulateTruth", () => {
  /**
   * The property test wave 1 asks for. 500 seeds, 125 per preset, and every
   * one of them a legal world — `isLegal` is the definition, so this is the
   * whole claim the simulation makes.
   */
  it("produces a legal world for 500 seeds across the size presets", () => {
    let totalRetries = 0;
    let worstRetries = 0;
    const culprits = new Set<string>();
    const murderRooms = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const which = i % PRESETS.length;
      const preset = PRESETS[which];
      const result = run(`legal:${i}`, preset);
      expect(result).not.toBeNull();
      if (!result) continue;
      const { frame, world } = result;

      expect(isLegal(frame, world)).toBe(true);
      checkMurder(frame, world);

      // The frame really is the request, with the one field the simulation
      // owns filled in.
      expect(frame.suspects).toBe(preset.suspects);
      expect(frame.slots).toBe(preset.slots);
      expect(frame.people).toBe(preset.suspects + 1);
      expect(frame.victim).toBe(preset.suspects);
      expect(world.loc.length).toBe(preset.suspects + 1);

      // The default murder slot leaves room for a witness before and for the
      // killer to walk away after.
      expect(world.murderSlot).toBeGreaterThanOrEqual(1);
      expect(world.murderSlot).toBeLessThanOrEqual(preset.slots - 2);

      culprits.add(`${which}:${world.culprit}`);
      murderRooms.add(frame.murderRoom);
      totalRetries += result.retries;
      worstRetries = Math.max(worstRetries, result.retries);
    }

    // Measured over these seeds: mean 0.07 retries, worst 3. The bounds are
    // loose enough to survive tuning and tight enough to catch a walk that
    // has started failing and retrying its way to an answer.
    expect(totalRetries / 500).toBeLessThan(0.5);
    expect(worstRetries).toBeLessThan(10);

    // Every suspect gets to be the killer and every room gets to hold the
    // body: the choice must not have collapsed onto whoever is numbered 0.
    expect(culprits.size).toBe(4 + 5 + 5 + 6);
    expect(murderRooms.size).toBe(8);
  });

  it("never runs out of attempts at preset sizes", () => {
    // Attempts fail independently, and a single one succeeds better than 80%
    // of the time, so eight of them is already a formality. This pins the
    // claim that `null` is a theoretical return and not one callers plan for.
    for (let i = 0; i < 200; i++) {
      const preset = PRESETS[i % PRESETS.length];
      expect(run(`nonnull:${i}`, preset, { maxAttempts: 8 })).not.toBeNull();
    }
  });

  it("is deterministic in the seed", () => {
    for (const preset of PRESETS) {
      const a = run("same-seed", preset);
      const b = run("same-seed", preset);
      expect(a).not.toBeNull();
      expect(b).toEqual(a);
    }
    // ...and not by being constant.
    const one = run("seed-one", PRESETS[1]);
    expect(run("seed-two", PRESETS[1])).not.toEqual(one);
  });

  /**
   * The guarantee `buildFloorPlan` gives too (`map.test.ts`), and for the same
   * reason: a retry must not shift the draws the rest of the generator makes,
   * or an old case id would rebuild a different case. The floor is raised so
   * that this seed really does retry — the test above re-runs from a fresh
   * RNG and so passes whether an attempt costs the caller a draw or not, and
   * a version that spent one per attempt would surface only as shipped case
   * packs quietly regenerating.
   */
  it("draws one number from the caller's RNG whatever it takes", () => {
    const preset = PRESETS[0];
    const opts: SimOptions = { minVictimCompany: 3 };
    const req = (plan: FloorPlan) => ({
      plan,
      rules: noRules(),
      suspects: preset.suspects,
      slots: preset.slots,
      lying: false,
    });

    const a = new RNG("stream:0");
    const plan = buildFloorPlan(a, { rooms: preset.rooms });
    const result = simulateTruth(a, req(plan), opts);
    // Measured: 8 failed attempts on this seed. Asserted, not commented, so
    // the test cannot stop exercising the retry path without saying so.
    expect(result).not.toBeNull();
    expect(result?.retries).toBeGreaterThan(0);
    const after = a.next();

    // One draw for the plan, one for the truth, and nothing else.
    const b = new RNG("stream:0");
    b.next();
    b.next();
    expect(after).toBe(b.next());
  });

  /**
   * Measured over 2000 seeds across the four presets with the floors turned
   * off: the victim has company in 90.6% of evenings, for a mean of 2.0
   * slots, and the evening holds a median of 16 meetings (fewer than 3 in
   * 0.0% of them, fewer than 5 in 0.6%). The default `minVictimCompany` of 1
   * turns the first of those into a guarantee for about 0.07 retries a case.
   */
  it("leaves the victim seen alive", () => {
    for (let i = 0; i < 300; i++) {
      const preset = PRESETS[i % PRESETS.length];
      const result = run(`seen:${i}`, preset);
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(countVictimCompany(result.frame, result.world)).toBeGreaterThan(0);
      expect(countMeetings(result.frame, result.world)).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("honours the quality floors when they are raised", () => {
    for (let i = 0; i < 40; i++) {
      const result = run(`quality:${i}`, PRESETS[2], {
        minMeetings: 14,
        minVictimCompany: 3,
      });
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(countMeetings(result.frame, result.world)).toBeGreaterThanOrEqual(
        14,
      );
      expect(
        countVictimCompany(result.frame, result.world),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("obeys a murder slot range that is asked for", () => {
    for (let i = 0; i < 40; i++) {
      const result = run(`slot:${i}`, PRESETS[3], { murderSlotRange: [4, 4] });
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(result.world.murderSlot).toBe(4);
      expect(isLegal(result.frame, result.world)).toBe(true);
    }
  });
});

describe("simulateTruth under case-file rules", () => {
  /**
   * A closure, two bars and a capacity at once, pinned to ids every plan has:
   * door 0 locked across the transitions out of slots 1 and 2, suspect 1 kept
   * away from the last door, suspect 0 kept out of the last room, and room 0
   * big enough for one person. The counters at the end of the test check that
   * these bite — a rule nobody could ever have broken tests nothing.
   */
  function rulesFor(plan: FloorPlan): CaseRules {
    return {
      closures: [{ door: 0, from: 1, to: 3 }],
      doorBars: [{ person: 1, door: plan.doors.length - 1 }],
      roomBars: [{ person: 0, room: plan.rooms.length - 1 }],
      capacities: [{ room: 0, max: 1 }],
    };
  }

  it("respects closures, bars and capacities while walking", () => {
    let roomZeroUsed = 0;
    let doorZeroCrossings = 0;
    let barredDoorCrossings = 0;
    for (let i = 0; i < 200; i++) {
      const preset = PRESETS[i % PRESETS.length];
      const result = run(`rules:${i}`, preset, {}, rulesFor);
      expect(result).not.toBeNull();
      if (!result) continue;
      const { frame, world } = result;
      const n = frame.plan.rooms.length;
      const closure = frame.rules.closures[0];
      const barredDoor = frame.rules.doorBars[0].door;
      const barredRoom = frame.rules.roomBars[0].room;

      expect(isLegal(frame, world)).toBe(true);
      checkMurder(frame, world);

      // Read off the world directly rather than through `isLegal`: if those
      // two ever disagree, this is the test that says which one is wrong.
      for (let p = 0; p < frame.people; p++) {
        for (let t = 0; t + 1 < frame.slots; t++) {
          const from = world.loc[p][t];
          const to = world.loc[p][t + 1];
          if (from === to) continue;
          const door = frame.plan.doorBetween[from * n + to];
          expect(door).toBeGreaterThanOrEqual(0);
          if (door === closure.door) {
            doorZeroCrossings++;
            expect(t >= closure.from && t < closure.to).toBe(false);
          }
          if (door === barredDoor) {
            barredDoorCrossings++;
            expect(p).not.toBe(1);
          }
        }
      }

      for (let t = 0; t < frame.slots; t++) {
        expect(world.loc[0][t]).not.toBe(barredRoom);
        const heads = popcount(presentMask(frame, world, 0, t));
        expect(heads).toBeLessThanOrEqual(1);
        if (heads === 1) roomZeroUsed++;
      }
    }
    // Non-vacuity. Measured: room 0 is occupied in hundreds of slots, and
    // both doors are used hundreds of times by the people allowed to use
    // them, so the rules constrain worlds the simulation really builds.
    expect(roomZeroUsed).toBeGreaterThan(0);
    expect(doorZeroCrossings).toBeGreaterThan(0);
    expect(barredDoorCrossings).toBeGreaterThan(0);
  });
});

describe("simulateTruth on what it cannot do", () => {
  it("returns null when no legal world exists", () => {
    // Two rooms, one person each, four people. There is nowhere for the
    // fourth to stand, however the evening is walked.
    const rng = new RNG("impossible");
    const plan = buildFloorPlan(rng, { rooms: 2, width: 8, height: 4 });
    const result = simulateTruth(
      rng,
      {
        plan,
        rules: {
          closures: [],
          doorBars: [],
          roomBars: [],
          capacities: [
            { room: 0, max: 1 },
            { room: 1, max: 1 },
          ],
        },
        suspects: 3,
        slots: 5,
        lying: false,
      },
      { maxAttempts: 20 },
    );
    expect(result).toBeNull();
  });

  it("throws on a malformed request rather than returning null", () => {
    // A caller's mistake must not be able to hide as an unlucky seed.
    const plan = buildFloorPlan(new RNG("throws"), { rooms: 6 });
    const req = {
      plan,
      rules: noRules(),
      suspects: 4,
      slots: 5,
      lying: false,
    };
    const noSuspects = { ...req, suspects: 0 };
    const tooMany = { ...req, suspects: 9 };
    expect(() => simulateTruth(new RNG("a"), noSuspects)).toThrow();
    expect(() => simulateTruth(new RNG("a"), tooMany)).toThrow();
    expect(() => simulateTruth(new RNG("a"), { ...req, slots: 1 })).toThrow();
    expect(() => simulateTruth(new RNG("a"), { ...req, slots: 9 })).toThrow();
    expect(() =>
      simulateTruth(new RNG("a"), req, { murderSlotRange: [3, 1] }),
    ).toThrow();
    expect(() =>
      simulateTruth(new RNG("a"), req, { murderSlotRange: [0, 5] }),
    ).toThrow();
    expect(() => simulateTruth(new RNG("a"), req, { stayProb: 1.5 })).toThrow();
    expect(() => simulateTruth(new RNG("a"), req, { gatherPull: 0 })).toThrow();
    expect(() =>
      simulateTruth(new RNG("a"), req, { maxAttempts: 0 }),
    ).toThrow();
  });

  /**
   * Two slots is a legal evening — the validator says 2..8 and means it. What
   * cannot be done in two slots is the *default* murder slot range, which is
   * `[1, slots - 2]` and so empty below three. The error names the empty range
   * rather than the slot count, and a caller who supplies a range gets a case.
   */
  it("takes a two-slot evening when it is handed a murder slot", () => {
    const plan = buildFloorPlan(new RNG("two-slot"), { rooms: 5 });
    const req = { plan, rules: noRules(), suspects: 4, slots: 2, lying: false };

    expect(() => simulateTruth(new RNG("a"), req)).toThrow(
      /no murder slot in \[1, 0\]/,
    );

    const result = simulateTruth(new RNG("a"), req, {
      murderSlotRange: [1, 1],
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.world.murderSlot).toBe(1);
    expect(isLegal(result.frame, result.world)).toBe(true);
    checkMurder(result.frame, result.world);
  });

  /**
   * A quality floor higher than the evening's own ceiling is a bad request,
   * not a bad seed: every attempt would fail and the caller would read 200
   * wasted attempts as an unlucky seed. Wave 3 is the code that turns these
   * dials, so it is the caller this protects.
   */
  it("throws on a quality floor the murder slot puts out of reach", () => {
    const plan = buildFloorPlan(new RNG("floors"), { rooms: 6 });
    const req = { plan, rules: noRules(), suspects: 4, slots: 5, lying: false };

    // The victim has company only while alive, so the count cannot beat the
    // latest murder slot: 3 by default here, 2 when the range says so.
    expect(() =>
      simulateTruth(new RNG("a"), req, { minVictimCompany: 4 }),
    ).toThrow(/minVictimCompany/);
    expect(() =>
      simulateTruth(new RNG("a"), req, {
        murderSlotRange: [1, 2],
        minVictimCompany: 4,
      }),
    ).toThrow(/minVictimCompany/);
    // A murder in slot 0 against the default floor of 1: nobody could ever
    // have seen the victim alive, so no seed would have worked.
    expect(() =>
      simulateTruth(new RNG("a"), req, { murderSlotRange: [0, 0] }),
    ).toThrow(/minVictimCompany/);
    // ...and it is the floor that was impossible, not the range.
    expect(() =>
      simulateTruth(new RNG("a"), req, {
        murderSlotRange: [0, 0],
        minVictimCompany: 0,
        maxAttempts: 1,
      }),
    ).not.toThrow();

    // Five people over five slots with t* at most 3: 3 * C(5,2) + 2 * C(4,2).
    expect(() =>
      simulateTruth(new RNG("a"), req, { minMeetings: 42, maxAttempts: 1 }),
    ).not.toThrow();
    expect(() => simulateTruth(new RNG("a"), req, { minMeetings: 43 })).toThrow(
      /minMeetings/,
    );
  });
});
