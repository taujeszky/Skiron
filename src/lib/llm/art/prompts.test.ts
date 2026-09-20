import { describe, expect, it } from "vitest";
import type { CaseSkin } from "../skin/schema";
import { SKIN_SCHEMA_VERSION } from "../skin/schema";
import {
  artMaterial,
  artPrompts,
  buildImagePrompt,
  FORBIDDEN,
  HOUSE_STYLE,
  isPortraitKey,
  keyPerson,
  portraitKey,
  SCENE_KEY,
  type ArtMaterial,
} from "./prompts";

/** Names and prompts chosen so a missed substitution is obvious in a diff. */
function skinFor(people: number, overrides: Partial<CaseSkin> = {}): CaseSkin {
  return {
    schemaVersion: SKIN_SCHEMA_VERSION,
    language: "en",
    setting: "a lighthouse in a storm, 1923",
    title: "The Lamp Room",
    place: "a lighthouse on a sandbar",
    era: "1923",
    styleGuide: "STYLE-GUIDE-SENTENCE",
    rooms: [],
    slots: [],
    people: Array.from({ length: people }, (_, p) => ({
      name: `Person ${p}`,
      role: "",
      bio: "",
      voice: "",
      motive: "",
      portrait: `PORTRAIT-PROMPT-${p}`,
    })),
    prose: {},
    silence: [],
    briefing: "",
    scene: "SCENE-PROMPT",
    summingUp: "It was Person 0, at nine o'clock.",
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    ...overrides,
  };
}

const MATERIAL: ArtMaterial = artMaterial(skinFor(4), { victim: 3 });

describe("the keys", () => {
  it("round-trips a person", () => {
    expect(keyPerson(portraitKey(5))).toBe(5);
    expect(isPortraitKey(portraitKey(0))).toBe(true);
  });

  it("does not mistake the scene for a person", () => {
    expect(isPortraitKey(SCENE_KEY)).toBe(false);
    expect(keyPerson(SCENE_KEY)).toBeNull();
  });
});

describe("the material", () => {
  it("has one subject per person plus the scene", () => {
    expect(MATERIAL.subjects.map((s) => s.key)).toEqual(["p0", "p1", "p2", "p3", "scene"]);
  });

  it("frames a face square and a place wide", () => {
    expect(MATERIAL.subjects.find((s) => s.key === "p0")!.aspect).toBe("1:1");
    expect(MATERIAL.subjects.find((s) => s.key === SCENE_KEY)!.aspect).toBe("16:9");
  });

  it("skips a person the writer gave no portrait prompt", () => {
    const skin = skinFor(3);
    skin.people[1].portrait = "   ";
    const keys = artMaterial(skin).subjects.map((s) => s.key);
    // A blank prompt would buy a picture of nothing at the same price as a
    // good one. The monogram is the better answer and it is free.
    expect(keys).toEqual(["p0", "p2", "scene"]);
  });

  it("drops the victim when asked, which is one of the levers on a batch", () => {
    const keys = artMaterial(skinFor(4), { suspectsOnly: true, victim: 3 }).subjects.map(
      (s) => s.key,
    );
    expect(keys).toEqual(["p0", "p1", "p2", "scene"]);
  });

  it("drops the scene when asked, which is the other one", () => {
    const keys = artMaterial(skinFor(4), { noScene: true }).subjects.map((s) => s.key);
    expect(keys).toEqual(["p0", "p1", "p2", "p3"]);
  });
});

describe("the prompt", () => {
  const portrait = buildImagePrompt(MATERIAL, MATERIAL.subjects[0]);
  const scene = buildImagePrompt(MATERIAL, MATERIAL.subjects[4]);

  it("carries the writer's own prompt first", () => {
    // Leading clause, because that is what a diffusion model weights most.
    expect(portrait.startsWith("PORTRAIT-PROMPT-0")).toBe(true);
    expect(scene.startsWith("SCENE-PROMPT")).toBe(true);
  });

  it("carries the style guide", () => {
    expect(portrait).toContain("STYLE-GUIDE-SENTENCE");
    expect(scene).toContain("STYLE-GUIDE-SENTENCE");
  });

  it("carries the house treatment, so cases look like one game", () => {
    expect(portrait).toContain(HOUSE_STYLE);
    expect(scene).toContain(HOUSE_STYLE);
  });

  it("carries every prohibition, in every prompt", () => {
    for (const rule of FORBIDDEN) {
      expect(portrait).toContain(rule);
      expect(scene).toContain(rule);
    }
  });

  it("forbids text explicitly — the plan's own test", () => {
    expect(portrait.toLowerCase()).toContain("no text of any kind");
  });

  it("puts the prohibitions last", () => {
    // "No blood" early in a prompt is a good way to get blood.
    expect(portrait.indexOf(FORBIDDEN[0])).toBeGreaterThan(portrait.indexOf(HOUSE_STYLE));
  });

  it("asks for exactly one person in a portrait", () => {
    // Two figures in a frame is a claim about who was with whom, which is the
    // whole subject of the game.
    expect(portrait).toContain("Exactly one person in the frame");
  });

  it("asks for nobody at all in the scene", () => {
    // A person shown at a place is a placement, and placements are earned.
    expect(scene).toContain("No people anywhere in the frame");
    expect(scene).not.toContain("Exactly one person");
  });
});

describe("what an image prompt cannot contain", () => {
  it("never carries the summing-up, which names the killer", () => {
    // The skin fixture's `summingUp` says "It was Person 0, at nine o'clock".
    // `ArtMaterial` has no field it could travel in — this asserts the
    // consequence, and the type is what actually enforces it.
    const all = artPrompts(MATERIAL).map((j) => j.prompt).join("\n");
    expect(all).not.toContain("It was Person 0");
    expect(all).not.toContain("nine o'clock");
    expect(Object.keys(MATERIAL)).not.toContain("summingUp");
  });

  it("does not move when the summing-up changes", () => {
    // The stronger form: rewrite the one piece of skin prose that knows the
    // answer and every prompt must be byte-identical. The same shape of test
    // `prompts.test.ts` uses on the writer, for the same reason.
    const before = artPrompts(artMaterial(skinFor(4), { victim: 3 })).map((j) => j.prompt);
    const other = skinFor(4, { summingUp: "It was Person 2, at eleven o'clock." });
    const after = artPrompts(artMaterial(other, { victim: 3 })).map((j) => j.prompt);
    expect(after).toEqual(before);
  });

  it("does not carry the prose of any card", () => {
    const withProse = skinFor(4, { prose: { c0: "CARD-PROSE-ZERO" } });
    const all = artPrompts(artMaterial(withProse)).map((j) => j.prompt).join("\n");
    expect(all).not.toContain("CARD-PROSE-ZERO");
  });
});
