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

## 9. The generator

```
buildFloorPlan -> drawCaseRules -> simulateTruth -> enumerateClues
              -> inventAlibi -> select -> answers -> buildBank -> planInvestigation
```

Each step is defined by what it is not allowed to know, and two of those
restrictions are load-bearing enough to have their own headings below.

### The case file is drawn before the evening, not after it

The plan had `enumerate.ts` choose the closures, bars and capacities alongside
everything else that is true of the world — pick a door nobody happened to use
and declare it locked. That works, and it leaks the answer. A rule chosen to
fit the truth is a *function* of the truth, so a player who knew how the
generator worked could read it backwards: a capacity of two means some room
really did hold two, a closure means that door really was unused. Drawn first,
from the floor plan alone, a rule is independent of the evening and says only
what it says. `simulateTruth` already accepts `rules` on its request and walks
everybody inside them, so the only cost is that a harsh draw makes the
simulation retry — measured at 0.04 to 0.11 retries a case, which is nothing.

The price is a new rejection: a rule drawn blind can land on the murder room
and clear everybody who could not have been there. `generate.ts` therefore
refuses any case whose opening cards solve it outright.

### No card may be the answer

Rule 5 says nobody but the killer is in `r*` from `t*` on. So every true clue
placing a living suspect there *names the killer*. `enumerate.ts#givesAwayAnswer`
bans those, and the ban is the single most load-bearing filter in the wave.

Measured by commenting out the `givesAwayAnswer` line in `enumerateClues`,
generating 60 cases a preset, and then classifying every shipped card with that
same predicate — so the number is "what would have gone out", not a proxy for it:

```
preset  proof set holds a giveaway   bank holds one   essential p50
easy    44/60  (73%)                 49/60  (82%)     3   (5 with the ban)
normal  27/60  (45%)                 34/60  (57%)     6
hard    23/60  (38%)                 28/60  (47%)     7
expert  16/60  (27%)                 17/60  (28%)     8
```

So without it, between a quarter and three quarters of cases ship holding a
card that *is* the answer. An earlier version of this section justified the ban
by the tier spread instead — "9 of 12 Easy and 5 of 12 Expert graded at tier 0"
— and an adversarial review could not reproduce the Expert half of that and was
right not to. The tier is the wrong measure: a case can grade tier 3 and still
contain a card naming the killer, because the grade describes the reasoning the
clue set *supports*, not the shortest way through it. "Does a card name the
killer" is the question, and by that measure the ban earns its place on every
preset.

**The hour needs the same argument, and a sharper test than it first had.** The
player holds the briefing's death window from the first second, so a card is a
giveaway when what it leaves *against that window* is a single slot — not
merely when it names one slot by itself. `DeathWindow(0, 1)` read against a
briefing of `[1, T-2]` pins `t*` exactly as loudly as `DeathWindow(1, 1)` does,
and so does `AliveAt(T-3)`. The first version tested `a === b` and shipped 19
hour-pinning cards in 60 Easy banks.

The same argument applies to the speaker, not just the statement. A suspect who
could only have learned something by standing in `r*` at or after `t*` confesses
by knowing it, so the knowledge model refuses that vantage point. The
consequence is that the culprit is necessarily silent about the murder hour —
which is what `bank.ts#spreadGaps` exists to cover up.

### A sample, not everything

The plan said "start from every clue, shuffle, and drop each clue if the solver
still finishes without it". Measured over 20 seeds a preset, the pool is 625
clues on Easy and 2,089 on Expert once every speaker who could say a thing is
counted — four times the count of distinct *bodies*, which is the number it is
easy to quote by mistake — and the pass costs one `solve` per clue: 76 ms on
Easy and 1,503 ms on Expert, most of it spent proving over and over that the
four hundredth `NotAt` was not load-bearing. Drawing a weighted sample first
and growing it only when the draw fails to prove the case reaches the same
shipped set for a quarter to a seventh of that.

