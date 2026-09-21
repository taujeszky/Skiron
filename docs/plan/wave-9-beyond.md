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

Waves 0–8 done, except wave 8's task 8, which is three owner gates — the
GitHub repository, the first Cloudflare deploy, the portfolio catalog entry.
They were offered on 2026-09-21 and the owner chose to **hold all three**.
Nothing is published. That is a decision, not an omission; do not re-ask
without being asked to.

956 tests in ~13 s, `npm run check` 0/0 over 525 files, `npm run contrast` 0 of
78 pairs, `npm run offline` PASS. Twelve illustrated cases and two tutorial
lessons ship.

### Read this first: "one file plus one registry line" is not true

Three places in the repo told you that adding a clue type is a new module plus
one line in `MODULES`, and that nothing outside `engine/clues/` switches on
kind. **That was wave 1's intention and it is false.** All three have been
corrected, but the belief is load-bearing enough to repeat here.

Everything the *player reads* and everything the *model touches* really does
dispatch through the registry — sentences, JSON schema, parse-back, UI, pack
codec. `src/lib/ui/`, `src/lib/game/` and `src/lib/llm/` contain no clue-kind
switch at all. But the **solver and generator switch on kind in six places**,
and `ClueModule.propagate` — the slot declared in wave 2 to prevent exactly
this — is still `propagate?: unknown` and has never been filled by any module.

Only **one** of the six fails the build for an 18th kind:
`solver/exhaustive.ts`, which ends in `const unreachable: never = b`. The
dangerous pair is `solver/rules/tier0.ts` and `solver/rules/tier2.ts`: their
`applyClue` returns `void` and enumerates all seventeen with no `default`, so
TypeScript cannot check exhaustiveness. A new kind would be handled by the
oracle and **silently ignored by the deduction solver** — invariant 2's
two-solver divergence, arriving as neither a type error nor a certificate
failure. It surfaces only as a rise in `unsolvable` rejections in `npm run
sim`, which reads like "the new clue type is not very useful".

CLAUDE.md's "How to add a clue type" has the table and the grep advice (four of
the six are written `switch (b.kind)`, so grepping `body.kind` misses them).

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
- **Why the leaks exist, and the fix worth making first:** `engine/purity.test.ts`
  enforces the discipline **only inside `src/lib/engine/`** — its root is the
  engine directory. Nothing in the suite would catch a new direct
  `localStorage`, `matchMedia` or `createObjectURL` call added anywhere in
  `game/`, `llm/`, `ui/` or `worker/`. Its pattern list also predates waves 5–7
  and does not mention `indexedDB`, `matchMedia`, `navigator`, `caches` or
  `createObjectURL`. Widening the root without widening the patterns would give
  false confidence.

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
  repo. Fine for a Cloudflare Pages root deploy, broken anywhere else.
- **`Save.pack`'s validation is non-fatal, unlike every other field in
  `parseSave`.** A malformed pack name degrades to `undefined` — meaning "a
  generated case" — rather than discarding the save, so a corrupt value
  silently changes *which case you resume* instead of failing loudly.
- **A tutorial case number is a label, not a seed.** `SK1-E-tut1` typed into "A
  case by number" generates a four-suspect Easy case that is not lesson one,
  because the lessons were built with a shape override. Do not let a test
  assume a tutorial id is reproducible from the generator.
- **Any directory dropped under `static/cases/` is automatically enlisted** in
  `shipped.test.ts` (it enumerates directories) and in the service worker's
  precache (`precacheList` filters by extension, not by pack). Good for
  correctness; a half-built scratch pack left there will fail `npm test`.
- `Home.svelte` reads `manifest.name` into `shelfName` and then never uses it —
  the heading is the literal "Cases we wrote". That is why nobody noticed the
  starter manifest's `name` is the lowercase directory name.
- **Only two of four interrogation classifications reach the voice call.**
  `too_broad` and `accusation` are answered from a canned line after call 1.
  `smalltalk` does reach call 2, with an empty `sentences` list, which
  `guards.ts` treats as the strictest case. Anything reporting a rate over
  "questions" has a denominator that mixes these — the wave-6 lesson about
  what a denominator contains, still live.
