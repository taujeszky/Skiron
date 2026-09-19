/**
 * Building a floor plan: a rectangular dissection of the footprint, then the
 * doors that follow from which rooms ended up touching.
 *
 * A dissection rather than a hand-drawn set of rooms, because it makes the
 * two things that must agree agree by construction: the rectangles tile the
 * footprint exactly, so the drawing can hold no gap the graph does not know
 * about, and "these two rooms share a wall" is a fact about the geometry
 * rather than a second list that could drift away from it.
 */

import { RNG } from "../rng";
import { MAX_ROOMS } from "../types";
import type { FloorPlan, Rect, Room } from "../types";
import { assemblePlan, draftDoor } from "./plan";
import type { DoorDraft } from "./plan";

export interface MapOptions {
  /** How many rooms the finished plan must hold, 5..9 in practice. */
  rooms: number;
  /** Footprint in grid units. */
  width?: number;
  height?: number;
  /** The smallest side any room may have. */
  minDim?: number;
  /** Reserve one perimeter strip as a single outdoor room. */
  outdoor?: boolean;
  /** Doors beyond the spanning tree, i.e. how many cycles to aim for. */
  extraDoors?: number;
}

interface MapSpec {
  rooms: number;
  width: number;
  height: number;
  minDim: number;
  outdoor: boolean;
  extraDoors: number;
}

/**
 * How many dissections to try before giving up. A seed can genuinely fail —
 * the cuts can leave every remaining rectangle too small to split before the
 * room count is reached — but it fails independently each time, so a handful
 * of attempts already makes failure vanishingly rare and 64 is slack.
 */
const MAX_ATTEMPTS = 64;

const DEFAULT_WIDTH = 18;
const DEFAULT_HEIGHT = 12;
const DEFAULT_MIN_DIM = 3;
const DEFAULT_EXTRA_DOORS = 2;

/**
 * The entry point. Callers may rely on this succeeding for 5..9 rooms in the
 * default footprint; `map.test.ts` proves it over thousands of seeds.
 *
 * It draws exactly one number from `rng` however many attempts it needs, and
 * runs each attempt on a sub-RNG derived from that number. So a later change
 * to the dissection cannot shift the rest of a case by a varying amount,
 * which would break case ids for reasons nothing to do with the map.
 */
export function buildFloorPlan(rng: RNG, opts: MapOptions): FloorPlan {
  const spec = resolveOptions(opts);
  const base = rng.next();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = attemptPlan(new RNG(`skiron-map:${base}:${attempt}`), spec);
    if (plan) return plan;
  }
  throw new Error(
    `no ${spec.rooms}-room plan fits ${spec.width}x${spec.height} with ` +
      `minDim ${spec.minDim}${spec.outdoor ? " and an outdoor strip" : ""} ` +
      `after ${MAX_ATTEMPTS} attempts`,
  );
}

function resolveOptions(opts: MapOptions): MapSpec {
  const spec: MapSpec = {
    rooms: opts.rooms,
    width: opts.width ?? DEFAULT_WIDTH,
    height: opts.height ?? DEFAULT_HEIGHT,
    minDim: opts.minDim ?? DEFAULT_MIN_DIM,
    outdoor: opts.outdoor ?? false,
    extraDoors: opts.extraDoors ?? DEFAULT_EXTRA_DOORS,
  };
  const whole = (n: number) => Number.isInteger(n);
  if (!whole(spec.rooms) || spec.rooms < 2) {
    throw new Error("MapOptions.rooms must be a whole number of at least 2");
  }
  // Room domains are 16-bit masks everywhere downstream.
  if (spec.rooms > MAX_ROOMS) {
    throw new Error(`MapOptions.rooms must be at most ${MAX_ROOMS}`);
  }
  if (!whole(spec.minDim) || spec.minDim < 1) {
    throw new Error("MapOptions.minDim must be a whole number of at least 1");
  }
  if (!whole(spec.width) || !whole(spec.height)) {
    throw new Error("MapOptions.width and height must be whole numbers");
  }
  if (spec.width < spec.minDim || spec.height < spec.minDim) {
    throw new Error("the footprint is smaller than one room");
  }
  if (!whole(spec.extraDoors) || spec.extraDoors < 0) {
    throw new Error("MapOptions.extraDoors must be a whole number >= 0");
  }
  return spec;
}