The counter-intuitive part, which decides how the loop is sized: **the
expensive solves are the refused drops, not the accepted ones.** A solve on a
set that still proves the case settles at tier 0 in 0.25 ms even with 400
cards; a solve on a set that no longer does burns the whole hypothesis budget
before admitting defeat. So the cost is roughly "how many drops were refused",
and a smaller working set is cheaper twice over.

### Two grades, and why the second one is a rejection

`tier` is the grade of the proof set — the hardest reasoning needed by a player
holding exactly the cards the proof needs. It is what the hints walk through and
what the summing-up recites. But nothing stops a player asking everybody
everything, and the case they then hold is a different, easier one.

That difference is not small. During this wave a bank that released every fact
filed under a room made **16 of 16 cases solvable at tier 0 by searching rooms
and never asking a single question** — the suspects, the lies and the whole
trust tier reduced to scenery. So `playTier` is measured on everything the bank
can ever release, and a case whose `playTier` falls below the preset floor is
thrown back. It is a rejection criterion rather than a statistic, because a
number nobody acts on would not have caught that. The label the player sees is
`difficultyForTier(playTier)`: the grade they are guaranteed to face however
thorough they are.

Note the asymmetry behind it. With lying off everyone is trusted from the
start, so every extra statement is live immediately and volume collapses the
grade. With lying on nobody's testimony is active until somebody has been
cleared, so a pile of statements is inert until the facts have done their work.
Grade leakage is mostly an Easy and Normal problem, and it comes from physical
evidence rather than from talk.

### The killer's story

A lie can never make a case unfair, and it is worth knowing why: a testimony by
`s` asserts `s ≠ culprit ⇒ φ`, so in the true world the culprit's own
statements assert nothing at all. The true answer survives every lie, and a lie
can only remove other answers. There is therefore no fairness check in
`lies.ts`.

A lie is also **inert until the solver doubts its teller** — with lying on no
testimony is active at depth 0, so a lie narrows no cell. It waits for tier 3 to
suppose the culprit innocent and then falls apart. That gives the two conditions
a story must meet, and both are measured by solving with `lying` turned off,
which is exactly what tier 3's branch does to the suspect it supposes innocent:
the story must not contradict on its own (or tier 3 fires for free and the case
is graded Hard for nothing), and it must fall to the facts (or tier 3 can never
fire at all). The second is a necessary condition, not a sufficient one — the
real branch has only the cards the player has collected — and the sim table
measures the rest.

The construction is a one-slot detour: the culprit claims a room reachable from
where they really were and leading to where they really went next. Being
walkable by construction is what keeps it from contradicting itself. Every
true statement of the culprit's that the story falsifies is **retracted**, not
merely outvoted — a killer whose own two cards refute each other hands tier 3 a
free win. On Expert the story also names an innocent as having been there.
That cannot mislead a solver, since refuting an innocent's innocence is
impossible while the rules are sound; what it does is give conflict-pair
something to bite on, and give the player the red herring the genre is built on.

### The measured table

`npm run sim`, 120 cases per preset, 480 in all, on this machine (win32-arm64,
node 22.17). **Zero certificate failures**: on every case the exhaustive solver
returned exactly the true answer, both for the proof set and for the full bank.

```
preset  made     att  ms p50/p95/max   essential  bank  par  proof tier   play tier
easy    120/120  1.85    12/  43/  76   5 ( 3- 8)   27    6   0:27 1:93   0:35 1:85
normal  120/120  1.19    33/  64/  96   6 ( 3-17)   33    8   1:25 2:95   1:38 2:82
hard    120/120  1.30   122/ 222/ 375   8 ( 3-27)   37   11   3:120      2:11 3:109
expert  120/120  1.76   279/ 818/1009   9 ( 3-22)   43   12   3:56 4:64   3:90 4:30
```

Rejections per made case:

