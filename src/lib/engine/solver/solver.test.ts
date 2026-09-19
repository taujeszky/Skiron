import { describe, it, expect } from "vitest";
import { RNG } from "../rng";
import { bitsOf } from "../bits";
import { allowedRoomsMask, isLegal } from "../axioms";
import { buildFloorPlan } from "../map";
import { clueHolds, holds } from "../clues";
import { simulateTruth } from "../world/simulate";
import { answerPossible, cellPossible } from "./exhaustive";
import { solve } from "./solve";
import { noRules } from "../types";
import type { CaseFrame, Clue, ClueBody, World } from "../types";

/**
 * THE SOUNDNESS ORACLE. The most important file in the project.
 *
 * Everything rests on one property: a deduction rule may remove a candidate
 * only when that candidate appears in no legal world consistent with the
 * clues. Grading, hints, and the whole fairness argument ("the solver
 * finished, therefore the answer is unique") are worthless without it.
 *
 * So: run the deduction solver on random cases, then ask wave 1's exhaustive
 * solver — an independent implementation that shares no reasoning code —
 * whether anything the deduction solver threw away was actually possible.
 *
 * A NEW RULE JOINS THIS GUARD. That is not a convention, it is the only thing
 * standing between a plausible-looking rule and cases that cannot be solved.
 */

/** A clue enumerator of its own, so the guard does not lean on wave 3's. */
function trueClues(frame: CaseFrame, world: World, rng: RNG): Clue[] {
  const out: Clue[] = [];
  const R = frame.plan.rooms.length;
  const T = frame.slots;
  const P = frame.people;
  let n = 0;
  const push = (body: ClueBody, speaker: number | null) => {
    if (!holds(body, frame, world)) return;
    out.push({
      id: `c${n++}`,
      body,
      source: speaker === null ? { kind: "fact" } : { kind: "testimony", speaker },
    });
  };
  // whoever shares a room with a suspect is what that suspect could report
  for (let p = 0; p < P; p++) {
    const teller = p < frame.suspects ? p : null;
    for (let t = 0; t < T; t++) {
      for (let r = 0; r < R; r++) {
        push({ kind: "At", p, t, r }, teller);
        push({ kind: "NotAt", p, t, r }, teller);
        push({ kind: "AloneIn", p, t, r }, teller);
      }
    }
    for (let r = 0; r < R; r++) {
      push({ kind: "Visited", p, r }, teller);
      push({ kind: "NeverVisited", p, r }, teller);
    }
    for (let t1 = 0; t1 + 1 < T; t1++) {
      for (let t2 = t1 + 1; t2 < T; t2++) {
        for (let r = 0; r < R; r++) push({ kind: "Stayed", p, r, t1, t2 }, teller);
      }
    }
  }
  for (let p = 0; p < P; p++) {
    for (let q = p + 1; q < P; q++) {
      const teller = p < frame.suspects ? p : null;
      for (let t = 0; t < T; t++) {
        push({ kind: "Together", p, q, t }, teller);
        for (let r = 0; r < R; r++) push({ kind: "Saw", p, q, t, r }, teller);
      }
    }
  }
  for (let r = 0; r < R; r++) {
    for (let t = 0; t < T; t++) {
      push({ kind: "Occupied", r, t }, null);
      push({ kind: "Empty", r, t }, null);
      for (let k = 0; k <= P; k++) push({ kind: "Count", r, t, k }, null);
    }
  }
  for (let t = 0; t < T; t++) push({ kind: "AliveAt", t }, null);
  for (let a = 0; a < T; a++) {
    for (let b = a; b < T; b++) push({ kind: "DeathWindow", a, b }, null);
  }
  return rng.shuffle(out);
}

/**
 * Statements the culprit could tell, which are FALSE in the true world. With
 * lying on these are legitimate clues — the implication `s != culprit => phi`
 * is vacuous in the true world — and they are exactly what a rule that
 * forgets to check trust will choke on.
 */
