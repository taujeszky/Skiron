# Wave 4 — The whole game, with template text

**Goal.** A complete, offline, installable game using engine-written sentences only. No
LLM code in this wave. If the game is not enjoyable at the end of it, stop and say so: the
puzzle has to stand on its own before the fiction is added.

**Prerequisites.** Waves 1–3. Read "Investigation layer" in `README.md`, and Signpost's
`game/controller.ts` for the store pattern and its README for the bar on hints, Check and
error highlighting.

**Size.** Large. Split into 4a (tasks 1–6: play a case to the end) and 4b (the rest) if
one session is not enough.

## Tasks

1. **`game/controller.ts`.** All stores and actions in one spine, as in Signpost: current
   case, collected cards, notebook, action count, accusations, hint and check panels,
   settings, stats. Components use Svelte 5 runes; shared state uses `svelte/store`.
2. **Screens.** Home (continue, new case by difficulty, enter a case ID, settings), case
   briefing, investigation, accusation, summing-up, stats, how-to-play. The how-to-play
   screen states all eight rules from the README.
3. **Investigation screen.** Three panes on a desktop, tabs on a phone:
   - **Map.** The SVG floor plan from the engine's geometry; a slot scrubber; solid tokens
     for people the notebook has placed in that slot, ghost tokens for candidates; closed
     doors shown for the scrubbed slot; click a room to examine it.
   - **Notebook.** A person × slot grid whose cells hold room candidates as pencil marks
     (three-letter code plus colour — never colour alone). Eliminate, set, undo/redo.
     Separate marks for cleared/suspected people and for candidate murder slots.
   - **Evidence.** Collected cards, filterable by person, slot and room. Each shows its
     sentence and its canonical form; selecting one highlights the cells and rooms it
     concerns. The cast list opens the structured interrogation: ask a suspect about a
     slot, a person or a room.
4. **Auto-notes** setting: on collecting a card, apply its direct (tier 0) consequences to
   the notebook. Default on; the counterpart of Signpost's auto-link.
5. **Errors.** Flag only states that cannot be completed: an empty cell, a movement
   violation between two set cells, every suspect cleared, every slot eliminated. One
   sentence each in the status bar. Write the "play a whole correct solve in scrambled
   order and demand silence" test that Signpost has.
6. **Accusation and ending.** Culprit plus slot, compared with the stored truth. A wrong
   accusation is recorded and play continues. On success: rating against par, then the
   summing-up — for now the proof trace as template sentences — and an animated replay of
   the true evening on the map.
7. **Hints (H) and Check (C)** as specified in the README. They share one panel slot.
8. **Persistence.** `localStorage` under `skiron:` for settings, stats and the current
   save. Behind a small module, so a Tauri store can replace it later. Wave 5 adds
   IndexedDB for skins and images.
9. **Stats.** Per difficulty: solved, time, actions against par, hints, wrong
   accusations, streak.
10. **Theme.** Light, dark, auto, following Signpost's `data-theme` approach.
11. **Keyboard play and phone layout.** Touch targets for pencil marks need care.
12. **PWA.** Service worker with offline play *and* offline generation. Read Signpost's
    ARCHITECTURE.md §7 on the worker-chunk trap first, and its CLAUDE.md note on testing
    service workers in headless Chrome (short `--user-data-dir`).

## Tests

- Notebook logic, error rules, rating and persistence round-trips as unit tests.
- Drive the dev app headlessly to play one Easy case from start to accusation using only
  hints; it must end solved.

## Exit criteria

- A full case at each difficulty is playable offline from the installed PWA.
- Ask the owner before the first deploy. If they agree, create the Cloudflare Pages
  project and run `npm run deploy`; the subdomain may get a suffix if `skiron` is taken.
- An honest note in CLAUDE.md on how the game feels and what drags.
