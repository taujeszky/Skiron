# Skiron — Claude session guide

A murder-mystery deduction game: alibi timelines on a floor plan, cases generated and
proven fair by a pure-TypeScript engine, dressed by an LLM whose every sentence is
verified before the player sees it. Sibling of `../newsignpost` and `../newloopy`
(solver-backed puzzles) and of `../NewX` (LLM authors, engine verifies).

**The project is in its plan phase. Nothing is built.** The design and the work
breakdown are in `docs/plan/`. **Read `docs/plan/README.md` in full before doing
anything**, then the file for the wave you are on. Work one wave at a time and keep the
status table at the bottom of that README, and the last section of this file, up to date.

## Ask the owner first

- Creating the GitHub repository (`taujeszky/Skiron`) or pushing to it.
- The first Cloudflare Pages deploy.
- Any paid batch of API calls — say how many calls you expect.
- Adding Skiron to the portfolio catalog in `../index.html`.
- Changing anything listed under "Locked by the owner" in the plan.

Local commits on `main` are fine without asking.

## Stack

- **SvelteKit + Svelte 5 (runes)** with `adapter-static`, SSR off, layout prerendered;
  the SPA fallback is `404.html` (see gotchas). Components use runes; shared game state
  uses `svelte/store` writables in `src/lib/game/controller.ts`, as in Signpost.
- **Vitest** with a standalone `vitest.config.ts` that aliases `$lib` by hand and does
  not load the SvelteKit plugin. Tests cover pure TypeScript under `src/lib/**`; the UI
  is untested.
- **`vite-node`** runs the Node-side tools (`tools/sim.mjs`, later the authoring CLI) so
  they can import engine TypeScript through the same `$lib` alias — it reuses
  `vitest.config.ts` for exactly that reason.
- **No Tauri yet.** Keep browser-only APIs (storage, IndexedDB, workers) behind small
  modules so a shell can be added.
- **Gemini** via `@google/genai`, behind `src/lib/llm/provider.ts`. All model ids in
  `src/lib/llm/models.ts`.
- Dependency versions are **pinned exactly**, matching what Signpost has proven on this
  machine.
- This machine is **Windows on ARM**.

## Commands

```sh
npm install --ignore-scripts --legacy-peer-deps   # BOTH flags are mandatory — see gotchas
node scripts/patch-workerd.cjs                    # after any install (postinstall is skipped)
npm test                       # engine tests. Run after ANY engine change.
npm run test:watch             # same, watching
npm run check                  # svelte-check; keep at 0 errors 0 warnings
npm run dev                    # dev server on :1430 (strictPort)
npm run sim                    # generate hundreds of cases per preset, print the table
npm run build                  # static PWA into build/
npm run preview                # serve build/ locally
npm run deploy                 # build + wrangler pages deploy (ask first)
npx svelte-kit sync            # regenerates .svelte-kit/tsconfig.json if check/test fail
                               # with "Cannot find module ./.svelte-kit/tsconfig.json"
```

## Critical invariants (the plan explains each)

1. **The engine owns every fact.** The LLM cannot add, remove or alter a clue. Only
   evidence cards are canon; prose is decoration.
2. **Every case is fair, certified twice:** the tier-capped deduction solver finishes,
   and the independent exhaustive solver returns exactly the true answer.
3. **Deduction rules must be sound** — forced eliminations only. The oracle tests guard
   this; a new rule joins that guard.
4. **Determinism.** Same case ID ⇒ byte-identical case. No `Math.random`, `Date` or DOM
   in `src/lib/engine/`. Bump the ID version if the RNG, iteration order or any generator
   step must change.
5. **Accusation, Check and win detection never go through a solver.** They compare with
   the stored truth, so a solver bug cannot hand out a bogus win.
6. **No LLM prose reaches the player unverified.** Parse-back equality, or the template
   sentence. The template renderer covers every clue type.
7. **Innocents never lie.** With lying on, testimony by `s` asserts `s ≠ culprit ⇒ φ`.
   The full statement bank must leave the case fair.
8. **Runtime model calls never receive the truth, the culprit or unearned cards.** The
   interrogation model only ever sees what the player is about to see.
9. **The API key never enters a file, a URL or a log.**
10. **`TRIAL_BUDGET` is part of the grade.**

## Gotchas

- **`npm install` MUST be run with `--ignore-scripts --legacy-peer-deps` here.**
  - `--ignore-scripts`: wrangler's `workerd` has no win32-arm64 binary and its install
    script aborts the whole install. Because that also skips `postinstall`, run
    `node scripts/patch-workerd.cjs` by hand afterwards so `wrangler pages deploy`
    works. Never use `wrangler dev` here.
  - `--legacy-peer-deps`: without it npm 11.4.2 dies with
    `Cannot read properties of null (reading 'edgesOut')` while walking peers. The chain
    is vitest → optional peer `@vitejs/devtools-vitest` → peer `vitest@*` → vitest 5 →
    optional peer `@vitest/browser-playwright`, and arborist trips over the optional
    peer. Pinning versions does not help; the flag skips the walk. (Measured
    2026-09-19; Signpost predates the vitest-5 publish and so never hit it.)
- **The SPA fallback is `404.html`, not `index.html`.** The root layout prerenders, so
  `index.html` is the real home page; an `index.html` fallback would overwrite it with an
  empty shell (the adapter says so, in a line easy to miss).
- **Headless-browser testing:** Chrome's CacheStorage fails when `--user-data-dir` is
  deeply nested (the Claude scratchpad qualifies), and service workers then silently fail
  to install. Use a short path such as `C:/Users/<user>/AppData/Local/Temp/chp9230`.
- **Driving the real app** settles "does this really happen in the game?" without a test
  framework: see the CDP notes in `../newsignpost/CLAUDE.md`. Mind the dev port (:1430)
  and the HMR second-instance trap described there.
- vitest sometimes swallows `console.log`; write debug output to a file instead.
- `../index.html` (the portfolio catalog) has very long lines of embedded art and cannot
  be read whole; read it in slices.
- For Node-side Gemini image calls and `sharp`, copy what already works in
  `../catalog-art`, including how it reads the key.

## Conventions

- Engine tests live next to the code as `*.test.ts`, run in Node, no DOM.
- Match the surrounding code's comment density and naming. Comments explain why, and
  record measurements where a number was chosen by measuring.
- Tune generator presets from the `npm run sim` table, never by feel, and record the table
  in `docs/ARCHITECTURE.md`.
- When the plan turns out to be wrong, change the plan file in the same commit and say
  why.

## State of the project (2026-09-19)

**Wave 0 done.** The toolchain works on this machine: SvelteKit + Svelte 5 + TypeScript,
Vitest, `vite-node` for Node tools, adapter-static, generated icons, PWA manifest (no
service worker yet — wave 4). `npm test` green (6 tests, the seeded RNG), `npm run check`
at 0/0, `npm run build` writes `build/`, `npm run dev` serves on :1430. Nothing of the
game exists yet beyond `src/lib/engine/rng.ts`. No remote, no deploy.

Next step: wave 1 — case model, map, axioms, truth simulation, clue modules, exhaustive
solver.
