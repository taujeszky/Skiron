/**
 * When the victim died: `AliveAt`, `DeathWindow`.
 *
 * The only two clues that talk about the murder slot directly, and so the
 * only two that bear on half the answer without naming anybody. They mention
 * the victim without carrying a person id, which is why `mentions` has to be
 * told about `frame.victim` — asking about the dead man is how you learn when
 * he was last seen breathing, and the notebook lights his row for the answer.
 */

import { victimAliveAt } from "../axioms";
import type { KindModule } from "./common";
import { isSlot, mentions, span, topicKeysFrom } from "./common";

export const AliveAt: KindModule<"AliveAt"> = {
  kind: "AliveAt",
  holds: (b, _frame, world) => victimAliveAt(world, b.t),
  canonical: (b) => `AliveAt(t${b.t})`,
  normalise: (b) => b,
  valid: (b, frame) => isSlot(frame, b.t),
  topicKeys: (b, frame) => topicKeysFrom(AliveAt.mentions(b, frame), frame),
  mentions: (b, frame) => mentions({ people: [frame.victim], slots: [b.t] }),
  template: (b, frame, g) =>
    `${g.personName(frame.victim)} was still alive at ${g.slotLabel(b.t)}`,
};

export const DeathWindow: KindModule<"DeathWindow"> = {
  kind: "DeathWindow",
  holds: (b, _frame, world) => {
    const lo = Math.min(b.a, b.b);
    const hi = Math.max(b.a, b.b);
    return world.murderSlot >= lo && world.murderSlot <= hi;
  },
  canonical: (b) => {
    const n = DeathWindow.normalise(b);
    return `DeathWindow(t${n.a},t${n.b})`;
  },
  normalise: (b) => (b.a <= b.b ? b : { ...b, a: b.b, b: b.a }),
  // `a === b` is allowed: a window one slot wide is the murder slot named,
  // and the generator issues it when the evidence really is that tight.
  valid: (b, frame) => isSlot(frame, b.a) && isSlot(frame, b.b) && b.a <= b.b,
  topicKeys: (b, frame) => topicKeysFrom(DeathWindow.mentions(b, frame), frame),
  mentions: (b, frame) =>
    mentions({ people: [frame.victim], slots: span(b.a, b.b) }),
  template: (b, frame, g) => {
    const n = DeathWindow.normalise(b);
    const who = g.personName(frame.victim);
    if (n.a === n.b) return `${who} was killed at ${g.slotLabel(n.a)}`;
    return `${who} was killed between ${g.slotLabel(n.a)} and ${g.slotLabel(n.b)}`;
  },
};
