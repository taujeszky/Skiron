import { describe, it, expect } from "vitest";
import { CLUE_KINDS } from "../clues";
import { corridorPlan, frameOf } from "../testkit";
import { clueSentence, defaultGlossary, explainer, stepSentence } from "./explain";
import { RULE_IDS } from "./state";
import { solve } from "./solve";
import type { Conclusion, Premises, RuleId, Step } from "./state";
import type { CaseFrame, Clue, ClueBody, ClueKind, Glossary } from "../types";

/**
 * Coverage, in the only sense that matters here: every clue kind and every
 * rule id must come out as a sentence, under a glossary and under none.
 *
 * The negative assertions are the interesting ones. A renderer that has
 * quietly stopped handling a field does not throw — it emits "undefined" in
 * the middle of a sentence, or falls back to a raw id like `p3`, and both
 * look plausible in a diff and ridiculous on a card. So every sentence in
 * this file is searched for them, and for the tell-tale of a missing
 * glossary: a sentence that does not change when the names do.
 */

const frame: CaseFrame = frameOf({
  plan: corridorPlan(4),
  suspects: 3,
  slots: 4,
  murderRoom: 2,
  lying: true,
});

/** A glossary with nothing in common with the default one. */
const skin: Glossary = {
  personName: (p) => ["Mrs Hale", "Colonel Grey", "Dr Ash", "Lord Vane"][p],
  roomName: (r) => ["the hall", "the library", "the study", "the terrace"][r],
  roomCode: (r) => ["HA", "LI", "ST", "TE"][r],
  slotLabel: (t) => ["eight", "nine", "ten", "eleven"][t],
};

