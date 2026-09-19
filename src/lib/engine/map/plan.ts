/**
 * Turning rooms and doors into a `FloorPlan`: the shared-wall geometry, the
 * lookup tables, and the invariants every plan must satisfy.
 *
 * The geometry and the graph come from the same data on purpose. The SVG the
 * player sees is drawn from `rooms` and `doors`; the solvers walk
 * `adjacency`. Both are produced here, so the picture can never disagree with
 * the puzzle.
 */

import { bit } from "../bits";
import type { Door, FloorPlan, Rect, Room, RoomId } from "../types";

/**
 * Where two rectangles touch. For a vertical wall `at` is the shared x and
 * `from`/`to` are the y range; for a horizontal wall it is the other way
 * round. Returns null when the rectangles do not share a wall at all.
 */
export interface SharedWall {
  wall: "h" | "v";
  at: number;
  from: number;
  to: number;
}

export function sharedWall(a: Rect, b: Rect): SharedWall | null {
  // side by side: a vertical wall
  const vAt =
    a.x + a.w === b.x ? a.x + a.w : b.x + b.w === a.x ? a.x : null;
  if (vAt !== null) {
    const from = Math.max(a.y, b.y);
    const to = Math.min(a.y + a.h, b.y + b.h);
    if (to > from) return { wall: "v", at: vAt, from, to };
    return null;
  }
  // stacked: a horizontal wall
  const hAt =
    a.y + a.h === b.y ? a.y + a.h : b.y + b.h === a.y ? a.y : null;
  if (hAt !== null) {
    const from = Math.max(a.x, b.x);
    const to = Math.min(a.x + a.w, b.x + b.w);
    if (to > from) return { wall: "h", at: hAt, from, to };
    return null;
  }
  return null;
}

/** The centre of a door hung on the middle of a shared wall segment. */
export function doorAt(w: SharedWall): { x: number; y: number } {
  const mid = (w.from + w.to) / 2;
  return w.wall === "v" ? { x: w.at, y: mid } : { x: mid, y: w.at };
}

export type DoorDraft = Omit<Door, "id">;

/**
 * A door between two rooms, hung on the middle of the wall they share.
 * Returns null when they share no wall long enough to hold one.
 */
export function draftDoor(
  rooms: readonly Room[],
  a: RoomId,
  b: RoomId,
  minWall = 2,
): DoorDraft | null {
  const w = sharedWall(rooms[a].rect, rooms[b].rect);
  if (!w || w.to - w.from < minWall) return null;
  const { x, y } = doorAt(w);
  return { a, b, x, y, wall: w.wall };
}

/**
 * Assign door ids and build the lookup tables. Throws on anything that would
 * make the plan lie about itself: a door to nowhere, a door from a room to
 * itself, or a second door between the same pair of rooms (see
 * ARCHITECTURE.md §3 — `DoorClosed` and `BarredDoor` need one door per pair).
 */
export function assemblePlan(
  width: number,
  height: number,
  rooms: Room[],
  drafts: readonly DoorDraft[],
): FloorPlan {
  const n = rooms.length;
  const doorBetween = new Array<number>(n * n).fill(-1);
  const adjacency = new Array<number>(n).fill(0);
  const doorsFrom: number[][] = Array.from({ length: n }, () => []);
  const doors: Door[] = [];

  for (const d of drafts) {
    if (d.a === d.b) throw new Error(`door from room ${d.a} to itself`);
    if (d.a < 0 || d.a >= n || d.b < 0 || d.b >= n) {
      throw new Error(`door between unknown rooms ${d.a} and ${d.b}`);
    }
    if (doorBetween[d.a * n + d.b] >= 0) {
      throw new Error(`a second door between rooms ${d.a} and ${d.b}`);
    }
    const id = doors.length;
    doors.push({ id, ...d });
    doorBetween[d.a * n + d.b] = id;
    doorBetween[d.b * n + d.a] = id;
    adjacency[d.a] |= bit(d.b);
    adjacency[d.b] |= bit(d.a);
    doorsFrom[d.a].push(id);
    doorsFrom[d.b].push(id);
  }

  return { width, height, rooms, doors, adjacency, doorsFrom, doorBetween };
}

/** Can every room be reached from room 0 with all doors open? */
export function planConnected(plan: FloorPlan): boolean {
  const n = plan.rooms.length;
  if (n === 0) return true;
  const seen = new Array<boolean>(n).fill(false);
  const stack: RoomId[] = [0];
  seen[0] = true;
  let count = 1;
  while (stack.length > 0) {
    const r = stack.pop() as RoomId;
    for (let s = 0; s < n; s++) {
      if (!seen[s] && (plan.adjacency[r] & bit(s)) !== 0) {
        seen[s] = true;
        count++;
        stack.push(s);
      }
    }
  }
  return count === n;
}

/** Do any two room rectangles overlap? A dissection must say no. */
export function roomsOverlap(rooms: readonly Room[]): boolean {
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i].rect;
      const b = rooms[j].rect;
      if (
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h
      ) {
        return true;
      }
    }
  }
  return false;
}
