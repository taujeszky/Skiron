# Wave 8 — Ship

**Goal.** Skiron is something a stranger can open, understand, enjoy and install, and it
is documented to the standard of its siblings.

**Prerequisites.** Waves 0–7.

**Size.** Medium.

## Tasks

1. **Tutorial case.** Hand-authored and tiny — three suspects, four rooms, four slots, no
   lying — with coach marks that teach the loop: examine, ask, pencil-mark, deduce, accuse.
   A second short lesson introduces lying and the idea of clearing someone to trust them.
   Both are verified by the same pack test as every other case.
   *Done, with three corrections the code forced. **(a)** Lesson two needs **five** slots,
   not four: with lying on, a four-slot case has nowhere for a false alibi to live and the
   trust tier never fires, so it graded below the floor every time. Three suspects and four
   rooms held. **(b)** "The idea of clearing someone to trust them" is **not a rule you can
   point at.** The solver's only two tier-3 rules are `self-incrimination` and
   `conflict-pair`; trust is the mechanism underneath them
   (`solver/state.ts#trustedMask`), and it becomes visible only as the *payoff* of a
   tier-3 step — a cleared suspect's card suddenly being worth something. The seed chosen
   for lesson two shows exactly that in four consecutive trace steps, which is the nearest
   this can get to teaching it directly. **(c)** The coach marks are a **strip of text that
   reads the game state**, not a spotlight over a button: a spotlight needs every step to
   name a live DOM node, which ties the lesson to the markup of four components and breaks
   silently when one is rearranged — and the UI is not tested, so nothing would catch it.
   `game/tutorial.ts` argues it at length.*
2. **Balance pass.** Rerun `npm run sim`, play several cases at each difficulty, and
   adjust presets, par and the clue-type mix. Record the final table.
   *Done, and **nothing was adjusted** — which is a result rather than a shortcut. 1200
   cases over four presets reproduced wave 3's table at two and a half times the sample,
   with zero certificate failures; `npm run par` over 160 fresh cases reproduced wave 4's
   undirected means to the decimal (19.2 / 31.1 / 38.1 / 57.0). Both tables are in
   ARCHITECTURE section 9. The one number worth arguing about is that **Expert delivers
   Expert 29% of the time**, matching wave 7's 27%. Rather than argue, the alternative was
   priced: with `expert.tier.min` raised to 4 every case still generates and every
   certificate still passes, so a true Expert case is rare rather than hard to find — but
   the p95 goes from 995 ms to 3322 ms and the worst case from 1442 ms to 3985 ms, on a
   laptop, for the slowest preset on the slowest device. Left alone, and the complaint —
   which is about the button, not the case — is answered on the home screen instead.*

   ***What this task did NOT settle.*** *The handoff gave the balance pass two jobs and
   only one of them is done. The generator numbers are measured. But "nobody has solved a
   case in words" — item 3 of CLAUDE.md's "How it plays", the question of whether wave 6's
   free-text interrogation actually makes Expert's 146-question cast list bearable — is
   **still unmeasured**, because answering it needs either a person playing or a paid live
   run, and the paid run is an owner gate that has not been asked for. It should not be
   read as settled. Item 4 of that list was measured and is confirmed: the Expert notebook
   wants 759 px and gets 719 on a 1440-wide laptop, 639 at 1280 and 390 on a phone, so it
   scrolls horizontally at every width. Forty pixels would buy the largest laptop and
   nothing else, which is not worth a layout change that could cost the phone — wave 4's
   "inherent, not a bug" holds, now with numbers.*
