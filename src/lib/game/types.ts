/**
 * What the game layer stores, as opposed to what the engine computes.
 *
 * **A save does not contain a case.** A case is a pure function of its id
 * (invariant 4), and `GeneratedCase` is full of `Map`s and `Set`s that
 * `JSON.stringify` drops without a word — so a "saved case" would round-trip
 * into a case with an empty bank and no visible symptom until the player
 * asked somebody a question. What is stored is the id and everything the
 * player has done to it; `controller.ts` rebuilds the rest.
 *
 * Everything here is plain JSON with no methods and no classes, so that
 * `storage.ts` can validate a value read back from a browser five versions
 * later by looking at it rather than by trusting it.
 */

import type { Action } from "$lib/engine/generator/investigation";
import type {
  ClueId,
  PersonId,
  PresetName,
  RoomId,
  SlotIndex,
  TopicKey,
} from "$lib/engine/types";

/* ----------------------------------------------------------- the screens */

export type Screen =
  | "home"
  | "briefing"
  | "investigate"
  | "accuse"
  | "summary"
  | "stats"
  | "howto"
  | "settings";

/* ---------------------------------------------------------------- actions */

/**
 * The key an action is remembered by, so that asking the same question twice
 * is free.
 *
 * It has to be stable across a rebuild, which is why it is built from the
 * suspect and the topic rather than from anything the bank hands back: the
 * cards a question releases are the same for the same id, but the save is
 * read before the case exists.
 */
export function askKey(suspect: PersonId, topic: TopicKey): string {
  return `ask:${suspect}:${topic}`;
}

export function examineKey(room: RoomId): string {
  return `examine:${room}`;
}

export function actionKey(a: Action): string {
  return a.kind === "ask" ? askKey(a.suspect, a.topic) : examineKey(a.room);
}

/* --------------------------------------------------------------- settings */

export type ThemeChoice = "light" | "dark" | "auto";

export interface Settings {
  theme: ThemeChoice;
  /** Apply a collected card's tier-0 consequences to the notebook at once. */
  autoNotes: boolean;
  /** Show the canonical form under each card's sentence. */
  showCanonical: boolean;
  /** Ask before an accusation is recorded. */
  confirmAccusation: boolean;
  /** Keep the map's slot scrubber in step with the notebook's column. */
  linkScrubber: boolean;
}

export function defaultSettings(): Settings {
  return {
    theme: "auto",
    autoNotes: true,
    showCanonical: true,
    confirmAccusation: true,
    linkScrubber: true,
  };
}

/* ------------------------------------------------------------- the save */

/** The player's pencil marks, as JSON. Mirrors `solver/hint.ts#Notebook`. */
export interface NotebookData {
  ruledOut: number[][];
  clearedSuspects: number;
  ruledOutSlots: number;
}

export interface AccusationRecord {
  culprit: PersonId;
  slot: SlotIndex;
}

/**
 * One line of a free-text interrogation (wave 6).
 *
 * Stored with the save rather than with the skin, because it is the player's
 * own history with this case and not part of how the case is dressed: a skin
 * is shared by everybody who opens the same shipped case, and a transcript is
 * not. It holds text and card ids and nothing else — the cards themselves are
 * rebuilt from the case id like everything else in a save.
 *
 * `note` is the game speaking rather than a person: "that question could not
 * be sent". It is kept in the transcript so a failure leaves a mark the
 * player can see instead of a question that silently went nowhere, and it is
 * never sent back to a model.
 */
export interface ChatTurn {
  /** The suspect this exchange is with. */
  who: PersonId;
  from: "player" | "suspect" | "note";
  text: string;
  /** Cards this turn released, shown inline. Absent when it released none. */
  cards?: ClueId[];
}

export interface Save {
  /** The formatted case id — `SK1-N-3f9k2a`. The whole case, in twelve bytes. */
  id: string;
  /** Card ids, in the order they were collected. Card numbering follows it. */
  collected: ClueId[];
  /** Distinct actions already taken, in order. `spent.length` is the count. */
  spent: string[];
  notebook: NotebookData;
  wrong: AccusationRecord[];
  hints: number;
  checks: number;
  /** Milliseconds of play, accumulated across sessions. */
  ms: number;
  solved: boolean;
  /** Every free-text exchange, with everybody, oldest first. */
  chat: ChatTurn[];
}

/* -------------------------------------------------------------- the stats */

export interface DifficultyStats {
  started: number;
  solved: number;
  /** Of the solved, how many came in at or under par. */
  atPar: number;
  bestMs: number | null;
  bestActions: number | null;
  totalMs: number;
  hints: number;
  wrong: number;
  streak: number;
  bestStreak: number;
}

export type Stats = Record<PresetName, DifficultyStats>;

export function emptyDifficultyStats(): DifficultyStats {
  return {
    started: 0,
    solved: 0,
    atPar: 0,
    bestMs: null,
    bestActions: null,
    totalMs: 0,
    hints: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function emptyStats(): Stats {
  return {
    easy: emptyDifficultyStats(),
    normal: emptyDifficultyStats(),
    hard: emptyDifficultyStats(),
    expert: emptyDifficultyStats(),
  };
}
