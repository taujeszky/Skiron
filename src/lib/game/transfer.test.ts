import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { newCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import { KEY_SHAPE } from "$lib/llm/provider";
import { encodePack, packFor } from "$lib/llm/pack";
import { assembleSkin, type CaseSkin, type WriterOutput } from "$lib/llm/skin/schema";

import { loadCaseInline, useLoader } from "./cases";
import {
  exportCurrentCase,
  game,
  openCaseFile,
  panel,
  screen,
  start,
  updateSettings,
  useClock,
} from "./controller";
import { memoryStore, useStore } from "./storage";
import { exportCase, fileNameFor, importCase } from "./transfer";

const id = newCaseId("easy", "xfer1");
const built = generate(id).case!;

function skin(): CaseSkin {
  const frame = built.frame;
  const written: WriterOutput = {
    title: "The Lamp Room",
    place: "a lighthouse",
    era: "1923",
    styleGuide: "",
    rooms: Array.from({ length: frame.plan.rooms.length }, (_, r) => ({
      name: `the Room ${r}`,
      code: `R${r}`,
      description: "",
    })),
    slots: Array.from({ length: frame.slots }, (_, t) => `hour ${t}`),
    people: Array.from({ length: frame.people }, (_, p) => ({
      name: `Person ${p}`,
      role: "",
      bio: "",
      voice: "",
      motive: "a debt",
      portrait: "",
    })),
    prose: [],
    silence: Array.from({ length: frame.people }, () => "Nothing."),
    briefing: "A briefing.",
    scene: "",
  };
  return assembleSkin(written, {
    setting: "a lighthouse in a storm, 1923",
    language: "en",
    prose: {},
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    summingUp: "A speech.",
  });
}

describe("exporting a case", () => {
  it("round-trips the whole case, bank and all", () => {
    const out = exportCase(id, built, skin());
    const back = importCase(out.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    // The bank is the part that does not survive a naive `JSON.stringify`,
    // which is the whole reason the pack codec exists.
    expect(back.pack.case.bank.cards.size).toBe(built.bank.cards.size);
    expect(back.pack.case.bank.said.size).toBe(built.bank.said.size);
    expect(back.pack.case.world.culprit).toBe(built.world.culprit);
    expect(back.pack.skin!.title).toBe("The Lamp Room");
  });

  it("works for a case with no prose at all", () => {
    const out = exportCase(id, built, null);
    const back = importCase(out.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.pack.skin).toBeNull();
  });

  /*
   * Invariant 9. The key is kept out by where it lives — not in `Settings`,
   * not in a skin, not in a case — so this cannot fail today. It is here
   * because "cannot happen by construction" is exactly the claim that stops
   * being true without anybody noticing, and an exported file is the thing
   * people mail to each other.
   */
  it("carries nothing key-shaped", () => {
    const out = exportCase(id, built, skin());
    const shaped = new RegExp(KEY_SHAPE.source.replace(/^\^|\$$/g, ""), "g");
    expect(out.text.match(shaped)).toBeNull();
    expect(out.text.toLowerCase()).not.toContain("apikey");
    expect(out.text.toLowerCase()).not.toContain("skiron:key");
  });

  it("claims no pictures, because it cannot carry any", () => {
    // A pack whose images list survived the export would point the recipient
    // at files that do not exist beside their copy.
    const withArt = packFor(id, built, skin(), ["p0", "p1", "scene"]);
    expect(withArt.images).toHaveLength(3);
    const back = importCase(exportCase(id, built, skin()).text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.pack.images).toEqual([]);
  });

  it("names the file after the case and its title", () => {
    const name = fileNameFor(packFor(id, built, skin(), []));
    expect(name).toBe("SK1-E-xfer1-the-lamp-room.skiron.json");
    expect(fileNameFor(packFor(id, built, null, []))).toBe("SK1-E-xfer1.skiron.json");
  });

  it("says in the file what it is, for whoever opens it in an editor", () => {
    const file = JSON.parse(exportCase(id, built, skin()).text) as {
      skiron: string;
      note: string;
    };
    expect(file.skiron).toBe("case");
    expect(file.note).toContain("no API key");
  });
});

describe("importing a case", () => {
  it("refuses something that is not JSON", () => {
    const out = importCase("not a case");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.why).toContain("not JSON");
  });

  it("refuses JSON that is not a case", () => {
    expect(importCase('{"hello":"world"}').ok).toBe(false);
    expect(importCase("[1,2,3]").ok).toBe(false);
    expect(importCase("null").ok).toBe(false);
  });

  it("accepts a bare pack as well as the envelope", () => {
    const bare = JSON.stringify(encodePack(packFor(id, built, skin(), [])));
    expect(importCase(bare).ok).toBe(true);
  });

  /*
   * The reason `importCase` re-runs the oracle at all. A file is the one way
   * a case reaches a player without anybody having certified it: a shipped
   * pack is proved by the authoring tool and again by `shipped.test.ts`, and
   * a generated case is proved twice as it is made. This one is proved here
   * or not at all.
   */
  it("refuses a case whose recorded answer is not the one the evidence proves", () => {
    const pack = packFor(id, built, skin(), []);
    const tampered = encodePack(pack) as Record<string, unknown>;
    const kase = tampered.case as Record<string, unknown>;
    const world = { ...(kase.world as Record<string, unknown>) };
    // Name somebody else as the killer and leave every card alone.
    world.culprit = (built.world.culprit + 1) % built.frame.suspects;
    kase.world = world;

    const out = importCase(JSON.stringify(tampered));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.why).toContain("does not check out");
  });

  it("refuses a case whose recorded tier has been inflated", () => {
    const tampered = encodePack(packFor(id, built, skin(), [])) as Record<string, unknown>;
    const kase = tampered.case as Record<string, unknown>;
    kase.tier = 4;
    expect(importCase(JSON.stringify(tampered)).ok).toBe(false);
  });

  it("never quotes the file back at the player", () => {
    // `verifyPack`'s complaints can name a card id; they are for a developer.
    const tampered = encodePack(packFor(id, built, skin(), [])) as Record<string, unknown>;
    const kase = tampered.case as Record<string, unknown>;
    kase.tier = 4;
    const out = importCase(JSON.stringify(tampered));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.why).not.toMatch(/c\d+/);
  });
});

describe("a case from a file, in the game", () => {
  beforeEach(() => {
    start();
    useStore(memoryStore());
    useLoader(loadCaseInline);
    useClock(() => 1_000_000);
    game.set(null);
    screen.set("home");
    panel.set({ kind: "none" });
    updateSettings({ autoNotes: true });
  });

  it("opens on the briefing, with its prose", () => {
    const file = exportCase(id, built, skin());
    expect(openCaseFile(file.text)).toBe(true);
    expect(get(game)!.skin!.title).toBe("The Lamp Room");
    expect(get(screen)).toBe("briefing");
  });

  it("round-trips through the case on screen", () => {
    openCaseFile(exportCase(id, built, skin()).text);
    const again = exportCurrentCase()!;
    // Exporting what was just imported must give the same bytes back, or the
    // file is lossy and nobody would find out until the third hand.
    expect(again.text).toBe(exportCase(id, built, skin()).text);
  });

  it("puts a refusal on screen rather than opening anything", () => {
    expect(openCaseFile("{}")).toBe(false);
    expect(get(game)).toBeNull();
    expect(get(panel).kind).toBe("error");
  });

  it("exports nothing when there is no case", () => {
    expect(exportCurrentCase()).toBeNull();
  });
});
