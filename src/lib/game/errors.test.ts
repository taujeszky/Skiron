import { describe, expect, it } from "vitest";

import { bit, fullMask } from "$lib/engine/bits";
import { newCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import { RNG } from "$lib/engine/rng";
import { newNotebook } from "$lib/engine/solver/hint";
import { PRESET_NAMES } from "$lib/engine/solver/difficulty";
import { corridorPlan, frameOf, gridPlan } from "$lib/engine/testkit";
import { noRules } from "$lib/engine/types";
import type { CaseFrame } from "$lib/engine/types";

import {
  findErrors,
  notebookAnswer,
  placedIn,
  candidatesIn,
} from "./errors";
import { setRoom, toggleCleared, toggleRoom, toggleSlot } from "./notebook";
import type { Notebook } from "./notebook";

const line = frameOf({
  plan: corridorPlan(4),
  suspects: 3,
  slots: 4,
  murderRoom: 3,
});

const kinds = (frame: CaseFrame, n: Notebook) =>
  findErrors(frame, n).map((e) => e.kind);

describe("what the notebook complains about", () => {
  it("says nothing about a blank notebook", () => {
    expect(findErrors(line, newNotebook(line))).toEqual([]);
  });

  it("flags a cell with nowhere left", () => {
    const n = newNotebook(line);
    n.ruledOut[1][2] = fullMask(line.plan.rooms.length);
    const found = findErrors(line, n);
    expect(found.map((e) => e.kind)).toEqual(["empty-cell"]);
    expect(found[0].cells).toEqual([{ p: 1, t: 2 }]);
  });

  it("flags a step nobody could take", () => {
    // A corridor: room 0 and room 3 are three doors apart.
    let n = setRoom(line, newNotebook(line), 0, 0, 0);
    n = setRoom(line, n, 0, 1, 3);
    const found = findErrors(line, n);
    expect(found.map((e) => e.kind)).toEqual(["movement"]);
    expect(found[0].cells).toEqual([
      { p: 0, t: 0 },
      { p: 0, t: 1 },
    ]);
  });

  it("says nothing about a step through an open door", () => {
    let n = setRoom(line, newNotebook(line), 0, 0, 1);
    n = setRoom(line, n, 0, 1, 2);
    expect(findErrors(line, n)).toEqual([]);
  });

  it("says nothing when only one of the two cells is settled", () => {
    // Half a step is not a violation: the open cell may yet become a room
    // the settled one can reach, and flagging it would punish working left
    // to right.
    let n = setRoom(line, newNotebook(line), 0, 0, 0);
    n = toggleRoom(n, 0, 1, 1);
    expect(findErrors(line, n)).toEqual([]);
  });

  it("flags a step through a door the case file closed", () => {
    const closed = frameOf({
      plan: corridorPlan(4),
      suspects: 3,
      slots: 4,
      murderRoom: 3,
      rules: {
        ...noRules(),
        closures: [{ door: line.plan.doorBetween[0 * 4 + 1], from: 0, to: 2 }],
      },
    });
    let n = setRoom(closed, newNotebook(closed), 0, 0, 0);
    n = setRoom(closed, n, 0, 1, 1);
    expect(kinds(closed, n)).toEqual(["movement"]);
  });

  it("flags a step through a door that person may not use", () => {
    const barred = frameOf({
      plan: corridorPlan(4),
      suspects: 3,
      slots: 4,
      murderRoom: 3,
      rules: {
        ...noRules(),
        doorBars: [{ person: 0, door: line.plan.doorBetween[1 * 4 + 2] }],
      },
    });
    let n = setRoom(barred, newNotebook(barred), 0, 0, 1);
    n = setRoom(barred, n, 0, 1, 2);
    expect(kinds(barred, n)).toEqual(["movement"]);
    // ...and says nothing about somebody else taking the same door.
    let ok = setRoom(barred, newNotebook(barred), 1, 0, 1);
    ok = setRoom(barred, ok, 1, 1, 2);
    expect(findErrors(barred, ok)).toEqual([]);
  });

  it("flags a person pencilled into a room the case file bars them from", () => {
    const barred = frameOf({
      plan: corridorPlan(4),
      suspects: 3,
      slots: 4,
      murderRoom: 3,
      rules: { ...noRules(), roomBars: [{ person: 2, room: 1 }] },
    });
    const n = setRoom(barred, newNotebook(barred), 2, 0, 1);
    expect(kinds(barred, n)).toEqual(["barred-room"]);
    // A pencil mark that merely allows the room is not a claim about it.
    const loose = toggleRoom(newNotebook(barred), 2, 0, 0);
    expect(findErrors(barred, loose)).toEqual([]);
  });

  it("flags more suspects in a room than it holds", () => {
    const small = frameOf({
      plan: gridPlan(3, 2),
      suspects: 4,
      slots: 4,
      murderRoom: 0,
      rules: { ...noRules(), capacities: [{ room: 2, max: 2 }] },
    });
    let n = setRoom(small, newNotebook(small), 0, 1, 2);
    n = setRoom(small, n, 1, 1, 2);
    expect(findErrors(small, n)).toEqual([]);
    n = setRoom(small, n, 2, 1, 2);
    const found = findErrors(small, n);
    expect(found.map((e) => e.kind)).toEqual(["capacity"]);
    expect(found[0].cells.length).toBe(3);
  });

  /**
   * The victim is left out of the capacity count on purpose. They stop being
   * a living body partway through the evening and the player does not know
   * when, so counting them could flag a notebook that is perfectly legal with
   * a corpse in the corner. Suspects alone are a lower bound on the living,
   * which is all the check needs to be sound.
   */
  it("does not count the victim towards a room's capacity", () => {
    const small = frameOf({
      plan: gridPlan(3, 2),
      suspects: 2,
      slots: 4,
      murderRoom: 0,
      rules: { ...noRules(), capacities: [{ room: 2, max: 2 }] },
    });
    let n = setRoom(small, newNotebook(small), 0, 1, 2);
    n = setRoom(small, n, 1, 1, 2);
    n = setRoom(small, n, small.victim, 1, 2);
    expect(findErrors(small, n)).toEqual([]);
  });

  it("flags crossing off every suspect, and every hour", () => {
    let n = newNotebook(line);
    for (let s = 0; s < line.suspects; s++) n = toggleCleared(n, s);
    expect(kinds(line, n)).toEqual(["no-suspects"]);

    let m = newNotebook(line);
    for (let t = 0; t < line.slots; t++) m = toggleSlot(m, t);
    expect(kinds(line, m)).toEqual(["no-slots"]);
  });
});

describe("reading the notebook for the map and the accusation", () => {
  it("reports the settled answer, and nothing before it is settled", () => {
    let n = newNotebook(line);
    expect(notebookAnswer(line, n)).toBeNull();
    for (let s = 1; s < line.suspects; s++) n = toggleCleared(n, s);
    expect(notebookAnswer(line, n)).toBeNull();
    for (let t = 1; t < line.slots; t++) n = toggleSlot(n, t);
    expect(notebookAnswer(line, n)).toEqual({ culprit: 0, slot: 0 });
  });

  it("separates who is placed from who is merely possible", () => {
    let n = setRoom(line, newNotebook(line), 0, 2, 1);
    n = toggleRoom(n, 1, 2, 0);
    const placed = placedIn(line, n, 2);
    expect(placed.get(1)).toEqual([0]);
    const maybe = candidatesIn(line, n, 2);
    expect(maybe.get(0) ?? []).not.toContain(1);
    expect(maybe.get(1) ?? []).toContain(1);
    // Somebody settled appears only among the placed.
    for (const [, people] of maybe) expect(people).not.toContain(0);
  });
});

/**
 * Signpost's test, ported: play a whole correct solve in scrambled order and
 * demand silence.
 *
 * Every mark made here is true — a room crossed out is a room the person was
 * really not in, a suspect cleared really is innocent, an hour closed really
 * is not the murder hour — so at no point is the notebook in a state that
 * cannot be completed, and the status bar must have nothing to say the whole
 * way through.
 *
 * It is the strongest thing a checker like this can be asked, because the
 * failure it hunts is the one that ruins the game rather than the one that
 * merely annoys: a false alarm tells a player that a correct deduction was
 * wrong. It is taken over generated cases rather than hand-built ones so
 * that real case-file rules — closed doors, barred rooms, capacities — are in
 * play, since every one of them is something a checker could be too eager
 * about.
 */
describe("a correct solve, in scrambled order, in silence", () => {
  for (const preset of PRESET_NAMES) {
    it(`stays quiet through a ${preset} case`, () => {
      for (let seed = 0; seed < 6; seed++) {
        const out = generate(newCaseId(preset, `q${seed}`));
        expect(out.case, `${preset} q${seed} made no case`).not.toBeNull();
        const c = out.case!;
        const { frame, world } = c;

        type Mark = { kind: "room"; p: number; t: number; r: number } | { kind: "clear"; s: number } | { kind: "slot"; t: number };
        const marks: Mark[] = [];
        for (let p = 0; p < frame.people; p++) {
          for (let t = 0; t < frame.slots; t++) {
            for (let r = 0; r < frame.plan.rooms.length; r++) {
              if (r !== world.loc[p][t]) marks.push({ kind: "room", p, t, r });
            }
          }
        }
        for (let s = 0; s < frame.suspects; s++) {
          if (s !== world.culprit) marks.push({ kind: "clear", s });
        }
        for (let t = 0; t < frame.slots; t++) {
          if (t !== world.murderSlot) marks.push({ kind: "slot", t });
        }

        const order = new RNG(`skiron-scramble:${preset}:${seed}`).shuffle(marks);
        let n = newNotebook(frame);
        for (let i = 0; i < order.length; i++) {
          const m = order[i];
          if (m.kind === "room") n.ruledOut[m.p][m.t] |= bit(m.r);
          else if (m.kind === "clear") n.clearedSuspects |= bit(m.s);
          else n.ruledOutSlots |= bit(m.t);

          const found = findErrors(frame, n);
          expect(
            found.map((e) => `${e.kind}: ${e.text}`),
            `${preset} q${seed} complained after ${i + 1} true marks`,
          ).toEqual([]);
        }

        // And at the end the notebook is the answer, which is what makes the
        // silence worth something: a checker that never speaks would also
        // pass, but only this run ends on the truth.
        expect(notebookAnswer(frame, n)).toEqual({
          culprit: world.culprit,
          slot: world.murderSlot,
        });
      }
    });
  }
});
