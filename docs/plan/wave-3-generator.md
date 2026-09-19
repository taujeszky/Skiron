# Wave 3 — Generator and sim harness

**Goal.** `generate(caseId)` returns a complete, fair, graded case with a statement bank
and an investigation layout, deterministically, fast enough for a browser worker — and a
harness that measures it.

**Prerequisites.** Waves 1–2. Read "Generator" and "Investigation layer" in `README.md`,
and Signpost's generator notes on retry rates and measuring before choosing presets.

**Size.** Large.

## Tasks

1. **`generator/enumerate.ts`.** From a truth, list every true clue of every core type
   with source and topic keys. Testimony comes from what a suspect could know: their own
   whereabouts and whoever shared a room with them (rule 3). Physical facts come from the
   rooms. Case-file rules are chosen here too: closures, bars and capacities that the truth
   already respects, so they are true by construction.
2. **`generator/lies.ts`.** With lying on, replace the culprit's statements around `t*`
   with a false alibi. Requirements: consistent with the movement rules and with the
   culprit's own other statements; not refuted by any single card; refutable in
   combination. Optionally one false sighting that frames an innocent (Expert only, as a
   *starting point*).
3. **`generator/select.ts`.** Start from every clue, shuffle, and drop each clue if the
   tier-capped deduction solver still finishes without it. Then check the actual tier
   against the request and retry with the next attempt number if it misses by more than
   the preset allows. Do **not** put the exhaustive solver inside this loop.
4. **Final assertion.** Exhaustive `answers` on the selected set must be exactly the
   truth. On failure: throw in development; in production discard, count and retry.
5. **`generator/bank.ts`.** For every suspect × topic fix the reply: an essential clue, a
   redundant true clue, or nothing. Spread gaps across innocents so that silence around
   the murder does not single out the culprit when lying is off. The culprit's bank holds
   their lies when lying is on.
6. **`generator/investigation.ts`.** Map each essential clue to an action (examine room /
   ask suspect about slot, person or room), guarantee each is reachable, and compute par
   (*starting point*: essential actions × 1.5, rounded up). Also record the canonical proof
   trace — the deduction solver's steps on the essential set — for the summing-up in
   wave 5.
7. **`generator/generate.ts`.** The attempt loop and presets. RNG seeded from
   `version:preset:seed:attempt`.
8. **`worker/genWorker.ts` + `genClient.ts`.** Promise API; cancel terminates the worker.
9. **`tools/sim.mjs`** and `npm run sim`. Generate N cases per preset (default 300) and
   print a table: success rate per attempt, time p50/p95, actual-tier spread, essential
   clue count, clue-type mix, bank size, par, simulation retries, final-assertion failures.
10. **Tune from the table.** Fix preset sizes, walk parameters, clue-type weights and the
    retry cap. If Hard collapses into Expert (facts alone rarely clear anyone), raise the
    share of physical evidence. If a clue type is never essential, find out why before
    keeping it. Then decide whether the extension clue types earn their place.
11. **ARCHITECTURE.md:** the generator pipeline and the measured table.

## Tests

- Determinism: same ID ⇒ deep-equal case, in Node and (smoke) in the worker.
- Fairness: every preset, a handful of seeds, exhaustive answer set is exactly the truth.
- Bank fairness: the full bank leaves the answer set unchanged (invariant 7).
- Honesty: innocents' statements all hold in the truth; with lying on the culprit has at
  least one false statement; with lying off, none.
- Reachability: every essential card is released by some action.
- No essential card is released at the start unless it is a case-file rule.

## Exit criteria

- Sim table recorded in ARCHITECTURE.md with zero final-assertion failures.
- Worst-case generation time measured and acceptable for a worker (*starting point*: p95
  under five seconds on this machine; say so plainly if it is not).

---

## What wave 2 hands you (written 2026-09-19, before wave 3 starts)

The tasks above were written before the solver existed, so they name things like "the
tier-capped deduction solver" without saying what to call. This is what is actually there.

### The calls you need

```ts
import { solve, MAX_TIER, TRIAL_BUDGET } from "$lib/engine/solver/solve";
import { answers, answerPossible, cellPossible } from "$lib/engine/solver/exhaustive";
import { PRESETS, acceptsTier, difficultyForTier } from "$lib/engine/solver/difficulty";
import { explainer, clueSentence } from "$lib/engine/solver/explain";
import { clueTopicKeys } from "$lib/engine/clues";
```

`solve(frame, clues, { maxTier?, trialBudget?, record? })` returns `tier`, `finished`,
`answer`, `remaining`, `steps`, `state`, and — read these two — `budgetSpent` and
`trialNodes`.

### Five things that will bite if you do not know them

1. **The grade is the cheapest cap at which the case finishes**, not "the highest tier
   that fired". So the selection loop should solve capped at `preset.tier.max` and then
   test `acceptsTier(preset, result.tier)`; there is no need to re-solve to find the
   grade, and a case that comes back below `tier.min` is a real miss, not an artefact.
2. **`budgetSpent` distinguishes "not proved" from "not provable".** An unfinished case is
   rejected either way, but if the sim table shows cases failing with `budgetSpent` true,
   the answer is *not* to raise `TRIAL_BUDGET` — it is part of the grade (invariant 10)
   and raising it changes which cases exist. It is a signal that the preset is too big.
3. **Task 3 says do not put the exhaustive solver in the selection loop, and it means it.**
   `answers()` is the wave-1 oracle and it is a search: fine once per case for task 4's
   final assertion, ruinous inside a loop that drops one clue at a time.
4. **`hint.ts#firstTopic` already encodes an action rule**: a physical fact is released by
   examining its *room*, never by asking about a person, because there is no
   examine-a-person action. Task 6's mapping has to agree with that, or hints will point
   at actions the investigation layer does not offer. The two victim clues (`AliveAt`,
   `DeathWindow`) name no room and fall back to the murder room.
5. **Every number in `difficulty.ts` is a starting point**, including the two-tier accept
   bands, and task 10 is where they get replaced. Do not tune them by feel; the sim table
   is the whole point of this wave.

### What the sim table should carry, beyond task 9's list

- the spread of `result.tier` per preset, against what the preset asked for;
- how many rejections were `budgetSpent` rather than genuinely unsolvable;
- `trialNodes` p50/p95, so the budget can be judged rather than guessed at.

Timing to size the loop against: a single `solve` measured 0.5 ms on the Easy shape and
1.5 ms on Expert, worst case 11 ms over 800 cases. The selection loop's cost is therefore
roughly "how many solves do you do", and dropping one clue at a time from a 200-clue set
is 200 of them per pass.

### Still a stub

`tools/sim.mjs` exists and does nothing. `npm run sim` is wired to it.

### Wave 4 will want these, which already exist

`newNotebook`, `apply`, `notebookIsSound` (the Check — one bit, compared with the stored
truth, never through a solver), `hint`, `explainer`, `defaultGlossary`. The `essential`
list that `hint`'s third branch needs is task 6's output.
