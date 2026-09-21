import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decodePack } from "$lib/llm/pack";
import {
  LESSONS,
  TUTORIAL_PACK,
  coachProgress,
  coachStep,
  lessonFor,
  type CoachState,
} from "./tutorial";

function state(patch: Partial<CoachState> = {}): CoachState {
  return {
    examined: 0,
    asked: 0,
    cards: 0,
    marked: 0,
    hints: 0,
    wrong: 0,
    solved: false,
    ...patch,
  };
}

describe("the lessons", () => {
  /*
   * The lesson list and the pack directory are written in two places — one in
   * TypeScript, one as files on disk — and nothing else makes them agree. A
   * lesson naming a case that is not shipped is a button that opens an error
   * panel, which is exactly the failure a first-time visitor would hit.
   */
  it("each name a case that is actually shipped", () => {
    for (const lesson of LESSONS) {
      const path = `static/cases/${TUTORIAL_PACK}/${lesson.id}.json`;
      const pack = decodePack(JSON.parse(readFileSync(path, "utf8")) as unknown);
      expect(pack, `${lesson.id} should decode`).not.toBeNull();
      expect(pack!.id).toBe(lesson.id);
    }
  });

  it("are smaller than the smallest preset, which is the point of them", () => {
    for (const lesson of LESSONS) {
      const path = `static/cases/${TUTORIAL_PACK}/${lesson.id}.json`;
      const pack = decodePack(JSON.parse(readFileSync(path, "utf8")) as unknown)!;
      // Easy is 4 suspects, 5 rooms, 5 slots.
      expect(pack.case.frame.suspects).toBeLessThan(4);
      expect(pack.case.frame.plan.rooms.length).toBeLessThan(5);
    }
  });

  it("are numbered in the order they are listed", () => {
    expect(LESSONS.map((l) => l.n)).toEqual([1, 2]);
  });

  it("teach lying only in the second one", () => {
    const read = (id: string) =>
      decodePack(
        JSON.parse(readFileSync(`static/cases/${TUTORIAL_PACK}/${id}.json`, "utf8")) as unknown,
      )!;
    // Lesson one must have no liar in it: its whole job is the loop.
    expect(read(LESSONS[0].id).case.alibi).toBeNull();
    // Lesson two must have one, or it teaches nothing it claims to.
    expect(read(LESSONS[1].id).case.alibi).not.toBeNull();
  });

  it("is found by case id, and nothing else is", () => {
    expect(lessonFor(LESSONS[0].id)).toBe(LESSONS[0]);
    expect(lessonFor("SK1-N-3f9k2a")).toBeNull();
  });
});

describe("the coach", () => {
  const one = LESSONS[0];

  it("opens on the first step", () => {
    expect(coachStep(one, state())!.id).toBe("examine");
    expect(coachProgress(one, state())).toEqual({ at: 1, of: one.steps.length });
  });

  it("moves on when the player does the thing", () => {
    expect(coachStep(one, state({ examined: 1 }))!.id).toBe("ask");
    expect(coachStep(one, state({ examined: 1, asked: 1 }))!.id).toBe("mark");
    expect(coachStep(one, state({ examined: 1, asked: 1, marked: 1 }))!.id).toBe("hint");
  });

  /*
   * The property the steps were written to have, and the one most likely to
   * be broken by editing them later: a tutorial that will not proceed until
   * you press the button it wants is worse than no tutorial. Every step
   * before the last must be retired by *some* state that does not involve
   * doing exactly what it asked.
   */
  it("never blocks: a player who just plays reaches the end", () => {
    for (const lesson of LESSONS) {
      const busy = state({ examined: 4, asked: 6, cards: 9, marked: 3, hints: 0 });
      // Everything but the accusation is retired by ordinary play.
      expect(coachStep(lesson, busy)!.id).toBe("accuse");
      expect(coachStep(lesson, { ...busy, solved: true })).toBeNull();
    }
  });

  it("does not require a hint to be pressed", () => {
    const hintStep = one.steps.find((s) => s.id === "hint")!;
    expect(hintStep.done(state({ hints: 1 }))).toBe(true);
    expect(hintStep.done(state({ cards: 5 }))).toBe(true);
  });

  it("re-offers the notebook if the player undoes everything", () => {
    // `marked` counts the player's own edits and can fall back to zero, so
    // the step is chosen by what is true now rather than by how far along
    // the player once got.
    const back = state({ examined: 2, asked: 2, marked: 0 });
    expect(coachStep(one, back)!.id).toBe("mark");
  });

  it("reports itself finished once the case is solved", () => {
    const done = state({ solved: true, examined: 3, asked: 3, marked: 2, cards: 6 });
    expect(coachStep(one, done)).toBeNull();
    expect(coachProgress(one, done)).toEqual({
      at: one.steps.length,
      of: one.steps.length,
    });
  });
});
