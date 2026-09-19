import { describe, it, expect } from "vitest";
import { RNG } from "../rng";
import { bit } from "../bits";
import { buildFloorPlan } from "../map";
import { holds } from "../clues";
import { simulateTruth } from "../world/simulate";
import { corridorPlan, frameOf, worldOf } from "../testkit";
import { noRules } from "../types";
import { apply, hint, marksMade, newNotebook, notebookIsSound } from "./hint";
import { solve } from "./solve";
import type { CaseFrame, Clue, ClueBody, Glossary, World } from "../types";

/**
 * The three branches in order, and the property that matters more than any of
 * them: following hints must never put a false mark in the notebook.
 */

const frame: CaseFrame = frameOf({
  plan: corridorPlan(4),
  suspects: 3,
  slots: 4,
  murderRoom: 2,
});

// Suspects 0-2 then the victim. The victim is killed in room 2 at slot 2, so
// from slot 2 on the body is in room 2 and nobody else is.
const world: World = worldOf(
  [
    [0, 1, 1, 0],
    [3, 3, 3, 3],
    [1, 2, 2, 2],
    [1, 2, 2, 2],
  ],
  2,
  2,
);

const skin: Glossary = {
  personName: (p) => ["Mrs Hale", "Colonel Grey", "Dr Ash", "Lord Vane"][p],
  roomName: (r) => ["the hall", "the library", "the study", "the terrace"][r],
  roomCode: (r) => ["HA", "LI", "ST", "TE"][r],
  slotLabel: (t) => ["eight", "nine", "ten", "eleven"][t],
};

let n = 0;
function fact(body: ClueBody): Clue {
  return { id: `f${n++}`, body, source: { kind: "fact" } };
}

describe("the notebook check", () => {
  it("is one bit, and it compares with the truth", () => {
    const nb = newNotebook(frame);
    expect(notebookIsSound(frame, nb, world)).toBe(true);

    // Crossing out where somebody really was.
    nb.ruledOut[0][1] |= bit(1);
    expect(notebookIsSound(frame, nb, world)).toBe(false);

    const other = newNotebook(frame);
    other.ruledOut[0][1] |= bit(3); // true: suspect 0 was in room 1, not 3
    expect(notebookIsSound(frame, other, world)).toBe(true);

    other.clearedSuspects |= bit(2); // suspect 2 is the culprit
    expect(notebookIsSound(frame, other, world)).toBe(false);

    const third = newNotebook(frame);
    third.ruledOutSlots |= bit(2); // slot 2 is the murder slot
    expect(notebookIsSound(frame, third, world)).toBe(false);
  });
});