3. **Accessibility.** Keyboard access to everything, visible focus, ARIA labels on the map
   and grid, room codes as well as colours, reduced-motion handling for the replay,
   contrast in both themes.
   *Done, and four of the six were genuinely missing rather than partly there. **The map's
   room buttons were announced as nothing:** the plan carried `role="img"`, which makes an
   element a leaf in the accessibility tree, so the `role="button"` on each room was never
   exposed — they were keyboard-focusable the whole time and silent. The role is now
   conditional: a picture on the briefing and the summary, a group of buttons where there
   is something to click. **The replay is a `setInterval`,** which no `@media
   (prefers-reduced-motion)` block can reach; the two CSS animations were already guarded
   and the one the plan named was not. **Every toggle-shaped button said nothing about its
   state** — the pane tabs, the cross-out/place modes and both of the accusation's radio
   groups showed the selection as a colour and nothing else. And **contrast was measured
   rather than judged**, which found seven failures in the light theme and three in the
   dark. `npm run contrast` is now a tool: 78 pairs, both themes, exits non-zero. The one
   that matters most is that a crossed-out room code — the single most-read thing in the
   game — was rendering at 2.26 with a further `opacity: 0.55` on top of it.*
4. **Icons.** Adapt Signpost's `scripts/gen-icons.mjs`; keep the ink inside the maskable
   safe zone.
   *Already done in wave 0 and verified here rather than rebuilt: the ink reaches r=33.3%
   against a 40% limit, the manifest declares a maskable 512, and re-running the generator
   produces byte-identical files — which is the check worth doing, because it proves the
   PNGs on disk are the ones the script makes.*
5. **Errors people will actually hit:** no key, quota exhausted, blocked content, offline
   during generation. Each gets a plain sentence and a way forward (usually: play a pack
   case).
   *Done. The plain sentences turned out to exist already, from wave 5, and the writing
   path was not using them: `dressCase`'s catch put `err.message` on screen, so a quota
   failure showed the provider's raw JSON. Two things follow from that. The **way forward
   is not "play a pack case"** — the case that just failed to be written is itself built,
   certified twice and on screen, so the right sentence is that this one is ready. And the
   raw message was **unscrubbed**, so a provider that put the request URL in its error
   text would have printed the player's own key on the screen; `LlmError.from` scrubs, and
   a test now holds it. The bug survived three waves because the writing path was the one
   of the three model paths with no test seam — `useWriteProvider` is the fix for that,
   and `game/writing.test.ts` drives it.*
6. **Export and import** a whole case as a file, so a generated case can be shared with
   its prose. The key is never part of it.
   *Done, in the pack format rather than a second one — `llm/pack.ts` already encodes a
   whole case with its skin and handles the four containers `JSON.stringify` drops. Three
   things the task statement did not say. A file is the **one way a case reaches a player
   with nobody having certified it** — a shipped pack is proved by the authoring tool and
   again by `shipped.test.ts`, a generated case twice as it is made — so `importCase`
   re-runs `verifyPack` on the way in and refuses a file whose evidence does not prove the
   answer it claims. The **pictures are dropped and the file says so**, because
   `CasePack.images` lists keys and not bytes; monograms are the honest default and cost
   nothing. And the **progress is dropped too**: this shares a case, not a save, and a
   half-solved export would hand over the answer in the shape of the marks.*
7. **Docs.** Finish `docs/ARCHITECTURE.md`. Rewrite `README.md` from the plan-phase
   version into the siblings' shape: pitch, what makes it different, controls, development,
   how it works. Bring `CLAUDE.md` up to date, including a "How to add a clue type"
   section.
   *Done. ARCHITECTURE gains section 14; CLAUDE.md gains the clue-type walkthrough, three
   new gotchas and a rewritten state section. The README was rewritten first, before
   anything else in the wave, because task 8 builds a public repository around it — and
   **its controls table was wrong on the first pass**: there is no right-click in the
   notebook, crossing out is the default mode and a double-click is what places. Written
   from memory, corrected by reading `Grid.svelte`. This plan file's own opening said
   "Nothing is built yet" too, and now says what it actually is: the design as written,
   kept as written, with every correction recorded in the wave file rather than edited
   out from under itself.*
