/**
 * The eight rules of the game, written once.
 *
 * `isLegal` is the definition of a legal world. Everything else in the engine
 * is tested against it, so it is kept short, direct and free of cleverness:
 * no bitmasks, no precomputation, no early exits that are hard to read. The
 * fast tables below are *derived* from the same `canMove`, so a movement bug
 * cannot disagree with itself.
 */

import { bit, fullMask, popcount } from "./bits";
import type {
  CaseFrame,
  Clue,
  PersonId,
  RoomId,
  SlotIndex,
  World,
} from "./types";

/* --------------------------------------------------------------- living */

/** Rule 4: the victim dies in slot `t*`, so they are alive strictly before it. */
export function victimAliveAt(world: World, t: SlotIndex): boolean {
  return t < world.murderSlot;
}

/**
 * Does `p` count as a living presence in slot `t`? Suspects always do; the
 * victim does until the murder slot and the body never does. Every clue about
 * company counts exactly these people (see `ClueBody`).
 */
export function isLiving(
  frame: CaseFrame,
  world: World,
  p: PersonId,
  t: SlotIndex,
): boolean {
  return p !== frame.victim || t < world.murderSlot;
}

/** The living people in room `r` in slot `t`, as a bitmask over person ids. */
export function presentMask(
  frame: CaseFrame,
  world: World,
  r: RoomId,
  t: SlotIndex,
): number {
  let mask = 0;
  for (let p = 0; p < frame.people; p++) {
    if (world.loc[p][t] === r && isLiving(frame, world, p, t)) mask |= bit(p);
  }
  return mask;
}

/** How many living people were in `r` in slot `t`. */
export function headCount(
  frame: CaseFrame,
  world: World,
  r: RoomId,
  t: SlotIndex,
): number {
  return popcount(presentMask(frame, world, r, t));
}

/* ------------------------------------------------------------- movement */

/** Is the door between two rooms locked for the transition `t -> t + 1`? */
export function doorClosedAt(
  frame: CaseFrame,
  door: number,
  t: SlotIndex,
): boolean {
  for (const c of frame.rules.closures) {
    if (c.door === door && t >= c.from && t < c.to) return true;
  }
  return false;
}

export function barredFromDoor(
  frame: CaseFrame,
  p: PersonId,
  door: number,
): boolean {
  return frame.rules.doorBars.some((b) => b.person === p && b.door === door);
}

export function barredFromRoom(
  frame: CaseFrame,
  p: PersonId,
  r: RoomId,
): boolean {
  return frame.rules.roomBars.some((b) => b.person === p && b.room === r);
}

/** The cap on living people in `r`, or Infinity. */
export function capacityOf(frame: CaseFrame, r: RoomId): number {
  let cap = Infinity;
  for (const c of frame.rules.capacities) {
    if (c.room === r && c.max < cap) cap = c.max;
  }
  return cap;
}

/**
 * Rule 2: between one slot and the next a person stays put or passes through
 * one open door. `t` is the transition index, `0 <= t < slots - 1`.
 */
export function canMove(
  frame: CaseFrame,
  p: PersonId,
  from: RoomId,
  to: RoomId,
  t: SlotIndex,
): boolean {
  if (from === to) return true;
  const n = frame.plan.rooms.length;
  const door = frame.plan.doorBetween[from * n + to];
  if (door < 0) return false;
  if (barredFromDoor(frame, p, door)) return false;
  if (doorClosedAt(frame, door, t)) return false;
  return true;
}

/** Rooms `p` is allowed to be in at all, as a bitmask. */
export function allowedRoomsMask(frame: CaseFrame, p: PersonId): number {
  let mask = fullMask(frame.plan.rooms.length);
  for (const b of frame.rules.roomBars) {
    if (b.person === p) mask &= ~bit(b.room);
  }
  return mask;
}

/**
 * `masks[p][t][from]` = the rooms `p` may occupy in slot `t + 1` having been
 * in `from` in slot `t`, already narrowed to rooms `p` may enter at all.
 * Derived from `canMove`, so it cannot drift away from `isLegal`.
 */
