/**
 * What the player sees when the writing fails.
 *
 * Wave 8, task 5, and the test that would have caught the bug it fixed.
 * `dressCase`'s catch put `err.message` straight onto the screen for three
 * waves, so a quota failure showed whatever the provider had said — from the
 * CLI, a 200-character JSON blob with `@type` and `domain` in it. Seven plain
 * sentences had existed since wave 5 and the most visible path in the app was
 * not using them.
 *
 * The case is fine in every one of these: it was generated, certified twice
 * and is on screen. Only the prose failed. That is what the second half of
 * each message is for, and a test that checked only "an error is shown" would
 * pass against the bug.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { LlmError } from "$lib/llm/errors";
import type { Provider } from "$lib/llm/provider";
import { memorySkins, useSkins } from "$lib/llm/skinStore";

import { loadCaseInline, useLoader } from "./cases";
import {
  game,
  newCase,
  panel,
  screen,
  start,
  updateSettings,
  useClock,
  useWriteProvider,
} from "./controller";
import { memoryStore, useStore } from "./storage";

/** A provider that only ever fails, in whichever way the test asks for. */
function failsWith(err: unknown): () => Provider {
  return () => ({
    name: "always-fails",
    generateJSON: () => Promise.reject(err),
    generateImage: () => Promise.reject(err),
  });
}

beforeEach(() => {
  start();
  useStore(memoryStore());
  useSkins(memorySkins());
  useLoader(loadCaseInline);
  useClock(() => 1_000_000);
  game.set(null);
  screen.set("home");
  panel.set({ kind: "none" });
  updateSettings({ autoNotes: true });
  useWriteProvider(null);
});

describe("when the model fails while writing a case", () => {
  /**
   * A quota refusal as the provider actually words it. The shape is what
   * matters: a long machine-readable blob nobody should ever read on screen.
   */
  const QUOTA_BLOB =
    '{"error":{"code":429,"message":"Quota exceeded for quota metric ' +
    "'Generate requests' and limit 'GenerateRequestsPerMinutePerProjectPerRegion' " +
    "of service 'generativelanguage.googleapis.com'\",\"status\":\"RESOURCE_EXHAUSTED\"," +
    '"details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","domain":' +
    '"googleapis.com"}]}}';

  it("still hands over a playable case", async () => {
    useWriteProvider(failsWith(new Error(QUOTA_BLOB)));
    await newCase("easy", "a lighthouse in a storm");

    const g = get(game);
    expect(g).not.toBeNull();
    // The point of the whole design: no prose, and a case anyway.
    expect(g!.skin).toBeNull();
    expect(g!.case.clues.length).toBeGreaterThan(0);
    expect(get(screen)).toBe("briefing");
  });

  it("says what happened in a sentence, not in the provider's words", async () => {
    useWriteProvider(failsWith(new Error(QUOTA_BLOB)));
    await newCase("easy", "a lighthouse in a storm");

    const p = get(panel);
    expect(p.kind).toBe("error");
    const text = (p as { text: string }).text;
    // The bug, pinned: none of the provider's machinery may reach the screen.
    expect(text).not.toContain("@type");
    expect(text).not.toContain("googleapis");
    expect(text).not.toContain("RESOURCE_EXHAUSTED");
    expect(text).not.toContain("{");
    // And it must be recognisably about quota rather than a generic apology.
    expect(text.toLowerCase()).toContain("quota");
  });

  it("tells the player the case is playable anyway", async () => {
    useWriteProvider(failsWith(new Error(QUOTA_BLOB)));
    await newCase("easy", "a lighthouse in a storm");
    const text = (get(panel) as { text: string }).text;
    // The half of task 5 that was genuinely missing: somewhere to go.
    expect(text.toLowerCase()).toContain("ready");
  });

  it("never leaks a key from a provider's own error text", async () => {
    const leaky = new Error(
      "POST https://generativelanguage.googleapis.com/v1/models?key=" +
        "AIzaSyA1234567890123456789012345678901 failed",
    );
    useWriteProvider(failsWith(leaky));
    await newCase("easy", "a lighthouse in a storm");
    const text = (get(panel) as { text: string }).text;
    expect(text).not.toContain("AIzaSyA1234567890123456789012345678901");
  });

  it("says nothing at all when the player cancelled", async () => {
    useWriteProvider(failsWith(new LlmError("cancelled", "cancelled")));
    await newCase("easy", "a lighthouse in a storm");
    // A cancel is a choice, not a failure, and gets no error panel.
    expect(get(panel).kind).not.toBe("error");
    expect(get(game)).not.toBeNull();
  });
});
