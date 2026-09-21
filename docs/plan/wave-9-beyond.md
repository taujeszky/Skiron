# Wave 9 — Beyond the core (optional)

None of this is committed. Each item is a sketch to be planned properly if the owner asks
for it. Do not start any of it on your own initiative.

- **Daily case.** The owner chose to leave this out of the core. A date-seeded case, the
  same for everyone, with streaks, as in Cardscape. With template text it needs no key and
  works offline. A skinned daily case for everyone would need pre-authored cases shipped in
  advance, because there is no backend.
- **Confrontation.** Present a card that contradicts a suspect's statement and watch them
  react. The engine decides whether the card really contradicts the statement; the model
  only voices the reaction. A natural payoff for lying cases.
- **Hungarian.** The skin already carries `language`. It also needs Hungarian template
  sentences in `explain.ts` (case endings make this more than string substitution) and a
  translated interface.
- **More clue types.** The extension set in the README — movement, door use, things heard,
  ordering — each added through the "How to add a clue type" path and justified by the sim
  table.
- **Tauri shell**, following Loopy and Signpost. Persistence is already behind a module for
  this.
- **More providers** (OpenRouter, OpenAI) behind `llm/provider.ts`, as Notus does.
- **Campaigns.** Linked cases in one setting with a recurring cast.
- **A stage in Hash Hunt.** If the owner builds that project, a Skiron case whose answer
  feeds a hunt secret is a natural crossover.

---

## What wave 8 hands you (written 2026-09-21, after wave 8)

The list above is a sketch from before any code existed. This section is what
is actually on disk, **audited rather than remembered**: every claim in it was
checked against the source by an independent pass whose job was to refute it,
and several claims the previous version of this file would have made turned
out to be false. Where a source comment and the code disagree, the code is
recorded here and the comment has been fixed.

**Do not start any of this on your own initiative** — the header at the top of
this file still stands. This section exists so that *if* the owner asks, the
first hour is not spent discovering what the last wave left.

### Where the project is

Waves 0–8 done. Wave 8's task 8 — the three owner gates — was offered on
2026-09-21, held, and then asked for the same day. **Skiron is published:**
<https://github.com/taujeszky/Skiron> (public), <https://skiron-e0f.pages.dev>
(live), and the twentieth card in the portfolio catalog. Anything pushed from
here on is published as it is pushed.

963 tests in ~13 s, `npm run check` 0/0 over 526 files, `npm run contrast` 0 of
78 pairs, `npm run offline` PASS. Twelve illustrated cases and two tutorial
lessons ship. (956 and 525 when this section was written; the difference is
the hardening pass at the foot of this file, which started no wave-9 item.)

### Read this first: "one file plus one registry line" is not true

Three places in the repo told you that adding a clue type is a new module plus
one line in `MODULES`, and that nothing outside `engine/clues/` switches on
kind. **That was wave 1's intention and it is false.** All three have been
corrected, but the belief is load-bearing enough to repeat here.

Everything the *player reads* and everything the *model touches* really does
dispatch through the registry — sentences, JSON schema, parse-back, UI, pack
codec. `src/lib/ui/`, `src/lib/game/` and `src/lib/llm/` contain no clue-kind
switch at all. But the **solver and generator switch on kind in seven places**
(the audit said six and missed `enumerate.ts#physical()`, which it listed
separately), and `ClueModule.propagate` — the slot declared in wave 2 to
prevent exactly this — is still `propagate?: unknown` and has never been
filled by any module.

**Closed on 2026-09-21, after this section was first written.** When the audit
ran, only `solver/exhaustive.ts` failed the build for an 18th kind. The
dangerous pair was `solver/rules/tier0.ts` and `solver/rules/tier2.ts`: their
`applyClue` returns `void` and enumerated all seventeen with no `default`, so
TypeScript could not check exhaustiveness, and a new kind would have been
handled by the oracle and **silently ignored by the deduction solver** —
invariant 2's two-solver divergence, arriving as neither a type error nor a
certificate failure, surfacing only as a rise in `unsolvable` rejections in
`npm run sim`, which reads like "the new clue type is not very useful".

All seven now end in a `const unreachable: never` binding, with no change to
what any of them does today. The scatter itself is *not* fixed and is the real
finding; what is fixed is that it is no longer silent. Adding a `Moved` member
to `ClueBody` and nothing else now gives 11 errors in 9 files. That edit is
also how to re-check this paragraph rather than believe it.

CLAUDE.md's "How to add a clue type" has the table and the grep advice
(`grep 'body.kind'` finds three of the seven).

### Item by item

**Daily case.** Smaller than it looks in one way and larger in three.

