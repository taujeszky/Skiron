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

- Pushing to `github.com/taujeszky/Skiron`. **It is public.** Anything pushed is
  published, and a later commit does not unpublish it.
- Deploying to Cloudflare Pages (`skiron` → <https://skiron-e0f.pages.dev>).
- Any paid batch of API calls — say how many calls you expect.
- Editing the portfolio catalog in `../index.html`.
- Changing anything listed under "Locked by the owner" in the plan.

Local commits on `main` are fine without asking.

*The first three were one-time gates until 2026-09-21, when the owner asked for wave 8's
task 8 and all of them were used. They are rewritten above as ongoing gates, which is the
conservative reading of a rule the owner wrote — say so if a push and a redeploy should
now be as routine as a local commit.*

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
npm run contrast               # WCAG contrast for both themes. Non-zero if anything fails.
npm run tutorial               # rebuild the two tutorial cases. No key, no network.
npm run offline                # cut the network and generate a case from the cache
                               # (needs `npm run build && npm run preview` up)
npm run offline -- --url https://skiron-e0f.pages.dev/   # the same, against the LIVE site
npm run author -- --estimate   # what a paid batch would cost. Makes NO calls.
npm run author -- --dry-run    # the whole authoring pipeline, stubbed, no key
npm run author -- --cases 3    # the real thing (ask the owner first)
npm run ask -- --estimate      # what free text costs per question. Makes NO calls.
npm run ask -- --live          # routing agreement, fallback rate, latency (ask first)
npm run author -- --estimate --art        # what the pictures would cost. NO calls.
npm run author -- --dry-run --art         # the whole art path, stubbed, no key
npm run author -- --art --quality fast    # the real thing (ask the owner first)
                               # --suspects-only and --no-scene are the size levers
npm run test:live              # the tests that spend money. Never part of npm test.
npm run deploy                 # build + wrangler pages deploy to `skiron` (ask first).
                               # This, not `git push`, is what changes the live site.
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
   step must change. **Since 2026-09-21 that bump is no longer free**: the site is live,
   so a case id is something a stranger can write down, and a bump re-points every shared
   id at a different puzzle. The shipped packs are fine — a pack stores the whole case
   and is the documented exception — so the cost falls on shared ids alone. ARCHITECTURE
   section 9 has the argument.
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
- **A Python patch script opened without `newline=""` rewrites the WHOLE FILE to CRLF.**
  Worse than the next trap because it is invisible in the diff: on Windows `open(p, "w")`
  translates every LF it writes into CRLF, so a one-line `str.replace` edit silently
  converts every line ending in the file. `.gitattributes` normalises it back on commit,
  so `git diff` comes back **empty** while `git status` still says modified — and
  meanwhile the working copy is the thing that turned seven caught mutants into seven
  false survivors (see the line-endings note above). Pass `newline=""` on BOTH the read
  and the write. Wave 8 had to un-convert nine files this way, then did it again ten
  minutes later while writing this very bullet, which is the argument for checking rather
  than remembering. The check is
  `git ls-files -z | xargs -0 grep -lU $'\r'` — **and validate it against a known-CRLF
  file the first time you use it in a session.** If the `$'...'` quoting is lost anywhere
  (a nested `$( )`, a rewritten command), grep silently searches for the *letter* `r` and
  reports about 80% of the repository. That looks like a catastrophe and means nothing;
  wave 8 lost several minutes to it. `-P '\r'` is unavailable here — grep refuses it
  outside a unibyte or UTF-8 locale. `file <path>` is the unambiguous fallback: it prints
  "with CRLF line terminators" or does not.
- **A Python patch script will happily write a real newline into a JS string.** Writing
  a backslash-n in a Python source that is itself inside a heredoc has bitten this project
  **three times**, and the symptom is a syntax error — or a mangled paragraph — in a file
  that looked fine in the diff. The third time was wave 8 writing the bullet *above* this
  one: the escapes in its own example became real line breaks and split the sentence
  across four lines of CLAUDE.md. For any string containing a backslash escape, use the
  Write or Edit tool. Not a cleverer heredoc — those two traps compose, and the second one
  hides the first.
- **`npm run playthrough` needs the dev server, `npm run offline` needs the built one.**
  `vite dev` serves no service worker and no content-hashed chunks, so pointing the
  offline check at :1430 tests nothing and says so. `npm run offline` also takes
  `--url`, and pointing it at <https://skiron-e0f.pages.dev/> is the strongest check
  there is after a deploy: it is the deployed artefact rather than a local build, and it
  proves the worker installs, a case generates with the plug out and a shipped pack
  opens.
- **Pushing is NOT deploying. There is no CI.** The repository has no `.github`
  directory and the Cloudflare Pages project's Git Provider is "No" — it is direct
  upload only, so `git push` publishes the *source* and changes nothing a visitor sees.
  Only `npm run deploy` moves the site, and it builds first, so a deploy from a dirty or
  stale tree ships that tree. The trap is the obvious one: fix a bug, push it, load the
  site, and find the bug still there. **Which build is live is measurable, not a
  memory** — the service worker's cache stamp is in the file:
  `curl -s https://skiron-e0f.pages.dev/service-worker.js | grep -o "1789[0-9]*" | head -1`
  against the same grep of `build/service-worker.js`. Same trick as the stale-profile
  gotcha further down, one machine along. Nothing anywhere records which *commit* a
  deploy came from, so the stamp is the only thread back.
- **A preview server left running on :4173 serves a STALE build, and your new one fails
  silently.** `vite preview` exits with "Port 4173 is already in use" into whatever log
  you redirected it to, the old process keeps answering, and `npm run offline` then
  tests a build from an hour ago. It cost a wave-5 debugging detour that ended at "the
  attribute is in the build and absent from the page". Same trap as the dev port, one
  server along: check `Get-NetTCPConnection -LocalPort 4173` before believing a failure.
- **And `vite preview` caches the build directory at startup, so REBUILDING under a
  running preview server changes nothing it serves.** Different trap, same symptom, and
  wave 6 hit it after the wave-5 note had already been written: the server was mine and
  on the right port, `build/` on disk had the new attribute, and `curl` of the very
  chunk that contained it came back without it. Restart the preview after every build.
  The decisive check is `curl` against the server, not `grep` against `build/` — and it
  is worth doing before blaming the service worker, which is where an hour went.
- **A `*.live.test.ts` must be EXCLUDED from `vitest.config.ts`, not merely absent from
  it.** The name ends in `.test.ts`, so `npm test`'s include pattern matched the live
  test and made three unintended API calls the first time that file existed. The
  `exclude` line in that config is a spending guard, not tidiness.
- **`Network.emulateNetworkConditions` cuts the PAGE's network, not the service
  worker's.** They are separate targets, so a same-origin request the worker handles can
  still reach the network while the page believes the plug is out. A wave-7 check
  "proved" that a case nobody had opened had its pictures available offline, which is
  impossible - they had never been fetched. `tools/offline.mjs` has the same blind spot
  and gets away with it because what it tests is in-page generation. To ask what is
  really cached, ask `caches.match()`; to really cut the network, stop the server.
  **And once you have stopped it, a same-origin `fetch` is still not proof.** Wave 8
  stopped the preview server and then fetched a deliberately-uncached same-origin URL to
  confirm the plug was out: it came back **200**, because the service worker answers any
  unmatched navigation with the SPA fallback. That is wave 4's mistake in a new hat —
  "the offline check proved the network was cut by fetching the app's own URL". Prove it
  from OUTSIDE the browser (a `curl` that fails) or with a cross-origin request;
  `tools/offline.mjs` does the latter and prints "cross-origin requests are failing, so
  the plug really is out".
- **`tools/offline.mjs` reuses a Chrome profile, so a STALE service worker survives
  between runs.** The tell is in its own output: the cache name ends in the build's
  version stamp, so `cache "skiron-1789942356000"` after a newer build means the run
  tested the previous one. Delete `%LOCALAPPDATA%/Temp/skpt<port>` to force a clean
  install. This is a third member of the stale-preview family and bit wave 7 twice.
  **The port is 9361**, so the directory is `skpt9361` — wave 8 deleted `skpt9230` (the
  number from the CacheStorage gotcha above), got a PASS from a service worker two builds
  old, and only noticed because the cache stamp did not match `build/service-worker.js`.
  Compare them: `grep -o "1789[0-9]*" build/service-worker.js` against the cache name the
  run prints.
- **A string search of a GENERATED file is not evidence about what it does.**
  `build/service-worker.js` computes its precache list at runtime from arrays the
  bundler inlines, so grepping it for a path finds the raw `files` manifest and says
  nothing about what is cached. Wave 7 read "precaches the webp? true" and believed it
  for a minute. Run the thing: importing the built worker with a stubbed `self` and
  `caches` and firing its `install` handler is twenty lines and is the real answer. The
  same caution applies to any bundled output where a constant is computed rather than
  written.
- **A service worker path from `$service-worker` carries the deployment's base path.**
  Comparing a whole path against a fixed set is correct at the root and silently wrong
  anywhere else - and nothing fails, it just looks wrong offline. Match on the suffix.
- **`import("/src/...")` inside a CDP `Runtime.evaluate` gives you a SECOND module
  instance, whose stores are not the running app's.** Wave 8 called `openCaseFile` that
  way to check the import path: it returned `true`, no screen changed and no error panel
  appeared, because the function had run against a private copy of `controller.ts` with
  its own `screen` and `panel` writables. Same family as the HMR second-instance trap,
  and the same rule fixes it — **drive the app's own buttons**. Where a control opens a
  file dialog, override `document.createElement` for the tag it makes, give the element a
  `click` that builds a `File` through `DataTransfer` and dispatches `change`, and put
  `createElement` back afterwards.
- vitest sometimes swallows `console.log`; write debug output to a file instead.
- `../index.html` (the portfolio catalog) has very long lines of embedded art and cannot
  be read whole; read it in slices.
- For Node-side Gemini image calls and `sharp`, copy what already works in
  `../catalog-art`, including how it reads the key.

## How to add a clue type

The clue language is a closed set behind one registry, and the type system is what
makes adding to it safe: `MODULES` in `engine/clues/index.ts` is
`{ [K in ClueKind]: KindModule<K> }`, so a kind with no module, or a module filed
under the wrong kind, does not compile. Work in this order and the compiler tells
you what is left.

1. **Declare the payload** as a member of `ClueBody` in `engine/types.ts`. Add the
   name to `CLUE_KINDS` in `clues/index.ts` too — that list is written out by hand
   rather than read off `MODULES` because the generator iterates it and the order is
   part of invariant 4.
2. **Write the module** in the file its family belongs to — `presence.ts`,
   `company.ts`, `counting.ts`, `victim.ts`, `rules.ts` — and add it to `MODULES`.
   The compiler now demands `holds`, `canonical`, `normalise`, `valid`, `topicKeys`,
   `template` and `fields`. Two of those are easy to get subtly wrong:
   - `normalise` has to sort every unordered field and order every span, or two
     clues that mean the same thing get different canonical forms and the fidelity
     check starts rejecting good prose.
   - `fields` declares the domain of every payload field except `kind`, and the
     mapped type is exact. `clues/schema.ts` derives **both** the JSON schema the
     model is constrained by and the reader that turns its answer back into a clue,
     from this one declaration — which is the point: wave 5 changed the plan here,
     because hand-writing seventeen schema fragments is seventeen chances for the
     schema, `valid` and the frame's real bounds to drift apart silently, inside the
     one check whose whole job is noticing that two things disagree.
3. **Teach the generator to produce it**, in `generator/enumerate.ts`. A physical
   clue also needs `physical()` to say so, which is what decides whether it is found
   by examining a room or told by a suspect.
4. **Give it a weight** in `generator/select.ts`. `DEFAULT_WEIGHTS` covers every
   kind, and `PLACING` / `INDIRECT` are the overrides that make the harder presets
   harder. A kind that pins a cell outright belongs in `PLACING`; see ARCHITECTURE
   section 9 on why starving the top presets of those is what separated Expert from
   Hard.
5. **Propagators, if it can drive a deduction.** Only forced eliminations — invariant
   3 — and **the new rule joins the oracle test**, which is not optional: that suite
   is the only thing standing between a soundness bug and a case that cannot be
   solved. Note that `ClueModule.propagate` is declared `propagate?: unknown` in
   `types.ts` and **no module has ever filled it**; the solver switches on kind
   instead. See the six sites below.
6. **Run the guards.** `npm test` covers the registry's own completeness tests
   (`clues.test.ts`, `schema.test.ts`, `explain.test.ts` all iterate `CLUE_KINDS`, so
   a missing template or an unparseable schema fragment fails without a new test
   being written). Then `npm run sim` to see what the new kind does to the tables,
   and record it in ARCHITECTURE section 9 if you keep it.

### The seven switch sites the registry does not cover

**This section exists because the sentence it replaces was wrong.** `clues/index.ts`,
`types.ts:255` and ARCHITECTURE §3 all said, in wave-1 language, that everything
dispatches through the registry and a new kind is "a new file plus one line in
`MODULES`". That was the intention; the switches got scattered anyway. Found by audit
in wave 8 — **and every one of them was made to fail the build afterwards**, so the
list below is now a map of where to work rather than a list of traps:

| Site | Cases | If an 18th kind is added |
| --- | --- | --- |
| `solver/exhaustive.ts` `clueProp()` | 17 + `never` | build fails |
| `solver/rules/tier0.ts` `applyClue()` | 17 + `never` | build fails |
| `solver/rules/tier2.ts` `applyClue()` | 17 + `never` | build fails |
| `generator/bank.ts` `places()` | 17 + `never` | build fails |
| `generator/enumerate.ts` `givesAwayAnswer()` | 17 + `never` | build fails |
| `generator/enumerate.ts` `couldKnow()` (who may speak it) | 17 + `never` | build fails |
| `generator/enumerate.ts` `physical()` | 17 + `never` | build fails |

Five of those seven used to be a bare `default`, and the dangerous pair was `tier0`
and `tier2`: `applyClue` returns `void`, so TypeScript does **not** check
exhaustiveness on its own, and a new kind would have been handled by the exhaustive
oracle and ignored by the deduction solver. That is the two-solver divergence
invariant 2 exists to prevent, and it would have surfaced as neither a type error nor
a certificate failure — the deduction solver merely proves less, so it shows up as a
rise in `unsolvable` rejections in `npm run sim`, which is easy to read as "the new
clue type is not very useful". A `default` that returns a value is checkable and a
`default` that returns `void` is not, which is why the fix is a `never` binding in
every one of them and not a convention.

The other two, where the default was "no" rather than "nothing": `places()` decides
whether a card accounts for somebody's whereabouts at `t*` (a new kind defaulting to
"no" quietly widens `silenceLeaks`/`placementLeaks`), and `physical()` used to be
`kind !== "Together"`, so a new kind defaulted to **physical** — the side that sends
the player to search a room for it.

