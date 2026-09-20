/**
 * Does the prose say what the clue says?
 *
 * Invariant 6: no LLM prose reaches the player unverified — parse-back
 * equality, or the template sentence. This is the parse-back.
 *
 * The check hands a second model some sentences, the cast and room list, and
 * the clue vocabulary, and asks what each sentence claims. It compares the
 * answer's canonical form with the clue's. Anything that does not match, or
 * that claims more than the clue does, is rewritten; twice; and then dropped
 * for the engine's own sentence.
 *
 * **What makes it a check and not a ritual.** The model is never shown the
 * clue the sentence came from. It cannot be: `buildParseBackPrompt` takes
 * prose, a frame and a glossary, and there is no argument to pass a clue
 * through. Sentences arrive under opaque ids in a shuffled order, so nothing
 * in the batch hints at what any entry ought to be. If those two things were
 * relaxed the check would compare each clue with itself and pass everything
 * for ever, while still producing a fallback rate, a log and a green test.
 *
 * **A fallback rate of zero is not good news on its own.** Before believing
 * one, look at `fidelity.test.ts`, where the same code is run against prose
 * that says the wrong thing and is required to notice.
 */

import { fidelityKey, parseClueBody } from "../../engine/clues/schema";
import { clueSentence } from "../../engine/solver/explain";
import { RNG } from "../../engine/rng";
import type { CaseFrame, Clue, ClueId, Glossary } from "../../engine/types";
import { LlmError } from "../errors";
import type { Provider } from "../provider";
import { PARSER_MODEL } from "../models";
import {
  type ProseItem,
  PARSE_BACK_SYSTEM,
  buildParseBackPrompt,
  parseBackSchema,
} from "./prompts";
import type { SkinFidelity } from "./schema";

export type MismatchReason =
  /** The model's answer was not a clue in the language. */
  | "unreadable"
  /** It read the sentence as a different clue. */
  | "different-clue"
  /** The sentence claims something beyond its clue. */
  | "extra-claim"
  /** The sentence credits the observation to somebody else. */
  | "misattributed"
  /** The model returned nothing for this entry. */
  | "missing";

export interface Mismatch {
  id: ClueId;
  reason: MismatchReason;
  /** The clue's canonical form: what the sentence should have said. */
  wanted: string;
  /** What the reader made of it, when it made anything. */
  got: string | null;
  extraClaims: string[];
  /** A sentence for the rewrite prompt, and for a report. */
  complaint: string;
}

export interface FidelityResult {
  /** Prose that passed. A clue missing from here falls back to the template. */
  prose: Record<ClueId, string>;
  fidelity: SkinFidelity;
  /** Everything that failed on the final pass, for a report. */
  mismatches: Mismatch[];
}

export interface FidelityOptions {
  /** Passes in total: the first writing plus the retries. */
  attempts?: number;
  signal?: AbortSignal;
  model?: string;
  /**
   * Ask the writer for new prose for the clues that failed, given the
   * complaints. Absent, a failure goes straight to the template.
   */
  rewrite?(mismatches: readonly Mismatch[]): Promise<Record<ClueId, string>>;
  /** Honest progress for the loading screen. */
  onPass?(pass: number, checked: number, verified: number): void;
  /** Injected by tests that want a fixed order. */
  shuffle?(count: number, seed: string): number[];
}

export const DEFAULT_ATTEMPTS = 3;

/**
 * A deterministic shuffle.
 *
 * Seeded rather than random so that re-running a check on the same case gives
 * the same batch order, which makes a recorded transcript replayable and a
 * failure reproducible. It is still a shuffle: the seed is the clue ids, which
 * has nothing to do with the order they were enumerated in.
 */
function seededShuffle(count: number, seed: string): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  const rng = new RNG(seed);
  for (let i = count - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

interface Reading {
  id: string;
  clue: unknown;
  extraClaims: string[];
  attributedTo: number;
}

function readReadings(answer: unknown): Map<string, Reading> {
  const out = new Map<string, Reading>();
  if (typeof answer !== "object" || answer === null) return out;
  const list = (answer as { readings?: unknown }).readings;
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string") continue;
    out.set(item.id, {
      id: item.id,
      clue: item.clue,
      extraClaims: Array.isArray(item.extraClaims)
        ? item.extraClaims.filter((c): c is string => typeof c === "string")
        : [],
      attributedTo: typeof item.attributedTo === "number" ? item.attributedTo : -1,
    });
  }
  return out;
}

/**
 * One pass: send every sentence, judge every answer.
 *
 * Exported because the author CLI reports per-pass numbers, and because a
 * test that drives one pass is easier to read than one that drives three.
 */
