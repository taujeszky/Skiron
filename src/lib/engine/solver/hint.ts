/**
 * Hints, and the one-bit Check.
 *
 * A hint runs the deduction solver on the cards the player has actually
 * collected — never on the full clue set — and then says the first of three
 * things that applies:
 *
 *  1. **Something in the notebook is wrong.** Said without ever naming the
 *     cell, because naming it would hand over a square of the answer grid.
 *  2. **Here is the next deduction.** The lowest-tier step the solver found
 *     whose conclusion the notebook does not already hold, in English.
 *  3. **Here is what to ask next.** When the collected cards have nothing
 *     left to give, the topic that releases the next card the proof needs.
 *
 * The order is the point. A player reasoning from a notebook with a mistake
 * in it is being led further astray by every correct hint they are given, so
 * that branch comes first even though it is the least informative.
 *
 * **Branch 1 does not go through a solver** (critical invariant 5). It
 * compares the notebook with the stored truth, so a solver bug can make a
 * hint useless but can never tell a player that a true thing is false. The
 * same comparison is the Check button's one bit of output, which is why it is
 * exported under its own name.
 *
 * **A hint never reveals a card the player has not earned** (invariant 8).
 * Branch 3 hands back a topic and, for testimony, who to ask — an action, not
 * an answer. The card's content stays where it was.
 */

import { bit, bitsOf, fullMask, popcount } from "../bits";
import { clueTopicKeys } from "../clues";
import { topic } from "../types";
import type {
  CaseFrame,
  Clue,
  Glossary,
  PersonId,
  RoomId,
  SlotIndex,
  TopicKey,
  World,
} from "../types";
import { defaultGlossary, explainer } from "./explain";
import { solve } from "./solve";
import type { Conclusion, Step } from "./state";

/* ------------------------------------------------------------ the notebook */

/**
 * The player's pencil marks.
 *
 * Deliberately coarser than `SolverState`: the grid crosses out rooms, and
 * two separate lists cross out suspects and hours. A player does not keep a
 * candidate *pair* per suspect, and pretending they do would make the hint
 * system offer deductions nobody could write down.
 *
 * It lives here rather than in the UI because the Check needs it and the
 * engine must stay pure; wave 4's store wraps it rather than replacing it.
 */
export interface Notebook {
  /** ruledOut[person][slot] = rooms the player has crossed out. */
  ruledOut: number[][];
  /** Suspects crossed off as the culprit, as a person bitmask. */
  clearedSuspects: number;
  /** Hours crossed off as the murder slot, as a slot bitmask. */
  ruledOutSlots: number;
}

export function newNotebook(frame: CaseFrame): Notebook {
  return {
    ruledOut: Array.from({ length: frame.people }, () =>
      new Array<number>(frame.slots).fill(0),
    ),
    clearedSuspects: 0,
    ruledOutSlots: 0,
  };
}

/**
 * The Check: is everything the player has crossed out actually false?
 *
 * One bit, as in Signpost, and it compares with the stored truth rather than
 * asking a solver — so it cannot be wrong in the direction that matters, and
 * a player who trusts it is not trusting the deduction rules.
 *
 * Note what it does *not* check: that the notebook is complete, or that the
 * marks follow from the cards. A player is free to guess, and a lucky guess
 * is not a mistake.
 */
export function notebookIsSound(
  frame: CaseFrame,
  notebook: Notebook,
  world: World,
): boolean {
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t < frame.slots; t++) {
      if ((notebook.ruledOut[p][t] & bit(world.loc[p][t])) !== 0) return false;
    }
  }
  if ((notebook.clearedSuspects & bit(world.culprit)) !== 0) return false;
  if ((notebook.ruledOutSlots & bit(world.murderSlot)) !== 0) return false;
  return true;
}

/* ---------------------------------------------------------------- hints */

