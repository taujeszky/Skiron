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
2. **Balance pass.** Rerun `npm run sim`, play several cases at each difficulty, and
   adjust presets, par and the clue-type mix. Record the final table.
3. **Accessibility.** Keyboard access to everything, visible focus, ARIA labels on the map
   and grid, room codes as well as colours, reduced-motion handling for the replay,
   contrast in both themes.
4. **Icons.** Adapt Signpost's `scripts/gen-icons.mjs`; keep the ink inside the maskable
   safe zone.
5. **Errors people will actually hit:** no key, quota exhausted, blocked content, offline
   during generation. Each gets a plain sentence and a way forward (usually: play a pack
   case).
6. **Export and import** a whole case as a file, so a generated case can be shared with
   its prose. The key is never part of it.
7. **Docs.** Finish `docs/ARCHITECTURE.md`. Rewrite `README.md` from the plan-phase
   version into the siblings' shape: pitch, what makes it different, controls, development,
   how it works. Bring `CLAUDE.md` up to date, including a "How to add a clue type"
   section.
8. **With the owner's go-ahead:** create `github.com/taujeszky/Skiron` and push; final
   deploy; then add Skiron to the portfolio catalog — a `PROJECTS` entry in
   `../index.html` (that file has very long lines; read it in slices) and card art through
   `../catalog-art`.

## Exit criteria

- A first-time visitor on a phone can finish the tutorial and an Easy case without help.
- `npm test`, `npm run check` and the pack test are green, and the sim table is recorded.
- README, CLAUDE.md and ARCHITECTURE.md describe the project as it is.