8. **With the owner's go-ahead:** create `github.com/taujeszky/Skiron` and push; final
   deploy; then add Skiron to the portfolio catalog — a `PROJECTS` entry in
   `../index.html` (that file has very long lines; read it in slices) and card art through
   `../catalog-art`.
   ***Asked and held on 2026-09-21, then done the same day when the owner asked for it.***

   *Held first: offered all three (repo, deploy, catalog), repo-and-deploy, repo-only, or
   hold, they chose **hold all three** — the second time they deferred a deploy rather
   than publish before they were ready, the first being the end of wave 4, which is how
   the deploy came to be wave 8's at all. Then, later the same day: "okay for now finish
   wave 8, task 8 please". All three are done.*

   - ***Repository:** <https://github.com/taujeszky/Skiron>, public, 297 files. The
     pre-flight was re-run rather than trusted — a repository is not un-published. No
     `.env` is tracked, `.claude/` is ignored, and the only key-shaped strings are two
     deliberately fake constants in the tests that prove the scrubber works. Both were
     compared against the real key on disk (they differ), and **the real key was searched
     for across all 55 commits, not just the working tree** — a key deleted in a later
     commit is still public. It appears in none.*
   - ***Deploy:** <https://skiron-e0f.pages.dev>. `wrangler pages project create skiron
     --production-branch main` first, because `pages deploy` would otherwise prompt for it
     and this shell is non-interactive. 134 files. Verified as the deployed site and not
     as a local build: `/`, `/service-worker.js`, `/cases/starter/manifest.json` and
     `/cases/tutorial/manifest.json` all 200, then **`npm run offline -- --url
     https://skiron-e0f.pages.dev/`**, which installed the worker, cut the network, and
     generated and played a case at all four difficulties before opening a shipped case
     in its own words. The root-absolute `/cases/...` URLs noted in
     `wave-9-beyond.md` are fine here because this is a root deploy; they would still
     break a sub-path one.*
   - ***Catalog:** a `PROJECTS` entry in `../index.html` (20 now) and card art through
     `../catalog-art` — one `gemini-3.1-flash-image` call, about $0.05, approved
     beforehand as the fourth gate requires, usable first time. The first draft of the
     entry was **453 characters against a sibling average of 282**, which is how the house
     voice gets diluted one entry at a time; measured against the other four puzzle cards
     and cut to 292. `../index.html` and `../catalog-art/` are **not under version
     control**, so those edits are not in any commit.*

## Exit criteria

- A first-time visitor on a phone can finish the tutorial and an Easy case without help.
  *Checked at a real 390x844 viewport over CDP: no horizontal overflow on the home,
  briefing or investigate screens, the tutorial's notebook fits without horizontal
  scrolling, and the coach strip advances from "examine" to "ask" to "mark" as the rooms
  are searched and the questions asked. With the preview server **stopped** — not
  emulated offline, which does not cut the service worker — the desk came back from
  cache, both lessons were offered, and lesson one opened with its prose. `npm run
  offline` generates and plays all four difficulties with the plug out.*
- `npm test`, `npm run check` and the pack test are green, and the sim table is recorded.
  *956 tests, check 0/0 over 525 files, and `npm run contrast` at 0 of 78 pairs, which is
  new. Both the sim and par tables are in ARCHITECTURE section 9.*
- README, CLAUDE.md and ARCHITECTURE.md describe the project as it is. *Done.*

**The wave is complete.** Task 8's three owner gates were offered on 2026-09-21, held, and then asked for and done the same day: the repository is public, the site is deployed, and Skiron is the twentieth card in the catalog. The one thing still left open is named under task 2: **nobody has yet solved a case in words**, and saying so is not the same as having measured it. Shipping did not settle it and should not be read as having done so.

---

## What waves 5, 6 and 7 hand you (written 2026-09-21, BEFORE wave 8 started)

