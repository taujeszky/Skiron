# Wave 5 — LLM authoring and the fidelity check

**Goal.** Any case can be dressed by the model in any setting the player types, and every
sentence that reaches the player has been proven to say what its clue says.

**Prerequisites.** Wave 4. Read "The LLM contract" and invariants 1, 6, 8 and 9 in
`README.md`. Read Ascendant's `src/lib/api.ts` and key-entry flow, and catalog-art's
README for key handling in Node.

**Size.** Large.

## Tasks

1. **`llm/provider.ts`.** A narrow interface: `generateJSON(schema, system, user)` and
   `generateImage(prompt, options)` (the second used in wave 7). `llm/gemini.ts`
   implements it with `@google/genai`. `llm/models.ts` holds every model id; check that
   the ids Ascendant pins are still current before using them. Retries with backoff,
   timeouts, and a typed error for "no key", "quota", "blocked", "malformed".
2. **Key handling.** In-app entry stored in `localStorage`; `VITE_GEMINI_API_KEY` from
   `.env.local` for development, with a committed `.env.local.example`. The key goes in a
   request header only — never a URL, a log, a save file or an exported case. State on the
   settings screen that it is used directly from the browser.
3. **`llm/skin/schema.ts`.** The `CaseSkin` type and JSON schema: `schemaVersion`,
   `language`, title, place, era, `styleGuide`, rooms (name, three-letter code,
   description), **hour labels**, people (name, role, bio, voice, motive, portrait
   prompt), prose per clue id, nothing-to-say lines per person, briefing, scene prompt,
   summing-up. *Two changes made while building it. **Hour labels** were missing: the
   `Glossary` has had `slotLabel` since wave 1, so without them a dressed case reads
   "Mrs Pellworth was in the orangery at slot 5". And **rule fiction is not a separate
   field** — a case-file rule is a clue, so its fiction is prose for a clue id like any
   other, and one map covers both.*
4. **Call A — the writer.** Give it the setting prompt, the floor plan with adjacency and
   grid positions (so the hub becomes a hall and the outdoor room a terrace), cast size,
   case-file rules and the whole bank in canonical form — *and the engine's own template
   sentence for each clue beside it. The plan said canonical form alone; a writer shown
   `say(p1)|Saw(p0,p3,t4,r2)` has to decode the clue language before it can write, and
   every decoding slip becomes a fidelity failure and a paid retry. It leaks nothing: the
   template is the exact sentence the player sees when prose is unavailable.* **Do not give it the culprit, the
   truth or which statements are lies.** Instruct it: testimony in the speaker's voice,
   facts in an inspector's-notes voice, one clue per passage, and no claim about who was
   where when beyond the clue itself.
5. **Call B — the summing-up.** Give it the truth, the culprit's motive and the canonical
   proof trace as template sentences. Lint the result for the culprit's name and the
   murder time.
