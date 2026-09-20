# Wave 7 — Portraits, scene art and the starter pack

**Goal.** Every case has a face for each person and one establishing image, generated
from the writer's prompts in a single consistent style — and the site ships a starter pack
so that a visitor without a key gets the full experience.

**Prerequisites.** Wave 5 (wave 6 is independent). Read Zephyr's image pipeline and
quality setting, and catalog-art for Node-side generation and WebP conversion.

**Size.** Medium, plus one paid generation pass.

## Tasks

1. **`llm/art/`.** Build image prompts from the skin's `styleGuide` plus each portrait
   prompt, under one fixed house treatment so that cases look like one game. For
   consistency within a case, check how Zephyr handles it; if the image model accepts a
   reference image, pass the first portrait when generating the rest.
2. **Quality setting**, as in Zephyr: off, fast, balanced, beautiful, with the model id
   derived from it in `llm/models.ts`.
3. **Fallback avatars.** Deterministic SVG monograms with a per-person palette, used when
   art is off, missing, blocked or still loading. The game never waits on an image.
4. **Runtime.** Generate after the case is playable, in the background, portraits first.
   Store blobs in IndexedDB keyed by case and person. Show the expected number of image
   calls before starting.
5. **No facts in images.** The floor plan stays engine-drawn SVG. The scene image is an
   exterior or atmosphere shot. Prompts ask for no text, no clocks and no readable
   documents, since an image cannot be fidelity-checked.
6. **CLI.** `tools/author-case.mjs` gains `--art`: generate, convert to WebP with `sharp`
   (use the version that already works in `../catalog-art` on this machine), portraits at
   512 px, written beside the case JSON.
7. **Starter pack.** Twelve cases, three at each difficulty, across at least three
   settings. **Tell the owner the call count and get a yes first.** Then review every case
   by eye: names, tone, portraits, fallback rate.
8. **Service worker.** Precache the pack's JSON; cache its images on first view, so the
   install stays light (*starting point*: about 3–4 MB of images in total).

## Tests

- Prompt builder output contains the style guide and the no-text instruction.
- Fallback avatars are deterministic.
- The pack test from wave 5 now also checks that every referenced image exists.

## Exit criteria

- A keyless visitor can play twelve illustrated cases offline.
- A visitor with a key gets portraits for a freshly generated case without the game ever
  blocking on them.

---

## What waves 5 and 6 hand you (written 2026-09-20, before wave 7 starts)

The tasks above were written before any of the LLM layer existed. It exists
now. This is what is actually on disk, what has never been run, and the traps
that are not guessable from the task list. Everything below was checked in
the repository rather than remembered.

### The money, first, because it decides the shape of task 7

Task 7 asks for **twelve cases, three at each difficulty**. The cast sizes are
4, 5, 5 and 6 suspects plus the victim, so that is 15 + 18 + 18 + 21 = **72
portraits, plus 12 scene images = 84 images**. `models.ts` records
`gemini-3.1-flash-image` at **$0.045 to $0.151 an image** depending on
resolution, so the pack alone is **$3.78 at best and $12.68 at worst**, before
the nine extra cases have been written (about $0.02 each).

The owner has twice set a ceiling of **$5** — for wave 5 (spent ~$1) and wave
6 (spent ~$0.60). So this is the first wave whose plan, taken literally, is
likely to *exceed* what they have been willing to spend, and the estimate is
not a formality. Bring them the arithmetic and the levers rather than a
yes/no: fewer cases, portraits at the cheaper resolution, portraits for
suspects only and not the victim, one scene per *setting* rather than per
case. Do not quietly shrink the pack instead — the size is their call.

`PRICES` in `models.ts` has no entry for either image model, because images
are priced per picture rather than per token. The estimate path needs its own
arithmetic; do not try to force images through the token estimator.

### What exists and has never been run

`llm/gemini.ts#generateImage` is written and says so in its own comment:
"**Unexercised**: no image has been generated through this path, and wave 7
should treat it as a draft rather than as working code." Nothing in `src/` or
`tools/` calls it — the only references are its definition, the `Provider`
interface and the stub. So the first thing wave 7 does should be one image,
by hand, through that function, before anything is built on top of it.

`stubProvider({ image })` returns fixed bytes for every prompt and throws
`blocked` when no image is configured, so the whole pipeline above the seam
can be built and tested with no key, exactly as waves 5 and 6 were.

The skin has carried the material since wave 5, written by the same hand that
named everything, which is the point. `skin.people[p].portrait` (a prompt per
person) and `skin.scene` (one prompt for the place) have **never been read by
anything**. `skin.styleGuide` has one existing reader — `prompts.ts` puts it
into the summing-up prompt as `STYLE:` — so changing what the writer is asked
for there moves the detective's closing speech as well as the pictures.

