/**
 * The investigation: what the player has to *do* to be handed the proof, how
 * many moves that ought to take, and the trace the detective reads out at the
 * end.
 *
 * **The mapping from card to action is not invented here.** `hint.ts` already
 * decides which topic a card is pointed at by — a physical fact by the room
 * it was found in, a statement by the first thing its speaker can be asked
 * about — and branch 3 of a hint says that topic out loud. If this file made
 * the same decision a second time the two copies would drift, and the symptom
 * would be the cruellest kind of bug: a hint naming an action that releases
 * nothing. So `firstTopic` is imported, not reimplemented.
 *
 * **Par was a starting point, and wave 4 measured it.** See `PAR` below. The
 * short version is that the old formula — essential actions times 1.5 — was
 * calibrated against the shortest route through the case, which is a route
 * only something holding the answer can find.
 */

import { firstTopic } from "../solver/hint";
import type { Conclusion, Premises, Step } from "../solver/state";
import { topic } from "../types";
import type {
  CaseFrame,
  Clue,
  ClueId,
  PersonId,
  RoomId,
  SlotIndex,
  TopicKey,
} from "../types";

/** One thing the player can do. */
export type Action =
  | { kind: "examine"; room: RoomId; topic: TopicKey; releases: ClueId[] }
  | {
      kind: "ask";
      suspect: PersonId;
      topic: TopicKey;
      releases: ClueId[];
    };

export interface Investigation {
  /** The actions the proof needs, in the order the cards are numbered. */
  actions: Action[];
  /** The expected number of actions a competent player spends. */
  par: number;
  /** The deductions that actually bear on the answer. Wave 5 reads this. */
  trace: Step[];
}

/**
 * Par, and what changed about it in wave 4.
 *
 * The plan's formula was `essentialActions * 1.5`. That gave 6 on Easy and 13
 * on Expert, and it is calibrated against the wrong thing: the count of
 * essential actions is the *shortest route* through the case, and the only
 * way to find the shortest route is to already hold the answer. A player has
 * to search, and search costs moves that the shortest route knows nothing
 * about.
 *
 * Measured with `game/player.ts#blindPlay` — a scripted player that never
 * sees `essential`, reasons from the cards it holds and then asks whatever
 * question bears on the most still-open cells — over 40 cases a preset:
 *
 * ```
 * preset  menu  essential  undirected spend  mean  old par
 * easy      65        4.2     20 / p90  31   19.2        6
 * normal    96        6.2     29 / p90  53   31.1        9
 * hard     107        7.2     44 / p90  62   38.1       11
 * expert   146        8.3     57 / p90  95   57.0       13
 * ```
 *
 * Two things fall out of that. Par was between three and seven times too
 * tight, so nobody would ever have met it. And the spend correlates only
 * weakly with the essential count within a preset (r = 0.14 to 0.32) — what
 * drives it is the *size of the action menu*, which is the search space.
 *
 * Hence two terms: the shortest route, generously, plus a fifth of the house.
 * That lands on 20 / 29 / 33 / 42 against an undirected median of 20 / 29 /
 * 44 / 57, so Easy and Normal sit on the undirected player's number and the
 * larger presets sit below it — which is the right shape, because a big case
 * is where reading the cards instead of sweeping the grid buys the most.
 *
 * Still provisional, and honestly so: the scripted player ignores what cards
 * *say*, and a person does not. It is a measured anchor rather than a fitted
 * one, and the thing that would replace it is somebody playing.
 */
const PAR_ROUTE = 1.5;
const PAR_SEARCH = 0.2;

/**
 * How many distinct actions the interface offers on this frame.
 *
 * Examine each room; ask each suspect about each slot, about each person
 * other than themselves, about each room, and about the motive.
 *
 * `game/player.ts#everyAction` builds the actual list, and a test checks that
 * its length is this number — the formula is here because par needs it and
 * the engine may not import from the game layer, and the test is there
 * because two copies of a rule is exactly how the hint/investigation split
 * nearly went wrong.
 */
export function actionMenuSize(frame: CaseFrame): number {
  const rooms = frame.plan.rooms.length;
  const perSuspect = frame.slots + (frame.people - 1) + rooms + 1;
  return rooms + frame.suspects * perSuspect;
}

export function parFor(frame: CaseFrame, essentialActions: number): number {
  return Math.ceil(
    essentialActions * PAR_ROUTE + actionMenuSize(frame) * PAR_SEARCH,
  );
}

