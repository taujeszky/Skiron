<!--
  The game itself: map, notebook, evidence.

  Three columns on a desk, one column and three tabs on a phone. All three
  panes stay mounted at every width — the tabs only hide them — because the
  notebook's scroll position and the evidence filter are state a player has
  set, and losing it on every tab change would make the phone layout a
  different and worse game rather than the same one, narrower.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { clueMentions } from "$lib/engine/clues";
  import { difficultyLabel } from "$lib/engine/solver/difficulty";
  import {
    candidatesIn,
    errorCells as errorCellKeys,
    placedIn,
  } from "$lib/game/errors";
  import {
    askForHint,
    cards,
    checkNotebook,
    clearSuspect,
    errors,
    examineRoom,
    explain,
    focusCell,
    game,
    goto,
    markMode,
    markRoom,
    marked,
    pane,
    placeIn,
    redoMark,
    redoable,
    ruleOutSlot,
    scrubSlot,
    selectedCard,
    settings,
    undoMark,
    undoable,
    wipeCell,
    elapsedMs,
  } from "$lib/game/controller";
  import { formatDuration } from "$lib/game/rating";
  import { examineKey } from "$lib/game/types";
  import Coach from "./Coach.svelte";
  import Grid from "./Grid.svelte";
  import Panel from "./Panel.svelte";
  import Plan from "./Plan.svelte";
  import Evidence from "./Evidence.svelte";
  import { slotIndexes } from "./look";

  const g = $derived($game!);
  const frame = $derived(g.case.frame);
  const glossary = $derived($explain!.glossary);
  const notebook = $derived(g.history.present);

  /** The clock on the wall. A second is as fine as this needs to be. */
  let ticking = $state(0);
  const timer = setInterval(() => (ticking = elapsedMs()), 1000);
  onDestroy(() => clearInterval(timer));
  const shownTime = $derived(formatDuration(Math.max(ticking, g.ms)));

  const searched = $derived(
    new Set(
      [...g.case.bank.found.keys()].filter((r) =>
        g.spent.includes(examineKey(r)),
      ),
    ),
  );

  /** What the selected card is about, for the grid wash and the map. */
  const lit = $derived.by(() => {
    const id = $selectedCard;
    if (id === null) return { cells: new Set<string>(), rooms: [] as number[] };
    const clue = $cards.find((c) => c.id === id);
    if (!clue) return { cells: new Set<string>(), rooms: [] as number[] };
    const m = clueMentions(clue.body, frame);
    const cells = new Set<string>();
    const people = m.people.length > 0 ? m.people : [];
    const slots = m.slots.length > 0 ? m.slots : slotIndexes(frame);
    for (const p of people) for (const t of slots) cells.add(`${p}:${t}`);
    return { cells, rooms: m.rooms };
  });

  const wrongCells = $derived(errorCellKeys($errors));
  const placed = $derived(placedIn(frame, notebook, $scrubSlot));
  const maybe = $derived(candidatesIn(frame, notebook, $scrubSlot));

  function onroom(r: number): void {
    examineRoom(r);
  }

  function setFocus(p: number, t: number): void {
    focusCell.set({ p, t });
    if ($settings.linkScrubber) scrubSlot.set(t);
  }

  const par = $derived(g.case.investigation.par);
  const over = $derived(g.spent.length > par);
</script>

