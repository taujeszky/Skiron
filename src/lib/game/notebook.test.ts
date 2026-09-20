import { describe, expect, it } from "vitest";

import { bit, fullMask } from "$lib/engine/bits";
import { corridorPlan, frameOf, gridPlan } from "$lib/engine/testkit";
import { newNotebook } from "$lib/engine/solver/hint";
import type { Clue } from "$lib/engine/types";

import {
  HISTORY_LIMIT,
  autoNotes,
  canRedo,
  canUndo,
  cellState,
  clearCell,
  cloneNotebook,
  newHistory,
  notebookEquals,
  notebookFits,
  progress,
  push,
  redo,
  setRoom,
  slotsLeft,
  suspectsLeft,
  toggleCleared,
  toggleRoom,
  toggleSlot,
  undo,
} from "./notebook";

const frame = frameOf({
  plan: gridPlan(3, 2),
  suspects: 4,
  slots: 5,
  murderRoom: 0,
});

describe("editing the notebook", () => {
  it("never touches the notebook it was given", () => {
    const before = newNotebook(frame);
    const after = toggleRoom(before, 1, 2, 3);
    expect(before.ruledOut[1][2]).toBe(0);
    expect(after.ruledOut[1][2]).toBe(bit(3));
    expect(notebookEquals(before, after)).toBe(false);
  });

  it("toggles a room off and back on", () => {
    let n = newNotebook(frame);
    n = toggleRoom(n, 0, 0, 2);
    expect(cellState(frame, n, 0, 0).open).not.toContain(2);
    n = toggleRoom(n, 0, 0, 2);
    expect(cellState(frame, n, 0, 0).open).toContain(2);
  });

  it("settling a cell on a room crosses out every other room", () => {
    const n = setRoom(frame, newNotebook(frame), 2, 3, 4);
    const state = cellState(frame, n, 2, 3);
    expect(state.set).toBe(4);
    expect(state.open).toEqual([4]);
    expect(state.empty).toBe(false);
  });

  it("settling a cell on the room it is already on opens it up again", () => {
    let n = setRoom(frame, newNotebook(frame), 2, 3, 4);
    n = setRoom(frame, n, 2, 3, 4);
    expect(cellState(frame, n, 2, 3).open.length).toBe(frame.plan.rooms.length);
  });

  it("settling on a different room moves the mark rather than clearing it", () => {
    let n = setRoom(frame, newNotebook(frame), 2, 3, 4);
    n = setRoom(frame, n, 2, 3, 1);
    expect(cellState(frame, n, 2, 3).set).toBe(1);
  });

  it("clears a cell", () => {
    let n = setRoom(frame, newNotebook(frame), 1, 1, 0);
    n = clearCell(n, 1, 1);
    expect(n.ruledOut[1][1]).toBe(0);
  });

  it("reports an emptied cell as empty and settled on nothing", () => {
    let n = newNotebook(frame);
    for (let r = 0; r < frame.plan.rooms.length; r++) n = toggleRoom(n, 0, 0, r);
    const state = cellState(frame, n, 0, 0);
    expect(state.empty).toBe(true);
    expect(state.set).toBe(-1);
    expect(state.open).toEqual([]);
  });

  it("keeps the two answer lists", () => {
    let n = toggleCleared(newNotebook(frame), 2);
    n = toggleSlot(n, 3);
    expect(suspectsLeft(frame, n)).toEqual([0, 1, 3]);
    expect(slotsLeft(frame, n)).toEqual([0, 1, 2, 4]);
    n = toggleCleared(n, 2);
    expect(suspectsLeft(frame, n)).toEqual([0, 1, 2, 3]);
  });
});

describe("does this notebook belong to this case", () => {
  it("accepts one that was made for the frame", () => {
    expect(notebookFits(frame, newNotebook(frame))).toBe(true);
  });

  it("rejects the wrong number of rows", () => {
    const other = frameOf({
      plan: gridPlan(3, 2),
      suspects: 5,
      slots: 5,
      murderRoom: 0,
    });
    expect(notebookFits(frame, newNotebook(other))).toBe(false);
  });

  it("rejects the wrong number of columns", () => {
    const other = frameOf({
      plan: gridPlan(3, 2),
      suspects: 4,
      slots: 6,
      murderRoom: 0,
    });
    expect(notebookFits(frame, newNotebook(other))).toBe(false);
  });

  it("rejects a mark naming a room the house does not have", () => {
    const n = newNotebook(frame);
    n.ruledOut[0][0] = bit(frame.plan.rooms.length);
    expect(notebookFits(frame, n)).toBe(false);
  });

  it("rejects a suspect crossed off who is not a suspect", () => {
    const n = newNotebook(frame);
    n.clearedSuspects = bit(frame.suspects);
    expect(notebookFits(frame, n)).toBe(false);
  });
});

