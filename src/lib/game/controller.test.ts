import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { formatCaseId, newCaseId } from "$lib/engine/caseId";
import { allCards } from "$lib/engine/generator/bank";
import { topic } from "$lib/engine/types";

import { loadCaseInline, useLoader } from "./cases";
import {
  abandon,
  accuse,
  alreadyAsked,
  askAbout,
  askForHint,
  cards,
  checkNotebook,
  clearSuspect,
  errors,
  examineRoom,
  explain,
  flush,
  game,
  markRoom,
  newCase,
  openCaseText,
  panel,
  placeIn,
  redoMark,
  resume,
  ruleOutSlot,
  savedCaseId,
  screen,
  settings,
  start,
  stats,
  summingUp,
  undoMark,
  updateSettings,
  useClock,
} from "./controller";
import { cellState } from "./notebook";
import { loadSave, memoryStore, useStore, writeSave } from "./storage";
import { askKey, examineKey } from "./types";
import type { KeyValue } from "./storage";

let store: KeyValue;
let clock = 1_000_000;

beforeEach(() => {
  store = memoryStore();
  start();
  useStore(store);
  useLoader(loadCaseInline);
  clock = 1_000_000;
  useClock(() => clock);
  game.set(null);
  screen.set("home");
  panel.set({ kind: "none" });
  updateSettings({ autoNotes: true });
});

const live = () => {
  const g = get(game);
  if (!g) throw new Error("no case loaded");
  return g;
};

describe("opening a case", () => {
  it("builds it, shows the briefing and counts the start", () => {
    return (async () => {
      await newCase("easy");
      const g = live();
      expect(g.case.difficulty).toBeTypeOf("string");
      expect(get(screen)).toBe("briefing");
      expect(get(stats)[g.case.difficulty].started).toBe(1);
      // The opening is in hand before anything is asked.
      expect(get(cards).length).toBe(g.case.opening.length);
      expect(g.spent).toEqual([]);
    })();
  });

  it("opens a case by its number, and refuses a number that is not one", async () => {
    const ok = await openCaseText(" sk1-e-3f9k2a ");
    expect(ok).toBe(true);
    expect(live().text).toBe("SK1-E-3f9k2a");

    const bad = await openCaseText("not a case");
    expect(bad).toBe(false);
    expect(get(panel).kind).toBe("error");
    // ...and the case that was open stays open.
    expect(live().text).toBe("SK1-E-3f9k2a");
  });

  it("rebuilds the same case from the same number", async () => {
    await openCaseText("SK1-N-3f9k2a");
    const first = live().case;
    await openCaseText("SK1-N-3f9k2a");
    const again = live().case;
    expect(again.world).toEqual(first.world);
    expect(again.essential.map((c) => c.id)).toEqual(
      first.essential.map((c) => c.id),
    );
  });
});

