import { describe, expect, it } from "vitest";
import { newCaseId } from "../../engine/caseId";
import { generate, type GeneratedCase } from "../../engine/generator/generate";
import type { ClueBody, ClueId } from "../../engine/types";
import { LlmError } from "../errors";
import type { JsonCall } from "../provider";
import { stubProvider } from "../stub";
import { authorSkin, cluesToDress } from "./author";
import { buildWriterPrompt, writerMaterial } from "./prompts";

function build(): GeneratedCase {
  const out = generate(newCaseId("easy", "auth5"));
  if (!out.case) throw new Error("the fixture case did not generate");
  return out.case;
}

const CASE = build();
const FRAME = CASE.frame;
const CLUES = cluesToDress(CASE);
const IDS = CLUES.map((clue) => clue.id);

/** A writer's answer that would pass validation, with the clue id embedded. */
function writerAnswer(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    title: "The Lamp Room",
    place: "a lighthouse on a sandbar",
    era: "1923",
    styleGuide: "salt light, long shadows",
    rooms: FRAME.plan.rooms.map((room, r) => ({
      name: `the ${["lamp room", "gallery", "store", "kitchen", "bunkroom", "landing", "cellar", "jetty", "shed"][r] ?? `room ${r}`}`,
      code: `X${r}`,
      description: "cold and narrow",
    })),
    slots: Array.from({ length: FRAME.slots }, (_, t) => `${t + 7} o'clock`),
    people: Array.from({ length: FRAME.people }, (_, p) => ({
      name: `Person ${String.fromCharCode(65 + p)}`,
      role: "a keeper",
      bio: "Two sentences about them. Really two.",
      voice: "clipped",
      motive: p === FRAME.victim ? "" : "an old debt",
      portrait: "a weathered face",
    })),
    prose: IDS.map((id) => ({ id, text: `On that night, PROSE(${id}) was so.` })),
    silence: Array.from({ length: FRAME.people }, () => "I have nothing to add."),
    briefing: "The lamp went out at dusk and a man was dead by morning.",
    scene: "a lighthouse in a gale",
    ...overrides,
  };
}

/** opaque id -> clue id, read out of the parse-back prompt. */
function readBack(call: JsonCall, misread: Record<ClueId, ClueBody> = {}): unknown {
  const bodies = new Map(CLUES.map((clue) => [clue.id, clue.body]));
  const readings = [];
  for (const line of call.user.split("\n")) {
    const match = /^ {2}\[(s\d+)\] \([^)]*\) .*PROSE\((c\d+)\)/.exec(line);
    if (!match) continue;
    readings.push({
      id: match[1],
      clue: misread[match[2]] ?? bodies.get(match[2]),
      extraClaims: [],
      attributedTo: -1,
    });
  }
  return { readings };
}

/**
 * The names the fake writer above gives the real culprit and the real hour.
 *
 * Derived from the answer rather than hard-coded, so the lint is being tested
 * against a speech that names the right person — which is the only version of
 * the test that means anything.
 */
const CULPRIT_NAME = `Person ${String.fromCharCode(65 + CASE.world.culprit)}`;
const MURDER_HOUR = `${CASE.world.murderSlot + 7} o'clock`;

const speech = (who: string, when: string) => ({
  speech: `It was ${who}, and it was at ${when}. The lamp told me so.`,
});

/** A provider that plays all three parts, deciding by what it is asked for. */
function wholePipeline(options: { misread?: Record<ClueId, ClueBody>; badSpeech?: boolean } = {}) {
  return stubProvider({
    answer: (call) => {
      if (call.user.startsWith("THE SETTING ASKED FOR:")) return writerAnswer();
      if (call.user.startsWith("WHO AND WHERE AND WHEN")) return readBack(call, options.misread);
      if (call.user.startsWith("These passages did not survive") || call.user.includes("did not survive the check")) {
        return { prose: [] };
      }
      if (call.user.startsWith("LANGUAGE:")) {
        return options.badSpeech
          ? { speech: "Somebody did something, somewhere, at some point." }
          : speech(CULPRIT_NAME, MURDER_HOUR);
      }
      throw new Error(`the stub does not recognise this call:\n${call.user.slice(0, 120)}`);
    },
  });
}

describe("authoring a case end to end, with no key and no network", () => {
  it("writes, checks and sums up in three calls", async () => {
    const provider = wholePipeline();
    const out = await authorSkin(provider, CASE, { setting: "a lighthouse in a storm, 1923" });

    expect(out.calls).toBe(3);
    expect(out.skin.title).toBe("The Lamp Room");
    expect(out.skin.rooms).toHaveLength(FRAME.plan.rooms.length);
    expect(out.skin.slots).toHaveLength(FRAME.slots);
    expect(out.skin.people).toHaveLength(FRAME.people);
    expect(out.skin.setting).toBe("a lighthouse in a storm, 1923");
    expect(out.skin.schemaVersion).toBe(1);
  });

  it("verifies every sentence when every sentence is right", async () => {
    const out = await authorSkin(wholePipeline(), CASE, { setting: "anywhere" });
    expect(out.skin.fidelity.checked).toBe(CLUES.length);
    expect(out.skin.fidelity.verified).toBe(CLUES.length);
    expect(out.skin.fidelity.fallback).toEqual([]);
    expect(Object.keys(out.skin.prose)).toHaveLength(CLUES.length);
  });

  it("keeps the summing-up when it names the killer and the hour", async () => {
    const out = await authorSkin(wholePipeline(), CASE, { setting: "anywhere" });
    expect(out.skin.summingUp).toContain(CULPRIT_NAME);
    expect(out.skin.summingUp).toContain(MURDER_HOUR);
  });

  it("drops a summing-up that does not name them", async () => {
    const out = await authorSkin(wholePipeline({ badSpeech: true }), CASE, { setting: "x" });
    expect(out.skin.summingUp).toBeNull();
    // ...and the case is still perfectly good.
    expect(out.skin.fidelity.verified).toBe(CLUES.length);
  });

  it("skips call B when asked to", async () => {
    const out = await authorSkin(wholePipeline(), CASE, { setting: "x", summingUp: false });
    expect(out.calls).toBe(2);
    expect(out.skin.summingUp).toBeNull();
  });
});