```
preset  legible-gap  mute-culprit  play-tier  tier  unsolvable
easy           0.59          0.00       0.00  0.00        0.26
normal         0.02          0.00       0.06  0.07        0.04
hard           0.02          0.17       0.05  0.03        0.03
expert         0.00          0.48       0.08  0.06        0.13
```

The exit criterion was a p95 under five seconds in a worker. Expert's p95 is
0.8 s and its worst case 1.0 s, so there is room to spare.

**The proof sets are irredundant, measured rather than assumed.** `select.ts`
only claims its greedy pass is minimal *for the order it used*, because tier 3
reads the whole clue list when it asks whether everybody it supposes innocent
has spoken, so an earlier drop can change what a later one may do. A second
pass over all 480 cases found **0.00 removable cards per case** on every
preset. It is still not a theorem, but it is no longer a worry either.

**What the table changed.** The first run had Expert collapsed into Hard: 69 of
80 Expert cases graded tier 3, exactly like Hard's 80 of 80, so the two hardest
presets were the same puzzle with different labels. The plan's risk list
predicted that shape of failure and named the clue-type mix as the lever. Three
rounds of tuning:

1. Starve the top presets of cards that *place* somebody. `At`, `AloneIn`,
   `Saw` and `Stayed` pin a cell outright, and a case made of them is one tier 0
   can walk; counting and company clues constrain without placing. Expert's
   tier-4 share went from 14% to 37%.
2. Starve Expert of cards that pin the *hour*. Tier 4 is usually what settles
   the slot once tier 3 has found the culprit, so `AliveAt` and `DeathWindow`
   are what stand between a case and needing it. Expert's tier-4 share went to
   53%, and the curve flattened after that — 0.05 bought 57% for a higher p95,
   so 0.1 is the knee and is what is written down.
3. Give Hard the false sighting too. The plan reserved it for Expert as a
   starting point, and the measurement overruled that: with one lie card the
   killer's story survived selection in 6 of 44 Hard cases, and with the
   sighting as well, in 24 of 46. The second card is what makes the story
   load-bearing, because it is what gives conflict-pair something to bite on.

The mix that fell out of it is a real difficulty gradient rather than just a
size one: Easy's proof sets are made of `Saw`, `AloneIn` and `At` — cards that
say where somebody was — while Expert's lead with `Count` and `Together`, which
say only how many and with whom.

```
easy    Saw 22%  AloneIn 19%  At 19%  Stayed 10%  NeverVisited 10%  ...
normal  Saw 22%  At 12%  Count 12%  AloneIn 12%  Stayed 10%  ...
hard    Count 17%  Saw 16%  Together 14%  DeathWindow 9%  AloneIn 7%  ...
expert  Count 18%  Together 16%  Saw 16%  Stayed 8%  At 7%  ...
```

Every clue kind is essential to some case in the sample, so none is carrying no
weight — `AliveAt` is thinnest at 1–2% and is the one to watch. `Hard` never
uses the bottom of its band: all 120 cases graded tier 3, because with lying on
the trust tier almost always has something to say. That is not a fault — Hard
*is* the lying preset — but it means Hard's floor of 2 is currently decorative.

The killer's story now reaches the shipped proof set in **33% of Hard cases and
45% of Expert**, against 2% and 20% before the tuning. The dominant rejection on
Expert is still `mute-culprit` at 0.48 a case — a case that graded tier 4 by
pure hypothesis without the killer ever having spoken — and on Easy it is
`legible-gap` at 0.59, which is the placement leak below being caught and
thrown back rather than shipped.

### What the adversarial review found

Waves 1 and 2 were each reviewed adversarially when they were finished, and
both earned their keep. Wave 3's review ran eight independent lenses —
soundness, determinism, information leaks, the knowledge model, grade
integrity, playability, mutation testing and conformance — with every finding
sent to two skeptics told to refute it. Twenty-four survived, collapsing to
eleven distinct defects. Four are worth recording here; the rest are in the
plan file.

