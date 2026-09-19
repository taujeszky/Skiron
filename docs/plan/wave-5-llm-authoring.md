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
   description), people (name, role, bio, voice, motive, portrait prompt), rule fiction
   per case-file rule, prose per clue id, nothing-to-say lines per person, briefing,
   scene prompt, summing-up.
4. **Call A — the writer.** Give it the setting prompt, the floor plan with adjacency and
   grid positions (so the hub becomes a hall and the outdoor room a terrace), cast size,
   case-file rules and the whole bank in canonical form. **Do not give it the culprit, the
   truth or which statements are lies.** Instruct it: testimony in the speaker's voice,
   facts in an inspector's-notes voice, one clue per passage, and no claim about who was
   where when beyond the clue itself.
5. **Call B — the summing-up.** Give it the truth, the culprit's motive and the canonical
   proof trace as template sentences. Lint the result for the culprit's name and the
   murder time.
6. **`llm/skin/fidelity.ts`.** The parse-back call gets the glossary, the clue schema and
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
