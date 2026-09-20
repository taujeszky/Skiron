import { describe, expect, it } from "vitest";

import type { TopicKey } from "../../engine/types";
import { LlmError } from "../errors";
import { stubProvider } from "../stub";

import { type Topic } from "./classify";
import { type AskRequest, type Release, VOICE_HISTORY, askInWords } from "./ask";

const CARD = "Mrs Pellworth was not in the orangery at nine o'clock.";
const OTHER = "The kitchen was empty at ten o'clock.";
const LABELS = {
  words: ["orangery", "kitchen", "nine o'clock", "ten o'clock"],
  codes: ["ORG", "KIT"],
};

const TOPICS: Topic[] = [
  { key: "slot:0", label: "nine o'clock", group: "slot" },
  { key: "slot:1", label: "ten o'clock", group: "slot" },
  { key: "person:1", label: "Mr Hale", group: "person" },
  { key: "room:0", label: "the orangery", group: "room", alias: "ORG" },
  { key: "room:1", label: "the kitchen", group: "room", alias: "KIT" },
  { key: "motive", label: "Themselves", group: "motive" },
];

/** A request with a scripted engine behind it, so `release` can be watched. */
function request(over: Partial<AskRequest> = {}, log: string[] = []): AskRequest {
  return {
    question: "Where were you at nine?",
    suspect: "Mrs Pellworth",
    persona: {
      name: "Mrs Pellworth",
      role: "the housekeeper",
      bio: "Thirty years in the house.",
      voice: "Clipped.",
    },
    motive: "a legacy she was written out of",
    topics: TOPICS,
    history: [],
    forbidden: LABELS,
    silence: "I wish I could help you.",
    plainSilence: "I've nothing to tell you about that.",
    release: (key: TopicKey): Release => {
      log.push(`release ${key}`);
      return { ids: ["c1"], sentences: [CARD] };
    },
    ...over,
  };
}

/** call 0 answers the classifier, call 1 answers the voice. */
function provider(choice: string, reply: string, log: string[] = []) {
  return stubProvider({
    answer: (_call, index) => {
      log.push(index === 0 ? "classify" : "voice");
      return index === 0 ? { choice } : { reply };
    },
  });
}

describe("a question that lands on a topic", () => {
  it("releases the card, voices it, and charges a move", async () => {
    const out = await askInWords(
      provider("slot:0", `Yes. ${CARD} And that is all.`),
      request(),
    );
    expect(out).toMatchObject({
      kind: "topic",
      key: "slot:0",
      cards: ["c1"],
      voiced: true,
      spent: true,
      calls: 2,
    });
    expect(out.text).toContain(CARD);
  });

  /*
   * The order is the invariant, not an implementation detail.
   *
   * The engine releases the card BETWEEN the two calls, so the first model
   * has no card to leak and the second sees exactly the card the player is
   * already looking at. It is also the whole of the latency answer: the
   * evidence pane fills while call 2 is still in the air.
   */
  it("releases the card between the two calls, not after both", async () => {
    const log: string[] = [];
    await askInWords(provider("slot:0", CARD, log), request({}, log), {});
    expect(log).toEqual(["classify", "release slot:0", "voice"]);
  });

  it("hands call 2 the released sentence and nothing else", async () => {
    const stub = provider("slot:0", CARD);
    await askInWords(stub, request());
    const voice = stub.calls[1].user;
    expect(voice).toContain(CARD);
    expect(voice).not.toContain(OTHER);
  });

  it("carries several sentences when one question releases several cards", async () => {
    // Measured on 10,200 questions: 8.4% of answered questions release two
    // cards or more, up to five. A single-sentence reply would drop the rest.
    const stub = provider("slot:0", `${CARD} ${OTHER}`);
    const out = await askInWords(
      stub,
      request({ release: () => ({ ids: ["c1", "c2"], sentences: [CARD, OTHER] }) }),
    );
    expect(out.voiced).toBe(true);
    expect(out.cards).toEqual(["c1", "c2"]);
  });
});

describe("the motive", () => {
  it("goes to call 2 only when the motive question is the question", async () => {
    const asked = provider("motive", "I was written out of it, yes.");
    await askInWords(asked, request({ release: () => ({ ids: [], sentences: [] }) }));
    expect(asked.calls[1].user).toContain("a legacy she was written out of");

    const notAsked = provider("slot:0", CARD);
    await askInWords(notAsked, request());
    expect(notAsked.calls[1].user).not.toContain("a legacy she was written out of");
  });
});

