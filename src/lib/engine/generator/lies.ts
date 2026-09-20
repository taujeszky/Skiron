/**
 * The killer's story.
 *
 * With lying on, the culprit is given a false alibi for the murder slot: they
 * were not in the room where the body lies, they were somewhere else, and
 * perhaps somebody saw them there.
 *
 * **A lie can never make a case unfair, and it is worth knowing why.** A
 * testimony by `s` asserts `s ≠ culprit ⇒ φ` (`axioms.ts#testimonyBinds`), so
 * in the true world the culprit's own statements assert nothing at all — the
 * implication is vacuous where `s = culprit`. The true answer therefore
 * survives every lie, and a lie can only *remove* other answers, never add
 * one. So there is no fairness check in this file, and there should not be:
 * `answers()` belongs once per case in `generate.ts` and nowhere else.
 *
 * **A lie is inert until the solver doubts the culprit.** For the same
 * reason, a lie narrows no cell in the main run: while the culprit is still a
 * candidate their testimony is not active (`state.ts#trustedMask`), and with
 * lying on nobody's testimony is active until somebody has been cleared. All
 * a lie does is wait for tier 3 to suppose its teller innocent and then fall
 * apart — which is the whole of "his story cannot be true, so he is lying, so
 * he did it".
 *
 * That it narrows no cell does not mean it settles nothing. Tier 3's
 * conclusion is `clearSuspects`, and `killPairs` closes every hour no
 * surviving pair still uses, so a story falling apart can pin the murder slot
 * outright. It is only the *grid* a lie leaves alone.
 *
 * So there is exactly **one** condition worth testing, and `contradicts` is
 * how it is tested. Turning `lying` off makes every testimony bind, which is
 * what tier 3's branch does to the suspect it supposes innocent:
 *
 * > **The killer's account must not convict the killer by itself.** If the
 * > story plus their own retained true statements cannot all stand, tier 3
 * > fires on the first pass with no other card in play, and the case is
 * > graded Hard for a deduction nobody had to make.
 *
 * A one-slot detour is walkable by construction, so it is the culprit's own
 * *true* statements that can collide with it — which is why `retracted`
 * exists, and why it is a deletion and not merely an addition.
 *
 * **Two other probes were here and are gone**, because a review showed
 * neither could ever fail.
 *
 * One asked whether the story contradicted with only the case file beside it.
 * Adding clues can only add constraints, so a contradiction on that smaller
 * set implies one on the set the remaining probe uses: it could only fire
 * where the other already had.
 *
 * The other asked that the story "fall to the facts" — that the physical
 * evidence be able to refute it — on the grounds that a lie nothing can catch
 * is decoration. It passed every time, and it had to. The story is
 * `At(culprit, t*, room)`, and `trueBodies` emits `NotAt(p, t, r)` for every
 * room a person was not in, so `NotAt(culprit, t*, room)` is always in the
 * pool as a fact and flatly contradicts it. That is worth knowing for its own
 * sake: **the plan's requirement that a lie be "not refuted by any single
 * card" is unachievable in this clue language**, because every positional
 * claim has its own direct denial. What stands between the player and the
 * answer is not the scarcity of the refutation but having to hold both cards
 * and make a trust argument from them, and whether that actually happens is
 * what the tier band and the sim table measure.
 */

import { canMove } from "../axioms";
import { holds } from "../clues";
import { RNG } from "../rng";
import { solve } from "../solver/solve";
import type {
  CaseFrame,
  Clue,
  ClueBody,
  ClueId,
  PersonId,
  RoomId,
  World,
} from "../types";

export interface Alibi {
  /** The room the culprit claims to have been in when the murder happened. */
  room: RoomId;
  /** The false statements themselves. */
  lies: Clue[];
  /**
   * Ids of the culprit's own true statements that the story contradicts.
   * They must be taken out of the pool, not merely outvoted: a culprit whose
   * two cards refute each other hands tier 3 a free win.
   */
  retracted: Set<ClueId>;
  /** The innocent a false sighting names, or null. */
  framed: PersonId | null;
}

export interface LieOptions {
  /** Name an innocent as having been there too. Expert, as a starting point. */
  frameInnocent?: boolean;
}

/**
 * Invent the killer's alibi, or return null if the house offers nowhere to
 * claim to have been.
 *
 * Null is not a failure worth retrying an attempt over: a lying case whose
 * culprit tells the truth is legal (rule 7 says the killer's statements *may*
 * be false), it is only duller. `generate.ts` counts it.
 */