describe("the actions", () => {
  it("collects what a search turns up, and charges for it once", async () => {
    await newCase("easy");
    const g = live();
    const room = [...g.case.bank.found.keys()].find(
      (r) => (g.case.bank.found.get(r) ?? []).length > 0,
    );
    expect(room, "no room in this case gives anything up").toBeDefined();

    const before = get(cards).length;
    examineRoom(room as number);
    expect(get(cards).length).toBeGreaterThan(before);
    expect(live().spent).toEqual([examineKey(room as number)]);
    expect(alreadyAsked(examineKey(room as number))).toBe(true);

    // Asking again shows the same answer and costs nothing more.
    const held = get(cards).length;
    examineRoom(room as number);
    expect(live().spent.length).toBe(1);
    expect(get(cards).length).toBe(held);
    expect(get(panel).kind).toBe("card");
  });

  /**
   * The card list's order IS the card numbering.
   *
   * `explainer` labels cards by their position in the list it is given, so
   * "Card 3" in a hint means Card 3 in the evidence pane only as long as
   * there is one list in one order. A mutation pass reversed the collected
   * half and every test stayed green, which means nothing was holding the
   * promise the controller's own header paragraph makes.
   */
  it("numbers cards by when they were found, opening first", async () => {
    await newCase("normal");
    const g = live();
    const opening = g.case.opening.map((c) => c.id);
    const found: string[] = [];
    for (const [room, ids] of g.case.bank.found) {
      if (ids.length === 0) continue;
      examineRoom(room);
      for (const id of ids) if (!found.includes(id)) found.push(id);
      if (found.length >= 3) break;
    }
    expect(found.length, "this case gave nothing up to a search").toBeGreaterThan(0);

    expect(get(cards).map((c) => c.id)).toEqual([...opening, ...found]);
    expect(live().collected).toEqual(found);

    // ...and the labels follow the same list, which is the point of it.
    const ex = get(explain)!;
    expect(ex.cardLabel(opening[0])).toBe("Card 1");
    expect(ex.cardLabel(found[0])).toBe(`Card ${opening.length + 1}`);
  });

  it("says so when a question turns up nothing, and still charges for it", async () => {
    await newCase("easy");
    const g = live();
    // A suspect asked about themselves is always silent — that is the motive
    // question, and `bank.ts` says so.
    askAbout(0, topic.person(0));
    expect(get(panel).kind).toBe("nothing");
    expect(live().spent).toEqual([askKey(0, topic.person(0))]);
    expect(get(cards).length).toBe(g.case.opening.length);
  });

  it("writes the direct consequences down when auto-notes is on", async () => {
    updateSettings({ autoNotes: true });
    await newCase("normal");
    const g = live();
    const before = JSON.stringify(g.history.present.ruledOut);
    const depth = g.history.past.length;
    for (const [room, ids] of g.case.bank.found) {
      if (ids.length > 0) examineRoom(room);
    }
    expect(JSON.stringify(live().history.present.ruledOut)).not.toBe(before);

    // ...and every bit of it is undoable, because it went through the same
    // history the player's own marks do. One undo per state recorded: a
    // search that adds nothing to the grid records nothing to take back.
    const added = live().history.past.length - depth;
    expect(added).toBeGreaterThan(0);
    for (let i = 0; i < added; i++) undoMark();
    expect(JSON.stringify(live().history.present.ruledOut)).toBe(before);
  });

  /**
   * Found by the headless play-through, not by a unit test, which is the
   * argument for having one: auto-notes fired when a card was collected, and
   * the opening is never collected, so a case opened with the setting on sat
   * on a blank grid while the hint panel recited deductions the setting had
   * promised to make.
   */
  it("starts the grid with what the case file already implies", async () => {
    updateSettings({ autoNotes: true });
    await newCase("easy");
    const g = live();
    const frame = g.case.frame;
    expect(cellState(frame, g.history.present, frame.victim, frame.slots - 1).set).toBe(
      frame.murderRoom,
    );
  });

  it("starts blank when auto-notes is off", async () => {
    updateSettings({ autoNotes: false });
    await newCase("easy");
    const g = live();
    expect(g.history.present.ruledOut.flat().every((m) => m === 0)).toBe(true);
  });

  it("catches the grid up when auto-notes is switched on mid-case", async () => {
    updateSettings({ autoNotes: false });
    await newCase("easy");
    const frame = live().case.frame;
    expect(cellState(frame, live().history.present, frame.victim, frame.slots - 1).set)
      .toBe(-1);
    updateSettings({ autoNotes: true });
    expect(cellState(frame, live().history.present, frame.victim, frame.slots - 1).set)
      .toBe(frame.murderRoom);
  });

  it("leaves the notebook alone when auto-notes is off", async () => {
    await newCase("normal");
    updateSettings({ autoNotes: false });
    const g = live();
    const before = JSON.stringify(g.history.present);
    for (const [room, ids] of g.case.bank.found) {
      if (ids.length > 0) examineRoom(room);
    }
    expect(JSON.stringify(live().history.present)).toBe(before);
  });
});

