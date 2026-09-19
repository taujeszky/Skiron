/**
 * The clue registry: the one place that knows the whole clue language.
 *
 * Everything outside this directory dispatches through here rather than
 * switching on `body.kind`, so adding a clue type is a new file plus one line
 * in `MODULES` (ARCHITECTURE.md §3). The type of `MODULES` is what makes that
 * safe — a kind without a module, or a module filed under the wrong kind,
 * will not compile.
 */

import { testimonyBinds } from "../axioms";
import { topic } from "../types";
import type {
  CaseFrame,
  Clue,
  ClueBody,
  ClueKind,
  ClueModule,
  Glossary,
  PersonId,
  TopicKey,
  World,
} from "../types";
import type { KindModule, Mentions } from "./common";
import { AloneIn, Saw, Together } from "./company";
import { Count, Empty, Occupied } from "./counting";
import { At, NeverVisited, NotAt, Stayed, Visited } from "./presence";
import { BarredDoor, BarredRoom, Capacity, DoorClosed } from "./rules";
import { AliveAt, DeathWindow } from "./victim";

export type { Mentions } from "./common";

const MODULES: { [K in ClueKind]: KindModule<K> } = {
  At,
  NotAt,
  Stayed,
  Saw,
  Together,
  AloneIn,
  Occupied,
  Empty,
  Count,
  Visited,
  NeverVisited,
  AliveAt,
  DeathWindow,
  DoorClosed,
  BarredDoor,
  BarredRoom,
  Capacity,
};

/**
 * Every kind, in the order `ClueBody` declares them. Written out rather than
 * read off `MODULES` so that the order is a decision and not an accident:
 * the generator iterates this list, and a case id must rebuild the same case
 * (invariant 4).
 */
export const CLUE_KINDS: readonly ClueKind[] = [
  "At",
  "NotAt",
  "Stayed",
  "Saw",
  "Together",
  "AloneIn",
  "Occupied",
  "Empty",
  "Count",
  "Visited",
  "NeverVisited",
  "AliveAt",
  "DeathWindow",
  "DoorClosed",
  "BarredDoor",
  "BarredRoom",
  "Capacity",
];

export function moduleFor<K extends ClueKind>(kind: K): ClueModule<K> {
  return MODULES[kind];
}

/**
 * The union-typed view of a module. TypeScript cannot correlate `body.kind`
 * with a module's `K` across an indexed access, so the assertion stands in
 * for that; `MODULES`'s own type is what keeps the correlation honest.
 */
function moduleOf(body: ClueBody): KindModule<ClueKind> {
  return MODULES[body.kind] as KindModule<ClueKind>;
}

/* ------------------------------------------------------------- the body */

/** Is the clue's formula true in this world? Says nothing about rule 7. */
export function holds(
  body: ClueBody,
  frame: CaseFrame,
  world: World,
): boolean {
  return moduleOf(body).holds(body, frame, world);
}

/** A stable string; equal strings mean equal clues. Normalises first. */
export function canonical(body: ClueBody): string {
  return moduleOf(body).canonical(body);
}

export function normalise(body: ClueBody): ClueBody {
  return moduleOf(body).normalise(body);
}

/** Structural sanity against the frame, not truth. */
export function validBody(body: ClueBody, frame: CaseFrame): boolean {
  return moduleOf(body).valid(body, frame);
}

/** Which questions release this clue. Deduplicated and sorted. */
export function topicKeys(body: ClueBody, frame: CaseFrame): TopicKey[] {
  return moduleOf(body).topicKeys(body, frame);
}

/**
 * Every person, room, slot and door the clue names, for highlighting. Takes
 * the frame because `AliveAt` and `DeathWindow` name the victim without
 * carrying his id, and the same list is what `topicKeys` is built from.
 */
export function clueMentions(body: ClueBody, frame: CaseFrame): Mentions {
  return moduleOf(body).mentions(body, frame);
}

/**
 * The engine-written sentence for a clue body: past tense, no closing stop
 * and no leading capital, so the caller can attribute and punctuate it.
 * `explain.ts#clueSentence` is what most callers want.
 */
export function template(
  body: ClueBody,
  frame: CaseFrame,
  glossary: Glossary,
  speaker?: PersonId,
): string {
  return moduleOf(body).template(body, frame, glossary, speaker);
}

/* ------------------------------------------------------------- the clue */

/**
 * What a clue actually demands of a world: rule 7 first, the formula second.
 * A culprit's lie passes here in the true world because the implication is
 * vacuous there, and that is the monotonicity the bank, the hints and the
 * play-in-any-order guarantee all rest on (ARCHITECTURE.md §2).
 */
export function clueHolds(
  frame: CaseFrame,
  clue: Clue,
  world: World,
): boolean {
  if (!testimonyBinds(frame, clue, world.culprit)) return true;
  return holds(clue.body, frame, world);
}

/**
 * Canonical form including the source, for card equality. Two people saying
 * the same thing are two cards, and the notebook shows both.
 */
export function clueCanonical(clue: Clue): string {
  const src =
    clue.source.kind === "fact" ? "fact" : `say(p${clue.source.speaker})`;
  return `${src}|${canonical(clue.body)}`;
}

/**
 * The topics that release a clue from its speaker. A suspect is never a topic
 * for their own statement: "tell me about yourself" is the motive question,
 * and the bank would otherwise file half a suspect's answers under their own
 * name.
 */
export function clueTopicKeys(frame: CaseFrame, clue: Clue): TopicKey[] {
  const keys = topicKeys(clue.body, frame);
  if (clue.source.kind !== "testimony") return keys;
  const own = topic.person(clue.source.speaker);
  return keys.filter((k) => k !== own);
}