export function inventAlibi(
  rng: RNG,
  frame: CaseFrame,
  world: World,
  opening: readonly Clue[],
  pool: readonly Clue[],
  nextId: number,
  opts: LieOptions = {},
): Alibi | null {
  const c = world.culprit;
  const tStar = world.murderSlot;
  // The murder slot is drawn from the middle of the evening, so both
  // neighbours exist; a story with nothing either side of it would be a claim
  // about one instant and unwalkable to check.
  if (tStar <= 0 || tStar >= frame.slots - 1) return null;

  const before = world.loc[c][tStar - 1];
  const after = world.loc[c][tStar + 1];

  // Rooms the culprit could plausibly claim: reachable from where they really
  // were, and leading to where they really went next. A one-slot detour, so
  // the story is walkable without a feasibility sweep of its own.
  const candidates = rng.shuffle(
    frame.plan.rooms
      .map((room) => room.id)
      .filter(
        (r) =>
          r !== frame.murderRoom &&
          canMove(frame, c, before, r, tStar - 1) &&
          canMove(frame, c, r, after, tStar),
      ),
  );

  // One draw here, and a derived RNG per candidate — the same discipline as
  // `simulateTruth` and `buildFloorPlan`. Drawing inside the loop would make
  // the number of numbers taken from the caller's stream depend on how many
  // rooms were tried, so every later step of the generator would shift and a
  // case id would stop rebuilding the same case (invariant 4).
  const base = rng.next();
  for (let i = 0; i < candidates.length; i++) {
    const room = candidates[i];
    const sub = new RNG(`skiron-alibi:${base}:${i}`);
    const story = storyWorld(world, c, tStar, room);
    const retracted = new Set<ClueId>();
    for (const k of pool) {
      if (k.source.kind !== "testimony" || k.source.speaker !== c) continue;
      if (!holds(k.body, frame, story)) retracted.add(k.id);
    }

    const framed = opts.frameInnocent
      ? pickFramed(sub, frame, world, c, tStar, room)
      : null;
    const bodies: ClueBody[] = [{ kind: "At", p: c, t: tStar, r: room }];
    if (framed !== null) {
      bodies.push({ kind: "Saw", p: c, q: framed, t: tStar, r: room });
    }
    const lies = bodies.map((body, i) => ({
      id: `c${nextId + i}`,
      body,
      source: { kind: "testimony", speaker: c } as const,
    }));

    // The one condition: the killer's own account must not convict them.
    const mine = pool.filter(
      (k) =>
        !retracted.has(k.id) &&
        k.source.kind === "testimony" &&
        k.source.speaker === c,
    );
    if (contradicts(frame, [...opening, ...mine, ...lies])) continue;

    return { room, lies, retracted, framed };
  }
  return null;
}

/**
 * Believe the culprit and see what happens.
 *
 * Turning `lying` off is what makes every testimony bind, which is the same
 * thing tier 3 does to a suspect it supposes innocent. The frame is copied
 * rather than mutated because the real frame is shared with the world, the
 * pool and the solvers.
 */
function contradicts(frame: CaseFrame, clues: readonly Clue[]): boolean {
  return solve({ ...frame, lying: false }, clues, { record: false })
    .contradiction;
}

/** The world the killer describes: theirs, with one hour moved. */
function storyWorld(
  world: World,
  c: PersonId,
  t: number,
  room: RoomId,
): World {
  const loc = world.loc.map((row) => [...row]);
  loc[c][t] = room;
  return { ...world, loc };
}

/**
 * An innocent to place at the scene of the alibi who was not there.
 *
 * It cannot mislead a solver — refuting an innocent's innocence is impossible
 * while the rules are sound, so nobody is ever wrongly cleared or wrongly
 * accused by it. What it does is give tier 3's conflict-pair rule something
 * to bite on: two accounts that cannot both be true, so one of the two did
 * it and everybody else is in the clear. For the player it is the red herring
 * the genre is built on.
 */
function pickFramed(
  rng: RNG,
  frame: CaseFrame,
  world: World,
  c: PersonId,
  t: number,
  room: RoomId,
): PersonId | null {
  const others: PersonId[] = [];
  for (let s = 0; s < frame.suspects; s++) {
    if (s !== c && world.loc[s][t] !== room) others.push(s);
  }
  return others.length === 0 ? null : rng.pick(others);
}

/** The pool with the story told: the retractions gone, the lies added. */
export function tellStory(pool: readonly Clue[], alibi: Alibi | null): Clue[] {
  if (!alibi) return [...pool];
  return [...pool.filter((c) => !alibi.retracted.has(c.id)), ...alibi.lies];
}

/** Does this set hold a statement by the culprit? `tier3.ts#allSpeak` wants one. */
export function culpritSpeaks(clues: readonly Clue[], culprit: PersonId): boolean {
  return clues.some(
    (c) => c.source.kind === "testimony" && c.source.speaker === culprit,
  );
}

/** How many of these statements are false in the true world. For the tests. */
export function falseStatements(
  frame: CaseFrame,
  world: World,
  clues: readonly Clue[],
): Clue[] {
  return clues.filter((c) => !holds(c.body, frame, world));
}
