/**
 * One typed question, end to end: route it, let the engine answer it, voice
 * the answer, check the voicing.
 *
 * The order is the invariant. The engine releases the card **between** the two
 * model calls, so the first model has no card to leak and the second has
 * exactly the card the player is already looking at. Nothing here reaches a
 * bank: `release` is a callback the game layer supplies, and it is the only
 * route from this file to the evidence. That is the same arrangement as
 * `skin/prompts.ts#writerMaterial`, for the same reason — the question "can
 * this leak?" is answered by the shape of the types rather than by reading
 * the prompts.
 *
 * **No retries.** Every other model call in the project retries, because
 * nobody is waiting. Here somebody is. A failed classification is reported as
 * a failure the player can act on by asking again, which is one wait rather
 * than two; a failed or rejected voicing falls back to the bare verified
 * sentence, which is never wrong and is already on screen.
 */

import type { ClueId, TopicKey } from "../../engine/types";
import { LlmError } from "../errors";
import type { Provider } from "../provider";
import {
  type ClassifyOptions,
  type Classification,
  type Topic,
  classifyQuestion,
} from "./classify";
import { type RejectReason, bareFallback, checkReply, safeSilence } from "./guards";
import { type Persona, type VoiceOptions, type VoiceTurn, voiceReply } from "./voice";

/**
 * How much of the conversation call 2 is shown.
 *
 * Three exchanges. Enough for "and after that?" to mean something, short
 * enough that a long interrogation does not grow the bill with every
 * question — this is the one prompt in the project whose size is a function
 * of how long the player has been playing.
 */
export const VOICE_HISTORY = 6;

/** What the engine handed over, in the player's own evidence pane. */
export interface Release {
  ids: ClueId[];
  /** `explain.clue(...)` for each — the sentence the card itself carries. */
  sentences: string[];
}

export interface AskRequest {
  /** The player's own words. */
  question: string;
  /** Who is being questioned, by name. */
  suspect: string;
  /** Their name, role, bio and manner. Never their motive: see below. */
  persona: Persona;
  /** Handed to call 2 only when the motive question is the question asked. */
  motive: string;
  /** Every topic the picker offers for this suspect. Never a filtered list. */
  topics: readonly Topic[];
  /** The conversation so far with this person, oldest first. */
  history: readonly VoiceTurn[];
  /** Room names, room codes and hour labels: what a reply may not name. */
  forbidden: readonly string[];
  /** The skin's nothing-to-say line for this person, or "". */
  silence: string;
  /** The engine's own nothing-to-say sentence, when the skin's is unusable. */
  plainSilence: string;
  /**
   * Ask the engine. The only route from this module to a bank, and it is
   * called *after* the routing and *before* the voicing, so the card is on
   * screen while call 2 is still in the air.
   */
  release(key: TopicKey): Release;
}

export interface AskOutcome {
  kind: Classification["kind"];
  /** The topic it was routed to, or null. */
  key: TopicKey | null;
  /** What the suspect says. Always something a player can read. */
  text: string;
  cards: ClueId[];
  /** True when the model's own words survived the check. */
  voiced: boolean;
  /** Why they did not, when they did not. For measurement, not for the player. */
  rejected?: RejectReason;
  /** What the rejection was about — a missing sentence, or the stray label. */
  detail?: string;
  /** Did this cost the player a move? A topic does; the other three do not. */
  spent: boolean;
  /** Model calls actually made, so the cost of a played case is countable. */
  calls: number;
}

export interface AskOptions extends ClassifyOptions, VoiceOptions {
  classifierModel?: string;
  voiceModel?: string;
}

/*
 * The two canned replies.
 *
 * Canned rather than voiced because neither says anything about the case: one
 * asks the detective to be plainer, the other declines an accusation. A model
 * call for either would be money spent on a sentence with no content in it.
 *
 * The denial matters more than it looks. It is the same line whoever is
 * speaking, and it must be: a guilty person who protested differently from an
 * innocent one would be the whole answer, handed over for free, in the one
 * exchange every player will try on everybody. It is built from nothing but
 * the turn count, so there is no field it could vary by.
 */
