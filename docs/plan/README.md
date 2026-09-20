# Skiron — implementation plan

Written 2026-09-19. Nothing is built yet: the repository holds this plan, a README, a
CLAUDE.md and a .gitignore.

## How to use this plan

You are implementing Skiron from an empty folder. This file is the design. Each
`wave-N-*.md` beside it is one unit of work with its own exit criteria.

- Read this file in full before any wave, and read `../../CLAUDE.md`.
- Work one wave at a time, in order. A wave is done when its exit criteria hold,
  `npm test` and `npm run check` are clean, and you have updated the status table at the
  bottom of this file and the "State of the project" section of `CLAUDE.md`.
- Commit to local git at sensible points. **Ask the owner before anything outward-facing:**
  creating the GitHub repository, the first Cloudflare Pages deploy, adding Skiron to the
  portfolio catalog, and any paid batch of API calls (waves 5 and 7 — tell them the
  estimated number of calls first).
- The decisions under "Locked by the owner" are not yours to change; if one proves wrong,
  stop and ask. Everything else is yours to adjust. When the code teaches you that the plan
  is wrong, fix the plan file in the same commit and say why.
- Numbers marked *starting point* are guesses. Replace them with measurements from the sim
  harness built in wave 3.

## What Skiron is

A murder-mystery deduction game with an endless supply of cases. Each case is a floor
plan, a handful of suspects, an evening divided into time slots, and a body. The player
gathers evidence cards by examining rooms and questioning suspects, works out who was where
and when in a notebook grid, and accuses a culprit and a time of death.

The design rests on one split:

- **The engine owns the truth.** It builds the floor plan, simulates the evening, chooses
  the clues, proves the case has exactly one answer, grades the case by the reasoning it
  requires, and explains each deduction as a hint. It needs no LLM. The whole game is
  playable with engine-written template sentences.
- **The LLM owns the telling.** It names the place and the people, gives them motives and
  voices, writes each clue as a witness statement, plays the suspects under questioning,
  writes the detective's summing-up and prompts the portraits. It never decides a fact, and
  no sentence it writes reaches the player until the engine has checked that it says
  exactly what the clue says.

The name: Skiron is the north-west wind on the Tower of the Winds (the owner names LLM
projects after winds: Boreas, Notus, Eurus, Zephyr). Sciron is also the bandit who murdered
travellers on the Megarian cliffs until Theseus caught him.

## Sibling projects to read first

All are in the parent folder. Match their conventions; do not copy code blindly.

| Project | Read it for |
| --- | --- |
| `../newsignpost` | **Closest relative.** Engine layout, tiered deduction solver, the "solver completing certifies uniqueness" argument, explained hints, the one-bit Check, worker-based generation, CLAUDE.md style. Read its `docs/ARCHITECTURE.md`. |
| `../newloopy` | Same architecture on a harder puzzle; second opinion on solver and generator structure. |
| `../NewX` (Ascendant) | The "LLM authors, engine verifies" principle, Gemini client, in-app key entry, `.env.local.example`. |
| `../Zephyr` | Gemini image generation in the browser and its off/fast/balanced/beautiful quality setting. |
| `../catalog-art` | Node-side Gemini image calls, the key-handling discipline, `sharp` WebP conversion on this machine. |

## Decisions

### Locked by the owner

| Decision | Note |
| --- | --- |
| Name and folder: **Skiron** | |
| Format: **alibi timeline on a map** | Who was in which room in which slot, with movement rules and sightings. Not a classic logic grid. |
| Stack: **SvelteKit + Svelte 5 + TypeScript**, static PWA | Same as Loopy and Signpost. No Tauri at first; keep browser-only APIs behind small modules so a desktop shell can be added later. |
| **The culprit lies** is core | It shapes the solver, so it is designed in from wave 1. |
| **Free-text interrogation** is core | Wave 6. |
| **Generated portraits and scene art** is core | Wave 7. |
| Daily seeded case is **not** core | Optional, wave 9. |