6. **`llm/skin/fidelity.ts`.** The parse-back call gets the glossary, the clue schema
   (built per case by `engine/clues/schema.ts#clueBodySchema`, so the model is given the
   case's real bounds — seven rooms means `maximum: 6`) and
   the prose clues under shuffled opaque ids, and returns a formal clue plus `extraClaims`
   for each. Compare canonical forms. Regenerate failures (*starting point*: two retries,
   with the mismatch fed back), then fall back to the template sentence for that clue.
   Record the fallback rate per case.
7. **Glossary-driven templates.** With a skin present, `explain.ts` sentences use the
   skin's names, so hints and fallbacks sit naturally beside the prose.
8. **In-app generation.** "New case" gains a setting box ("a lighthouse in a storm, 1923")
   when a key is present. Show honest progress: building the case, writing, checking the
   writing. Cancelable. Store skins in IndexedDB keyed by case ID.
9. **`tools/author-case.mjs`.** Node CLI: preset, seed range, setting prompts, language →
   `static/cases/<pack>/<id>.json` holding the **whole** case (truth, clues, bank,
   investigation, skin), not just a seed — a shipped case must survive a generator change.
   Key from `--key`, `$GEMINI_API_KEY` or `%USERPROFILE%\Desktop\gkey.txt`, read at call
   time. Generate a three-case text-only test pack now; the real starter pack comes in
   wave 7, in one paid pass with art.
10. **Pack loader and browser** on the home screen.
11. **Evidence cards** show prose with the canonical form beside it, and mark a card that
    fell back to a template no differently from the rest.

## Tests

- Canonical comparison: equal meanings compare equal, near-misses do not (wrong slot,
  wrong room, swapped speaker, `Saw` parsed as `Together`).
- Fidelity flow with recorded responses: pass, mismatch → retry → pass, mismatch →
  fallback, extra claim → reject.
- A pack test that loads every shipped case and re-verifies it: exhaustive fairness, the
  recorded tier, every clue has prose or a template, schema valid.
- The writer's prompt builder never includes the culprit or the truth — assert it on the
  built prompt string.
- Live tests in `vitest.live.config.ts`, gated on a key, outside `npm test`.

## Exit criteria

- A typed setting produces a verified, skinned, playable case in the browser.
- Fallback rate measured over at least twenty cases and written into ARCHITECTURE.md. If
  it is high, fix the prompts before moving on.
- Before generating any pack, tell the owner the expected number of calls.

---

## What wave 4 hands you (written 2026-09-20, before wave 5 starts)

The tasks above were written before any of the engine existed. This is what is
actually on disk, what the owner has already decided, and the traps that are
not guessable from the task list.

### The owner's two decisions, asked and answered on 2026-09-20

1. **Build this wave against stubbed model responses first.** When the code is
   there, bring back an *exact* expected call count and wait for approval
   before spending anything. Nothing in tasks 1-8 and 11 needs a live key;
   task 9's pack and the exit criteria's twenty-case fallback measurement do.
2. **The first deploy is deferred to wave 8.** Do not create a Cloudflare
   project or run `npm run deploy` in this wave either.

### The calls you need

```ts
import { clueCanonical, clueTopicKeys, CLUE_KINDS, moduleFor } from "$lib/engine/clues";
import { defaultGlossary, explainer, clueSentence } from "$lib/engine/solver/explain";
import { allCards } from "$lib/engine/generator/bank";
import { generate } from "$lib/engine/generator/generate";
import type { Glossary } from "$lib/engine/types";
import { settings, updateSettings } from "$lib/game/controller";
import { KEYS, useStore, type KeyValue } from "$lib/game/storage";
```

`clueCanonical(clue)` is the string the fidelity check compares on:
`fact|At(p0,t1,r2)` for a fact, `say(p3)|Saw(p1,p2,t4,r0)` for testimony. It
already carries the speaker, so **a swapped speaker is a canonical mismatch
for free** — one of the near-misses the tests ask for is handled by the format
rather than by the comparison.

One thing to get straight before writing those tests: `Saw` **normalises its
two people** (`clues/company.ts`), so `Saw(p1,p2,...)` and `Saw(p2,p1,...)`
compare *equal* on purpose — the formula is symmetric and who is talking lives
in `source`, not in the body. So "swapped speaker" is a real near-miss and
"swapped the two people inside a `Saw`" is not one; a test built on the second
would be asserting that the engine is broken.

### Nine things that will bite

1. **`game/controller.ts` calls `defaultGlossary` in eight separate places**
   (lines 219, 225, 229, 473, 478, 595, 733, 815 as of this commit), each
   building a fresh one from the frame. Task 7 says "with a skin present,
   `explain.ts` sentences use the skin's names", and that is *not* a change to
   `explain.ts` — that file already takes a glossary everywhere and defaults
   politely. The work is in the controller: make it hold one glossary
   (`skin ? skinGlossary(skin) : defaultGlossary(frame)`) and thread it, or
   the cards will speak the skin's names while the status bar says "Suspect
   C". `hint.ts` and `errors.ts` are already fine — they take a glossary and
   only fall back to the default, so they need nothing but a caller that
   passes one. Grep before you start:
   `grep -rn "defaultGlossary(" src/lib`.
2. **The `ClueModule.schema` slot is declared and empty.** `types.ts` line 289
   reserves it for exactly this wave, and no clue module fills it. Seventeen
   kinds, listed in `clues/index.ts#CLUE_KINDS`. Fill it there rather than
   writing a second switch in `llm/`, for the reason the registry exists.
3. **The key must never reach a file, a URL or a log** (invariant 9). Copy
   `../catalog-art/api.mjs#loadKey`, which is the pattern that already works on
   this machine: `--key=...`, then `$GEMINI_API_KEY`, then
   `%USERPROFILE%\Desktop\gkey.txt`, read *at call time*, sent only as an
   `x-goog-api-key` header. It also shape-checks the key (`/^AIza[\w-]{30,}$/`)
   before using it, which turns a typo into a message instead of a 400.
4. **`@google/genai` is not installed yet.** Ascendant pins `2.6.0`. Remember
   both install flags — `npm install --ignore-scripts --legacy-peer-deps` —
   and `node scripts/patch-workerd.cjs` afterwards.
5. **Check the model ids before using them.** Ascendant's `src/lib/api.ts`
   pins `gemini-3.7-flash` for text and `gemini-3.1-flash-image` /
   `gemini-3-pro-image` for images. The plan says to verify they are current,
   and ids go stale. `catalog-art/api.mjs#imageModels` lists what a key can
   actually reach, which is the cheap way to find out.
6. **Ascendant's retry helper is worth reading and not worth copying whole.**
   `generateContentWithRetry` swallows every failure into a fallback value,
   which is right for a game that must not stop and wrong here: a fidelity
   mismatch has to be *visible* so the fallback rate can be measured. Take the
   backoff and the abort-on-timeout; keep the typed errors the task list asks
   for. `parseGeminiJsonResponse` — fenced block, then first-brace-to-last —
   is worth taking as it stands.
7. **There is no IndexedDB module.** `game/storage.ts` is `localStorage` only,
   behind a `KeyValue` interface with `useStore()` for tests. Task 8 wants
   skins in IndexedDB; write it as a second small module with the same shape
   so the Tauri swap stays possible, and do not widen `KeyValue` to async for
   it — the settings and save paths are synchronous on purpose.
8. **`static/cases/` does not exist**, and task 9 says a shipped case stores
   the *whole* case rather than a seed. Note the tension with invariant 4: a
   pack file is the one place a case is not its id, precisely so it survives a
   generator change. `worker/protocol.ts` has the paragraph explaining why
   `GeneratedCase` does not survive `JSON.stringify` — Maps and Sets — so a
   pack needs a real codec, and that codec is new work this wave.
9. **The evidence card already has the canonical line.** `ui/CardView.svelte`
   shows it under the sentence, behind `settings.showCanonical`. Task 11 is
   therefore "replace the sentence, leave the canonical form alone", plus the
   instruction not to mark a fallback card differently from the rest.

### What exists, and what does not

Exists: the whole engine and generator, the game layer, seventeen UI
components, the service worker, and three browser tools —
`npm run playthrough` (plays a case through the real buttons, `--shots <dir>`
for screenshots), `npm run offline` (cuts the network and generates from
cache), `npm run par` (the scripted undirected player). `tools/cdp.mjs` is the
shared browser plumbing, which is what a live fidelity run will want.

Does not exist: anything under `src/lib/llm/`, `static/cases/`, any `.env`
file, `vitest.live.config.ts`, and any dependency on a model.

### The thing wave 5 should be most careful about

Waves 1, 2 and 3 were each reviewed adversarially and all three found the same
shape of defect: **a property that was already asserted, where the assertion
was the broken part.** Wave 4 supplied its own within the hour — the offline
check proved the network was cut by fetching the app's own URL, which a
service worker answers from cache, so it passed online and failed offline.

This wave's version of that trap is specific and worth naming now. The
fidelity check compares a parse-back against the canonical form, and **the
temptation will be to build the parse-back's input from the formal clue**.
Do that and the check compares the clue with itself and cannot fail, however
wrong the prose is. The input must be the *prose*, with the glossary and the
schema, under shuffled opaque ids — the plan says so, and the reason it says
so is this.

The second one: a fallback rate of zero is not good news on its own. If no
clue ever falls back, check that the comparison can reject at all before
believing it — the tests in this wave's list are written as near-misses
(wrong slot, wrong room, swapped speaker, `Saw` read as `Together`) for
exactly that reason.

