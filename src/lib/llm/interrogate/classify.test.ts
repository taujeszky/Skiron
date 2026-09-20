import { describe, expect, it } from "vitest";

import { newCaseId } from "../../engine/caseId";
import { canonical, clueCanonical } from "../../engine/clues";
import { allCards } from "../../engine/generator/bank";
import { generate } from "../../engine/generator/generate";
import type { GeneratedCase as Built } from "../../engine/generator/generate";
import { defaultGlossary } from "../../engine/solver/explain";
import type { Clue, Glossary } from "../../engine/types";
import { topicsFor } from "../../game/controller";
import { stubProvider } from "../stub";

import {
  type ClassifyInput,
  type Topic,
  SPECIALS,
  buildClassifyPrompt,
  classifyQuestion,
  classifySchema,
  readClassification,
} from "./classify";

function build(): Built {
  const out = generate(newCaseId("normal", "w6test"));
  if (!out.case) throw new Error("the fixture case did not generate");
  return out.case;
}

const CASE = build();
const FRAME = CASE.frame;
const GLOSSARY: Glossary = defaultGlossary(FRAME);
const HELD: Clue[] = [...CASE.opening, ...allCards(CASE.bank)];
const SUSPECT = 0;

/**
 * The classifier's input, built the way the controller builds it.
 *
 * It is a function of the frame, the glossary and the suspect — never of the
 * case. Written out here so the tests below can vary a case underneath it and
 * watch nothing happen.
 */
function inputFor(kase: Built, question = "Where were you at the start?"): ClassifyInput {
  const gloss = defaultGlossary(kase.frame);
  return {
    question,
    suspect: gloss.personName(SUSPECT),
    topics: topicsFor(kase.frame, SUSPECT, gloss).map((t) => ({
      key: t.key,
      label: t.label,
      group: t.group,
      alias: t.group === "room" ? gloss.roomCode(Number(t.key.slice(5))) : undefined,
    })),
  };
}

const TOPICS: Topic[] = inputFor(CASE).topics as Topic[];

