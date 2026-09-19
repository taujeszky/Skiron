import { describe, it, expect } from "vitest";
import { bit } from "../bits";
import { corridorPlan, frameOf } from "../testkit";
import {
  AXIOMS_ONLY,
  initialState,
  killPairs,
  makeContext,
  mayBeLivingIn,
  mustBeLivingIn,
  newDeduction,
  pairCount,
  trustedMask,
} from "./state";

/**
 * The two pieces of `state.ts` that every rule leans on and no rule owns.
 *
 * Both were found by mutation testing to be invisible to the rest of the
 * suite: the whole project could be green with either of them broken. They
 * are small enough to test directly, and direct is what they want — a
 * property test over random cases can only reach them through a rule, and
 * then it is the rule that gets the blame.
 */

const frame = frameOf({
  plan: corridorPlan(4),
  suspects: 3,
  slots: 4,
  murderRoom: 2,
  lying: true,
});
const V = frame.victim;

function fresh() {
  const ctx = makeContext(frame, []);
  return { ctx, d: newDeduction(ctx, initialState(ctx), true) };
}

describe("killPairs", () => {
  it("calls an emptied candidate set a contradiction", () => {
    // This is how a tier-3 or tier-4 trial learns it has been refuted: the
    // hypothesis leaves no pair standing. Without it a trial silently
    // succeeds, the refutation is never made, and a case that was fair stops
    // finishing — with every test still green.
    const { d } = fresh();
    expect(d.state.contradiction).toBe(false);
    expect(pairCount(d.state)).toBe(frame.suspects * frame.slots);

    killPairs(d, () => true, "opportunity", 0, AXIOMS_ONLY);
    expect(pairCount(d.state)).toBe(0);
    expect(d.state.contradiction).toBe(true);
  });

  it("does not cry contradiction while a pair survives", () => {
    const { d } = fresh();
    killPairs(d, (s) => s !== 1, "opportunity", 0, AXIOMS_ONLY);
    expect(pairCount(d.state)).toBe(frame.slots);
    expect(d.state.contradiction).toBe(false);
  });

  it("records what the sweep left standing, not just what it took", () => {
    const { d } = fresh();
    // Take every pair of suspects 0 and 2, and slot 0 from suspect 1.
    killPairs(
      d,
      (s, t) => s !== 1 || t === 0,
      "opportunity",
      0,
      AXIOMS_ONLY,
    );
    const step = d.steps![0];
    expect(step.conclusion.kind).toBe("answer-cut");
    if (step.conclusion.kind !== "answer-cut") return;
    expect(step.conclusion.cleared).toEqual([0, 2]);
    // Hour 0 is gone for everybody, so it is closed; the others are not.
    expect(step.conclusion.closed).toEqual([0]);
  });

  it("clearing a suspect is what makes their testimony trustworthy", () => {
    const { ctx, d } = fresh();
    expect(trustedMask(ctx, d.state)).toBe(0);
    killPairs(d, (s) => s === 1, "opportunity", 0, AXIOMS_ONLY);
    expect(trustedMask(ctx, d.state)).toBe(bit(1));
  });
});

describe("the liveness chokepoint", () => {
  // ARCHITECTURE.md section 2: the victim counts as somebody in the room right
  // up to the murder slot, and the body never counts at all. Every counting
  // rule reaches the victim through these two functions and through nothing
  // else, so this is the one place the rule is written down.
  it("counts the victim only while the murder is still to come", () => {
    const { ctx, d } = fresh();
    const s = d.state;
    s.dom[V][2] = bit(1); // the victim can only be in room 1 at slot 2

    // Every surviving murder slot is later than 2: the victim was alive.
    s.answer = s.answer.map(() => bit(3));
    expect(mayBeLivingIn(ctx, s, V, 2, 1)).toBe(true);
    expect(mustBeLivingIn(ctx, s, V, 2, 1)).toBe(true);

    // The murder was at slot 2, so by slot 2 there is only a body there.
    s.answer = s.answer.map(() => bit(2));
    expect(mayBeLivingIn(ctx, s, V, 2, 1)).toBe(false);
    expect(mustBeLivingIn(ctx, s, V, 2, 1)).toBe(false);

    // Both still open: they may have been alive, but it is not certain, and
    // the difference between those two is what keeps tier 2 sound.
    s.answer = s.answer.map(() => bit(2) | bit(3));
    expect(mayBeLivingIn(ctx, s, V, 2, 1)).toBe(true);
    expect(mustBeLivingIn(ctx, s, V, 2, 1)).toBe(false);
  });

  it("never counts anybody in a room their domain has ruled out", () => {
    const { ctx, d } = fresh();
    const s = d.state;
    s.dom[V][2] = bit(1);
    s.answer = s.answer.map(() => bit(3));
    expect(mayBeLivingIn(ctx, s, V, 2, 0)).toBe(false);
    s.dom[0][1] = bit(2);
    expect(mayBeLivingIn(ctx, s, 0, 1, 2)).toBe(true);
    expect(mayBeLivingIn(ctx, s, 0, 1, 3)).toBe(false);
    expect(mustBeLivingIn(ctx, s, 0, 1, 2)).toBe(true);
  });

  it("treats a suspect as present wherever their domain still allows", () => {
    const { ctx, d } = fresh();
    const s = d.state;
    // A suspect is alive all evening, so no murder slot can change this.
    s.answer = s.answer.map(() => bit(0));
    expect(mayBeLivingIn(ctx, s, 0, 3, 1)).toBe(true);
    // ... but with two rooms open they are not *certainly* in either.
    s.dom[0][3] = bit(1) | bit(2);
    expect(mustBeLivingIn(ctx, s, 0, 3, 1)).toBe(false);
    s.dom[0][3] = bit(1);
    expect(mustBeLivingIn(ctx, s, 0, 3, 1)).toBe(true);
  });

  it("counts nobody at all once the answer set is empty", () => {
    const { ctx, d } = fresh();
    const s = d.state;
    s.dom[V][1] = bit(1);
    s.answer = s.answer.map(() => 0);
    // A contradicted state proves nothing, and in particular must not let a
    // counting rule conclude the victim was certainly standing somewhere.
    expect(mayBeLivingIn(ctx, s, V, 1, 1)).toBe(false);
    expect(mustBeLivingIn(ctx, s, V, 1, 1)).toBe(false);
  });
});
