import { describe, expect, it, vi } from "vitest";
import { LlmError } from "./errors";
import { looksLikeKey, parseJson, requireKey, withRetry } from "./provider";
import { stubProvider } from "./stub";

const FAKE_KEY = "AIzaSyB7t2Qw9LmN4pR0xZcVfHkJdEeTgUiOaPs";

describe("key shape", () => {
  it("accepts a key-shaped string", () => {
    expect(looksLikeKey(FAKE_KEY)).toBe(true);
  });

  it("rejects the things a person actually pastes by mistake", () => {
    expect(looksLikeKey("")).toBe(false);
    expect(looksLikeKey("   ")).toBe(false);
    expect(looksLikeKey("sk-proj-abcdefghijklmnopqrstuvwxyz012345")).toBe(false);
    expect(looksLikeKey("AIzaShort")).toBe(false);
    expect(looksLikeKey(null)).toBe(false);
    expect(looksLikeKey(undefined)).toBe(false);
  });
});

describe("requireKey", () => {
  it("returns the trimmed key", () => {
    expect(requireKey(() => `  ${FAKE_KEY}\n`)).toBe(FAKE_KEY);
  });

  it("says no-key for nothing at all", () => {
    for (const source of [() => null, () => "", () => "   "]) {
      const error = (() => {
        try {
          requireKey(source);
          return null;
        } catch (e) {
          return e as LlmError;
        }
      })();
      expect(error?.kind).toBe("no-key");
    }
  });

  it("says bad-key for a typo, and does not quote it back", () => {
    let caught: LlmError | null = null;
    try {
      requireKey(() => "AIzaOops");
    } catch (e) {
      caught = e as LlmError;
    }
    expect(caught?.kind).toBe("bad-key");
    // A wrong key is still a secret.
    expect(caught?.message).not.toContain("AIzaOops");
  });

  it("treats a source that throws as no key, not as a crash", () => {
    // A locked-down localStorage throws on read; that must not stop the app.
    let caught: LlmError | null = null;
    try {
      requireKey(() => {
        throw new Error("SecurityError");
      });
    } catch (e) {
      caught = e as LlmError;
    }
    expect(caught?.kind).toBe("no-key");
  });
});

describe("withRetry", () => {
  const nowait = { sleep: async () => {}, jitter: () => 0.5 };

  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const out = await withRetry(async () => "ok", { ...nowait, sleep });
    expect(out).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a retryable failure and returns the later success", async () => {
    let attempts = 0;
    const out = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new LlmError("quota", "slow down");
        return "ok";
      },
      { ...nowait, attempts: 3 },
    );
    expect(out).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("gives up after the last attempt and throws the real failure", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new LlmError("network", "socket hang up");
        },
        { ...nowait, attempts: 2 },
      ),
    ).rejects.toMatchObject({ kind: "network" });
    expect(attempts).toBe(2);
  });

  it("does not retry a failure that retrying cannot fix", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new LlmError("blocked", "safety");
        },
        { ...nowait, attempts: 5 },
      ),
    ).rejects.toMatchObject({ kind: "blocked" });
    expect(attempts).toBe(1);
  });

  it("backs off further each time, and honours the provider's own advice", async () => {
    const waits: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new LlmError("network", "down");
        },
        { ...nowait, attempts: 4, baseDelayMs: 100, sleep: async (ms) => void waits.push(ms) },
      ),
    ).rejects.toThrow();
    // jitter fixed at 0.5 → 0.75 of the doubling backoff.
    expect(waits).toEqual([75, 150, 300]);

    const advised: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new LlmError("quota", "wait", { retryAfterMs: 4321 });
        },
        { ...nowait, attempts: 2, sleep: async (ms) => void advised.push(ms) },
      ),
    ).rejects.toThrow();
    expect(advised).toEqual([4321]);
  });

  it("never exceeds the ceiling", async () => {
    const waits: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new LlmError("network", "down");
        },
        {
          ...nowait,
          attempts: 6,
          baseDelayMs: 1000,
          maxDelayMs: 2000,
          sleep: async (ms) => void waits.push(ms),
        },
      ),
    ).rejects.toThrow();
    for (const wait of waits) expect(wait).toBeLessThanOrEqual(2000);
  });

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(
      withRetry(
        async () => {
          ran = true;
          return "ok";
        },
        { ...nowait, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(ran).toBe(false);
  });

  it("classifies a raw provider throw on the way out", async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error("API key not valid");
        },
        nowait,
      ),
    ).rejects.toMatchObject({ kind: "bad-key" });
  });
});

describe("parseJson", () => {
  it("reads plain JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads a fenced block, which is what a model usually sends", () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reads past a sentence of preamble", () => {
    expect(parseJson('Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it("reads a top-level array, which the brace-scrape it was copied from could not", () => {
    expect(parseJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseJson('sure:\n[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("fails loudly rather than repairing", () => {
    // A repaired-but-wrong object is worse than a clean failure: the caller
    // has a retry and a template fallback, and neither can fire if this
    // guesses.
    for (const text of ["", "   ", "no json here", "{oops"]) {
      let caught: LlmError | null = null;
      try {
        parseJson(text);
      } catch (e) {
        caught = e as LlmError;
      }
      expect(caught?.kind).toBe("malformed");
    }
  });
});

describe("the stub provider", () => {
  it("answers from the queue in order and records the calls", async () => {
    const provider = stubProvider({ answers: [{ a: 1 }, { a: 2 }] });
    const call = { system: "s", user: "u", schema: { type: "object" } } as const;
    expect(await provider.generateJSON({ ...call, user: "first" })).toEqual({ a: 1 });
    expect(await provider.generateJSON({ ...call, user: "second" })).toEqual({ a: 2 });
    expect(provider.calls.map((c) => c.user)).toEqual(["first", "second"]);
    expect(provider.remaining()).toBe(0);
  });

  it("throws a scripted failure rather than returning it", async () => {
    const provider = stubProvider({ answers: [new LlmError("quota", "slow down")] });
    await expect(
      provider.generateJSON({ system: "s", user: "u", schema: { type: "object" } }),
    ).rejects.toMatchObject({ kind: "quota" });
  });

  it("running dry is a plain Error, so no retry loop mistakes it for an outage", async () => {
    const provider = stubProvider({ answers: [] });
    const failure = await provider
      .generateJSON({ system: "s", user: "u", schema: { type: "object" } })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(LlmError);
  });
});