describe("what the classifier is given", () => {
  it("has nowhere to put a card, a bank or an answer", () => {
    // Structural, not textual, exactly as `prompts.test.ts` does for the
    // writer: adding a field for any of these is a line somebody has to
    // delete to make this compile.
    const keys = Object.keys(inputFor(CASE) as unknown as Record<string, unknown>);
    for (const forbidden of [
      "bank",
      "cards",
      "clues",
      "case",
      "world",
      "culprit",
      "murderSlot",
      "answer",
      "prose",
      "essential",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys.sort()).toEqual(["question", "suspect", "topics"]);
  });

  it("offers every topic the picker offers, and in the picker's order", () => {
    const picker = topicsFor(FRAME, SUSPECT, GLOSSARY).map((t) => t.key);
    expect(TOPICS.map((t) => t.key)).toEqual(picker);
  });
});

/*
 * The test wave 6's honesty rests on, and it is wave 5's test with one more
 * limb: the bank.
 *
 * Reading the prompt and not finding the culprit proves nothing. What proves
 * it is that the prompt does not MOVE when the answer does — and, this wave,
 * when what the bank holds does. A classifier shown only the topics that
 * would release something would be handing over a map of the evidence, which
 * is the same defect as `bank.ts#silenceLeaks`.
 */
describe("the classifier is not told who did it, or where the evidence is", () => {
  const prompt = buildClassifyPrompt(inputFor(CASE));

  it("builds the same prompt whoever the killer turns out to be", () => {
    for (let culprit = 0; culprit < FRAME.suspects; culprit++) {
      const other = { ...CASE, world: { ...CASE.world, culprit } } as Built;
      expect(buildClassifyPrompt(inputFor(other))).toBe(prompt);
    }
  });

  it("builds the same prompt whenever the murder turns out to be", () => {
    for (let slot = 0; slot < FRAME.slots; slot++) {
      const other = { ...CASE, world: { ...CASE.world, murderSlot: slot } } as Built;
      expect(buildClassifyPrompt(inputFor(other))).toBe(prompt);
    }
  });

  it("builds the same prompt when the whole simulated evening changes", () => {
    const scrambled = {
      ...CASE,
      world: { ...CASE.world, loc: CASE.world.loc.map((row) => [...row].reverse()) },
    } as Built;
    expect(buildClassifyPrompt(inputFor(scrambled))).toBe(prompt);
  });

  it("builds the same prompt when the bank has nothing in it at all", () => {
    // If a later change ever narrows the offered list to "topics that release
    // a card", this is the line that goes red.
    const gutted = {
      ...CASE,
      bank: { ...CASE.bank, said: new Map(), found: new Map(), cards: new Map() },
    } as Built;
    expect(buildClassifyPrompt(inputFor(gutted))).toBe(prompt);
  });

  it("carries no clue, in any form", () => {
    for (const clue of HELD) {
      expect(prompt).not.toContain(canonical(clue.body));
      expect(prompt).not.toContain(clueCanonical(clue));
      expect(prompt).not.toContain(clue.id);
    }
  });
});

describe("the classifier's prompt", () => {
  const prompt = buildClassifyPrompt(inputFor(CASE, "were you in the hall at nine?"));

  it("names every topic key exactly once, with its label", () => {
    for (const topic of TOPICS) {
      const lines = prompt.split("\n").filter((line) => line.includes(`${topic.key} = `));
      expect([topic.key, lines.length]).toEqual([topic.key, 1]);
      expect(lines[0]).toContain(topic.label);
    }
  });

  it("gives a room its grid code, because that is what players type", () => {
    const room = TOPICS.find((t) => t.group === "room")!;
    expect(prompt).toContain(`grid code ${room.alias}`);
  });

  it("offers the three ways out as well", () => {
    for (const special of SPECIALS) expect(prompt).toContain(special);
  });

  it("quotes the question as data rather than as an instruction", () => {
    expect(prompt).toContain("<<<were you in the hall at nine?>>>");
  });
});

describe("the classifier's schema", () => {
  it("allows exactly the topics offered, plus the three ways out", () => {
    const schema = classifySchema(TOPICS);
    expect(schema.properties?.choice.enum).toEqual([
      ...TOPICS.map((t) => t.key),
      ...SPECIALS,
    ]);
  });

  it("is the guard, so nothing downstream has to defend against a made-up key", () => {
    const schema = classifySchema(TOPICS);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["choice"]);
  });
});

describe("reading the answer", () => {
  it("takes a topic that was offered", () => {
    expect(readClassification({ choice: TOPICS[0].key }, TOPICS)).toEqual({
      kind: "topic",
      key: TOPICS[0].key,
    });
  });

  it("takes each of the three ways out", () => {
    expect(readClassification({ choice: "smalltalk" }, TOPICS)).toEqual({ kind: "smalltalk" });
    expect(readClassification({ choice: "too_broad" }, TOPICS)).toEqual({ kind: "too_broad" });
    expect(readClassification({ choice: "accusation" }, TOPICS)).toEqual({
      kind: "accusation",
    });
  });

  it("refuses a topic that was not offered, and says so as too_broad", () => {
    // A schema is a request, not a promise (see `provider.ts`), and the
    // cheapest honest answer to a key nobody offered is to ask again — which
    // costs the player nothing.
    expect(readClassification({ choice: "room:99" }, TOPICS)).toEqual({ kind: "too_broad" });
    expect(readClassification({ choice: "person:0" }, [])).toEqual({ kind: "too_broad" });
    expect(readClassification({}, TOPICS)).toEqual({ kind: "too_broad" });
    expect(readClassification(null, TOPICS)).toEqual({ kind: "too_broad" });
    expect(readClassification({ choice: 3 }, TOPICS)).toEqual({ kind: "too_broad" });
  });
});

describe("putting the question to a model", () => {
  it("asks at temperature zero, so the same words reach the same topic", async () => {
    const stub = stubProvider({ answer: () => ({ choice: TOPICS[0].key }) });
    await classifyQuestion(stub, inputFor(CASE));
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].temperature).toBe(0);
  });

  it("does not spend a call on an empty question", async () => {
    const stub = stubProvider({ answer: () => ({ choice: "smalltalk" }) });
    expect(await classifyQuestion(stub, inputFor(CASE, "   "))).toEqual({
      kind: "too_broad",
    });
    expect(stub.calls).toHaveLength(0);
  });
});
