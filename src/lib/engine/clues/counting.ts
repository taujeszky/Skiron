/**
 * How many were in a room: `Occupied`, `Empty`, `Count`.
 *
 * Heads, not names — which is what makes them worth asking about. "Somebody
 * was in the library at nine" tells the player where to point the next
 * question, and "nobody was in the study at eleven" can be true of the room
 * the body is lying in, because the body is not somebody (ARCHITECTURE.md §2).
 * That one is a gift: it says the killer left.
 */

import { headCount, presentMask } from "../axioms";
import type { KindModule } from "./common";
import { isRoom, isSlot, mentions, topicKeysFrom } from "./common";

export const Occupied: KindModule<"Occupied"> = {
  kind: "Occupied",
  holds: (b, frame, world) => presentMask(frame, world, b.r, b.t) !== 0,
  canonical: (b) => `Occupied(r${b.r},t${b.t})`,
  normalise: (b) => b,
  valid: (b, frame) => isRoom(frame, b.r) && isSlot(frame, b.t),
  topicKeys: (b, frame) => topicKeysFrom(Occupied.mentions(b), frame),
  mentions: (b) => mentions({ rooms: [b.r], slots: [b.t] }),
};

export const Empty: KindModule<"Empty"> = {
  kind: "Empty",
  holds: (b, frame, world) => presentMask(frame, world, b.r, b.t) === 0,
  canonical: (b) => `Empty(r${b.r},t${b.t})`,
  normalise: (b) => b,
  valid: (b, frame) => isRoom(frame, b.r) && isSlot(frame, b.t),
  topicKeys: (b, frame) => topicKeysFrom(Empty.mentions(b), frame),
  mentions: (b) => mentions({ rooms: [b.r], slots: [b.t] }),
};

export const Count: KindModule<"Count"> = {
  kind: "Count",
  holds: (b, frame, world) => headCount(frame, world, b.r, b.t) === b.k,
  canonical: (b) => `Count(r${b.r},t${b.t},k${b.k})`,
  normalise: (b) => b,
  // `k` may be 0 — that is `Empty` said the other way, and the two are kept
  // apart on purpose so the fidelity check can tell the sentences apart.
  valid: (b, frame) =>
    isRoom(frame, b.r) &&
    isSlot(frame, b.t) &&
    Number.isInteger(b.k) &&
    b.k >= 0 &&
    b.k <= frame.people,
  topicKeys: (b, frame) => topicKeysFrom(Count.mentions(b), frame),
  mentions: (b) => mentions({ rooms: [b.r], slots: [b.t] }),
};
