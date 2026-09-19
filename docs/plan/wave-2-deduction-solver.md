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
