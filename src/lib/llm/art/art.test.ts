import { describe, expect, it } from "vitest";
import { LlmError } from "../errors";
import type { ImageCall, ImageResult, Provider } from "../provider";
import { estimateArt, generateArt } from "./art";
import { SCENE_KEY, type ArtMaterial, type ArtSubject } from "./prompts";

function subject(key: string, aspect = "1:1"): ArtSubject {
  return { key, prompt: `PROMPT-${key}`, aspect, label: key };
}

const MATERIAL: ArtMaterial = {
  styleGuide: "a style",
  place: "a lighthouse",
  era: "1923",
  // Scene deliberately first, so "portraits first" has something to reorder.
  subjects: [subject(SCENE_KEY, "16:9"), subject("p0"), subject("p1"), subject("p2")],
};

const BYTES = new Uint8Array([1, 2, 3]);
const IMAGE: ImageResult = { mime: "image/png", bytes: BYTES };

/** Records every call and answers from a script keyed by prompt. */
function imageStub(answer: (call: ImageCall, n: number) => ImageResult | LlmError): Provider & {
  calls: ImageCall[];
} {
  const calls: ImageCall[] = [];
  return {
    name: "stub",
    calls,
    generateJSON: async () => ({}),
    generateImage: async (call) => {
      calls.push(call);
      const out = answer(call, calls.length - 1);
      if (out instanceof LlmError) throw out;
      return out;
    },
  };
}

/** The subject a built prompt is for: its first line is the writer's own. */
const subjectOf = (call: ImageCall) => call.prompt.split(/\r?\n/)[0];

describe("the estimate", () => {
  it("counts one call per subject and makes none", () => {
    const provider = imageStub(() => IMAGE);
    const out = estimateArt(MATERIAL, "fast");
    expect(out.calls).toBe(4);
    expect(out.cost).toBeCloseTo(4 * 0.045, 6);
    expect(provider.calls).toHaveLength(0);
  });

  it("is zero calls and zero money when art is off", () => {
    expect(estimateArt(MATERIAL, "off")).toEqual({ calls: 0, cost: 0 });
  });

  it("does not count what is already stored", () => {
    const have = (key: string) => key === "p0" || key === "p1";
    expect(estimateArt(MATERIAL, "fast", have).calls).toBe(2);
  });

  it("charges more at a higher quality, which is the whole point of the setting", () => {
    expect(estimateArt(MATERIAL, "balanced").cost).toBeGreaterThan(
      estimateArt(MATERIAL, "fast").cost,
    );
  });
});

describe("the run", () => {
  it("makes no call at all when art is off", async () => {
    const provider = imageStub(() => IMAGE);
    const out = await generateArt(provider, MATERIAL, { quality: "off" });
    expect(provider.calls).toHaveLength(0);
    expect(out.calls).toBe(0);
    expect(out.images.size).toBe(0);
  });

  it("does the portraits before the scene", async () => {
    const provider = imageStub(() => IMAGE);
    await generateArt(provider, MATERIAL, { quality: "fast" });
    const order = provider.calls.map(subjectOf);
    // The material lists the scene first; a face is attached to somebody the
    // player is about to question, so it goes first anyway.
    expect(order).toEqual(["PROMPT-p0", "PROMPT-p1", "PROMPT-p2", "PROMPT-scene"]);
  });

  it("passes the quality's model, size and the subject's aspect", async () => {
    const provider = imageStub(() => IMAGE);
    await generateArt(provider, MATERIAL, { quality: "balanced" });
    expect(provider.calls[0].model).toBe("gemini-3.1-flash-image");
    expect(provider.calls[0].size).toBe("2K");
    expect(provider.calls[0].aspect).toBe("1:1");
    expect(provider.calls.at(-1)!.aspect).toBe("16:9");
  });

  it("keeps going when one image is blocked, and says which", async () => {
    // The difference from the writer, which abandons a whole skin on one
    // failure: half a cast with faces is fine, half a cast with names is not.
    const provider = imageStub((call) =>
      subjectOf(call) === "PROMPT-p1" ? new LlmError("blocked", "refused") : IMAGE,
    );
    const out = await generateArt(provider, MATERIAL, { quality: "fast" });
    expect(out.images.size).toBe(3);
    expect(out.images.has("p1")).toBe(false);
    expect(out.failed).toEqual([{ key: "p1", reason: "refused" }]);
    expect(out.calls).toBe(4);
  });

  it("hands each image over the moment it exists", async () => {
    const seen: string[] = [];
    const provider = imageStub(() => IMAGE);
    await generateArt(provider, MATERIAL, {
      quality: "fast",
      onImage: (key) => void seen.push(key),
    });
    // Not a finished set at the end: portraits arrive over tens of seconds
    // and the player is already reading the briefing.
    expect(seen).toEqual(["p0", "p1", "p2", SCENE_KEY]);
  });

  it("reports progress to the end even when images fail", async () => {
    const provider = imageStub((call) =>
      subjectOf(call) === "PROMPT-p0" ? new LlmError("quota", "slow down") : IMAGE,
    );
    const ticks: [number, number][] = [];
    await generateArt(provider, MATERIAL, {
      quality: "fast",
      onProgress: (done, of) => void ticks.push([done, of]),
    });
    expect(ticks).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it("skips what is already stored, so a resume does not pay twice", async () => {
    const provider = imageStub(() => IMAGE);
    const out = await generateArt(provider, MATERIAL, {
      quality: "fast",
      have: (key) => key === "p0" || key === SCENE_KEY,
    });
    expect(provider.calls.map(subjectOf)).toEqual(["PROMPT-p1", "PROMPT-p2"]);
    expect(out.calls).toBe(2);
  });

  it("stops on a cancel without recording a failure", async () => {
    const controller = new AbortController();
    const provider = imageStub((call) => {
      if (subjectOf(call) === "PROMPT-p1") {
        controller.abort();
        return new LlmError("cancelled", "cancelled");
      }
      return IMAGE;
    });
    const out = await generateArt(provider, MATERIAL, {
      quality: "fast",
      signal: controller.signal,
    });
    expect(out.images.size).toBe(1);
    // A cancel is the player asking for the waiting to stop, not an image
    // that went wrong: nothing to report and nothing to retry.
    expect(out.failed).toEqual([]);
  });

  it("sends no reference image unless asked", async () => {
    const provider = imageStub(() => IMAGE);
    await generateArt(provider, MATERIAL, { quality: "fast" });
    expect(provider.calls.every((c) => c.reference === undefined)).toBe(true);
  });

  it("sends the first portrait as the reference when asked, and never the scene", async () => {
    const provider = imageStub(() => IMAGE);
    await generateArt(provider, MATERIAL, { quality: "fast", reference: true });
    expect(provider.calls[0].reference).toBeUndefined();
    expect(provider.calls[1].reference).toBe(IMAGE);
    expect(provider.calls[3].reference).toBe(IMAGE);
  });
});
