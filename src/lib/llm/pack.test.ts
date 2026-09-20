import { describe, expect, it } from "vitest";
import { formatCaseId, newCaseId } from "../engine/caseId";
import { generate, type GeneratedCase } from "../engine/generator/generate";
import {
  decodeCase,
  decodePack,
  encodeCase,
  encodePack,
  entryFor,
  packFor,
  parseManifest,
  verifyPack,
  PACK_VERSION,
} from "./pack";

function build(preset: "easy" | "hard" = "easy", seed = "pack5"): GeneratedCase {
  const out = generate(newCaseId(preset, seed));
  if (!out.case) throw new Error("the fixture case did not generate");
  return out.case;
}

const ID = newCaseId("easy", "pack5");
const CASE = build();
/** A lying case, so `alibi` — the one `Set` — is actually present. */
const LIAR = build("hard", "liar5");

/** JSON in and out, which is what a file does to it. */
const roundTrip = (kase: GeneratedCase): GeneratedCase | null =>
  decodeCase(JSON.parse(JSON.stringify(encodeCase(kase))) as unknown);

describe("the codec", () => {
  it("brings back a case that equals the one it was given", () => {
    // Deep equality on the whole object, not a spot check. A container added
    // later and forgotten would come back as `{}` — a case with an empty bank
    // and no symptom at all until somebody asked a question.
    expect(roundTrip(CASE)).toEqual(CASE);
  });

  it("brings back the three Maps as Maps, with their contents", () => {
    const back = roundTrip(CASE)!;
    expect(back.bank.said).toBeInstanceOf(Map);
    expect(back.bank.found).toBeInstanceOf(Map);
    expect(back.bank.cards).toBeInstanceOf(Map);
    expect(back.bank.cards.size).toBe(CASE.bank.cards.size);
    expect(back.bank.said.size).toBe(CASE.bank.said.size);
    expect([...back.bank.cards.keys()]).toEqual([...CASE.bank.cards.keys()]);
  });

  it("keeps the room keys numbers, which JSON would have made strings", () => {
    const back = roundTrip(CASE)!;
    for (const key of back.bank.found.keys()) expect(typeof key).toBe("number");
    for (const [room, ids] of CASE.bank.found) {
      expect(back.bank.found.get(room)).toEqual(ids);
    }
  });

  it("brings back the alibi's Set as a Set", () => {
    expect(LIAR.alibi).not.toBeNull();
    const back = roundTrip(LIAR)!;
    expect(back.alibi!.retracted).toBeInstanceOf(Set);
    expect([...back.alibi!.retracted]).toEqual([...LIAR.alibi!.retracted]);
    expect(back.alibi!.lies).toEqual(LIAR.alibi!.lies);
    expect(back).toEqual(LIAR);
  });

  it("survives a case with no alibi at all", () => {
    const plain = build("easy", "nolies");
    expect(roundTrip(plain)).toEqual(plain);
  });

  /*
   * The demonstration that the codec is load-bearing. Without it the same
   * round trip loses the bank silently — which is the paragraph in
   * `worker/protocol.ts`, made into a test.
   */
  it("is needed: plain JSON loses the bank and says nothing", () => {
    const naive = JSON.parse(JSON.stringify(CASE)) as GeneratedCase;
    expect(CASE.bank.cards.size).toBeGreaterThan(0);
    expect(naive.bank.cards).toEqual({});
    expect(typeof (naive.bank.cards as unknown as Map<string, unknown>).get).toBe("undefined");
  });

  it("refuses a case that is not one", () => {
    for (const value of [null, 3, "case", [], {}, { bank: {} }]) {
      expect(decodeCase(value)).toBeNull();
    }
  });
});

describe("a pack", () => {
  const pack = packFor(ID, CASE, null);

  it("round-trips through JSON", () => {
    const back = decodePack(JSON.parse(JSON.stringify(encodePack(pack))) as unknown);
    expect(back).not.toBeNull();
    expect(back!.id).toBe(formatCaseId(ID));
    expect(back!.case).toEqual(CASE);
  });

  it("refuses a pack from another version", () => {
    const wrong = { ...(encodePack(pack) as object), packVersion: 99 };
    expect(decodePack(wrong)).toBeNull();
  });

  it("refuses a pack whose id is not a case number", () => {
    const wrong = { ...(encodePack(pack) as object), id: "not-a-case" };
    expect(decodePack(wrong)).toBeNull();
  });

  it("drops an unreadable skin without losing the case", () => {
    const wrong = { ...(encodePack(pack) as object), skin: { schemaVersion: 99 } };
    const back = decodePack(wrong);
    expect(back).not.toBeNull();
    expect(back!.skin).toBeNull();
    expect(back!.case.bank.cards.size).toBe(CASE.bank.cards.size);
  });
});

/*
 * The plan asks for "a pack test that loads every shipped case and re-verifies
 * it: exhaustive fairness, the recorded tier, every clue has prose or a
 * template, schema valid". `verifyPack` is that test, and this is the test of
 * the test — it has to reject as well as accept.
 */