**Measured, not assumed:** adding `| { kind: "Moved"; p: PersonId; t: SlotIndex }` to
`ClueBody` and changing nothing else gives **11 errors in 9 files** — the seven above
plus `clues/index.ts` (`MODULES` is a mapped type over `ClueKind`), `clues/schema.ts`,
and two tests that tabulate every kind. That edit, `npm run check`, and `git checkout`
of the one file is the way to re-check this table rather than trusting it.

`CLUE_KINDS` is the exception and stays one: it is a plain `readonly ClueKind[]`, so
seventeen entries still typecheck when there are eighteen kinds. What catches it is
`clues.test.ts`, which compares it against `Object.keys` of a per-kind sample table
and asserts the length is 17 — that hardcoded 17 is deliberate, and updating it is
part of the job.

Also note `exhaustive.ts` tests `DoorClosed` / `BarredDoor` / `Capacity` by name
outside its main switch when folding rule cards into movement masks.

**Finding these by grep:** `grep 'body.kind'` finds three of the seven. Three more are
written `switch (b.kind)` after `const b = clue.body`, and `physical()` switches on a
bare `ClueKind` parameter and mentions neither word. Search for a quoted kind name
such as `case "At"` instead — that finds all seven. And plain `grep kind` is very noisy — `source.kind`,
`LlmError.kind`, `panel.kind`, `hint.kind` and `Conclusion.kind` all share the field
name and none of them are clue kinds.

