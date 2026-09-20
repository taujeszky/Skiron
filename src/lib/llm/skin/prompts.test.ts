import { describe, expect, it } from "vitest";
import { newCaseId } from "../../engine/caseId";
import { canonical, clueCanonical } from "../../engine/clues";
import { allCards } from "../../engine/generator/bank";
import { generate } from "../../engine/generator/generate";
import { defaultGlossary } from "../../engine/solver/explain";
import type { Clue } from "../../engine/types";
import type { GeneratedCase as Built } from "../../engine/generator/generate";
import {
  buildParseBackPrompt,
  buildSummingUpPrompt,
  buildWriterPrompt,
  parseBackSchema,
  summingUpMaterial,
  summingUpNames,
  writerMaterial,
} from "./prompts";

/** One real case, generated once. Everything here reads it and nothing edits it. */
function build(): Built {
  const out = generate(newCaseId("normal", "w5test"));
  if (!out.case) throw new Error("the fixture case did not generate");
  return out.case;
}

const CASE = build();
const FRAME = CASE.frame;
/** Every card the player can ever hold — what the writer is given. */
const HELD: Clue[] = [...CASE.opening, ...allCards(CASE.bank)];
const GLOSSARY = defaultGlossary(FRAME);

const material = (c: Built = CASE) =>
  writerMaterial(c.frame, [...c.opening, ...allCards(c.bank)], {
    setting: "a lighthouse in a storm, 1923",
  });

describe("the writer's material", () => {
  it("carries every card the player could ever hold", () => {
    const ids = new Set(material().clues.map((clue) => clue.id));
    for (const clue of HELD) expect(ids.has(clue.id)).toBe(true);
    expect(ids.size).toBe(HELD.length);
  });

  it("carries the house, the hours and the cast", () => {
    const m = material();
    expect(m.rooms).toHaveLength(FRAME.plan.rooms.length);
    expect(m.doors).toHaveLength(FRAME.plan.doors.length);
    expect(m.slots).toBe(FRAME.slots);
    expect(m.suspects).toBe(FRAME.suspects);
    expect(m.victim).toBe(FRAME.victim);
    expect(m.murderRoom).toBe(FRAME.murderRoom);
  });

  it("has nowhere to put the answer", () => {
    // Structural, not textual: if a field for the culprit is ever added, this
    // is the line that has to be deleted to make the test compile.
    const m = material() as unknown as Record<string, unknown>;
    for (const forbidden of ["culprit", "murderSlot", "world", "answer", "alibi", "lies", "trace", "essential"]) {
      expect(Object.keys(m)).not.toContain(forbidden);
    }
  });
});

/*
 * The test this wave's honesty rests on.
 *
 * Reading the prompt and not seeing a culprit proves nothing — the culprit is
 * one of the cast and appears on every second line. What proves it is that the
 * prompt does not MOVE when the answer does: change who did it and when, and
 * if a single byte of the writer's input changes, the answer is in there
 * somewhere.
 */