> **This section is history, not instructions.** It was written at the end of
> wave 7 to brief wave 8, and wave 8 has since happened. Everything it tells
> you to do has been done; what it got right and wrong is recorded in the task
> notes above and in ARCHITECTURE section 14. It is kept because the *reasoning*
> in it — how each question was sized before it was answered — is the useful
> part, and because editing a briefing after the fact hides whether it was any
> good. **Do not act on it.**

The tasks above were written before any of the code existed. This is what is
actually on disk, checked in the repository rather than remembered, and what
each task will run into. `docs/ARCHITECTURE.md` sections 11, 12 and 13 have
the designs; this is only the parts that change wave 8's work.

**This is the wave that makes Skiron public**, and three of the four owner
gates in CLAUDE.md are yours: the GitHub repository, the first Cloudflare
deploy, and the portfolio catalog entry. Nothing is published and no
Cloudflare project exists. The fourth gate, paid API calls, has been used
three times and the pattern is in ARCHITECTURE: bring a measured number, they
answer with a ceiling.

*Written at the start of the wave, kept as written. All three gates were used
on 2026-09-21 — task 8 below has the record. **The consequence that outlives
this file:** a case id is now something a stranger can hold, so bumping
`CASE_ID_VERSION` is no longer free. See ARCHITECTURE section 9.*

### Read this before anything else — *done, first thing in wave 8*

**`README.md` still says "Design phase — no code yet."** It has said that
since before wave 0 and it is the first thing a stranger sees — and task 8
creates a public repository around it. It is 52 lines, was written as a pitch
for a plan, and is otherwise good: the idea, the eight rules and the stack are
all accurate. Only the Status section and "Planned stack" are lies now. Fix it
before the repository exists, not after.

*Rewritten at the start of wave 8, into the siblings' shape. One thing to
learn from: the controls table in the first draft was **wrong**, because it
was written from memory — it claimed a right-click crosses a room out, when
there is no right-click in the notebook at all, crossing out is the default
mode and a double-click is what places. Reading `Grid.svelte` caught it. A
README describes behaviour, so it has to be written from the code like
anything else.*

### Task 1, the tutorial case: the one real design decision

"Three suspects, four rooms, four slots" is **smaller than any preset**. Easy
is 4 suspects, 5 rooms, 5 slots, and `generate(id)` takes its shape from
`presetFor(id.preset)` — `GenerateOptions.select` overrides the *clue mix*
only, never the shape. So there are two routes and they are not close in cost:

- **A fifth preset.** `PRESET_LETTERS` in `caseId.ts` is deliberately the one
  place a preset becomes a letter, so that part is clean. But `PresetName` is
  a union threaded through **thirteen non-test files**, `Stats` has a record
  per difficulty that `parseStats` reads back off disk, and `Home.svelte` and
  `StatsScreen.svelte` both enumerate. A tutorial is not a difficulty anybody
  should have a best time in.
- **A hand-built pack file.** A pack already stores the whole case rather than
  a seed — the documented exception to invariant 4 — so a tutorial case does
  not need to be regenerable from its id at all. It needs a `CaseId` that
  `parseCaseId` accepts (the id is a label and a save key; nothing rebuilds a
  pack case), and it needs `verifyPack` to pass, which re-runs the oracle and
  the tier. Add a shape override to `GenerateOptions` beside `select`, or
  build the `GeneratedCase` directly.

The second is much the smaller change and fits what a pack already is. Either
way the tutorial ships as a pack file and `shipped.test.ts` proves it on every
`npm test` like the other twelve.

*Taken: the pack, with a `shape` override added to `GenerateOptions` beside
`select`. `npm run tutorial` builds both lessons — deterministic, offline and
free, because the skin carries names and no per-clue prose, so every card
falls back to the engine's own sentence rendered in the tutorial's names. That
is the right register for a lesson anyway: uniform, predictable, and nothing a
model could get wrong because no model was asked.*

