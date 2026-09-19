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
