# Skiron — murder mysteries that are provably fair

An endless supply of country-house murder puzzles. A floor plan, a handful of suspects, an
evening cut into time slots, and a body. Examine the rooms, question the suspects, work out
who was where and when, and name the killer and the hour.

Every case is proven to have exactly one answer before you see it, and it is graded by the
reasoning it actually requires — from "only one person could have been there" up to
"suppose the Colonel is telling the truth…". In the harder cases the killer lies.

## Status

**Design phase — no code yet.** This repository currently holds the implementation plan in
[docs/plan/](docs/plan/). Start with [docs/plan/README.md](docs/plan/README.md).

## The idea

The engine owns the truth and the language model owns the telling.

- **The engine** builds the floor plan, simulates the evening, chooses the clues, proves
  the case is fair, grades it, and explains each deduction as a hint. It needs no model:
  the whole game is playable with engine-written sentences, offline.
- **The model** names the place and the people, gives them motives and voices, writes each
  clue as a witness statement, plays the suspects when you question them in your own words,
  writes the detective's summing-up, and prompts the portraits. It never decides a fact.
  Every sentence it writes is parsed back and compared with the clue it was meant to
  express before you see it, and the model that plays the suspects is never told who did
  it — so you cannot talk it into a spoiler.

Type any setting — a lighthouse in a storm in 1923, a generation ship, a monastery — and
get a case that is as fair as a Sudoku.

## How a case works

1. The evening is divided into slots. In each slot everyone is in exactly one room.
2. Between slots a person stays put or passes through one open door.
3. People in the same room see each other. Nobody sees into another room.
4. The victim was killed where the body was found, in a single slot, alone with the killer.
5. Afterwards nobody but the killer was in that room until the body was found.
6. Physical evidence and case-file rules are always true.
7. Innocent people always tell the truth, but not everything: silence proves nothing. In
   the harder cases the killer's statements may be false.
8. You accuse a person and a time.

## Planned stack

SvelteKit · Svelte 5 · TypeScript · Vitest · static PWA on Cloudflare Pages · Gemini via
`@google/genai` with your own key, used only from your browser. No server, no account.

A sibling of [Signpost](https://github.com/taujeszky/newsignpost) and Loopy (solver-backed
puzzles with hints that explain why) and of Ascendant (the model authors, the engine
verifies).
