/**
 * The record of everything played, kept per difficulty.
 *
 * Per **difficulty**, not per preset requested: a preset is a request and the
 * tier the solver actually needed is the answer (`difficulty.ts`), so asking
 * for Expert and being handed a Hard case must count as a Hard case solved.
 * Counting the request instead would let a player inflate their Expert column
 * by asking for Expert and playing whatever turned up.
 *
 * Pure functions over a plain record, so the round-trip through storage is
 * testable and the controller has nothing to get wrong but the call.
 */

import type { PresetName } from "$lib/engine/types";
import { emptyDifficultyStats } from "./types";
import type { DifficultyStats, Stats } from "./types";

export interface Outcome {
  difficulty: PresetName;
  actions: number;
  par: number;
  ms: number;
  hints: number;
  wrong: number;
}

/** A case has been opened. Counted once, when it is first started. */
export function recordStart(stats: Stats, difficulty: PresetName): Stats {
  const row = { ...(stats[difficulty] ?? emptyDifficultyStats()) };
  row.started += 1;
  return { ...stats, [difficulty]: row };
}

/**
 * A case has been solved.
 *
 * The streak is per difficulty and counts solves, so it is a "how many in a
 * row have I finished" rather than a daily thing — Skiron has no daily case
 * until wave 9, and a streak that broke overnight would be measuring sleep.
 */
export function recordSolve(stats: Stats, outcome: Outcome): Stats {
  const row = { ...(stats[outcome.difficulty] ?? emptyDifficultyStats()) };
  row.solved += 1;
  row.totalMs += outcome.ms;
  row.hints += outcome.hints;
  row.wrong += outcome.wrong;
  if (outcome.actions <= outcome.par) row.atPar += 1;
  if (row.bestMs === null || outcome.ms < row.bestMs) row.bestMs = outcome.ms;
  if (row.bestActions === null || outcome.actions < row.bestActions) {
    row.bestActions = outcome.actions;
  }
  row.streak += 1;
  if (row.streak > row.bestStreak) row.bestStreak = row.streak;
  return { ...stats, [outcome.difficulty]: row };
}

/**
 * A case has been abandoned unsolved.
 *
 * It breaks the streak and nothing else. Giving up is not a wrong answer and
 * does not belong in the wrong-accusation column; the only thing it is
 * evidence of is that the run of solves has stopped.
 */
export function recordAbandon(stats: Stats, difficulty: PresetName): Stats {
  const row = { ...(stats[difficulty] ?? emptyDifficultyStats()) };
  row.streak = 0;
  return { ...stats, [difficulty]: row };
}

export function totalSolved(stats: Stats): number {
  return Object.values(stats).reduce(
    (n, row: DifficultyStats) => n + row.solved,
    0,
  );
}

export function totalTime(stats: Stats): number {
  return Object.values(stats).reduce(
    (n, row: DifficultyStats) => n + row.totalMs,
    0,
  );
}
