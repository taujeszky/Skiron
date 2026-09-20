import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { formatCaseId, newCaseId } from "$lib/engine/caseId";
import { defaultGlossary } from "$lib/engine/solver/explain";
import { memorySkins, parseSkin, useSkins, type SkinStore } from "$lib/llm/skinStore";
import { assembleSkin, type CaseSkin, type WriterOutput } from "$lib/llm/skin/schema";

import { loadCaseInline, useLoader } from "./cases";
import {
  errors,
  explain,
  game,
  glossary,
  newCase,
  openCaseText,
  panel,
  screen,
  start,
  summingUp,
  topicsFor,
  updateSettings,
  useClock,
} from "./controller";
import { memoryStore, useStore } from "./storage";

let store: SkinStore;

beforeEach(() => {
  start();
  useStore(memoryStore());
  useLoader(loadCaseInline);
  useClock(() => 1_000_000);
  store = memorySkins();
  useSkins(store);
  game.set(null);
  screen.set("home");
  panel.set({ kind: "none" });
  updateSettings({ autoNotes: true });
});

/** A skin whose names are unmistakable, so a missed call site is obvious. */
function skinFor(rooms: number, slots: number, people: number, prose: Record<string, string> = {}): CaseSkin {
  const written: WriterOutput = {
    title: "The Lamp Room",
    place: "a lighthouse on a sandbar",
    era: "1923",
    styleGuide: "salt light",
    rooms: Array.from({ length: rooms }, (_, r) => ({
      name: `THE-ROOM-${r}`,
      code: `Z${r}`,
      description: "",
    })),
    slots: Array.from({ length: slots }, (_, t) => `THE-HOUR-${t}`),
    people: Array.from({ length: people }, (_, p) => ({
      name: `THE-PERSON-${p}`,
      role: "",
      bio: "",
      voice: "",
      motive: "a debt",
      portrait: "",
    })),
    prose: [],
    silence: Array.from({ length: people }, () => "Nothing to say."),
    briefing: "THE-BRIEFING",
    scene: "",
  };
  return assembleSkin(written, {
    setting: "a lighthouse in a storm, 1923",
    language: "en",
    prose,
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    summingUp: "THE-SPEECH",
  });
}

async function dressedCase(prose: Record<string, string> = {}) {
  const id = newCaseId("easy", "dress1");
  // Put a skin in the store first: `dressCase` reads it before it would ever
  // reach for a model, which is also how a resumed case gets its names back
  // with no key in the browser at all.
  const probe = await (async () => {
    await openCaseText(formatCaseId(id));
    const g = get(game)!;
    return { rooms: g.case.frame.plan.rooms.length, slots: g.case.frame.slots, people: g.case.frame.people };
  })();
  await store.put(formatCaseId(id), skinFor(probe.rooms, probe.slots, probe.people, prose));
  game.set(null);
  await openCaseText(formatCaseId(id));
  return get(game)!;
}

describe("a case with no skin", () => {
  it("speaks in the engine's placeholder names", async () => {
    await newCase("easy");
    const g = get(game)!;
    expect(g.skin).toBeNull();
    expect(get(glossary)!.roomName(0)).toBe(defaultGlossary(g.case.frame).roomName(0));
  });
});

