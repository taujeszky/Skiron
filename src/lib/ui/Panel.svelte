<!--
  The one slot everything the game says to the player comes out of.

  Hints, the Check, what a search turned up and what it did not — one panel,
  because the plan asks for it and because two would compete: a player who
  had just been told a hint and then searched a room would lose the hint to
  the search, and would not know it had gone.

  What it never contains is a cell. The Check is one bit by design (invariant
  5 and the plan's "never which cell"), and a panel that softened that into
  "look again at Suspect C at nine" would hand over a square of the answer
  grid for free.
-->
<script lang="ts">
  import {
    closePanel,
    explain,
    followHint,
    game,
    hintIsActionable,
    panel,
    settings,
  } from "$lib/game/controller";
  import CardView from "./CardView.svelte";

  const frame = $derived($game!.case.frame);
  const glossary = $derived($explain!.glossary);

  const released = $derived(
    $panel.kind === "card"
      ? $panel.ids
          .map((id) => $game!.case.bank.cards.get(id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
      : [],
  );
</script>

{#if $panel.kind !== "none"}
  <aside class="panel {$panel.kind}" aria-live="polite">
    <button class="close" onclick={closePanel} aria-label="Close">×</button>

    {#if $panel.kind === "hint"}
      <p class="lead">{$panel.hint.text}</p>
      {#if hintIsActionable($panel)}
        <button class="btn primary" onclick={followHint}>
          {$panel.hint.kind === "deduction" ? "Write it down" : "Go and do it"}
        </button>
      {/if}
    {:else if $panel.kind === "check"}
      <p class="lead" class:good={$panel.sound} class:bad={!$panel.sound}>
        {$panel.sound
          ? "Everything you have crossed out really is false."
          : "Something you have crossed out is true."}
      </p>
      <p class="aside">
        {$panel.sound
          ? "That is all it says. A notebook can be sound and still be nowhere near finished."
          : "Which one is for you to find. Go back over whatever you were least sure of."}
      </p>
    {:else if $panel.kind === "nothing"}
      <p class="lead">{$panel.from}</p>
      <p class="aside">Nothing to say. Silence proves nothing — it is not a clue.</p>
    {:else if $panel.kind === "card"}
      <p class="lead">{$panel.from}</p>
      <div class="cards">
        {#each released as clue (clue.id)}
          <CardView
            {frame}
            {glossary}
            {clue}
            label={$explain!.cardLabel(clue.id)}
            sentence={$explain!.clue(clue)}
            canonical={$settings.showCanonical}
            fresh
          />
        {/each}
      </div>
    {:else if $panel.kind === "error"}
      <p class="lead bad">{$panel.text}</p>
    {/if}
  </aside>
{/if}

<style>
  .panel {
    position: relative;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 12px 34px 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 42vh;
    overflow-y: auto;
  }

  .panel.hint {
    border-left: 3px solid var(--warn);
  }

  .panel.check {
    border-left: 3px solid var(--ok);
  }

  .panel.error {
    border-left: 3px solid var(--danger);
  }

  .close {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--text-dim);
    padding: 2px 6px;
  }

  .close:hover {
    color: var(--text);
  }

  .lead {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
  }

  .lead.good {
    color: var(--ok);
  }

  .lead.bad {
    color: var(--danger);
  }

  .aside {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .btn {
    align-self: flex-start;
  }
</style>