**The bank could name the killer, twice over, and both were measured in
percent rather than argued about.** The generator has to keep rule 7's promise
that silence proves nothing, because the killer is the one person who may not
speak from the murder room. The code that did that was a best effort which
reported nothing when it failed, so nothing downstream could act on it: **1.3%
of Easy and Normal cases shipped with the killer as the only suspect with
nothing to say about the murder hour.** A case you win by asking four people
one question.

The second face of it was far larger and nobody had thought of it at all. No
card can ever *place* the culprit at `t*` — the only true one would name them —
so if every other suspect has a card placing them at the murder hour, the blank
row is the answer. That was **47% of Easy cases and 9% of Normal**. Lying
presets barely felt it, and the reason is worth keeping: the killer's false
alibi is itself a card placing them at the murder hour, which is what an alibi
is for.

Both are now closed the honest way round — by giving the killer something to
say and someone else to be unaccounted-for with, rather than by gagging
innocents — and, more to the point, both are now *checked* by functions that
are deliberately not the fixers, with `generate.ts` throwing the case back.

**Two certificates could not fire.** `unreachable(investigation, essential)`
built its action list by walking `essential` and then asked whether that list
contained `essential`; it returned "all reachable" for any bank at all,
including one that filed nothing. And three tests that looked like they guarded
the giveaway ban and the knowledge model asserted `givesAwayAnswer(...) ===
false` and `couldKnow(...) === true` over cards those same functions had just
filtered — so any weakening of either satisfied its own test. The first now
asks the bank; the second now asks the solver.

**The golden vectors were blind to the bank.** They summarised the whole
statement bank as `allCards().length`, so the function that decides which
suspects are left with nothing to say could be rewritten from top to bottom,
change every conversation in the game, and leave the file green. A count is not
a signature; the vectors now carry a checksum of who says what.

**Two of the three probes in `lies.ts` could not fail.** One was logically
subsumed by another; the other asked that the story "fall to the facts", and it
always did, because `NotAt(culprit, t*, room)` is in the pool by construction
and flatly contradicts `At(culprit, t*, room)`. That is worth knowing for its
own sake: the plan's requirement that a lie be "not refuted by any single card"
is **unachievable in this clue language**, since every positional claim has its
own direct denial. What stands between the player and the answer is not the
scarcity of the refutation but having to hold both cards and make a trust
argument from them.

The pattern across all four is the one wave 2 found as well, and it is worth
saying plainly because it will recur: **the property was usually already
asserted somewhere, and the assertion was the thing that was broken.** A test
that calls the function under test to decide whether the function under test
was applied, a certificate derived from the thing it certifies, a signature
that summarises what it is meant to watch — each looks like coverage and is
not. The silence property even had a correct test, over sixteen cases, against
an event that happens 1.3% of the time.

### Still a starting point

The preset shapes and tier bands in `difficulty.ts`, the case-file budgets in
`caseRules.ts`, the filler counts in `bank.ts`, and par's 1.5 multiplier. Par in
particular is only the plan's guess: fitting it properly means driving `hint.ts`
with a scripted player, and `hint.ts` solves with no tier cap, so such a player
reasons at tier 4 even on an Easy case. That is a wave-4 measurement.

---

## 10. The game

Wave 4 puts a player in front of the engine. Three layers, and the split
between them is the same one the rest of the project uses: `game/` is pure
TypeScript with no DOM and its own tests, `ui/` is Svelte and is untested by
convention, and the seam between them is `game/controller.ts` — every store
the screens share and every action that changes one.

### A save is a case number and nothing else

`GeneratedCase` is full of `Map`s and `Set`s that `JSON.stringify` drops
without a word, so a "saved case" would round-trip into a case with an empty
bank and no symptom until the player asked somebody a question. What is stored
is the case id plus what the player has done to it — collected card ids, the
notebook's three fields, the actions spent, the hints and the wrong names —
and `resume` rebuilds the rest. That is invariant 4 doing real work rather
than being a property nobody depends on.

