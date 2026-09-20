/**
 * Who had company: `Saw`, `Together`, `AloneIn`.
 *
 * These count the *living* (ARCHITECTURE.md §2). The victim counts while
 * alive and the body never counts, so nobody ever "saw" the corpse and a
 * killer standing over it is `AloneIn`. That is deliberate: `AloneIn(c,t*,r*)`
 * is exactly rule 4, and it would be a strange clue if the body made a crowd.
 */

import { isLiving, presentMask } from "../axioms";
import { bit, has } from "../bits";
import type { KindModule } from "./common";
import {
  isPerson,
  isRoom,
  isSlot,
  mentions,
  naming,
  topicKeysFrom,
} from "./common";

export const Saw: KindModule<"Saw"> = {
  kind: "Saw",
  fields: { p: "person", q: "person", t: "slot", r: "room" },
  holds: (b, frame, world) => {
    if (b.p === b.q) return false;
    const present = presentMask(frame, world, b.r, b.t);
    return has(present, b.p) && has(present, b.q);
  },
  canonical: (b) => {
    const n = Saw.normalise(b);
    return `Saw(p${n.p},p${n.q},t${n.t},r${n.r})`;
  },
  // Symmetric as a formula: who is speaking lives in the clue's `source`, not
  // in the body, so the two spellings must compare equal.
  normalise: (b) => (b.p <= b.q ? b : { ...b, p: b.q, q: b.p }),
  valid: (b, frame) =>
    b.p !== b.q &&
    isPerson(frame, b.p) &&
    isPerson(frame, b.q) &&
    isSlot(frame, b.t) &&
    isRoom(frame, b.r),
  topicKeys: (b, frame) => topicKeysFrom(Saw.mentions(b, frame), frame),
  mentions: (b) =>
    mentions({ people: [b.p, b.q], rooms: [b.r], slots: [b.t] }),
  // Told by one of the two it reads as an eyewitness account, which is what
  // it is; told by anyone else it is a fact about a room.
  template: (b, _frame, g, speaker) => {
    const n = naming(g, speaker);
    const where = `in ${g.roomName(b.r)} at ${g.slotLabel(b.t)}`;
    if (n.isSelf(b.p)) return `I saw ${n.object(b.q)} ${where}`;
    if (n.isSelf(b.q)) return `I saw ${n.object(b.p)} ${where}`;
    return `${n.subject(b.p)} and ${n.subject(b.q)} were both ${where}`;
  },
};

export const Together: KindModule<"Together"> = {
  kind: "Together",
  fields: { p: "person", q: "person", t: "slot" },
  holds: (b, frame, world) =>
    b.p !== b.q &&
    isLiving(frame, world, b.p, b.t) &&
    isLiving(frame, world, b.q, b.t) &&
    world.loc[b.p][b.t] === world.loc[b.q][b.t],
  canonical: (b) => {
    const n = Together.normalise(b);
    return `Together(p${n.p},p${n.q},t${n.t})`;
  },
  normalise: (b) => (b.p <= b.q ? b : { ...b, p: b.q, q: b.p }),
  valid: (b, frame) =>
    b.p !== b.q &&
    isPerson(frame, b.p) &&
    isPerson(frame, b.q) &&
    isSlot(frame, b.t),
  topicKeys: (b, frame) => topicKeysFrom(Together.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p, b.q], slots: [b.t] }),
  // The room is deliberately not named: that is the whole difference between
  // this and `Saw`, and the sentence has to keep it.
  template: (b, _frame, g, speaker) => {
    const n = naming(g, speaker);
    const when = `at ${g.slotLabel(b.t)}`;
    if (n.isSelf(b.p)) return `I was with ${n.object(b.q)} ${when}`;
    if (n.isSelf(b.q)) return `I was with ${n.object(b.p)} ${when}`;
    return `${n.subject(b.p)} and ${n.subject(b.q)} were in the same room ${when}`;
  },
};

export const AloneIn: KindModule<"AloneIn"> = {
  kind: "AloneIn",
  fields: { p: "person", t: "slot", r: "room" },
  holds: (b, frame, world) => presentMask(frame, world, b.r, b.t) === bit(b.p),
  canonical: (b) => `AloneIn(p${b.p},t${b.t},r${b.r})`,
  normalise: (b) => b,
  valid: (b, frame) =>
    isPerson(frame, b.p) && isSlot(frame, b.t) && isRoom(frame, b.r),
  topicKeys: (b, frame) => topicKeysFrom(AloneIn.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], rooms: [b.r], slots: [b.t] }),
  template: (b, _frame, g, speaker) =>
    `${naming(g, speaker).subject(b.p)} was alone in ${g.roomName(b.r)} at ${g.slotLabel(b.t)}`,
};
