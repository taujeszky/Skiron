/**
 * The case model. Everything in `engine/` is pure TypeScript: no DOM, no
 * `Date`, no `Math.random`, so it runs identically in Node, in a Web Worker
 * and in the authoring CLI.
 *
 * Sizes are deliberately small and bitmask-friendly — both solvers keep a
 * room domain per person per slot as a bitmask in a single 32-bit int.
 */

export type RoomId = number;
export type DoorId = number;
export type PersonId = number;
export type SlotIndex = number;
export type ClueId = string;

/** Bitmask domains assume these. The generator presets stay well inside them. */
export const MAX_ROOMS = 16;
export const MAX_PEOPLE = 8;
export const MAX_SLOTS = 8;

/* ------------------------------------------------------------------ map */

/** Grid units, origin top-left, y downwards. Integers throughout. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room {
  id: RoomId;
  rect: Rect;
  /** A terrace, garden or courtyard: drawn outside the house outline. */
  outdoor: boolean;
}

/**
 * A door on the wall two rooms share. At most one door joins any pair of
 * rooms — otherwise "who used this door" could not be read off a person's
 * room-by-room timeline, and two clue types depend on that.
 */
export interface Door {
  id: DoorId;
  a: RoomId;
  b: RoomId;
  /** Centre of the opening, in grid units. */
  x: number;
  y: number;
  /** "v": the shared wall runs vertically (rooms side by side). "h": stacked. */
  wall: "h" | "v";
}

export interface FloorPlan {
  /** Footprint in grid units, including any outdoor strip. */
  width: number;
  height: number;
  rooms: Room[];
  doors: Door[];
  /** adjacency[r] = bitmask of rooms joined to r by a door. Never includes r. */
  adjacency: number[];
  /** doorsFrom[r] = ids of the doors touching room r. */
  doorsFrom: DoorId[][];
  /** doorBetween[a * rooms + b] = door id, or -1. Symmetric. */
  doorBetween: number[];
}

/* ------------------------------------------------------------ case rules */

/**
 * A door locked for a stretch of the evening. It blocks every transition
 * `t -> t+1` with `from <= t < to`; read aloud that is "locked between the
 * label of slot `from` and the label of slot `to`".
 */
export interface DoorClosure {
  door: DoorId;
  from: SlotIndex;
  to: SlotIndex;
}

export interface DoorBar {
  person: PersonId;
  door: DoorId;
}

export interface RoomBar {
  person: PersonId;
  room: RoomId;
}

export interface RoomCapacity {
  room: RoomId;
  max: number;
}

/**
 * The case-file rules. They are facts, given to the player at the start, and
 * the truth simulation obeys them by construction.
 */
export interface CaseRules {
  closures: DoorClosure[];
  doorBars: DoorBar[];
  roomBars: RoomBar[];
  capacities: RoomCapacity[];
}

export function noRules(): CaseRules {
  return { closures: [], doorBars: [], roomBars: [], capacities: [] };
}

/* ----------------------------------------------------------- the problem */

export type PresetName = "easy" | "normal" | "hard" | "expert";

/**
 * Everything about a case that the player is told up front, and the only
 * thing either solver is allowed to assume. It does NOT contain the truth.
 *
 * People are numbered so that suspects are `0 .. suspects - 1` and the victim
 * is `suspects`. That keeps "for every suspect" a plain `for` loop.
 */
export interface CaseFrame {
  plan: FloorPlan;
  rules: CaseRules;
  /** S: how many suspects. */
  suspects: number;
  /** T: how many time slots. */
  slots: number;
  /** P = S + 1. */
  people: number;
  /** Always equal to `suspects`. */
  victim: PersonId;
  /** r*: where the body was found. Given to the player. */
  murderRoom: RoomId;
  /** Whether the culprit's testimony may be false. */
  lying: boolean;
}

/** The truth. `murderRoom` lives on the frame because the player knows it. */
export interface World {
  /** loc[person][slot]. The victim's body stays in r* from the murder on. */
  loc: RoomId[][];
  culprit: PersonId;
  murderSlot: SlotIndex;
}

/** What an accusation names, and what a clue set may leave open. */
export interface Answer {
  culprit: PersonId;
  slot: SlotIndex;
}

/* ------------------------------------------------------------ the clues */

/**
 * The closed clue language.
 *
 * Presence semantics, the one thing to get right and keep straight:
 * `At`, `NotAt`, `Stayed`, `Visited` and `NeverVisited` speak about where a
 * body was, so they read `loc` raw and hold of the victim's corpse too.
 * Every clue about *company* — `Saw`, `Together`, `AloneIn`, `Occupied`,
 * `Empty`, `Count` — counts the living: the victim counts while alive and the
 * body does not count at all. So "nobody was in the study at eleven" can be
 * true of the room the body lies in, and the how-to-play screen says so.
 */