**What you genuinely do not have to touch:** `src/lib/ui/`, `src/lib/game/` and
`src/lib/llm/` contain no clue-kind switch at all. The UI's only kind test is the
`isRuleKind` predicate. `explain.ts` has no per-kind sentence switch either — it
delegates to the module's `template`.

## Conventions

- Engine tests live next to the code as `*.test.ts`, run in Node, no DOM.
- Match the surrounding code's comment density and naming. Comments explain why, and
  record measurements where a number was chosen by measuring.
- Tune generator presets from the `npm run sim` table, never by feel, and record the table
  in `docs/ARCHITECTURE.md`.
- When the plan turns out to be wrong, change the plan file in the same commit and say
  why.

## State of the project (2026-09-21)

**Waves 0-8 done; wave 9 not started. Skiron is published:**
<https://github.com/taujeszky/Skiron> (public) and <https://skiron-e0f.pages.dev> (live),
and it is the twentieth card in the portfolio catalog. 963 tests
green in ~13s,
`npm run check` at 0/0 over 526 files, `npm run contrast` at 0 of 78 pairs. The game is
playable end to end, offline, with no key: twelve illustrated cases and two tutorial
lessons ship with the site, and every case a model writes has every sentence checked
against the evidence before the player sees it. Measured fallback rate: **0% over 23
cases and 888 cards**.

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

