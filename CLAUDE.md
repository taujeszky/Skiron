# Skiron — Claude session guide

A murder-mystery deduction game: alibi timelines on a floor plan, cases generated and
proven fair by a pure-TypeScript engine, dressed by an LLM whose every sentence is
verified before the player sees it. Sibling of `../newsignpost` and `../newloopy`
(solver-backed puzzles) and of `../NewX` (LLM authors, engine verifies).

The design and the work breakdown are in `docs/plan/`. **Read `docs/plan/README.md` in
full before doing anything**, then `docs/ARCHITECTURE.md` (what the code actually does,
and why, where a choice was open), then the file for the wave you are on. Work one wave
at a time and keep the status table at the bottom of that README, and the last section of
this file, up to date.

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
npm run par                    # drive a scripted undirected player; par is fitted to it
npm run build                  # static PWA into build/
npm run preview                # serve build/ locally
npm run playthrough            # play a case in headless Chrome through the real buttons
                               # (needs `npm run dev` up; --preset, --shots, --url)
npm run offline                # cut the network and generate a case from the cache
                               # (needs `npm run build && npm run preview` up)
npm run author -- --estimate   # what a paid batch would cost. Makes NO calls.
npm run author -- --dry-run    # the whole authoring pipeline, stubbed, no key
npm run author -- --cases 3    # the real thing (ask the owner first)
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
- **Backticks break the Bash tool here.** A heredoc, even a quoted one, fails with
  `unexpected EOF while looking for matching` the moment the body contains a backtick, so
  TypeScript with template literals cannot be written that way. Use the Write tool for
  source files, and for surgical edits write a Python script with Write and run it - the
  same trap bites `python -c \"...\"` inside double quotes, where bash substitutes the
  backticks before Python ever sees them.
- **`vite-node` can only load a script inside the Vite root.** A measurement script in
  the Claude scratchpad dies with `Cannot find module '/@fs/...'`. Put throwaway engine
  scripts in `tools/` (name them `_something.mjs` and delete them before committing) and
  run them with `npx vite-node --config vitest.config.ts tools/_x.mjs`.
- **Line endings are LF everywhere, and `.gitattributes` is what keeps them that way.**
  Without it, git on Windows checks files out as CRLF while the repository stores LF, so
  any multi-line pattern match against a source file breaks the moment git has touched
  it. That silently turned seven caught mutants into seven false survivors. Do not remove
  it.
- **An ablation measurement is edit-measure-restore, and `git checkout --` is the wrong
  restore.** Tuning here often means switching a filter off, generating a few hundred
  cases and switching it back on; `git checkout -- <file>` takes the file to HEAD and
  silently destroys any *other* uncommitted work in it. That cost a re-application of a
  finished fix this wave. Commit first, or copy the file aside and copy it back.
- **Subagents share this working tree.** A review or design workflow will write scratch
  files into the repo and will happily overwrite one of yours with the same name. Do not
  `git add -A` while a workflow is running, tell agents to use a distinctive prefix and
  to clean up after themselves, and use worktree isolation for any agent that edits code.
- **A Python patch script will happily write a real newline into a JS string.** Writing
  `"...\\n"` in a Python source that is itself inside a heredoc has bitten this project
  twice, and the symptom is a syntax error in a file that looked fine in the diff. For a
  string with an escape in it, split the line into two `console.log` calls or use the
  Write tool.
- **`npm run playthrough` needs the dev server, `npm run offline` needs the built one.**
  `vite dev` serves no service worker and no content-hashed chunks, so pointing the
  offline check at :1430 tests nothing and says so.
- **A `*.live.test.ts` must be EXCLUDED from `vitest.config.ts`, not merely absent from
  it.** The name ends in `.test.ts`, so `npm test`'s include pattern matched the live
  test and made three unintended API calls the first time that file existed. The
  `exclude` line in that config is a spending guard, not tidiness.
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

## State of the project (2026-09-20)

**Waves 0-5 done.** 696 tests green in ~30s, `npm run check` at 0/0 over 493 files.
The game is playable end to end, offline, and every case can be dressed by a model whose
every sentence is checked against the evidence before the player sees it. Measured
fallback rate: **0% over 23 cases and 888 cards**.

- **Wave 0** - toolchain: SvelteKit + Svelte 5 + Vitest + adapter-static, `vite-node` for
  Node tools, generated icons, PWA manifest.
