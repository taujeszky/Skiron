import { describe, it, expect } from "vitest";
import { bit, bitsOf } from "./bits";
import {
  allowedRoomsMask,
  canMove,
  capacityOf,
  headCount,
  isLegal,
  isLiving,
  movementMasks,
  presentMask,
  testimonyBinds,
  victimAliveAt,
} from "./axioms";
import { corridorPlan, frameOf, worldOf } from "./testkit";
import type { CaseFrame, CaseRules, Clue, World } from "./types";
import { noRules } from "./types";

/**
 * One small case used by nearly every test here: four rooms in a line, three
 * suspects (0, 1, 2), the victim (3), four slots, the body in room 2.
 *
 *          slot: 0  1  2  3
 *   suspect 0:      0  1  2  2   <- the culprit, stays with the body
 *   suspect 1:      1  1  1  1
 *   suspect 2:      3  3  3  3
 *   victim  3:      1  2  2  2   <- killed in slot 2, body does not move
 */
function base(rules: CaseRules = noRules(), lying = false): CaseFrame {
  return frameOf({
    plan: corridorPlan(4),
    suspects: 3,
    slots: 4,
    murderRoom: 2,
    lying,
    rules,
  });
}

function truth(): World {
  return worldOf(
    [
      [0, 1, 2, 2],
      [1, 1, 1, 1],
      [3, 3, 3, 3],
      [1, 2, 2, 2],
    ],
    0,
    2,
  );
}

/** The same world with one person's row replaced. */
function withRow(w: World, p: number, row: number[]): World {
  const loc = w.loc.map((r) => [...r]);
  loc[p] = row;
  return { ...w, loc };
}

describe("living and presence", () => {
  const frame = base();
  const world = truth();

  it("the victim is alive strictly before the murder slot", () => {
    expect(victimAliveAt(world, 0)).toBe(true);
    expect(victimAliveAt(world, 1)).toBe(true);
    expect(victimAliveAt(world, 2)).toBe(false);
    expect(victimAliveAt(world, 3)).toBe(false);
  });

  it("suspects are always living, the body never is", () => {
    for (let t = 0; t < frame.slots; t++) {
      for (let p = 0; p < frame.suspects; p++) {
        expect(isLiving(frame, world, p, t)).toBe(true);
      }
      expect(isLiving(frame, world, frame.victim, t)).toBe(t < 2);
    }
  });

  it("counts the living victim and not the body", () => {
    // slot 0: suspect 1 and the still-living victim share room 1
    expect(bitsOf(presentMask(frame, world, 1, 0))).toEqual([1, 3]);
    // slot 1: the victim has moved on, the culprit has moved in
    expect(bitsOf(presentMask(frame, world, 1, 1))).toEqual([0, 1]);
    // slot 2: only the culprit is alive in the murder room
    expect(presentMask(frame, world, 2, 2)).toBe(bit(0));
    // slot 3: the culprit is still there; the body does not add to the count
    expect(headCount(frame, world, 2, 3)).toBe(1);
  });

  it("a room holding only the body counts as empty", () => {
    const left = withRow(world, 0, [0, 1, 2, 1]); // culprit leaves afterwards
    expect(headCount(frame, left, 2, 3)).toBe(0);
    expect(isLegal(frame, left)).toBe(true);
  });
});

