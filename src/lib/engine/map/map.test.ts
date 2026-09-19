import { describe, it, expect } from "vitest";
import { bit } from "../bits";
import { RNG } from "../rng";
import type { FloorPlan } from "../types";
import {
  buildFloorPlan,
  doorAt,
  planConnected,
  planToAscii,
  planToSvg,
  roomsOverlap,
  sharedWall,
} from "./index";
import type { MapOptions } from "./index";

const DEFAULT_WIDTH = 18;
const DEFAULT_HEIGHT = 12;
const DEFAULT_MIN_DIM = 3;

function plan(seed: string, opts: MapOptions): FloorPlan {
  return buildFloorPlan(new RNG(seed), opts);
}

/**
 * Everything a plan promises, checked from the outside: it is re-derived
 * from `rooms` and `doors` rather than trusted, so a builder that lied to
 * `assemblePlan` would still be caught here.
 */
function checkPlan(p: FloorPlan, opts: MapOptions): void {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const minDim = opts.minDim ?? DEFAULT_MIN_DIM;
  const n = p.rooms.length;

  expect(p.width).toBe(width);
  expect(p.height).toBe(height);
  expect(n).toBe(opts.rooms);

  // Rectangles: whole units, inside the footprint, no smaller than minDim.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const room = p.rooms[i];
    expect(room.id).toBe(i);
    const { x, y, w, h } = room.rect;
    for (const v of [x, y, w, h]) expect(Number.isInteger(v)).toBe(true);
    expect(w).toBeGreaterThanOrEqual(minDim);
    expect(h).toBeGreaterThanOrEqual(minDim);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(width);
    expect(y + h).toBeLessThanOrEqual(height);
    area += w * h;
  }
  // No overlap plus the right total area is exactly "these rectangles tile
  // the footprint": neither alone would do.
  expect(roomsOverlap(p.rooms)).toBe(false);
  expect(area).toBe(width * height);

  expect(p.rooms.filter((r) => r.outdoor).length).toBe(opts.outdoor ? 1 : 0);

  // Doors: one per pair, on a wall the two rooms really share.
  const pairs = new Set<string>();
  for (let i = 0; i < p.doors.length; i++) {
    const d = p.doors[i];
    expect(d.id).toBe(i);
    expect(d.a).not.toBe(d.b);
    const key = `${Math.min(d.a, d.b)}-${Math.max(d.a, d.b)}`;
    expect(pairs.has(key)).toBe(false);
    pairs.add(key);

    const wall = sharedWall(p.rooms[d.a].rect, p.rooms[d.b].rect);
    expect(wall).not.toBeNull();
    if (!wall) continue;
    expect(wall.to - wall.from).toBeGreaterThanOrEqual(2);
    expect(d.wall).toBe(wall.wall);
    expect({ x: d.x, y: d.y }).toEqual(doorAt(wall));
  }

  // The lookup tables say the same thing as the door list.
  const adjacency = new Array<number>(n).fill(0);
  const doorsFrom: number[][] = Array.from({ length: n }, () => []);
  const doorBetween = new Array<number>(n * n).fill(-1);
  for (const d of p.doors) {
    adjacency[d.a] |= bit(d.b);
    adjacency[d.b] |= bit(d.a);
    doorsFrom[d.a].push(d.id);
    doorsFrom[d.b].push(d.id);
    doorBetween[d.a * n + d.b] = d.id;
    doorBetween[d.b * n + d.a] = d.id;
  }
  expect(p.adjacency).toEqual(adjacency);
  expect(p.doorsFrom).toEqual(doorsFrom);
  expect(p.doorBetween).toEqual(doorBetween);
  for (let r = 0; r < n; r++) expect(p.adjacency[r] & bit(r)).toBe(0);

  expect(planConnected(p)).toBe(true);
  expect(p.doors.length).toBeGreaterThanOrEqual(n - 1);
}

const SEEDS = 200;

