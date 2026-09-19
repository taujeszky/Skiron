import { describe, it, expect } from "vitest";
import {
  CASE_ID_VERSION,
  PRESET_LETTERS,
  formatCaseId,
  newCaseId,
  parseCaseId,
  presetForLetter,
  seedFor,
} from "./caseId";
import type { CaseId } from "./caseId";
import type { PresetName } from "./types";

const PRESETS: PresetName[] = ["easy", "normal", "hard", "expert"];

describe("preset letters", () => {
  it("gives every preset its own letter", () => {
    const letters = PRESETS.map((p) => PRESET_LETTERS[p]);
    expect(letters).toEqual(["E", "N", "H", "X"]);
    expect(new Set(letters).size).toBe(PRESETS.length);
  });

  it("round-trips through presetForLetter, either case", () => {
    for (const p of PRESETS) {
      expect(presetForLetter(PRESET_LETTERS[p])).toBe(p);
      expect(presetForLetter(PRESET_LETTERS[p].toLowerCase())).toBe(p);
    }
    expect(presetForLetter("Q")).toBeNull();
    expect(presetForLetter("")).toBeNull();
  });
});

describe("formatCaseId", () => {
  it("writes the documented shape", () => {
    const id: CaseId = { version: 1, preset: "normal", seed: "3f9k2a" };
    expect(formatCaseId(id)).toBe("SK1-N-3f9k2a");
  });

  it("uses the letter of each preset", () => {
    expect(formatCaseId({ version: 1, preset: "easy", seed: "a" })).toBe(
      "SK1-E-a",
    );
    expect(formatCaseId({ version: 2, preset: "expert", seed: "zzz" })).toBe(
      "SK2-X-zzz",
    );
  });

  it("refuses to write an id that could not be read back", () => {
    expect(() =>
      formatCaseId({ version: 1, preset: "normal", seed: "" }),
    ).toThrow();
    expect(() =>
      formatCaseId({ version: 1, preset: "normal", seed: "ABC" }),
    ).toThrow();
    expect(() =>
      formatCaseId({ version: 1, preset: "normal", seed: "a-b" }),
    ).toThrow();
    expect(() =>
      formatCaseId({ version: 1, preset: "normal", seed: "abcdefghijklm" }),
    ).toThrow();
    expect(() =>
      formatCaseId({ version: 0, preset: "normal", seed: "abc" }),
    ).toThrow();
    // A preset name from outside the union, which only a cast can produce.
    const bogus = "tricky" as unknown as PresetName;
    expect(() =>
      formatCaseId({ version: 1, preset: bogus, seed: "abc" }),
    ).toThrow();
  });
});

describe("parseCaseId", () => {
  it("round-trips every preset and seed length", () => {
    const seeds = ["a", "0", "3f9k2a", "abcdefghijkl"];
    for (const preset of PRESETS) {
      for (const seed of seeds) {
        const id: CaseId = { version: CASE_ID_VERSION, preset, seed };
        expect(parseCaseId(formatCaseId(id))).toEqual(id);
      }
    }
  });

  it("tolerates case and surrounding whitespace", () => {
    const want: CaseId = { version: 1, preset: "hard", seed: "3f9k2a" };
    expect(parseCaseId("SK1-H-3f9k2a")).toEqual(want);
    expect(parseCaseId("sk1-h-3F9K2A")).toEqual(want);
    expect(parseCaseId("  \t SK1-h-3f9k2A \n ")).toEqual(want);
  });

  it("parses an id from a future codec version", () => {
    // So the app can say "that case is from a newer Skiron" instead of
    // "that is not a case id".
    expect(parseCaseId("SK7-N-abc")).toEqual({
      version: 7,
      preset: "normal",
      seed: "abc",
    });
  });

  it("returns null on anything malformed", () => {
    const bad = [
      "",
      "   ",
      "SK1-N-",
      "SK1--3f9k2a",
      "-N-3f9k2a",
      "SK-N-3f9k2a",
      "SK1-Q-3f9k2a",
      "SK0-N-3f9k2a",
      "SK01-N-3f9k2a",
      "SK1000-N-3f9k2a",
      "SK1-N-abcdefghijklm",
      "SK1-NN-3f9k2a",
      "SK1N-3f9k2a",
      "SK1-N-3f9k2a-extra",
      "SK1-N-3f9k!a",
      "SK1 - N - 3f9k2a",
      "SK1-N-3f9 k2a",
      "XK1-N-3f9k2a",
      "SK1_N_3f9k2a",
      "3f9k2a",
    ];
    for (const text of bad) {
      expect(parseCaseId(text), text).toBeNull();
    }
  });
});

describe("seedFor", () => {
  it("pins the exact seed string", () => {
    // If this test fails, the RNG is about to be fed something new and every
    // shared id and shipped case pack would rebuild into a different case.
    // Bump CASE_ID_VERSION deliberately or put the format back.
    const id: CaseId = { version: 1, preset: "normal", seed: "3f9k2a" };
    expect(seedFor(id, 0)).toBe("1:normal:3f9k2a:0");
    expect(seedFor(id, 17)).toBe("1:normal:3f9k2a:17");
    expect(seedFor({ version: 1, preset: "expert", seed: "0" }, 3)).toBe(
      "1:expert:0:3",
    );
  });

  it("gives a different string for every part that differs", () => {
    const base: CaseId = { version: 1, preset: "normal", seed: "abc" };
    const seen = new Set<string>([
      seedFor(base, 0),
      seedFor(base, 1),
      seedFor({ ...base, seed: "abd" }, 0),
      seedFor({ ...base, preset: "hard" }, 0),
      seedFor({ ...base, version: 2 }, 0),
    ]);
    expect(seen.size).toBe(5);
  });
});

describe("newCaseId", () => {
  it("stamps the current version and the asked-for preset", () => {
    for (const preset of PRESETS) {
      const id = newCaseId(preset);
      expect(id.version).toBe(CASE_ID_VERSION);
      expect(id.preset).toBe(preset);
    }
  });

  it("always produces a seed that survives a round trip", () => {
    for (let i = 0; i < 500; i++) {
      const id = newCaseId("normal");
      expect(parseCaseId(formatCaseId(id))).toEqual(id);
    }
  });
});
