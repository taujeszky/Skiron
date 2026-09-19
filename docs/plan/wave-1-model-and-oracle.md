# Wave 1 — Case model and the exhaustive solver

**Goal.** The engine can build a floor plan, simulate a legal evening, evaluate any clue
against it, and say which answers a set of clues allows. No deduction, no generation of
clue sets yet.

**Prerequisites.** Wave 0. Read "Formal model", "Clue language" and "Two solvers" in
`README.md`, and `../newsignpost/docs/ARCHITECTURE.md` for how a sibling lays out a pure
engine.

**Size.** Medium.

## Tasks

1. **`engine/types.ts`.** `Case` parameters, `RoomId`/`PersonId`/`SlotIndex`, `FloorPlan`,
   `World` (`loc`, `culprit`, `murderSlot`, `murderRoom`), the `Clue` union, `Source`
   (`fact` | `testimony(s)`), `lying: boolean`. Use small integer ids and bitmask-friendly
   sizes (at most 16 rooms, 8 people, 8 slots) — both solvers want bitmask domains.
2. **`engine/map/`.** Rectangular dissection of a footprint into 5–9 rooms with a minimum
   room size; doors on shared wall segments long enough to hold one — a spanning tree
   first, then a few extra doors so there are cycles; optionally one outdoor room on the
   perimeter. Output both the graph and the geometry the SVG floor plan will need (room
   rectangles, door positions), so the picture can never disagree with the graph. Support
   door closures per transition and per-person bars in the data model now, even though the
   generator chooses them later.
3. **`engine/axioms.ts`.** `isLegal(world, plan, rules)` checking rules 1–5 exactly as the
   README states them. This is the definition everything else is tested against; keep it
   short and obviously correct.
4. **`engine/world/simulate.ts`.** Seeded truth simulation: choose culprit, slot and room;
   walk everyone with a stay-probability and a pull towards shared rooms so that paths
   cross; guarantee the murder is unwitnessed and rule 5 holds. Retry on failure and count
   retries — that number goes into the wave 3 sim table.
5. **`engine/clues/`.** One module per core clue type plus a registry. In this wave each
   provides `holds(clue, world)`, `canonical(clue)` with normalisation (so `Saw(p,q,t,r)`
   and its mirrored spelling compare equal where they mean the same), and
   `topicKeys(clue)`. Propagators, templates and schemas come in later waves; leave the
   interface slots in place.
6. **`engine/solver/exhaustive.ts`.** `answers(case, clues) → Set<(c, t*)>` and
   `cellPossible(case, clues, p, t, r)`. For each candidate answer: drop the candidate
   culprit's testimony when lying is on, assert everything else, and search — bitmask
   domains, propagation of the movement rule and direct clues, backtracking on the smallest
   domain. Keep it independent: it must not import anything from the deduction solver that
   wave 2 builds.
7. **`engine/caseId.ts`.** Versioned codec, e.g. `SK1-<preset>-<seed>`.
8. **Start `docs/ARCHITECTURE.md`:** the model, the axioms, and why uniqueness is defined
   on the answer and not on the grid.

## Tests

- Map: connected, every door joins rooms that share a wall, same seed ⇒ identical plan.
- Simulation: 500 seeds across all size presets produce legal worlds (property test
  against `isLegal`).
- Every clue type: true and false on hand-made worlds; canonical forms equal where meaning
  is equal.
- Exhaustive solver: a hand-made three-suspect case with a known answer set, including one
  with lying on where the answer depends on dropping the culprit's statements; property —
  for any subset of true clues, the true answer is in the answer set.

## Exit criteria

- All of the above green; `npm run check` clean.
- A scratch script can print a floor plan as ASCII or SVG and a world as a person × slot
  table. You will want this for debugging every later wave.