export async function fidelityPass(
  provider: Provider,
  frame: CaseFrame,
  glossary: Glossary,
  clues: readonly Clue[],
  prose: Record<ClueId, string>,
  options: FidelityOptions = {},
): Promise<{ verified: ClueId[]; mismatches: Mismatch[] }> {
  const subject = clues.filter((clue) => typeof prose[clue.id] === "string");
  if (subject.length === 0) return { verified: [], mismatches: [] };

  const shuffle = options.shuffle ?? seededShuffle;
  const order = shuffle(subject.length, subject.map((c) => c.id).join(","));

  const items: ProseItem[] = [];
  /** opaque id -> the clue it really is. The model never sees this map. */
  const back = new Map<string, Clue>();
  order.forEach((index, position) => {
    const clue = subject[index];
    const opaque = `s${position}`;
    back.set(opaque, clue);
    items.push({
      id: opaque,
      text: prose[clue.id],
      speaker:
        clue.source.kind === "testimony" ? glossary.personName(clue.source.speaker) : null,
    });
  });

  const answer = await provider.generateJSON({
    system: PARSE_BACK_SYSTEM,
    user: buildParseBackPrompt(items, frame, glossary),
    schema: parseBackSchema(
      frame,
      items.map((item) => item.id),
    ),
    model: options.model ?? PARSER_MODEL,
    // The reading must be the same every time, so the check is about the
    // prose rather than about the weather.
    temperature: 0,
    signal: options.signal,
  });

  const readings = readReadings(answer);
  const verified: ClueId[] = [];
  const mismatches: Mismatch[] = [];

  for (const item of items) {
    const clue = back.get(item.id)!;
    // `fidelityKey`, not `canonical`: the question here is whether the
    // sentence MEANS what the clue means, and one pair of distinct cards
    // means the same thing. See the note on that function.
    const wanted = fidelityKey(clue.body);
    const speaker = clue.source.kind === "testimony" ? clue.source.speaker : -1;
    const reading = readings.get(item.id);

    const reject = (reason: MismatchReason, got: string | null, complaint: string): void => {
      mismatches.push({
        id: clue.id,
        reason,
        wanted,
        got,
        extraClaims: reading?.extraClaims ?? [],
        complaint,
      });
    };

    if (!reading) {
      reject("missing", null, "the checker returned no reading for this sentence");
      continue;
    }

    const body = parseClueBody(reading.clue, frame);
    if (body === null) {
      reject(
        "unreadable",
        null,
        "the sentence could not be read back as any single claim about who was where and when",
      );
      continue;
    }

    const got = fidelityKey(body);
    if (got !== wanted) {
      reject(
        "different-clue",
        got,
        `the sentence reads as ${got}, but it must say ${wanted} — ` +
          `the engine's own words for it are: ${clueSentence(frame, clue, glossary)}`,
      );
      continue;
    }

    if (reading.extraClaims.length > 0) {
      reject(
        "extra-claim",
        got,
        "the sentence also claims: " +
          reading.extraClaims.join("; ") +
          ". Say only the one thing and nothing else about who was where or when.",
      );
      continue;
    }

    if (reading.attributedTo >= 0 && reading.attributedTo !== speaker) {
      reject(
        "misattributed",
        got,
        `the sentence credits ${glossary.personName(reading.attributedTo)} with noticing this, ` +
          "but it is the speaker's own statement",
      );
      continue;
    }

    verified.push(clue.id);
  }

  return { verified, mismatches };
}

/**
 * The whole check: pass, rewrite the failures, pass again, and give up onto
 * the template.
 */
export async function checkFidelity(
  provider: Provider,
  frame: CaseFrame,
  glossary: Glossary,
  clues: readonly Clue[],
  written: Record<ClueId, string>,
  options: FidelityOptions = {},
): Promise<FidelityResult> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const byId = new Map(clues.map((clue) => [clue.id, clue]));
  const checked = clues.filter((clue) => typeof written[clue.id] === "string").length;

  const good: Record<ClueId, string> = {};
  let pending = { ...written };
  let outstanding: Mismatch[] = [];
  let retried = 0;

  for (let pass = 1; pass <= attempts; pass++) {
    const subject = clues.filter((clue) => typeof pending[clue.id] === "string");
    if (subject.length === 0) break;

    const result = await fidelityPass(provider, frame, glossary, subject, pending, options);
    for (const id of result.verified) good[id] = pending[id];
    outstanding = result.mismatches;
    options.onPass?.(pass, checked, Object.keys(good).length);

    if (outstanding.length === 0) break;
    if (pass === attempts || !options.rewrite) break;

    let rewritten: Record<ClueId, string>;
    try {
      rewritten = await options.rewrite(outstanding);
    } catch (cause) {
      // A rewrite that cannot be made is not a reason to lose the prose that
      // already passed: stop retrying and let the rest fall back.
      if (LlmError.from(cause).kind === "cancelled") throw cause;
      break;
    }

    pending = {};
    for (const mismatch of outstanding) {
      const text = rewritten[mismatch.id];
      if (typeof text === "string" && text.trim() !== "" && byId.has(mismatch.id)) {
        pending[mismatch.id] = text.trim();
        retried++;
      }
    }
    if (Object.keys(pending).length === 0) break;
  }

  const verifiedIds = new Set(Object.keys(good));
  const fallback = clues
    .filter((clue) => !verifiedIds.has(clue.id))
    .map((clue) => clue.id);

  return {
    prose: good,
    mismatches: outstanding,
    fidelity: {
      checked,
      verified: verifiedIds.size,
      retried,
      fallback,
    },
  };
}

/** The measured rate, as a fraction of the clues that had prose to check. */
export function fallbackRate(fidelity: SkinFidelity): number {
  return fidelity.checked === 0 ? 0 : (fidelity.checked - fidelity.verified) / fidelity.checked;
}
