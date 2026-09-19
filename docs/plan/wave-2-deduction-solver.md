# Wave 2 — Deduction solver, grading, explanations, hints

**Goal.** A solver that reasons as a person does, records why, grades a case by the
hardest rule it needed, and can turn any step or clue into an English sentence.

**Prerequisites.** Wave 1. Read "Two solvers" and invariants 3, 5 and 10 in `README.md`.
Read Signpost's `solver/` for the shape: rules as small sound functions, a pipeline that
always tries the lowest tier first, `nextDeduction` for hints.

**Size.** Large. This is the heart of the project.

## Tasks

1. **`solver/state.ts`.** Candidate rooms per person per slot, candidate culprits,
   candidate murder slots, the set of trusted testimonies, and a contradiction flag.
   Cloneable cheaply, because tier 3 and 4 run scratch copies. With lying off, every
   testimony is trusted from the start. With lying on, a suspect's testimony becomes
   trusted when they leave the culprit candidates.
2. **Rules, one file per tier under `solver/rules/`.** The tier table in the README is the
   specification. Notes:
   - Tier 0 includes the coupling between the victim's row and `t*` (the victim is in `r*`
     from `t*` on), and rule 5 in both directions: a cleared person placed in `r*` at `t`
     forces `t* > t`; once `t*` is bounded above, cleared people lose `r*` afterwards.
   - Tier 1 is arc consistency along each person's timeline in both directions, honouring
     closures and bars. Multi-slot consequences fall out of repeating it.
   - Tier 3's self-incrimination and conflict-pair rules are bounded scratch runs using
     tiers 0–2 only. They are a named special case of hypothesis, separated out because
     "these two stories cannot both be true" is how a person actually reasons.
   - Tier 4 assumes a culprit or a murder slot, propagates with tiers 0–3, and eliminates
     on contradiction. Depth 1. `TRIAL_BUDGET` caps the work and is part of the grade.
3. **`solver/solve.ts`.** Run to a fixpoint, lowest tier first, restarting from tier 0
   after every successful step. Return the steps, the highest tier used, and whether it
   finished (one culprit, one slot). Take a tier cap as a parameter — the generator needs
   it.
4. **`solver/difficulty.ts`.** Tier ↔ difficulty names, and the presets' size table
   (*starting point*: Easy 4 suspects / 5 rooms / 5 slots; Normal 5/6/6; Hard 5/7/7 with
   lying; Expert 6/8/8 with lying).
5. **`solver/explain.ts`.** Two renderers. `clueSentence(clue, glossary)` is the template
   text for every clue type, used whenever no LLM prose exists — so it must read decently,
   not like a debug dump. `stepSentence(step, glossary)` explains a deduction by naming the
   cards it rests on: "Card 3 puts someone in the library at nine, and everyone but Mrs
   Hale is accounted for elsewhere, so it was her." The glossary supplies names; with no
   skin it falls back to "Suspect A", "Room 3", "slot 4".
6. **`solver/hint.ts`.** Input: the collected cards, the player's notebook state, the
   truth, the essential-card list. Output, in this order: a warning if the notebook has
   ruled out something true (without saying which cell); else the lowest-tier next step
   whose conclusion the notebook lacks; else the topic that releases the next essential
   card.
7. **ARCHITECTURE.md:** the rules, the soundness argument, and the fairness argument.

## Tests

- **Soundness oracle — the most important suite in the project.** For 300+ random worlds
  and random subsets of true clues, lying on and off (with generated or hand-written lies),
  run to fixpoint and assert that no removed room candidate is `cellPossible`, no removed
  culprit or slot is in `answers`, and the contradiction flag is never set from true clues.
- Each rule: a minimal position where it must fire, and one where it must not.
- Tier ordering: a case solvable at tier 1 is never graded higher.
- Explain coverage: every rule id and every clue type renders, with and without a
  glossary, and no output contains `undefined` or a raw id.
