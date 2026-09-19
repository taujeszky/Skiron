/**
 * The map. `buildFloorPlan(rng, opts)` is the entry point: give it a seeded
 * RNG and a room count and it returns a `FloorPlan` whose rectangles tile the
 * footprint, whose rooms are all reachable, and whose geometry and graph are
 * the same data seen twice.
 *
 * The rest of the engine should import from here rather than from the
 * modules below, which are split by job and not by what a caller needs.
 */

export { buildFloorPlan, candidateDoors, chooseDoors, dissect } from "./dissect";
export type { MapOptions } from "./dissect";

export {
  assemblePlan,
  doorAt,
  draftDoor,
  planConnected,
  roomsOverlap,
  sharedWall,
} from "./plan";
export type { DoorDraft, SharedWall } from "./plan";

export { planToAscii, planToSvg } from "./ascii";