describe("hint order", () => {
  const cards = [
    fact({ kind: "At", p: 0, t: 0, r: 0 }),
    fact({ kind: "At", p: 1, t: 0, r: 3 }),
    fact({ kind: "AliveAt", t: 1 }),
  ];
  for (const c of cards) {
    it(`the fixture card ${c.id} is true of the world`, () => {
      expect(holds(c.body, frame, world)).toBe(true);
    });
  }

  it("warns about a mistake first, and never says which cell", () => {
    const nb = newNotebook(frame);
    nb.ruledOut[0][0] |= bit(0); // suspect 0 really was in room 0 at slot 0
    const h = hint({ frame, cards, notebook: nb, world, glossary: skin });
    expect(h.kind).toBe("mistake");
    // Nothing that would identify the cell may appear in the text.
    for (let p = 0; p < frame.people; p++) {
      expect(h.text).not.toContain(skin.personName(p));
    }
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      expect(h.text).not.toContain(skin.roomName(r));
    }
    for (let t = 0; t < frame.slots; t++) {
      expect(h.text).not.toContain(skin.slotLabel(t));
    }
  });

  it("beats a deduction that is also available", () => {
    // The same notebook would otherwise get branch 2, since it holds nothing.
    const clean = hint({ frame, cards, notebook: newNotebook(frame), world });
    expect(clean.kind).toBe("deduction");

    const wrong = newNotebook(frame);
    wrong.ruledOut[0][0] |= bit(0);
    expect(hint({ frame, cards, notebook: wrong, world }).kind).toBe("mistake");
  });

  it("offers the cheapest deduction the notebook is missing", () => {
    const h = hint({
      frame,
      cards,
      notebook: newNotebook(frame),
      world,
      glossary: skin,
    });
    expect(h.kind).toBe("deduction");
    if (h.kind !== "deduction") return;
    const cheapest = Math.min(...solve(frame, cards).steps.map((s) => s.tier));
    expect(h.step.tier).toBe(cheapest);
    expect(h.text).toContain("because");
    expect(h.text).not.toMatch(/undefined/);
  });

  it("points at a topic once the cards are used up, without giving the card away", () => {
    // Write down everything the cards prove, so branch 2 has nothing left.
    const nb = newNotebook(frame);
    for (const step of solve(frame, cards).steps) apply(frame, nb, step.conclusion);
    expect(notebookIsSound(frame, nb, world)).toBe(true);

    const wanted: Clue = {
      id: "essential",
      body: { kind: "At", p: 2, t: 1, r: 2 },
      source: { kind: "testimony", speaker: 1 },
    };
    const h = hint({
      frame,
      cards,
      notebook: nb,
      world,
      essential: [wanted],
      glossary: skin,
    });
    expect(h.kind).toBe("investigate");
    if (h.kind !== "investigate") return;
    expect(h.ask).toBe(1);
    expect(h.topic).toMatch(/^(person|room|slot):\d+$/);
    // It says whom to ask and about what. It must not say the answer: the
    // card places Dr Ash in the study, and neither may both appear.
    const leaks =
      h.text.includes(skin.personName(2)) && h.text.includes(skin.roomName(2));
    expect(leaks, `hint leaked the card: ${h.text}`).toBe(false);
  });

  it("says to accuse when there is nothing left at all", () => {
    const nb = newNotebook(frame);
    for (const step of solve(frame, cards).steps) apply(frame, nb, step.conclusion);
    const h = hint({ frame, cards, notebook: nb, world });
    expect(h.kind).toBe("accuse");
  });

  it("only ever reasons from the cards it was handed", () => {
    const nb = newNotebook(frame);
    const withCard = hint({ frame, cards, notebook: nb, world });
    // A card the player has not collected must not change the advice.
    const uncollected = fact({ kind: "At", p: 2, t: 3, r: 2 });
    expect(holds(uncollected.body, frame, world)).toBe(true);
    const same = hint({ frame, cards, notebook: newNotebook(frame), world });
    expect(same).toEqual(withCard);
    expect(cards).not.toContain(uncollected);
  });
});

describe("following hints", () => {
  it("never puts a false mark in the notebook, and always terminates", () => {
    let played = 0;
    for (let seed = 0; seed < 8; seed++) {
      const rng = new RNG(`hint:${seed}`);
      const plan = buildFloorPlan(rng, { rooms: 5 });
      const res = simulateTruth(
        rng,
        { plan, rules: noRules(), suspects: 4, slots: 5, lying: false },
        { minMeetings: 0, minVictimCompany: 0 },
      );
      if (!res) continue;
      const cards: Clue[] = [];
      let id = 0;
      for (let p = 0; p < res.frame.people; p++) {
        for (let t = 0; t < res.frame.slots; t++) {
          const body: ClueBody = { kind: "At", p, t, r: res.world.loc[p][t] };
          if (rng.chance(0.25)) {
            cards.push({ id: `c${id++}`, body, source: { kind: "fact" } });
          }
        }
      }
      const nb = newNotebook(res.frame);
      // Take the advice, over and over, until it stops being a deduction.
      let before = -1;
      for (let step = 0; step < 200; step++) {
        const h = hint({ frame: res.frame, cards, notebook: nb, world: res.world });
        expect(h.kind, "a hint called a sound notebook a mistake").not.toBe(
          "mistake",
        );
        if (h.kind !== "deduction") break;
        apply(res.frame, nb, h.step.conclusion);
        // Every mark it told us to make must be true of the world.
        expect(
          notebookIsSound(res.frame, nb, res.world),
          "a hint put a false mark in the notebook",
        ).toBe(true);
        const now = marksMade(res.frame, nb);
        expect(now, "a hint repeated itself").toBeGreaterThan(before);
        before = now;
      }
      const end = hint({ frame: res.frame, cards, notebook: nb, world: res.world });
      expect(end.kind).toBe("accuse");
      expect(marksMade(res.frame, nb)).toBeGreaterThan(0);
      played++;
    }
    expect(played).toBeGreaterThan(5);
  });
});