export function planInvestigation(
  frame: CaseFrame,
  essential: readonly Clue[],
  steps: readonly Step[],
): Investigation {
  const byKey = new Map<string, Action>();
  for (const clue of essential) {
    const key = firstTopic(frame, clue);
    if (clue.source.kind === "testimony") {
      const s = clue.source.speaker;
      const id = `ask:${s}:${key}`;
      const found = byKey.get(id);
      if (found) found.releases.push(clue.id);
      else {
        byKey.set(id, { kind: "ask", suspect: s, topic: key, releases: [clue.id] });
      }
      continue;
    }
    // Every fact's first topic is a room — `firstTopic` guarantees it, falling
    // back to the murder room for the two clues about the victim, which is
    // where a body is examined.
    const room = Number(key.slice(5));
    const id = `examine:${room}`;
    const found = byKey.get(id);
    if (found) found.releases.push(clue.id);
    else byKey.set(id, { kind: "examine", room, topic: key, releases: [clue.id] });
  }

  const actions = [...byKey.values()];
  return {
    actions,
    par: parFor(frame, actions.length),
    trace: sliceProof(steps),
  };
}

/* ----------------------------------------------------------- the trace */

/**
 * The deductions the answer actually rests on.
 *
 * A grading solve keeps going after the answer is unique, because the grid is
 * worth filling in and the hint system reads those steps (`solve.ts`). For a
 * summing-up that is noise: the detective does not recite every room they
 * crossed off, they recite the chain that cornered the killer. So this walks
 * backwards from the cuts into the answer set and keeps only what they lean
 * on, transitively, through the cells each step names as a premise.
 *
 * Steps are kept in their original order, because that is the order the
 * reasoning happened in and a proof read backwards is not a proof anybody
 * follows.
 */
export function sliceProof(steps: readonly Step[]): Step[] {
  // Which step last settled each cell. A premise naming a cell depends on
  // whatever narrowed it most recently before that point.
  const lastTouched = new Map<string, number>();
  const dependsOn: number[][] = [];
  for (let i = 0; i < steps.length; i++) {
    dependsOn.push(cellsOf(steps[i].premises).map((k) => lastTouched.get(k) ?? -1));
    for (const k of concluded(steps[i].conclusion)) lastTouched.set(k, i);
  }

  const keep = new Set<number>();
  const stack: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].conclusion.kind === "answer-cut") {
      keep.add(i);
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    for (const j of dependsOn[i]) {
      if (j < 0 || keep.has(j)) continue;
      keep.add(j);
      stack.push(j);
    }
  }
  return steps.filter((_, i) => keep.has(i));
}

function cellKey(p: PersonId, t: SlotIndex): string {
  return `${p}:${t}`;
}

function cellsOf(premises: Premises): string[] {
  return premises.cells.map((c) => cellKey(c.p, c.t));
}

function concluded(c: Conclusion): string[] {
  switch (c.kind) {
    case "room-set":
    case "rooms-out":
      return [cellKey(c.p, c.t)];
    default:
      // An answer-cut settles no cell, and a contradiction settles nothing at
      // all — both are read as the end of a chain rather than a link in one.
      return [];
  }
}

/* ------------------------------------------------------------ the checks */

/*
 * There is no `unreachable(investigation, essential)` here, and there was.
 * It collected the ids out of `actions[].releases` and filtered `essential`
 * by them — but `planInvestigation` builds those releases by walking
 * `essential`, so it was asking a list built from the essential cards whether
 * it contained the essential cards. It returned `[]` for every input,
 * including a bank that filed nothing at all, and `generate.ts` was treating
 * that as one of its two bug certificates. `bank.ts#reachable` asks the bank,
 * which is the thing that actually hands a card over.
 */

/**
 * Does the plan's action set actually contain this action?
 *
 * "Examine a room; ask a suspect about a slot, a person or a room" — and the
 * motive, which is what asking a suspect about themselves means. Anything
 * else is an action the interface has no button for.
 */
export function isOfferedAction(a: Action): boolean {
  if (a.kind === "examine") return a.topic.startsWith("room:");
  return (
    a.topic === topic.motive ||
    a.topic.startsWith("room:") ||
    a.topic.startsWith("slot:") ||
    a.topic.startsWith("person:")
  );
}
