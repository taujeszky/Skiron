/**
 * The tests that spend money, and the only ones that can tell whether
 * `gemini.ts#generateImage` works at all.
 *
 * **Excluded from `npm test` by `vitest.config.ts`, not merely absent from
 * it.** The name ends in `.test.ts`, so the include pattern matches it; the
 * `exclude` line is what stops `npm test` making these calls, and it is a
 * spending guard rather than tidiness. An image call costs roughly a hundred
 * times what a text call does, so this file is the most expensive thing in
 * the repository per run: about $0.14 at the cheapest quality.
 *
 * Run with `npm run test:live`, and only after asking the owner.
 *
 * What is worth paying to learn here, and nothing else:
 *
 * 1. Does the call work at all? Until this has run, `generateImage` is a
 *    draft — written from `../catalog-art/api.mjs`, translated from REST to
 *    the SDK, and never executed. Its own comment says so.
 * 2. Does the model refuse a portrait? `personGeneration` is a real safety
 *    setting on this API, and a model that will not draw faces would take
 *    the whole wave with it — better to find out for one image than for 84.
 * 3. Does `imageSize` do anything? The price depends on it, and the pricing
 *    page does not say which resolution costs which.
 *
 * What is *not* tested here is whether the picture is any good, or whether
 * it obeyed the prohibitions. Nothing automated can judge that — that is the
 * whole reason `art/prompts.ts` exists — so it is a job for eyes, and
 * `npm run author -- --art` is what produces files to look at.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { geminiProvider } from "../gemini";
import { imageGrade } from "../models";
import { buildImagePrompt, type ArtMaterial, type ArtSubject } from "./prompts";

/** Same order as `tools/author-case.mjs`. Never logged, never written. */
function loadKey(): string | null {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const fallback = join(home, "Desktop", "gkey.txt");
  const key = (
    process.env.GEMINI_API_KEY ||
    (existsSync(fallback) ? readFileSync(fallback, "utf8") : "")
  ).trim();
  return /^AIza[\w-]{30,}$/.test(key) ? key : null;
}

const KEY = loadKey();
const OUT = "tools/_artproof";

const MATERIAL: ArtMaterial = {
  styleGuide: "Cold north-sea light, heavy oilskins, the palette of a winter harbour.",
  place: "a lighthouse on a sandbar",
  era: "1923",
  subjects: [],
};

const FACE: ArtSubject = {
  key: "p0",
  prompt: "A weathered lighthouse keeper in his fifties, grey beard, heavy knitted jersey.",
  aspect: "1:1",
  label: "the keeper",
};

const PLACE: ArtSubject = {
  key: "scene",
  prompt: "A lighthouse on a sandbar at dusk in a winter storm, seen from the water.",
  aspect: "16:9",
  label: "the lighthouse",
};

/** PNG, JPEG and WebP magic numbers, so "it returned bytes" means something. */
function looksLikeImage(bytes: Uint8Array): boolean {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  return png || jpeg || webp;
}

function keep(name: string, mime: string, bytes: Uint8Array): void {
  mkdirSync(OUT, { recursive: true });
  const ext = mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : "png";
  // Written so a human can look at them, which is the only check that can
  // judge whether the prohibitions were obeyed.
  writeFileSync(join(OUT, `${name}.${ext}`), bytes);
}

describe.runIf(KEY)("one real image", () => {
  const provider = geminiProvider({ key: () => KEY, timeoutMs: 120_000 });
  const grade = imageGrade("fast");

  it("comes back as actual image bytes", { timeout: 180_000 }, async () => {
    // The first call ever made through this path. If it fails, everything
    // above the seam is fine and this one function is wrong.
    const out = await provider.generateImage({
      prompt: buildImagePrompt(MATERIAL, PLACE),
      model: grade.model!,
      aspect: PLACE.aspect,
      size: grade.size,
    });
    expect(out.mime.startsWith("image/")).toBe(true);
    expect(looksLikeImage(out.bytes)).toBe(true);
    // A refusal can come back as a tiny valid image rather than as an error.
    expect(out.bytes.length).toBeGreaterThan(10_000);
    keep("scene", out.mime, out.bytes);
  });

  it("will draw a face", { timeout: 180_000 }, async () => {
    // `personGeneration` is a documented safety control on this API. A model
    // that refuses portraits would take 72 of the pack's 84 pictures with it,
    // and finding that out here costs one image instead of a batch.
    const out = await provider.generateImage({
      prompt: buildImagePrompt(MATERIAL, FACE),
      model: grade.model!,
      aspect: FACE.aspect,
      size: grade.size,
    });
    expect(looksLikeImage(out.bytes)).toBe(true);
    expect(out.bytes.length).toBeGreaterThan(10_000);
    keep("portrait", out.mime, out.bytes);
  });
});