describe("movement", () => {
  it("allows staying and single-door steps, and nothing else", () => {
    const frame = base();
    expect(canMove(frame, 0, 1, 1, 0)).toBe(true);
    expect(canMove(frame, 0, 1, 2, 0)).toBe(true);
    expect(canMove(frame, 0, 1, 0, 0)).toBe(true);
    expect(canMove(frame, 0, 0, 2, 0)).toBe(false); // two rooms apart
    expect(canMove(frame, 0, 0, 3, 0)).toBe(false);
  });

  it("honours a door closure only on the transitions it covers", () => {
    // the door between rooms 1 and 2 is the second door in a corridor of four
    const plan = corridorPlan(4);
    const door = plan.doorBetween[1 * 4 + 2];
    const frame = base({ ...noRules(), closures: [{ door, from: 1, to: 3 }] });
    expect(canMove(frame, 0, 1, 2, 0)).toBe(true);
    expect(canMove(frame, 0, 1, 2, 1)).toBe(false);
    expect(canMove(frame, 0, 2, 1, 2)).toBe(false);
    // other doors are untouched
    expect(canMove(frame, 0, 0, 1, 1)).toBe(true);
  });

  it("honours a door bar for that person alone", () => {
    const plan = corridorPlan(4);
    const door = plan.doorBetween[0 * 4 + 1];
    const frame = base({ ...noRules(), doorBars: [{ person: 1, door }] });
    expect(canMove(frame, 1, 0, 1, 0)).toBe(false);
    expect(canMove(frame, 0, 0, 1, 0)).toBe(true);
  });

  it("room bars drop out of the allowed mask", () => {
    const frame = base({ ...noRules(), roomBars: [{ person: 2, room: 3 }] });
    expect(bitsOf(allowedRoomsMask(frame, 2))).toEqual([0, 1, 2]);
    expect(bitsOf(allowedRoomsMask(frame, 0))).toEqual([0, 1, 2, 3]);
  });

  it("the precomputed masks say exactly what canMove says", () => {
    const plan = corridorPlan(4);
    const frame = base({
      closures: [{ door: plan.doorBetween[1 * 4 + 2], from: 0, to: 2 }],
      doorBars: [{ person: 1, door: plan.doorBetween[2 * 4 + 3] }],
      roomBars: [{ person: 2, room: 0 }],
      capacities: [],
    });
    const masks = movementMasks(frame);
    for (let p = 0; p < frame.people; p++) {
      for (let t = 0; t + 1 < frame.slots; t++) {
        for (let from = 0; from < 4; from++) {
          for (let to = 0; to < 4; to++) {
            const allowed =
              canMove(frame, p, from, to, t) &&
              (allowedRoomsMask(frame, p) & bit(to)) !== 0;
            expect((masks[p][t][from] & bit(to)) !== 0).toBe(allowed);
          }
        }
      }
    }
  });

  it("reports the tightest capacity when several name the same room", () => {
    const frame = base({
      ...noRules(),
      capacities: [
        { room: 1, max: 3 },
        { room: 1, max: 1 },
      ],
    });
    expect(capacityOf(frame, 1)).toBe(1);
    expect(capacityOf(frame, 0)).toBe(Infinity);
  });
});