- **Wave 6** - the same questions, typed. `llm/interrogate/` (classify, voice, the
  deterministic guards, the orchestrator), `Save.chat` and a chat panel above the topic
  picker, `tools/interrogate-cost.mjs`. A typed question is routed to one of the picker's
  own topics and released by `askAbout`, so the two routes cannot drift; the router sees
  no card and the voice call sees only the cards just released. Invariant 8 is closed in
  the types, as wave 5 closed the writer's, and the prompts are required to be identical
  byte for byte when the culprit, the murder hour, the whole simulated evening **and the
  contents of the bank** change underneath them.

**Wave 6's spend, approved at up to $5 and measured at about $0.60.** `npm run ask --
--estimate` makes no calls: about **$0.0009 a question**, so $0.019 to $0.043 for a case
played entirely in words — one to two times what *writing* a case costs, and unlike the
writing it is paid every time somebody plays. That is a number wave 8 needs before it
ships anything.

The live run, over the three shipped cases and one Expert case written for it:
**182/182 questions routed as written, 162/162 replies survived the guard, p50 2.6s a
question** (two calls; the card itself appears sooner, because the engine releases it
between them). Those are the numbers *after* three fixes that the first run found — a
room code that was also an ordinary word, a router that was never told the cast's jobs,
and testimony written as narrated attribution that a speaker would not repeat verbatim.
All three are in ARCHITECTURE.md section 12 under "What the live run actually found",
with what each one measured before and after.

- **Wave 7** - the pictures, and everywhere the game does without them. `llm/art/`
  (prompts, the runner), `llm/artStore.ts` and a shared `llm/idb.ts`, a deterministic
  monogram in `ui/look.ts` behind `Token.svelte`'s new `art` prop, `--art` on the
  authoring CLI, and `lib/util/precache.ts`. The rule the wave turns on is that **the
  game never waits on an image**: `startArt` runs after `showGame` and is not awaited,
  every failure costs one picture, and every screen renders from the monogram until a
  blob arrives. An image cannot be fidelity-checked, so the defence is entirely in the
  prompt - and the two prohibitions worth remembering are structural: one person per
  portrait, nobody at all in a scene. Art never appears in the evidence pane.

**Wave 7's spend, approved at up to $20 and measured at about $6.** The starter pack is
now **twelve illustrated cases, three at each difficulty**, across twelve settings: 84
pictures, 1.40 MB of art, 0.27 MB of JSON, and **nothing at all added to the install
payload** because images are cached on first view rather than precached. 84 of 84
pictures are usable, 82 of them first time.

The one finding worth carrying past this wave: **a prohibition cannot beat a
description.** Five of the first seventeen portraits came back holding a ledger, a
notepad or a ring of keys - not invented by the image model, but asked for by the
*writer's own prompt*, because wave 5's schema said only "A prompt for a portrait of
them". A list of "do not"s appended after the subject clause loses to it. Fixed where it
is asked for and contradicted outright for prompts already on disk. That and three other
findings - 27% of expert-preset seeds actually grade expert, a 54-card case can exceed
the writer's 90s timeout - are in ARCHITECTURE.md section 13 under "What the paid run
actually found".

- **Wave 8** - shipping it. Two tutorial lessons in `static/cases/tutorial/` behind a
  coach strip that reads the game state (`game/tutorial.ts`), a case as a file that is
  **re-proved on the way in** (`game/transfer.ts`), an accessibility pass with
  `npm run contrast` left behind as a permanent guard, a balance pass that re-measured
  everything and deliberately changed nothing, and the README rewritten from its
  plan-phase version. ARCHITECTURE section 14 has the whole account.

**What wave 8 mostly found was claims that had stopped being true.** In four of its
eight tasks the thing the plan asked for already existed and was either unused or not
doing what it said. Three of those were shipping bugs:

- **A shipped case could not be resumed.** `Save` held only the case id, so "Carry on"
  *regenerated* a pack case — the one thing `llm/pack.ts` exists to say must not be
  relied on — and dropped the prose and pictures that came in the file. `Save.pack`
  fixes it. True of all twelve since wave 5, and invisible because the generator had not
  changed yet.
- **The writing path printed the provider's raw error.** Seven plain sentences had
  existed since wave 5 with one caller; `dressCase` used `err.message` instead, which
  for a quota refusal is 200 characters of JSON — and, because it bypassed
  `LlmError.from`, was never scrubbed, so a provider quoting its own URL would have put
  the player's key on screen. It lasted three waves because writing was the one model
  path with **no test seam**; `useWriteProvider` closes that.
- **The floor plan's rooms were announced as nothing.** `role="img"` on the svg makes an
  element a leaf in the accessibility tree, so the `role="button"` on each room was
  never exposed. Keyboard-focusable and silent since wave 4.

**Task 8 was offered on 2026-09-21, held, and then asked for the same day.** Offered all
three (repo, deploy, catalog), repo-and-deploy, repo-only, or hold, the owner chose
**hold all three** - the second time they deferred a deploy rather than publish before
they were ready. Then: "okay for now finish wave 8, task 8 please". All three are done.

- **Repository** `taujeszky/Skiron`, public, 297 files. The pre-flight was re-run rather
  than trusted, because a repository is not un-published: the only key-shaped strings
  tracked are two deliberately fake constants in the tests that prove the scrubber works,
  both compared against the real key on disk, and **the real key was searched for across
  all 55 commits and not merely the working tree** - a key deleted in a later commit is
  still public. It appears in none.
- **Deploy** <https://skiron-e0f.pages.dev>. Create the Pages project explicitly first
  (`wrangler pages project create skiron --production-branch main`); `pages deploy` would
  otherwise prompt for it, and this shell is non-interactive. Verified against the
  *deployed* site rather than a local build, with `npm run offline -- --url
  https://skiron-e0f.pages.dev/`: worker installed, network cut, all four difficulties
  generated and played, shipped case opened in its own words.
