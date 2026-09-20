import { describe, expect, it } from "vitest";
import { LlmError, llmErrorMessage, scrub } from "./errors";

/** Shaped like a real one, and not one: 39 characters, `AIza` prefix. */
const FAKE_KEY = "AIzaSyB7t2Qw9LmN4pR0xZcVfHkJdEeTgUiOaPs";

describe("scrub", () => {
  it("removes a key from the middle of a sentence", () => {
    const text = scrub(`request failed for key ${FAKE_KEY} at 10:04`);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).toContain("at 10:04");
  });

  it("removes a key from a query string, which is how a URL leaks one", () => {
    const text = scrub(
      `GET https://generativelanguage.googleapis.com/v1beta/models?key=${FAKE_KEY}&alt=json 403`,
    );
    expect(text).not.toContain(FAKE_KEY);
    // The shape of the request survives, because that is the part worth
    // reading when something is wrong.
    expect(text).toContain("v1beta/models");
    expect(text).toContain("403");
  });

  it("removes every occurrence, not just the first", () => {
    const text = scrub(`${FAKE_KEY} then ${FAKE_KEY} again`);
    expect(text).not.toContain(FAKE_KEY);
  });

  it("leaves text that merely mentions a key alone", () => {
    expect(scrub("no API key was supplied")).toBe("no API key was supplied");
  });
});

describe("LlmError", () => {
  it("scrubs the message it is constructed with", () => {
    // The guard that matters: every construction path goes through the
    // constructor, so a provider that puts the key in the message cannot get
    // it past this.
    const error = new LlmError("bad-key", `refused: ${FAKE_KEY}`);
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("scrubs a key out of a wrapped provider failure", () => {
    const cause = new Error(`400 Bad Request https://example.com/v1?key=${FAKE_KEY}`);
    const error = LlmError.from(cause);
    expect(error.message).not.toContain(FAKE_KEY);
    // The cause is kept for a debugger, and is the one place the raw text
    // still exists. Nothing logs `.cause`; everything logs `.message`.
    expect(error.cause).toBe(cause);
  });

  it("classifies by status code", () => {
    expect(LlmError.from({ status: 429, message: "slow down" }).kind).toBe("quota");
    expect(LlmError.from({ status: 403, message: "nope" }).kind).toBe("bad-key");
    expect(LlmError.from({ response: { status: 401 }, message: "nope" }).kind).toBe("bad-key");
  });

  it("classifies by message when there is no status", () => {
    expect(LlmError.from(new Error("RESOURCE_EXHAUSTED")).kind).toBe("quota");
    expect(LlmError.from(new Error("blocked for safety")).kind).toBe("blocked");
    expect(LlmError.from(new Error("Unexpected token < in JSON")).kind).toBe("malformed");
    expect(LlmError.from(new Error("API key not valid")).kind).toBe("bad-key");
  });

  it("calls an abort a cancellation rather than a failure", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(LlmError.from(abort).kind).toBe("cancelled");
    expect(LlmError.from(abort).retryable).toBe(false);
  });

  it("treats an unrecognised failure as network, so it is retried", () => {
    const error = LlmError.from(new Error("socket hang up"));
    expect(error.kind).toBe("network");
    expect(error.retryable).toBe(true);
  });

  it("passes one of ours straight through", () => {
    const original = new LlmError("no-key", "no API key");
    expect(LlmError.from(original)).toBe(original);
  });

  it("retries quota, network and malformed, and nothing else", () => {
    const retryable = (kind: Parameters<typeof llmErrorMessage>[0]["kind"]) =>
      new LlmError(kind, "x").retryable;
    expect(retryable("quota")).toBe(true);
    expect(retryable("network")).toBe(true);
    expect(retryable("malformed")).toBe(true);
    expect(retryable("no-key")).toBe(false);
    expect(retryable("bad-key")).toBe(false);
    expect(retryable("blocked")).toBe(false);
    expect(retryable("cancelled")).toBe(false);
  });

  it("has a sentence for every kind", () => {
    const kinds = [
      "no-key",
      "bad-key",
      "quota",
      "blocked",
      "malformed",
      "network",
      "cancelled",
    ] as const;
    for (const kind of kinds) {
      const text = llmErrorMessage(new LlmError(kind, "raw"));
      expect(text.length).toBeGreaterThan(5);
      // Never the raw provider text: these go on screen.
      expect(text).not.toContain("raw");
    }
  });
});