describe("buildFloorPlan", () => {
  for (const outdoor of [false, true]) {
    for (let rooms = 5; rooms <= 9; rooms++) {
      it(`builds ${rooms} rooms${outdoor ? " with a terrace" : ""} over ${SEEDS} seeds`, () => {
        const opts: MapOptions = { rooms, outdoor };
        for (let s = 0; s < SEEDS; s++) {
          checkPlan(plan(`SK1-${rooms}-${outdoor}-${s}`, opts), opts);
        }
      });
    }
  }

  it("honours a non-default footprint and minimum room size", () => {
    const opts: MapOptions = {
      rooms: 6,
      width: 20,
      height: 16,
      minDim: 4,
      extraDoors: 1,
    };
    for (let s = 0; s < 100; s++) checkPlan(plan(`box-${s}`, opts), opts);
  });

  it("is a spanning tree and nothing more when extraDoors is 0", () => {
    for (let s = 0; s < 100; s++) {
      const p = plan(`tree-${s}`, { rooms: 7, extraDoors: 0 });
      expect(p.doors.length).toBe(p.rooms.length - 1);
    }
  });

  it("puts cycles in the house when extraDoors allows it", () => {
    let cyclic = 0;
    for (let s = 0; s < SEEDS; s++) {
      const p = plan(`cycle-${s}`, { rooms: 7, extraDoors: 2 });
      if (p.doors.length > p.rooms.length - 1) cyclic++;
      // Never more than the tree plus the extras that were asked for.
      expect(p.doors.length).toBeLessThanOrEqual(p.rooms.length - 1 + 2);
    }
    // A dissection of seven rooms always leaves spare walls to hang a door
    // on, so this is not a "mostly" — it is every seed.
    expect(cyclic).toBe(SEEDS);
  });

  it("gives the same plan for the same seed and options", () => {
    for (let s = 0; s < 40; s++) {
      const opts: MapOptions = { rooms: 8, outdoor: true };
      const a = plan(`same-${s}`, opts);
      const b = plan(`same-${s}`, opts);
      expect(a).toEqual(b);
    }
  });

  it("gives different plans for different seeds", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 60; s++) {
      seen.add(JSON.stringify(plan(`vary-${s}`, { rooms: 7 })));
    }
    // Collisions are possible and harmless; a builder that ignored its seed
    // is what this catches.
    expect(seen.size).toBeGreaterThanOrEqual(55);
  });

  it("draws one number from the caller's RNG whatever it takes", () => {
    const a = new RNG("stream");
    buildFloorPlan(a, { rooms: 5 });
    const after = a.next();
    const b = new RNG("stream");
    b.next();
    expect(after).toBe(b.next());
  });

  it("rejects options it cannot satisfy", () => {
    // A 6x6 footprint holds four 3x3 rooms and not a fifth.
    expect(() => plan("nope", { rooms: 5, width: 6, height: 6 })).toThrow(
      /no 5-room plan/,
    );
    expect(() => plan("nope", { rooms: 4, width: 6, height: 6 })).not.toThrow();
    expect(() => plan("nope", { rooms: 1 })).toThrow(/at least 2/);
    expect(() => plan("nope", { rooms: 17 })).toThrow(/at most 16/);
    expect(() => plan("nope", { rooms: 5, minDim: 0 })).toThrow(/minDim/);
    expect(() => plan("nope", { rooms: 5, extraDoors: -1 })).toThrow(
      /extraDoors/,
    );
    expect(() => plan("nope", { rooms: 5, width: 2, height: 2 })).toThrow(
      /smaller than one room/,
    );
  });
});

describe("planToAscii", () => {
  it("draws every room, its id and its doors", () => {
    const p = plan("ascii", { rooms: 8, outdoor: true });
    const out = planToAscii(p);
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");

    const lines = out.split("\n");
    // The picture, then one legend line.
    expect(lines.length).toBe(p.height + 2);
    for (let i = 0; i < p.height + 1; i++) {
      expect(lines[i].length).toBe(p.width * 3 + 1);
    }

    // Digits appear in the picture only as room labels, so this really does
    // check that every room got drawn.
    const picture = lines.slice(0, p.height + 1).join("\n");
    for (const room of p.rooms) expect(picture).toContain(String(room.id));
    expect(picture).toContain("*");
    expect((picture.match(/o/g) ?? []).length).toBe(p.doors.length);
  });

  it("draws a plan without a terrace too", () => {
    const p = plan("ascii-in", { rooms: 5 });
    const lines = planToAscii(p).split("\n");
    const picture = lines.slice(0, p.height + 1).join("\n");
    expect(picture).not.toContain("undefined");
    // No terrace, so no room carries the outdoor mark.
    expect(picture).not.toContain("*");
    for (const room of p.rooms) expect(picture).toContain(String(room.id));
  });
});

describe("planToSvg", () => {
  it("returns a standalone SVG naming every room", () => {
    const p = plan("svg", { rooms: 9, outdoor: true });
    const out = planToSvg(p);
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
    expect(out.startsWith("<svg xmlns=")).toBe(true);
    expect(out.endsWith("</svg>")).toBe(true);
    for (const room of p.rooms) {
      expect(out).toContain(`>${room.id}</text>`);
    }
    // Each door is a gap plus a threshold.
    expect((out.match(/<line /g) ?? []).length).toBe(p.doors.length * 2);
  });
});
