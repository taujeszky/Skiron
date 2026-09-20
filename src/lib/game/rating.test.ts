import { describe, expect, it } from "vitest";

import { SOUND_MULTIPLE, formatDuration, rate } from "./rating";
import {
  emptyStats,
  emptyDifficultyStats,
} from "./types";
import { recordAbandon, recordSolve, recordStart, totalSolved, totalTime } from "./stats";

const clean = { actions: 10, par: 12, hints: 0, wrong: 0 };

describe("the rating", () => {
  it("gives the top rank for a clean sheet", () => {
    const r = rate(clean);
    expect(r.rank).toBe("exemplary");
    expect(r.marks).toBe(3);
    expect(r.notes).toEqual([]);
  });

  it("counts par as met when it is met exactly", () => {
    expect(rate({ ...clean, actions: 12 }).rank).toBe("exemplary");
    expect(rate({ ...clean, actions: 13 }).rank).toBe("sound");
  });

  it("drops a rank for a hint, and says so", () => {
    const r = rate({ ...clean, hints: 1 });
    expect(r.rank).toBe("sound");
    expect(r.notes).toContain("One hint.");
  });

  it("drops a rank for a wrong accusation, and says so", () => {
    const r = rate({ ...clean, wrong: 1 });
    expect(r.rank).toBe("sound");
    expect(r.notes).toContain("One wrong accusation.");
  });

  it("falls to the bottom rank past the generous bound", () => {
    expect(rate({ ...clean, actions: 12 * SOUND_MULTIPLE }).rank).toBe("sound");
    expect(rate({ ...clean, actions: 12 * SOUND_MULTIPLE + 1 }).rank).toBe("thorough");
    expect(rate({ ...clean, hints: 3 }).rank).toBe("thorough");
    expect(rate({ ...clean, wrong: 2 }).rank).toBe("thorough");
  });

  /**
   * The plan's line is that there is no fail state. A rating that could say
   * "you did not really solve it" would be one, so the bottom rank is the
   * bottom — no input reaches zero marks or an empty title.
   */
  it("never rates a solved case below the bottom rank", () => {
    for (const actions of [0, 5, 50, 500]) {
      for (const hints of [0, 1, 20]) {
        for (const wrong of [0, 1, 20]) {
          const r = rate({ actions, par: 12, hints, wrong });
          expect(r.marks).toBeGreaterThanOrEqual(1);
          expect(r.marks).toBeLessThanOrEqual(3);
          expect(r.title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("reports the moves against par when they went over", () => {
    expect(rate({ ...clean, actions: 30 }).notes[0]).toBe(
      "30 moves against a par of 12.",
    );
  });
});

describe("durations", () => {
  it("reads as somebody would say it", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(38_000)).toBe("38 s");
    expect(formatDuration(252_000)).toBe("4 m 12 s");
    expect(formatDuration(3_840_000)).toBe("1 h 04 m");
  });

  it("does not go backwards on a clock that did", () => {
    expect(formatDuration(-5000)).toBe("0 s");
  });
});

describe("the record", () => {
  it("counts a start, a solve and the streak", () => {
    let s = emptyStats();
    s = recordStart(s, "normal");
    expect(s.normal.started).toBe(1);
    s = recordSolve(s, {
      difficulty: "normal",
      actions: 9,
      par: 12,
      ms: 300_000,
      hints: 1,
      wrong: 0,
    });
    expect(s.normal.solved).toBe(1);
    expect(s.normal.atPar).toBe(1);
    expect(s.normal.bestMs).toBe(300_000);
    expect(s.normal.bestActions).toBe(9);
    expect(s.normal.hints).toBe(1);
    expect(s.normal.streak).toBe(1);
    expect(s.normal.bestStreak).toBe(1);
    // Nothing else moved.
    expect(s.easy).toEqual(emptyDifficultyStats());
  });

  it("keeps the best and not the last", () => {
    let s = emptyStats();
    const solve = (ms: number, actions: number) =>
      recordSolve(s, { difficulty: "easy", actions, par: 20, ms, hints: 0, wrong: 0 });
    s = solve(200_000, 15);
    s = solve(400_000, 22);
    expect(s.easy.bestMs).toBe(200_000);
    expect(s.easy.bestActions).toBe(15);
    expect(s.easy.totalMs).toBe(600_000);
    expect(s.easy.atPar).toBe(1);
  });

  it("breaks the streak on giving up but keeps the best one", () => {
    let s = emptyStats();
    for (let i = 0; i < 3; i++) {
      s = recordSolve(s, {
        difficulty: "hard",
        actions: 5,
        par: 20,
        ms: 1000,
        hints: 0,
        wrong: 0,
      });
    }
    expect(s.hard.streak).toBe(3);
    s = recordAbandon(s, "hard");
    expect(s.hard.streak).toBe(0);
    expect(s.hard.bestStreak).toBe(3);
    expect(s.hard.solved).toBe(3);
  });

  it("adds up across difficulties", () => {
    let s = emptyStats();
    s = recordSolve(s, {
      difficulty: "easy",
      actions: 1,
      par: 2,
      ms: 1000,
      hints: 0,
      wrong: 0,
    });
    s = recordSolve(s, {
      difficulty: "expert",
      actions: 1,
      par: 2,
      ms: 2000,
      hints: 0,
      wrong: 0,
    });
    expect(totalSolved(s)).toBe(2);
    expect(totalTime(s)).toBe(3000);
  });
});
