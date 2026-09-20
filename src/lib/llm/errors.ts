/**
 * What can go wrong when a model is involved, as a closed set.
 *
 * Every failure gets a `kind`, because the callers above want different things
 * from different failures: the skin author retries a `quota` and gives up on a
 * `blocked`, the fidelity check counts a `malformed` towards its fallback rate
 * rather than treating it as an outage, and the UI only ever offers "add a
 * key" for `no-key`. A single opaque Error would make all of those guesses.
 *
 * **Invariant 9 lives here.** The key never enters a file, a URL or a log —
 * and the most likely way it would is not a `console.log` anyone wrote, but a
 * provider SDK putting the request URL or the offending header into the
 * message of the error it throws, which is then logged by something innocent
 * three layers up. So nothing constructs an `LlmError` message directly:
 * everything goes through `scrub`, and `scrub` is the only reason this file is
 * not four lines long.
 */

/**
 * Anything shaped like a Google API key, wherever it appears.
 *
 * `AIza` then 35 more characters is the documented shape, but the point of the
 * guard is to be wider than the documented shape rather than exactly it — a
 * key in an error message is a leak whether or not it is the length the docs
 * promise, and matching 30-or-more costs nothing.
 */
const KEY_SHAPED = /AIza[\w-]{30,}/g;

/** A query parameter that carries a key, which is how a URL leaks one. */
const KEY_PARAM = /([?&](?:key|api_?key|access_token)=)[^&\s"']+/gi;

/**
 * Remove anything key-shaped from text that is about to be shown, thrown or
 * logged. Applied to every message and every wrapped cause.
 */
export function scrub(text: string): string {
  return text.replace(KEY_SHAPED, "AIza…redacted").replace(KEY_PARAM, "$1redacted");
}

export type LlmErrorKind =
  /** Nobody has supplied a key: the settings screen, `.env.local`, the CLI. */
  | "no-key"
  /** A key was supplied and is malformed, expired or refused. */
  | "bad-key"
  /** Rate limited, or out of quota. Worth waiting for. */
  | "quota"
  /** A safety filter refused to answer. Retrying the same prompt will not help. */
  | "blocked"
  /** The model answered and the answer was not what the schema asked for. */
  | "malformed"
  /** The provider could not be reached, or took too long. */
  | "network"
  /** The caller aborted — a player pressing cancel is not a failure. */
  | "cancelled";

/** Kinds where trying the same call again is reasonable. */
const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set<LlmErrorKind>([
  "quota",
  "network",
  // Malformed is retryable on purpose: a schema-constrained call that came
  // back wrong usually comes back right on the second attempt, and the skin
  // author feeds the complaint back into the retry.
  "malformed",
]);

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** Set when the provider told us how long to wait (quota responses do). */
  readonly retryAfterMs?: number;

  constructor(
    kind: LlmErrorKind,
    message: string,
    options: { cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(scrub(message), { cause: options.cause });
    this.name = "LlmError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }

  /**
   * Turn anything a provider throws into one of ours.
   *
   * The classification is by message text because that is all an SDK error
   * reliably carries across versions; a status code is used when one is there.
   * Unknown failures become `network` rather than something more specific, so
   * that an unrecognised outage is retried rather than reported as a bug.
   */
  static from(cause: unknown, fallback: LlmErrorKind = "network"): LlmError {
    if (cause instanceof LlmError) return cause;

    const raw = cause instanceof Error ? cause.message : String(cause);
    const text = scrub(raw);
    const lower = text.toLowerCase();
    const status = statusOf(cause);

    if (isAbort(cause)) return new LlmError("cancelled", "cancelled", { cause });
    if (status === 401 || status === 403 || /api key|unauthenticated|permission denied/.test(lower)) {
      return new LlmError("bad-key", text, { cause });
    }
    if (status === 429 || /quota|rate limit|resource[_ ]exhausted|too many requests/.test(lower)) {
      return new LlmError("quota", text, { cause, retryAfterMs: retryAfterOf(cause) });
    }
    if (/safety|blocked|prohibited|recitation/.test(lower)) {
      return new LlmError("blocked", text, { cause });
    }
    if (/json|schema|parse|unexpected token/.test(lower)) {
      return new LlmError("malformed", text, { cause });
    }
    return new LlmError(fallback, text, { cause });
  }
}

function isAbort(cause: unknown): boolean {
  if (typeof DOMException !== "undefined" && cause instanceof DOMException) {
    return cause.name === "AbortError";
  }
  return cause instanceof Error && cause.name === "AbortError";
}

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const bag = cause as Record<string, unknown>;
  for (const key of ["status", "code", "statusCode"]) {
    const value = bag[key];
    if (typeof value === "number") return value;
  }
  const response = bag.response;
  if (typeof response === "object" && response !== null) {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function retryAfterOf(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const value = (cause as Record<string, unknown>).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A human sentence for a failure, safe to put on screen. */
export function llmErrorMessage(error: LlmError): string {
  switch (error.kind) {
    case "no-key":
      return "No API key. Add one on the settings screen to have the model write a case.";
    case "bad-key":
      return "That key was refused. Check it on the settings screen.";
    case "quota":
      return "The model is rate limited or out of quota. Try again in a minute.";
    case "blocked":
      return "The model declined to answer that. Try a different setting.";
    case "malformed":
      return "The model's answer did not fit the schema.";
    case "cancelled":
      return "Cancelled.";
    case "network":
      return "Could not reach the model.";
  }
}
