/**
 * The deterministic half of the interrogation, and the half that decides.
 *
 * A voiced reply is model prose wrapped around a sentence the engine wrote.
 * Invariant 6 says no LLM prose reaches the player unverified, and at
 * authoring time "verified" means a second model reads it back. At runtime
 * there is a player waiting, so the check here is arithmetic instead: the
 * verified sentence must be present **word for word**, and the wrapping must
 * not name a room, a room code or an hour. Those three are the notebook's
 * own axes — a claim that names none of them cannot be written into the grid,
 * so it cannot be a smuggled fact however it reads.
 *
 * Nothing here calls a model, and that is the point. The check that decides
 * whether the player sees model prose must not itself be model prose, or the
 * guard becomes the thing it is guarding.
 */

import type { CaseFrame, Glossary } from "../../engine/types";

/** How much wrapping a reply may add around the sentences it must carry. */
export const REPLY_SLACK = 700;

export type RejectReason =
  /** The reply was empty once whitespace was taken off. */
  | "empty"
  /** Far longer than a spoken answer: a wall of invented text. */
  | "too-long"
  /** A verified sentence is missing or was paraphrased. */
  | "not-verbatim"
  /** A room, a room code or an hour was named outside the verified sentence. */
  | "stray-label";

export interface ReplyVerdict {
  ok: boolean;
  reason?: RejectReason;
  /** For `stray-label`, the label that was found. For the fallback report. */
  detail?: string;
}

/**
 * Differences that are typography rather than meaning.
 *
 * A model handed `"nine o'clock"` will often return `"nine o’clock"`, and a
 * sentence rejected over a curly apostrophe would fall back to the template
 * for no reason a player could understand. Every substitution below leaves
 * the claim identical; nothing that could change what a sentence asserts is
 * normalised away.
 */
export function normalise(text: string): string {
  return text
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case folded too, for matching only. The player still reads the original. */
function key(text: string): string {
  return normalise(text).toLowerCase();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "the orangery" and "orangery" are the same room to a reader.
 *
 * A skin names rooms as they would be spoken, articles and all, but a
 * sentence says "in her orangery" as readily as "in the orangery". Matching
 * the article-stripped form catches both. English-only, like everything else
 * the guards do with words; `language` on the skin is why wave 9 exists.
 */
function stripArticle(label: string): string {
  return label.replace(/^(the|a|an)\s+/i, "").trim();
}

/**
 * Every word that would let a sentence say where somebody was, or when.
 *
 * Built from the live glossary rather than from the skin, so a case played in
 * the engine's own words is guarded by "Room 3" and "slot 5" exactly as a
 * dressed one is guarded by "the orangery" and "nine o'clock".
 */
export function forbiddenLabels(frame: CaseFrame, glossary: Glossary): string[] {
  const out = new Set<string>();
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    const name = stripArticle(glossary.roomName(r));
    if (name.length >= 3) out.add(name);
    const code = glossary.roomCode(r);
    if (code.length >= 2) out.add(code);
  }
  for (let t = 0; t < frame.slots; t++) {
    const label = stripArticle(glossary.slotLabel(t));
    if (label.length >= 3) out.add(label);
  }
  return [...out];
}

/**
 * Find a label as a word, not as a substring.
 *
 * `MUD` must not fire inside "muddle" and "hall" must not fire inside
 * "shallow". Lookarounds rather than `\b` because a room may legitimately be
 * called "St Cuthbert's" and `\b` treats the apostrophe as a boundary.
 */
function namesLabel(haystack: string, label: string): boolean {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escape(label.toLowerCase())}(?![\\p{L}\\p{N}])`,
    "u",
  );
  return pattern.test(haystack);
}

/**
 * Does this reply carry the evidence, and only the evidence?
 *
 * `sentences` is what the engine released and the player is about to see in
 * the evidence pane; it may be empty, which is the nothing-to-say case and
 * the strictest one — with no card to carry, a reply that names a room or an
 * hour is inventing, full stop.
 */
export function checkReply(
  reply: string,
  sentences: readonly string[],
  forbidden: readonly string[],
): ReplyVerdict {
  const said = normalise(reply);
  if (said === "") return { ok: false, reason: "empty" };

  const budget =
    REPLY_SLACK + sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  if (said.length > budget) return { ok: false, reason: "too-long" };

  // Remove each verified sentence as it is found, so a second mention of the
  // same room is caught rather than being excused by the first.
  let rest = key(said);
  for (const sentence of sentences) {
    const needle = key(sentence);
    if (needle === "") continue;
    const at = rest.indexOf(needle);
    if (at < 0) return { ok: false, reason: "not-verbatim", detail: sentence };
    rest = `${rest.slice(0, at)} ${rest.slice(at + needle.length)}`;
  }

  for (const label of forbidden) {
    if (namesLabel(rest, label)) {
      return { ok: false, reason: "stray-label", detail: label };
    }
  }
  return { ok: true };
}

/**
 * A nothing-to-say line, if it really says nothing.
 *
 * `skin.silence[p]` is written by wave 5's writer and is the one piece of its
 * prose the fidelity check never looks at, on the grounds that a line making
 * no claim has nothing to parse back. Wave 5 then stored it and never showed
 * it to anybody, so the grounds were never tested. Wave 6 is the first code
 * to put it in front of a player, and "I was in the orangery all evening and
 * saw nothing" is a line a writer could plausibly produce for exactly this
 * slot — true-sounding, unchecked, and a fact the engine never asserted.
 *
 * So it goes through the same label guard as a voiced reply, at the moment it
 * is used rather than when it was written. A line that names a room or an
 * hour is dropped for the engine's own sentence, which says the one thing
 * that is actually true: this person has nothing to add.
 */
export function safeSilence(
  line: string | undefined,
  forbidden: readonly string[],
  fallback: string,
): string {
  const said = normalise(line ?? "");
  if (said === "") return fallback;
  const folded = said.toLowerCase();
  for (const label of forbidden) if (namesLabel(folded, label)) return fallback;
  return said;
}

/**
 * What the player is shown when the reply did not survive.
 *
 * The bare verified sentences, which is what the plan asks for and is always
 * correct — it is the same text the evidence card carries. With nothing
 * released there is nothing to fall back to but the nothing-to-say line,
 * which the caller has already put through `safeSilence`.
 */
export function bareFallback(sentences: readonly string[], silence: string): string {
  const kept = sentences.map((s) => s.trim()).filter((s) => s !== "");
  return kept.length > 0 ? kept.join(" ") : silence.trim();
}
