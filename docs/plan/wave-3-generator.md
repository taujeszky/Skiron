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

---

## As built (2026-09-20)

Done. 415 tests green, `npm run check` 0/0, and `npm run sim` over 480 cases with
zero certificate failures. The measured table and the reasoning behind each decision
are in ARCHITECTURE.md §9; this section records only where the tasks above turned out
to be wrong, as CLAUDE.md requires.

### Task 1 — the case file moved out, and moved earlier

"Case-file rules are chosen here too" cannot be done in `enumerate.ts`, because
`simulateTruth` takes `rules` on its request and walks everybody inside them. They have
to exist before the evening does. They are now drawn in **`generator/caseRules.ts`, from
the floor plan alone**.

That is not merely a plumbing detail. Choosing rules to fit an evening that already
happened makes each one a function of the truth, and a player who knew the generator
could read it backwards — a capacity of two means some room really did hold two.
Drawn blind, a rule leaks nothing. The cost is a new rejection (`opening-solves`): a
rule drawn blind can bar somebody from the murder room and hand over the culprit, so
the generator now refuses any case its opening cards solve.

### Task 1 — the pool needs a ban list, and it is the whole ball game

Not in the task at all, and it decides whether the game exists. Rule 5 means any true
clue placing a living suspect in `r*` from `t*` on *names the killer*. Left in, the
selection loop minimises to two or three cards: measured over twelve seeds a preset,
9 of 12 Easy and 5 of 12 Expert cases graded tier 0 off a single card.
`givesAwayAnswer` bans them. The same argument bans the *vantage point*, so nobody may
testify to what they could only have seen from the killer's position — which is why
task 5's gap-spreading is not optional.

### Task 3 — "start from every clue" is unaffordable, and one-sided

Two corrections.

**It is a sample.** The pool is 516 clues on Easy and about 1,800 on Expert once every
entitled speaker is counted — not the ~200 the task assumes — and a full pass costs
about a second per Expert attempt. `select.ts` draws a weighted sample, grows it if it
fails to prove the case, and only then does the greedy drop. Same shipped set, a fifth
of the time. The per-kind weights in that draw are also where task 10's clue-type mix
actually gets tuned.

**The retry is one-sided.** The task says "retry if the actual tier misses the request
by more than the preset allows", implying it can miss either way. It cannot miss
upward: the loop solves at `preset.tier.max`, so a drop that would push the case past
the cap simply fails to finish and is refused. The only miss is downward.

Also not in the task: **the opening is never dropped**. The case-file rules and the
briefing's death window are held by the player whatever the loop decides, so a case
graded without them would ship easier than it grades. Pinning them costs nothing,
because the frame already carries the rules.

### Task 4 — "throw in development" breaks invariant 4

The task says to throw in development and discard in production. That makes the case a
given id rebuilds depend on the build mode, and it hides a soundness bug behind a
retry. As built, every rejection has a named reason and is always counted and retried;
`onAssertionFailure` lets the tests and `npm run sim` turn the two that mean *bug* into
a throw. `answers()` throwing on its node limit is counted separately from `answers()`
returning the wrong set — the first is a clue set too hard to certify, the second is
the thing this assertion exists to catch.

### Task 5 — a topic maps to a list, and the bank does not protect the grade

"For every suspect × topic fix the reply" cannot be made to work: a clue carries
several topic keys, and two of a speaker's statements can share one, so the loser of
that collision would be unreachable at exactly the topic a hint names. A statement is
registered under **all** of its keys and asking releases everything filed there.

"Spread gaps across innocents" is not testable as written. It is now a property:
**on every topic touching the murder, at least two suspects are silent**, so a player
counting who has nothing to say learns nothing. A generator that gave only the culprit
gaps fails that test.

And the big one, which the task's "by monotonicity the full bank is still fair" hides:
bank fairness protects the **answer**, not the **grade**. A bank that released every
fact filed under a room made 16 of 16 cases solvable at tier 0 by searching rooms and
never asking a question. `playTier` — the grade of everything the bank can release — is
therefore a **rejection criterion**, and the label the player is shown comes from it.

### Task 6 — the action mapping already existed

"Map each essential clue to an action" reads as though the mapping were free. It is
not: `hint.ts#firstTopic` already decides it, and branch 3 of a hint says that topic
out loud. A second copy would drift and the symptom would be a hint naming an action
that releases nothing. `firstTopic` is now **exported** and imported by
`investigation.ts`, which only reports it.

The proof trace is stored as `Step[]` and never as rendered sentences, so wave 5 can
render it with the skin's glossary rather than with "Suspect A" and "Room 3". It is
also sliced back from the cuts into the answer set: a grading solve keeps filling in
the grid after the answer is unique, and a detective does not recite every room they
crossed off.

### Tests — one of them was false as written

"No essential card is released at the start unless it is a case-file rule" stopped
being true when the briefing's death window became an issued clue. The README says the
death window is given at the start, and withholding a constraint the fiction states
out loud would be worse than widening the test. The test now reads: no essential card
is in the opening, and the opening holds only rule kinds plus exactly one death
window (`enumerate.ts#isOpening`).

### Task 2 — what "refuted" means, and what the framing actually does

A lie is **inert in the main run**: with lying on no testimony is active at depth 0, so
a lie narrows no cell and only bites when tier 3 supposes its teller innocent. So
"not refuted by any single card" has no meaning until "refuted" is defined. As built it
is defined by solving with `lying` turned off — which is exactly what tier 3's branch
does to the suspect it supposes innocent — and the two conditions are: the story must
not contradict on its own, and it must fall to the facts.

Two things the task gets wrong about consequences. **Replacement is load-bearing**: the
culprit's own true statements that the story falsifies must be *deleted*, not merely
joined, or their two cards refute each other and tier 3 wins for free. And the false
sighting does not "frame an innocent" in any sense a solver can be misled by —
refuting an innocent's innocence is impossible while the rules are sound. It is a
player-facing red herring whose only mechanical effect is to give conflict-pair
something to bite on.

A lie is also, contrary to a plausible reading, able to pin the murder slot: tier 3's
conclusion clears suspects, and closing suspects closes every hour no surviving pair
still uses. It is the *grid* a lie leaves alone.

### Task 10 — what the table changed

The first run had **Expert collapsed into Hard** — 69 of 80 Expert cases at tier 3
against Hard's 80 of 80 — which is the risk the plan's own list predicted, in reverse.
Two rounds of tuning on the clue-type mix fixed it (ARCHITECTURE.md §9 has both and the
numbers). Expert now splits 56/64 between tiers 3 and 4.

No clue type is never essential, so none has to be dropped; `AliveAt` is thinnest at
1–3% and is the one to watch. `Hard` never uses the bottom of its band — all 120 cases
graded tier 3 — so its floor of 2 is currently decorative. The extension clue types
(`Moved`, `DoorUsed`, `Heard`, ordering) were **not** added: the existing seventeen
already produce a real difficulty gradient in the *kind* of reasoning, and nothing in
the table asks for more.

### Left for later, deliberately

- **Par is still the plan's guess** of essential actions × 1.5. Fitting it means
  driving `hint.ts` with a scripted player, and `hint.ts` solves with no tier cap, so
  that player reasons at tier 4 even on Easy. It wants a `maxTier` on `HintInput` and
  belongs with wave 4, where there is a real player loop to compare against.
- **`simulate.ts#backwardMasks` was not exported.** `lies.ts` needs no feasibility
  sweep because a one-slot detour is walkable by construction. If a later wave wants
  longer stories it will need the sweep, and it should move to a shared module rather
  than be copied.
