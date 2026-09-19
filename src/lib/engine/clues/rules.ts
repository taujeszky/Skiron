/**
 * The case-file rules as clues: `DoorClosed`, `BarredDoor`, `BarredRoom`,
 * `Capacity`.
 *
 * `frame.rules` is the authoritative copy — that is what `isLegal` reads, and
 * the truth simulation obeys it by construction, so these four are true of
 * the true world for free. The clue forms exist so a rule can be shown as a
 * card, highlighted in the notebook and parsed back by wave 5's fidelity
 * check. They are ordinary formulas over a world all the same, which is what
 * lets a test hand one a world that breaks it.
 */

import { headCount } from "../axioms";
import type { CaseFrame, DoorId, PersonId, SlotIndex, World } from "../types";
import type { KindModule } from "./common";
import {
  doorBetween,
  headsWord,
  isDoor,
  isPerson,
  isRoom,
  isSlot,
  mentions,
  naming,
  span,
  topicKeysFrom,
} from "./common";

/**
 * Did `p` cross door `e` on the transition `t -> t+1`? Readable off the
 * timeline alone only because at most one door joins any pair of rooms; the
 * map builder enforces that, and these two clue kinds are why it must
 * (ARCHITECTURE.md §3).
 */
function crossed(
  frame: CaseFrame,
  world: World,
  p: PersonId,
  e: DoorId,
  t: SlotIndex,
): boolean {
  const door = frame.plan.doors[e];
  if (!door) return false;
  const from = world.loc[p][t];
  const to = world.loc[p][t + 1];
  return (
    (from === door.a && to === door.b) || (from === door.b && to === door.a)
  );
}

export const DoorClosed: KindModule<"DoorClosed"> = {
  kind: "DoorClosed",
  // Blocks the transitions `from <= t < to`, so the last transition it can
  // name is `slots - 2`; clamping here keeps a span that runs to the end of
  // the evening from reading past the timeline.
  holds: (b, frame, world) => {
    const lo = Math.max(0, Math.min(b.from, b.to));
    const hi = Math.min(Math.max(b.from, b.to), frame.slots - 1);
    for (let t = lo; t < hi; t++) {
      for (let p = 0; p < frame.people; p++) {
        if (crossed(frame, world, p, b.door, t)) return false;
      }
    }
    return true;
  },
  canonical: (b) => {
    const n = DoorClosed.normalise(b);
    return `DoorClosed(e${n.door},t${n.from},t${n.to})`;
  },
  normalise: (b) => (b.from <= b.to ? b : { ...b, from: b.to, to: b.from }),
  // `from === to` would close nothing at all, so it is not a well formed
  // rule, however true it is.
  valid: (b, frame) =>
    isDoor(frame, b.door) &&
    isSlot(frame, b.from) &&
    isSlot(frame, b.to) &&
    b.from < b.to,
  topicKeys: (b, frame) => topicKeysFrom(DoorClosed.mentions(b, frame), frame),
  mentions: (b) => mentions({ doors: [b.door], slots: span(b.from, b.to) }),
  template: (b, frame, g) => {
    const n = DoorClosed.normalise(b);
    return (
      `the door between ${doorBetween(frame, n.door, g)} was locked ` +
      `between ${g.slotLabel(n.from)} and ${g.slotLabel(n.to)}`
    );
  },
};

export const BarredDoor: KindModule<"BarredDoor"> = {
  kind: "BarredDoor",
  holds: (b, frame, world) => {
    for (let t = 0; t + 1 < frame.slots; t++) {
      if (crossed(frame, world, b.p, b.door, t)) return false;
    }
    return true;
  },
  canonical: (b) => `BarredDoor(p${b.p},e${b.door})`,
  normalise: (b) => b,
  valid: (b, frame) => isPerson(frame, b.p) && isDoor(frame, b.door),
  topicKeys: (b, frame) => topicKeysFrom(BarredDoor.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], doors: [b.door] }),
  template: (b, frame, g, speaker) =>
    `${naming(g, speaker).subject(b.p)} never used the door between ${doorBetween(frame, b.door, g)}`,
};

export const BarredRoom: KindModule<"BarredRoom"> = {
  kind: "BarredRoom",
  holds: (b, frame, world) => {
    for (let t = 0; t < frame.slots; t++) {
      if (world.loc[b.p][t] === b.r) return false;
    }
    return true;
  },
  canonical: (b) => `BarredRoom(p${b.p},r${b.r})`,
  normalise: (b) => b,
  valid: (b, frame) => isPerson(frame, b.p) && isRoom(frame, b.r),
  topicKeys: (b, frame) => topicKeysFrom(BarredRoom.mentions(b, frame), frame),
  mentions: (b) => mentions({ people: [b.p], rooms: [b.r] }),
  // Not the same sentence as `NeverVisited`, and not by accident: this is a
  // rule of the house saying they *could not*, where the other is an
  // observation that they *did not*.
  template: (b, _frame, g, speaker) =>
    `${naming(g, speaker).subject(b.p)} could not enter ${g.roomName(b.r)} at all that evening`,
};

export const Capacity: KindModule<"Capacity"> = {
  kind: "Capacity",
  // Living heads, like every other counting clue: a room whose cap is one can
  // still hold a corpse and its killer.
  holds: (b, frame, world) => {
    for (let t = 0; t < frame.slots; t++) {
      if (headCount(frame, world, b.r, t) > b.k) return false;
    }
    return true;
  },
  canonical: (b) => `Capacity(r${b.r},k${b.k})`,
  normalise: (b) => b,
  // A cap of zero would be a room nobody may enter, which is `BarredRoom` for
  // everyone and would make the murder room unusable.
  valid: (b, frame) => isRoom(frame, b.r) && Number.isInteger(b.k) && b.k >= 1,
  topicKeys: (b, frame) => topicKeysFrom(Capacity.mentions(b, frame), frame),
  mentions: (b) => mentions({ rooms: [b.r] }),
  // Phrased so the room is not the first word: a glossary is free to return
  // "the scullery", and a sentence may not begin mid-phrase.
  template: (b, _frame, g) =>
    `at most ${headsWord(b.k)} could be in ${g.roomName(b.r)} at once`,
};
