import { describe, expect, it } from "vitest";
import { newCaseId } from "../../engine/caseId";
import { canonical } from "../../engine/clues";
import { allCards } from "../../engine/generator/bank";
import { generate, type GeneratedCase } from "../../engine/generator/generate";
import { defaultGlossary } from "../../engine/solver/explain";
import type { Clue, ClueBody, ClueId } from "../../engine/types";
import { LlmError } from "../errors";
import type { JsonCall } from "../provider";
import { stubProvider } from "../stub";
import { checkFidelity, fallbackRate, fidelityPass } from "./fidelity";

function build(): GeneratedCase {
  const out = generate(newCaseId("easy", "fid5"));
  if (!out.case) throw new Error("the fixture case did not generate");
  return out.case;
}

const CASE = build();
const FRAME = CASE.frame;
const GLOSSARY = defaultGlossary(FRAME);
/** A handful of clues is plenty, and keeps the assertions readable. */
const CLUES: Clue[] = [...CASE.opening, ...allCards(CASE.bank)].slice(0, 10);

/**
 * Prose that says which clue it is.
 *
 * The stub reader below works by reading it, exactly as a real reader works by
 * reading the sentence. That is the point: a stub that answered from a list
 * regardless of what it was sent would be the self-confirming check this
 * module is built to avoid, reproduced in the test that is supposed to catch
 * it.
 */
const prose = (ids: readonly ClueId[]): Record<ClueId, string> =>
  Object.fromEntries(ids.map((id) => [id, `On the night in question, PROSE(${id}) was so.`]));

/** opaque id -> the clue id its text names, read out of the prompt. */
function itemsOf(call: JsonCall): { opaque: string; clue: ClueId }[] {
  const out: { opaque: string; clue: ClueId }[] = [];
  for (const line of call.user.split("\n")) {
    const match = /^ {2}\[(s\d+)\] \([^)]*\) .*PROSE\((c\d+)\)/.exec(line);
    if (match) out.push({ opaque: match[1], clue: match[2] });
  }
  return out;
}

interface ReaderOptions {
  /** Read this clue as something else. */
  as?: Record<ClueId, ClueBody>;
  extraClaims?: Record<ClueId, string[]>;
  attributedTo?: Record<ClueId, number>;
  /** Return nothing at all for these. */
  omit?: ClueId[];
  /** Return something that is not a clue. */
  garbage?: ClueId[];
}

/** A stub that reads the prose it is sent, and can be told to misread some. */
function reader(clues: readonly Clue[], options: ReaderOptions = {}) {
  const bodies = new Map(clues.map((clue) => [clue.id, clue.body]));
  return (call: JsonCall): unknown => {
    const readings = [];
    for (const item of itemsOf(call)) {
      if (options.omit?.includes(item.clue)) continue;
      const body = options.garbage?.includes(item.clue)
        ? { kind: "Nonsense" }
        : (options.as?.[item.clue] ?? bodies.get(item.clue));
      readings.push({
        id: item.opaque,
        clue: body,
        extraClaims: options.extraClaims?.[item.clue] ?? [],
        attributedTo: options.attributedTo?.[item.clue] ?? -1,
      });
    }
    return { readings };
  };
}

const run = (
  clues: readonly Clue[],
  written: Record<ClueId, string>,
  readerOptions: ReaderOptions = {},
  fidelityOptions = {},
) =>
  checkFidelity(
    stubProvider({ answer: reader(clues, readerOptions) }),
    FRAME,
    GLOSSARY,
    clues,
    written,
    fidelityOptions,
  );

describe("a faithful reading", () => {
  it("verifies every clue and falls back on none", async () => {
    const written = prose(CLUES.map((c) => c.id));
    const result = await run(CLUES, written);
    expect(result.fidelity.checked).toBe(CLUES.length);
    expect(result.fidelity.verified).toBe(CLUES.length);
    expect(result.fidelity.fallback).toEqual([]);
    expect(fallbackRate(result.fidelity)).toBe(0);
    expect(Object.keys(result.prose).sort()).toEqual(CLUES.map((c) => c.id).sort());
  });

  it("counts only the clues that had prose to check", async () => {
    const some = CLUES.slice(0, 4).map((c) => c.id);
    const result = await run(CLUES, prose(some));
    expect(result.fidelity.checked).toBe(4);
    expect(result.fidelity.verified).toBe(4);
    // The rest are still listed as falling back — they will be shown as
    // templates, which is what `fallback` is for.
    expect(result.fidelity.fallback).toHaveLength(CLUES.length - 4);
  });
});