**`sharp` is not a dependency of this project, and it does work on this
machine.** `../catalog-art/node_modules/@img/sharp-win32-arm64` is present, so
the native binary exists for win32-arm64 — which is worth knowing up front
given that `wrangler`'s `workerd` has no such binary and is the reason
`npm install` here needs `--ignore-scripts`. Pin what catalog-art pins
(`sharp@^0.34.4`), and remember that adding any dependency here means
`npm install --ignore-scripts --legacy-peer-deps` followed by
`node scripts/patch-workerd.cjs`.

### The trap that will cost the most: the service worker already caches them

Task 8 says "precache the pack's JSON; cache its images on first view, so the
install stays light". The default behaviour is the **opposite**, and it is
already in effect. `service-worker.ts` builds its list as
`ASSETS = [...build, ...files]`, and `files` from `$service-worker` is
everything under `static/` — the built worker in `build/` lists
`cases/starter/SK1-E-0.json` and its siblings today, unasked. Put a `.webp`
under `static/` and it joins the install payload automatically.

So task 8 is a **subtraction**: filter the images out of `ASSETS` and let the
runtime fetch handler cache them on first view. Check the built
`build/service-worker.js` for the image paths afterwards rather than assuming
the filter worked — that file is generated and is the only honest evidence.

And check the install size the same way. 84 images at 512 px WebP is roughly
2.5 to 5 MB, which is the plan's "3–4 MB" *starting point* and should be
replaced with a measurement.

### Six more things that will bite

1. **A second IndexedDB store needs a version bump AND a wider `run`.**
   `llm/skinStore.ts` opens `DB_NAME = "skiron"` at `DB_VERSION = 1` with one
   object store, `"skins"`, and `run()` hard-codes that name in
   `db.transaction(STORE, mode)`. Task 4 wants blobs keyed by case and
   person, which is a second store: bump the version or `onupgradeneeded`
   never fires and the store is never created, and parameterise `run` or
   every image transaction opens the wrong one.
2. **`parseManifest` silently drops fields it does not name.** If a
   `PackEntry` gains an `images` count or a path, `pack.ts#parseManifest`
   must be taught it or it vanishes on the way in with no error anywhere.
   Exactly the same trap as `Save.chat` and `parseSave` in wave 6, and
   `parseSettings` before that. Whenever a stored shape grows a field, find
   its parser in the same commit.
3. **The fallback avatar mostly exists already.** `ui/Token.svelte` draws a
   person as a coloured coin with a letter, from `ui/look.ts#personColor`
   (`var(--p{p % 8})`, the victim in `--victim`) and `#personGlyph` (A–H, a
   dagger for the victim). Task 3's "deterministic SVG monograms with a
   per-person palette" is that, plus initials from the skin's names. Extend
   it; a second avatar component would be a second thing to keep in step with
   the map, the grid and the cast strip.
4. **The game must not wait on an image, and the writing path is the example
   of what not to copy.** `controller.ts#open` does
   `next.skin = await dressCase(...)` and only then `showGame(next)` — the
   prose is awaited on purpose, because names changing under a player
   mid-sitting would be worse than a longer wait. Art is the other way round:
   it goes **after** `showGame`, in the background, and every screen renders
   from the fallback until a blob arrives.
5. **`verifyPack` does not look at images, and the plan's third test says it
   should.** `pack.ts#verifyPack` re-runs the oracle, the tier and the prose
   coverage; `shipped.test.ts` runs it over every file on every `npm test`.
   Add the image check there, and note that `shipped.test.ts` finds cases by
   `readdirSync(...).filter(name => name.endsWith(".json"))`, so `.webp`
   files beside them are ignored and a subdirectory is fine.
6. **`*.live.test.ts` is excluded from `vitest.config.ts`, not merely absent.**
   That line is a spending guard: `npm test`'s include pattern matches
   `.test.ts` and made three unintended calls the first time such a file
   existed. An image live test belongs there, under `npm run test:live`, and
   an image call costs a hundred times what a text call does.

### The thing wave 7 should be most careful about

**An image cannot be fidelity-checked.** Every other piece of LLM output in
this project is verified before a player sees it — the writer's prose by a
second model reading it back, a suspect's reply by arithmetic. A picture has
no such check and never will, which is why task 5 exists and why it is the
one task here that is an invariant rather than a feature. The floor plan stays
engine-drawn SVG; the scene is exterior or atmosphere; the prompts forbid
text, clocks and readable documents. A portrait that shows somebody holding a
letter is a fact the engine never asserted, and nothing downstream can catch
it.