- The seed side is trivial: `newCaseId(preset, seed)` in `engine/caseId.ts` is
  pure and takes the seed as an argument precisely so `engine/` stays free of
  entropy. `util/entropy.ts` is the *randomness* helper, not a clock — it
  contains no clock at all. The clock seam is `controller.ts#useClock`, which
  returns epoch milliseconds.
- **There is no date handling anywhere in the app.** A grep for `new Date`,
  `Date.parse`, `toISOString`, `getTimezoneOffset` and `Intl.DateTimeFormat`
  returns nothing outside that one line. Turning milliseconds into a stable day
  key, and choosing a timezone and a rollover moment, is all new code with no
  precedent to copy.
- **A daily streak is not already recordable.** `Stats` is
  `Record<PresetName, DifficultyStats>` with no date field at any level, and
  `stats.ts` says in so many words that the existing `streak`/`bestStreak` mean
  "how many in a row have I finished", not a daily thing.
- **The hard one:** a case is a pure function of its id only for as long as the
  generator is unchanged — that is why packs store whole cases. So any tuning
  change silently re-points every *past* daily at a different puzzle. A streak
  history that references old dailies would be referencing cases that no longer
  exist. Shipping pre-authored dailies as a pack avoids it; regenerating them
  from a date does not.

**Confrontation.** The plan says "the engine decides whether the card really
contradicts the statement". **Nothing in the engine does that today**, and the
sentence is a requirement rather than a description.

- The nearest thing is `contradicts(frame, clues)` in `generator/lies.ts` —
  three lines wrapping `solve(..., {lying:false}).contradiction`. It is
  **not exported**, generator-only, and *set-level*: it asks whether a whole
  clue list is jointly refutable, never whether card A collides with statement
  B.
- **The trap that makes the naive version wrong:** with lying on, a testimony
  asserts `s ≠ culprit ⇒ φ`, so a clue set containing the culprit's lie is
  never unsatisfiable — the true world always survives. "Does this card
  contradict that statement" cannot be answered by asking whether the pair is
  satisfiable, because it always is.
- And `solve(...).contradiction` is not a decision procedure: tier 4 is capped
  by `TRIAL_BUDGET` (invariant 10), so `false` means "not proved contradictory
  within the cap", never "consistent". The complete answer is `answers()` from
  `exhaustive.ts`.
- The generator actively *removes* the material for a self-confrontation:
  `Alibi.retracted` deletes the culprit's own true statements that their new
  story contradicts, because a culprit whose two cards refute each other hands
  tier 3 a free win.
- **The guard would kill the feature silently.** `guards.ts#checkReply` rejects
  any reply naming a room, grid code or hour outside a verified sentence, and
  the failure mode is a fallback to the bare card text. A confrontation would
  appear to work and simply never be voiced. Watch `AskOutcome.rejected`, not
  the screen.
- What *is* reusable: tier 3 is exactly the deduction a confrontation
  dramatises, and it already renders — `self-incrimination` and
  `conflict-pair`, with `Premises.assumedInnocent` carrying the hypothesis.
  `ChatTurn` already carries `cards: ClueId[]`, and testimony cards carry their
  speaker in `clue.source.speaker`.

**Hungarian.** Further from done than "the skin has a `language` field"
suggests.

- `CaseSkin.language` is **effectively write-only**: set in `assembleSkin`,
  decoded in `skinStore.ts`, copied into `SkinSummary` — and read by nothing.
  No code branches on it. The only place a language is actually used is the
  *writer* prompt, and that value comes from the CLI flag, not from the skin.
- **The 17 clue template sentences are not in `explain.ts`.** They live on each
  `KindModule` in `clues/{presence,company,counting,victim,rules}.ts`;
  `explain.ts` only delegates. `explain.ts` holds the *deduction* sentences (28
  rule cases) and the default glossary. Sizing the job from `explain.ts` alone
  undercounts it badly.
- **Wave 6's interrogation takes no language at all.** `classify.ts` and
  `voice.ts` build their prompts with no language line, so a Hungarian case
  played in words would be routed and voiced by English prompts. Worse,
  `guards.ts` strips articles with `/^(the|a|an)\s+/i` — the leak guard is
  English-only and says so in its own comment.
- User-visible English is not confined to `.svelte`: `app.html` hard-codes
  `<html lang="en">`, and there are strings in `game/tutorial.ts` (~38),
  `game/errors.ts`, `game/controller.ts`, `game/transfer.ts`, `game/rating.ts`,
  `engine/solver/hint.ts`, and six canned replies in `llm/interrogate/`.
