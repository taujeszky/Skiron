import { describe, it, expect } from "vitest";
import { MAX_PEOPLE, MAX_ROOMS, MAX_SLOTS } from "../types";
import { PRESET_LETTERS } from "../caseId";
import {
  PRESETS,
  PRESET_NAMES,
  acceptsTier,
  difficultyForTier,
  difficultyLabel,
  presetFor,
} from "./difficulty";
import { MAX_TIER } from "./solve";
import type { PresetName } from "../types";

describe("presets", () => {
  it("names the same four presets as the case id does", () => {
    expect([...PRESET_NAMES].sort()).toEqual(
      (Object.keys(PRESET_LETTERS) as PresetName[]).sort(),
    );
    for (const name of PRESET_NAMES) {
      expect(presetFor(name).name).toBe(name);
      expect(difficultyLabel(name)).not.toBe("");
    }
  });

  it("stays inside the sizes the bitmasks assume", () => {
    for (const name of PRESET_NAMES) {
      const p = PRESETS[name];
      expect(p.rooms).toBeLessThanOrEqual(MAX_ROOMS);
      expect(p.slots).toBeLessThanOrEqual(MAX_SLOTS);
      // People is suspects plus the victim.
      expect(p.suspects + 1).toBeLessThanOrEqual(MAX_PEOPLE);
      expect(p.suspects).toBeGreaterThanOrEqual(3);
    }
  });

  it("gets harder in every direction, or at least no easier", () => {
    let last = PRESETS.easy;
    for (const name of PRESET_NAMES.slice(1)) {
      const p = PRESETS[name];
      expect(p.suspects).toBeGreaterThanOrEqual(last.suspects);
      expect(p.rooms).toBeGreaterThanOrEqual(last.rooms);
      expect(p.slots).toBeGreaterThanOrEqual(last.slots);
      expect(p.tier.max).toBeGreaterThan(last.tier.max);
      last = p;
    }
  });

  it("turns lying on exactly for Hard and Expert", () => {
    expect(PRESETS.easy.lying).toBe(false);
    expect(PRESETS.normal.lying).toBe(false);
    expect(PRESETS.hard.lying).toBe(true);
    expect(PRESETS.expert.lying).toBe(true);
    // Tier 3 is the trust tier and it sits out truthful cases, so a preset
    // that asked for tier 3 without lying could never be satisfied.
    for (const name of PRESET_NAMES) {
      const p = PRESETS[name];
      if (p.tier.max >= 3) expect(p.lying).toBe(true);
    }
  });

  it("asks for nothing the solver cannot grade", () => {
    for (const name of PRESET_NAMES) {
      const p = PRESETS[name];
      expect(p.tier.min).toBeGreaterThanOrEqual(0);
      expect(p.tier.max).toBeLessThanOrEqual(MAX_TIER);
      expect(p.tier.min).toBeLessThanOrEqual(p.tier.max);
    }
  });
});

describe("tier to name", () => {
  it("follows the plan's table, and is total", () => {
    expect(difficultyForTier(-1)).toBe("easy");
    expect(difficultyForTier(0)).toBe("easy");
    expect(difficultyForTier(1)).toBe("easy");
    expect(difficultyForTier(2)).toBe("normal");
    expect(difficultyForTier(3)).toBe("hard");
    expect(difficultyForTier(4)).toBe("expert");
    // Above the top tier it stays Expert rather than falling off the table.
    expect(difficultyForTier(MAX_TIER + 1)).toBe("expert");
  });

  it("accepts a case one tier below what was asked for, and no lower", () => {
    // "Asking for Expert may legitimately return a Hard case" — the actual
    // tier is what the UI shows, so the band is a request and not a promise.
    expect(acceptsTier(PRESETS.expert, 4)).toBe(true);
    expect(acceptsTier(PRESETS.expert, 3)).toBe(true);
    expect(acceptsTier(PRESETS.expert, 2)).toBe(false);
    expect(acceptsTier(PRESETS.easy, 1)).toBe(true);
    expect(acceptsTier(PRESETS.easy, 2)).toBe(false);
    // A case nothing could be deduced from is never acceptable.
    for (const name of PRESET_NAMES) {
      expect(acceptsTier(PRESETS[name], -1)).toBe(false);
    }
  });
});
