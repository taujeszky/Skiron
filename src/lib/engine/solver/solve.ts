/**
 * The deduction pipeline: run the rules to a fixpoint, lowest tier first, and
 * report the highest tier that was actually needed.
 *
 * Two things this file is responsible for.
 *
 * **Grading.** Tiers are always tried in order and the loop restarts from
 * tier 0 after any tier does something, so a tier only ever fires when every
 * cheaper tier is saturated. The highest tier that fired is therefore the
 * hardest kind of reasoning the case really demanded — which is what the UI
 * shows and what the generator selects on.
 *
 * **The fairness certificate.** Every rule removes only candidates that
 * appear in no legal world consistent with the clues. So if a run ends with a
 * single surviving (culprit, slot) pair, no other answer exists and the case
 * is fair. That argument holds *only* while every rule is sound, which is why
 * `solver.test.ts` checks the whole pipeline against wave 1's exhaustive
 * solver and why a new rule has to join that guard.
 */

import type { Answer, CaseFrame, Clue } from "../types";
import { tier0 } from "./rules/tier0";
import { tier1 } from "./rules/tier1";
import { tier2 } from "./rules/tier2";
import { tier3 } from "./rules/tier3";
import { tier4 } from "./rules/tier4";
import type { Deduction, SolverState, Step } from "./state";
import {
  TRIAL_BUDGET,
  finished,
  initialState,
  makeContext,
  newDeduction,
  pairCount,
  soleAnswer,
} from "./state";

/**
 * The tier-4 work cap. Declared in `state.ts` so that `SolverContext` can
 * carry it without the two files importing each other, and re-exported here
 * because this is where callers look for it.
 */
export { TRIAL_BUDGET } from "./state";

/**
 * One pass of a tier. Returns whether it changed anything. The array order IS
 * the tier order, and the index is the tier number the grade reports.
 *
 * Tiers 3 and 4 import `runToFixpoint` from this file, which is a cycle. It
 * is a safe one: every tier is a hoisted `function` declaration and the
 * import is only ever read when a trial runs, long after both modules have
 * finished evaluating. Turning a tier into a `const` arrow would break that,
 * so do not.
 */
export type TierPass = (d: Deduction) => boolean;

export const TIERS: TierPass[] = [tier0, tier1, tier2, tier3, tier4];

/** The highest tier the solver knows about. */
export const MAX_TIER = TIERS.length - 1;

export interface SolveOptions {
  /** Refuse to use rules above this tier. The generator grades with it. */
  maxTier?: number;
  /** Keep the step records. Off for the scratch runs inside tiers 3 and 4. */
  record?: boolean;
  /**
   * Work cap for the bounded hypothesis search. It is part of the grade
   * (invariant 10): changing it changes which cases count as Expert.
   */
  trialBudget?: number;
}

export interface SolveResult {
  state: SolverState;
  steps: Step[];
  /** The highest tier that produced a step, or -1 if nothing was deduced. */
  tier: number;
  /** One culprit and one slot survived. */
  finished: boolean;
  /** The clues cannot all hold: the player has been given a bad notebook. */
  contradiction: boolean;
  answer: Answer | null;
  /** How many surviving pairs are left, for hints and for diagnostics. */
  remaining: number;
  nodes: number;
  /** What tier 4 spent, against `trialBudget`. */
  trialNodes: number;
  /**
   * True when the hypothesis search stopped because it ran out of budget, so
   * an unfinished run means "not proved within the budget" rather than "not
   * provable". The generator must treat such a case as unfair either way.
   */
  budgetSpent: boolean;
}

export function solve(
  frame: CaseFrame,
  clues: readonly Clue[],
  opts: SolveOptions = {},
): SolveResult {
  const ctx = makeContext(frame, clues, opts.trialBudget ?? TRIAL_BUDGET);
  const d = newDeduction(ctx, initialState(ctx), opts.record ?? true);
  const tier = runToFixpoint(d, opts.maxTier ?? MAX_TIER);
  return {
    state: d.state,
    steps: d.steps ?? [],
    tier,
    finished: finished(d.state),
    contradiction: d.state.contradiction,
    answer: soleAnswer(d.state),
    remaining: pairCount(d.state),
    nodes: d.nodes,
    trialNodes: d.trialNodes,
    budgetSpent: d.trialNodes >= ctx.trialBudget,
  };
}

/**
 * Run the tiers to a fixpoint and return the highest one that fired.
 *
 * Exported because tiers 3 and 4 need it: both work by assuming something,
 * propagating with the cheaper tiers, and looking for a contradiction.
 */
export function runToFixpoint(d: Deduction, maxTier: number): number {
  const cap = Math.min(maxTier, MAX_TIER);
  let highest = -1;
  for (;;) {
    if (d.state.contradiction) return highest;
    let fired = -1;
    for (let t = 0; t <= cap; t++) {
      if (TIERS[t](d)) {
        fired = t;
        break; // start again from tier 0: cheap reasoning first, always
      }
    }
    if (fired < 0) return highest;
    if (fired > highest) highest = fired;
  }
}
