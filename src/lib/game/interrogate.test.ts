/**
 * Wave 6 where it meets the game: the same questions, typed.
 *
 * The exit criterion is that a case is solvable through free text alone and
 * through the picker alone, with the same cards available either way, and
 * that is what most of this file is about. The rest is the leak: the prompts
 * the controller builds must not move when the answer does, and must not move
 * when what the bank holds does.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { formatCaseId, newCaseId } from "$lib/engine/caseId";
import { allCards, ask } from "$lib/engine/generator/bank";
import type { GeneratedCase } from "$lib/engine/generator/generate";
import type { PersonId, TopicKey } from "$lib/engine/types";
import { LlmError } from "$lib/llm/errors";
import { stubProvider, type StubProvider } from "$lib/llm/stub";
import { memorySkins, useSkins, type SkinStore } from "$lib/llm/skinStore";
import { assembleSkin, type CaseSkin, type WriterOutput } from "$lib/llm/skin/schema";

import { loadCaseInline, useLoader } from "./cases";
import {
  PLAIN_SILENCE,
  answering,
  askAbout,
  canConverse,
  cards,
  chat,
  explain,
  game,
  openCaseText,
  panel,
  putQuestion,
  resume,
  screen,
  start,
  updateSettings,
  useAskProvider,
  useClock,
} from "./controller";
import { KEYS, memoryStore, useStore, writeText } from "./storage";
import { askKey } from "./types";

const ID = newCaseId("normal", "w6game");
const TEXT = formatCaseId(ID);

/** Shaped like a real key so `llm/key.ts` accepts it; it reaches nothing. */
const FAKE_KEY = `AIza${"x".repeat(35)}`;

let store: SkinStore;

beforeEach(() => {
  start();
  useStore(memoryStore());
  useLoader(loadCaseInline);
  useClock(() => 1_000_000);
  store = memorySkins();
  useSkins(store);
  useAskProvider(null);
  game.set(null);
  screen.set("home");
  panel.set({ kind: "none" });
  answering.set(null);
  updateSettings({ autoNotes: true });
  writeText(KEYS.key, FAKE_KEY);
});

function skinFor(kase: GeneratedCase, silence = "I wish I could help you."): CaseSkin {
  const frame = kase.frame;
  const written: WriterOutput = {
    title: "The Lamp Room",
    place: "a lighthouse on a sandbar",
    era: "1923",
    styleGuide: "salt light",
    rooms: Array.from({ length: frame.plan.rooms.length }, (_, r) => ({
      name: `THE-ROOM-${r}`,
      code: `Z${r}`,
      description: "",
    })),
    slots: Array.from({ length: frame.slots }, (_, t) => `THE-HOUR-${t}`),
    people: Array.from({ length: frame.people }, (_, p) => ({
      name: `THE-PERSON-${p}`,
      role: "the keeper",
      bio: "A life on the sand.",
      voice: "Clipped.",
      motive: `THE-MOTIVE-${p}`,
      portrait: "",
    })),
    prose: [],
    silence: Array.from({ length: frame.people }, () => silence),
    briefing: "THE-BRIEFING",
    scene: "",
  };
  return assembleSkin(written, {
    setting: "a lighthouse in a storm, 1923",
    language: "en",
    prose: {},
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    summingUp: null,
  });
}

/** Open the fixture case, dressed, so there is a voice to speak in. */
async function dressed(silence?: string) {
  await openCaseText(TEXT);
  const probe = get(game)!;
  await store.put(TEXT, skinFor(probe.case, silence));
  game.set(null);
  await openCaseText(TEXT);
  return get(game)!;
}

/** A question the bank can actually answer, found rather than assumed. */
function answerableTopic(kase: GeneratedCase): { suspect: PersonId; key: TopicKey } {
  for (let s = 0; s < kase.frame.suspects; s++) {
    for (let t = 0; t < kase.frame.slots; t++) {
      const key = `slot:${t}`;
      if (ask(kase.bank, s, key).length > 0) return { suspect: s, key };
    }
  }
  throw new Error("this case answers nothing, which generate.ts would have rejected");
}