describe("the notebook, through the controller", () => {
  it("marks, undoes and redoes", async () => {
    await newCase("easy");
    updateSettings({ autoNotes: false });
    const blank = JSON.stringify(live().history.present);
    markRoom(0, 0, 1);
    placeIn(1, 1, 0);
    clearSuspect(2);
    ruleOutSlot(1);
    const filled = JSON.stringify(live().history.present);
    expect(filled).not.toBe(blank);

    undoMark();
    undoMark();
    undoMark();
    undoMark();
    expect(JSON.stringify(live().history.present)).toBe(blank);
    redoMark();
    redoMark();
    redoMark();
    redoMark();
    expect(JSON.stringify(live().history.present)).toBe(filled);
  });

  it("surfaces an uncompletable state without being asked", async () => {
    await newCase("easy");
    expect(get(errors)).toEqual([]);
    const frame = live().case.frame;
    for (let s = 0; s < frame.suspects; s++) clearSuspect(s);
    expect(get(errors).map((e) => e.kind)).toContain("no-suspects");
  });
});

describe("hints and the check", () => {
  it("charges for a hint once, however many times it is asked for", async () => {
    await newCase("easy");
    askForHint();
    expect(live().hints).toBe(1);
    const first = get(panel);
    askForHint();
    expect(live().hints).toBe(1);
    expect(get(panel)).toEqual(first);
  });

  it("charges again once the hint has changed", async () => {
    await newCase("easy");
    askForHint();
    const first = get(panel);
    if (first.kind !== "hint") throw new Error("expected a hint");
    expect(live().hints).toBe(1);

    // Cross out a room somebody was really in. The next hint is branch 1 —
    // "something you crossed out is true" — which is certainly a different
    // sentence, so it is a different hint and it is charged for.
    markRoom(0, 0, live().case.world.loc[0][0]);
    askForHint();
    const second = get(panel);
    if (second.kind !== "hint") throw new Error("expected a hint");
    expect(second.hint.kind).toBe("mistake");
    expect(second.hint.text).not.toBe(first.hint.text);
    expect(live().hints).toBe(2);
  });

  it("answers the check from the truth, both ways round", async () => {
    await newCase("easy");
    const g = live();
    checkNotebook();
    let shown = get(panel);
    expect(shown.kind === "check" && shown.sound).toBe(true);
    expect(live().checks).toBe(1);

    // Cross out the room somebody was really in.
    markRoom(0, 0, g.case.world.loc[0][0]);
    checkNotebook();
    shown = get(panel);
    expect(shown.kind === "check" && shown.sound).toBe(false);
    expect(live().checks).toBe(2);
  });
});

describe("the accusation", () => {
  it("records a wrong one and carries on", async () => {
    await newCase("easy");
    const g = live();
    const wrongSlot = (g.case.world.murderSlot + 1) % g.case.frame.slots;
    const verdict = accuse(g.case.world.culprit, wrongSlot);
    expect(verdict.right).toBe(false);
    expect(live().wrong).toEqual([
      { culprit: g.case.world.culprit, slot: wrongSlot },
    ]);
    expect(live().solved).toBe(false);
    expect(get(screen)).toBe("briefing");
  });

  it("accepts the right one, stops the clock and writes the record", async () => {
    await newCase("easy");
    const g = live();
    clock += 90_000;
    const verdict = accuse(g.case.world.culprit, g.case.world.murderSlot);
    expect(verdict.right).toBe(true);
    expect(live().solved).toBe(true);
    expect(live().ms).toBe(90_000);
    expect(get(screen)).toBe("summary");
    const row = get(stats)[g.case.difficulty];
    expect(row.solved).toBe(1);
    expect(row.bestMs).toBe(90_000);
    expect(row.streak).toBe(1);
  });

  /**
   * Invariant 5 made concrete: the verdict is the stored truth and nothing
   * else, so a notebook that says otherwise cannot change it in either
   * direction.
   */
  it("ignores the notebook entirely", async () => {
    await newCase("easy");
    const g = live();
    const frame = g.case.frame;
    // Cross off the real culprit and the real hour, then name them anyway.
    clearSuspect(g.case.world.culprit);
    ruleOutSlot(g.case.world.murderSlot);
    expect(accuse(g.case.world.culprit, g.case.world.murderSlot).right).toBe(true);
  });

  it("recites the proof, naming cards the player never found", async () => {
    await newCase("normal");
    const g = live();
    accuse(g.case.world.culprit, g.case.world.murderSlot);
    const lines = get(summingUp);
    expect(lines.length).toBe(g.case.trace.length);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain("a card");
    }
  });
});