- **Wave 1** - the engine owns the truth. `types.ts`/`axioms.ts` (the contract and
  `isLegal`), `map/` (recursive dissection, doors, SVG geometry, ASCII view), `clues/`
  (all 17 kinds behind one registry), `world/simulate.ts`, `solver/exhaustive.ts` (the
  oracle), `caseId.ts`, `tools/inspect.mjs`.
- **Wave 2** - the deduction solver and everything the player reads. `solver/state.ts`,
  five tiers under `solver/rules/`, `solve.ts`, `difficulty.ts`, `explain.ts` (a sentence
  for all 17 clue kinds and all 28 rules), `hint.ts` (the three hint branches, the
  notebook, and the Check).
- **Wave 3** - cases on demand. `generator/` (caseRules, enumerate, lies, select, bank,
  investigation, generate), `worker/` (protocol, genWorker, genClient) and a real
  `tools/sim.mjs`. 480 generated cases, zero certificate failures, Expert p95 1.05s.
- **Wave 4** - the game. `game/` (controller, notebook, errors, storage, stats, rating,
  a scripted blind player), `ui/` (17 Svelte components), `service-worker.ts`, and three
  browser/measurement tools.
- **Wave 5** - the words. `llm/` (provider seam, Gemini, key handling, stub, skin schema,
  prompts, fidelity, author, glossary, IndexedDB skin store, pack codec and loader),
  `engine/clues/schema.ts` (the clue language as JSON schema, derived from field domains
  declared per kind), one glossary threaded through the controller, and
  `tools/author-case.mjs` with `--estimate` and `--dry-run`. A three-case starter pack
  ships in `static/cases/starter/`. Every test runs against `llm/stub.ts`; the live ones
  are `npm run test:live` and are excluded from `npm test` on purpose.

**Owner decisions, 2026-09-20.** The **first deploy is deferred to wave 8**, which
already owns "repo, deploy, catalog" - nothing is published and no Cloudflare project
exists. And wave 5 is to be **built against stubbed model responses first**, with an
exact expected call count brought back for approval before any real batch is spent.