/** One try. Returns null when this seed's cuts did not work out. */
function attemptPlan(rng: RNG, spec: MapSpec): FloorPlan | null {
  const rooms = layOutRooms(rng, spec);
  if (!rooms) return null;
  const doors = chooseDoors(rng, rooms, spec.extraDoors);
  if (!doors) return null;
  return assemblePlan(spec.width, spec.height, rooms, doors);
}

/* ------------------------------------------------------------ the rooms */

/**
 * The dissection proper: cut `area` into exactly `count` rectangles, none
 * shorter than `minDim` on either side. Returns null when it runs out of
 * rectangles big enough to cut before reaching the count.
 *
 * Always cutting the largest keeps the rooms of a house roughly comparable
 * in size, which both looks like a house and stops the later cuts from
 * having nothing left to work with.
 */
export function dissect(
  rng: RNG,
  area: Rect,
  count: number,
  minDim: number,
): Rect[] | null {
  if (count < 1) return null;
  if (area.w < minDim || area.h < minDim) return null;
  const pieces: Rect[] = [{ ...area }];
  while (pieces.length < count) {
    const i = largestSplittable(pieces, minDim);
    if (i < 0) return null;
    const [a, b] = splitRect(rng, pieces[i], minDim);
    pieces[i] = a;
    pieces.push(b);
  }
  return pieces;
}

/**
 * The index of the biggest rectangle that can still be cut, or -1. Ties go
 * to the earliest, so the choice adds no randomness of its own — the cut
 * position is where the variety comes from.
 */