The corollary worth stating: **do not let an image be evidence.** If a
portrait is ever shown beside a card, or a scene beside a clue, a player will
read it as saying something. Keep art where it decorates — the cast strip, the
briefing, the summing-up — and out of the evidence pane.

And the habit the last three waves have each repaid: **a plausible rate is not
a verified one.** Wave 5's fidelity check reported 1.64% and was measuring an
artefact of an instruction I had written. Wave 6's first live run showed
86.8% routing, and all nine disagreements were one thing — a phrasing the
router had never been given the vocabulary for. Wave 7's equivalent number is
"how many generated portraits are usable", and the useful question is not the
percentage but what the unusable ones have in common. Look at every one of
them before believing the rate, and run the edge of the range — the biggest
cast, the oddest setting — rather than the middle.

---

## As built (2026-09-21)

**All eight tasks are done.** Tasks 1-6 and 8 were built against the stub with
no key and no spend, the arrangement waves 5 and 6 used; task 7's pack was then
generated with the owner's approval — they were brought the measured arithmetic
and answered "you can go up to $20", and it came to about $6.
`docs/ARCHITECTURE.md` section 13 has the design and what the paid run found;
this records only where the plan above turned out to be wrong.

### Four things the plan had wrong

**1. Task 8 is a subtraction, not an addition.** "Precache the pack's JSON;
cache its images on first view" describes work that was already done and
describes the default as its opposite. `files` from `$service-worker` is
everything under `static/`, so a `.webp` beside a case file joins the install
payload automatically. The work was taking them *out*, in
`lib/util/precache.ts`.

That module exists only because `service-worker.ts` imports `$service-worker`
and so cannot be reached from a test. Without the split, the filter would have
been guarded by a note asking the next person to read a generated file.

**2. The plan's install-size *starting point* was pessimistic, and so were
both of my guesses.** The plan said "about 3-4 MB of images in total"; my
handoff said 2.5-5 MB; extrapolating from catalog-art I then said 600 KB.
**Measured: 1.40 MB for 84 pictures, averaging 17.1 KB.** And the number that
actually matters for task 8 is a different one — the install payload gained
*nothing*, because the images are not precached at all. What the service
worker installs from the pack is 0.27 MB of JSON.

**3. `skin.styleGuide` was not unused.** My handoff said all three art fields
had never been read. `prompts.ts:467` already puts the style guide into the
summing-up prompt as `STYLE:`, so changing what the writer is asked for there
moves the detective's closing speech as well as the pictures. `portrait` and
`scene` genuinely had no readers. (Corrected in the handoff too, in the commit
that introduced it.)

**4. "Deterministic SVG monograms" is a prop, not a component.** Task 3 reads
like a new thing to build. `ui/Token.svelte` already drew a person as a
coloured coin with a letter, and a second avatar component would be a second
thing to keep in step with the map, the notebook, the cast strip and the chat.
It gained an `art` prop and `look.ts` gained the initials and the standalone
SVG.

### The two exit criteria, and the one that needed a caveat

**"A visitor with a key gets portraits for a freshly generated case without
the game ever blocking on them."** Met, and it is the property the whole wave
is arranged around. `game/art.test.ts` holds it with a provider whose calls
finish only when told to, so a case that awaited its pictures would hang
rather than pass.

**"A keyless visitor can play twelve illustrated cases offline."** Met with a
caveat that the plan does not acknowledge, because task 8 asks for the
opposite of it in the same document. Task 8 says to keep images out of the
install and cache them on first view; that is what "the install stays light"
*means*. So a case the visitor has never opened is, offline, not illustrated.

Measured by asking CacheStorage directly rather than by inferring it:

| | case JSON | its pictures |
| --- | --- | --- |
| after install, nothing opened | cached | **not** cached |
| after opening one case | cached | cached |
| a case never opened | cached | not cached |

So: every one of the twelve opens and plays offline from a cold start, in
full prose, with monograms where the faces would be — which is a complete
game and was the only game through wave 6. Once seen, a case keeps its
pictures for good. Precaching the lot is a one-line change in
`lib/util/precache.ts` and costs 1.40 MB on first visit; wave 8's polish pass
should decide, and should know that a visitor who plays one case would be
paying for eleven they never opened.

A note on how that was measured, because the obvious way is wrong.
`Network.emulateNetworkConditions` applies to the page target, and a service
worker runs in its own — so a same-origin fetch the worker makes can still
reach the network while the page believes it is offline. A first attempt
"proved" that an unvisited case had its pictures offline, which is
impossible. `tools/offline.mjs`'s cross-origin probe has the same blind spot
and gets away with it only because what it tests is in-page generation.

### What the plan did not say, and should have

