/**
 * Resuming a shipped case.
 *
 * A pack stores the whole case rather than its seed, on purpose — `pack.ts`
 * says why at length. Before wave 8 the save held only the id, so "Carry on"
 * rebuilt a shipped case from its id: the prose and the pictures that came in
 * the file were gone, and after any tuning change to the generator the puzzle
 * underneath would have been a different one with the old marks on it.
 *
 * The tests below are written so that they fail if the branch is removed,
 * which means each one has to check something the *rebuilt* case would not
 * have. A rebuilt case has the same frame, so asserting on the frame proves
 * nothing — that is the shape of mistake waves 1-3 kept finding, and the
 * skin is the thing the two paths genuinely disagree about.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { formatCaseId, newCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import { encodePack, packFor, type CasePack } from "$lib/llm/pack";
import { useFetch } from "$lib/llm/packLoader";
import { memorySkins, useSkins } from "$lib/llm/skinStore";
import { assembleSkin, type CaseSkin, type WriterOutput } from "$lib/llm/skin/schema";

import { loadCaseInline, useLoader } from "./cases";
import {
  accuse,
  coach,
  flush,
  game,
  lesson,
  markRoom,
  openPackCase,
  panel,
  resume,
  screen,
  start,
  stats,
  updateSettings,
  useClock,
} from "./controller";
import { loadSave, memoryStore, useStore } from "./storage";
import { LESSONS, TUTORIAL_PACK, coachStep } from "./tutorial";

const PACK = "testpack";

/** The grade lesson two actually carries, asserted rather than assumed. */
const LESSON_DIFFICULTY = "hard";

function skinFor(rooms: number, slots: number, people: number): CaseSkin {
  const written: WriterOutput = {
    title: "SHIPPED-TITLE",
    place: "a shipped place",
    era: "1923",
    styleGuide: "",
    rooms: Array.from({ length: rooms }, (_, r) => ({
      name: `SHIPPED-ROOM-${r}`,
      code: `S${r}`,
      description: "",
    })),
    slots: Array.from({ length: slots }, (_, t) => `SHIPPED-HOUR-${t}`),
    people: Array.from({ length: people }, (_, p) => ({
      name: `SHIPPED-PERSON-${p}`,
      role: "",
      bio: "",
      voice: "",
      motive: "a debt",
      portrait: "",
    })),
    prose: [],
    silence: Array.from({ length: people }, () => "Nothing to say."),
    briefing: "SHIPPED-BRIEFING",
    scene: "",
  };
  return assembleSkin(written, {
    setting: "a shipped setting",
    language: "en",
    prose: {},
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
    summingUp: "SHIPPED-SPEECH",
  });
}

/** The pack file the fake fetch serves, built once per test. */
let shipped: CasePack;

