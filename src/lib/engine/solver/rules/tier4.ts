/**
 * Tier 4 — hypothesis. Depth 1.
 *
 * Suppose an answer, follow it with every cheaper rule, and if it cannot
 * stand, cross it off. It is the last resort and the hardest kind of
 * reasoning the game asks for, which is exactly why it is the top of the
 * grade: a case that needs this is an Expert case.
 *
 * Three flavours, cheapest first, and the order matters for more than speed.
 *
 *  1. **A culprit.** Much the strongest hypothesis, because supposing one
 *     suspect guilty clears every other suspect at once — and clearing them
 *     *is* trusting them (`trustedMask`), so a single supposition unlocks
 *     every other testimony in the notebook. On a lying case that is usually
 *     where the whole case turns.
 *  2. **A slot.** Fewer of them than pairs, and it bites on the victim's row
 *     and on rule 5 immediately.
 *  3. **A pair.** Not optional, and the reason is worth stating: a culprit
 *     trial can only ever clear a whole suspect, and a slot trial a whole
 *     column, so both can run out while two pairs are still alive in one
 *     suspect's row — "he did it, at nine or at ten". Finishing means *one*
 *     pair, so without pair trials such a case would be certified unfair and
 *     thrown away by the generator, which is a silent loss of good cases.
 *
 * **Depth 1.** Every trial propagates with tiers 0 to 3 only, so no trial
 * ever opens a trial. Tier 3 does run inside a trial, but only usefully
 * inside a *slot* trial: a culprit or pair trial leaves one candidate, and
 * tier 3 needs two to say anything.
 *
 * **The budget is part of the grade** (critical invariant 10). A trial that
 * would have found something but was not run leaves the case unfinished and
 * the generator rejects it, so raising `TRIAL_BUDGET` changes which cases
 * exist. It is therefore a constant of the game, not a knob to turn when a
 * case one liked did not make it.
 *
 * SOUNDNESS. A trial starts from a clone whose surviving pairs still include
 * every answer consistent with the clues, minus what the hypothesis excludes.
 * Every rule it runs is sound, so a contradiction proves no consistent world
 * satisfies the hypothesis, and the hypothesis may be crossed off. The one
 * case to be careful of is a hypothesis that empties the candidate set by
 * itself: that is not a refutation, it is an empty question, and `trial`
 * answers false.
 */

import { bit, bitsOf } from "../../bits";
import type { Answer, PersonId, SlotIndex } from "../../types";
import type { Deduction, SolverState } from "../state";
import {
  branch,
  clearSuspects,
  culpritMask,
  didChange,
  killPairs,
  killSlots,
  pairCount,
  pairs,
  slotMask,
} from "../state";
import { runToFixpoint } from "../solve";

export const TIER = 4;

export function tier4(d: Deduction): boolean {
  return didChange(d, () => {
    // Depth 1, said out loud. Capping a trial at tier 3 already keeps this
    // tier out of its own branches, but that is a consequence of a number
    // rather than a rule, and the rule is the thing that matters: a case
    // needing two suppositions at once is not a case a person can solve.
    if (d.depth > 0 || spent(d)) return;

    // 1. Culprits.
    const culprits = bitsOf(culpritMask(d.state));
    if (culprits.length > 1) {
      const out: { who: PersonId; assumed: Answer[] }[] = [];
      for (const s of culprits) {
        if (spent(d)) break;
        if (trial(d, (st) => keepCulprit(st, s))) {
          out.push({ who: s, assumed: rowPairs(d.state, s) });
        }
      }
      for (const { who, assumed } of out) {
        clearSuspects(d, bit(who), "trial-culprit", TIER, {
          clues: [],
          cells: [],
          assumedAnswer: assumed,
        });
        if (d.state.contradiction) return;
      }
      if (out.length > 0) return;
    }

    // 2. Slots.
    const slots = bitsOf(slotMask(d.state));
    if (slots.length > 1) {
      const out: { when: SlotIndex; assumed: Answer[] }[] = [];
      for (const t of slots) {
        if (spent(d)) break;
        if (trial(d, (st) => keepSlot(st, t))) {
          out.push({ when: t, assumed: columnPairs(d.state, t) });
        }
      }
      for (const { when, assumed } of out) {
        killSlots(d, bit(when), "trial-slot", TIER, {
          clues: [],
          cells: [],
          assumedAnswer: assumed,
        });
        if (d.state.contradiction) return;
      }
      if (out.length > 0) return;
    }

    // 3. Pairs.
    const remaining = pairs(d.state);
    if (remaining.length > 1) {
      const out: Answer[] = [];
      for (const a of remaining) {
        if (spent(d)) break;
        if (trial(d, (st) => keepPair(st, a))) out.push(a);
      }
      for (const a of out) {
        killPairs(
          d,
          (s, t) => s === a.culprit && t === a.slot,
          "trial-pair",
          TIER,
          { clues: [], cells: [], assumedAnswer: [a] },
        );
        if (d.state.contradiction) return;
      }
    }
  });
}

/* ------------------------------------------------------------- the trial */

/** Has the hypothesis search used up its budget for this solve? */
function spent(d: Deduction): boolean {
  return d.trialNodes >= d.ctx.trialBudget;
}

/**
 * Suppose what `narrow` says, propagate with every cheaper tier, and report
 * whether it collapsed.
 *
 * The charge is one fee for the pass plus every state change the propagation
 * caused. The fee matters: a hypothesis that changes nothing still costs a
 * sweep of the rules, and without it a case full of inert trials could spin
 * for free.
 */
function trial(d: Deduction, narrow: (st: SolverState) => void): boolean {
  const b = branch(d);
  narrow(b.state);
  // None of the three narrowings below can empty the candidate set — each one
  // keeps a pair the state still allows — so this never fires today. It is
  // here so that a fourth one cannot quietly turn an empty question into a
  // refutation, which would be unsound in the worst way: silently, and only
  // on the cases where the answer had already been cornered.
  if (pairCount(b.state) === 0) return false;
  const before = b.nodes;
  runToFixpoint(b, TIER - 1);
  d.nodes = b.nodes;
  d.trialNodes += 1 + (b.nodes - before);
  return b.state.contradiction;
}

/* -------------------------------------------------------- the hypotheses */

function keepCulprit(st: SolverState, s: PersonId): void {
  for (let q = 0; q < st.answer.length; q++) if (q !== s) st.answer[q] = 0;
}

function keepSlot(st: SolverState, t: SlotIndex): void {
  for (let q = 0; q < st.answer.length; q++) st.answer[q] &= bit(t);
}

function keepPair(st: SolverState, a: Answer): void {
  for (let q = 0; q < st.answer.length; q++) {
    st.answer[q] = q === a.culprit ? st.answer[q] & bit(a.slot) : 0;
  }
}

/** The surviving pairs a hypothesis covered, so the step can be read back. */
function rowPairs(st: SolverState, s: PersonId): Answer[] {
  return bitsOf(st.answer[s]).map((slot) => ({ culprit: s, slot }));
}

function columnPairs(st: SolverState, t: SlotIndex): Answer[] {
  const out: Answer[] = [];
  for (let s = 0; s < st.answer.length; s++) {
    if ((st.answer[s] & bit(t)) !== 0) out.push({ culprit: s, slot: t });
  }
  return out;
}
