/**
 * Hand-built cases for tests.
 *
 * These deliberately do NOT go through the generator: a test that builds its
 * own plan and its own world can disagree with the generator, which is the
 * whole point of having an oracle. Keep this module dumb.
 */

import { assemblePlan, draftDoor } from "./map/plan";
import type {
  CaseFrame,
  CaseRules,
  FloorPlan,
  PersonId,
  RoomId,
  Room,
  SlotIndex,
  World,
} from "./types";
import { noRules } from "./types";

/**
 * A `cols` x `rows` block of identical square rooms, numbered row-major, with
 * a door on every shared wall. Room `r` sits at column `r % cols`.
 */
export function gridPlan(
  cols: number,
  rows: number,
  opts: { size?: number; outdoor?: RoomId[] } = {},
): FloorPlan {
  const size = opts.size ?? 4;
  const outdoor = new Set(opts.outdoor ?? []);
  const rooms: Room[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const id = y * cols + x;
      rooms.push({
        id,
        rect: { x: x * size, y: y * size, w: size, h: size },
        outdoor: outdoor.has(id),
      });
    }
  }
  const drafts = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const id = y * cols + x;
      if (x + 1 < cols) {
        const d = draftDoor(rooms, id, id + 1);
        if (d) drafts.push(d);
      }
      if (y + 1 < rows) {
        const d = draftDoor(rooms, id, id + cols);
        if (d) drafts.push(d);
      }
    }
  }
  return assemblePlan(cols * size, rows * size, rooms, drafts);
}

/**
 * A line of `n` rooms, each joined only to its neighbours. The tightest map
 * there is, which makes movement deductions bite in a test.
 */
export function corridorPlan(n: number, size = 4): FloorPlan {
  return gridPlan(n, 1, { size });
}

export function frameOf(init: {
  plan: FloorPlan;
  suspects: number;
  slots: number;
  murderRoom: RoomId;
  lying?: boolean;
  rules?: CaseRules;
}): CaseFrame {
  return {
    plan: init.plan,
    rules: init.rules ?? noRules(),
    suspects: init.suspects,
    slots: init.slots,
    people: init.suspects + 1,
    victim: init.suspects,
    murderRoom: init.murderRoom,
    lying: init.lying ?? false,
  };
}

/**
 * A world from one row of room ids per person, victim last. The rows are the
 * same shape as the notebook grid, so a test reads like the table it means.
 */
export function worldOf(
  rows: readonly (readonly RoomId[])[],
  culprit: PersonId,
  murderSlot: SlotIndex,
): World {
  return {
    loc: rows.map((r) => [...r]),
    culprit,
    murderSlot,
  };
}
