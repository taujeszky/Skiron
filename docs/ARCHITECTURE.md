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

## 5. The map, and the truth

**The map** is a recursive dissection: take the largest splittable rectangle, cut it along
its longer axis at a seeded position that leaves both halves at least `minDim` on every
side, repeat until the room count is right. Doors are drawn from every pair of rooms
sharing a wall of at least two units — a random spanning tree first, so the house is
connected, then a few extras so there are cycles to reason about. With a terrace, a strip
is sliced off one side of the footprint first and dissected as a single outdoor room.

Measured: 0 failures in 30,000 single attempts across rooms 5–9, with and without a
terrace, on the default 18×12 footprint at `minDim` 3. The retry loop is insurance, not a
workhorse.

**The truth** is simulated rather than searched for. The victim walks freely up to `t*`,
and **wherever they happen to be is the murder room** — the plan said to pick a room, but
picking one and dragging the victim to it flattens the spread, while a free walk lands the
body in each of eight rooms 10–15% of the time against a flat 12.5%. The killer's walk is
steered so that "the killer could have got there" holds by construction, and everyone else
walks with `r*` swept out of their allowance from `t*` onwards. Rules 4 and 5 therefore
hold because of how the world is built, not because illegal worlds are generated and
thrown away.

Both `buildFloorPlan` and `simulateTruth` draw **exactly one** number from the caller's
RNG however many attempts they need, each attempt running on a derived sub-stream. A retry
that consumed a variable number of draws would shift everything downstream and change what
an old case ID rebuilds for reasons that have nothing to do with the map.

## 6. Determinism, and how it is actually enforced

Critical invariant 4 — same case ID, byte-identical case — is the one invariant that a
whole green test suite can be wrong about, because the obvious tests compare engine output
with engine output *from the same build*. `plan(seed)` equalling `plan(seed)` holds for
any RNG whatsoever.

Two guards exist because of that, and both were verified by deliberately breaking the code:

- **`golden.test.ts`** pins the RNG's first outputs for a known seed string, and pins the
  house and the evening that `SK1-N-3f9k2a` builds, indoors and with a terrace. Changing
  `Math.imul(result, 9)` to `13` in the RNG, or swapping two draws in the simulation, left
  every other test in the project green; these fail loudly. If they fail, the question is
  whether the change to what an old ID rebuilds was *intended* — if it was, bump
  `CASE_ID_VERSION` and regenerate them deliberately.
- **`purity.test.ts`** reads the engine's own source and bans `Math.random`, `Date`,
  `performance`, `crypto` and the DOM globals, with **no allow-list**. That is why
  `randomSeed` lives in `util/entropy.ts` and `newCaseId(preset, seed)` takes its seed: a
  rule with one blessed exception in it is a rule nobody can test.

## 7. The deduction solver

Five tiers, tried in order, restarting from tier 0 whenever any of them fires. A tier
therefore only ever runs when every cheaper tier is saturated. `TIERS` in `solve.ts` is an
array and its index *is* the tier number.

**The grade is the cheapest cap at which the case still finishes.** Not simply the highest
tier that fired: the solver keeps going after the answer is unique, because the grid is
worth filling in and the hint system reads those steps, but a tier that fires once one pair
is left is tidying rather than solving. Counting those would let a case that tier 0 settles
outright be graded Normal because a tier-2 rule later trimmed a room nobody cared about —
and the preset floor in `difficulty.ts`, whose whole job is to catch an Easy case wearing a
Hard label, would be defeated by exactly that. Since tiers are always tried in order and
the loop restarts from tier 0, a case solvable under a cap of `g` settles before tier `g+1`
is ever reached, which is what makes the two statements the same one. `solver.test.ts`
asserts the characterisation directly.

| Tier | Name | What it does |
| --- | --- | --- |
| 0 | placement | what one card says about one person, plus the murder axioms |
| 1 | movement | arc consistency along a person's timeline, both directions |
| 2 | counting | how many were in a room, and who that leaves over |
| 3 | trust | rule 7 read backwards — only the culprit lies |
| 4 | hypothesis | suppose an answer, propagate, cross it off on a contradiction |

### Four decisions

