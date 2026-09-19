/**
 * The scaffolding the clue modules stand on.
 *
 * `ClueModule` in `types.ts` is the contract the rest of the engine sees.
 * Inside this directory a module declares one thing more — `mentions`, the
 * ids the clue names — because two separate things are built from exactly
 * that list: the notebook highlight, and the topic keys that release the clue
 * under questioning. Deriving both from one function is the only way they
 * cannot drift apart, which is why `mentions` is handed the frame as well:
 * `AliveAt` and `DeathWindow` are about the victim without carrying a person
 * id, and feeding the victim to the topic keys alone would have left the
 * notebook refusing to light his row for the very card that named him.
 */

import { topic } from "../types";
import type {
  BodyOf,
  CaseFrame,
  ClueKind,
  ClueModule,
  DoorId,
  PersonId,
  RoomId,
  SlotIndex,
  TopicKey,
} from "../types";

/** Every id a clue names. Each list is ascending and free of repeats. */
export interface Mentions {
  people: PersonId[];
  rooms: RoomId[];
  slots: SlotIndex[];
  doors: DoorId[];
}

/** A clue module as this directory writes it: the contract plus `mentions`. */
export interface KindModule<K extends ClueKind> extends ClueModule<K> {
  mentions(body: BodyOf<K>, frame: CaseFrame): Mentions;
}

function sortUnique(xs: readonly number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function mentions(parts: {
  people?: readonly PersonId[];
  rooms?: readonly RoomId[];
  slots?: readonly SlotIndex[];
  doors?: readonly DoorId[];
}): Mentions {
  return {
    people: sortUnique(parts.people ?? []),
    rooms: sortUnique(parts.rooms ?? []),
    slots: sortUnique(parts.slots ?? []),
    doors: sortUnique(parts.doors ?? []),
  };
}

/**
 * The slots `a..b` inclusive, however the pair is spelled. A span names every
 * slot it covers: a player who asks about nine o'clock should be handed the
 * alibi that runs from eight to ten.
 */
export function span(a: SlotIndex, b: SlotIndex): SlotIndex[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: SlotIndex[] = [];
  for (let t = lo; t <= hi; t++) out.push(t);
  return out;
}

/**
 * Topic keys from the ids a clue names. A door contributes both the rooms it
 * joins, because a door is not something the player can ask about — rooms,
 * people and hours are.
 *
 * Grouped person / room / slot, and numeric inside each group. Sorting the
 * finished strings would do neither reliably: `MAX_ROOMS` is 16, and
 * `"room:10"` sorts before `"room:6"`. The order is not load-bearing for
 * determinism — a string sort is stable too — but waves 5 and 6 hand these
 * lists to the model, and a list that jumps 10, 11, 6 reads like a bug.
 */
export function topicKeysFrom(m: Mentions, frame: CaseFrame): TopicKey[] {
  const rooms = [...m.rooms];
  for (const e of m.doors) {
    const door = frame.plan.doors[e];
    if (!door) continue;
    rooms.push(door.a, door.b);
  }
  return [
    ...sortUnique(m.people).map((p) => topic.person(p)),
    ...sortUnique(rooms).map((r) => topic.room(r)),
    ...sortUnique(m.slots).map((t) => topic.slot(t)),
  ];
}

/* --------------------------------------------------- structural validity */

/* These say nothing about truth: they ask whether the body is even a
 * sentence about this case. A clue that fails one of them is a bug in
 * whatever built it, not a false statement. */

export function isPerson(frame: CaseFrame, p: PersonId): boolean {
  return Number.isInteger(p) && p >= 0 && p < frame.people;
}

export function isRoom(frame: CaseFrame, r: RoomId): boolean {
  return Number.isInteger(r) && r >= 0 && r < frame.plan.rooms.length;
}

export function isSlot(frame: CaseFrame, t: SlotIndex): boolean {
  return Number.isInteger(t) && t >= 0 && t < frame.slots;
}

export function isDoor(frame: CaseFrame, e: DoorId): boolean {
  return Number.isInteger(e) && e >= 0 && e < frame.plan.doors.length;
}