function largestSplittable(pieces: readonly Rect[], minDim: number): number {
  let best = -1;
  let bestArea = 0;
  for (let i = 0; i < pieces.length; i++) {
    const r = pieces[i];
    if (Math.max(r.w, r.h) < 2 * minDim) continue;
    const area = r.w * r.h;
    if (area > bestArea) {
      best = i;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Cut along the longer axis, at a whole grid line that leaves both halves at
 * least `minDim` wide. The longer axis is also the only axis that can be
 * long enough when just one of them is, so this needs no fallback.
 */
function splitRect(rng: RNG, r: Rect, minDim: number): [Rect, Rect] {
  const acrossWidth = r.w > r.h || (r.w === r.h && rng.chance(0.5));
  if (acrossWidth) {
    const cut = minDim + rng.int(r.w - 2 * minDim + 1);
    return [
      { x: r.x, y: r.y, w: cut, h: r.h },
      { x: r.x + cut, y: r.y, w: r.w - cut, h: r.h },
    ];
  }
  const cut = minDim + rng.int(r.h - 2 * minDim + 1);
  return [
    { x: r.x, y: r.y, w: r.w, h: cut },
    { x: r.x, y: r.y + cut, w: r.w, h: r.h - cut },
  ];
}

/**
 * Slice a terrace off one side of the footprint. Exactly one outdoor room,
 * never two: the rules treat it as a room like any other, and a garden cut
 * into a lawn and a path only adds cells nobody has a reason to think about.
 */
function sliceTerrace(
  rng: RNG,
  area: Rect,
  minDim: number,
): { strip: Rect; rest: Rect } | null {
  // Shallow, as a terrace should be, but never thinner than a room: that
  // keeps "no room is smaller than minDim" true without an exception for the
  // one room that happens to be outdoors. The draw starts at minDim rather
  // than being clamped up to it, because the clamp swallowed it whole — with
  // the default minDim of 3 the depth came out 3 in all 600 seeds measured.
  const depth = minDim + rng.int(2);
  const side = rng.int(4);
  if (side === 0 || side === 2) {
    if (area.h - depth < minDim) return null;
    const top = side === 0;
    return {
      strip: {
        x: area.x,
        y: top ? area.y : area.y + area.h - depth,
        w: area.w,
        h: depth,
      },
      rest: {
        x: area.x,
        y: top ? area.y + depth : area.y,
        w: area.w,
        h: area.h - depth,
      },
    };
  }
  if (area.w - depth < minDim) return null;
  const left = side === 1;
  return {
    strip: {
      x: left ? area.x : area.x + area.w - depth,
      y: area.y,
      w: depth,
      h: area.h,
    },
    rest: {
      x: left ? area.x + depth : area.x,
      y: area.y,
      w: area.w - depth,
      h: area.h,
    },
  };
}

/**
 * Rooms in reading order — ids run left to right, top to bottom — so a room
 * id printed in a test or in an ASCII picture can be found by eye.
 */
function layOutRooms(rng: RNG, spec: MapSpec): Room[] | null {
  let indoors: Rect = { x: 0, y: 0, w: spec.width, h: spec.height };
  let terrace: Rect | null = null;
  if (spec.outdoor) {
    const cut = sliceTerrace(rng, indoors, spec.minDim);
    if (!cut) return null;
    terrace = cut.strip;
    indoors = cut.rest;
  }
  const inside = dissect(
    rng,
    indoors,
    spec.outdoor ? spec.rooms - 1 : spec.rooms,
    spec.minDim,
  );
  if (!inside) return null;

  const rects = terrace ? [...inside, terrace] : inside;
  const outdoors = new Set<Rect>(terrace ? [terrace] : []);
  // Two rectangles of a dissection cannot share a top-left corner, so this
  // is a total order and the ids it hands out are seed-stable.
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  return rects.map((rect, id) => ({ id, rect, outdoor: outdoors.has(rect) }));
}

/* ------------------------------------------------------------ the doors */

/**
 * Every pair of rooms sharing a wall long enough to hang a door on. One
 * draft per pair, which is what makes `assemblePlan`'s one-door-per-pair
 * rule satisfiable at all.
 */
export function candidateDoors(rooms: readonly Room[]): DoorDraft[] {
  const out: DoorDraft[] = [];
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      const draft = draftDoor(rooms, a, b);
      if (draft) out.push(draft);
    }
  }
  return out;
}

/**
 * A random spanning tree over the candidate graph, so every room can be
 * reached, plus up to `extraDoors` of the leftovers, so the house has loops
 * and an alibi cannot be read off a single corridor.
 *
 * Returns null when the candidates do not connect every room. That happens
 * when a room meets its neighbours only along walls too short for a door —
 * rare, and cheaper to retry than to repair.
 */
export function chooseDoors(
  rng: RNG,
  rooms: readonly Room[],
  extraDoors: number,
): DoorDraft[] | null {
  const parent = Array.from({ length: rooms.length }, (_, i) => i);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root];
    let walk = start;
    while (parent[walk] !== root) {
      const up = parent[walk];
      parent[walk] = root;
      walk = up;
    }
    return root;
  };

  const spare: DoorDraft[] = [];
  const chosen: DoorDraft[] = [];
  for (const draft of rng.shuffle(candidateDoors(rooms))) {
    const ra = find(draft.a);
    const rb = find(draft.b);
    if (ra === rb) {
      spare.push(draft);
      continue;
    }
    parent[ra] = rb;
    chosen.push(draft);
  }
  if (chosen.length !== rooms.length - 1) return null;

  for (let i = 0; i < extraDoors && i < spare.length; i++) {
    chosen.push(spare[i]);
  }
  // Door ids in room order rather than in the order chance offered them: a
  // door id ends up in clues and in save data, and it is easier to read when
  // door 0 is the one nearest the top left.
  chosen.sort((p, q) => p.a - q.a || p.b - q.b);
  return chosen;
}