- One thing better than expected: the writer path *is* parameterised end to
  end — `tools/author-case.mjs` has a `--language` flag plumbed into
  `author.ts`. It has never been run with any value but `en`.

**More clue types.** See "Read this first" above. Also: `CLUE_KINDS`' order is
load-bearing (it decides clue ids, invariant 4), `enumerate.ts#physical()` is
currently `kind !== "Together"`, and `exhaustive.ts` tests `DoorClosed` /
`BarredDoor` / `Capacity` by name outside its main switch when folding rule
cards into movement masks.

**Tauri shell.** The claim that browser APIs live behind small modules is
**two-thirds true**.

- Genuinely sealed: `game/storage.ts` is the sole owner of `localStorage` (with
  `memoryStore()` already in place as the non-browser implementation), and
  `llm/idb.ts` is the sole owner of IndexedDB. There is no `sessionStorage` and
  no `crypto.` anywhere in `src/`.
- Also seams, and missing from any list you may have seen: `llm/packLoader.ts`
  (`useFetch`) and `game/cases.ts` (`useLoader`).
- **Leaks.** `controller.ts#applyTheme` calls `matchMedia("(prefers-color-scheme:
  dark)")` directly and retains a `MediaQueryList` with an `onchange` handler —
  `ui/motion.ts` owns only the reduced-motion query. `llm/artStore.ts` mints and
  revokes object URLs — `ui/download.ts` owns only `document.createElement`.
  `ui/App.svelte` is the largest concentration: `navigator.serviceWorker`,
  `location`, `document.visibilityState`, `window` listeners. And
  `src/service-worker.ts` has no Tauri equivalent at all — the whole offline
  story is rebuilt, not swapped.
- `ui/download.ts` and `ui/motion.ts` differ in kind from the other two: they
  have no injection point, so a port rewrites them rather than configuring
  them.
- **Why the leaks existed, and the fix that was worth making first — made on
  2026-09-21.** `engine/purity.test.ts` enforced the discipline **only inside
  `src/lib/engine/`**, and its pattern list predated waves 5–7, so nothing in
  the suite would have caught a new direct `localStorage`, `matchMedia` or
  `createObjectURL` call anywhere in `game/`, `llm/`, `ui/` or `worker/`.
  Both halves are now closed: the engine's list gained `indexedDB`,
  `matchMedia`, `navigator`, `caches`, `ObjectURL`, `sessionStorage`, `fetch(`
  and `new Worker` (none of which has ever appeared in engine code), and
  `src/lib/platform.test.ts` is a second, different guard over everything
  outside the engine.
- **What `platform.test.ts` asserts, and why it is ownership rather than
  absence.** Outside the engine the app is *supposed* to use the browser, so
  each API names the file or files allowed to touch it and every other file
  fails. It also holds the list to account in two directions: an owner that
  stops using its API must be removed from the list (or the entry becomes a
  standing licence nobody re-reads), and the two leaks above are marked
  `leaking` and asserted **by name**, so a third cannot be added quietly and
  a fixed one cannot leave its note behind. Fixing the two is still the Tauri
  port's job and still nobody's until the owner asks.
- Only `.ts` is scanned. `.svelte` is the DOM layer and is meant to touch the
  DOM, and `src/service-worker.ts` is outside `src/lib/`.

**More providers.** The cleanest of the items. All three model paths now have
an injection seam — `useWriteProvider`, `useAskProvider`, `useArtProvider`, all
on `controller.ts` — and there are exactly three sites in `src/` that construct
a real provider, each the false branch of a ternary on its own seam.
`llm/gemini.ts` is the only real implementation; `llm/stub.ts` is the fake.

Two asymmetries to know. The **write seam also stands in for the key** (`
writeProvider === null && !hasKey()`), so an injected writer works with no key
at all; the art and ask seams do **not** — art checks `!hasKey()` and
`canConverse()` gates questions on `hasKey()`, both *before* the seam is
consulted, so a test that injects only a fake provider gets a silent no-op. And
the Node CLIs (`tools/author-case.mjs`, `tools/interrogate-cost.mjs`) construct
providers directly and bypass the controller entirely, so the seams give no
protection there.

### Traps wave 8 left behind, and two it left fixed

Both of these were introduced by wave 8 and found by the audit, not by a test.
They are fixed; they are recorded because the *shape* recurs.

1. **`npm run offline` silently stopped testing the starter pack.** Its step 6
   clicked `button.case`, and the two tutorial lessons carry `class="case
   lesson"` and sit above the shelf. It kept printing PASS, with a case title
   beside it — the title had simply become "A Night at the Fleece". Reading the
   PASS is not evidence. Now `button.case:not(.lesson)`.
