# Wave 4 — The whole game, with template text

**Goal.** A complete, offline, installable game using engine-written sentences only. No
LLM code in this wave. If the game is not enjoyable at the end of it, stop and say so: the
puzzle has to stand on its own before the fiction is added.

**Prerequisites.** Waves 1–3. Read "Investigation layer" in `README.md`, and Signpost's
`game/controller.ts` for the store pattern and its README for the bar on hints, Check and
error highlighting.

**Size.** Large. Split into 4a (tasks 1–6: play a case to the end) and 4b (the rest) if
one session is not enough.

## Tasks

1. **`game/controller.ts`.** All stores and actions in one spine, as in Signpost: current
   case, collected cards, notebook, action count, accusations, hint and check panels,
   settings, stats. Components use Svelte 5 runes; shared state uses `svelte/store`.
2. **Screens.** Home (continue, new case by difficulty, enter a case ID, settings), case
   briefing, investigation, accusation, summing-up, stats, how-to-play. The how-to-play
   screen states all eight rules from the README.
3. **Investigation screen.** Three panes on a desktop, tabs on a phone:
   - **Map.** The SVG floor plan from the engine's geometry; a slot scrubber; solid tokens
     for people the notebook has placed in that slot, ghost tokens for candidates; closed
     doors shown for the scrubbed slot; click a room to examine it.
   - **Notebook.** A person × slot grid whose cells hold room candidates as pencil marks
     (three-letter code plus colour — never colour alone). Eliminate, set, undo/redo.
     Separate marks for cleared/suspected people and for candidate murder slots.
   - **Evidence.** Collected cards, filterable by person, slot and room. Each shows its
     sentence and its canonical form; selecting one highlights the cells and rooms it
     concerns. The cast list opens the structured interrogation: ask a suspect about a
     slot, a person or a room.
4. **Auto-notes** setting: on collecting a card, apply its direct (tier 0) consequences to
   the notebook. Default on; the counterpart of Signpost's auto-link.
5. **Errors.** Flag only states that cannot be completed: an empty cell, a movement
   violation between two set cells, every suspect cleared, every slot eliminated. One
   sentence each in the status bar. Write the "play a whole correct solve in scrambled
   order and demand silence" test that Signpost has.
6. **Accusation and ending.** Culprit plus slot, compared with the stored truth. A wrong
   accusation is recorded and play continues. On success: rating against par, then the
   summing-up — for now the proof trace as template sentences — and an animated replay of
   the true evening on the map.
7. **Hints (H) and Check (C)** as specified in the README. They share one panel slot.
8. **Persistence.** `localStorage` under `skiron:` for settings, stats and the current
   save. Behind a small module, so a Tauri store can replace it later. Wave 5 adds
   IndexedDB for skins and images.
9. **Stats.** Per difficulty: solved, time, actions against par, hints, wrong
   accusations, streak.
10. **Theme.** Light, dark, auto, following Signpost's `data-theme` approach.
11. **Keyboard play and phone layout.** Touch targets for pencil marks need care.
12. **PWA.** Service worker with offline play *and* offline generation. Read Signpost's
    ARCHITECTURE.md §7 on the worker-chunk trap first, and its CLAUDE.md note on testing
    service workers in headless Chrome (short `--user-data-dir`).

## Tests

- Notebook logic, error rules, rating and persistence round-trips as unit tests.
- Drive the dev app headlessly to play one Easy case from start to accusation using only
  hints; it must end solved.

## Exit criteria

- A full case at each difficulty is playable offline from the installed PWA.
- Ask the owner before the first deploy. If they agree, create the Cloudflare Pages
  project and run `npm run deploy`; the subdomain may get a suffix if `skiron` is taken.
- An honest note in CLAUDE.md on how the game feels and what drags.

---

## What wave 3 hands you (written 2026-09-20, before wave 4 starts)

The tasks above were written before any of the engine existed. This is what is actually
on disk, and the traps that are not guessable from the task list.

### The calls you need

```ts
import { generate } from "$lib/engine/generator/generate";
import type { GeneratedCase } from "$lib/engine/generator/generate";
import { generateInWorker } from "$lib/worker/genClient";      // browser only
import { ask, examine, allCards } from "$lib/engine/generator/bank";
import {
  newNotebook, notebookIsSound, hint, apply, ruleOut, openRooms, marksMade,
} from "$lib/engine/solver/hint";
import { defaultGlossary, explainer, clueSentence } from "$lib/engine/solver/explain";
import { solve } from "$lib/engine/solver/solve";
import { planToSvg, planToAscii } from "$lib/engine/map";
import { formatCaseId, parseCaseId, newCaseId } from "$lib/engine/caseId";
```

