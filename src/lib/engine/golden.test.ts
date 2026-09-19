import { describe, it, expect } from "vitest";
import { RNG } from "./rng";
import { buildFloorPlan } from "./map";
import { simulateTruth } from "./world/simulate";
import { CASE_ID_VERSION, parseCaseId, seedFor } from "./caseId";
import { noRules } from "./types";
import type { FloorPlan } from "./types";

/**
 * GOLDEN VECTORS — the guard on critical invariant 4, "same case ID, byte
 * identical case".
 *
 * Every other determinism test in the suite compares engine output with
 * engine output *from the same build*: `plan(seed)` against `plan(seed)`,
 * `simulate(seed)` against `simulate(seed)`. Those hold for any RNG
 * whatsoever. They would not have noticed either of these, both of which were
 * demonstrated on a scratch copy and left all 262 tests of the day green:
 *
 *   - `Math.imul(result, 9)` changed to `Math.imul(result, 13)` in rng.ts;
 *   - the culprit and murder-slot draws swapped in simulate.ts, which alone
 *     turned SK1-N-3f9k2a from culprit 1 / slot 4 into culprit 4 / slot 2.
 *
 * Both would silently rebuild every shared case ID and every shipped case
 * pack into a different case. The numbers below are the only thing in the
 * project that can see that happen.
 *
 * IF THIS FILE FAILS, the question is not "what is wrong with the test". It
 * is: did you mean to change what an old case ID rebuilds? If yes, bump
 * `CASE_ID_VERSION`, regenerate these vectors deliberately, and say so in the
 * commit. If no, you have an accidental change to the RNG, to a generator's
 * draw order, or to the number of draws some step consumes.
 */

const CASE = "SK1-N-3f9k2a";
const SEED = "1:normal:3f9k2a:0";

/** A compact, diffable signature of a plan: sizes, rooms, doors. */
function planSignature(p: FloorPlan): string {
  return [
    `${p.width}x${p.height}`,
    p.rooms
      .map(
        (r) =>
          `${r.id}:${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}${r.outdoor ? "*" : ""}`,
      )
      .join(" "),
    p.doors.map((d) => `${d.a}-${d.b}@${d.x},${d.y}${d.wall}`).join(" "),
  ].join(" | ");
}

describe("golden vectors (invariant 4)", () => {
  it("still feeds the RNG the same string for a known case ID", () => {
    const id = parseCaseId(CASE);
    expect(id).not.toBeNull();
    expect(id?.version).toBe(CASE_ID_VERSION);
    expect(seedFor(id!, 0)).toBe(SEED);
  });

  it("the RNG still produces the same numbers from that string", () => {
    const r = new RNG(SEED);
    expect(Array.from({ length: 8 }, () => r.next())).toEqual([
      3238356268, 11695586, 4031821456, 2964067346, 1580129614, 3619689537,
      153553751, 4262796940,
    ]);
  });

  it("still builds the same house and the same evening", () => {
    const rng = new RNG(SEED);
    const plan = buildFloorPlan(rng, { rooms: 7 });
    expect(planSignature(plan)).toBe(
      "18x12 | " +
        "0:0,0,7,6 1:7,0,4,7 2:11,0,7,3 3:11,3,7,4 4:0,6,7,6 5:7,7,5,5 6:12,7,6,5 | " +
        "0-1@7,3v 0-4@3.5,6h 1-2@11,1.5v 1-5@9,7h 2-3@14.5,3h 3-6@15,7h 4-5@7,9.5v 5-6@12,9.5v",
    );

    const res = simulateTruth(rng, {
      plan,
      rules: noRules(),
      suspects: 5,
      slots: 6,
      lying: false,
    });
    expect(res).not.toBeNull();
    // rows are suspects 0-4 then the victim; each character is a room id
    expect(res!.world.loc.map((row) => row.join("")).join("/")).toBe(
      "000155/011515/001104/444444/215100/455511",
    );
    expect(res!.world.culprit).toBe(1);
    expect(res!.world.murderSlot).toBe(4);
    expect(res!.frame.murderRoom).toBe(1);
  });

  it("still builds the same house with a terrace", () => {
    // Pinned separately because the outdoor strip is the one part of the
    // dissection with its own draw, and an indoor-only vector cannot see it.
    const rng = new RNG(SEED);
    const plan = buildFloorPlan(rng, { rooms: 7, outdoor: true });
    expect(planSignature(plan)).toBe(
      "18x12 | " +
        "0:0,0,4,9 1:4,0,5,5 2:9,0,9,3 3:9,3,4,6 4:13,3,5,6 5:4,5,5,4 6:0,9,18,3* | " +
        "0-6@2,9h 1-3@9,4v 2-3@11,3h 2-4@15.5,3h 3-4@13,6v 3-5@9,7v 3-6@11,9h 4-6@15.5,9h",
    );

    const res = simulateTruth(rng, {
      plan,
      rules: noRules(),
      suspects: 5,
      slots: 6,
      lying: false,
    });
    expect(res).not.toBeNull();
    expect(res!.world.loc.map((row) => row.join("")).join("/")).toBe(
      "000063/066000/066064/660666/222222/466600",
    );
    expect(res!.world.culprit).toBe(1);
    expect(res!.world.murderSlot).toBe(4);
    expect(res!.frame.murderRoom).toBe(0);
  });
});