Two guards, at two levels, because neither can do the other's job:

- `storage.ts` validates the shape of everything it reads back. A value in a
  browser's storage was written by whatever version of Skiron that person last
  ran, and `JSON.parse(...) as Save` would hand the game a notebook of the
  wrong shape. `storage.test.ts` feeds the parsers corrupt input to prove they
  can say no, and one test at the end feeds them a correct save to prove they
  are not simply refusing everything.
- `controller.ts` checks the rebuilt frame against the notebook it was handed,
  which `storage.ts` cannot: the save is parsed *before* the case is rebuilt,
  because the case id is inside the save. A notebook that does not fit is not
  a recoverable save; it is a save from a different house, and it is dropped.

### Par was measured, and the old number was wrong by a factor of four

The plan's formula was `essentialActions * 1.5`, giving 6 on Easy and 13 on
Expert. It is anchored on the wrong thing: the essential action count is the
*shortest route* through the case, and the only way to find the shortest route
is to already hold the answer.

So `game/player.ts` adds a second scripted player. The one wave 3 has follows
`hint()`, which is handed the proof set; this one never sees `essential`,
`investigation.actions` or the truth. It reasons from the cards it holds,
looks at which cells are still open, and asks whatever question bears on the
most of them. `npm run par` runs it:

```
preset  menu  essential   par  spent p50/p90/mean   r(ess)  hit%  live%
easy      65        4.2  19.6     20 /  31 / 20.5    -0.15   64%    49%
normal    96        5.8  28.5     29 /  47 / 29.6     0.38   58%    44%
hard     107        7.4  32.9     28 /  49 / 33.2     0.17   55%    41%
expert   146        9.0  43.3     61 / 109 / 61.4     0.27   43%    37%
```

Two things fall out. The old par was between three and seven times too tight,
so nobody would ever have met it. And within a preset the spend barely tracks
the proof length (r = −0.15 to 0.38) — what drives it is the size of the
action menu, which is the search space. Hence two terms:
`essential * 1.5 + menu * 0.2`, the shortest route generously plus a fifth of
the house. It lands on 20 / 29 / 33 / 42, which sits on the undirected
player's median for the small presets and below it for the large ones — the
right shape, because a big case is where reading the cards instead of sweeping
the grid buys the most.

Still provisional, and honestly so: the scripted player cannot read what a
card *says*. It is a measured anchor, not a fitted one.

**`hit%` and `live%` are the numbers to watch for feel.** `live%` is how many
of the menu's questions can pay at all; `hit%` is how many of the ones this
player actually asked did. Between two fifths and two thirds of questions
turn something up, which is a reasonable rhythm rather than a slog — and that
`hit%` exceeds `live%` on every preset is the open-cell heuristic earning its
place over asking at random.

### The plan's intended loop does not survive being taken literally

The plan describes the loop as "deduce → aim the next question", with
"somebody was in the library at nine" telling you what to ask about. Scored
directly — a question gains for every held card that mentions its room, slot
or person — it makes the player **worse**, monotonically:

```
lead weight   easy  normal  hard  expert      (mean actions spent)
          0   19.2    31.1  38.1    57.0
          1   21.5    33.7  42.7    60.9
          3   33.8    49.0  46.9    63.9
          8   46.5    63.8  70.6    83.6
```

The reason is plain once seen: a card mentions ground you have already
covered. Chasing it walks you back over what you know, while the open-cell
score walks you towards what you do not. The useful reading of "aim the next
question" is aim at what is still *open* — and a card helps with that only
through what it closes, which the reasoning step has already done by the time
the question is chosen. The option stays in `player.ts`, defaulting to zero,
so the claim stays checkable; wave 6 is where it is worth revisiting, because
a person following up a lead is also following up a *sentence*, and this
player cannot read.

### The notebook only complains about what cannot be finished

