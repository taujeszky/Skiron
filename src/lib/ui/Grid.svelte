<!--
  The notebook: a person against an hour, and in each cell the rooms still
  allowed.

  Two gestures and one mode, which is one more than a mouse needs and exactly
  what a thumb needs. Crossing a room out is the move a player makes twenty
  times for every one time they place somebody, so it is the default; a
  double-click places, and the Cross/Place toggle is the same thing for touch.

  **A room is a three-letter code, never a colour.** The plan says so and the
  reason is not decoration — the whole game is the grid, and a grid a
  colourblind player cannot read is a game they cannot play.
-->
<script lang="ts">
  import { bit } from "$lib/engine/bits";
  import type { CaseFrame, Glossary, PersonId, RoomId, SlotIndex } from "$lib/engine/types";
  import { cellState, isCleared, isSlotRuledOut } from "$lib/game/notebook";
  import type { Notebook } from "$lib/game/notebook";
  import { peopleIds, roomIds, slotIndexes } from "./look";

  let {
    frame,
    glossary,
    notebook,
    mode,
    errorCells = new Set<string>(),
    litCells = new Set<string>(),
    focus,
    onmark,
    onplace,
    onwipe,
    onclearsuspect,
    onruleoutslot,
    onfocus,
  }: {
    frame: CaseFrame;
    glossary: Glossary;
    notebook: Notebook;
    mode: "cross" | "place";
    errorCells?: Set<string>;
    litCells?: Set<string>;
    focus: { p: PersonId; t: SlotIndex };
    onmark: (p: PersonId, t: SlotIndex, r: RoomId) => void;
    onplace: (p: PersonId, t: SlotIndex, r: RoomId) => void;
    onwipe: (p: PersonId, t: SlotIndex) => void;
    onclearsuspect: (s: PersonId) => void;
    onruleoutslot: (t: SlotIndex) => void;
    onfocus: (p: PersonId, t: SlotIndex) => void;
  } = $props();

  const rooms = $derived(roomIds(frame));
  const slots = $derived(slotIndexes(frame));
  const people = $derived(peopleIds(frame));

  function tap(p: PersonId, t: SlotIndex, r: RoomId): void {
    onfocus(p, t);
    if (mode === "place") onplace(p, t, r);
    else onmark(p, t, r);
  }

  /**
   * Keys, on the whole grid rather than on each of forty cells.
   *
   * Arrows move the focus; a digit acts on the room with that number, which
   * is the same number the code shows, so `R3` is always `3`. Shift inverts
   * the mode for one keystroke, which is the keyboard's answer to
   * double-click.
   */
  function onkeydown(e: KeyboardEvent): void {
    const { p, t } = focus;
    const step = (dp: number, dt: number) => {
      e.preventDefault();
      onfocus(
        Math.min(frame.people - 1, Math.max(0, p + dp)),
        Math.min(frame.slots - 1, Math.max(0, t + dt)),
      );
    };
    switch (e.key) {
      case "ArrowUp":
        return step(-1, 0);
      case "ArrowDown":
        return step(1, 0);
      case "ArrowLeft":
        return step(0, -1);
      case "ArrowRight":
        return step(0, 1);
      case "Backspace":
      case "Delete":
        e.preventDefault();
        return onwipe(p, t);
    }
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > rooms.length) return;
    e.preventDefault();
    const r = rooms[n - 1];
    const place = e.shiftKey ? mode === "cross" : mode === "place";
    if (place) onplace(p, t, r);
    else onmark(p, t, r);
  }
</script>

<div
  class="grid"
  style="--cols: {slots.length}"
  role="grid"
  tabindex="0"
  aria-label="The notebook"
  {onkeydown}