2. **`--out` and `--name` defaulted independently in `tools/author-case.mjs`,**
   so the obvious command for illustrating the lessons —
   `--art-only --art --out static/cases/tutorial` — would have rewritten that
   pack's manifest with `"name": "starter"`, silently, because nothing reads
   `manifest.name` on screen. `NAME` now derives from `OUT`.

Still open, and worth knowing before anything outward-facing:

- **A sub-path deploy would break pack loading.** Nothing in `src/` uses
  `$app/paths`; `packLoader.ts` and `controller.ts` build root-absolute
  `/cases/...` URLs. `util/precache.ts` is the only base-path-aware code in the
  repo. The live deploy is at the root of `skiron-e0f.pages.dev`, so this does
  not bite today and both pack manifests were confirmed to load from it — but a
  move to a sub-path, a custom domain with a prefix, or GitHub Pages would
  break the shelf, and nothing in the suite would say so first.
- ~~**`Save.pack`'s validation is non-fatal, unlike every other field in
  `parseSave`.**~~ **Fixed 2026-09-21.** A malformed pack name degraded to
  `undefined` — which does not mean "we did not understand this" but "this is
  a generated case", a different and false statement about the save in hand.
  `resume()` believed it and rebuilt from the generator: the wave-8 resume bug
  re-entered through the back door, and silently, because the player is handed
  a plausible case rather than an error. Present-and-malformed is now fatal
  like every sibling field; absent still means a generated case, which is what
  every save written before wave 8 is.
- **A tutorial case number is a label, not a seed.** `SK1-E-tut1` typed into "A
  case by number" generates a four-suspect Easy case that is not lesson one,
  because the lessons were built with a shape override. Do not let a test
  assume a tutorial id is reproducible from the generator.
- **Any directory dropped under `static/cases/` is automatically enlisted** in
  `shipped.test.ts` (it enumerates directories) and in the service worker's
  precache (`precacheList` filters by extension, not by pack). Good for
  correctness; a half-built scratch pack left there will fail `npm test`.
- ~~`Home.svelte` reads `manifest.name` into `shelfName` and then never uses
  it~~ — **removed 2026-09-21**, with the reason written where the variable
  was: the heading stays the editorial "Cases we wrote", because the starter
  manifest's `name` is the lowercase directory name and "starter" over the
  shelf would be worse. The dead read is why nobody noticed that.
- **Only two of four interrogation classifications reach the voice call.**
  `too_broad` and `accusation` are answered from a canned line after call 1.
  `smalltalk` does reach call 2, with an empty `sentences` list, which
  `guards.ts` treats as the strictest case. Anything reporting a rate over
  "questions" has a denominator that mixes these — the wave-6 lesson about
  what a denominator contains, still live.

---

## The hardening pass (2026-09-21), which is not wave 9

The owner asked for the implementation to continue. Wave 8 is complete but for
its three owner gates, which are held; the list at the top of this file is
optional and says not to start any of it unbidden, and none of it was started.
What was done instead is the set of defects the wave-8 audit recorded above and
left open — work on shipped code, with no new feature and no model call.

- **The seven switch sites all end in `never`.** See "Read this first".
  Behaviour is unchanged: each of the five that gained a `default` had already
  enumerated every kind, so the new arm is unreachable today and is a build
  failure tomorrow. The two that had a `default` returning a value keep the
  same answers, now written out.
- **`Save.pack` is fatal when present and malformed.**
- **A second purity guard, `src/lib/platform.test.ts`**, over everything
  outside the engine. See "Tauri shell".
- **Three stale doc comments repaired** where the code and the comment
  disagreed: `clues/index.ts`, `types.ts`'s `ClueModule` header, and
  `ClueModule.propagate`, which now says outright that it has never been
  filled and why one `propagate` per kind is the wrong shape — a propagator
  belongs to a kind *at a tier*, and `Together` is split across tiers 0 and 2
  on purpose, because the two-person argument is what makes a case Normal.
- **`Home.svelte`'s dead `shelfName` removed.**

**Every guard added here was proved to bite before it was believed**, which is
this repository's oldest lesson and the reason the suite is worth anything: an
18th clue kind planted in `ClueBody` (11 errors, 9 files, the seven sites among
them); the old lenient `Save.pack` branch put back (the new test fails, naming
the value it should have refused); a `localStorage` call planted in
`game/rating.ts` (`platform.test.ts` fails and names the file, the line and the
owner). Each was then restored by copying a file back, never by `git checkout
--`, which is the restore that has twice destroyed other uncommitted work here.

963 tests, `npm run check` 0/0 over 526 files.