- Hint order: the three branches each have a test.

## Exit criteria

- All green. Until wave 3 exists, exercise the solver on hand-built cases and on "all true
  clues" sets from wave 1's simulator, which it should finish at a low tier.

---

## As built so far (2026-09-19)

Landed and committed: `solver/state.ts`, `solver/rules/tier0.ts`, `solver/rules/tier1.ts`,
`solver/solve.ts`, `solver/solver.test.ts`. 284 tests green, `npm run check` at 0/0.

### One deviation from the plan above, recorded as CLAUDE.md requires

**Candidates are (culprit, slot) pairs, not two flat sets.** Task 1 above asks for
"candidate culprits, candidate murder slots". The code keeps `state.answer[suspect]` — a
mask of the slots still possible as `t*` *if that suspect did it*. Pairs are strictly
stronger and are how a person reasons: *"if it was the Colonel it must have been at nine,
and he was in the hall at nine, so it was not the Colonel"* cannot be expressed by two
independent sets, which would have to keep both the Colonel and nine o'clock alive.
Fairness is defined on pairs (ARCHITECTURE.md §4), so it is also the right granularity for
an elimination. `culpritMask()` and `slotMask()` derive the flat views where a caller
wants them.

Two further decisions, both in ARCHITECTURE.md §7:

- **Trust is derived, never stored.** `trusted = lying ? allSuspects & ~culprits :
  allSuspects`. Clearing a suspect *is* trusting them, so there is no second structure to
  keep in step.
- **`mayBeLivingIn` / `mustBeLivingIn` are the only sanctioned way for a rule to ask about
  the victim.** A rule may push the victim out of a room only when every surviving pair
  agrees they were alive then, and may conclude they were dead only when they are *forced*
  into that room. This is the likeliest source of unsoundness in the wave, so it is one
  named chokepoint rather than a thing each rule gets right on its own.

### What exists

- **`state.ts`** — `SolverState`, `SolverContext`, the derived views, and the only
  sanctioned mutators: `restrict`, `removeRooms`, `killPairs`, `killSlots`,
  `clearSuspects`, `contradict`. Every mutation notices whether it changed anything,
  notices an emptied domain, and records a `Step`. A rule that pokes `state.dom` directly
  is a rule whose deduction the hint system cannot explain.
  `RuleId` is a **closed union and the single source of truth** — it already names the
  tier 2, 3 and 4 rules. `explain.ts` must render every member and a test must prove it,
  so adding a rule forces you to give it a sentence.
- **`tier0.ts`** — direct clue application (`At`, `NotAt`, `Stayed`, `Saw`, `AloneIn`,
  `Empty`, `NeverVisited`, `AliveAt`, `DeathWindow`, plus the liveness half of `Together`)
  and the murder axioms: `body-at-end` (the body is certainly in `r*` in the last slot,
  since `t* <= T-1`), `opportunity`, `witness-in-room` (rule 4), `sealed-after` and
  `sealed-back` (rule 5, both directions), `victim-not-yet-dead`, and the endgame pin when
  one pair is left.
- **`tier1.ts`** — arc consistency along each person's timeline, both directions, over
  `movementMasks`. Deliberately no bespoke multi-slot rule: repetition to a fixpoint *is*
  the multi-slot consequence.
- **`solve.ts`** — the pipeline. `TIERS` is an array and **the array order is the tier
  order**; appending tiers 2 to 4 is the whole wiring job. `runToFixpoint` restarts from
  tier 0 after any tier fires, so a tier only ever fires when every cheaper tier is
  saturated, which is what makes the grade meaningful. `TRIAL_BUDGET` is declared here
  (20000, a *starting point* — it is part of the grade, invariant 10).
- **`solver.test.ts`** — the soundness oracle. 120 random cases across four sizes, with
  the culprit lying freely, asserting that nothing the deduction solver removed is
  `cellPossible` or `answerPossible`, that the truth is never eliminated, and that a
  finished run names it. It also guards itself: it asserts that >90% of cases actually
  deduced something, so a solver that stopped working could not pass vacuously.
  **A new rule joins this guard.**