describe("putting it down and picking it up", () => {
  it("saves after every move and comes back to the same place", async () => {
    await newCase("normal");
    const g = live();
    const room = [...g.case.bank.found.keys()].find(
      (r) => (g.case.bank.found.get(r) ?? []).length > 0,
    );
    if (room !== undefined) examineRoom(room);
    markRoom(1, 2, 0);
    askForHint();
    clock += 45_000;
    flush();

    const saved = loadSave();
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe(g.text);
    expect(saved!.ms).toBe(45_000);
    expect(savedCaseId()).toBe(g.text);

    const collected = [...live().collected];
    const spent = [...live().spent];
    const marks = JSON.stringify(live().history.present);

    game.set(null);
    expect(await resume()).toBe(true);
    const back = live();
    expect(back.text).toBe(g.text);
    expect(back.collected).toEqual(collected);
    expect(back.spent).toEqual(spent);
    expect(JSON.stringify(back.history.present)).toBe(marks);
    expect(back.hints).toBe(1);
    expect(get(screen)).toBe("investigate");
    // The clock picks up where it left off rather than starting over.
    clock += 15_000;
    expect(get(cards).length).toBeGreaterThanOrEqual(g.case.opening.length);
    expect(back.ms).toBe(45_000);
  });

  it("comes back to the summing-up when the case was already solved", async () => {
    await newCase("easy");
    const g = live();
    accuse(g.case.world.culprit, g.case.world.murderSlot);
    game.set(null);
    expect(await resume()).toBe(true);
    expect(get(screen)).toBe("summary");
    expect(live().solved).toBe(true);
  });

  /**
   * A save that parses perfectly and belongs to a different house.
   *
   * `storage.ts` cannot catch this — it validates the save before the case
   * has been rebuilt, and the case id is inside the save. So the controller
   * checks the rebuilt frame against the notebook it was handed, and throws
   * the save away rather than putting the player in front of a grid that
   * does not match their marks.
   */
  it("drops a save whose notebook does not fit the case", async () => {
    const id = newCaseId("easy", "3f9k2a");
    writeSave({
      id: formatCaseId(id),
      collected: [],
      spent: [],
      // An Easy case has 5 people and 5 slots. This one claims 2 x 3.
      notebook: { ruledOut: [[0, 0, 0], [0, 0, 0]], clearedSuspects: 0, ruledOutSlots: 0 },
      wrong: [],
      hints: 9,
      checks: 0,
      ms: 123,
      solved: false,
      chat: [],
    });
    expect(await resume()).toBe(true);
    const g = live();
    expect(g.hints).toBe(0);
    expect(g.ms).toBe(0);
    expect(get(screen)).toBe("briefing");
  });

  it("drops a card id the rebuilt bank does not hold", async () => {
    await newCase("easy");
    const g = live();
    const real = allCards(g.case.bank)[0].id;
    writeSave({
      id: g.text,
      collected: [real, "c999999"],
      spent: [],
      notebook: g.history.present,
      wrong: [],
      hints: 0,
      checks: 0,
      ms: 0,
      solved: false,
      chat: [],
    });
    game.set(null);
    await resume();
    expect(live().collected).toEqual([real]);
  });

  it("gives up cleanly, breaking the streak and forgetting the save", async () => {
    await newCase("hard");
    const g = live();
    abandon();
    expect(get(game)).toBeNull();
    expect(get(screen)).toBe("home");
    expect(loadSave()).toBeNull();
    expect(get(stats)[g.case.difficulty].streak).toBe(0);
    expect(await resume()).toBe(false);
  });
});

describe("settings", () => {
  it("remembers a change", async () => {
    updateSettings({ showCanonical: false, theme: "dark" });
    expect(get(settings).showCanonical).toBe(false);
    expect(get(settings).theme).toBe("dark");
    // ...on disk, not only in the store.
    expect(JSON.parse(store.get("skiron:settings") as string).theme).toBe("dark");
  });
});