**Candidates are pairs, not two sets.** `state.answer[suspect]` is a mask of the slots
still possible as `t*` *if that suspect did it*. The plan described two flat sets
(candidate culprits, candidate slots), but pairs are strictly stronger and are how a
person reasons: "if it was the Colonel it must have been at nine, and he was in the hall
at nine, so it was not the Colonel" cannot be expressed by two independent sets, which
would have to keep both the Colonel and nine o'clock alive. Fairness is defined on pairs
(§4), so this is also exactly the right granularity for an elimination. It pays off again
in tier 4, where all three flavours of hypothesis are one edit to the same structure.

**Trust is derived, never stored.** `trusted = lying ? allSuspects & ~culprits :
allSuspects`. Clearing a suspect *is* trusting them, so there is no second structure to
keep in step — and tier 3's hypothesis "suppose `s` is innocent" is then literally
`answer[s] = 0`, one assignment that both narrows the answer and unlocks the testimony.
`mayBeLivingIn` / `mustBeLivingIn` are the only sanctioned way for a rule to ask about the
victim: a rule may push the victim out of a room only when every surviving pair agrees
they were still alive, and may conclude they were dead only when they are *forced* into
that room. That is the likeliest source of unsoundness in the whole wave, so it is one
named chokepoint rather than a thing each rule gets right on its own.

**Hypotheses do not nest.** `Deduction.depth` counts suppositions, and tier 4 refuses to
run above zero. Capping a trial at tier 3 already has that effect, but only as a
consequence of a number; depth is difficulty, and a case solvable only by supposing two
things at once is not one a person can be asked to solve. Stating it as a rule means a
later change to the cap cannot quietly raise the standard the generator certifies against.
Tier 3 *does* run inside a tier-4 trial, and usefully so — but only inside a slot trial,
because a culprit or pair trial leaves one candidate and tier 3 needs two.

**The budget is part of the grade** (critical invariant 10). `TRIAL_BUDGET` caps tier 4 at
one fee per trial plus every state change the trial caused. A trial that would have found
something but was not run leaves the case unfinished, and the generator throws such cases
away — so raising the budget changes which cases exist. `SolveResult.budgetSpent` says when
a run stopped for want of budget, so "not finished" is never mistaken for "proved there is
nothing more to find".

**A step records what it left standing, not only what it took.** `killPairs` sweeps
whatever is still alive, so the same elimination arrives as a different set of pairs
depending on what has already been crossed off — and from the pairs alone a reader cannot
tell whether a suspect has just been cleared. The `answer-cut` conclusion therefore carries
three things: the pairs that went, the suspects that leaves in the clear, and the hours it
closes for everybody at once. A player's notebook holds exactly the last two, so a step
that did not say them was a step the notebook could not record. It did not say them for a
while, and §8 describes what that cost.

**Tier 3 requires everybody it supposes innocent to have spoken.** Supposing `s` innocent
does two things at once, since trust is derived from the candidate set: it believes `s`,
and it takes `s` out of the answer. Either can be what breaks, so what the rule proves is
"`s` cannot have been innocent" and not "`s` lied" — and the sentences say the first.
Without the check on speaking, the murder axioms alone could refute an innocence on a
notebook holding no statements at all, and the case would be graded Hard for a matter of
trust in which nobody had said a word.

**The victim leaves a room outright when it is not the room they were found in.** "Nobody
living was in `r` at `t`" normally splits — the victim was elsewhere, or the victim was
already dead — and a rule may only act when the state rules one side out. But away from
`r*` it does not split at all: alive, the card says they were not there; dead, rule 5 has
them lying in `r*`, which this is not. `ruleOutLiving` in tier2.ts and `noLivingSoulIn` in
tier0.ts both take that shortcut, and it is free.

### Where the tier boundaries actually are

They are not arbitrary, and two of them are easy to get wrong when adding a rule.