function serve(): void {
  useFetch((async (input: RequestInfo | URL) => {
    const path = String(input);
    const body =
      path === `/cases/${PACK}/${shipped.id}.json` ? encodePack(shipped) : null;
    return {
      ok: body !== null,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch);
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

  const id = newCaseId("easy", "ship1");
  const built = generate(id).case!;
  const frame = built.frame;
  shipped = packFor(
    id,
    built,
    skinFor(frame.plan.rooms.length, frame.slots, frame.people),
    ["p0", "scene"],
  );
  serve();
});

describe("a shipped case", () => {
  it("opens with the prose that came in the file", async () => {
    expect(await openPackCase(shipped.id, PACK)).toBe(true);
    expect(get(game)!.skin!.title).toBe("SHIPPED-TITLE");
  });

  it("records the pack it came from in the save", async () => {
    await openPackCase(shipped.id, PACK);
    flush();
    expect(loadSave()!.pack).toBe(PACK);
  });

  it("keeps its prose across a resume", async () => {
    await openPackCase(shipped.id, PACK);
    flush();
    game.set(null);

    expect(await resume()).toBe(true);
    // The assertion that fails if `resume` rebuilds from the id: a rebuilt
    // case has the same frame and no skin at all.
    expect(get(game)!.skin).not.toBeNull();
    expect(get(game)!.skin!.title).toBe("SHIPPED-TITLE");
  });

  it("keeps the player's marks across a resume", async () => {
    await openPackCase(shipped.id, PACK);
    const before = get(game)!;
    markRoom(0, 0, before.case.frame.plan.rooms[0].id);
    flush();
    const saved = loadSave()!;
    game.set(null);

    await resume();
    expect(get(game)!.history.present.ruledOut).toEqual(saved.notebook.ruledOut);
    expect(get(screen)).toBe("investigate");
  });
});

/*
 * The lessons, served from the files that actually ship, because the thing
 * being checked is a property of those files and of the controller together.
 */
describe("a tutorial case", () => {
  const LESSON = LESSONS[1]; // the lying one, which grades Hard

  beforeEach(() => {
    const path = `static/cases/${TUTORIAL_PACK}/${LESSON.id}.json`;
    const body = JSON.parse(readFileSync(path, "utf8")) as unknown;
    useFetch((async (input: RequestInfo | URL) => {
      const ok = String(input) === `/cases/${TUTORIAL_PACK}/${LESSON.id}.json`;
      return { ok, json: async () => (ok ? body : null) } as unknown as Response;
    }) as typeof fetch);
  });

  it("puts a lesson on screen with its coach strip running", async () => {
    expect(await openPackCase(LESSON.id, TUTORIAL_PACK)).toBe(true);
    expect(get(lesson)).toBe(LESSON);
    expect(get(coach)).not.toBeNull();
    expect(coachStep(LESSON, get(coach)!)!.id).toBe(LESSON.steps[0].id);
  });

  /*
   * The objection that ruled out making the tutorial a fifth preset — "a
   * tutorial is not a difficulty anybody should have a best time in" —
   * applies to the pack route too, through `recordStart`. This is the test
   * that says so.
   */
  it("is not recorded in the player's statistics", async () => {
    const before = get(stats)[LESSON_DIFFICULTY].started;
    await openPackCase(LESSON.id, TUTORIAL_PACK);
    expect(get(game)!.case.difficulty).toBe(LESSON_DIFFICULTY);
    expect(get(stats)[LESSON_DIFFICULTY].started).toBe(before);
  });

  it("is not recorded when it is solved either", async () => {
    await openPackCase(LESSON.id, TUTORIAL_PACK);
    const g = get(game)!;
    const before = get(stats)[LESSON_DIFFICULTY].solved;
    const verdict = accuse(g.case.world.culprit, g.case.world.murderSlot);
    expect(verdict.right).toBe(true);
    expect(get(screen)).toBe("summary");
    expect(get(stats)[LESSON_DIFFICULTY].solved).toBe(before);
  });

  it("is still a real case, proved the same way as any other", async () => {
    await openPackCase(LESSON.id, TUTORIAL_PACK);
    const g = get(game)!;
    // Wrong answers are still wrong: the win never goes through a solver and
    // a lesson is not exempt from that (invariant 5).
    const other = (g.case.world.culprit + 1) % g.case.frame.suspects;
    expect(accuse(other, g.case.world.murderSlot).right).toBe(false);
  });

  it("counts the player's own notebook edits and not auto-notes", async () => {
    await openPackCase(LESSON.id, TUTORIAL_PACK);
    // Auto-notes has already pencilled the case file's consequences in, so
    // the grid is not blank — but the player has not touched it.
    expect(get(coach)!.marked).toBe(0);
    const g = get(game)!;
    markRoom(0, 0, g.case.frame.plan.rooms[0].id);
    expect(get(coach)!.marked).toBe(1);
  });
});

describe("a generated case", () => {
  it("records no pack, so resume still rebuilds it", async () => {
    const id = newCaseId("easy", "gen1");
    const { openCaseText } = await import("./controller");
    await openCaseText(formatCaseId(id));
    flush();
    expect(loadSave()!.pack).toBeUndefined();

    game.set(null);
    expect(await resume()).toBe(true);
    expect(get(game)!.text).toBe(formatCaseId(id));
  });
});