**Two structural prohibitions belong in task 5.** "No text, no clocks and no
readable documents" is the obvious part. The two that a model will breach
unprompted, and that matter more:

- **A portrait holds exactly one person** — two figures is a claim about who
  was with whom, which is the whole subject of the game.
- **The scene holds nobody** — a person at a place is a placement.

**And the corollary about placement rather than content: an image is never
evidence.** Art goes in the briefing, the cast strip and the conversation
header. The evidence pane has none, because a picture beside a card would be
read as saying something and nothing can check what it says.

**The quality setting needed a default, and the plan did not name one.** It is
`off`. Prose costs ~$0.02 a case and is spent the moment a player types a
setting; six pictures at the cheapest quality is ~$0.27 for the same gesture.
Defaulting that on would charge somebody ten times what they agreed to.

### Two bugs the tests found, neither in the plan

**A case could be charged for after the player left it.** `startArt` reaches
the provider through two dynamic imports after its "is this still the case?"
check. A player who went back to the desk in that window was still billed.

**And comparing case ids cannot tell a superseded run from the current one**,
because reopening the same case gives both runs a matching id — so both
proceed and every picture is bought twice. It is a ticket (`artRun`) now.

A mutation pass caught 9 of 10 planted bugs. The survivor — deleting the second
ticket check — is recorded in ARCHITECTURE section 13 as a guard no test
reaches, with the reason it cannot be reached through the public API. It was
established, not assumed.

### What is still unpaid, and what it buys

**No image has been generated through `llm/gemini.ts#generateImage` by
anybody.** It remains what its own comment calls it: a draft, written from
`../catalog-art/api.mjs` and translated from REST to the SDK. Everything above
it is exercised against `stubProvider`.

`art.live.test.ts` is the two calls that settle it — does the call work, will
the model draw a face — for about $0.09 rather than for a batch. It is excluded
from `vitest.config.ts` rather than merely absent from it, because an image
call costs roughly a hundred times a text call.

`sharp@0.34.4` is a new devDependency, pinned as catalog-art pins it, and
verified on this machine rather than assumed: 238-byte PNG in, 74-byte WebP
out on win32-arm64.

### Task 7, and the arithmetic the owner needs

Twelve cases at three per difficulty, cast sizes 4/5/5/6 plus the victim:
**72 portraits + 12 scenes = 84 pictures**, plus nine cases of writing at about
$0.02. Measured with `npm run author -- --estimate --art`, not guessed.

| quality | model | per image | 84 images | with the writing |
| --- | --- | --- | --- | --- |
| fast | flash-image 1K | $0.045 | $3.78 | ~$3.96 |
| balanced | flash-image 2K | $0.151 | $12.68 | ~$12.86 |
| beautiful | pro-image 2K | $0.134 | $11.26 | ~$11.44 |

**The per-image prices are the least certain numbers in the project.** The
pricing page gives a range without saying which resolution costs which, and
read literally it makes pro at 2K cheaper than flash at 2K — which is unlikely
and is the tell that the reading is wrong. Re-read it before the batch.

The levers, which are the owner's to pull and not mine to apply quietly:

- fewer cases — the pack is twelve because the plan says twelve;
- `--suspects-only`, dropping the victim's portrait: 84 → 72 pictures;
- `--no-scene`, or one scene per *setting* rather than per case: 84 → 72;
- `fast` rather than `balanced`, which is the whole factor of three.

`fast` with `--suspects-only` is 60 pictures at $2.70. All four levers are
built and tested; none is applied by default.

**The owner's answer was "you can go up to $20"** — the third time running
they have ignored the menu and set a ceiling instead. The batch was run at
`fast` with every subject, and came to about **$6**, the headroom going on
redraws and on three Expert cases that had to be thrown away. What that
bought, and the four things it taught, are in ARCHITECTURE section 13 under
"What the paid run actually found". The short version:

- **A prohibition cannot beat a description.** Five of the first seventeen
  portraits held a ledger, a notepad, a notebook or a ring of keys, because
  the *writer's own prompt* asked for them and the subject clause outweighs a
  list of "do not"s appended after it. Fixed where it is asked for
  (`skin/schema.ts`) and contradicted outright for the prompts already
  written (`PORTRAIT_FRAMING`).
- **84 of 84 pictures are usable**, 82 of them first time after that fix. Both
  failures were the same rendering artefact rather than anything about content.
- **27% of expert-preset seeds actually grade expert**, so a pack that wants
  three Expert cases has to search for them. The first three all graded Hard
  and were discarded.
- **A 54-card Expert case can exceed the writer's 90-second timeout.** One
  did, came back `cancelled`, and the retry worked.
