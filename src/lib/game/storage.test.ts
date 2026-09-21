import { beforeEach, describe, expect, it } from "vitest";

import {
  KEYS,
  clearSave,
  loadSave,
  loadSettings,
  loadStats,
  memoryStore,
  parseSave,
  parseSettings,
  parseStats,
  saveSettings,
  saveStats,
  storageIsDurable,
  useStore,
  writeSave,
} from "./storage";
import { defaultSettings, emptyStats } from "./types";
import type { KeyValue } from "./storage";
import type { Save } from "./types";

let store: KeyValue;

beforeEach(() => {
  store = memoryStore();
  useStore(store);
});

const goodSave = (): Save => ({
  id: "SK1-N-3f9k2a",
  collected: ["c12", "c40"],
  spent: ["examine:2", "ask:1:slot:3"],
  notebook: {
    ruledOut: [
      [1, 2, 4],
      [0, 0, 0],
    ],
    clearedSuspects: 2,
    ruledOutSlots: 5,
  },
  wrong: [{ culprit: 1, slot: 2 }],
  hints: 3,
  checks: 1,
  ms: 91_000,
  solved: false,
  chat: [
    { who: 1, from: "player", text: "Where were you at nine?" },
    { who: 1, from: "suspect", text: "In the orangery, as I have said.", cards: ["c12"] },
  ],
});

