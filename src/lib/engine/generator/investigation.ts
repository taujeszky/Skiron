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
 * **Par is a starting point, twice over.** The count of essential actions is
 * exact; the multiplier is a guess the plan made before any case existed, and
 * task 10 replaces it with a number fitted to what a hint-following player
 * actually spends. Note when reading that number later that `hint.ts` solves
 * with no tier cap, so the scripted player it would be fitted to reasons at
 * tier 4 on an Easy case — a better player than the case is graded for.
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

/** Starting point, from the plan. Task 10 replaces it from the sim table. */
const PAR_MULTIPLIER = 1.5;

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
    par: Math.ceil(actions.length * PAR_MULTIPLIER),
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
