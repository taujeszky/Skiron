# Skiron — murder mysteries that are provably fair

An endless supply of country-house murder puzzles. A floor plan, a handful of suspects, an
evening cut into time slots, and a body. Examine the rooms, question the suspects, work out
who was where and when, and name the killer and the hour.

Every case is proven to have exactly one answer before you see it, and it is graded by the
reasoning it actually requires — from "only one person could have been there" up to
"suppose the Colonel is telling the truth…". In the harder cases the killer lies.

Twelve illustrated cases ship with the site and need no key and no network. Type a setting
of your own — a lighthouse in a storm in 1923, a generation ship, a monastery — and get a
fresh one written to match.

**[Play it](https://skiron-e0f.pages.dev)** — installable, and it generates fresh cases
with the network unplugged.

## What makes it different

- **The puzzle is certified twice before you see it.** A tiered deduction solver has to
  finish the case using forced eliminations only, and an independent exhaustive solver has
  to agree the answer is unique. A case that fails either is thrown away rather than
  shipped, and the two solvers are separate implementations on purpose: each is the
  other's guard.
- **The grade is the honest one.** Difficulty is not a knob on the generator; it is the
  highest tier of reasoning the case actually needed. Asking for Expert and being handed a
  Hard case is the system working — the case number still records what you asked for.
- **A language model writes it and never decides anything.** The engine picks every clue.
  The model names the place and the people, gives them motives and voices, and writes each
  clue as a sentence somebody would say. Then a separate call with a fresh context reads
  those sentences back — without ever seeing the formal clues — and the engine compares
  what came back with what it meant. A sentence that does not parse back to exactly its
  own clue is rewritten, and failing that replaced by the engine's own wording. **Only the
  evidence card is canon; the prose is decoration.**
- **You can question the suspects in your own words,** and you cannot talk one into a
  spoiler. The model that plays them is never told who did it. Your question is routed to
  one of the same topics the menu offers, the engine decides what that releases, and the
  reply is checked to contain the verified sentence verbatim and nothing else about who
  was where.
- **Hints explain rather than solve.** A hint runs the solver on *your notebook* — not on
  the answer. If you have ruled something out that is true, it says so first; otherwise it
  gives you the single cheapest deduction you are missing, and says which rule it used.
  When your cards are exhausted it points at the question that would release the next one.
- **Check is one bit.** Is everything in your notebook consistent with what happened? Never
  which cell. It costs nothing and counts against nothing.
- **The whole game works offline with no key at all.** Cases can be generated in a worker
  in your browser, and every clue has an engine-written sentence. The model is an
  upgrade to the telling, never a dependency of the puzzle.
- **Illustrated.** Portraits and a scene for each case, drawn from the writer's own
  prompts. Where there is no picture there is a monogram derived from the name, so nothing
  ever waits on an image.

## How a case works

These eight rules are the whole logic. Both solvers may use exactly these and nothing else.

1. The evening is divided into slots. In each slot everyone is in exactly one room.
2. Between slots a person stays put or passes through one open door. Case-file rules may
   close a door for part of the evening, bar someone from a door or a room, or cap how many
   people a room holds.
3. People in the same room see each other. Nobody sees into another room.
4. The victim was killed where the body was found, in a single slot, alone with the killer.
5. Afterwards nobody but the killer was in that room until the body was found.
6. Physical evidence and case-file rules are always true.
7. Innocent people always tell the truth, but not everything: silence proves nothing. In
   the harder cases the killer's statements may be false.
8. You accuse a person and a time.

## Controls

| Action | Input |
| --- | --- |
| Cross a room out, or place a person in it | Click the notebook cell — whichever the mode button says |
| Do the other one, just this once | Shift + digit, or double-click to place |
| Pick a room by number | The digit shown on the room: `R3` is always `3` |
| Flip between crossing out and placing | `X`, or the two buttons above the notebook |
| Clear a cell | Backspace or Delete |
| Move around the notebook | Arrow keys |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Hint | `H` |
| Check the notebook | `C` |
| Accuse | `A` |
| Close a panel, or stop a case being built | Escape |

Crossing out is the default, because that is what most of the work is. Room codes are
always shown beside the colours, because a fifth of players cannot reliably tell two of
them apart.

## Development

```sh
npm install --ignore-scripts --legacy-peer-deps   # both flags are needed; see below
node scripts/patch-workerd.cjs                    # postinstall is skipped by the above
npm run dev                    # dev server on :1430
npm test                       # engine and game-logic tests (vitest)
npm run check                  # svelte-check, kept at 0 errors 0 warnings
npm run build                  # static PWA into build/
npm run sim                    # generate hundreds of cases per preset, print the table
npm run par                    # drive a scripted player; par is fitted to what it spends
npm run inspect                # print a floor plan and an evening as ASCII
npm run author -- --estimate   # what a paid authoring batch would cost. Makes no calls.
```

`--ignore-scripts` is needed because wrangler's `workerd` has no win32-arm64 binary and its
install script aborts the whole install; `--legacy-peer-deps` because npm 11 trips over an
optional peer in vitest's dependency graph. Neither is about this project's own code.

Tests are plain Node — no DOM, no browser. The UI is settled by driving the real app
headlessly instead (`npm run playthrough`), which is also how the offline behaviour is
checked (`npm run offline`).

## How it works

```
src/lib/
  engine/     pure TypeScript: no DOM, no Math.random, no Date
    map/      a rectangular dissection of the house, doors, exact SVG geometry
    world/    the evening simulated as biased random walks that obey the rules
    clues/    17 clue kinds behind one registry, each with its own evaluator,
              propagators, template sentence and field domains
    solver/   exhaustive.ts (the oracle) and the tiered deduction solver
    generator/ enumerate every true clue, build the culprit's lie, cut the set
              down while the solver still finishes, then assert with the oracle
  worker/     generation off the main thread
  llm/        a narrow provider seam, the writer, the fidelity check,
              interrogation, art, and the case-pack codec
  game/       all state as stores; notebook, hints, stats, persistence
  ui/         Svelte components
```

A case is a pure function of its ID, so `SK1-N-3f9k2a` is the share link, the bug report
and the regression fixture at once. Nothing in `engine/` may read the clock, the DOM or an
unseeded random number, and a test enforces it.

The details, including what each paid run of the model actually turned up, are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The implementation plan it was built from is
in [docs/plan/](docs/plan/).

## Stack

SvelteKit · Svelte 5 · TypeScript · Vitest · static PWA on Cloudflare Pages · Gemini via
`@google/genai` with your own key, used only from your browser. No server, no account, and
the key never enters a file, a URL or a log.

A sibling of [Signpost](https://github.com/taujeszky/newsignpost) and Loopy (solver-backed
puzzles with hints that explain why) and of Ascendant (the model authors, the engine
verifies).