describe("progress", () => {
  it("is zero on a blank notebook and one on a filled one", () => {
    expect(progress(frame, newNotebook(frame))).toBe(0);
    let n = newNotebook(frame);
    for (let p = 0; p < frame.people; p++) {
      for (let t = 0; t < frame.slots; t++) n = setRoom(frame, n, p, t, 0);
    }
    for (let s = 0; s + 1 < frame.suspects; s++) n = toggleCleared(n, s);
    for (let t = 0; t + 1 < frame.slots; t++) n = toggleSlot(n, t);
    expect(progress(frame, n)).toBe(1);
  });

  it("does not exceed one when a cell is emptied past settled", () => {
    let n = newNotebook(frame);
    for (let p = 0; p < frame.people; p++) {
      for (let t = 0; t < frame.slots; t++) {
        n.ruledOut[p][t] = fullMask(frame.plan.rooms.length);
      }
    }
    n = toggleCleared(n, 0);
    expect(progress(frame, n)).toBeLessThanOrEqual(1);
  });
});

describe("undo and redo", () => {
  it("walks backwards and forwards through edits", () => {
    const blank = newNotebook(frame);
    let h = newHistory(blank);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);

    h = push(h, toggleRoom(h.present, 0, 0, 1));
    h = push(h, toggleRoom(h.present, 0, 0, 2));
    expect(h.present.ruledOut[0][0]).toBe(bit(1) | bit(2));

    h = undo(h);
    expect(h.present.ruledOut[0][0]).toBe(bit(1));
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(notebookEquals(h.present, blank)).toBe(true);
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    h = redo(h);
    expect(h.present.ruledOut[0][0]).toBe(bit(1) | bit(2));
  });

  it("drops the redo branch once a new edit is made", () => {
    let h = newHistory(newNotebook(frame));
    h = push(h, toggleRoom(h.present, 0, 0, 1));
    h = undo(h);
    h = push(h, toggleRoom(h.present, 1, 1, 3));
    expect(canRedo(h)).toBe(false);
  });

  it("does not record an edit that changed nothing", () => {
    const h = newHistory(newNotebook(frame));
    const same = push(h, cloneNotebook(h.present));
    expect(same).toBe(h);
    expect(canUndo(same)).toBe(false);
  });

  it("forgets the oldest states rather than growing without bound", () => {
    let h = newHistory(newNotebook(frame));
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) {
      // Each step flips a different bit, so no two states are equal and
      // every push is recorded.
      const p = i % frame.people;
      const t = Math.floor(i / frame.people) % frame.slots;
      h = push(h, toggleRoom(h.present, p, t, i % frame.plan.rooms.length));
    }
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe("auto-notes", () => {
  /**
   * The setting's promise is "the direct consequences", and the line between
   * direct and deduced is the solver's tier 0, not a rule written here. So
   * the test is that a card the player could read off states itself, and that
   * a conclusion needing a second card does not appear.
   */
  it("writes down what a single card says outright", () => {
    const line = frameOf({
      plan: corridorPlan(4),
      suspects: 3,
      slots: 4,
      murderRoom: 3,
    });
    const card: Clue = {
      id: "c1",
      body: { kind: "At", p: 0, t: 1, r: 2 },
      source: { kind: "fact" },
    };
    const n = autoNotes(line, [card], newNotebook(line));
    expect(cellState(line, n, 0, 1).set).toBe(2);
  });

  /**
   * Not "leaves a blank notebook blank": the frame alone tells the player
   * something, namely that the body was in the murder room when it was found
   * at the end of the evening. Auto-notes writes that down before a single
   * card is collected, which is right, and was a surprise the first time.
   */
  it("writes down what the case itself already says, with no cards at all", () => {
    const n = autoNotes(frame, [], newNotebook(frame));
    expect(cellState(frame, n, frame.victim, frame.slots - 1).set).toBe(
      frame.murderRoom,
    );
    for (let p = 0; p < frame.people; p++) {
      for (let t = 0; t < frame.slots; t++) {
        if (p === frame.victim && t === frame.slots - 1) continue;
        expect(n.ruledOut[p][t], `cell ${p},${t}`).toBe(0);
      }
    }
    expect(n.clearedSuspects).toBe(0);
    expect(n.ruledOutSlots).toBe(0);
  });

  it("is idempotent, so the setting can fire on every collected card", () => {
    const once = autoNotes(frame, [], newNotebook(frame));
    expect(notebookEquals(autoNotes(frame, [], once), once)).toBe(true);
  });

  it("adds to what the player already wrote rather than replacing it", () => {
    const line = frameOf({
      plan: corridorPlan(4),
      suspects: 3,
      slots: 4,
      murderRoom: 3,
    });
    const card: Clue = {
      id: "c1",
      body: { kind: "At", p: 0, t: 1, r: 2 },
      source: { kind: "fact" },
    };
    const mine = toggleRoom(newNotebook(line), 2, 3, 0);
    const n = autoNotes(line, [card], mine);
    expect(n.ruledOut[2][3]).toBe(bit(0));
    expect(cellState(line, n, 0, 1).set).toBe(2);
  });
});