describe("a case with a skin", () => {
  it("is picked up from the store when the case is opened", async () => {
    const g = await dressedCase();
    expect(g.skin).not.toBeNull();
    expect(g.skin!.title).toBe("The Lamp Room");
  });

  /*
   * The point of task 7. Each of these was its own `defaultGlossary(frame)`
   * call before this wave, and any one of them left behind would have shown
   * the player "Suspect C" beside cards naming Mrs Pellworth.
   */
  it("uses the skin's names everywhere a name is written", async () => {
    const g = await dressedCase();
    const frame = g.case.frame;

    // the glossary store
    expect(get(glossary)!.roomName(0)).toBe("THE-ROOM-0");
    expect(get(glossary)!.slotLabel(0)).toBe("THE-HOUR-0");
    expect(get(glossary)!.personName(0)).toBe("THE-PERSON-0");
    expect(get(glossary)!.roomCode(0)).toBe("Z0");

    // the explainer, which every card, hint and step goes through
    expect(get(explain)!.glossary.roomName(1)).toBe("THE-ROOM-1");

    // the card sentences
    const sentences = get(explain)!;
    for (const clue of g.case.opening) {
      const text = sentences.clue(clue);
      expect(text).not.toMatch(/Room \d|Suspect [A-H]|slot \d/);
    }

    // the summing-up
    for (const line of get(summingUp)) {
      expect(line).not.toMatch(/Room \d|Suspect [A-H]|slot \d/);
    }

    // the topic list — the one call site whose signature had to change
    const labels = topicsFor(frame, 0, get(glossary)!).map((t) => t.label);
    expect(labels).toContain("THE-HOUR-0");
    expect(labels).toContain("THE-ROOM-0");
  });

  it("names the victim, whom the plain glossary leaves anonymous", async () => {
    const g = await dressedCase();
    expect(get(glossary)!.personName(g.case.frame.victim)).toBe(
      `THE-PERSON-${g.case.frame.victim}`,
    );
  });

  it("uses the skin's names in notebook errors too", async () => {
    const g = await dressedCase();
    // No errors is fine; what matters is that any that appear are dressed.
    for (const error of get(errors)) {
      expect(error.text).not.toMatch(/Room \d|Suspect [A-H]|slot \d/);
    }
    expect(g.skin).not.toBeNull();
  });
});

describe("verified prose on the cards", () => {
  it("replaces the engine's sentence for the clues that have it", async () => {
    const first = (await dressedCase()).case.opening[0];
    const g = await dressedCase({ [first.id]: "THE-PROSE-FOR-THIS-CARD" });
    const ex = get(explain)!;
    expect(ex.clue(g.case.opening[0])).toBe("THE-PROSE-FOR-THIS-CARD");
    expect(ex.isTemplate(g.case.opening[0])).toBe(false);
  });

  it("falls back to the template for the clues that do not", async () => {
    const g = await dressedCase();
    const clue = g.case.opening[0];
    const ex = get(explain)!;
    expect(ex.isTemplate(clue)).toBe(true);
    // Still a real sentence, in the skin's names — the fallback is the point
    // of invariant 6 and must not look like a hole.
    expect(ex.clue(clue).length).toBeGreaterThan(10);
  });

  it("never lets blank prose through as a card with nothing on it", async () => {
    const first = (await dressedCase()).case.opening[0];
    const g = await dressedCase({ [first.id]: "   " });
    expect(get(explain)!.clue(g.case.opening[0]).trim().length).toBeGreaterThan(10);
  });
});

describe("reading a stored skin back", () => {
  const good = skinFor(3, 4, 4);

  it("accepts one it wrote itself", () => {
    expect(parseSkin(JSON.parse(JSON.stringify(good)))).not.toBeNull();
  });

  it("refuses one from another schema version", () => {
    expect(parseSkin({ ...good, schemaVersion: 99 })).toBeNull();
    expect(parseSkin({ ...good, schemaVersion: undefined })).toBeNull();
  });

  it("refuses rubbish rather than half-reading it", () => {
    for (const value of [null, 3, "skin", [], {}, { ...good, rooms: "no" }]) {
      expect(parseSkin(value)).toBeNull();
    }
  });

  it("refuses prose under a key that is not a clue id", () => {
    // A stored map arrives from disk, so its keys are whatever was written
    // there. `__proto__` has to come through `JSON.parse` to be a real own
    // property — written as an object literal it would set the prototype and
    // never reach the validator at all, which is a trap in the test rather
    // than in the code.
    const polluted = JSON.parse('{"__proto__":"x","c1":"fine"}') as Record<string, string>;
    expect(parseSkin({ ...good, prose: polluted })).toBeNull();
    expect(parseSkin({ ...good, prose: { notAnId: "x" } })).toBeNull();
    expect(parseSkin({ ...good, prose: { c3: "fine" } })).not.toBeNull();
  });

  it("fills in what it can and drops what it cannot", () => {
    const patchy = parseSkin({ ...good, summingUp: 42, briefing: undefined, silence: "no" });
    expect(patchy).not.toBeNull();
    expect(patchy!.summingUp).toBeNull();
    expect(patchy!.briefing).toBe("");
    expect(patchy!.silence).toEqual([]);
  });
});
