/**
 * Generating a case's pictures, one at a time, in the background.
 *
 * Three things about the shape of this, all of which follow from the same
 * rule: **the game never waits on an image.**
 *
 * - **Every failure is per-image and local.** A blocked portrait, a timeout, a
 *   quota refusal: each costs one face, and the rest of the run carries on.
 *   Contrast `skin/author.ts`, where a failed writer call sensibly abandons
 *   the whole skin, because half a cast with names and half without would be
 *   worse than none. Half a cast with faces is fine — the others are
 *   monograms, which is what every case looked like through wave 6.
 * - **`onImage` fires as each one lands**, rather than the run returning a
 *   finished set. Portraits arrive over tens of seconds and the player is
 *   already reading the briefing; a cast strip that fills in one face at a
 *   time is the honest rendering of what is actually happening.
 * - **Portraits before the scene.** The scene is decoration on one screen; a
 *   face is attached to somebody the player is about to question. If only
 *   half the batch survives a quota, it should be the half that matters.
 *
 * **On the reference image.** Task 1 asks: "if the image model accepts a
 * reference image, pass the first portrait when generating the rest", for
 * consistency within a case. The seam takes one (`ImageCall.reference`) and
 * this will pass it when asked, but it is **off by default**, because it has
 * never been run and because it is not free to be wrong: a reference that the
 * model treats as subject matter rather than as style would put the first
 * suspect's face on everybody. The house style in `prompts.ts` is the
 * consistency mechanism that does not need a paid experiment to trust. Turn
 * `reference` on only with images to look at.
 */

import { LlmError } from "../errors";
import { imageGrade, type ImageQuality } from "../models";
import type { ImageResult, Provider } from "../provider";
import {
  artPrompts,
  isPortraitKey,
  type ArtKey,
  type ArtMaterial,
  type ArtSubject,
} from "./prompts";

export interface ArtOptions {
  quality: ImageQuality;
  signal?: AbortSignal;
  /** Fired the moment an image exists, before the run is finished. */
  onImage?: (key: ArtKey, image: ImageResult) => void | Promise<void>;
  /** `done` counts attempts, finished or failed, so a bar can reach the end. */
  onProgress?: (done: number, of: number) => void;
  /** True for a subject already on disk, so a resume does not pay twice. */
  have?: (key: ArtKey) => boolean;
  /** See the note at the top. Unverified; leave it off. */
  reference?: boolean;
}

export interface ArtFailure {
  key: ArtKey;
  reason: string;
}

export interface ArtRun {
  images: Map<ArtKey, ImageResult>;
  /** Calls actually made. Skipped subjects do not count; failures do. */
  calls: number;
  failed: ArtFailure[];
}

/**
 * How many calls a material implies, and what they cost.
 *
 * The number the owner is owed before a paid batch, and the reason this is a
 * separate function rather than a line inside the runner: it has to be
 * answerable with no key and no calls, exactly as `npm run author --
 * --estimate` is. `models.ts#imageCost` does the money, and the warning about
 * how firm those prices are lives there.
 */
export function estimateArt(
  material: ArtMaterial,
  quality: ImageQuality,
  have?: (key: ArtKey) => boolean,
): { calls: number; cost: number } {
  const grade = imageGrade(quality);
  if (!grade.model) return { calls: 0, cost: 0 };
  const calls = material.subjects.filter((s) => !have?.(s.key)).length;
  return { calls, cost: grade.price * calls };
}

/**
 * Portraits first, then the scene. See the note at the top.
 *
 * A sort rather than a reliance on `artMaterial` happening to build them in
 * that order: it does, and a later edit that grouped subjects differently
 * would silently spend the last of a quota on scenery.
 */
type ArtJob = { subject: ArtSubject; prompt: string };

function inOrder(jobs: ArtJob[]): ArtJob[] {
  return [...jobs].sort(
    (a, b) => (isPortraitKey(a.subject.key) ? 0 : 1) - (isPortraitKey(b.subject.key) ? 0 : 1),
  );
}

export async function generateArt(
  provider: Provider,
  material: ArtMaterial,
  options: ArtOptions,
): Promise<ArtRun> {
  const grade = imageGrade(options.quality);
  const images = new Map<ArtKey, ImageResult>();
  const failed: ArtFailure[] = [];
  let calls = 0;

  if (!grade.model) return { images, calls, failed };

  const jobs = inOrder(artPrompts(material)).filter((job) => !options.have?.(job.subject.key));
  let done = 0;
  /** The first portrait that came back, for the reference experiment. */
  let anchor: ImageResult | undefined;

  for (const job of jobs) {
    if (options.signal?.aborted) break;
    try {
      const image = await provider.generateImage({
        prompt: job.prompt,
        model: grade.model,
        aspect: job.subject.aspect,
        size: grade.size,
        reference: options.reference ? anchor : undefined,
        signal: options.signal,
      });
      calls++;
      images.set(job.subject.key, image);
      if (!anchor && isPortraitKey(job.subject.key)) anchor = image;
      await options.onImage?.(job.subject.key, image);
    } catch (cause) {
      calls++;
      const error = LlmError.from(cause);
      // A cancel is the player asking for this to stop, not a failure of the
      // image: record nothing and leave.
      if (error.kind === "cancelled") break;
      failed.push({ key: job.subject.key, reason: error.message });
    }
    options.onProgress?.(++done, jobs.length);
  }

  return { images, calls, failed };
}