describe("a question that lands on nothing", () => {
  it("costs nothing and releases nothing for small talk", async () => {
    const log: string[] = [];
    const out = await askInWords(
      provider("smalltalk", "Good evening to you too.", log),
      request({}, log),
    );
    expect(out).toMatchObject({ kind: "smalltalk", spent: false, cards: [], calls: 2 });
    expect(log).toEqual(["classify", "voice"]);
  });

  it("answers too_broad from a canned line, with no second call", async () => {
    const stub = provider("too_broad", "never reached");
    const out = await askInWords(stub, request());
    expect(out).toMatchObject({ kind: "too_broad", spent: false, calls: 1, voiced: false });
    expect(stub.calls).toHaveLength(1);
    expect(out.text.length).toBeGreaterThan(10);
  });

  /*
   * The denial every player will try on everybody.
   *
   * It has to be the same line whoever is speaking. A guilty person who
   * protested differently from an innocent one would be the answer, handed
   * over for free, in one exchange — the same shape of defect as
   * `bank.ts#silenceLeaks`, where every sentence is true and the
   * *distribution* gives the case away. It is canned from the turn count and
   * has no field it could vary by.
   */
  it("denies an accusation identically whoever is accused", async () => {
    const said = new Set<string>();
    for (const name of ["Mrs Pellworth", "Mr Hale", "Dr Innes"]) {
      const out = await askInWords(
        provider("accusation", "never reached"),
        request({ suspect: name, persona: { name, role: "", bio: "", voice: "" } }),
      );
      expect(out).toMatchObject({ kind: "accusation", spent: false, calls: 1 });
      said.add(out.text);
    }
    expect(said.size).toBe(1);
  });
});

describe("when the reply does not survive", () => {
  it("falls back to the bare card, keeping the card and the move", async () => {
    const out = await askInWords(
      provider("slot:0", `${CARD} I was in the kitchen the whole while.`),
      request(),
    );
    expect(out).toMatchObject({
      voiced: false,
      rejected: "stray-label",
      detail: "kitchen",
      cards: ["c1"],
      spent: true,
    });
    expect(out.text).toBe(CARD);
  });

  it("falls back to the bare card when the sentence was paraphrased", async () => {
    const out = await askInWords(
      provider("slot:0", "She was nowhere near it at that hour."),
      request(),
    );
    expect(out).toMatchObject({ voiced: false, rejected: "not-verbatim" });
    expect(out.text).toBe(CARD);
  });

  it("falls back when call 2 fails outright, because the card is already out", async () => {
    const stub = stubProvider({
      answer: (_call, index) =>
        index === 0 ? { choice: "slot:0" } : new LlmError("quota", "slow down"),
    });
    const out = await askInWords(stub, request());
    expect(out).toMatchObject({ voiced: false, cards: ["c1"], spent: true, calls: 2 });
    expect(out.text).toBe(CARD);
  });

  it("lets a cancel through, because the player asked for the waiting to stop", async () => {
    const stub = stubProvider({
      answer: (_call, index) =>
        index === 0 ? { choice: "slot:0" } : new LlmError("cancelled", "cancelled"),
    });
    await expect(askInWords(stub, request())).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("uses the person's own line when nothing was released, if it says nothing", async () => {
    const out = await askInWords(
      provider("smalltalk", "I was in the kitchen."),
      request({ release: () => ({ ids: [], sentences: [] }) }),
    );
    expect(out.text).toBe("I wish I could help you.");
  });

  it("drops that line when it makes a claim the check never saw", async () => {
    const out = await askInWords(
      provider("smalltalk", "I went up at ten o'clock."),
      request({
        silence: "I was in the orangery all evening and saw nothing.",
        release: () => ({ ids: [], sentences: [] }),
      }),
    );
    expect(out.text).toBe("I've nothing to tell you about that.");
  });
});

describe("the conversation it carries", () => {
  it("shows call 2 only the last few turns", async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      from: (i % 2 === 0 ? "player" : "suspect") as "player" | "suspect",
      text: `TURN-${i}`,
    }));
    const stub = provider("slot:0", CARD);
    await askInWords(stub, request({ history }));
    const voice = stub.calls[1].user;
    expect(voice).toContain(`TURN-${20 - VOICE_HISTORY}`);
    expect(voice).not.toContain(`TURN-${20 - VOICE_HISTORY - 1}`);
  });

  it("never shows the conversation to the classifier", async () => {
    // The router needs the question and the menu. A transcript in it would be
    // a second place for a player's words to steer the routing.
    const stub = provider("slot:0", CARD);
    await askInWords(stub, request({ history: [{ from: "player", text: "TURN-X" }] }));
    expect(stub.calls[0].user).not.toContain("TURN-X");
  });
});
