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

## Still to do

1. **`rules/tier2.ts` — counting.** `Occupied` with one candidate left; `Count` and
   `Capacity` (`|must| = k` excludes everyone else, `|can| = k` forces all of `can` in);
   `Visited` with one slot left; `Together` room equality (`dom[p][t] &= dom[q][t]` and
   back). Every one of these must go through `mayBeLivingIn`/`mustBeLivingIn` for the
   victim — a counting rule that reads the victim's raw domain is the classic way to make
   this tier unsound.
2. **`rules/tier3.ts` — trust (lying only).** Both are bounded scratch runs using tiers
   0–2 only (`branch(d)` then `runToFixpoint(b, 2)`).
   - *Self-incrimination*: assume suspect `s`'s testimony alongside the facts; a
     contradiction means `s` **is** the culprit, because an innocent `s` would have been
     telling the truth. Collapse `answer` to `s`'s row.
   - *Conflict pair*: assume `s1`'s and `s2`'s testimony together; a contradiction means
     one of them did it, so clear everyone else.
3. **`rules/tier4.ts` — hypothesis.** Depth 1, capped by `TRIAL_BUDGET`. Assume, propagate
   with tiers 0–3, eliminate on contradiction. Three flavours, cheapest first: a culprit
   (which trusts every other suspect at once — the big win), a slot, then a **pair**.
   Pair trials are not optional: culprit-only and slot-only trials can leave two pairs
   alive in one row, and "finished" means one pair.
4. **`difficulty.ts`** — tier ↔ name (Easy ≤ 1, Normal ≤ 2, Hard = 3, Expert = 4; Hard and
   Expert have lying on) and the preset size table. The *actual* tier is authoritative and
   is what the UI shows, as in Signpost.
5. **`explain.ts`** — `clueSentence` and `stepSentence`, over the `Conclusion` union in
   `state.ts` (`room-set`, `rooms-out`, `pairs-out`, `cleared`, `slots-out`,
   `contradiction`). Conclusions are data, not prose, precisely so the same step renders as
   "Suspect B" with no skin and "Mrs Hale" with one — and in Hungarian in wave 9.
6. **`hint.ts`** — the three branches in the order the plan gives.

Note for whoever writes tier 2: `tier0.ts` deliberately leaves `Occupied`, `Count` and
`Visited` alone, and takes only the liveness half of `Together`. That is not an oversight,
it is the tier boundary.