### Defaults chosen by the planner (change with a reason)

| Decision | Why |
| --- | --- |
| No backend. API key is entered in the app, kept in the browser, sent only to the provider. | Portfolio rule. |
| Playable without a key: a starter pack of pre-authored cases ships with the site, and template text is always available. | Portfolio rule (Ascendant's demo world, Notus `--offline`). |
| Gemini via `@google/genai`, behind a narrow provider interface. | Portfolio default. Notus shows other providers can be added later. |
| Model ids live in one constants file. Ascendant pins `gemini-3.7-flash` for text and `gemini-3.1-flash-image` / `gemini-3-pro-image` for images — verify these are still current when you reach wave 5. | Ids go stale. |
| The floor plan is drawn by the engine as SVG, never by an image model. | It must be exact. |
| DOM and SVG for the UI, no canvas. | A case has tens of elements, not thousands. |
| English first. The skin carries a `language` field so other languages can follow. | The owner has Hungarian-language projects; see wave 9. |
| Accusation = culprit + time slot. The room is known from the body. | Makes the timeline work matter. |

## The rules the player is told

These are the axioms. The solvers may use exactly these and nothing else, and the
how-to-play screen must state all of them.

1. The evening is divided into slots. In each slot every person is in exactly one room.
2. Between one slot and the next, a person stays put or passes through one open door.
   Case-file rules may close a door for part of the evening, bar a person from a door or a
   room, or cap how many people fit in a room.
3. People in the same room in the same slot see each other. Nobody sees into another room.
4. The victim was killed in the room where the body was found, in a single slot, alone
   with the killer.
5. From the murder until the body was found at the end of the evening, nobody except the
   killer was in that room. The killer may stay or leave. The body does not move.
6. Facts — physical evidence and case-file rules — are always true.
7. Innocent people always tell the truth, but they do not tell everything: **silence proves
   nothing.** In a case marked "the culprit lies", the killer's statements may be false. In
   other cases the killer also tells the truth and merely leaves things out.
8. An accusation names the killer and the slot.

## Formal model

- People `P` = suspects `S` (4–6) plus the victim `V`. Slots `t = 0..T-1` (5–8). Rooms `R`
  (5–9). Doors are edges of a graph on `R`; a door may be closed for some transitions
  `t → t+1`, and a person may be barred from a door or room.
- A **world** is `loc[p][t] ∈ R` for every person and slot, plus a culprit `c ∈ S` and a
  murder slot `t*`. The murder room is `r* = loc[V][t*]` and is given to the player.
- A world is **legal** when it obeys rules 1–5: movement along open doors; `loc[c][t*] =
  r*` and no third person in `r*` at `t*`; `loc[V][t] = r*` for `t ≥ t*`; no innocent in
  `r*` at any `t ≥ t*`.
- A **clue** is a formula over the world with a **source**: `fact` (always true) or
  `testimony(s)`. With lying on, a testimony by `s` asserts `s ≠ c ⇒ φ`. With lying off it
  asserts `φ`.
- The **answer set** of a clue set is every `(c, t*)` for which some legal world satisfies
  all the clues. A case is **fair** when the answer set is exactly the true answer.
  Uniqueness is of the answer, not of the whole grid — demanding a unique grid would need
  far more clues and make cases tedious.
- **Monotonicity, which several things rely on:** every clue the engine ever issues is true
  in the true world (a culprit's lie is vacuously true there, because `s = c`). So adding
  any issued clue to a fair set keeps it fair, and a deduction made from some of the cards
  stays valid when more arrive.

## Clue language

A small closed set. Each clue type is one module providing: an evaluator
`holds(clue, world)`, propagators for both solvers, topic keys (which questions release
it), a canonical form with a normaliser (for equality tests), a template sentence, and
the domain of each payload field, from which wave 5 derives both the JSON schema
fragment for the LLM parse-back and the reader that turns the model's answer back into
a clue. *Changed in wave 5: this said "a JSON schema fragment". Writing seventeen
fragments by hand means seventeen chances for the schema, the frame's real bounds and
`valid` to drift apart silently — inside the one check whose job is to notice that two
things disagree. Declaring the domains instead makes the fragment and the parser two
views of one declaration, and a new clue kind cannot compile without it.* Start with the core set and add the extension
set once wave 3's harness can measure what each type does to case quality.

| Core type | Meaning |
| --- | --- |
| `At(p,t,r)` / `NotAt(p,t,r)` | Person was / was not in the room in that slot |
| `Stayed(p,r,t1,t2)` | In the room for the whole span |
| `Saw(p,q,t,r)` | Speaker `p` was in `r` at `t` and so was `q` |
| `Together(p,q,t)` | Same room, room not stated |
| `AloneIn(p,t,r)` | In `r` at `t` with nobody else there |
| `Occupied(r,t)` / `Empty(r,t)` / `Count(r,t,k)` | Somebody / nobody / exactly `k` people were in the room |
| `Visited(p,r)` / `NeverVisited(p,r)` | At some point / never during the evening |
| `AliveAt(t)` / `DeathWindow(a,b)` | The victim was alive at `t` / died within the span |
| `DoorClosed(e,t1,t2)`, `Barred(p,e or r)`, `Capacity(r,k)` | Case-file rules |

Extension set, later: `Moved(p,t)`, `DoorUsed(e,t)`, `Heard(...)`, ordering clues ("`p`
was in `r` before `q` was").

Case-file rules are where the fiction carries weight: the engine picks "door 4 is closed
from slot 3 to slot 5" and the LLM supplies why (the causeway floods at high tide; the
butler locks the wine cellar at ten). The player has to combine the rule with other cards,
which is what makes it feel like detection.

## Two solvers

They are independent implementations on purpose: each guards the other.

**Exhaustive solver** (`engine/solver/exhaustive.ts`). For a clue set it returns the answer
set, by checking satisfiability of each candidate `(c, t*)` with a small constraint search
(bitmask domains, propagation, backtracking). It also answers `cellPossible(p,t,r)`. It
knows nothing about tiers or explanations. It is the oracle for tests and the final
assertion in the generator.

**Deduction solver** (`engine/solver/`). It reasons the way a person does and records
every step. State: candidate rooms per person per slot, candidate culprits, candidate
murder slots, and which testimonies are *trusted*. With lying on, a suspect's testimony
becomes trusted only when that suspect is cleared. Rules run lowest tier first; the
highest tier used is the case's grade.

| Tier | Name | Rules |
| --- | --- | --- |
| 0 | Placement | Apply trusted direct clues; basic opportunity (the culprit is in `r*` at `t*`; a suspect who cannot be there in any remaining slot is cleared; rule 5 prunes slots and rooms) |
| 1 | Movement | Reachability along the timeline through open doors, in both directions, with closures, bars and the victim's coupling to `t*` |
| 2 | Counting | `Occupied` with one candidate left; `Count` and `Capacity`; `Visited` with one slot left; `Together` equalities |
| 3 | Trust | Lying only. Clearing a suspect releases their testimony. Self-incrimination: if a suspect's statements cannot all be true given the facts, they are the culprit. Conflict pair: if two suspects' statements cannot both be true, the culprit is one of them and everyone else is cleared |
| 4 | Hypothesis | Bounded trial: assume a culprit (which trusts everyone else) or a slot, propagate with tiers 0–3, and eliminate on contradiction. Depth 1, fixed `TRIAL_BUDGET` |

Difficulty names map to tiers — Easy ≤ 1, Normal ≤ 2, Hard = 3, Expert = 4; Hard and
Expert have lying on. As in Signpost, the *actual* tier is authoritative and is what the UI
shows; asking for Expert may legitimately return a Hard case.

Every step is a record `{rule, premises: clue ids and cells, conclusion}`. `explain.ts`
turns a step into a sentence; the same module turns any clue into its template sentence,
which is the text used whenever no LLM prose is available.

**Why a finished deduction run certifies fairness:** every rule removes only candidates
that appear in no legal world consistent with the clues. So if the run ends with one
culprit and one slot, no other answer exists. This is the same argument Signpost makes,
and it holds only while every rule is sound — hence the oracle tests.

## Generator

1. **Map.** A rectangular dissection of a house footprint gives rooms as rectangles;
   doors go on shared walls, a spanning tree first and then a few extra for cycles;
   optionally one outdoor room on the perimeter. This yields the graph and an exact SVG
   floor plan from the same data.
2. **Truth.** Pick culprit, slot and room; simulate biased random walks that obey the
   rules, make people cross paths often enough for sightings to exist, and leave the murder
   unwitnessed.
3. **Enumerate** every true clue of every type, with its source and topic keys.
4. **Lies** (when on). Build the culprit a false alibi around `t*`: individually plausible
   under the movement rules, not refuted by any single card, optionally including a false
   sighting that frames an innocent.
5. **Select.** Start from everything, then remove clues in random order while the
   tier-capped deduction solver still finishes. Reject and retry if the actual tier misses
   the request by more than the preset allows.
6. **Assert.** Run the exhaustive solver on the final set. A failure here is a soundness
   bug: throw in development, discard the case and count it in production.
7. **Bank.** For every suspect and topic, fix what they would say: an essential clue, a
   redundant true clue, or nothing. Give innocents gaps too, so that evasiveness does not
   mark the culprit. By monotonicity the full bank is still fair — test that.
8. **Investigation.** Assign each essential clue to an action: room examination for
   physical facts, a question to a suspect for testimony. Compute par from the essential
   action count.

Everything is seeded (xoshiro128**, as in Signpost). No `Math.random`, no `Date`, no DOM in
the engine: it must run in Node for tests and the authoring CLI, and in a Web Worker in the
app. Same case ID ⇒ byte-identical case. The ID shares the puzzle, not the LLM prose.

## Investigation layer

- **Given at the start:** floor plan, case-file rules, body room, death window, cast.
- **Actions:** examine a room; ask a suspect about a slot, a person or a room. Each action
  may release evidence cards into the notebook. No hard limit and no fail state: the rating
  compares actions used with par, and hints and wrong accusations are recorded.
- The intended loop is deduce → aim the next question. "Somebody was in the library at
  nine" tells you what to ask about.
- **Hints** run the deduction solver on the *collected* cards from the player's notebook
  state. Order: first say so if the notebook has ruled out something true; else explain the
  lowest-tier next deduction the notebook lacks; else, when the collected cards are
  exhausted, point at the topic that releases the next essential card.
- **Check** is one bit, as in Signpost: is everything in the notebook consistent with what
  happened? Never which cell.
- **Accusation** is compared directly with the stored truth, never through a solver.

## The LLM contract

**Authoring a case skin** (wave 5). Two calls, both returning schema-constrained JSON:

- *Call A — the writer, who does not know who did it.* Input: the player's setting prompt,
  the floor plan with adjacency and layout positions, cast size, case-file rules in
  canonical form, and the whole statement bank in canonical form with lies unlabelled.
  Output: title, place, era, art style guide, room names and three-letter codes, people
  (name, role, bio, voice, a motive for every suspect, portrait prompt), the fiction behind
  each case-file rule, prose for every clue in the speaker's voice, "nothing to say" lines,
  the briefing, a scene prompt. Keeping the culprit from the writer stops guilt leaking
  through tone.
- *Call B — the summing-up.* Input: the truth, the true motive slot and the canonical proof
  trace as template sentences. Output: the detective's closing speech. Shown only after the
  case is solved.

**Fidelity check.** A separate call with a fresh context receives the glossary, the clue
schema and the prose clues (shuffled, opaque ids) — not the formal clues — and parses each
back into a formal clue, also listing any extra claim about who was where when. The engine
compares canonical forms. A mismatch or an extra claim regenerates that clue's prose, up to
a small retry limit, and then falls back to the template sentence. The notebook always
shows the canonical form beside the prose. **Only the card is canon.**

**Interrogation** (wave 6). Free text is a layer over the structured topic picker, which
works without a key. A runtime model call never receives the truth, the culprit or any
card the player has not earned:

- *Classify:* the question, the glossary and the list of available topic keys (not their
  contents) → one topic key, or `motive`, `smalltalk`, `too_broad`, `accusation`.
- The engine looks the topic up in the bank and releases the card, if any.
- *Voice:* persona, bio, the last few turns and the verified prose of the card being
  released → a short reply that contains that prose verbatim. The engine checks the
  verbatim inclusion and rejects any room name or time label outside it, falling back to
  the bare verified sentence.

Because the model only ever sees what the player is about to see, a player cannot talk it
into a spoiler.

**Art** (wave 7). Portraits for each person and one scene image, from the writer's prompts
plus the case's style guide, with a quality setting as in Zephyr and deterministic SVG
monogram avatars as the fallback.

## Layout

```
src/lib/
  engine/            PURE TS — no DOM, runs in Node and in a worker
    rng.ts  types.ts  axioms.ts  caseId.ts
    map/             dissection, doors, graph, SVG geometry data
    world/           truth simulation
    clues/           one module per clue type + registry
    solver/          exhaustive.ts; state.ts, rules/, solve.ts, difficulty.ts,
                     explain.ts, hint.ts
    generator/       enumerate, lies, select, bank, investigation, generate
  worker/            genWorker.ts + genClient.ts (promise API, cancel = terminate)
  llm/               provider.ts (interface), gemini.ts, models.ts, skin/ (schema,
                     prompts, fidelity), interrogate/, art/
  game/              controller.ts (all stores and actions), notebook logic,
                     persistence, stats, types
  ui/                Svelte components
routes/              the app shell
static/cases/        shipped case packs (JSON + WebP)
tools/               author-case.mjs, sim.mjs
scripts/             patch-workerd.cjs, gen-icons.mjs
docs/                ARCHITECTURE.md (write it as the engine lands), plan/
```

## Critical invariants

1. **The engine owns every fact.** The LLM cannot add, remove or alter a clue. Only
   evidence cards are canon; prose is decoration.
2. **Every case is fair, certified twice:** the tier-capped deduction solver finishes, and
   the exhaustive solver returns exactly the true answer.
3. **Deduction rules are sound.** Only forced eliminations. Guarded by oracle tests against
   the exhaustive solver; a new rule joins that guard.
4. **Determinism.** Same case ID ⇒ byte-identical case. Changing the RNG, iteration order
   or any generator step breaks shared IDs and shipped packs' regeneration; bump the ID
   version if you must.
5. **The accusation check, the Check button and win detection never go through a solver.**
   They compare with the stored truth.
6. **No LLM prose reaches the player unverified.** Parse-back equality or the template.
   The template renderer covers every clue type, and a test proves it.
7. **Innocents never lie.** Testimony is `s ≠ c ⇒ φ` with lying on. The full statement
   bank must leave the case fair.
8. **Runtime model calls never receive the truth, the culprit or unearned cards.**
9. **The key never enters a file, a URL or a log.** Browser storage and request headers
   only; the CLI reads it at call time as catalog-art does.
10. **`TRIAL_BUDGET` is part of the grade.** Changing it changes which cases count as
    Expert.

## Testing strategy

- Engine tests sit next to the code (`*.test.ts`), run in Node, no DOM. UI is untested, as
  in the siblings; settle UI questions by driving the dev app headlessly (see the CDP notes
  in `../newsignpost/CLAUDE.md`).
- The oracle suite owns soundness: hundreds of random worlds and clue subsets, lying on and
  off, and no candidate the deduction solver removes may be `cellPossible`.
- Generator tests own fairness, determinism, bank fairness, reachability of every essential
  card, and "innocents' statements are all true, the culprit's include a lie".
- `npm run sim` generates hundreds of cases per preset and prints a table: attempts,
  time p50/p95, actual-tier spread, essential clue count, bank size, par, and final
  assertion failures (must be zero). Tune presets from this table, not by feel.
- LLM code is tested with recorded responses. Live calls live in a separate Vitest config
  gated on a key, never in `npm test`.

## Waves

| Wave | File | Outcome | Status |
| --- | --- | --- | --- |
| 0 | `wave-0-scaffold.md` | Toolchain works on this machine | **done** 2026-09-19 |
| 1 | `wave-1-model-and-oracle.md` | Case model, truth simulation, exhaustive solver | **done** 2026-09-19 |
| 2 | `wave-2-deduction-solver.md` | Tiered solver, grading, explanations, hints | **done** 2026-09-19 |
| 3 | `wave-3-generator.md` | Fair cases on demand, sim harness | **done** 2026-09-20 |
| 4 | `wave-4-playable.md` | The whole game with template text, offline | **done** 2026-09-20 (deploy deferred to wave 8 by the owner) |
| 5 | `wave-5-llm-authoring.md` | Skins, fidelity check, authoring CLI, in-app generation | **done** 2026-09-20 — fallback rate 0% over 23 cases and 888 cards; three-case starter pack shipped |
| 6 | `wave-6-interrogation.md` | Free-text questioning | **done** 2026-09-20 — 182/182 questions routed as written, 162/162 replies survived the guard, p50 2.6s; three fixes came out of the first live run |
| 7 | `wave-7-art.md` | Portraits, scene art, starter pack | not started |
| 8 | `wave-8-ship.md` | Tutorial, polish, docs, repo, deploy, catalog | not started |
| 9 | `wave-9-beyond.md` | Optional: daily case, confrontation, Hungarian, Tauri | not planned in detail |

## Risks

- **Clue fidelity** is the main technical risk. The parse-back check and the template
  fallback bound it; measure the fallback rate in wave 5 and treat a high rate as a prompt
  problem. *Measured in wave 5: **0% over 23 cases and 888 cards**, after two fixes.
  The first measurement said 1.64% and was measuring the wrong thing — every failure was
  a `Count k=0` clue, rejected because the checker had been told to prefer `Empty` at
  zero. The check is known to be able to reject: it rejected those twelve, and the
  near-miss tests still require it to. See ARCHITECTURE.md section 11.*
- **Fun.** Murdle owns the daily logic-mystery. Skiron's case is endless, graded, provably
  fair cases with hints that teach. If wave 4 is not enjoyable with template text alone,
  fix the puzzle before adding the LLM. *Wave 4's verdict is in CLAUDE.md under "How it
  plays": the puzzle stands up, and what drags is the prose — which is wave 5.*
- **Lying cases may be thin.** If facts alone rarely clear anyone, Hard cases collapse into
  Expert. The sim table will show it; the lever is the mix of physical evidence.
- **Question grinding.** A player can ask everything. Par is the counterweight; watch
  whether it is enough. *Wave 4 measured it: between two fifths and two thirds of
  questions asked turn something up, and par is now anchored on what an undirected
  player actually spends rather than on the shortest route. The grind is real at Expert
  — 146 questions on the menu — and the lever if it needs one is the cast list, not the
  scoring.*
- **Generation time** in the browser, mainly the select loop. Keep the exhaustive solver
  out of the loop and measure.

## Glossary

**Case** — one puzzle: map, cast, truth, clue bank, investigation. **Skin** — the LLM's
names, prose and prompts for a case. **Card** — a clue the player has collected. **Bank**
— everything each suspect would say on each topic. **Essential** — a clue the selected
minimal set needs. **Cleared** — a suspect proven innocent, whose testimony is then
trusted. **Answer** — culprit plus murder slot. **Fair** — exactly one answer. **Par** —
the expected number of actions.