const NARROW = [
  "You'll have to be plainer than that. Ask me about one of the hours, or one of the rooms, or one of the others.",
  "I can't answer that as it stands. Put it to me about a particular hour, or a particular room, or a particular person.",
  "That's a very wide net. Name an hour, or a room, or one of the household, and I'll tell you what I can.",
];

const DENIAL = [
  "I did no such thing, and I'll not pretend to be flattered that you asked. Ask me something I can answer.",
  "You can put that to me as often as you like; the answer will be the same. I did not.",
  "No. I won't dignify it further than that — ask me about the evening instead.",
];

/** Deterministic, and a function of the transcript's length and nothing else. */
function canned(lines: readonly string[], history: readonly VoiceTurn[]): string {
  return lines[history.length % lines.length];
}

export async function askInWords(
  provider: Provider,
  request: AskRequest,
  options: AskOptions = {},
): Promise<AskOutcome> {
  const classifyOptions: ClassifyOptions = {
    model: options.classifierModel ?? options.model,
    signal: options.signal,
  };

  /* --------------------------------------------------------- call 1: route */

  const decision = await classifyQuestion(
    provider,
    {
      question: request.question,
      suspect: request.suspect,
      topics: request.topics,
    },
    classifyOptions,
  );

  const spoken = (kind: "too_broad" | "accusation", text: string): AskOutcome => ({
    kind,
    key: null,
    text,
    cards: [],
    voiced: false,
    spent: false,
    calls: 1,
  });

  if (decision.kind === "too_broad") {
    return spoken("too_broad", canned(NARROW, request.history));
  }
  if (decision.kind === "accusation") {
    return spoken("accusation", canned(DENIAL, request.history));
  }

  /* ------------------------------------- the engine, between the two calls */

  let released: Release = { ids: [], sentences: [] };
  let motive = "";
  if (decision.kind === "topic") {
    released = request.release(decision.key);
    const topic = request.topics.find((t) => t.key === decision.key);
    // The motive is authored content the picker charges a move for. It goes
    // to the model only when that move has just been paid.
    if (topic?.group === "motive") motive = request.motive;
  }

  /* --------------------------------------------------------- call 2: voice */

  const silence = safeSilence(request.silence, request.forbidden, request.plainSilence);
  const fallback = bareFallback(released.sentences, silence);
  const spent = decision.kind === "topic";
  const key = decision.kind === "topic" ? decision.key : null;

  let reply: string;
  try {
    reply = await voiceReply(
      provider,
      {
        persona: motive === "" ? request.persona : { ...request.persona, motive },
        question: request.question,
        history: request.history.slice(-VOICE_HISTORY),
        sentences: released.sentences,
      },
      {
        model: options.voiceModel ?? options.model,
        temperature: options.temperature,
        signal: options.signal,
      },
    );
  } catch (cause) {
    // A player who pressed cancel gets a cancel. Everything else leaves the
    // card released, the move spent and the bare sentence on the transcript,
    // because all of that has already happened and is correct.
    if (LlmError.from(cause).kind === "cancelled") throw cause;
    return {
      kind: decision.kind,
      key,
      text: fallback,
      cards: released.ids,
      voiced: false,
      rejected: "empty",
      spent,
      calls: 2,
    };
  }

  const verdict = checkReply(reply, released.sentences, request.forbidden);
  if (!verdict.ok) {
    return {
      kind: decision.kind,
      key,
      text: fallback,
      cards: released.ids,
      voiced: false,
      rejected: verdict.reason,
      detail: verdict.detail,
      spent,
      calls: 2,
    };
  }

  return {
    kind: decision.kind,
    key,
    text: reply.trim(),
    cards: released.ids,
    voiced: true,
    spent,
    calls: 2,
  };
}