- **Catalog** a 20th `PROJECTS` entry in `../index.html` plus one `gemini-3.1-flash-image`
  call (~$0.05, approved first, usable first time). Its draft description was **453
  characters against a sibling average of 282** - the house voice dilutes one entry at a
  time, so measure against the neighbours rather than write to taste. `../index.html` and
  `../catalog-art/` are **not** under version control.

**The one thing wave 8 did not settle, and should not be read as settled:** *nobody has
solved a case in words.* The balance pass measured the generator and par; item 3 of "How
it plays" below - whether free text actually makes Expert's 146-question cast list
bearable - needs a person or a paid live run, and the paid run is a gate nobody has
asked for. Item 4 of that list *was* measured: the Expert notebook wants 759 px and gets
719 on a 1440 laptop, 639 at 1280 and 390 on a phone, so it scrolls at every width.

**The hardening pass, 2026-09-21 — not wave 9.** Wave 9 is optional, is not planned in
detail, and its own file says not to start it unbidden; none of it has been. What was
done after wave 8 is the set of defects wave 8's own audit recorded and left open, all
on shipped code, with no new feature and no model call:

- **The seven kind-switches outside the registry all end in `never`**, so an 18th clue
  kind is a build error in every one rather than a silent omission in five. The one that
  mattered is the pair `tier0.ts`/`tier2.ts` — see "How to add a clue type" above.
