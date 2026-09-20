import { describe, expect, it } from "vitest";

import { newCaseId } from "../../engine/caseId";
import { generate } from "../../engine/generator/generate";
import { defaultGlossary } from "../../engine/solver/explain";

import {
  bareFallback,
  checkReply,
  forbiddenLabels,
  normalise,
  safeSilence,
} from "./guards";

const CARD = "Mrs Pellworth was not in the orangery at nine o'clock.";
const LABELS = ["orangery", "kitchen", "ORG", "KIT", "nine o'clock", "ten o'clock"];

describe("normalising", () => {
  it("leaves the claim alone and only tidies typography", () => {
    expect(normalise("nine o’clock")).toBe("nine o'clock");
    expect(normalise("a — b")).toBe("a - b");
    expect(normalise("  two   spaces \n here ")).toBe("two spaces here");
    expect(normalise("“quoted”")).toBe('"quoted"');
  });

  it("does not fold anything that could change what a sentence says", () => {
    // Numbers, negations and names must survive untouched, or the verbatim
    // check would be passing sentences that no longer say the same thing.
    const said = "Three people were not in Room 2.";
    expect(normalise(said)).toBe(said);
  });
});

describe("the verbatim check", () => {
  it("accepts a reply that carries the sentence word for word", () => {
    const reply = `I have told you already. ${CARD} Ask me something else.`;
    expect(checkReply(reply, [CARD], LABELS)).toEqual({ ok: true });
  });

  it("forgives a curly apostrophe and extra whitespace, which say nothing", () => {
    const reply = `Well.  ${CARD.replace(/'/g, "’")}\n\nThat is all.`;
    expect(checkReply(reply, [CARD], LABELS).ok).toBe(true);
  });

  it("forgives a lower-case first letter where the line is embedded", () => {
    const reply = `I can tell you that ${CARD[0].toLowerCase()}${CARD.slice(1)}`;
    expect(checkReply(reply, [CARD], LABELS).ok).toBe(true);
  });

  it("refuses a paraphrase, however faithful", () => {
    const reply = "Mrs Pellworth was nowhere near the orangery at nine o'clock.";
    expect(checkReply(reply, [CARD], LABELS)).toMatchObject({
      ok: false,
      reason: "not-verbatim",
    });
  });

  it("refuses a reply that drops one of several lines", () => {
    const second = "The kitchen was empty at ten o'clock.";
    expect(checkReply(`${CARD} And that is all.`, [CARD, second], LABELS)).toMatchObject({
      ok: false,
      reason: "not-verbatim",
      detail: second,
    });
    expect(checkReply(`${CARD} ${second}`, [CARD, second], LABELS).ok).toBe(true);
  });

  it("refuses an empty reply and a wall of text", () => {
    expect(checkReply("   ", [CARD], LABELS)).toMatchObject({ reason: "empty" });
    expect(checkReply(`${CARD} ${"la ".repeat(500)}`, [CARD], LABELS)).toMatchObject({
      reason: "too-long",
    });
  });
});

describe("the stray-label check", () => {
  it("allows a room and an hour inside the verified sentence", () => {
    expect(checkReply(CARD, [CARD], LABELS).ok).toBe(true);
  });

  it("refuses a room named outside it", () => {
    const reply = `${CARD} I was in the kitchen the whole while.`;
    expect(checkReply(reply, [CARD], LABELS)).toMatchObject({
      ok: false,
      reason: "stray-label",
      detail: "kitchen",
    });
  });

  it("refuses a second mention of the very room the card names", () => {
    // The sentence is removed once, so the extra claim is not excused by it.
    const reply = `${CARD} I have never cared for the orangery.`;
    expect(checkReply(reply, [CARD], LABELS)).toMatchObject({
      reason: "stray-label",
      detail: "orangery",
    });
  });

  it("refuses a grid code, which is a room by another name", () => {
    expect(checkReply(`${CARD} Try KIT.`, [CARD], LABELS)).toMatchObject({
      reason: "stray-label",
      detail: "KIT",
    });
  });

  it("refuses an hour named outside it", () => {
    expect(checkReply(`${CARD} I went up at ten o'clock.`, [CARD], LABELS)).toMatchObject({
      reason: "stray-label",
      detail: "ten o'clock",
    });
  });

  it("allows nothing at all when nothing was released", () => {
    // The strictest case, and the common one: two questions in three release
    // no card, so this is the guard most replies actually meet.
    expect(checkReply("I have nothing to add to that.", [], LABELS).ok).toBe(true);
    expect(checkReply("I was in the kitchen all evening.", [], LABELS)).toMatchObject({
      reason: "stray-label",
    });
  });

  it("does not fire on a label buried inside a longer word", () => {
    // "KIT" inside "kitted", "orangery" is its own word. A substring match
    // here would reject perfectly innocent prose and drive the fallback rate
    // up for no reason anybody could see.
    expect(checkReply("I was kitted out for the weather.", [], ["KIT"]).ok).toBe(true);
    expect(checkReply("Shallow talk, all of it.", [], ["hall"]).ok).toBe(true);
  });
});

describe("the labels a reply may not name", () => {
  const built = generate(newCaseId("normal", "guard1"));
  const kase = built.case!;
  const frame = kase.frame;
  const labels = forbiddenLabels(frame, defaultGlossary(frame));

  it("covers every room, every grid code and every hour", () => {
    const glossary = defaultGlossary(frame);
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      expect(labels).toContain(glossary.roomCode(r));
    }
    // The engine's own room names are "Room 3", so the article-stripped form
    // is the name itself; a skin's "the orangery" reduces to "orangery".
    expect(labels.some((l) => l.startsWith("Room "))).toBe(true);
    expect(labels.some((l) => l.startsWith("slot "))).toBe(true);
  });

  it("guards a case played in the engine's own words too", () => {
    const glossary = defaultGlossary(frame);
    const said = `I was in ${glossary.roomName(1)} the whole time.`;
    expect(checkReply(said, [], labels)).toMatchObject({ reason: "stray-label" });
  });
});

describe("the nothing-to-say line", () => {
  const fallback = "I've nothing to tell you about that.";

  it("keeps a line that makes no claim", () => {
    const line = "I wish I could help you, Inspector, but I cannot.";
    expect(safeSilence(line, LABELS, fallback)).toBe(line);
  });

  it("drops one that names a room, which the fidelity check never saw", () => {
    // `skin.silence[p]` is the one piece of wave 5's prose that was never
    // parse-checked, on the grounds that it makes no claim. Wave 6 is the
    // first code to show it to anybody, so it is checked at the point of use.
    expect(safeSilence("I was in the kitchen all evening.", LABELS, fallback)).toBe(fallback);
    expect(safeSilence("I went up at ten o'clock.", LABELS, fallback)).toBe(fallback);
  });

  it("falls back when there is no line at all", () => {
    expect(safeSilence(undefined, LABELS, fallback)).toBe(fallback);
    expect(safeSilence("   ", LABELS, fallback)).toBe(fallback);
  });
});

describe("the fallback", () => {
  it("is the verified sentences themselves", () => {
    expect(bareFallback([CARD], "unused")).toBe(CARD);
    expect(bareFallback([CARD, "And another."], "unused")).toBe(`${CARD} And another.`);
  });

  it("is the nothing-to-say line when nothing was released", () => {
    expect(bareFallback([], "Nothing doing.")).toBe("Nothing doing.");
  });
});