export type ClueBody =
  /** `p` was in room `r` in slot `t`. */
  | { kind: "At"; p: PersonId; t: SlotIndex; r: RoomId }
  /** `p` was not in room `r` in slot `t`. */
  | { kind: "NotAt"; p: PersonId; t: SlotIndex; r: RoomId }
  /** `p` was in `r` for every slot from `t1` to `t2` inclusive, `t1 < t2`. */
  | { kind: "Stayed"; p: PersonId; r: RoomId; t1: SlotIndex; t2: SlotIndex }
  /** `p` and `q` were both alive and in `r` in slot `t`. Unordered in `p`/`q`. */
  | { kind: "Saw"; p: PersonId; q: PersonId; t: SlotIndex; r: RoomId }
  /** `p` and `q` were alive in the same room in slot `t`; the room is not said. */
  | { kind: "Together"; p: PersonId; q: PersonId; t: SlotIndex }
  /** `p` was in `r` in slot `t` and was the only living soul there. */
  | { kind: "AloneIn"; p: PersonId; t: SlotIndex; r: RoomId }
  /** At least one living person was in `r` in slot `t`. */
  | { kind: "Occupied"; r: RoomId; t: SlotIndex }
  /** No living person was in `r` in slot `t`. */
  | { kind: "Empty"; r: RoomId; t: SlotIndex }
  /** Exactly `k` living people were in `r` in slot `t`. */
  | { kind: "Count"; r: RoomId; t: SlotIndex; k: number }
  /** `p` was in `r` in at least one slot. */
  | { kind: "Visited"; p: PersonId; r: RoomId }
  /** `p` was never in `r`. */
  | { kind: "NeverVisited"; p: PersonId; r: RoomId }
  /** The victim was still alive in slot `t`, i.e. `t < t*`. */
  | { kind: "AliveAt"; t: SlotIndex }
  /** `a <= t* <= b`. */
  | { kind: "DeathWindow"; a: SlotIndex; b: SlotIndex }
  /** Case-file rule: the door was locked for transitions `from <= t < to`. */
  | { kind: "DoorClosed"; door: DoorId; from: SlotIndex; to: SlotIndex }
  /** Case-file rule: `p` never used that door. */
  | { kind: "BarredDoor"; p: PersonId; door: DoorId }
  /** Case-file rule: `p` was never in that room. */
  | { kind: "BarredRoom"; p: PersonId; r: RoomId }
  /** Case-file rule: at most `k` living people fit in `r` at once. */
  | { kind: "Capacity"; r: RoomId; k: number };

export type ClueKind = ClueBody["kind"];

/** Narrow a body to one kind, for the per-kind modules. */
export type BodyOf<K extends ClueKind> = Extract<ClueBody, { kind: K }>;

/** The clue kinds that are case-file rules: given at the start, never earned. */
export const RULE_KINDS: readonly ClueKind[] = [
  "DoorClosed",
  "BarredDoor",
  "BarredRoom",
  "Capacity",
];

export function isRuleKind(kind: ClueKind): boolean {
  return RULE_KINDS.includes(kind);
}

/**
 * Where a clue comes from. A fact is always true. A testimony by `s` asserts
 * only `s !== culprit => body` when lying is on, and `body` outright when it
 * is off — see `axioms.ts#testimonyBinds`.
 */
export type Source =
  | { kind: "fact" }
  | { kind: "testimony"; speaker: PersonId };

export interface Clue {
  id: ClueId;
  body: ClueBody;
  source: Source;
}

/**
 * What a player action can ask about: `slot:3`, `person:2`, `room:5`, and the
 * bare `motive`. The bank (wave 3) maps a suspect and a topic to a reply.
 */
export type TopicKey = string;

export const topic = {
  slot: (t: SlotIndex): TopicKey => `slot:${t}`,
  person: (p: PersonId): TopicKey => `person:${p}`,
  room: (r: RoomId): TopicKey => `room:${r}`,
  motive: "motive" as TopicKey,
};

/** Names for rooms, people and slots. Wave 5's skin supplies a real one. */
export interface Glossary {
  roomName(r: RoomId): string;
  roomCode(r: RoomId): string;
  personName(p: PersonId): string;
  slotLabel(t: SlotIndex): string;
}

/**
 * One clue type's module. Wave 1 fills in the first four; the remaining slots
 * are declared now so that later waves extend a module rather than scatter
 * `switch` statements across the engine.
 */
export interface ClueModule<K extends ClueKind = ClueKind> {
  kind: K;
  /** Is the clue's formula true in this world? */
  holds(body: BodyOf<K>, frame: CaseFrame, world: World): boolean;
  /** A stable string; equal strings mean equal clues. */
  canonical(body: BodyOf<K>): string;
  /** Sorts unordered fields and orders spans, so canonical forms compare. */
  normalise(body: BodyOf<K>): BodyOf<K>;
  /** Is the body structurally well formed for this frame? */
  valid(body: BodyOf<K>, frame: CaseFrame): boolean;
  /** Which questions release this clue. */
  topicKeys(body: BodyOf<K>, frame: CaseFrame): TopicKey[];
  /** Wave 2: the engine-written sentence. */
  template?(body: BodyOf<K>, glossary: Glossary): string;
  /** Wave 2: forced-elimination propagators for the deduction solver. */
  propagate?: unknown;
  /** Wave 5: the JSON schema fragment for the fidelity parse-back. */
  schema?: unknown;
}