/*
 * The canary. Everything above would pass just as happily if the comparison
 * could not reject, and a fallback rate of zero would then mean nothing at
 * all. These are the tests that say it can.
 */
describe("an unfaithful reading is caught", () => {
  const first = CLUES[0];
  const second = CLUES[1];

  it("a different clue", async () => {
    const wrong: ClueBody = { kind: "At", p: 0, t: 0, r: 0 };
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), { as: { [first.id]: wrong } });
    // Unless the clue really is that, in which case pick another case.
    expect(canonical(first.body)).not.toBe(canonical(wrong));
    expect(result.fidelity.fallback).toContain(first.id);
    expect(result.prose[first.id]).toBeUndefined();
    expect(result.mismatches[0]).toMatchObject({ id: first.id, reason: "different-clue" });
  });

  it("two sentences swapped between two clues — both of them", async () => {
    // The sharpest version, and the one worth keeping: every sentence is a
    // real, well-written sentence about a real clue, and the only thing wrong
    // is which clue it is filed under. Nothing tells the reader to misread
    // anything — it reads the prose it is sent, and the prose is in the wrong
    // place. A check that passed this would be passing on the strength of the
    // filing rather than the words.
    const written = prose(CLUES.map((c) => c.id));
    const swapped = { ...written, [first.id]: written[second.id], [second.id]: written[first.id] };
    const result = await run(CLUES, swapped);
    expect(canonical(first.body)).not.toBe(canonical(second.body));
    expect(result.fidelity.fallback).toContain(first.id);
    expect(result.fidelity.fallback).toContain(second.id);
    expect(result.fidelity.verified).toBe(CLUES.length - 2);
  });

  it("an extra claim, even when the clue itself is right", async () => {
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), {
      extraClaims: { [first.id]: ["and the doctor was in the hall at ten"] },
    });
    expect(result.fidelity.fallback).toContain(first.id);
    expect(result.mismatches[0]).toMatchObject({ id: first.id, reason: "extra-claim" });
    expect(result.mismatches[0].extraClaims).toHaveLength(1);
  });

  it("an observation credited to the wrong person", async () => {
    const speaker = CLUES.find((c) => c.source.kind === "testimony");
    if (!speaker || speaker.source.kind !== "testimony") return;
    const other = (speaker.source.speaker + 1) % FRAME.suspects;
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), {
      attributedTo: { [speaker.id]: other },
    });
    expect(result.fidelity.fallback).toContain(speaker.id);
    expect(result.mismatches[0]).toMatchObject({ reason: "misattributed" });
  });

  it("an answer that is not a clue at all", async () => {
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), { garbage: [first.id] });
    expect(result.fidelity.fallback).toContain(first.id);
    expect(result.mismatches[0]).toMatchObject({ reason: "unreadable" });
  });

  it("no answer for an entry", async () => {
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), { omit: [first.id] });
    expect(result.fidelity.fallback).toContain(first.id);
    expect(result.mismatches[0]).toMatchObject({ reason: "missing" });
  });

  it("leaves every other clue verified", async () => {
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), { garbage: [first.id] });
    expect(result.fidelity.verified).toBe(CLUES.length - 1);
    for (const clue of CLUES.slice(1)) expect(result.prose[clue.id]).toBeDefined();
  });
});

