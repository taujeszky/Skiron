import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { formatCaseId, newCaseId } from "$lib/engine/caseId";
import { LlmError } from "$lib/llm/errors";
import { memoryArt, useArt, type ArtStore } from "$lib/llm/artStore";
import { memorySkins, useSkins, type SkinStore } from "$lib/llm/skinStore";
import type { ImageCall, ImageResult, Provider } from "$lib/llm/provider";
import { assembleSkin, type CaseSkin, type WriterOutput } from "$lib/llm/skin/schema";
import { storeKey, forgetKey } from "$lib/llm/key";

import { loadCaseInline, useLoader } from "./cases";
import {
  artUrls,
  game,
  newCase,
  openCaseText,
  panel,
  screen,
  start,
  updateSettings,
  useArtProvider,
  useClock,
} from "./controller";
import { memoryStore, useStore } from "./storage";

let skinStore: SkinStore;
let artStore: ArtStore;

/** A real key's shape; nothing here reaches a network. */
const FAKE_KEY = "AIza" + "x".repeat(35);

beforeEach(async () => {
  // `startArt` is fire-and-forget by design, so a run from the previous test
  // can still be between two dynamic imports when this one begins. Stopped
  // and given a tick to notice, or it picks up the next test's provider and
  // the call counts here measure two tests at once.
  const { cancelArt } = await import("./controller");
  cancelArt();
  game.set(null);
  await new Promise((r) => setTimeout(r, 0));

  start();
  useStore(memoryStore());
  useLoader(loadCaseInline);
  useClock(() => 1_000_000);
  skinStore = memorySkins();
  useSkins(skinStore);
  artStore = memoryArt();
  useArt(artStore);
  useArtProvider(null);
  forgetKey();
  game.set(null);
  screen.set("home");
  panel.set({ kind: "none" });
  artUrls.set({});
  updateSettings({ imageQuality: "off" });
});

function skinFor(rooms: number, slots: number, people: number): CaseSkin {
  const written: WriterOutput = {
    title: "The Lamp Room",
    place: "a lighthouse on a sandbar",
    era: "1923",
    styleGuide: "salt light",
    rooms: Array.from({ length: rooms }, (_, r) => ({ name: `Room ${r}`, code: `Z${r}`, description: "" })),
    slots: Array.from({ length: slots }, (_, t) => `hour ${t}`),
    people: Array.from({ length: people }, (_, p) => ({
      name: `Person ${p}`,
      role: "somebody",
      bio: "",
      voice: "",
      motive: "a debt",
      portrait: `a face, number ${p}`,
    })),
    prose: [],
    silence: Array.from({ length: people }, () => "Nothing to say."),
    briefing: "It was a dark evening.",
    scene: "a lighthouse in a storm",
  };
  return assembleSkin(written, {
    setting: "a lighthouse in a storm, 1923",
    language: "en",
    prose: {},
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    summingUp: null,
  });
}

interface Painter {
  provider: Provider;
  calls: ImageCall[];
  /** Resolves whatever call is waiting. */
  release: () => void;
  settled: (until?: () => boolean) => Promise<void>;
}

/**
 * An image provider whose calls finish only when told to.
 *
 * The whole point of the exit criterion is that the game is on screen while
 * these are still in the air, so a stub that answers instantly could not tell
 * a correct implementation from one that awaits the lot.
 */
function painter(fail?: (call: ImageCall) => LlmError | null): Painter {
  const calls: ImageCall[] = [];
  let unblock: (() => void) | null = null;
  const gate = () =>
    new Promise<void>((resolve) => {
      unblock = resolve;
    });
  let chain: Promise<unknown> = Promise.resolve();

  const provider: Provider = {
    name: "painter",
    generateJSON: async () => ({}),
    generateImage: async (call) => {
      calls.push(call);
      const wait = gate();
      chain = chain.then(() => wait);
      await wait;
      const oops = fail?.(call);
      if (oops) throw oops;
      const bytes = new Uint8Array([137, 80, 78, 71, calls.length]);
      return { mime: "image/png", bytes } satisfies ImageResult;
    },
  };

  return {
    provider,
    calls,
    release: () => {
      unblock?.();
      unblock = null;
    },
    /**
     * Wait for the art run to get where it is going.
     *
     * Polls for a condition rather than counting ticks. `startArt` reaches
     * the provider through four dynamic `import()`s and a read of the art
     * store, so a fixed number of turns is a guess — and a guess that passes
     * alone and fails under a loaded machine, which is the worst kind of
     * test. With no condition it settles for "nothing more is happening".
     */
    settled: async (until?: () => boolean) => {
      for (let i = 0; i < 200; i++) {
        if (until?.()) return;
        await new Promise((r) => setTimeout(r, 1));
      }
      if (until) throw new Error("the art run never got there");
    },
  };
}