export function movementMasks(frame: CaseFrame): number[][][] {
  const n = frame.plan.rooms.length;
  const out: number[][][] = [];
  for (let p = 0; p < frame.people; p++) {
    const allowed = allowedRoomsMask(frame, p);
    const perSlot: number[][] = [];
    for (let t = 0; t + 1 < frame.slots; t++) {
      const perRoom: number[] = [];
      for (let from = 0; from < n; from++) {
        let mask = 0;
        for (let to = 0; to < n; to++) {
          if (canMove(frame, p, from, to, t)) mask |= bit(to);
        }
        perRoom.push(mask & allowed);
      }
      perSlot.push(perRoom);
    }
    out.push(perSlot);
  }
  return out;
}

/* -------------------------------------------------------------- legality */

/**
 * Rules 1-5, exactly as the player is told them. Returns true when `world` is
 * a world that could have happened in `frame`.
 */
export function isLegal(frame: CaseFrame, world: World): boolean {
  const n = frame.plan.rooms.length;
  const T = frame.slots;
  const V = frame.victim;
  const c = world.culprit;
  const tStar = world.murderSlot;

  // Rule 1: everybody is in exactly one real room in every slot.
  if (world.loc.length !== frame.people) return false;
  for (let p = 0; p < frame.people; p++) {
    if (world.loc[p].length !== T) return false;
    for (let t = 0; t < T; t++) {
      const r = world.loc[p][t];
      if (!Number.isInteger(r) || r < 0 || r >= n) return false;
    }
  }

  // Rule 8: an accusation names a suspect and a slot, so the truth must too.
  if (!Number.isInteger(c) || c < 0 || c >= frame.suspects) return false;
  if (!Number.isInteger(tStar) || tStar < 0 || tStar >= T) return false;

  // Rule 2: stay put, or pass through one open door you are not barred from.
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t + 1 < T; t++) {
      if (!canMove(frame, p, world.loc[p][t], world.loc[p][t + 1], t)) {
        return false;
      }
    }
  }

  // Case-file rule: nobody is ever in a room they are barred from.
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t < T; t++) {
      if (barredFromRoom(frame, p, world.loc[p][t])) return false;
    }
  }

  // Case-file rule: a room never holds more living people than it can.
  for (const cap of frame.rules.capacities) {
    for (let t = 0; t < T; t++) {
      if (headCount(frame, world, cap.room, t) > cap.max) return false;
    }
  }

  // Rule 4: the victim was killed in the room the body was found in, in a
  // single slot, alone with the killer. "Alone with" is exactly "the only
  // living soul in that room in that slot is the killer" — the victim is no
  // longer counted in the slot they die in.
  if (world.loc[V][tStar] !== frame.murderRoom) return false;
  if (presentMask(frame, world, frame.murderRoom, tStar) !== bit(c)) {
    return false;
  }

  // Rule 5: from the murder on, the body stays where it fell and nobody but
  // the killer is in that room.
  for (let t = tStar; t < T; t++) {
    if (world.loc[V][t] !== frame.murderRoom) return false;
    for (let p = 0; p < frame.people; p++) {
      if (p === c || p === V) continue;
      if (world.loc[p][t] === frame.murderRoom) return false;
    }
  }

  return true;
}

/* ------------------------------------------------------------ testimony */

/**
 * Rule 7. A fact binds every world. A testimony binds every world when lying
 * is off; when it is on it binds only the worlds in which its speaker is not
 * the culprit — that is the whole of `s !== culprit => phi`.
 *
 * The consequence both solvers lean on: a clue issued by the generator is
 * true in the true world even when it is a lie, because there the speaker IS
 * the culprit and the implication is vacuous. So clues only ever add
 * information, and a deduction made from some of them survives the rest.
 */
export function testimonyBinds(
  frame: CaseFrame,
  clue: Clue,
  culprit: PersonId,
): boolean {
  if (clue.source.kind === "fact") return true;
  if (!frame.lying) return true;
  return clue.source.speaker !== culprit;
}
