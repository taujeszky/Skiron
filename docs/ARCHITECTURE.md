# Skiron — architecture

The design is in [`plan/README.md`](plan/README.md). This file records what the code
actually does and, where a choice was open, which way it went and why. Read it before
touching `src/lib/engine/`.

Sections arrive as the waves land. Anything not yet written is marked *(wave N)*.

---

## 1. The model

A case is a floor plan, a cast, an evening cut into slots, and a body.

| Symbol | Code | Meaning |
| --- | --- | --- |
| `S` | `frame.suspects` | how many suspects, 4–6 |
| `V` | `frame.victim` | the victim; always person id `S` |
| `P` | `frame.people` | `S + 1` |
| `T` | `frame.slots` | how many time slots, 5–8 |
| `R` | `frame.plan.rooms.length` | how many rooms, 5–9 |
| `r*` | `frame.murderRoom` | where the body was found — **the player knows this** |
| `c` | `world.culprit` | the killer, a suspect |
| `t*` | `world.murderSlot` | the slot the murder happened in |

People are numbered so that suspects are `0 .. S-1` and the victim is `S`. "For every
suspect" is then a plain `for` loop and never a filter.

`CaseFrame` is everything the player is told up front, and the only thing either solver
may assume. It deliberately does **not** contain the truth. `World` is the truth:
`loc[person][slot]`, the culprit and the murder slot. Splitting them this way is what
makes "this prompt cannot leak the answer" checkable by looking at a type.

Sizes are capped at 16 rooms, 8 people and 8 slots (`MAX_*` in `types.ts`) because both
solvers carry a room domain per person per slot as a 32-bit mask.

## 2. The axioms

`axioms.ts#isLegal(frame, world)` is *the* definition of a world that could have
happened, and it is written to be read rather than to be fast: no bitmask tricks, no
precomputation, the rules in the order the player is told them. Everything else in the
engine is tested against it.

1. **Rule 1** — every person is in exactly one real room in every slot.
2. **Rule 2** — across `t -> t+1` a person stays put or passes through one door that is
   open for that transition and that they are not barred from (`canMove`).
3. **Case-file rules** — nobody is ever in a room they are barred from; no room ever
   holds more living people than its capacity.
4. **Rule 4** — `loc[V][t*] = r*`, and the only living soul in `r*` at `t*` is `c`.
5. **Rule 5** — for every `t >= t*` the body is in `r*` and nobody but `c` is.

`movementMasks(frame)` is the fast table both solvers use. It is built by *calling*
`canMove`, so a movement bug cannot make the table and `isLegal` disagree — there is one
definition, not two.

### Living, and what counts as "in the room"

The one piece of semantics worth stating twice.

> The victim counts as a person in the room right up to the murder slot. From the murder
> slot on, the body lies in `r*` but is not counted as someone being there.

So `presentMask(frame, world, r, t)` — the living people in `r` at `t` — excludes the
victim for every `t >= t*`. Two consequences the how-to-play screen states:

- "Alone with the killer" (rule 4) is exactly `presentMask(r*, t*) === {c}`. The victim
  does not make it a crowd.
- "Nobody was in the study at eleven" can be true of the room the body is lying in. It
  is a useful clue when it is: it says the killer left.

Clue types split on this line, and the split is not arbitrary — it is the difference
between *where a body was* and *who had company*:

| Reads `loc` raw (holds of a corpse) | Counts the living |
| --- | --- |
| `At`, `NotAt`, `Stayed`, `Visited`, `NeverVisited` | `Saw`, `Together`, `AloneIn`, `Occupied`, `Empty`, `Count`, and room capacity |

`AliveAt(t)` is `t < t*` and `DeathWindow(a,b)` is `a <= t* <= b`; those two are the only
clues that talk about the murder slot directly.

### Testimony, and why clues only ever add information

`testimonyBinds(frame, clue, culprit)` is rule 7. A fact binds every world. A testimony
binds every world when lying is off; when lying is on it binds only the worlds in which
its speaker is *not* the culprit, which is the whole of `s ≠ c ⇒ φ`.

The consequence the rest of the engine leans on: **every clue the generator issues is
true in the true world**, a lie included, because in the true world the liar *is* the
culprit and the implication is vacuous. Therefore

- adding any issued clue to a fair set keeps it fair, and
- a deduction the player makes from the cards they hold stays valid when more cards
  arrive.

That is the monotonicity the statement bank, the hint system and the "play in any order"
guarantee all rest on.

## 3. The clue language

A small closed set, one module per kind under `engine/clues/`, gathered in a registry.
A module supplies `holds`, `canonical`, `normalise`, `valid` and `topicKeys` now;
`template` (wave 2), `propagate` (wave 2) and `schema` (wave 5) are declared in
`ClueModule` so that adding a clue type is one new file plus one registry line rather
than a sweep of `switch` statements.

`canonical(body)` is a *syntactic* normal form, not a semantic one. `Saw(p,q,t,r)` and
`Saw(q,p,t,r)` canonicalise the same, because as a formula the clue is symmetric and the
speaker lives in the clue's `source`. But `Saw(p,q,t,r)` and `Together(p,q,t)` do **not**
canonicalise the same even though the first implies the second — the fidelity check in
wave 5 has to be able to tell "she saw him in the library" from "she was with him", and
a semantic normal form would quietly accept the weaker sentence.

Case-file rules (`DoorClosed`, `BarredDoor`, `BarredRoom`, `Capacity`) are clues like any
other, marked by their kind (`RULE_KINDS`). They are facts, they are given at the start,
and the truth simulation obeys them by construction, so they are true by construction
too. The authoritative copy for legality is `frame.rules`; the clue forms exist so they
can be shown as cards and parsed back by the fidelity check.

At most one door joins any pair of rooms. That is enforced by the map builder, and
`DoorClosed` and `BarredDoor` depend on it: without it "did this person use *that* door"
could not be read off a room-by-room timeline.

## 4. Fairness is about the answer, not the grid

The **answer set** of a clue set is every `(c, t*)` for which some legal world satisfies
every clue that binds it. A case is **fair** when that set is exactly the true answer.

Uniqueness is deliberately *not* required of the whole `loc` grid. A case whose every
cell is forced needs far more clues, and the extra clues are the dull ones — they pin
down people whose movements never mattered. The player is asked for a name and an hour,
and that is what is proven unique. A consequence to keep in mind when reading solver
code: the deduction solver finishing does **not** mean every cell is settled, and the
notebook is expected to end a solved case with pencil marks still in it.

*(wave 2)* — the tiered deduction solver, the soundness argument and the grading.

*(wave 3)* — the generator pipeline and the measured sim table.