>
  <div class="corner"></div>
  {#each slots as t (t)}
    {@const out = isSlotRuledOut(notebook, t)}
    <button
      class="head slot"
      class:struck={out}
      onclick={() => onruleoutslot(t)}
      title={out
        ? `${glossary.slotLabel(t)} is crossed off as the murder hour`
        : `Cross ${glossary.slotLabel(t)} off as the murder hour`}
    >
      {glossary.slotLabel(t)}
    </button>
  {/each}

  {#each people as p (p)}
    {@const victim = p === frame.victim}
    {@const cleared = !victim && isCleared(notebook, p)}
    <button
      class="head person"
      class:struck={cleared}
      class:victim
      style="--tone: {victim ? 'var(--victim)' : `var(--p${p % 8})`}"
      disabled={victim}
      onclick={() => onclearsuspect(p)}
      title={victim
        ? "The victim"
        : cleared
          ? `${glossary.personName(p)} is in the clear`
          : `Put ${glossary.personName(p)} in the clear`}
    >
      {glossary.personName(p)}
    </button>
    {#each slots as t (t)}
      {@const state = cellState(frame, notebook, p, t)}
      {@const key = `${p}:${t}`}
      <div
        class="cell"
        class:settled={state.set >= 0}
        class:empty={state.empty}
        class:wrong={errorCells.has(key)}
        class:lit={litCells.has(key)}
        class:focused={focus.p === p && focus.t === t}
        role="gridcell"
        aria-label="{glossary.personName(p)}, {glossary.slotLabel(t)}"
      >
        {#each rooms as r (r)}
          {@const struck = (notebook.ruledOut[p][t] & bit(r)) !== 0}
          <button
            class="chip"
            class:struck
            ondblclick={(e: MouseEvent) => {
              e.preventDefault();
              onfocus(p, t);
              onplace(p, t, r);
            }}
            onclick={() => tap(p, t, r)}
            title="{glossary.roomName(r)} — {struck ? 'crossed out' : 'still possible'}"
          >
            {glossary.roomCode(r)}
          </button>
        {/each}
      </div>
    {/each}
  {/each}
</div>

<style>
  .grid {
    display: grid;
    /*
     * `minmax(84px, 1fr)` and NOT `width: max-content`. With max-content the
     * columns take the width of every room chip on one line, which is about
     * 140px for five rooms and 220 for eight — so the grid ran off the side
     * of its own pane on every preset and the minmax was decorative. Letting
     * the columns shrink makes the chips wrap into two or three short rows,
     * which is what a person writing candidates into a cell does anyway.
     *
     * `min-width: max-content` does the same damage from the other side and
     * is not here for the same reason. Eight slots of eight rooms still need
     * more than a laptop column, so `.grid-box` scrolls — but it scrolls past
     * a grid that has already done its best, not past one that never tried.
     */
    grid-template-columns: max-content repeat(var(--cols), minmax(84px, 1fr));
    gap: 1px;
    background: var(--grid-line);
    border: 1px solid var(--grid-line);
    border-radius: 8px;
    overflow: hidden;
    width: 100%;
  }

  .grid:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .corner {
    background: var(--grid-header);
  }

  .head {
    background: var(--grid-header);
    padding: 6px 10px;
    font-size: 0.78rem;
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
    min-height: 32px;
  }

  .head.slot {
    text-align: center;
  }

  .head.person {
    border-left: 3px solid var(--tone);
    position: sticky;
    left: 0;
    z-index: 1;
  }

  .head.person.victim {
    cursor: default;
    opacity: 0.75;
  }

  .head.struck {
    text-decoration: line-through;
    color: var(--text-dim);
  }

  .cell {
    background: var(--cell-bg);
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 2px;
    padding: 3px;
    min-height: 40px;
  }

  .cell.settled {
    background: var(--cell-set);
  }

  .cell.lit {
    background: var(--cell-hint);
  }

  .cell.wrong {
    background: var(--cell-error);
  }

  .cell.empty {
    background: var(--cell-error);
  }

  .cell.focused {
    box-shadow: inset 0 0 0 2px var(--focus);
  }

  .chip {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 2px 4px;
    border-radius: 4px;
    color: var(--pencil);
    min-width: 24px;
    min-height: 22px;
    line-height: 1;
  }

  .chip:hover {
    background: var(--panel-2);
  }

  .chip.struck {
    color: var(--cell-out);
    text-decoration: line-through;
    /* No `opacity` any more. It used to be 0.55, which dropped a crossed-out
       room code well under any readable contrast — and this is the single
       most-read thing in the game. The strike-through is what says "ruled
       out"; the colour only has to stay legible while it does. */
  }

  @media (max-width: 900px) {
    /* Bigger targets, because this is the one thing a thumb has to hit. */
    .chip {
      min-width: 30px;
      min-height: 28px;
      font-size: 0.72rem;
    }
    .cell {
      min-height: 46px;
    }
  }
</style>
