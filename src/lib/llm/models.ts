/**
 * Every model id in one file, with what it costs and when it was checked.
 *
 * Ids go stale, so the plan says to verify these rather than inherit them.
 * Checked against ai.google.dev on **2026-09-20**: all five below are GA and
 * none is on the deprecation list. Ascendant (`../NewX/src/lib/api.ts`) pins
 * the same three it uses, and they are still live.
 *
 * Prices are dollars per million tokens, input/output, from
 * ai.google.dev/gemini-api/docs/pricing on the same day. They are here so that
 * the call-count estimate this wave owes the owner can be turned into money
 * without a second trip to the web.
 */

/**
 * The writer (call A) and the summing-up (call B).
 *
 * $0.75 in / $3.75 out. `gemini-3.8-flash` is newer and currently the same
 * price, but 3.7 is the id two sibling projects already run on this machine,
 * and the writer's job — readable period prose — is not where a half-step of
 * model quality decides anything.
 */
export const WRITER_MODEL = "gemini-3.7-flash";

/**
 * The fidelity parse-back (call C), and deliberately **not** `WRITER_MODEL`.
 *
 * The check asks "does this sentence say what the clue says?", and asking the
 * author is the weakest possible form of that question: the same model, with
 * the same priors about what it meant, is the one most likely to read its own
 * ambiguous sentence charitably. A different model is an independent reader,
 * which is the whole point of the check.
 *
 * $0.75 in / $3.75 out — introductory pricing, listed as rising to $1.50 /
 * $7.50 on 2027-01-01. (The pricing page showed 3.7 and 3.8 at identical
 * numbers, which is plausible but worth re-reading before a large batch.)
 */
export const PARSER_MODEL = "gemini-3.8-flash";

/**
 * The cheap option, held in reserve rather than used.
 *
 * $0.30 in / $2.50 out — a third of the output cost, and documented for
 * "high-throughput, low-cost execution for subagent tasks and document
 * parsing", which is close to what the parse-back does. It is not the default
 * because a weaker reader makes *both* kinds of mistake: a false mismatch
 * costs a dull template sentence, but a false match puts unverified prose in
 * front of the player, and that is invariant 6. Switch to it only with a
 * measured fallback rate on both.
 */
export const CHEAP_TEXT_MODEL = "gemini-3.5-flash-lite";

/** Wave 7. $0.045-$0.151 per image depending on resolution. */
export const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
/** Wave 7, for the one scene image. $0.134 per 1K/2K image. */
export const FALLBACK_IMAGE_MODEL = "gemini-3-pro-image";

/** Dollars per million tokens, for the estimate the owner is owed. */
export const PRICES: Record<string, { in: number; out: number }> = {
  [WRITER_MODEL]: { in: 0.75, out: 3.75 },
  [PARSER_MODEL]: { in: 0.75, out: 3.75 },
  [CHEAP_TEXT_MODEL]: { in: 0.3, out: 2.5 },
};