async function dressedCase(quality: "off" | "fast" = "fast") {
  const id = newCaseId("easy", "art1");
  await openCaseText(formatCaseId(id));
  const g = get(game)!;
  await skinStore.put(
    formatCaseId(id),
    skinFor(g.case.frame.plan.rooms.length, g.case.frame.slots, g.case.frame.people),
  );
  game.set(null);
  artUrls.set({});
  updateSettings({ imageQuality: quality });
  storeKey(FAKE_KEY);
  await openCaseText(formatCaseId(id));
  return get(game)!;
}

describe("a case with art turned off", () => {
  it("makes no image call at all", async () => {
    const paint = painter();
    useArtProvider(() => paint.provider);
    await dressedCase("off");
    await paint.settled();
    expect(paint.calls).toHaveLength(0);
    expect(get(artUrls)).toEqual({});
  });

  it("is still a complete case", async () => {
    const g = await dressedCase("off");
    expect(g.skin).not.toBeNull();
    expect(get(screen)).toBe("briefing");
  });
});

describe("a case with art turned on", () => {
  it("is on screen before a single picture has arrived", async () => {
    // The exit criterion, and the one thing in this wave that a reviewer
    // should be hardest on. `startArt` is called after `showGame` and is not
    // awaited; if that is ever reversed, this is what notices.
    const paint = painter();
    useArtProvider(() => paint.provider);
    await dressedCase("fast");

    expect(get(game)).not.toBeNull();
    expect(get(screen)).toBe("briefing");
    // Nothing has been released, so nothing can have landed.
    expect(get(artUrls)).toEqual({});
  });

  it("never blocks the case on an image that never comes back", async () => {
    const paint = painter();
    useArtProvider(() => paint.provider);
    // No release is ever called. The case still opens, the player still
    // plays, and the promise stays in the air until the tab closes.
    const g = await dressedCase("fast");
    expect(g.case).toBeTruthy();
    expect(get(screen)).toBe("briefing");
  });

  it("asks for the cast and the place, portraits first", async () => {
    const paint = painter();
    useArtProvider(() => paint.provider);
    await dressedCase("fast");
    await paint.settled(() => paint.calls.length > 0);
    // Exactly one: nothing releases the gate, so the run is parked on the
    // first picture and cannot have started a second.
    expect(paint.calls).toHaveLength(1);
    // One in flight at a time, and the first is a face rather than the scene.
    expect(paint.calls[0].prompt.startsWith("a face, number 0")).toBe(true);
    expect(paint.calls[0].aspect).toBe("1:1");
  });

  it("does not spend a penny without a key", async () => {
    const paint = painter();
    useArtProvider(() => paint.provider);
    const id = newCaseId("easy", "art1");
    await openCaseText(formatCaseId(id));
    const g = get(game)!;
    await skinStore.put(
      formatCaseId(id),
      skinFor(g.case.frame.plan.rooms.length, g.case.frame.slots, g.case.frame.people),
    );
    game.set(null);
    updateSettings({ imageQuality: "fast" });
    forgetKey();
    await openCaseText(formatCaseId(id));
    await paint.settled();
    expect(paint.calls).toHaveLength(0);
  });

  it("does not paint a case the model never dressed", async () => {
    // No skin means no portrait prompts, and a prompt invented here would be
    // a picture of nobody in particular at the same price as a good one.
    const paint = painter();
    useArtProvider(() => paint.provider);
    updateSettings({ imageQuality: "fast" });
    storeKey(FAKE_KEY);
    await newCase("easy");
    await paint.settled();
    expect(get(game)!.skin).toBeNull();
    expect(paint.calls).toHaveLength(0);
  });
});

describe("what is already on disk", () => {
  it("is not paid for a second time", async () => {
    const id = formatCaseId(newCaseId("easy", "art1"));
    // Two portraits stored from an earlier sitting.
    await artStore.put(id, "p0", { mime: "image/png", bytes: new Uint8Array([1]) });
    await artStore.put(id, "p1", { mime: "image/png", bytes: new Uint8Array([2]) });

    const paint = painter();
    useArtProvider(() => paint.provider);
    await dressedCase("fast");
    await paint.settled(() => paint.calls.length > 0);

    const asked = paint.calls.map((c) => c.prompt.split(/\r?\n/)[0]);
    expect(asked).not.toContain("a face, number 0");
    expect(asked).not.toContain("a face, number 1");
  });
});

describe("leaving a case", () => {
  it("drops the pictures, so the next case never wears the last one's faces", async () => {
    const { abandon } = await import("./controller");
    const paint = painter();
    useArtProvider(() => paint.provider);
    await dressedCase("fast");
    artUrls.set({ p0: "blob:pretend" });
    abandon();
    expect(get(artUrls)).toEqual({});
  });
});