<div class="screen" data-pane={$pane}>
  <header>
    <button class="btn small" onclick={() => goto("home")} title="Back to the desk">‹ Desk</button>
    <div class="who">
      <strong>{difficultyLabel(g.case.difficulty)}</strong>
      <span class="id">{g.text}</span>
    </div>
    <div class="meters">
      <span class="meter" class:over title="Moves spent against par">
        {g.spent.length}/{par}
      </span>
      <span class="meter" title="Time on this case">{shownTime}</span>
      <span class="bar" title="How much of the grid is settled">
        <span class="fill" style="width: {Math.round($marked * 100)}%"></span>
      </span>
    </div>
  </header>

  <Coach />

  <!-- `aria-pressed` rather than a tablist: all three panes stay mounted at
       every width and the buttons only hide them, so calling them tabs would
       promise a relationship the DOM does not have. -->
  <nav class="tabs" aria-label="Which pane to show">
    <button
      class:on={$pane === "map"}
      aria-pressed={$pane === "map"}
      onclick={() => pane.set("map")}>Map</button
    >
    <button
      class:on={$pane === "notebook"}
      aria-pressed={$pane === "notebook"}
      onclick={() => pane.set("notebook")}
    >
      Notebook
    </button>
    <button
      class:on={$pane === "evidence"}
      aria-pressed={$pane === "evidence"}
      onclick={() => pane.set("evidence")}
    >
      Evidence
    </button>
  </nav>

  <main>
    <section class="pane map" aria-label="The floor plan">
      <div class="plan-box" style="aspect-ratio: {frame.plan.width} / {frame.plan.height}">
        <Plan
          {frame}
          {glossary}
          slot={$scrubSlot}
          {placed}
          candidates={maybe}
          highlight={lit.rooms}
          {searched}
          {onroom}
        />
      </div>
      <div class="scrub">
        <span class="scrub-label">{glossary.slotLabel($scrubSlot)}</span>
        <input
          type="range"
          min="0"
          max={frame.slots - 1}
          value={$scrubSlot}
          aria-label="Which hour the map shows"
          oninput={(e) => scrubSlot.set(Number(e.currentTarget.value))}
        />
      </div>
      <p class="tip">
        Click a room to search it. Solid tokens are people your notebook has
        placed; dashed ones are still possible.
      </p>
    </section>

    <section class="pane notebook" aria-label="The notebook">
      <div class="tools">
        <div class="modes" role="group" aria-label="What a tap does">
          <button
            class:on={$markMode === "cross"}
            aria-pressed={$markMode === "cross"}
            onclick={() => markMode.set("cross")}
          >
            Cross out
          </button>
          <button
            class:on={$markMode === "place"}
            aria-pressed={$markMode === "place"}
            onclick={() => markMode.set("place")}
          >
            Place
          </button>
        </div>
        <span class="spacer"></span>
        <button class="btn small" disabled={!$undoable} onclick={undoMark}>Undo</button>
        <button class="btn small" disabled={!$redoable} onclick={redoMark}>Redo</button>
      </div>
      <div class="grid-box">
        <Grid
          {frame}
          {glossary}
          {notebook}
          mode={$markMode}
          errorCells={wrongCells}
          litCells={lit.cells}
          focus={$focusCell}
          onmark={markRoom}
          onplace={placeIn}
          onwipe={wipeCell}
          onclearsuspect={clearSuspect}
          onruleoutslot={ruleOutSlot}
          onfocus={setFocus}
        />
      </div>
      <p class="tip">
        Tap a room code to cross it out. Double-click — or the Place mode — puts
        somebody there. Strike a name to put them in the clear, an hour to rule
        it out.
      </p>
    </section>

    <section class="pane evidence" aria-label="The evidence">
      <Evidence />
    </section>
  </main>

  <div class="panel-slot">
    <Panel />
  </div>

  <footer>
    <p class="status" class:bad={$errors.length > 0}>
      {#if $errors.length > 0}
        {$errors[0].text}{#if $errors.length > 1}
          <span class="more">and {$errors.length - 1} more</span>
        {/if}
      {:else}
        {$cards.length}
        {$cards.length === 1 ? "card" : "cards"} · {g.spent.length}
        {g.spent.length === 1 ? "move" : "moves"} · {g.hints}
        {g.hints === 1 ? "hint" : "hints"}
      {/if}
    </p>
    <div class="acts">
      <button class="btn" onclick={askForHint} title="Hint (H)">Hint</button>
      <button class="btn" onclick={checkNotebook} title="Check (C)">Check</button>
      <button class="btn primary" onclick={() => goto("accuse")} title="Accuse (A)">
        Accuse
      </button>
    </div>
  </footer>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--panel-border);
    background: var(--panel);
    flex: none;
  }

  .who {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .id {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 0.74rem;
    color: var(--text-dim);
  }

  .meters {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .meter.over {
    color: var(--warn);
  }

  .bar {
    width: 70px;
    height: 6px;
    border-radius: 3px;
    background: var(--panel-2);
    border: 1px solid var(--panel-border);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--ok);
    transition: width 0.25s;
  }

  .tabs {
    display: none;
  }

  main {
    flex: 1;
    display: grid;
    /* The notebook is the game; the other two serve it. */
    grid-template-columns: minmax(240px, 0.85fr) minmax(340px, 2fr) minmax(290px, 1.15fr);
    min-height: 0;
  }

  .pane {
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--panel-border);
    background: var(--panel);
  }

  .pane.evidence {
    border-right: none;
  }

  /*
   * The house at its own shape, pinned to the top of the pane.
   *
   * With `flex: 1` the SVG stretched to a tall narrow box and `preserveAspect`
   * drew a small house floating in the middle of it. Sizing the box to the
   * plan's own proportions makes the house as big as the column allows, and
   * puts the empty space in one place at the bottom where it reads as margin
   * rather than as a mistake.
   */
  .plan-box {
    flex: none;
    width: 100%;
    max-height: 62%;
    padding: 8px;
    display: flex;
  }

  .scrub {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px 6px;
  }

  .scrub-label {
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    min-width: 62px;
  }

  .scrub input {
    flex: 1;
    accent-color: var(--accent);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 4px;
  }

  .spacer {
    flex: 1;
  }

  .modes {
    display: inline-flex;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .modes button {
    padding: 5px 10px;
    font-size: 0.78rem;
    background: var(--panel);
  }

  .modes button.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .grid-box {
    flex: 1;
    overflow: auto;
    padding: 6px 10px;
    min-height: 0;
  }

  .tip {
    margin: 0;
    padding: 4px 12px 10px;
    font-size: 0.74rem;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .panel-slot {
    padding: 0 12px;
    flex: none;
  }

  .panel-slot:empty {
    display: none;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid var(--panel-border);
    background: var(--panel);
    flex: none;
  }

  .status {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-dim);
    flex: 1;
    min-width: 0;
  }

  .status.bad {
    color: var(--danger);
  }

  .more {
    opacity: 0.75;
    margin-left: 6px;
  }

  .acts {
    display: flex;
    gap: 6px;
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }

  @media (max-width: 900px) {
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--panel-border);
      background: var(--panel);
      flex: none;
    }

    .tabs button {
      flex: 1;
      padding: 10px 4px;
      font-size: 0.85rem;
      border-bottom: 2px solid transparent;
    }

    .tabs button.on {
      border-bottom-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }

    main {
      grid-template-columns: 1fr;
    }

    .pane {
      border-right: none;
      grid-row: 1;
      grid-column: 1;
    }

    .screen[data-pane="map"] .pane.notebook,
    .screen[data-pane="map"] .pane.evidence,
    .screen[data-pane="notebook"] .pane.map,
    .screen[data-pane="notebook"] .pane.evidence,
    .screen[data-pane="evidence"] .pane.map,
    .screen[data-pane="evidence"] .pane.notebook {
      display: none;
    }

    .meters .bar {
      display: none;
    }
  }
</style>
