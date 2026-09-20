/**
 * A provider that answers from a script instead of from a model.
 *
 * This is how the whole of wave 5 was built and is tested: the owner's
 * instruction was to write it against stubbed responses first and bring back
 * a call-count estimate before spending anything, so every test above the
 * seam runs here, with no key and no network.
 *
 * It ships rather than living in a test file for two reasons. The authoring
 * CLI's `--dry-run` uses it to walk the entire pipeline — generate, write,
 * check, fall back, write a pack — without a key, which is the only way to
 * know the pipeline works before paying for it. And a recorded transcript
 * from a real run can be replayed through it later, which is what the plan
 * means by "LLM code is tested with recorded responses".
 */

import { LlmError } from "./errors";
import type { ImageCall, ImageResult, JsonCall, Provider } from "./provider";

/** One scripted answer: a value to return, or a failure to throw. */
export type Scripted = unknown | LlmError;

export interface StubProvider extends Provider {
  /** Every call made, in order, for asserting on what the prompt contained. */
  readonly calls: JsonCall[];
  /** How many scripted answers are left. */
  remaining(): number;
}

export interface StubOptions {
  /**
   * Answers, consumed in order.
   *
   * An `LlmError` in the queue is thrown rather than returned, which is how a
   * quota failure or a malformed answer is rehearsed.
   */
  answers?: Scripted[];
  /**
   * Answers a call the queue has run out of, or every call when no queue is
   * given. Handed the call so a stub can behave like a parser.
   */
  answer?: (call: JsonCall, index: number) => Scripted;
  /** Wave 7. Returns the same bytes for every prompt. */
  image?: ImageResult;
}

export function stubProvider(options: StubOptions = {}): StubProvider {
  const queue = [...(options.answers ?? [])];
  const calls: JsonCall[] = [];

  return {
    name: "stub",
    calls,
    remaining: () => queue.length,

    async generateJSON(call: JsonCall): Promise<unknown> {
      calls.push(call);
      if (call.signal?.aborted) throw new LlmError("cancelled", "cancelled");

      const scripted = queue.length > 0 ? queue.shift() : options.answer?.(call, calls.length - 1);
      if (scripted === undefined) {
        // Not an `LlmError`: a stub running dry is a bug in the test, not a
        // rehearsal of a provider failure, and it should not be swallowed by
        // a retry loop that treats provider failures as normal.
        throw new Error(`the stub has no answer for call ${calls.length}`);
      }
      if (scripted instanceof LlmError) throw scripted;
      return scripted;
    },

    async generateImage(_call: ImageCall): Promise<ImageResult> {
      if (options.image) return options.image;
      throw new LlmError("blocked", "the stub has no image");
    },
  };
}