**Wave 5's spend, approved at up to $5 and measured at about $1.** `npm run author --
--estimate` makes no calls and measures the real prompts; per case it is 3-6 calls and
roughly $0.02. The three things the paid run found — two schema limits nobody documents
and a false-mismatch artefact that made the fallback rate measure the wrong thing — are
in ARCHITECTURE.md section 11 under "What the paid run actually found".

Next: wave 6, free-text interrogation. It inherits the whole `llm/` seam, and invariant 8
(runtime calls never see the truth or unearned cards) is the same shape of problem as
wave 5's writer prompt — solve it the same way, in the type of the input rather than in
a comment.

## How it plays (2026-09-20, template text only)

The plan's fun risk says to stop and say so if the puzzle does not stand up on its own.
It does. This is the honest version, written after driving the real app through all four
presets.

**What works.** The three panes agree with each other and the map is the best part of it
— scrub the hour and you watch the evening take shape, solid tokens for people you have
placed and dashed ones for people who could still be there. The summing-up reads like a
detective rather than like a proof. Roughly half of all questions pay off (measured:
43-64% of the ones a scripted player asked, against 37-49% of the whole menu), so the
rhythm of asking is a rhythm rather than a slog.

**What drags, in order.**

1. **The names.** "Suspect C was not in Room 7 at slot 5" is a correct sentence nobody
   wants to read forty times. Everything else about the game is in better shape than the
   words are, and this is exactly what wave 5 is for. Do not let a wave-5 delay turn into
   "the puzzle needs work" — it does not. *Fixed in wave 5, for any case with a key or
   from the shipped pack: "The coroner's assessment establishes that Gregory Bell was
   killed between nine o'clock and eleven o'clock." Without a key the game still speaks
   in the engine's own words, and that is still the whole game.*
2. **The hint panel, one deduction at a time.** Solving by hints alone takes 17 to 86
   presses, because branch 2 hands over the single cheapest deduction. That is right for
   a nudge and wrong as a crutch. A "write down everything obvious" button is the
   obvious fix and is uncomfortably close to solving it for you; if it goes in, cap it
   at the tier auto-notes already uses.
3. **Expert's cast list.** 146 questions across six suspects. Grouping by hour, person
   and room helps; what would help more is being able to see who has *not* been asked
   about a given hour. Consider it if wave 6's free-text layer does not make it moot.
4. **The notebook at Expert needs horizontal scrolling** on a laptop - eight hours of
   eight rooms does not fit. Inherent, not a bug, but it is the one place the layout
   fights back.

**One thing that reads as a bug and is not:** asking for Expert and being handed a case
labelled Hard. The preset is a request and the tier the solver actually needed is the
answer. The case number still says `SK1-X-`, which is the tell.

Things a later wave will want to know, beyond what ARCHITECTURE.md records:

- **`npm run inspect`** prints a floor plan as ASCII and an evening as a person x slot
  table. It is the fastest way to see what the engine is actually producing.
- **`npm run playthrough -- --shots <dir>`** plays a case and drops a PNG of every
  screen. Looking at those found three layout bugs that type-checking could not, in one
  pass. `--width 400 --height 850` is how the phone layout gets looked at.
- **Waves 1, 2 and 3 were each reviewed adversarially** after they were finished, with
  every finding sent to independent verifiers told to refute it. All three found the same
  *shape* of bug: **the property was already asserted, and the assertion was what was
  broken.** A test that calls the function under test to decide whether the function
  under test was applied; a certificate derived from the thing it certifies; a golden
  signature that summarises away the thing it should watch. All looked like coverage on a
  green board. Ask of any new guard not "does it pass" but "what would have to be true
  for this to fail, and can that happen?" Wave 4 supplied its own example: the offline
  check proved the network was cut by fetching the app's own URL, which a service worker
  answers from cache — so it passed online and failed offline, the wrong way round.
- **A leak can be in the SHAPE of the bank, not its contents.** Every card can be true
  and fair and the case still give itself away: the killer was the only suspect with
  nothing to say about the murder hour (1.3% of Easy cases), and the only one no card
  placed at it (47%). `bank.ts#silenceLeaks` and `#placementLeaks` guard both, and
  `generate.ts` rejects on them. Wave 5's prose and wave 6's interrogation can
  reintroduce this class - think about what the *distribution* of what is said reveals,
  not only each sentence.
- **Two numbers, not one.** A case carries `tier` (the grade of the proof set) and
  `playTier` (the grade of everything the bank can release). `difficulty` comes from the
  second, and that is what the UI shows. See ARCHITECTURE.md section 9.
- **`npm run sim` is how generator numbers get chosen**, and `npm run par` is how game
  numbers get chosen. Both print a rejection or a spread rather than a verdict; neither
  is a pass/fail.
- **Par is measured now, not guessed**, and it is anchored on a scripted player that
  never sees the proof set. If the game changes shape, re-run `npm run par` rather than
  reasoning about it. ARCHITECTURE.md section 10 has the argument and the table.
- **The habit worth keeping**: after a wave, plant deliberate bugs and check the suite
  notices. That is what found both the hypothesis-depth gap and the untested chokepoints
  in `state.ts`, and in wave 4 it found two guards that were prose rather than tests: the
  card list's order is the card *numbering*, and the blind player's heuristic has to beat
  simply sweeping the menu or par is anchored on nothing. A surviving mutant is either a
  missing test or an equivalent mutant, and which one it is has to be established rather
  than assumed - the ones established as equivalent are documented where they live.
- **Two schema limits nobody documents, both found by paying for them.** A
  `responseJsonSchema` array with `minItems`/`maxItems` is refused outright once the
  bound times the item's complexity gets large: the parse-back died at 14 entries of a
  17-branch `anyOf`, and the writer at 54 entries carrying an `enum` of 54 ids. Both
  are a flat 400 `INVALID_ARGUMENT` with no hint which field is at fault. Bisect with
  `maxOutputTokens: 1`, which validates the schema and costs nothing.
- **A test harness must not identify anything by prose the game can rewrite.**
  `tools/cdp.mjs` found the briefing screen by its heading reading "The case", and the
  first dressed case put its own title there. Screens carry `data-screen` now.
- **A mutation tool must refuse to run on a dirty tree.** The restore is `git checkout
  --`, which takes the file to HEAD and destroys any other uncommitted work in it. That
  has now cost this project a finished fix twice, the second time through a script
  written by somebody who had just read the warning.