*Two things this turned up that the analysis above did not predict.* **A
shipped case could not be resumed.** `Save` held only the id, so "Carry on"
rebuilt a pack case from its id — which is precisely what `pack.ts` says must
not be relied on — and the prose and pictures that came in the file were
silently dropped. `Save.pack` fixes it and `game/resume.test.ts` pins it, for
all twelve shipped cases and not only the tutorial. *And* **stats needed the
same guard the fifth-preset route would have needed:** `recordStart`,
`recordSolve` and `recordAbandon` all had to learn to skip a lesson. The
objection to a fifth preset — "a tutorial is not a difficulty anybody should
have a best time in" — was never really about the preset.

Two things that follow. The pack directory is `static/cases/starter/` and its
manifest is **derived from the files beside it**, not from what a run wrote —
so a tutorial case dropped in there is picked up automatically and will appear
in the home screen's browser, which may not be what you want for a lesson.
And a tutorial case can have art: `npm run author -- --art-only --art --case
<id>` draws pictures for a pack that already exists without touching its
prose.

### What is already done, or nearly

- **Task 4, icons.** `scripts/gen-icons.mjs` exists and has since wave 0; the
  four icons are in `static/` and the service worker precaches them
  deliberately (they are the one image exception). Check the maskable safe
  zone; do not rebuild the script.
- **Task 5, errors — and there is a real bug here.**
  `llm/errors.ts#llmErrorMessage` already turns all seven `LlmError` kinds
  into plain sentences: `no-key`, `bad-key`, `quota`, `blocked`, `malformed`,
  `cancelled`, `network`. **It has exactly one caller** —
  `controller.ts:1128`, the note added to a transcript when a typed question
  fails. The writing path does not use it: `dressCase`'s catch
  (`controller.ts:633`) does `err instanceof Error ? err.message : String(err)`
  and puts *that* on screen, so a quota failure while writing a case shows the
  provider's raw message. Wave 7 saw what that looks like from the CLI — a
  200-character JSON blob with `@type` and `domain` in it. The nice sentences
  exist and the most visible path does not use them. `controller.ts:451`, the
  case-*building* failure, is the same shape but is not an `LlmError` at all.

  What is genuinely not done is the "way forward" half of the task: none of
  the seven says "play one of the twelve cases that shipped with the site",
  which is a much better suggestion now than when there were three.
- **Task 3, accessibility.** Further along than a fresh reading suggests, and
  not systematic. Room codes are always shown beside colour (`look.ts` says
  why, and names the reason: a fifth of players cannot tell `--p1` from
  `--p4`). There are ARIA labels and roles in `Investigate`, `Plan`, `Grid`
  and `Evidence`. `prefers-reduced-motion` **is** handled, in `App.svelte` and
  `CardView.svelte` — check whether that covers everything that moves rather
  than assuming it does or that it is missing. Nothing has been audited end to
  end, and the new art is `<img alt="">` on purpose: the name is already
  beside it and a screen reader saying it twice is worse than a picture going
  unmentioned.
- **Task 7, docs.** `ARCHITECTURE.md` is 13 sections and current through wave
  7, including what each paid run actually found. `CLAUDE.md` is current. The
  "How to add a clue type" section does not exist; the 17 kinds live behind
  one registry in `engine/clues/` with a schema derived from field domains
  per kind, which is the thing to describe.

### Task 6, export and import: most of it exists

`llm/pack.ts` already encodes and decodes a whole case with its skin —
`encodePack`/`decodePack`, with the four containers `JSON.stringify` would
drop handled explicitly and round-tripped in `pack.test.ts`. A generated case
is not stored as a pack today, but making one is `packFor(id, case, skin,
images)`.