/** call 0 routes, call 1 voices. */
function scripted(choice: string, reply: (sentences: string) => string): StubProvider {
  const stub: StubProvider = stubProvider({
    answer: (call, index) => {
      if (index % 2 === 0) return { choice };
      // Echo back whatever the voice prompt was told to say, so the guard is
      // being exercised on the real sentences rather than on a fixture.
      const lines = call.user.split("WHAT YOU TELL THEM")[1] ?? "";
      const said = lines
        .split("\n")
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l !== "")
        .join(" ");
      return { reply: reply(said) };
    },
  });
  return stub;
}

describe("free text is a layer over the picker", () => {
  it("releases exactly the cards the picker would", async () => {
    const first = await dressed();
    const { suspect, key } = answerableTopic(first.case);

    // The picker.
    askAbout(suspect, key);
    const byButton = {
      collected: [...get(game)!.collected],
      spent: [...get(game)!.spent],
    };

    // The same question, typed.
    game.set(null);
    await dressed();
    useAskProvider(() => scripted(key, (said) => `Very well. ${said}`));
    await putQuestion(suspect, "where were you that evening?");

    expect(get(game)!.collected).toEqual(byButton.collected);
    expect(get(game)!.spent).toEqual(byButton.spent);
    expect(get(game)!.spent).toEqual([askKey(suspect, key)]);
  });

  it("charges a typed question once, like the button", async () => {
    const g = await dressed();
    const { suspect, key } = answerableTopic(g.case);
    useAskProvider(() => scripted(key, (said) => `Very well. ${said}`));
    await putQuestion(suspect, "where were you?");
    await putQuestion(suspect, "and where were you, again?");
    expect(get(game)!.spent).toEqual([askKey(suspect, key)]);
  });

  it("charges nothing for small talk", async () => {
    const g = await dressed();
    useAskProvider(() => scripted("smalltalk", () => "Good evening to you."));
    await putQuestion(0, "good evening");
    expect(get(game)!.spent).toEqual([]);
    expect(get(game)!.collected).toEqual([]);
    expect(get(chat).at(-1)).toMatchObject({ from: "suspect" });
    expect(g.case.frame.people).toBeGreaterThan(0);
  });

  it("quotes the sentence the evidence pane shows, not the raw prose map", async () => {
    const g = await dressed();
    const { suspect, key } = answerableTopic(g.case);
    const ids = ask(g.case.bank, suspect, key);
    useAskProvider(() => scripted(key, (said) => said));
    await putQuestion(suspect, "where were you?");

    const shown = get(explain)!;
    const clue = get(cards).find((c) => c.id === ids[0])!;
    expect(get(chat).at(-1)!.text).toContain(shown.clue(clue));
    expect(get(chat).at(-1)!.cards).toEqual([...ids]);
  });
});

/*
 * The leak tests, at the level where the prompts are actually built.
 *
 * `classify.test.ts` proves the builder cannot move; these prove the caller
 * does not feed it something that can.
 */
