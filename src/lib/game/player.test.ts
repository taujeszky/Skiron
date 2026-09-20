import { describe, expect, it } from "vitest";

import { newCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import type { GeneratedCase } from "$lib/engine/generator/generate";
import { actionMenuSize, parFor } from "$lib/engine/generator/investigation";
import { PRESET_NAMES } from "$lib/engine/solver/difficulty";

import { blindPlay, everyAction } from "./player";
import { askKey, examineKey } from "./types";

function casesFor(preset: (typeof PRESET_NAMES)[number], n: number): GeneratedCase[] {
  const out: GeneratedCase[] = [];
  for (let i = 0; i < n; i++) {
    const made = generate(newCaseId(preset, `p${i}`));
    expect(made.case, `${preset} p${i} made no case`).not.toBeNull();
    out.push(made.case!);
  }
  return out;
}

/**
 * The menu size is computed twice — as a formula in the engine, because par
 * needs it and the engine may not import the game layer, and as a list here,
 * because the interface needs the list. Two copies of one rule is how the
 * hint/investigation split nearly went wrong in wave 3, so this is the guard
 * that says they still agree.
 */
describe("the action menu", () => {
  it("is the size the engine's par formula assumes", () => {
    for (const preset of PRESET_NAMES) {
      for (const c of casesFor(preset, 2)) {
        expect(everyAction(c.frame).length, preset).toBe(actionMenuSize(c.frame));
      }
    }
  });

  it("holds every offered action exactly once, and no others", () => {
    const c = casesFor("normal", 1)[0];
    const frame = c.frame;
    const keys = everyAction(frame).map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Every room can be searched.
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      expect(keys).toContain(examineKey(r));
    }
    // Nobody is asked about themselves — that question is the motive.
    for (let s = 0; s < frame.suspects; s++) {
      expect(keys).not.toContain(askKey(s, `person:${s}`));
      expect(keys).toContain(askKey(s, "motive"));
    }
    // The victim can be asked about, and asks nothing.
    expect(keys).toContain(askKey(0, `person:${frame.victim}`));
    expect(keys).not.toContain(askKey(frame.victim, "motive"));
  });

  it("par is the engine's formula, applied to the case", () => {
    for (const c of casesFor("expert", 2)) {
      expect(c.investigation.par).toBe(
        parFor(c.frame, c.investigation.actions.length),
      );
    }
  });
});

/**
 * The guard this file exists for.
 *
 * Wave 3 proved every case fair, and wave 3's own scripted player proved
 * every case *followable* — but it followed `hint()`, which is handed the
 * proof set and therefore knows which questions matter. That leaves a real
 * failure mode untested: a case that is perfectly fair and has exactly one
 * route through it, the one the generator had in mind.
 *
 * This player never sees `essential`, `investigation.actions` or the truth.
 * It reasons from what it holds and then asks whatever bears on the most
 * still-open cells. If it reaches the answer, the bank supports an ordinary
 * search and not just the intended one.
 */
describe("a player with no idea what to ask", () => {
  for (const preset of PRESET_NAMES) {
    it(`still gets to the answer on ${preset}`, () => {
      for (const c of casesFor(preset, 6)) {
        const rec = blindPlay(c);
        expect(rec.stuck, `${c.id.seed}: ran out of questions`).toBe(false);
        expect(rec.answer, `${c.id.seed}: never settled`).not.toBeNull();
        expect(
          rec.answer,
          `${c.id.seed}: settled on the wrong pair`,
        ).toEqual({ culprit: c.world.culprit, slot: c.world.murderSlot });
        expect(rec.solved).toBe(true);
        // ...and it took some asking, which is what makes the case a case.
        expect(rec.actions.length).toBeGreaterThan(0);
        expect(rec.actions.length).toBeLessThanOrEqual(everyAction(c.frame).length);
        expect(new Set(rec.actions).size).toBe(rec.actions.length);
      }
    });
  }

  it("plays the same case the same way twice", () => {
    const c = casesFor("hard", 1)[0];
    expect(blindPlay(c).actions).toEqual(blindPlay(c).actions);
  });

  /**
   * Every action it takes must be one the interface actually offers. A player
   * that reached the answer through a question with no button would be
   * measuring a game nobody can play.
   */
  it("only ever takes an action the interface offers", () => {
    const c = casesFor("normal", 2)[0];
    const offered = new Set(everyAction(c.frame).map((a) => a.key));
    for (const key of blindPlay(c).actions) expect(offered.has(key)).toBe(true);
  });

  /**
   * The heuristic has to be worth having, and this is the only thing that
   * says so.
   *
   * A mutation pass replaced the open-cell score with a constant — reducing
   * the player to walking the menu in order — and every test stayed green,
   * because a player who asks everything also solves everything. That leaves
   * par anchored on a number with no argument behind it. So the sweep is a
   * real strategy now, and the claim is checked: aiming at what is still open
   * gets there in meaningfully fewer questions than asking in order.
   */
  it("beats asking everything in order", () => {
    for (const preset of PRESET_NAMES) {
      const aimed: number[] = [];
      const swept: number[] = [];
      for (const c of casesFor(preset, 4)) {
        aimed.push(blindPlay(c).actions.length);
        swept.push(blindPlay(c, { strategy: "sweep" }).actions.length);
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(
        mean(aimed),
        `${preset}: aiming at open cells (${mean(aimed)}) did not beat ` +
          `sweeping the menu (${mean(swept)})`,
      ).toBeLessThan(mean(swept) * 0.9);
    }
  });

  /**
   * The counterweight: with reasoning switched off entirely, the player must
   * fail. Without this, "solved every case" could be true of a player that
   * was not reasoning at all — and the whole claim rests on the reasoning
   * being what gets it there.
   */
  it("cannot get there on one action, however well chosen", () => {
    for (const c of casesFor("normal", 3)) {
      expect(blindPlay(c, { maxActions: 1 }).solved).toBe(false);
    }
  });
});