`errors.ts` takes a frame and a notebook and **no world**. That is not a
convention but the guarantee: a function with no access to the truth cannot
leak it however it is later edited. The Check is the thing that compares with
the truth, it costs the player something, and it answers one bit.

Only uncompletable states are flagged. A notebook that is merely *wrong* — the
player has crossed out the room somebody was really in — is perfectly
consistent, and flagging it would be the Check for free. What is flagged is a
notebook no assignment of people to rooms could satisfy, because that is a
bookkeeping slip rather than a wrong belief.

The plan listed four such states. There are six: the two extra are a person
pencilled into a room the case file bars them from, and more suspects in a
room than it holds. Both are certainly uncompletable and decidable from the
notebook alone, which is the stated principle; leaving them out meant the
status bar staying silent about a mark that flatly contradicts a rule printed
on the briefing screen. Capacity counts **suspects only** — the player does
not know which hour the victim died in, so counting the body could flag a
notebook that is legal with a corpse in the corner, and suspects alone are a
lower bound on the living.

The guard on all of it is Signpost's: play a whole correct solve in scrambled
order and demand silence. Every mark is true, so at no point is the notebook
uncompletable and the status bar must have nothing to say the whole way
through — over generated cases, so that real closed doors, barred rooms and
capacities are in play, since every one of them is something a checker could
be too eager about.

### The UI, and the one guard that reaches it

The investigation is three panes on a desk and three tabs on a phone, all
three mounted at every width — the tabs only hide them, because a scroll
position and a filter are state the player set.

The floor plan's SVG user units **are** the engine's grid units, so nothing in
the renderer invents a position and the picture cannot disagree with the
adjacency the solver reasons over. Tokens are solid for somebody the notebook
has placed and dashed for somebody it merely still allows; the component never
sees the world except on the summing-up screen, where it is handed one after
the accusation has already been compared with it.

Everything the game says comes out of one panel — hints, the Check, what a
search turned up and what it did not — because two would compete, and a player
who searched a room straight after a hint would lose the hint without noticing.

`tools/playthrough.mjs` is the guard, and the wave's most important one. The
UI is untested by convention, so between a green suite and a playable game
there was nothing but somebody having looked; this drives headless Chrome over
CDP and plays a case through the actual buttons — clicks a difficulty, clicks
Begin, presses Hint and does exactly what the hint says, then reads the
surviving suspect and hour **off the notebook's own strikethroughs** and names
them. It found, on its first run, that auto-notes fired when a card was
*collected* and the opening is never collected, so a case opened with the
setting on sat on a blank grid while the hint panel recited deductions the
setting had promised to make. Looking at its screenshots found three more that
type-checking could not: a grid whose room chips never wrapped and ran off the
side of its own pane on every preset, evidence cards with no `flex: none` that
collapsed into empty strips, and a floor plan stretched into a tall box with a
small house floating in it.

### Offline means generation, not just loading

Skiron ships no case pack, so "playable offline" means the generator has to
run with nothing to fetch. That is the thing a service worker gets wrong
quietly: Vite emits the generator's Web Worker as its own chunk under
`_app/immutable/workers/`, and SvelteKit's `$service-worker` manifest **does
not list it** — verified for this build, not merely inherited from Signpost.
Precaching the manifest alone gives an app that opens offline, shows the desk,
and hangs forever on "Building a case". The cache-first branch keys off
`/immutable/` as well as the manifest, so the chunk is cached the first time
it is fetched.

`npm run offline` is the check: install the worker, take one case online (the
only thing that fetches the chunk), cut the network, reload from cache, and
take a fresh case of every difficulty. Its own first version proved the plug
was out by fetching the app's own URL and was satisfied when the request
resolved — but a service worker answers same-origin requests from the cache,
which is its entire job, so that check passed on a live network and failed on
a dead one. It uses a cross-origin request now, which `service-worker.ts`
declines to handle and which therefore reaches the network or does not happen.