- **`Save.pack` is fatal when present and malformed**, like every sibling field in
  `parseSave`. Degrading it to `undefined` did not mean "unreadable", it meant "a
  generated case", which is a false statement about the save in hand, and `resume()`
  believed it.
- **`src/lib/platform.test.ts`**, a second purity guard over everything outside the
  engine. Outside `engine/` the rule cannot be absence, so it is **ownership**: each
  browser API names the file allowed to touch it, an owner that stops using its API must
  leave the list, and the two known leaks (`controller.ts#applyTheme` reaching for
  `matchMedia` and `document`) are asserted by name so a third cannot appear quietly.
  `engine/purity.test.ts`'s own banned list, written in wave 1, gained the APIs waves
  5-7 introduced.
- **Stale doc comments repaired** in `clues/index.ts`, `types.ts` and ARCHITECTURE §3 —
  and `ClueModule.propagate` now says outright that no module has ever filled it, and
  why one propagator per kind is the wrong shape: a propagator belongs to a kind *at a
  tier*, and `Together` is split across tiers 0 and 2 deliberately.

Every one of those guards was proved to bite before it was believed: an 18th kind
planted in `ClueBody` (11 errors, 9 files), the old lenient `Save.pack` branch put back,
and a `localStorage` call planted in `game/rating.ts`. Restores were done by copying a
file back, never `git checkout --`. `docs/plan/wave-9-beyond.md` has the whole account
at its foot.