`generate(id)` returns `{ case, rejections, simRetries }` — `case` is null only if the
attempt cap ran out, which did not happen once in 480. A `GeneratedCase` carries `frame`,
`world`, `opening`, `essential`, `clues`, `bank`, `investigation`, `tier`, `playTier`,
`difficulty`, `trace`, `alibi`, `answer`, `attempt`.

### Nine things that will bite

1. **Show `difficulty`, not `tier`.** There are two grades. `tier` is the proof set's —
   what the hints and the summing-up describe. `playTier` is the grade of everything the
   bank can release, which is what a player who asks everybody everything actually faces,
   and `difficulty` is derived from it. Showing `tier` would tell a thorough player the
   case was harder than the one they solved. ARCHITECTURE.md §9 has the argument.
2. **A case *is* its id — do not serialise one.** `GeneratedCase` holds `Map`s and `Set`s
   that `JSON.stringify` silently drops, and there is no codec. Persist the case id plus
   the player's own state (collected card ids, the notebook's three bitmask fields, action
   count, accusations) and rebuild the case with `generate`. That is what invariant 4 is
   for, and `golden.test.ts` is what keeps it true. Easy rebuilds in ~12 ms.
3. **The bank is the action layer, and it is already built.** `ask(bank, suspect, topicKey)`
   and `examine(bank, roomId)` return card ids; look them up in `bank.cards`. Topic keys
   come from `types.ts#topic` — `topic.slot(t)`, `topic.person(p)`, `topic.room(r)`,
   `topic.motive`. **Asking a suspect about themselves always returns `[]`** and is not a
   bug: that is the motive question, and `clueTopicKeys` filters a speaker's own person
   topic out deliberately.
4. **`hint()` needs `essential` or it stops early.** Pass `case.essential` as `HintInput.
   essential`; without it branch 3 never fires and the hint says "accuse" while cards are
   still uncollected. It also **solves with no tier cap**, so the hint panel reasons at
   tier 4 on an Easy case. If that reads as too clever, thread a `maxTier` through
   `HintInput` — the plan file for wave 3 lists this as deliberately left.
5. **Accusation and Check never go through a solver** (invariant 5). Compare with
   `case.answer` and `case.world` directly; `notebookIsSound(frame, notebook, world)` is
   the Check and returns one bit. A solver bug must not be able to hand out a win.
6. **Auto-notes (task 4) is three lines.** `solve(frame, cards, { maxTier: 0 })` and then
   `apply(frame, notebook, step.conclusion)` for each step. `apply` already handles all
   four conclusion shapes, including `answer-cut`'s `cleared` and `closed`.
7. **`investigation.actions` is the shortest route, not the menu.** It lists the actions
   the *proof* needs. The player may examine any room and ask anyone anything; most of
   that returns nothing, and returning nothing is a legitimate answer (rule 7: silence
   proves nothing).
8. **Par is still a guess** — essential actions × 1.5 — and wave 4 is the first place it
   can be fitted, because it is the first place a real player loop exists. There is a
   scripted hint-following player in `generator.test.ts` to start from.
9. **The summing-up is `case.trace`**, already sliced back from the cuts into the answer
   set, rendered with `explainer(frame, case.clues, glossary).step(step)`. It is stored as
   `Step[]` and never as sentences, so wave 5 can re-render it with the skin's names.

### What exists, and what does not

Exists: the whole engine, the worker (`generateInWorker` gives a promise and a `cancel`
that terminates), `planToSvg` for the map, `defaultGlossary` for "Suspect A" / "Room 3"
/ "slot 4" names and three-letter room codes, `openRooms`/`marksMade` for the grid.

Does not exist: anything under `game/` or `ui/`, any route beyond the wave-0 shell
(`+layout.svelte`, `+layout.ts`, `+page.svelte`), and any service worker.

### Timing to design the spinner against

Generation p50/p95: Easy 12/43 ms, Normal 33/64, Hard 122/222, Expert 279/818, worst
observed 1.0 s. So Easy and Normal can generate inline on a click; Hard and Expert want
the worker and a progress state. `generateInWorker` starts one worker per request and
terminates it on settle or cancel, which is what makes cancel mean anything — generation
is one synchronous burn with nothing to await.

### The thing wave 4 should be most careful about

Waves 1, 2 and 3 were each reviewed adversarially, and all three found the same shape of
defect: **a property that was already asserted, where the assertion was the broken part.**
Wave 2 shipped hints that were all true and led nowhere. Wave 3 shipped a bank whose every
card was true and fair, and whose *shape* named the killer — and the silence property even
had a correct test, over sixteen cases, against an event that happened 1.3% of the time.

The UI is untested by convention here, which makes this worse rather than better. The
counterweight the plan already names is the headless play-through in the Tests section:
drive the real app and play a case to an accusation using only hints. Treat that as the
wave's main guard rather than a nicety, and prefer asking "what would have to be true for
this check to fail?" over "does it pass?".