Two things to get right. **The key is never part of it** — it is not in
`Settings` and not in a skin, so this is a matter of not adding it. And
`CasePack.images` lists subject keys, not bytes: an exported file cannot carry
its pictures unless you inline them, so either drop the images on export and
let the recipient see monograms, or say in the file that they are missing.
Monograms are the honest default and cost nothing.

### Task 2, the balance pass: two numbers that will surprise you

**27% of expert-preset seeds actually grade expert.** The preset is a request;
`difficulty` comes from `playTier`. Wave 7 generated three Expert cases for
the pack, got three Hards, and had to search the seed space. If the balance
pass moves the tier bounds or the clue mix, that ratio moves with it — and a
preset that rarely delivers its own grade is worth treating as a finding
rather than as noise. A sixty-seed sweep takes one engine-only pass, no key
and no money.

**Nobody has solved a case in words.** Wave 6's free-text interrogation routes
correctly (182/182 on scripted phrasings) and releases identical cards to the
picker, so Expert's 146-question cast list *can* be skipped — but whether a
person actually plays that way, and whether it is more pleasant than scanning
the menu, is unmeasured. That is item 3 of the "How it plays" list in
CLAUDE.md and it is the balance pass's job to settle it, not to assume it.

Item 2 of that list is untouched and is a real design question: solving by
hints alone takes 17 to 86 presses.

### One decision wave 7 deliberately left to you

**Whether to precache the pack's 1.40 MB of art.** Today the twelve cases'
JSON is precached and their pictures are not, so every case opens and plays
offline from a cold start with monograms, and keeps its pictures once seen.
That is what task 8 of wave 7 asked for — "so the install stays light" — and
it means wave 7's own exit criterion, "a keyless visitor can play twelve
illustrated cases offline", holds only after first view.

Flipping it is one line in `lib/util/precache.ts` and costs 1.40 MB on a first
visit, against an app that is currently about 1.5 MB. The argument against is
that a visitor who plays one case pays for eleven they never open; the
argument for is that "illustrated offline" is a nicer promise and 1.4 MB is
not much. Measure the first-load time both ways before deciding.

### Traps that cost wave 7 time, in the order they will bite

1. **`npm run offline` reuses a Chrome profile**, so a stale service worker
   survives between runs and the run silently tests the *previous* build. The
   tell is in its own output: the cache name carries the build's version
   stamp. Delete `%LOCALAPPDATA%/Temp/skpt<port>`. This bit twice in one
   session, and it is a third member of the stale-preview family already in
   CLAUDE.md's gotchas.
2. **`Network.emulateNetworkConditions` cuts the page's network, not the
   service worker's.** They are separate targets. A check "proved" that a case
   nobody had opened had its pictures offline, which is impossible. To ask
   what is really cached, ask `caches.match()`; to really cut the network,
   stop the server.
3. **A string search of a generated file is not evidence about what it does.**
   `build/service-worker.js` computes its precache list at runtime from
   inlined arrays, so grep finds the raw manifest and answers a different
   question.
4. **A prohibition cannot beat a description.** Wave 7's central lesson, and
   it is about prompts in general rather than about images: five portraits
   came back holding objects because the *writer's own prompt* asked for them,
   and a list of "do not"s appended after the subject clause loses to it.
   Anywhere wave 8 adds an instruction to an existing prompt — the tutorial's
   coach marks, a new error message, a rewritten style guide — check whether
   something earlier in that prompt is asking for the opposite.

### The shape of the thing you are shipping

900 tests in about 13 seconds, `npm run check` at 0/0 over 515 files. Twelve
illustrated cases, three at each difficulty, 1.40 MB of art and 0.27 MB of
JSON. A case can be generated offline in a worker, dressed by a model whose
every sentence is checked before it is shown, questioned in free text by a
model that is never told the answer, and illustrated by one that is never
asked to say anything at all.

The honest gaps, all of them already written down: nobody has solved a case in
words; the hint panel is one deduction at a time; Expert's notebook needs
horizontal scrolling on a laptop; and the README says there is no code.