/*
 * The leak test again, this time on the whole pipeline rather than on the
 * prompt builder. `authorSkin` is the one function that holds both the case
 * and the writer, so it is the one place the truth could be handed over by
 * accident.
 */
describe("the pipeline does not hand the writer the answer", () => {
  const writerPromptFrom = async (kase: GeneratedCase): Promise<string> => {
    const provider = wholePipeline();
    await authorSkin(provider, kase, { setting: "a lighthouse in a storm, 1923" });
    return provider.calls[0].user;
  };

  it("sends exactly the prompt the builder makes, and nothing appended", async () => {
    const sent = await writerPromptFrom(CASE);
    expect(sent).toBe(
      buildWriterPrompt(
        writerMaterial(FRAME, CLUES, { setting: "a lighthouse in a storm, 1923", language: "en" }),
      ),
    );
  });

  it("sends the same prompt whoever did it and whenever", async () => {
    const real = await writerPromptFrom(CASE);
    for (let culprit = 0; culprit < FRAME.suspects; culprit++) {
      for (const slot of [0, FRAME.slots - 1]) {
        const other = await writerPromptFrom({
          ...CASE,
          world: { ...CASE.world, culprit, murderSlot: slot },
        });
        expect(other).toBe(real);
      }
    }
  });
});

describe("when the writer's answer does not fit", () => {
  const badThenGood = (bad: unknown) => {
    let first = true;
    return stubProvider({
      answer: (call) => {
        if (call.user.startsWith("THE SETTING ASKED FOR:")) {
          if (first) {
            first = false;
            return bad;
          }
          return writerAnswer();
        }
        if (call.user.startsWith("WHO AND WHERE AND WHEN")) return readBack(call);
        return speech(CULPRIT_NAME, MURDER_HOUR);
      },
    });
  };

  it("asks again, with the complaints attached", async () => {
    const provider = badThenGood(writerAnswer({ rooms: [] }));
    const out = await authorSkin(provider, CASE, { setting: "x" });
    expect(out.calls).toBe(4);
    const second = provider.calls[1].user;
    expect(second).toContain("YOUR LAST ANSWER WAS REJECTED");
    expect(second).toContain("one per room in order");
    expect(out.skin.rooms).toHaveLength(FRAME.plan.rooms.length);
  });

  it("complains about a suspect with no motive, which is a leak of its own", async () => {
    const people = (writerAnswer() as { people: Record<string, unknown>[] }).people;
    const stripped = people.map((person, p) => (p === 0 ? { ...person, motive: "" } : person));
    const provider = badThenGood(writerAnswer({ people: stripped }));
    await authorSkin(provider, CASE, { setting: "x" });
    expect(provider.calls[1].user).toContain("people[0].motive is missing");
  });

  it("complains about missing prose by naming the clues", async () => {
    const provider = badThenGood(writerAnswer({ prose: [] }));
    await authorSkin(provider, CASE, { setting: "x" });
    expect(provider.calls[1].user).toContain("prose is missing:");
    expect(provider.calls[1].user).toContain(IDS[0]);
  });

  it("gives up after the last try rather than shipping half a skin", async () => {
    const provider = stubProvider({
      answer: (call) =>
        call.user.startsWith("THE SETTING ASKED FOR:")
          ? writerAnswer({ slots: [] })
          : readBack(call),
    });
    await expect(
      authorSkin(provider, CASE, { setting: "x", writerAttempts: 2 }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

describe("when the prose does not survive the check", () => {
  it("rewrites the failures and falls back on what still fails", async () => {
    const first = IDS[0];
    const wrong: ClueBody = { kind: "Empty", r: 0, t: 0 };
    let rewrites = 0;
    const provider = stubProvider({
      answer: (call) => {
        if (call.user.startsWith("THE SETTING ASKED FOR:")) return writerAnswer();
        if (call.user.includes("did not survive the check")) {
          rewrites++;
          // The rewrite names the clue and quotes the complaint back.
          expect(call.user).toContain(first);
          expect(call.user).toContain("the reader said:");
          return { prose: [{ id: first, text: `Again now, PROSE(${first}).` }] };
        }
        if (call.user.startsWith("WHO AND WHERE AND WHEN")) {
          return readBack(call, { [first]: wrong });
        }
        return speech(CULPRIT_NAME, MURDER_HOUR);
      },
    });

    const out = await authorSkin(provider, CASE, { setting: "x", fidelityAttempts: 3 });
    expect(rewrites).toBe(2);
    expect(out.skin.fidelity.fallback).toEqual([first]);
    expect(out.skin.fidelity.verified).toBe(CLUES.length - 1);
    // The clue that failed simply has no prose, and the card will show the
    // engine's sentence. Nothing marks it as second best.
    expect(out.skin.prose[first]).toBeUndefined();
  });
});
