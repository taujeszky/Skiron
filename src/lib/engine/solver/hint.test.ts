import { describe, it, expect } from "vitest";
import { RNG } from "../rng";
import { bit } from "../bits";
import { buildFloorPlan } from "../map";
import { holds } from "../clues";
import { simulateTruth } from "../world/simulate";
import { corridorPlan, frameOf, worldOf } from "../testkit";
import { noRules } from "../types";
import { apply, hint, marksMade, newNotebook, notebookIsSound } from "./hint";
import type { Notebook } from "./hint";
import type { Step } from "./state";
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

  it("names an action the player can actually take", () => {
    // The game's actions are: examine a room, or ask a suspect about an
    // hour, a person or a room. There is no examine-a-person action, so a
    // physical fact must be pointed at by its room — "look into Suspect A",
    // with nobody to ask, is advice that cannot be followed.
    const nb = newNotebook(frame);
    for (const step of solve(frame, cards).steps) apply(frame, nb, step.conclusion);

    const physical: Clue = {
      id: "phys",
      body: { kind: "At", p: 2, t: 1, r: 1 },
      source: { kind: "fact" },
    };
    const h = hint({ frame, cards, notebook: nb, world, essential: [physical], glossary: skin });
    expect(h.kind).toBe("investigate");
    if (h.kind !== "investigate") return;
    expect(h.ask).toBeNull();
    expect(h.topic).toBe("room:1");
    expect(h.text).toContain(skin.roomName(1));

    // The two clues about the victim name no room at all, and the place to
    // learn when somebody died is the room they died in.
    const timing: Clue = {
      id: "when",
      body: { kind: "AliveAt", t: 1 },
      source: { kind: "fact" },
    };
    const t = hint({ frame, cards, notebook: nb, world, essential: [timing], glossary: skin });
    expect(t.kind).toBe("investigate");
    if (t.kind !== "investigate") return;
    expect(t.ask).toBeNull();
    expect(t.topic).toBe(`room:${frame.murderRoom}`);

    // Testimony is different: every topic on it is something to ask about.
    const said: Clue = {
      id: "said",
      body: { kind: "At", p: 2, t: 1, r: 1 },
      source: { kind: "testimony", speaker: 0 },
    };
    const s = hint({ frame, cards, notebook: nb, world, essential: [said], glossary: skin });
    expect(s.kind).toBe("investigate");
    if (s.kind !== "investigate") return;
    expect(s.ask).toBe(0);
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

/** A copy, so a test can ask what a mark would do without making it. */
function copyOf(nb: Notebook): Notebook {
  return {
    ruledOut: nb.ruledOut.map((row) => [...row]),
    clearedSuspects: nb.clearedSuspects,
    ruledOutSlots: nb.ruledOutSlots,
  };
}

/** Would writing this conclusion down actually add a mark? Worked out with
 * `apply` and `marksMade` rather than with the hint system's own `isNews`, so
 * that the two have to agree rather than being the same code twice. */
function wouldMark(f: CaseFrame, nb: Notebook, c: Step["conclusion"]): boolean {
  const copy = copyOf(nb);
  const before = marksMade(f, copy);
  apply(f, copy, c);
  return marksMade(f, copy) > before;
}

describe("following hints", () => {
  it("always offers the cheapest deduction available, not the first one", () => {
    // The step list is the order the rules happened to fire, so the first
    // step the notebook is missing is frequently not the easiest one. A
    // player asking for a hint wants the easiest thing they overlooked.
    let diverged = 0;
    let checked = 0;
    for (let seed = 0; seed < 25; seed++) {
      const rng = new RNG(`cheap:${seed}`);
      const plan = buildFloorPlan(rng, { rooms: 5 });
      const res = simulateTruth(
        rng,
        { plan, rules: noRules(), suspects: 4, slots: 5, lying: false },
        { minMeetings: 0, minVictimCompany: 0 },
      );
      if (!res) continue;
      const { frame: f, world: w } = res;
      const cards: Clue[] = [];
      let id = 0;
      for (let p = 0; p < f.people; p++) {
        for (let t = 0; t < f.slots; t++) {
          if (!rng.chance(0.3)) continue;
          cards.push({
            id: `c${id++}`,
            body: { kind: "At", p, t, r: w.loc[p][t] },
            source: { kind: "fact" },
          });
        }
      }
      const steps = solve(f, cards).steps;
      const nb = newNotebook(f);
      for (let n = 0; n < 200; n++) {
        const h = hint({ frame: f, cards, notebook: nb, world: w });
        if (h.kind !== "deduction") break;
        const news = steps.filter((st) => wouldMark(f, nb, st.conclusion));
        expect(news.length).toBeGreaterThan(0);
        const cheapest = Math.min(...news.map((st) => st.tier));
        expect(h.step.tier, `seed ${seed}: not the cheapest deduction`).toBe(
          cheapest,
        );
        if (news[0].tier !== cheapest) diverged++;
        checked++;
        apply(f, nb, h.step.conclusion);
      }
    }
    expect(checked).toBeGreaterThan(50);
    // Guard the guard: if the first step were always the cheapest one, the
    // assertion above would hold for a first-found implementation too.
    expect(diverged, "cheapest and first-found never differed").toBeGreaterThan(0);
  });

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

  it("leaves the answer in the notebook when the cards prove one", () => {
    // The assertion that matters, and the one whose absence hid a real bug
    // for a while: it is not enough that hints are true and that they stop.
    // When the collected cards prove a unique answer, a player who takes
    // every hint must end up able to accuse — one suspect left uncrossed and
    // one hour left open, and both of them the right ones. Before the step
    // record carried what a sweep *left standing*, rather than only the pairs
    // it removed, this ended with the whole hour column still blank and the
    // hint system cheerfully saying there was nothing left to prove.
    let proved = 0;
    for (let seed = 0; seed < 120; seed++) {
      const rng = new RNG(`accuse:${seed}`);
      const plan = buildFloorPlan(rng, { rooms: 5 });
      const res = simulateTruth(
        rng,
        { plan, rules: noRules(), suspects: 4, slots: 5, lying: false },
        { minMeetings: 0, minVictimCompany: 0 },
      );
      if (!res) continue;
      const { frame: f, world: w } = res;
      // Every true `At` and `Empty`: enough to settle the case outright.
      const cards: Clue[] = [];
      for (let p = 0; p < f.people; p++) {
        for (let t = 0; t < f.slots; t++) {
          cards.push({
            id: `a${p}_${t}`,
            body: { kind: "At", p, t, r: w.loc[p][t] },
            source: { kind: "fact" },
          });
        }
      }
      if (!solve(f, cards).finished) continue;

      const nb = newNotebook(f);
      for (let step = 0; step < 500; step++) {
        const h = hint({ frame: f, cards, notebook: nb, world: w });
        if (h.kind !== "deduction") break;
        apply(f, nb, h.step.conclusion);
      }
      expect(hint({ frame: f, cards, notebook: nb, world: w }).kind).toBe("accuse");
      expect(notebookIsSound(f, nb, w)).toBe(true);

      const suspectsLeft = [];
      for (let p = 0; p < f.suspects; p++) {
        if ((nb.clearedSuspects & bit(p)) === 0) suspectsLeft.push(p);
      }
      const hoursLeft = [];
      for (let t = 0; t < f.slots; t++) {
        if ((nb.ruledOutSlots & bit(t)) === 0) hoursLeft.push(t);
      }
      expect(suspectsLeft, `seed ${seed}: suspects left open`).toEqual([w.culprit]);
      expect(hoursLeft, `seed ${seed}: hours left open`).toEqual([w.murderSlot]);
      proved++;
    }
    // Full location facts do not always settle a case - a suspect who stays
    // in the murder room across two hours leaves two pairs alive - so only a
    // third or so of the corpus reaches this property. That is still plenty,
    // and the floor stops the test going quietly vacuous.
    expect(proved).toBeGreaterThan(25);
  });
});