Next: wave 9 is optional, not planned in detail, and not to be started unasked.

## How it plays (wave 4's verdict, in template text)

**What wave 5 changed, and what it did not.** Cases with a key, and the three shipped in
`static/cases/starter/`, now read in written prose — "The coroner's assessment establishes
that Gregory Bell was killed between nine o'clock and eleven o'clock" — and item 1 below
is fixed for them. **But nobody has played a dressed case end to end.** It has been opened,
read, verified card by card and driven through the briefing by a script; it has not been
solved by a person, or by the scripted player, from first question to accusation. Items 2
to 4 below were measured on template text and may read differently with names on them —
the Expert cast list in particular, where 146 questions are now 146 *named* questions,
which could be better or much worse. Wave 8's polish pass should settle it, and should
not assume wave 4's answers still hold.

**What wave 6 changed, and what it did not.** Item 3 below — Expert's 146-question cast
list — is the one wave 6 was meant to make moot, and **it has not been shown to.** A
typed question now routes to the right topic (182/182 on scripted phrasings) and the
picker and the text box release identical cards, so the grind *can* be skipped. Whether
a person actually plays that way, and whether it is more pleasant than scanning the
menu, is unmeasured: nobody has solved a case in words from first question to
accusation. One real question has been put through the real app, and that is all. Item 2
is untouched. Wave 8's polish pass should settle both rather than assume either.

The rest of this section is wave 4's verdict, unchanged.

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
answer. The case number still says `SK1-X-`, which is the tell. *Wave 8 measured how
often: **29% of Expert requests land at Expert**, over 300 cases. It also priced the fix
— `expert.tier.min` at 4 gives 100%, every case still generates, and the p95 goes from
995 ms to 3322 ms — and declined it, because that lands on the slowest preset on the
slowest device and the grade shown was already honest. The home screen now says so in a
sentence instead. ARCHITECTURE section 9 has both tables.*

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
- **`npm run ask -- --estimate` prices a *played* case**, the way `npm run author --
  --estimate` prices a written one, and the answer is that playing costs one to two
  times writing — $0.019 to $0.043 a case — and is paid every time somebody plays, where
  the writing is paid once. Wave 8 needs that before it ships anything, and wave 7's
  images are a different order again: $0.045 to $0.151 **per picture**.
- **A prohibition cannot beat a description.** Wave 7's central lesson and the one that
  generalises furthest. Five of the first seventeen portraits came back holding a ledger,
  a notepad or a ring of keys - not invented by the image model, but asked for by the
  *writer's own prompt*, because wave 5's schema said only "A prompt for a portrait of
  them". A list of "do not"s appended after the subject clause loses to it, every time,
  and adding a sixth prohibition changes nothing. Fix it where the thing is asked for, or
  contradict it outright. Before adding an instruction to any existing prompt, check
  whether something earlier in that prompt is asking for the opposite.
- **A canned answer is not a fallback, and counting it as one measures nothing.** Wave
  6's first live report put the fallback rate at 35% because `too_broad` and an
  accusation are answered from a fixed line and never reach the voice call. It moved
  sensibly with the question mix and was an artefact of the question mix — the same
  shape of mistake as wave 5's `Count k=0`. Whenever a rate is reported, check what the
  denominator actually contains.
