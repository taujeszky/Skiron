import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newCaseId } from "../../engine/caseId";
import { generate } from "../../engine/generator/generate";
import { canonical } from "../../engine/clues";
import { geminiProvider } from "../gemini";
import { PARSER_MODEL, WRITER_MODEL } from "../models";
import { authorSkin, cluesToDress } from "./author";
import { fallbackRate } from "./fidelity";
import { skinGlossary } from "./glossary";

/*
 * The only tests in Skiron that spend money.
 *
 * Outside `npm test` on purpose — see `vitest.live.config.ts`. One Easy case
 * is three calls; the estimate for that is a fraction of a cent, and
 * `npm run author -- --estimate` prints the number for any batch before it is
 * run.
 *
 * What they are for is the one thing a stub cannot tell you: whether a real
 * model, given these prompts, writes prose that survives this check. The
 * fallback rate they print is the measurement wave 5's exit criteria asks for,
 * on one case; `npm run author` over twenty is the real one.
 */

function key(): string | null {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const file = join(home, "Desktop", "gkey.txt");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").trim();
  return text === "" ? null : text;
}

const KEY = key();
const when = KEY ? describe : describe.skip;

when("a real model writing a real case", () => {
  it("writes it, and the check agrees with the writing", async () => {
    const built = generate(newCaseId("easy", "live1"));
    expect(built.case).not.toBeNull();
    const kase = built.case!;
    const clues = cluesToDress(kase);

    const out = await authorSkin(geminiProvider({ key: () => KEY }), kase, {
      setting: "a lighthouse on a sandbar in a winter storm, 1923",
    });

    // What it cost, printed rather than asserted: this is a measurement.
    console.log(
      `\n  ${WRITER_MODEL} wrote, ${PARSER_MODEL} checked` +
        `\n  ${out.calls} calls, ${out.skin.fidelity.verified}/${out.skin.fidelity.checked} verified` +
        `, ${out.skin.fidelity.retried} rewritten` +
        `, fallback ${(fallbackRate(out.skin.fidelity) * 100).toFixed(1)}%\n`,
    );
    for (const id of out.skin.fidelity.fallback) {
      const clue = clues.find((c) => c.id === id)!;
      console.log(`  fell back: ${id}  ${canonical(clue.body)}`);
    }

    // The case is dressed at all.
    expect(out.skin.rooms).toHaveLength(kase.frame.plan.rooms.length);
    expect(out.skin.people).toHaveLength(kase.frame.people);
    expect(out.skin.slots).toHaveLength(kase.frame.slots);
    expect(out.skin.title.length).toBeGreaterThan(0);

    // Every suspect has a motive. A cast where only one does is a leak of the
    // same family as `bank.ts#silenceLeaks`.
    for (let p = 0; p < kase.frame.suspects; p++) {
      expect([p, out.skin.people[p].motive.length > 0]).toEqual([p, true]);
    }

    // No engine id reaches the page. The writer is told this in as many
    // words, and it is the sort of instruction models half-follow.
    const glossary = skinGlossary(out.skin, kase.frame);
    for (const text of [out.skin.briefing, ...Object.values(out.skin.prose)]) {
      expect(text).not.toMatch(/\b[prt]\d+\b/);
    }
    expect(glossary.roomName(0)).not.toMatch(/^Room \d+$/);

    // And the thing actually being measured: most of it survived.
    expect(fallbackRate(out.skin.fidelity)).toBeLessThan(0.5);
  });
});