describe("the writer is not told who did it", () => {
  const withAnswer = (culprit: number, slot: number): Built => {
    const copy = { ...CASE, world: { ...CASE.world, culprit, murderSlot: slot } };
    return copy as Built;
  };

  it("builds the same prompt whoever the killer turns out to be", () => {
    const real = buildWriterPrompt(material());
    for (let culprit = 0; culprit < FRAME.suspects; culprit++) {
      const other = buildWriterPrompt(material(withAnswer(culprit, CASE.world.murderSlot)));
      expect(other).toBe(real);
    }
  });

  it("builds the same prompt whenever the murder turns out to be", () => {
    const real = buildWriterPrompt(material());
    for (let slot = 0; slot < FRAME.slots; slot++) {
      const other = buildWriterPrompt(material(withAnswer(CASE.world.culprit, slot)));
      expect(other).toBe(real);
    }
  });

  it("builds the same prompt when the whole simulated evening changes", () => {
    // `world.loc` is the grid the player is trying to reconstruct. Nothing the
    // writer sees may depend on it.
    const scrambled = {
      ...CASE,
      world: { ...CASE.world, loc: CASE.world.loc.map((row) => [...row].reverse()) },
    } as Built;
    expect(buildWriterPrompt(material(scrambled))).toBe(buildWriterPrompt(material()));
  });

  it("does not mark which statements are false", () => {
    const prompt = buildWriterPrompt(material());
    const clueLines = prompt.split("\n").filter((line) => /^ {2}c\d+ \|/.test(line));

    // The prompt does say "the killer may lie", once, among the rules. That is
    // rule 7 of the eight the player is told on the briefing screen, and
    // keeping it from the writer would only produce prose that contradicts the
    // game it is dressing. What must not happen is an individual statement
    // being marked, so this looks at the clue lines and nothing else.
    for (const line of clueLines) {
      for (const word of ["lie", "lying", "false", "untrue", "culprit", "killer"]) {
        expect([line, line.toLowerCase().includes(word)]).toEqual([line, false]);
      }
    }

    // And the culprit's own false statements are shaped like everybody's.
    if (CASE.alibi) {
      for (const lie of CASE.alibi.lies) {
        const marked = clueLines.filter((line) => line.startsWith(`  ${lie.id} |`));
        expect(marked.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not say which clues the proof needs", () => {
    const prompt = buildWriterPrompt(material());
    // Every clue line has the same shape; an essential one is not flagged.
    const shapes = new Set(
      prompt
        .split("\n")
        .filter((line) => /^ {2}c\d+ \|/.test(line))
        .map((line) => line.split("|").length),
    );
    expect(shapes.size).toBe(1);
  });
});

describe("the writer's prompt", () => {
  const prompt = buildWriterPrompt(material());

  it("names every clue id exactly once", () => {
    for (const clue of HELD) {
      const lines = prompt.split("\n").filter((line) => line.startsWith(`  ${clue.id} |`));
      expect([clue.id, lines.length]).toEqual([clue.id, 1]);
    }
  });

  it("says who is speaking, and says nothing where nobody is", () => {
    for (const clue of HELD) {
      const line = prompt.split("\n").find((l) => l.startsWith(`  ${clue.id} |`))!;
      if (clue.source.kind === "testimony") {
        expect(line).toContain(`p${clue.source.speaker} speaking`);
      } else {
        expect(line).toContain("no speaker");
      }
    }
  });

  it("carries the setting the player typed", () => {
    expect(prompt).toContain("a lighthouse in a storm, 1923");
  });

  it("marks the room the body was found in, which the player is told too", () => {
    expect(prompt).toContain("<< the body was found here");
  });
});

/*
 * The parse-back's half of the same argument.
 */
describe("the parse-back is not told what the answer should be", () => {
  const items = HELD.slice(0, 8).map((clue, i) => ({
    id: `s${i}`,
    text: "Somebody said something about the evening.",
    speaker: clue.source.kind === "testimony" ? GLOSSARY.personName(clue.source.speaker) : null,
  }));
  const prompt = buildParseBackPrompt(items, FRAME, GLOSSARY);

  it("contains no canonical form of any clue", () => {
    // The whole check collapses if it does: the model would be reading the
    // answer rather than the sentence, and every entry would pass.
    for (const clue of HELD) {
      expect(prompt).not.toContain(canonical(clue.body));
      expect(prompt).not.toContain(clueCanonical(clue));
    }
  });

  it("contains no clue id", () => {
    for (const clue of HELD) {
      expect(prompt).not.toContain(`[${clue.id}]`);
    }
  });

  it("names the people, rooms, hours and doors, because a reader needs them", () => {
    expect(prompt).toContain(GLOSSARY.personName(0));
    expect(prompt).toContain(GLOSSARY.roomName(0));
    expect(prompt).toContain(GLOSSARY.slotLabel(0));
    expect(prompt).toContain("Doors:");
  });

  it("lists the whole vocabulary, so a reader can tell Saw from Together", () => {
    expect(prompt).toContain("Saw:");
    expect(prompt).toContain("Together:");
    expect(prompt).toContain("Empty:");
    expect(prompt).toContain("Count:");
  });

  it("is a function of the prose alone, not of the clues it came from", () => {
    // Same sentences, same prompt — even though these are different clues.
    const other = HELD.slice(8, 16).map((clue, i) => ({
      id: `s${i}`,
      text: "Somebody said something about the evening.",
      speaker: clue.source.kind === "testimony" ? GLOSSARY.personName(clue.source.speaker) : null,
    }));
    const sameSpeakers = other.every((o, i) => o.speaker === items[i].speaker);
    if (sameSpeakers) {
      expect(buildParseBackPrompt(other, FRAME, GLOSSARY)).toBe(prompt);
    }
  });
});

describe("the parse-back schema", () => {
  it("confines each reading to an entry that was actually sent", () => {
    const schema = parseBackSchema(FRAME, ["s0", "s1", "s2"]);
    const readings = schema.properties?.readings;
    expect(readings?.items?.properties?.id.enum).toEqual(["s0", "s1", "s2"]);
  });

  it("does NOT bound the array, which is what a live 400 taught it", () => {
    // Measured on gemini-3.8-flash, 2026-09-20: with `minItems`/`maxItems` the
    // request is rejected outright once the count passes about thirteen,
    // because each item is a seventeen-branch `anyOf`. Asserted here so that
    // somebody tidying the schema up puts them back and finds out in a test
    // rather than in a paid batch.
    const schema = parseBackSchema(FRAME, ["s0", "s1", "s2"]);
    expect(schema.properties?.readings.minItems).toBeUndefined();
    expect(schema.properties?.readings.maxItems).toBeUndefined();
  });

  it("requires the extra-claims list, so silence is a choice and not an omission", () => {
    const schema = parseBackSchema(FRAME, ["s0"]);
    expect(schema.properties?.readings.items?.required).toContain("extraClaims");
    expect(schema.properties?.readings.items?.required).toContain("attributedTo");
  });
});

describe("the summing-up", () => {
  const glossary = defaultGlossary(FRAME);
  const stuff = summingUpMaterial(
    FRAME,
    glossary,
    { culprit: CASE.world.culprit, slot: CASE.world.murderSlot },
    ["first this", "then that"],
    { motive: "an old debt", styleGuide: "cold light, long shadows" },
  );

  it("is the one prompt that does know the answer", () => {
    const prompt = buildSummingUpPrompt(stuff);
    expect(prompt).toContain(glossary.personName(CASE.world.culprit));
    expect(prompt).toContain(glossary.slotLabel(CASE.world.murderSlot));
    expect(prompt).toContain("first this");
    expect(prompt).toContain("then that");
  });

  it("lints a speech for the killer's name and the hour", () => {
    const who = glossary.personName(CASE.world.culprit);
    const when = glossary.slotLabel(CASE.world.murderSlot);
    expect(summingUpNames(`It was ${who}, at ${when}.`, who, when)).toBe(true);
    expect(summingUpNames(`It was ${who}.`, who, when)).toBe(false);
    expect(summingUpNames(`Somebody did it at ${when}.`, who, when)).toBe(false);
    expect(summingUpNames("", who, when)).toBe(false);
  });
});
