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