describe("verifying a pack", () => {
  it("passes a real one", () => {
    expect(verifyPack(packFor(ID, CASE, null))).toEqual([]);
    expect(verifyPack(packFor(newCaseId("hard", "liar5"), LIAR, null))).toEqual([]);
  });

  it("catches a case whose recorded answer is not the one the evidence proves", () => {
    const lying = {
      ...CASE,
      world: { ...CASE.world, culprit: (CASE.world.culprit + 1) % CASE.frame.suspects },
    };
    const problems = verifyPack(packFor(ID, lying, null));
    expect(problems.join(" ")).toContain("the case records");
  });

  it("catches a case whose recorded tier is wrong", () => {
    const mislabelled = { ...CASE, tier: CASE.tier + 1 };
    const problems = verifyPack(packFor(ID, mislabelled, null));
    expect(problems.join(" ")).toContain("the solver needed");
  });

  it("catches evidence that no longer settles it", () => {
    // Drop the proof set: the opening alone should not pin one answer.
    const gutted = { ...CASE, clues: CASE.opening };
    const problems = verifyPack(packFor(ID, gutted, null));
    expect(problems.length).toBeGreaterThan(0);
  });

  it("catches a skin that does not fit the house it is on", () => {
    const skin = {
      schemaVersion: 1,
      language: "en",
      setting: "x",
      title: "T",
      place: "",
      era: "",
      styleGuide: "",
      rooms: [{ name: "only one", code: "ON", description: "" }],
      slots: ["one"],
      people: [{ name: "A", role: "", bio: "", voice: "", motive: "", portrait: "" }],
      prose: { c99999: "prose for a card that is not here" },
      silence: [],
      briefing: "",
      scene: "",
      summingUp: null,
      fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    };
    const problems = verifyPack(packFor(ID, CASE, skin)).join(" ");
    expect(problems).toContain("rooms");
    expect(problems).toContain("people");
    expect(problems).toContain("hours");
    expect(problems).toContain("not a card in this case");
  });
});

describe("the manifest", () => {
  it("summarises a pack for the browser", () => {
    const entry = entryFor(packFor(ID, CASE, null));
    expect(entry.id).toBe(formatCaseId(ID));
    expect(entry.preset).toBe(CASE.difficulty);
    expect(entry.title).toBe(formatCaseId(ID));
  });

  it("reads back what it writes, and drops entries that are not cases", () => {
    const manifest = parseManifest({
      packVersion: PACK_VERSION,
      name: "starter",
      cases: [entryFor(packFor(ID, CASE, null)), { id: "rubbish" }, 3, null],
    });
    expect(manifest).not.toBeNull();
    expect(manifest!.cases).toHaveLength(1);
    expect(manifest!.name).toBe("starter");
  });

  it("refuses a manifest from another version", () => {
    expect(parseManifest({ packVersion: 99, name: "x", cases: [] })).toBeNull();
    expect(parseManifest(null)).toBeNull();
  });
});

describe("a pack's pictures", () => {
  const withArt = (images: string[]) => ({
    ...(encodePack(packFor(ID, CASE, null, images)) as Record<string, unknown>),
  });

  it("survives the trip to disk and back", () => {
    const back = decodePack(JSON.parse(JSON.stringify(withArt(["p0", "p1", "scene"]))));
    expect(back!.images).toEqual(["p0", "p1", "scene"]);
  });

  it("reads a pack written before wave 7 as having none", () => {
    const old = withArt([]);
    delete old.images;
    expect(decodePack(JSON.parse(JSON.stringify(old)))!.images).toEqual([]);
  });

  it("refuses a key that is not a subject", () => {
    // A key becomes a URL. This is the one place a pack file's contents reach
    // a path, so it is validated rather than trusted.
    const back = decodePack(
      JSON.parse(JSON.stringify(withArt(["p0", "../../secret", "scene/../..", "p999999"]))),
    );
    expect(back!.images).toEqual(["p0"]);
  });

  it("complains about a picture of somebody who is not in the cast", () => {
    const pack = packFor(ID, CASE, null, ["p0", `p${CASE.frame.people}`]);
    expect(verifyPack(pack).join(" ")).toContain("the cast is");
  });

  it("complains about the same picture listed twice", () => {
    expect(verifyPack(packFor(ID, CASE, null, ["p0", "p0"])).join(" ")).toContain("twice");
  });

  it("is happy with a picture of everybody and the place", () => {
    const every = [
      ...Array.from({ length: CASE.frame.people }, (_, p) => `p${p}`),
      "scene",
    ];
    expect(verifyPack(packFor(ID, CASE, null, every))).toEqual([]);
  });

  it("counts the pictures in the manifest entry", () => {
    expect(entryFor(packFor(ID, CASE, null, ["p0", "scene"])).images).toBe(2);
  });

  it("does not lose the count on the way through the manifest parser", () => {
    // The trap: `parseManifest` builds its result field by field, so a
    // `PackEntry` that grows one and is not taught there vanishes silently.
    // Same shape as `Save.chat` in wave 6 and `parseSettings` before that.
    const entry = entryFor(packFor(ID, CASE, null, ["p0", "p1", "scene"]));
    const back = parseManifest({ packVersion: PACK_VERSION, name: "p", cases: [entry] });
    expect(back!.cases[0].images).toBe(3);
  });
});