describe("the retry", () => {
  const first = CLUES[0];
  const wrong: ClueBody = { kind: "Empty", r: 0, t: 0 };

  it("mismatch, then a rewrite that fixes it, then a pass", async () => {
    let asked = 0;
    const badThenGood: Record<string, ClueBody> = { [first.id]: wrong };
    const provider = stubProvider({
      answer: (call) => reader(CLUES, { as: badThenGood })(call),
    });

    const result = await checkFidelity(provider, FRAME, GLOSSARY, CLUES, prose(CLUES.map((c) => c.id)), {
      rewrite: async (mismatches) => {
        asked++;
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].id).toBe(first.id);
        // The complaint is the part that makes a retry worth making: it says
        // what was read and what it should have said.
        expect(mismatches[0].complaint).toContain(canonical(first.body));
        // The rewrite works this time.
        delete badThenGood[first.id];
        return { [first.id]: `Now truly, PROSE(${first.id}).` };
      },
    });

    expect(asked).toBe(1);
    expect(result.fidelity.retried).toBe(1);
    expect(result.fidelity.verified).toBe(CLUES.length);
    expect(result.fidelity.fallback).toEqual([]);
    expect(result.prose[first.id]).toContain("Now truly");
  });

  it("mismatch, rewrites that never fix it, then the template", async () => {
    let asked = 0;
    const result = await checkFidelity(
      stubProvider({ answer: reader(CLUES, { as: { [first.id]: wrong } }) }),
      FRAME,
      GLOSSARY,
      CLUES,
      prose(CLUES.map((c) => c.id)),
      {
        attempts: 3,
        rewrite: async () => {
          asked++;
          return { [first.id]: `Still wrong, PROSE(${first.id}).` };
        },
      },
    );
    // Three passes means two rewrites: the plan's "two retries".
    expect(asked).toBe(2);
    expect(result.fidelity.fallback).toEqual([first.id]);
    expect(result.fidelity.verified).toBe(CLUES.length - 1);
    expect(fallbackRate(result.fidelity)).toBeCloseTo(1 / CLUES.length);
  });

  it("does not retry at all when there is nobody to rewrite", async () => {
    const result = await run(CLUES, prose(CLUES.map((c) => c.id)), { as: { [first.id]: wrong } });
    expect(result.fidelity.retried).toBe(0);
    expect(result.fidelity.fallback).toEqual([first.id]);
  });

  it("keeps what already passed when a rewrite fails outright", async () => {
    const result = await checkFidelity(
      stubProvider({ answer: reader(CLUES, { as: { [first.id]: wrong } }) }),
      FRAME,
      GLOSSARY,
      CLUES,
      prose(CLUES.map((c) => c.id)),
      {
        rewrite: async () => {
          throw new LlmError("quota", "out of quota");
        },
      },
    );
    expect(result.fidelity.verified).toBe(CLUES.length - 1);
    expect(result.fidelity.fallback).toEqual([first.id]);
  });

  it("gives up on a cancel rather than falling back", async () => {
    // A player pressing cancel has not decided to accept template sentences.
    await expect(
      checkFidelity(
        stubProvider({ answer: reader(CLUES, { as: { [first.id]: wrong } }) }),
        FRAME,
        GLOSSARY,
        CLUES,
        prose(CLUES.map((c) => c.id)),
        {
          rewrite: async () => {
            throw new LlmError("cancelled", "cancelled");
          },
        },
      ),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });
});

describe("what the checker is sent", () => {
  it("never the canonical form of anything", async () => {
    const provider = stubProvider({ answer: reader(CLUES) });
    await fidelityPass(provider, FRAME, GLOSSARY, CLUES, prose(CLUES.map((c) => c.id)));
    const sent = provider.calls[0].user;
    for (const clue of CLUES) {
      expect(sent).not.toContain(canonical(clue.body));
      expect(sent).not.toContain(`[${clue.id}]`);
    }
  });

  it("the sentences in an order that is not the clues' order", async () => {
    const provider = stubProvider({ answer: reader(CLUES) });
    await fidelityPass(provider, FRAME, GLOSSARY, CLUES, prose(CLUES.map((c) => c.id)));
    const order = itemsOf(provider.calls[0]).map((item) => item.clue);
    expect(order).toHaveLength(CLUES.length);
    expect(order).not.toEqual(CLUES.map((c) => c.id));
  });

  it("the same order every time, so a failure can be reproduced", async () => {
    const once = stubProvider({ answer: reader(CLUES) });
    const twice = stubProvider({ answer: reader(CLUES) });
    const written = prose(CLUES.map((c) => c.id));
    await fidelityPass(once, FRAME, GLOSSARY, CLUES, written);
    await fidelityPass(twice, FRAME, GLOSSARY, CLUES, written);
    expect(once.calls[0].user).toBe(twice.calls[0].user);
  });

  it("temperature zero: the reading must be about the prose, not the weather", async () => {
    const provider = stubProvider({ answer: reader(CLUES) });
    await fidelityPass(provider, FRAME, GLOSSARY, CLUES, prose(CLUES.map((c) => c.id)));
    expect(provider.calls[0].temperature).toBe(0);
  });
});