describe("what the controller sends", () => {
  async function promptFor(mutate: (g: GeneratedCase) => GeneratedCase): Promise<string> {
    await dressed();
    const live = get(game)!;
    game.set({ ...live, case: mutate(live.case) });
    const stub = scripted("too_broad", () => "");
    useAskProvider(() => stub);
    await putQuestion(0, "where were you at nine?");
    return stub.calls[0].user;
  }

  it("builds the same routing prompt whoever the killer is", async () => {
    const real = await promptFor((c) => c);
    for (const culprit of [0, 1, 2]) {
      const other = await promptFor((c) => ({ ...c, world: { ...c.world, culprit } }));
      expect(other).toBe(real);
    }
  });

  it("builds the same routing prompt whenever the murder was", async () => {
    const real = await promptFor((c) => c);
    for (const murderSlot of [0, 1, 2]) {
      const other = await promptFor((c) => ({ ...c, world: { ...c.world, murderSlot } }));
      expect(other).toBe(real);
    }
  });

  /*
   * The leak this wave could invent and wave 5 could not.
   *
   * `topicsFor` offers every hour, every other person and every room whether
   * or not the bank has anything filed under them. Narrowing that list to the
   * topics that would release something is an obvious-looking optimisation
   * that would hand the model — and through its choices, the player — a map
   * of where the evidence is. Same family as `bank.ts#silenceLeaks`.
   */
  it("offers every topic even when the bank holds nothing at all", async () => {
    const real = await promptFor((c) => c);
    const gutted = await promptFor((c) => ({
      ...c,
      bank: { ...c.bank, said: new Map(), found: new Map() },
    }));
    expect(gutted).toBe(real);
  });

  it("sends no card, in any form, to the router", async () => {
    await dressed();
    const held = get(game)!.case;
    const stub = scripted("too_broad", () => "");
    useAskProvider(() => stub);
    await putQuestion(0, "what do you know?");
    const prompt = stub.calls[0].user;
    for (const clue of [...held.opening, ...allCards(held.bank)]) {
      expect(prompt).not.toContain(clue.id);
    }
  });
});

describe("the transcript", () => {
  it("keeps the question, the reply and the cards, and survives a reload", async () => {
    const g = await dressed();
    const { suspect, key } = answerableTopic(g.case);
    useAskProvider(() => scripted(key, (said) => `Very well. ${said}`));
    await putQuestion(suspect, "where were you?");

    const before = get(chat);
    expect(before).toHaveLength(2);
    expect(before[0]).toMatchObject({ who: suspect, from: "player" });
    expect(before[1]).toMatchObject({ who: suspect, from: "suspect" });

    game.set(null);
    await resume();
    expect(get(chat)).toEqual(before);
  });

  it("leaves a note when the question could not be sent", async () => {
    await dressed();
    useAskProvider(() =>
      stubProvider({ answer: () => new LlmError("quota", "slow down") }),
    );
    await putQuestion(0, "where were you?");
    const last = get(chat).at(-1)!;
    expect(last.from).toBe("note");
    expect(last.text).toContain("rate limited");
    // The note is never sent back to a model: the next question's history
    // must not contain it.
    const stub = scripted("too_broad", () => "");
    useAskProvider(() => stub);
    await putQuestion(0, "again then");
    expect(stub.calls[0].user).not.toContain(last.text);
  });

  it("says nothing at all when the player cancels", async () => {
    await dressed();
    useAskProvider(() =>
      stubProvider({ answer: () => new LlmError("cancelled", "cancelled") }),
    );
    await putQuestion(0, "where were you?");
    expect(get(chat).map((t) => t.from)).toEqual(["player"]);
  });
});

describe("when free text is on offer", () => {
  it("needs a key and a skin, and the picker works without either", async () => {
    await openCaseText(TEXT);
    expect(canConverse()).toBe(false); // a key, but no skin

    await dressed();
    expect(canConverse()).toBe(true);

    writeText(KEYS.key, "");
    expect(canConverse()).toBe(false); // a skin, but no key — a shipped pack
  });

  it("does nothing at all when it is not on offer", async () => {
    await openCaseText(TEXT);
    const stub = scripted("slot:0", () => "");
    useAskProvider(() => stub);
    await putQuestion(0, "where were you?");
    expect(stub.calls).toHaveLength(0);
    expect(get(chat)).toEqual([]);
  });

  it("uses the engine's own line when the skin's makes a claim", async () => {
    await dressed("I was in THE-ROOM-1 the whole evening.");
    useAskProvider(() => scripted("smalltalk", () => "I went up at THE-HOUR-2."));
    await putQuestion(0, "good evening");
    expect(get(chat).at(-1)!.text).toBe(PLAIN_SILENCE);
  });
});
