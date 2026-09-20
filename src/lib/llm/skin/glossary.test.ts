import { describe, expect, it } from "vitest";
import { frameOf, gridPlan } from "../../engine/testkit";
import { defaultGlossary } from "../../engine/solver/explain";
import { assembleSkin, type CaseSkin, type WriterOutput } from "./schema";
import { glossaryFor, skinGlossary } from "./glossary";

const FRAME = frameOf({ plan: gridPlan(3, 2), suspects: 3, slots: 4, murderRoom: 4 });

const written: WriterOutput = {
  title: "The Orangery",
  place: "a house on a bluff",
  era: "1923",
  styleGuide: "cold light",
  rooms: ["the hall", "the library", "the study", "the kitchen", "the orangery", "the cellar"].map(
    (name, r) => ({ name, code: ["HA", "LI", "ST", "KI", "OR", "CE"][r], description: "" }),
  ),
  slots: ["eight", "nine", "ten", "eleven"],
  people: ["Mrs Hale", "Colonel Grey", "Dr Ash", "Lord Vane"].map((name) => ({
    name,
    role: "",
    bio: "",
    voice: "",
    motive: "",
    portrait: "",
  })),
  prose: [],
  silence: [],
  briefing: "",
  scene: "",
};

const skin = (overrides: Partial<CaseSkin> = {}): CaseSkin => ({
  ...assembleSkin(written, {
    setting: "x",
    language: "en",
    prose: {},
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
  }),
  ...overrides,
});

describe("a skin read as a glossary", () => {
  const g = skinGlossary(skin(), FRAME);

  it("gives the skin's names for people, rooms, codes and hours", () => {
    expect(g.personName(0)).toBe("Mrs Hale");
    expect(g.personName(FRAME.victim)).toBe("Lord Vane");
    expect(g.roomName(4)).toBe("the orangery");
    expect(g.roomCode(1)).toBe("LI");
    expect(g.slotLabel(2)).toBe("ten");
  });

  it("names the victim, which the default glossary does not", () => {
    // `defaultGlossary` says "the victim" for that id on purpose. A skin has
    // a name for them, and the cards should use it.
    expect(defaultGlossary(FRAME).personName(FRAME.victim)).toBe("the victim");
    expect(g.personName(FRAME.victim)).toBe("Lord Vane");
  });
});

describe("a skin that is short or damaged", () => {
  const plain = defaultGlossary(FRAME);

  it("falls back per entry rather than returning undefined", () => {
    // The failure that matters is "was in undefined at nine" in a hint. A
    // visible placeholder in one cell is wrong and harmless; the other is
    // neither.
    const short = skinGlossary(skin({ rooms: [], slots: [], people: [] }), FRAME);
    expect(short.roomName(0)).toBe(plain.roomName(0));
    expect(short.personName(0)).toBe(plain.personName(0));
    expect(short.slotLabel(0)).toBe(plain.slotLabel(0));
    expect(short.roomCode(0)).toBe(plain.roomCode(0));
  });

  it("treats an empty or blank name as missing", () => {
    const blank = skinGlossary(
      skin({ slots: ["   ", "nine", "", "eleven"], rooms: [] }),
      FRAME,
    );
    expect(blank.slotLabel(0)).toBe(plain.slotLabel(0));
    expect(blank.slotLabel(1)).toBe("nine");
    expect(blank.slotLabel(2)).toBe(plain.slotLabel(2));
  });

  it("never returns a string containing undefined", () => {
    const short = skinGlossary(skin({ rooms: [], slots: [], people: [] }), FRAME);
    for (let r = 0; r < FRAME.plan.rooms.length; r++) {
      expect(short.roomName(r)).not.toContain("undefined");
      expect(short.roomCode(r)).not.toContain("undefined");
    }
    for (let p = 0; p < FRAME.people; p++) expect(short.personName(p)).not.toContain("undefined");
    for (let t = 0; t < FRAME.slots; t++) expect(short.slotLabel(t)).not.toContain("undefined");
  });
});

describe("glossaryFor", () => {
  it("is the plain one with no skin, and the skin's with one", () => {
    const plain = glossaryFor(FRAME, null);
    expect(plain.personName(0)).toBe(defaultGlossary(FRAME).personName(0));
    expect(glossaryFor(FRAME, skin()).personName(0)).toBe("Mrs Hale");
  });
});