## Tiers 2, 3 and 4 as built (2026-09-19)

All five tiers are in and wired; `TIERS` in `solve.ts` is the whole wiring. 304 tests
green, `npm run check` at 0/0. ARCHITECTURE.md §7 is now the full account — the tier
table, the four decisions, the tier boundaries and how the whole thing is guarded — so
what follows is only what a reader of *this file* needs, which is where the code differs
from the tasks above.

- **Tier 3 sits out cases without lying**, which task 2 implied ("trust") but did not
  say. With lying off everybody is trusted from the start, so supposing somebody innocent
  adds no card; it only narrows the answer, and that is tier 4's job and tier 4's grade.
  A truthful case graded Hard for a trust deduction it could not have made would be a
  lie told to the player.
- **Depth 1 is a field, not a consequence.** Task 2 says tier 4 is depth 1, and capping a
  trial at tier 3 achieves that. But it achieves it as a side effect of a number, so
  `Deduction.depth` now counts suppositions and tier 4 refuses to run above zero. Depth is
  difficulty: a case needing two suppositions at once is not one a person can solve, and
  if the cap were ever widened such cases would start being certified fair.
- **`TRIAL_BUDGET` lives in `state.ts`**, not in `solve.ts` as originally written, so that
  `SolverContext` can carry it without the two files importing each other. `solve.ts`
  re-exports it; callers should keep reading it from there. `SolveResult` gained
  `trialNodes` and `budgetSpent`, so that an unfinished run can say whether it ran out of
  budget or ran out of argument — the generator must reject the case either way, but only
  one of the two is a reason to look at the budget.
- **Tier 4 sweeps a flavour at a time.** It runs every culprit trial, applies whatever
  they refuted, and returns; only if none refuted anything does it move to slots, then to
  pairs. Cheapest flavour first, one step recorded per elimination, and the trials within
  a sweep all read the same starting state, so they stay independent.

### What the tests now say

- `solver.test.ts` grew a density spread and a fifth size, and two new guards: **every
  tier must be some case's grade** (a tier that stops firing can no longer be certified
  by a suite that never ran it), and the budget properties — starving tier 4 must weaken
  the result and never strengthen it, and an ordinary case must stay well inside the cap.
- `rules/rules.test.ts` is new: each tier 2 and tier 3 rule gets a minimal board where it
  must fire and the same board with the one card removed that made it fire, every one
  cross-checked against the exhaustive solver. Tier 4 is covered by the corpus properties
  instead, because every small hand-built position for it turned out to be solvable at
  tier 3 — which is itself worth knowing: `conflict-pair` is stronger than it looks.
- Run by hand and recorded in ARCHITECTURE.md §7 rather than committed: 14,400 cases of
  differential fuzzing against the exhaustive solver, and nine planted mutations.

## Still to do

1. **`difficulty.ts`** — tier ↔ name (Easy ≤ 1, Normal ≤ 2, Hard = 3, Expert = 4; Hard and
   Expert have lying on) and the preset size table. The *actual* tier is authoritative and
   is what the UI shows, as in Signpost.
2. **`explain.ts`** — `clueSentence` and `stepSentence`, over the `Conclusion` union in
   `state.ts` (`room-set`, `rooms-out`, `pairs-out`, `cleared`, `slots-out`,
   `contradiction`). Conclusions are data, not prose, precisely so the same step renders as
   "Suspect B" with no skin and "Mrs Hale" with one — and in Hungarian in wave 9.
   `Premises` now also carries `assumedInnocent` and `assumedAnswer`, which is how a trial
   step says what it supposed: one pair reads "suppose it was her, at nine", a whole row
   "suppose it was her", a whole column "suppose it happened at nine".
3. **`hint.ts`** — the three branches in the order the plan gives.
