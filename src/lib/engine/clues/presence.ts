/**
 * Where a body was: `At`, `NotAt`, `Stayed`, `Visited`, `NeverVisited`.
 *
 * These five read `loc` raw, so they hold of the victim's corpse as readily
 * as of a living suspect — "the body was in the study at eleven" is a true
 * `At`. That is one half of the split in ARCHITECTURE.md §2; everything about
 * company counts the living instead and lives in `company.ts` and
 * `counting.ts`.
 */

import type { BodyOf } from "../types";
import type { KindModule } from "./common";
import {
  isPerson,
  isRoom,
  isSlot,
  mentions,
  span,
  topicKeysFrom,
} from "./common";

export const At: KindModule<"At"> = {
  kind: "At",
  holds: (b, _frame, world) => world.loc[b.p][b.t] === b.r,
  canonical: (b) => `At(p${b.p},t${b.t},r${b.r})`,
  normalise: (b) => b,
  valid: (b, frame) =>
    isPerson(frame, b.p) && isSlot(frame, b.t) && isRoom(frame, b.r),
  topicKeys: (b, frame) => topicKeysFrom(At.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], rooms: [b.r], slots: [b.t] }),
};

export const NotAt: KindModule<"NotAt"> = {
  kind: "NotAt",
  holds: (b, _frame, world) => world.loc[b.p][b.t] !== b.r,
  canonical: (b) => `NotAt(p${b.p},t${b.t},r${b.r})`,
  normalise: (b) => b,
  valid: (b, frame) =>
    isPerson(frame, b.p) && isSlot(frame, b.t) && isRoom(frame, b.r),
  topicKeys: (b, frame) => topicKeysFrom(NotAt.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], rooms: [b.r], slots: [b.t] }),
};

export const Stayed: KindModule<"Stayed"> = {
  kind: "Stayed",
  // Read min..max rather than t1..t2 so a span the wrong way round is false
  // where it should be, instead of vacuously true.
  holds: (b, _frame, world) => {
    const lo = Math.min(b.t1, b.t2);
    const hi = Math.max(b.t1, b.t2);
    for (let t = lo; t <= hi; t++) {
      if (world.loc[b.p][t] !== b.r) return false;
    }
    return true;
  },
  canonical: (b) => {
    const n = Stayed.normalise(b);
    return `Stayed(p${n.p},r${n.r},t${n.t1},t${n.t2})`;
  },
  normalise: (b) => (b.t1 <= b.t2 ? b : { ...b, t1: b.t2, t2: b.t1 }),
  // A one-slot "span" is an `At`, and the two must not be spellings of each
  // other — the fidelity check has to tell them apart.
  valid: (b, frame) =>
    isPerson(frame, b.p) &&
    isRoom(frame, b.r) &&
    isSlot(frame, b.t1) &&
    isSlot(frame, b.t2) &&
    b.t1 < b.t2,
  topicKeys: (b, frame) => topicKeysFrom(Stayed.mentions(b, frame), frame),
  mentions: (b) =>
    mentions({ people: [b.p], rooms: [b.r], slots: span(b.t1, b.t2) }),
};

export const Visited: KindModule<"Visited"> = {
  kind: "Visited",
  holds: (b, frame, world) => everWas(b, frame.slots, world.loc[b.p]),
  canonical: (b) => `Visited(p${b.p},r${b.r})`,
  normalise: (b) => b,
  valid: (b, frame) => isPerson(frame, b.p) && isRoom(frame, b.r),
  topicKeys: (b, frame) => topicKeysFrom(Visited.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], rooms: [b.r] }),
};

export const NeverVisited: KindModule<"NeverVisited"> = {
  kind: "NeverVisited",
  holds: (b, frame, world) => !everWas(b, frame.slots, world.loc[b.p]),
  canonical: (b) => `NeverVisited(p${b.p},r${b.r})`,
  normalise: (b) => b,
  valid: (b, frame) => isPerson(frame, b.p) && isRoom(frame, b.r),
  topicKeys: (b, frame) =>
    topicKeysFrom(NeverVisited.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], rooms: [b.r] }),
};

/** Walk the frame's slots, not the row's length: the frame is authoritative. */
function everWas(
  b: BodyOf<"Visited"> | BodyOf<"NeverVisited">,
  slots: number,
  row: readonly number[],
): boolean {
  for (let t = 0; t < slots; t++) {
    if (row[t] === b.r) return true;
  }
  return false;
}