describe("round trips", () => {
  it("brings a save back unchanged", () => {
    const save = goodSave();
    writeSave(save);
    expect(loadSave()).toEqual(save);
  });

  it("brings settings back unchanged", () => {
    const s = { ...defaultSettings(), theme: "dark" as const, autoNotes: false };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it("brings stats back unchanged", () => {
    const s = emptyStats();
    s.hard = {
      started: 4,
      solved: 3,
      atPar: 1,
      bestMs: 412_000,
      bestActions: 19,
      totalMs: 1_800_000,
      hints: 2,
      wrong: 1,
      streak: 2,
      bestStreak: 3,
    };
    saveStats(s);
    expect(loadStats()).toEqual(s);
  });

  it("forgets a save when asked", () => {
    writeSave(goodSave());
    clearSave();
    expect(loadSave()).toBeNull();
  });
});

/**
 * The half of persistence that matters, and the half a round-trip test cannot
 * reach. Everything below was written by some other version of Skiron, or by
 * a person with a developer console, and none of it may be trusted into the
 * game. A parser that cannot say no is not a parser.
 */
describe("what it refuses", () => {
  const reject = (value: unknown) => {
    store.set(KEYS.save, JSON.stringify(value));
    expect(loadSave()).toBeNull();
  };

  it("rejects things that are not saves at all", () => {
    reject(null);
    reject(7);
    reject("a string");
    reject([goodSave()]);
    reject({});
  });

  it("rejects unparseable text", () => {
    store.set(KEYS.save, "{not json");
    expect(loadSave()).toBeNull();
  });

  it("rejects a missing or silly case id", () => {
    reject({ ...goodSave(), id: undefined });
    reject({ ...goodSave(), id: "" });
    reject({ ...goodSave(), id: 12 });
    reject({ ...goodSave(), id: "x".repeat(64) });
  });

  it("rejects a notebook of the wrong shape", () => {
    reject({ ...goodSave(), notebook: undefined });
    reject({ ...goodSave(), notebook: { clearedSuspects: 0, ruledOutSlots: 0 } });
    reject({
      ...goodSave(),
      notebook: { ruledOut: [[1, "2"]], clearedSuspects: 0, ruledOutSlots: 0 },
    });
    reject({
      ...goodSave(),
      notebook: { ruledOut: [[1.5]], clearedSuspects: 0, ruledOutSlots: 0 },
    });
    reject({
      ...goodSave(),
      notebook: { ruledOut: [[-1]], clearedSuspects: 0, ruledOutSlots: 0 },
    });
    // More rows than any frame has people, or more columns than slots.
    reject({
      ...goodSave(),
      notebook: {
        ruledOut: Array.from({ length: 9 }, () => [0]),
        clearedSuspects: 0,
        ruledOutSlots: 0,
      },
    });
    reject({
      ...goodSave(),
      notebook: {
        ruledOut: [new Array(9).fill(0)],
        clearedSuspects: 0,
        ruledOutSlots: 0,
      },
    });
  });

  it("rejects card and action lists that are not lists of strings", () => {
    reject({ ...goodSave(), collected: "c1" });
    reject({ ...goodSave(), collected: [1, 2] });
    reject({ ...goodSave(), spent: [{ kind: "ask" }] });
  });

  it("rejects malformed accusations", () => {
    reject({ ...goodSave(), wrong: [{ culprit: 1 }] });
    reject({ ...goodSave(), wrong: [{ culprit: 99, slot: 0 }] });
    reject({ ...goodSave(), wrong: "none" });
  });

  it("rejects counters that are not counts", () => {
    reject({ ...goodSave(), hints: -1 });
    reject({ ...goodSave(), checks: "two" });
    reject({ ...goodSave(), ms: Number.NaN });
  });

  /**
   * A pack name that is present and wrong is fatal, and this is the one
   * refusal worth arguing for, because the tempting reading is the opposite.
   * Dropping it to `undefined` does not mean "we did not understand this
   * save" — it means "this is a generated case", which is a different and
   * false statement about the save in hand. `resume()` believes it and
   * rebuilds the case from the generator, which is precisely the wave-8 bug
   * `Save.pack` was added to fix: the player gets a case that looks right and
   * carries none of the prose or pictures they were reading.
   */
  it("rejects a pack name it cannot trust as a URL segment", () => {
    reject({ ...goodSave(), pack: "" });
    reject({ ...goodSave(), pack: "../../etc" });
    reject({ ...goodSave(), pack: "Starter" });
    reject({ ...goodSave(), pack: "-leading-dash" });
    reject({ ...goodSave(), pack: "a".repeat(33) });
    reject({ ...goodSave(), pack: 7 });
  });

  it("takes a save with no `solved` flag as unsolved rather than refusing it", () => {
    const { solved, ...rest } = goodSave();
    expect(solved).toBe(false);
    store.set(KEYS.save, JSON.stringify(rest));
    expect(loadSave()?.solved).toBe(false);
  });
});

/**
 * Settings and stats are read leniently on purpose, and the tests say so,
 * because "lenient" is a decision rather than an oversight: losing somebody's
 * theme over a field they have never heard of is worse than carrying a stale
 * flag around.
 */
describe("what it repairs", () => {
  it("fills in unknown or missing settings with their defaults", () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings({ theme: "puce" }).theme).toBe(defaultSettings().theme);
    expect(parseSettings({ autoNotes: "yes" }).autoNotes).toBe(
      defaultSettings().autoNotes,
    );
    expect(parseSettings({ theme: "dark", extra: 1 })).toEqual({
      ...defaultSettings(),
      theme: "dark",
    });
  });

  it("fills in missing stats rows", () => {
    const partial = parseStats({ easy: { solved: 2 } });
    expect(partial.easy.solved).toBe(2);
    expect(partial.easy.bestMs).toBeNull();
    expect(partial.expert).toEqual(emptyStats().expert);
  });

  it("drops a nonsense stat rather than carrying it", () => {
    expect(parseStats({ easy: { solved: -4 } }).easy.solved).toBe(0);
    expect(parseStats({ easy: { bestMs: "fast" } }).easy.bestMs).toBeNull();
  });

  it("still parses a save that is exactly right", () => {
    // The counterweight to everything above: a parser that says no to
    // everything would pass every test in the previous block.
    expect(parseSave(JSON.parse(JSON.stringify(goodSave())))).toEqual(goodSave());
  });

  it("carries a good pack name through, and leaves an absent one absent", () => {
    // The counterweight to the refusal above: a parser that rejected every
    // `pack` would pass that test too, and would break resuming the twelve
    // cases that ship.
    const packed = { ...goodSave(), pack: "starter" };
    expect(parseSave(JSON.parse(JSON.stringify(packed)))?.pack).toBe("starter");
    // A save written before wave 8 has no `pack` key at all, and that still
    // means what it always meant.
    expect(parseSave(JSON.parse(JSON.stringify(goodSave())))?.pack).toBeUndefined();
  });
});

describe("the backend", () => {
  it("falls back to memory and says it is not durable", () => {
    expect(useStore(null)).toBe(false);
    expect(storageIsDurable()).toBe(false);
    writeSave(goodSave());
    expect(loadSave()).toEqual(goodSave());
  });

  it("survives a backend that throws on every call", () => {
    const hostile: KeyValue = {
      get: () => {
        throw new Error("blocked");
      },
      set: () => {
        throw new Error("blocked");
      },
      remove: () => {
        throw new Error("blocked");
      },
    };
    useStore(hostile);
    expect(() => writeSave(goodSave())).not.toThrow();
    expect(() => clearSave()).not.toThrow();
    expect(loadSettings()).toEqual(defaultSettings());
    expect(loadSave()).toBeNull();
    expect(loadStats()).toEqual(emptyStats());
  });
});