export type Hint =
  /** The notebook contradicts the truth. Which cell is never said. */
  | { kind: "mistake"; text: string }
  /** The next deduction the collected cards support. */
  | { kind: "deduction"; text: string; step: Step }
  /**
   * What to do next. `ask` is the suspect to question, or null for a room
   * the player should examine. No card content, and no card id: an action.
   */
  | { kind: "investigate"; text: string; topic: TopicKey; ask: PersonId | null }
  /** Nothing left to find. */
  | { kind: "accuse"; text: string };

export interface HintInput {
  frame: CaseFrame;
  /** The cards in the notebook. The solver sees these and nothing else. */
  cards: readonly Clue[];
  notebook: Notebook;
  /** The truth, for branch 1 only. */
  world: World;
  /**
   * Cards the case's proof needs that the player has not collected, in the
   * order the generator wants them found. Wave 3 supplies this; without it
   * the hint simply stops after branch 2.
   */
  essential?: readonly Clue[];
  glossary?: Glossary;
}

export function hint(input: HintInput): Hint {
  const { frame, cards, notebook, world } = input;
  const g = input.glossary ?? defaultGlossary(frame);

  // 1. A mistake beats every other hint, because every other hint would be
  //    building on it.
  if (!notebookIsSound(frame, notebook, world)) {
    return {
      kind: "mistake",
      text:
        "Something crossed out in the notebook is true. Go back over what " +
        "you are sure of before going further.",
    };
  }

  // 2. The cheapest deduction the collected cards support and the notebook
  //    has not made.
  const result = solve(frame, cards);
  const next = cheapestNews(frame, result.steps, notebook);
  if (next) {
    return {
      kind: "deduction",
      text: explainer(frame, cards, g).step(next),
      step: next,
    };
  }

  // 3. Nothing more is in the cards. Point at what would be.
  const wanted = (input.essential ?? []).find(
    (c) => !cards.some((have) => have.id === c.id),
  );
  if (wanted) {
    const key = firstTopic(frame, wanted);
    const ask = wanted.source.kind === "testimony" ? wanted.source.speaker : null;
    return {
      kind: "investigate",
      text: investigateText(frame, key, ask, g),
      topic: key,
      ask,
    };
  }

  return {
    kind: "accuse",
    text:
      "Everything the cards can prove is already in the notebook. " +
      "Name the killer and the hour.",
  };
}

/* --------------------------------------------------------------- picking */

/**
 * The lowest-tier step whose conclusion the notebook does not already hold.
 *
 * Lowest tier rather than first found, because the solver's step list is the
 * order the rules happened to fire and a player wants the easiest thing they
 * missed, not the first thing the machine noticed. Ties go to the earlier
 * step, which keeps the answer stable for the same notebook.
 */
function cheapestNews(
  frame: CaseFrame,
  steps: readonly Step[],
  notebook: Notebook,
): Step | null {
  let best: Step | null = null;
  for (const step of steps) {
    if (!isNews(frame, step.conclusion, notebook)) continue;
    if (best === null || step.tier < best.tier) best = step;
  }
  return best;
}

/** Would this conclusion put a mark in the notebook that is not there yet? */
function isNews(
  frame: CaseFrame,
  c: Conclusion,
  notebook: Notebook,
): boolean {
  switch (c.kind) {
    case "room-set": {
      // Everything except that one room should be crossed out.
      const want = fullMask(frame.plan.rooms.length) & ~bit(c.r);
      return (want & ~notebook.ruledOut[c.p][c.t]) !== 0;
    }
    case "rooms-out":
      return (c.rooms & ~notebook.ruledOut[c.p][c.t]) !== 0;

    case "answer-cut":
      // A notebook keeps two flat lists, so a scatter of pairs is not
      // something a player can write down — but a suspect cleared or an hour
      // closed is, and the step now says which. Reading the pairs and
      // guessing was the bug: the pairs a sweep removes depend on what had
      // already been crossed off, so most real eliminations looked like
      // scatter and were dropped.
      return (
        c.cleared.some((s) => (notebook.clearedSuspects & bit(s)) === 0) ||
        c.closed.some((t) => (notebook.ruledOutSlots & bit(t)) === 0)
      );

    case "contradiction":
      // The collected cards cannot all be true. That is a bug in the case,
      // not a hint, and the generator's final assertion exists to stop it
      // ever reaching a player.
      return false;
  }
}