/** Anything that betrays a field the renderer forgot. */
function assertReadable(text: string, what: string) {
  expect(text, what).not.toMatch(/undefined|NaN|\[object|null/);
  // A raw id: "p3", "r0", "t2", "e1" standing alone as a word.
  expect(text, what).not.toMatch(/\b[prte]\d+\b/);
  expect(text.length, what).toBeGreaterThan(8);
  expect(text.endsWith("."), `${what}: no full stop`).toBe(true);
  expect(text[0], `${what}: no capital`).toBe(text[0].toUpperCase());
  expect(text, what).not.toMatch(/\s{2,}/);
}

/** One well formed body of every clue kind, against the frame above. */
const BODIES: Readonly<Record<ClueKind, ClueBody>> = {
  At: { kind: "At", p: 0, t: 1, r: 2 },
  NotAt: { kind: "NotAt", p: 1, t: 2, r: 0 },
  Stayed: { kind: "Stayed", p: 2, r: 1, t1: 0, t2: 2 },
  Saw: { kind: "Saw", p: 0, q: 1, t: 1, r: 3 },
  Together: { kind: "Together", p: 1, q: 2, t: 3 },
  AloneIn: { kind: "AloneIn", p: 2, t: 0, r: 1 },
  Occupied: { kind: "Occupied", r: 3, t: 2 },
  Empty: { kind: "Empty", r: 0, t: 3 },
  Count: { kind: "Count", r: 1, t: 1, k: 2 },
  Visited: { kind: "Visited", p: 0, r: 3 },
  NeverVisited: { kind: "NeverVisited", p: 1, r: 0 },
  AliveAt: { kind: "AliveAt", t: 2 },
  DeathWindow: { kind: "DeathWindow", a: 1, b: 3 },
  DoorClosed: { kind: "DoorClosed", door: 0, from: 0, to: 2 },
  BarredDoor: { kind: "BarredDoor", p: 2, door: 1 },
  BarredRoom: { kind: "BarredRoom", p: 0, r: 3 },
  Capacity: { kind: "Capacity", r: 2, k: 1 },
};

describe("clue sentences", () => {
  it("renders every clue kind, as a fact and as testimony", () => {
    const seen = new Set<string>();
    for (const kind of CLUE_KINDS) {
      const body = BODIES[kind];
      const fact: Clue = { id: "x", body, source: { kind: "fact" } };
      const said: Clue = {
        id: "y",
        body,
        source: { kind: "testimony", speaker: 0 },
      };
      for (const [what, clue] of [["fact", fact], ["testimony", said]] as const) {
        const plain = clueSentence(frame, clue);
        const dressed = clueSentence(frame, clue, skin);
        assertReadable(plain, `${kind} ${what}, no skin`);
        assertReadable(dressed, `${kind} ${what}, skinned`);
        expect(dressed, `${kind} ${what} ignores the glossary`).not.toBe(plain);
        seen.add(plain);
      }
      expect(said.source.kind === "testimony").toBe(true);
    }
    expect(CLUE_KINDS.length).toBe(17);
    // No two kinds may share a sentence: wave 5 reads prose back to a clue,
    // and two kinds spelled alike would make that ambiguous. `Empty` and
    // `Count(k=0)` are the pair this is really about.
    expect(seen.size).toBe(CLUE_KINDS.length * 2);
  });

  it("puts a testimony in the speaker's own mouth", () => {
    const own: Clue = {
      id: "a",
      body: { kind: "At", p: 0, t: 1, r: 2 },
      source: { kind: "testimony", speaker: 0 },
    };
    const other: Clue = {
      id: "b",
      body: { kind: "At", p: 1, t: 1, r: 2 },
      source: { kind: "testimony", speaker: 0 },
    };
    expect(clueSentence(frame, own, skin)).toBe(
      "Mrs Hale says: I was in the study at nine.",
    );
    expect(clueSentence(frame, other, skin)).toBe(
      "Mrs Hale says: Colonel Grey was in the study at nine.",
    );
    expect(clueSentence(frame, { ...own, source: { kind: "fact" } }, skin)).toBe(
      "Mrs Hale was in the study at nine.",
    );
  });

  it("keeps the two ways of saying nobody apart", () => {
    const empty: Clue = {
      id: "a",
      body: { kind: "Empty", r: 1, t: 1 },
      source: { kind: "fact" },
    };
    const zero: Clue = {
      id: "b",
      body: { kind: "Count", r: 1, t: 1, k: 0 },
      source: { kind: "fact" },
    };
    expect(clueSentence(frame, empty, skin)).not.toBe(clueSentence(frame, zero, skin));
  });
});

describe("step sentences", () => {
  /** Every shape of conclusion, so each rule is rendered against all of them. */
  const CONCLUSIONS: Conclusion[] = [
    { kind: "room-set", p: 0, t: 1, r: 2 },
    { kind: "rooms-out", p: 1, t: 2, rooms: 0b1011 },
    { kind: "pairs-out", pairs: [{ culprit: 0, slot: 1 }] },
    {
      kind: "pairs-out",
      pairs: [
        { culprit: 0, slot: 1 },
        { culprit: 0, slot: 2 },
      ],
    },
    {
      kind: "pairs-out",
      pairs: [
        { culprit: 0, slot: 1 },
        { culprit: 1, slot: 1 },
      ],
    },
    {
      kind: "pairs-out",
      pairs: [
        { culprit: 0, slot: 1 },
        { culprit: 1, slot: 2 },
      ],
    },
    { kind: "cleared", suspects: [1] },
    { kind: "cleared", suspects: [0, 2] },
    { kind: "slots-out", slots: [1, 3] },
    { kind: "contradiction" },
  ];

  const premises: Premises = {
    clues: ["c0", "c1"],
    cells: [
      { p: 1, t: 2 },
      { p: 1, t: 3 },
    ],
    assumedInnocent: [0, 2],
    assumedAnswer: [{ culprit: 1, slot: 2 }],
  };

  const cards: Clue[] = [
    { id: "c0", body: BODIES.At, source: { kind: "fact" } },
    { id: "c1", body: BODIES.Saw, source: { kind: "fact" } },
  ];

  it("renders every rule against every shape of conclusion", () => {
    expect(RULE_IDS.length).toBe(28);
    for (const rule of RULE_IDS as RuleId[]) {
      for (const conclusion of CONCLUSIONS) {
        const step: Step = { rule, tier: 0, premises, conclusion };
        const plain = stepSentence(frame, step, cards);
        const dressed = stepSentence(frame, step, cards, skin);
        assertReadable(plain, `${rule} / ${conclusion.kind}`);
        assertReadable(dressed, `${rule} / ${conclusion.kind}, skinned`);
        if (conclusion.kind !== "contradiction") {
          expect(dressed, `${rule} ignores the glossary`).not.toBe(plain);
        }
      }
    }
  });

  it("names the cards a step rests on, the way the notebook numbers them", () => {
    const step: Step = {
      rule: "occupied-last-one",
      tier: 2,
      premises: { clues: ["c1"], cells: [] },
      conclusion: { kind: "room-set", p: 0, t: 1, r: 2 },
    };
    expect(stepSentence(frame, step, cards, skin)).toBe(
      "Mrs Hale must have been in the study at nine, because Card 2 puts " +
        "somebody in that room, and everyone else is accounted for elsewhere.",
    );
  });

  it("falls back rather than naming a card it was not given", () => {
    const step: Step = {
      rule: "clue-at",
      tier: 0,
      premises: { clues: ["nope"], cells: [] },
      conclusion: { kind: "room-set", p: 0, t: 1, r: 2 },
    };
    expect(stepSentence(frame, step, cards, skin)).toBe(
      "Mrs Hale must have been in the study at nine, because a card places them there.",
    );
    assertReadable(stepSentence(frame, step, cards), "unknown card");
    const axiom: Step = {
      rule: "body-at-end",
      tier: 0,
      premises: { clues: [], cells: [] },
      conclusion: { kind: "room-set", p: 3, t: 3, r: 2 },
    };
    expect(stepSentence(frame, axiom, cards, skin)).toContain("the body lay in the study");
  });
});

describe("explaining a real run", () => {
  it("has a sentence for every step the solver actually produced", () => {
    const clues: Clue[] = [
      { id: "a", body: { kind: "At", p: 0, t: 0, r: 0 }, source: { kind: "fact" } },
      { id: "b", body: { kind: "At", p: 1, t: 0, r: 3 }, source: { kind: "fact" } },
      { id: "c", body: { kind: "Occupied", r: 1, t: 0 }, source: { kind: "fact" } },
      { id: "d", body: { kind: "Together", p: 0, q: 1, t: 3 }, source: { kind: "fact" } },
      { id: "e", body: { kind: "AliveAt", t: 0 }, source: { kind: "fact" } },
    ];
    const r = solve(frame, clues);
    expect(r.steps.length).toBeGreaterThan(3);
    const ex = explainer(frame, clues, skin);
    const rules = new Set<string>();
    for (const step of r.steps) {
      assertReadable(ex.step(step), step.rule);
      rules.add(step.rule);
    }
    // More than one kind of reasoning happened, so this is not one sentence
    // being rendered over and over.
    expect(rules.size).toBeGreaterThan(2);
    for (const clue of clues) assertReadable(ex.clue(clue), clue.id);
  });

  it("falls back to plain names with no skin at all", () => {
    const g = defaultGlossary(frame);
    expect(g.personName(0)).toBe("Suspect A");
    expect(g.personName(frame.victim)).toBe("the victim");
    expect(g.roomName(2)).toBe("Room 3");
    expect(g.slotLabel(3)).toBe("slot 4");
  });
});