- Tier 0 takes only the *liveness* half of `Together` ("they were both alive, so the
  murder came later") and leaves the room equality to tier 2, because equality is an
  argument about two people's rows at once. For the same reason tier 0 ignores `Occupied`,
  `Count` and `Visited` entirely.
- Tier 1 has no bespoke multi-slot rule. "She could not have reached the cellar and been
  back by ten" is what repeating the two arc-consistency passes to a fixpoint says; a rule
  for it would be a second, weaker implementation of the same thing.
- Tier 3 sits out cases without lying. With lying off everyone is trusted from the start,
  so supposing somebody innocent adds no card — it only narrows the answer, which is tier
  4's job and tier 4's grade. A truthful case must never be graded Hard for a trust
  deduction it could not have made.

### Soundness, and the fairness certificate

Every rule removes only candidates that appear in no legal world consistent with the
clues. That single property is what the whole game rests on: if a run ends with one
surviving pair, no other answer exists, and the case is fair. Tiers 3 and 4 inherit it
rather than adding to it — a trial starts from a state that still contains every
consistent answer minus what the hypothesis excludes, runs only sound rules, and so a
contradiction proves the hypothesis impossible.

The one way a trial can go wrong is an *empty question*: a hypothesis that empties the
candidate set by itself has been refuted by nothing. Both tiers guard against it, and in
tier 4 the guard is currently unreachable — none of the three narrowings can empty a set
they each pick a surviving pair from. It is written down anyway, because a fourth
narrowing that could would fail silently and only on cases where the answer had already
been cornered.

### How it is guarded

- **`solver.test.ts`** runs random cases across five sizes and four clue densities and
  asks wave 1's exhaustive solver whether anything the deduction solver threw away was
  actually possible. The density spread is deliberate: a dense notebook falls to tier 0
  and a bare one is not solved at all, and neither exercises a hypothesis. It guards
  itself twice — over 90% of cases must deduce *something*, and **every tier must have
  come out as some case's grade**, so a tier that quietly stopped firing cannot be
  certified sound by a suite that never ran it.
- **`rules/rules.test.ts`** gives each rule a minimal position where it must fire and the
  same position with the one card removed that made it fire. Random cases are bad at
  saying *which* rule misbehaved; these say it in a board small enough to read, and each
  is cross-checked against the exhaustive solver so a wrong expectation fails rather than
  being enshrined.
- **Differential fuzzing**, run by hand while the tiers were written: 14,400 cases in
  which every removed cell and every removed pair was checked against the exhaustive
  solver, with capacity rules on half of them, and 10,800 more checked for the cheaper
  property that the truth survives. Zero unsound eliminations, zero contradictions raised
  from true clues.
- **Mutation testing**, likewise: nine deliberate bugs planted one at a time. Six changed
  behaviour and all six were caught — the victim's liveness test dropped from a counting
  rule, `count-exact` forcing on the wrong comparison, `conflict-pair` clearing the wrong
  side, a branch forgetting its depth, the depth gate removed, and tier 4 unwired. The
  three survivors were each shown to be behaviour-preserving rather than test gaps.

- **An adversarial review** after the wave was complete: seven independent readings —
  soundness, the victim's liveness, grading, hint safety, the sentences, determinism and
  conformance to the plan — with every finding sent to two verifiers told to refute it.
  Fifteen survived. They are what §8's opening paragraph is about, and the ones that
  changed the design are recorded above and below; three more turned out to be equivalent
  mutants and are documented where they live.

Measured on this machine over 800 cases across the four preset shapes: a whole solve
takes 0.5 ms on Easy and 1.5 ms on Expert, worst case 11 ms. The heaviest case spent
10,574 of the 20,000 trial budget, and no case exhausted it. Re-measured after the review
over 3,600 cases: no unsound elimination, no grade that a cheaper cap could have reached,
and no tier-3 deduction naming a suspect who had not spoken.

## 8. Sentences, the notebook and hints

### Where the words live

Each clue kind renders its own sentence, in its own module, through
`ClueModule.template`. `KindModule` makes it **required**, so a new clue kind
cannot compile without one — which is the same trick `RuleId` plays on
`explain.ts`, and for the same reason: a card with nothing written on it, or a
deduction with no sentence, is not a thing that can be shown to a player.

Three rules the templates keep:

- **Past tense, no leading capital, no closing stop.** The caller punctuates,
  because the same clause is used bare, attributed, and (in wave 5) compared
  with what a model wrote.
- **A speaker refers to themselves in the first person.** "Mrs Hale says: I was
  in the library at nine", not her name twice in her own statement. That is
  what the `speaker` argument is for, and `naming()` in `clues/common.ts` is
  the only place it is interpreted.
- **No two kinds may share a sentence.** `Empty` and `Count(k = 0)` say the
  same thing about the world and must not say it the same way, because wave
  5's fidelity check reads prose back to a clue and two kinds spelled alike
  would make that ambiguous. A test asserts all 34 renderings are distinct.

`explain.ts` puts the conclusion first and the reason second — "Mrs Hale must
have been in the library at nine, because Card 3 puts somebody there and
everyone else is accounted for elsewhere." Reason-first reads better in
isolation but needs a pronoun before the name it refers to, and across
twenty-eight rules that produces sentences nobody can parse.

A reason clause never says "**that** room". An elimination that leaves one
candidate standing is recorded as `room-set`, naming the room the person *is*
in, so "Card 2 rules that room out" would point at the wrong one and teach the
player that a card ruling a room out puts somebody in it. Since hint branch 2
is the hint system's entire output, that is a false rule taught in the one
place a player has to trust.

**Everything the player sees is numbered from one**, rooms and slots included,
while the engine counts from zero throughout. A notebook showing "slot 0" next
to an hour labelled "one" would make a player doubt the grid, and doubting the
grid is fatal in a game whose whole promise is that the grid is fair.

### The notebook, and the Check

`Notebook` (in `hint.ts`) is **deliberately coarser than `SolverState`**: a
grid of crossed-out rooms, plus two flat lists for suspects and hours. A player
does not keep a candidate *pair* per suspect, and a hint system that assumed
they did would offer deductions nobody could write down. So an `answer-cut`
conclusion is news to a player exactly when it clears a suspect or closes an
hour, and the step says which.

It did not always say which, and the bug that followed is the one worth
remembering from this wave. The step used to carry only the pairs it removed,
and the hint system tried to recover the rest by looking at their *shape* — one
suspect across every hour, or one hour across every suspect. But `killPairs`
sweeps what is still alive, so after the first elimination no sweep ever has
that shape again. Almost every real elimination was therefore judged "not
news", was never offered as a hint and was never written down, and the player
was then told that everything the cards could prove was already in the notebook
— with the hour column blank, and the accusation needing an hour. Nothing was
unsound and no test went red: the hint tests asked whether hints were true and
whether they terminated, and both were. They did not ask whether following them
left the player able to accuse. That is now the assertion they lead with.

`notebookIsSound` is the Check, and it is one bit: is everything crossed out
actually false? It compares with the stored truth and **never asks a solver**
(critical invariant 5), so a bug in a deduction rule can make a hint useless
but can never tell a player that a true thing is false. It says nothing about
whether the notebook is complete or whether the marks follow from the cards —
a player may guess, and a lucky guess is not a mistake.

### Hints

Three branches, in this order, on the cards the player has actually collected:

1. **A mistake in the notebook**, said without ever naming the cell. It comes
   first because every correct hint given to a player reasoning from a bad
   notebook leads them further astray.
2. **The lowest-tier step** the solver found whose conclusion the notebook does
   not already hold. Lowest tier rather than first found: the step list is the
   order the rules happened to fire, and a player wants the easiest thing they
   missed.
3. **A topic to investigate** — who to ask and about what, for the next card
   the proof needs. A topic and a person, never a card id and never its
   content (invariant 8). It has to be an action the game actually has:
   physical evidence is pointed at by its *room*, because there is no
   examine-a-person action and "look into Suspect A", with nobody to ask, is
   advice that cannot be followed. The two clues about the victim name no room,
   so they point at the room the body was found in.

Then "you have everything you need". A test plays cases through by taking the
advice repeatedly, and asserts that the notebook stays sound at every step, that
each hint adds a mark, and that the sequence terminates.

### Difficulty

`difficulty.ts` holds the tier-to-name map (Easy ≤ 1, Normal 2, Hard 3, Expert
4) and the preset size table. **The actual tier is authoritative** — a preset is
a request, and asking for Expert may legitimately return a Hard case, which is
why each preset's band is two tiers wide. Every number in that table is a
*starting point* to be replaced from the wave-3 sim table; they are written down
now so the generator has something to aim at, not because they are right.

*(wave 3)* — the generator pipeline and the measured sim table.