function lies(frame: CaseFrame, world: World, rng: RNG, howMany: number): Clue[] {
  const c = world.culprit;
  const R = frame.plan.rooms.length;
  const out: Clue[] = [];
  let n = 0;
  for (let t = 0; t < frame.slots && out.length < howMany * 4; t++) {
    for (let r = 0; r < R; r++) {
      const body: ClueBody = { kind: "At", p: c, t, r };
      if (!holds(body, frame, world)) {
        out.push({ id: `lie${n++}`, body, source: { kind: "testimony", speaker: c } });
      }
    }
  }
  return rng.shuffle(out).slice(0, howMany);
}

interface Case {
  frame: CaseFrame;
  world: World;
  clues: Clue[];
}

function randomCase(seed: string, size: {
  suspects: number;
  rooms: number;
  slots: number;
  lying: boolean;
}): Case | null {
  const rng = new RNG(seed);
  const plan = buildFloorPlan(rng, { rooms: size.rooms });
  const res = simulateTruth(
    rng,
    { plan, rules: noRules(), suspects: size.suspects, slots: size.slots, lying: size.lying },
    { minMeetings: 0, minVictimCompany: 0 },
  );
  if (!res) return null;
  const { frame, world } = res;
  expect(isLegal(frame, world)).toBe(true);
  const all = trueClues(frame, world, rng);
  const keep = all.filter(() => rng.chance(0.06));
  if (size.lying) keep.push(...lies(frame, world, rng, 2));
  return { frame, world, clues: rng.shuffle(keep) };
}

/** Everything the deduction solver threw away must really be impossible. */
function assertSound(c: Case) {
  const { frame, clues } = c;
  const result = solve(frame, clues);

  // Clues that all hold in a real world can never be contradictory.
  for (const clue of clues) {
    expect(clueHolds(frame, clue, c.world)).toBe(true);
  }
  expect(result.contradiction).toBe(false);

  // No room candidate the solver removed may be possible.
  for (let p = 0; p < frame.people; p++) {
    const allowed = allowedRoomsMask(frame, p);
    for (let t = 0; t < frame.slots; t++) {
      const gone = allowed & ~result.state.dom[p][t];
      for (const r of bitsOf(gone)) {
        expect(
          cellPossible(frame, clues, p, t, r),
          `solver removed p${p} t${t} r${r} but it is possible`,
        ).toBe(false);
      }
    }
  }

  // No (culprit, slot) pair the solver removed may be possible.
  for (let s = 0; s < frame.suspects; s++) {
    for (let t = 0; t < frame.slots; t++) {
      if ((result.state.answer[s] & (1 << t)) !== 0) continue;
      expect(
        answerPossible(frame, clues, { culprit: s, slot: t }),
        `solver removed culprit ${s} / slot ${t} but it is possible`,
      ).toBe(false);
    }
  }

  // The truth is never eliminated, and a finished run names it.
  expect((result.state.answer[c.world.culprit] & (1 << c.world.murderSlot)) !== 0).toBe(
    true,
  );
  if (result.finished) {
    expect(result.answer).toEqual({
      culprit: c.world.culprit,
      slot: c.world.murderSlot,
    });
  }
  return result;
}