describe("isLegal", () => {
  it("accepts the hand-built truth", () => {
    expect(isLegal(base(), truth())).toBe(true);
  });

  it("rejects a step across two rooms", () => {
    expect(isLegal(base(), withRow(truth(), 2, [3, 1, 1, 1]))).toBe(false);
  });

  it("rejects a room id off the map", () => {
    expect(isLegal(base(), withRow(truth(), 1, [1, 1, 1, 9]))).toBe(false);
  });

  it("rejects an accusation that names the victim or an impossible slot", () => {
    expect(isLegal(base(), { ...truth(), culprit: 3 })).toBe(false);
    expect(isLegal(base(), { ...truth(), murderSlot: 4 })).toBe(false);
    expect(isLegal(base(), { ...truth(), murderSlot: -1 })).toBe(false);
  });

  it("rejects a murder the culprit was not present for", () => {
    // the culprit never reaches the murder room
    expect(isLegal(base(), withRow(truth(), 0, [0, 1, 1, 1]))).toBe(false);
  });

  it("rejects a murder with a witness in the room (rule 4)", () => {
    // suspect 1 walks into the murder room in the murder slot
    expect(isLegal(base(), withRow(truth(), 1, [1, 1, 2, 1]))).toBe(false);
  });

  it("rejects an innocent entering the murder room afterwards (rule 5)", () => {
    expect(isLegal(base(), withRow(truth(), 1, [1, 1, 1, 2]))).toBe(false);
  });

  it("rejects a body that gets up and walks (rule 5)", () => {
    expect(isLegal(base(), withRow(truth(), 3, [1, 2, 2, 1]))).toBe(false);
  });

  it("rejects a victim who was never in the room the body was found in", () => {
    expect(isLegal(base(), withRow(truth(), 3, [1, 1, 1, 1]))).toBe(false);
  });

  it("lets the killer leave the scene", () => {
    expect(isLegal(base(), withRow(truth(), 0, [0, 1, 2, 1]))).toBe(true);
  });

  it("rejects a world that breaks a door closure", () => {
    const plan = corridorPlan(4);
    const frame = base({
      ...noRules(),
      closures: [{ door: plan.doorBetween[1 * 4 + 2], from: 1, to: 2 }],
    });
    // the victim's move from room 1 to room 2 happens on transition 1
    expect(isLegal(frame, truth())).toBe(false);
    // the same closure one transition later leaves the world alone
    const later = base({
      ...noRules(),
      closures: [{ door: plan.doorBetween[1 * 4 + 2], from: 2, to: 3 }],
    });
    expect(isLegal(later, truth())).toBe(true);
  });

  it("rejects a world that breaks a room bar", () => {
    const frame = base({ ...noRules(), roomBars: [{ person: 1, room: 1 }] });
    expect(isLegal(frame, truth())).toBe(false);
  });

  it("rejects a world that breaks a capacity, counting the living only", () => {
    // room 1 holds suspect 1 and the living victim in slot 0
    const tight = base({ ...noRules(), capacities: [{ room: 1, max: 1 }] });
    expect(isLegal(tight, truth())).toBe(false);
    expect(isLegal(base({ ...noRules(), capacities: [{ room: 1, max: 2 }] }), truth())).toBe(
      true,
    );
    // the body does not consume capacity: room 2 holds the culprit and the
    // corpse in slot 3, and a capacity of one is still satisfied
    const murderRoomCap = base({
      ...noRules(),
      capacities: [{ room: 2, max: 1 }],
    });
    expect(isLegal(murderRoomCap, truth())).toBe(true);
  });

  it("rejects a malformed grid", () => {
    const short = truth();
    short.loc[1] = [1, 1, 1];
    expect(isLegal(base(), short)).toBe(false);
    const missing = truth();
    missing.loc = missing.loc.slice(0, 3);
    expect(isLegal(base(), missing)).toBe(false);
  });
});

describe("testimonyBinds", () => {
  const fact: Clue = { id: "f", body: { kind: "AliveAt", t: 1 }, source: { kind: "fact" } };
  const bySuspect0: Clue = {
    id: "t0",
    body: { kind: "AliveAt", t: 1 },
    source: { kind: "testimony", speaker: 0 },
  };
  const bySuspect1: Clue = { ...bySuspect0, id: "t1", source: { kind: "testimony", speaker: 1 } };

  it("facts bind every world", () => {
    expect(testimonyBinds(base(noRules(), true), fact, 0)).toBe(true);
    expect(testimonyBinds(base(noRules(), false), fact, 0)).toBe(true);
  });

  it("with lying off, every testimony binds every world", () => {
    const frame = base(noRules(), false);
    expect(testimonyBinds(frame, bySuspect0, 0)).toBe(true);
    expect(testimonyBinds(frame, bySuspect0, 1)).toBe(true);
  });

  it("with lying on, a testimony says nothing about worlds where its speaker did it", () => {
    const frame = base(noRules(), true);
    expect(testimonyBinds(frame, bySuspect0, 0)).toBe(false);
    expect(testimonyBinds(frame, bySuspect0, 1)).toBe(true);
    expect(testimonyBinds(frame, bySuspect1, 0)).toBe(true);
    expect(testimonyBinds(frame, bySuspect1, 1)).toBe(false);
  });
});