/* ----------------------------------------------------------- the pointing */

/**
 * The topic to name, chosen so that it is an action the player can take.
 *
 * The plan's action set is: examine a room, or ask a suspect about an hour, a
 * person or a room. So a physical fact must name a **room** — there is no
 * examine-a-person action, and "look into Suspect A" with nobody to ask is
 * advice a player cannot follow. Testimony can take the clue's own first
 * topic, because every one of them is something to ask its speaker about.
 *
 * Exported because `generator/investigation.ts` files each card under the
 * action that releases it, and that action has to be the one a hint will
 * name. A second copy of this rule in the generator would drift, and the
 * symptom would be a hint pointing at a question the game does not offer.
 */
export function firstTopic(frame: CaseFrame, clue: Clue): TopicKey {
  const keys = clueTopicKeys(frame, clue);
  if (clue.source.kind === "testimony") {
    return keys.length > 0 ? keys[0] : topic.motive;
  }
  const room = keys.find((k) => k.startsWith("room:"));
  if (room !== undefined) return room;
  // A fact that names no room at all is one of the two about the victim, and
  // the place to learn when somebody died is the room they died in.
  return topic.room(frame.murderRoom);
}

function investigateText(
  frame: CaseFrame,
  key: TopicKey,
  ask: PersonId | null,
  g: Glossary,
): string {
  const about = topicPhrase(key, g);
  if (ask === null) {
    if (key.startsWith("room:")) {
      return `There is nothing more to be got from these cards. Have another look at ${about}.`;
    }
    return `There is nothing more to be got from these cards. Look into ${about}.`;
  }
  return `There is nothing more to be got from these cards. Ask ${g.personName(ask)} about ${about}.`;
}

function topicPhrase(key: TopicKey, g: Glossary): string {
  const [kind, raw] = key.split(":");
  const n = Number(raw);
  if (kind === "person" && Number.isInteger(n)) return g.personName(n as PersonId);
  if (kind === "room" && Number.isInteger(n)) return g.roomName(n as RoomId);
  if (kind === "slot" && Number.isInteger(n)) return g.slotLabel(n as SlotIndex);
  return "the motive";
}

/* -------------------------------------------------- notebook conveniences */

/** Cross out a room. The UI does this; the engine offers it so tests can. */
export function ruleOut(
  notebook: Notebook,
  p: PersonId,
  t: SlotIndex,
  rooms: number,
): void {
  notebook.ruledOut[p][t] |= rooms;
}

/** Write down everything a conclusion licenses, as an obedient player would. */
export function apply(
  frame: CaseFrame,
  notebook: Notebook,
  c: Conclusion,
): void {
  switch (c.kind) {
    case "room-set":
      notebook.ruledOut[c.p][c.t] |= fullMask(frame.plan.rooms.length) & ~bit(c.r);
      return;
    case "rooms-out":
      notebook.ruledOut[c.p][c.t] |= c.rooms;
      return;
    case "answer-cut":
      for (const s of c.cleared) notebook.clearedSuspects |= bit(s);
      for (const t of c.closed) notebook.ruledOutSlots |= bit(t);
      return;
    case "contradiction":
      return;
  }
}

/** How much of the grid the player has settled, for a progress indicator. */
export function marksMade(frame: CaseFrame, notebook: Notebook): number {
  let n = 0;
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t < frame.slots; t++) n += popcount(notebook.ruledOut[p][t]);
  }
  return n + popcount(notebook.clearedSuspects) + popcount(notebook.ruledOutSlots);
}

/** The rooms a player still allows for a cell, for the grid. */
export function openRooms(
  frame: CaseFrame,
  notebook: Notebook,
  p: PersonId,
  t: SlotIndex,
): RoomId[] {
  return bitsOf(fullMask(frame.plan.rooms.length) & ~notebook.ruledOut[p][t]);
}
