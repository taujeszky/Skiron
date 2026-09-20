/**
 * The seam between Skiron and whatever model is behind it.
 *
 * Deliberately two methods wide. Everything above this line — the skin writer,
 * the fidelity check, wave 6's interrogation, wave 7's art — talks only in
 * these terms, so swapping Gemini for something else is one file, and so every
 * test above this line runs against a stub with no key and no network.
 *
 * Two shapes here are load-bearing rather than incidental:
 *
 * - **`generateJSON` returns `unknown`.** A schema-constrained call is a
 *   request, not a guarantee: the model can answer with valid JSON that is not
 *   the shape asked for, and a signature promising `T` would launder that into
 *   a type error nobody sees until it is a runtime crash. Callers validate.
 *   That is the same discipline `game/storage.ts` applies to localStorage.
 * - **The provider never sees a key.** `KeySource` is a function called at the
 *   moment of the request, so nothing holds the key in a field that could end
 *   up in a heap dump, a save file or a structured log (invariant 9).
 */

import { LlmError } from "./errors";

/**
 * Just enough JSON Schema for a response constraint.
 *
 * Not the whole specification, and not the vendor's `Schema` type: writing it
 * out keeps `llm/skin/` free of any provider import, and the subset below is
 * everything the seventeen clue kinds and the skin need.
 */
export interface JsonSchema {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  /** `object` */
  properties?: Record<string, JsonSchema>;
  required?: string[];
  /** `array` */
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  /** `string` */
  enum?: string[];
  /** `number` / `integer` */
  minimum?: number;
  maximum?: number;
  /** A union of alternatives; used for the seventeen clue payload shapes. */
  anyOf?: JsonSchema[];
  /** Kept for callers that want stable key order in the request. */
  propertyOrdering?: string[];
}

export interface JsonCall {
  /** Who the model is being asked to be, and the rules it must obey. */
  system: string;
  /** The material for this particular call. */
  user: string;
  /** The shape the answer must take. */
  schema: JsonSchema;
  /** Overrides the provider's default text model. */
  model?: string;
  /** 0 for the fidelity check, higher for the writer — see `skin/prompts.ts`. */
  temperature?: number;
  signal?: AbortSignal;
}

export interface ImageCall {
  prompt: string;
  model?: string;
  /** "1:1" for portraits, "16:9" for a scene. */
  aspect?: string;
  /** `ImageConfig.imageSize`: "1K" or "2K". The quality setting picks it. */
  size?: string;
  /**
   * An earlier image to keep this one consistent with — wave 7, task 1.
   *
   * **Unverified.** The SDK takes an `inlineData` part alongside the text, and
   * the models are documented as accepting one, but no image has been
   * generated through this seam at all, let alone with a reference. The art
   * runner leaves it off by default and `art/art.ts` says why.
   */
  reference?: ImageResult;
  signal?: AbortSignal;
}

export interface ImageResult {
  mime: string;
  bytes: Uint8Array;
}

/**
 * Where the key comes from, asked at the moment of the call.
 *
 * Returning `null` means "there is no key", which becomes an `LlmError` of
 * kind `no-key` rather than a failed request.
 */
export type KeySource = () => string | null;

export interface Provider {
  /** For messages and logs. Never includes anything secret. */
  readonly name: string;
  /** The answer, unvalidated and untyped — see the note at the top. */
  generateJSON(call: JsonCall): Promise<unknown>;
  /** Wave 7. Present here so the seam does not move when art lands. */
  generateImage(call: ImageCall): Promise<ImageResult>;
}

/* ------------------------------------------------------------------ keys */

/**
 * The shape a Google key has, checked before it is used.
 *
 * Borrowed from `../catalog-art/api.mjs`, where it earns its place by turning
 * a mistyped key into a sentence on screen instead of an opaque 400 from the
 * far end.
 */
export const KEY_SHAPE = /^AIza[\w-]{30,}$/;

export function looksLikeKey(value: string | null | undefined): boolean {
  return typeof value === "string" && KEY_SHAPE.test(value.trim());
}

/**
 * The key for this call, or an `LlmError` saying which of the two problems it
 * is. Providers call this and nothing else.
 */
export function requireKey(source: KeySource): string {
  let key: string | null = null;
  try {
    key = source();
  } catch {
    // A key source that throws (a locked-down localStorage, a missing file)
    // is "no key", not a crash — the same decision storage.ts makes.
    key = null;
  }
  if (key === null || key.trim() === "") {
    throw new LlmError("no-key", "no API key");
  }
  const trimmed = key.trim();
  if (!KEY_SHAPE.test(trimmed)) {
    // Note what is wrong, never what was given.
    throw new LlmError("bad-key", "the key is not shaped like a Google API key");
  }
  return trimmed;
}

/* ----------------------------------------------------------------- retry */

export interface RetryOptions {
  /** Attempts in total, not retries after the first. */
  attempts?: number;
  /** First backoff; each retry doubles it. */
  baseDelayMs?: number;
  /** Never wait longer than this between attempts. */
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Injected so tests do not spend real seconds asleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so a test gets a fixed backoff. Returns 0..1. */
  jitter?: () => number;
  /** Called before each wait, for honest progress text. */
  onRetry?: (attempt: number, error: LlmError, waitMs: number) => void;
}

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 800;
export const DEFAULT_MAX_DELAY_MS = 20000;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `work`, retrying the failures worth retrying.
 *
 * Ascendant's `generateContentWithRetry` is the ancestor of this, with one
 * deliberate difference: it swallows every failure into a fallback value,
 * which is right for a game that must not stop and wrong here. A fidelity
 * mismatch has to stay *visible*, because the fallback rate is a number this
 * wave has to measure and report. So this returns or throws; it never
 * substitutes.
 */
export async function withRetry<T>(
  work: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? realSleep;
  const jitter = options.jitter ?? Math.random;

  let last: LlmError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new LlmError("cancelled", "cancelled");
    try {
      return await work(attempt);
    } catch (cause) {
      const error = LlmError.from(cause);
      last = error;
      if (!error.retryable || attempt === attempts) throw error;
      // Honour the provider's own advice when it gives any, and otherwise
      // double with jitter so a pack of parallel calls does not resynchronise
      // on every failure.
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      const wait = error.retryAfterMs ?? Math.round(backoff * (0.5 + jitter() * 0.5));
      options.onRetry?.(attempt, error, wait);
      await sleep(wait);
    }
  }
  /* istanbul ignore next — the loop either returns or throws */
  throw last ?? new LlmError("network", "no attempts were made");
}

/* ------------------------------------------------------------------ JSON */

/**
 * Pull JSON out of whatever the model actually sent.
 *
 * Taken as it stands from Ascendant's `parseGeminiJsonResponse`, because the
 * two failure modes it handles are the two that happen: a fenced code block
 * around the object, and a sentence of preamble before it. Anything else is a
 * `malformed` error rather than a heroic repair — the caller has a retry and a
 * fallback, and a repaired-but-wrong object is worse than a clean failure.
 */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") throw new LlmError("malformed", "the model returned nothing");

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidates = [fenced?.[1], trimmed, sliceToBraces(trimmed)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      /* try the next shape */
    }
  }
  throw new LlmError("malformed", "the model's answer was not JSON");
}

function sliceToBraces(text: string): string | null {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const open =
    firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
  if (open === -1) return null;
  const close = text[open] === "{" ? text.lastIndexOf("}") : text.lastIndexOf("]");
  return close > open ? text.slice(open, close + 1) : null;
}