describe("deduction solver soundness", () => {
  const SIZES = [
    { suspects: 3, rooms: 4, slots: 4, lying: false },
    { suspects: 3, rooms: 5, slots: 5, lying: true },
    { suspects: 4, rooms: 5, slots: 5, lying: false },
    { suspects: 4, rooms: 6, slots: 6, lying: true },
  ];

  it("never removes a possible room, pair or answer", () => {
    let cases = 0;
    let deduced = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const size of SIZES) {
        const c = randomCase(`sound:${seed}:${size.rooms}`, size);
        if (!c) continue;
        const r = assertSound(c);
        cases++;
        if (r.tier >= 0) deduced++;
      }
    }
    // Guard the guard: a change that made the solver deduce nothing would
    // satisfy every assertion above vacuously.
    expect(cases).toBeGreaterThan(100);
    expect(deduced / cases).toBeGreaterThan(0.9);
  });

  it("stays sound when the culprit lies freely", () => {
    for (let seed = 0; seed < 12; seed++) {
      const rng = new RNG(`liar:${seed}`);
      const plan = buildFloorPlan(rng, { rooms: 5 });
      const res = simulateTruth(
        rng,
        { plan, rules: noRules(), suspects: 4, slots: 5, lying: true },
        { minMeetings: 0, minVictimCompany: 0 },
      );
      if (!res) continue;
      const { frame, world } = res;
      const clues = [
        ...trueClues(frame, world, rng).filter(() => rng.chance(0.08)),
        ...lies(frame, world, rng, 6),
      ];
      assertSound({ frame, world, clues });
    }
  });

  it("is sound on the empty clue set and keeps every answer open", () => {
    const c = randomCase("empty:1", { suspects: 3, rooms: 5, slots: 5, lying: false });
    expect(c).not.toBeNull();
    const frame = (c as Case).frame;
    const r = solve(frame, []);
    expect(r.contradiction).toBe(false);
    // The murder axioms alone may narrow things, but never to nothing.
    expect(r.remaining).toBeGreaterThan(0);
    for (let s = 0; s < frame.suspects; s++) {
      for (let t = 0; t < frame.slots; t++) {
        if ((r.state.answer[s] & (1 << t)) !== 0) continue;
        expect(answerPossible(frame, [], { culprit: s, slot: t })).toBe(false);
      }
    }
  });
});

describe("grading", () => {
  it("reports the hardest tier the case actually needed, and no more", () => {
    let checked = 0;
    for (let seed = 0; seed < 20; seed++) {
      const c = randomCase(`grade:${seed}`, {
        suspects: 4,
        rooms: 6,
        slots: 6,
        lying: false,
      });
      if (!c) continue;
      const { frame, clues } = c;
      const full = solve(frame, clues);
      expect(full.tier).toBeGreaterThanOrEqual(0);

      // Capping at the reported tier must change nothing: if it did, the
      // grade would be understating what the case demands.
      const atGrade = solve(frame, clues, { maxTier: full.tier });
      expect(atGrade.state.dom).toEqual(full.state.dom);
      expect(atGrade.state.answer).toEqual(full.state.answer);

      // And the tier below must be genuinely weaker somewhere, or the grade
      // is overstating it. (Only meaningful once there is a tier below.)
      if (full.tier > 0) {
        const below = solve(frame, clues, { maxTier: full.tier - 1 });
        const weaker =
          JSON.stringify(below.state.dom) !== JSON.stringify(full.state.dom) ||
          JSON.stringify(below.state.answer) !== JSON.stringify(full.state.answer);
        expect(weaker, `tier ${full.tier} fired but changed nothing`).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });

  it("never grades above the cap it was given", () => {
    const c = randomCase("cap:1", { suspects: 4, rooms: 6, slots: 6, lying: false });
    expect(c).not.toBeNull();
    const { frame, clues } = c as Case;
    const capped = solve(frame, clues, { maxTier: 0 });
    expect(capped.tier).toBeLessThanOrEqual(0);
    const full = solve(frame, clues);
    expect(full.tier).toBeGreaterThanOrEqual(capped.tier);
    // A cap can only lose deductions, never gain them: every room the full
    // run still allows must also be allowed by the capped run.
    for (let p = 0; p < frame.people; p++) {
      for (let t = 0; t < frame.slots; t++) {
        expect(
          full.state.dom[p][t] & ~capped.state.dom[p][t],
          `capped run removed p${p} t${t} rooms the full run kept`,
        ).toBe(0);
      }
    }
    for (let s = 0; s < frame.suspects; s++) {
      expect(full.state.answer[s] & ~capped.state.answer[s]).toBe(0);
    }
  });
});
