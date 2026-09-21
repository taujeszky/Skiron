<!--
  Name the killer and the hour.

  The room is not asked for, because the body says which room it was — that is
  the plan's decision and it is what makes the *timeline* the thing the player
  has to get right.

  The screen offers everybody and every hour, including the ones the notebook
  has crossed off. A player is allowed to guess, and a player is allowed to
  have crossed off the wrong thing; refusing to let them name a suspect they
  had cleared would be the notebook overruling them, and the notebook is
  theirs. What the screen does instead is say plainly which ones their own
  notes rule out.
-->
<script lang="ts">
  import { isCleared, isSlotRuledOut } from "$lib/game/notebook";
  import { accuse, explain, game, goto, settings } from "$lib/game/controller";
  import Token from "./Token.svelte";
  import { slotIndexes, suspectIds } from "./look";

  const g = $derived($game!);
  const frame = $derived(g.case.frame);
  const glossary = $derived($explain!.glossary);
  const notebook = $derived(g.history.present);

  let who = $state<number | null>(null);
  let when = $state<number | null>(null);
  let confirming = $state(false);
  let missed = $state<{ culprit: number; slot: number } | null>(null);

  const ready = $derived(who !== null && when !== null);

  function submit(): void {
    if (who === null || when === null) return;
    if ($settings.confirmAccusation && !confirming) {
      confirming = true;
      return;
    }
    confirming = false;
    const verdict = accuse(who, when);
    if (!verdict.right) {
      missed = { culprit: who, slot: when };
      who = null;
      when = null;
    }
  }
</script>

<div class="screen" data-screen="accuse">
  <div class="inner">
    <header>
      <h1>The accusation</h1>
      <button class="btn small" onclick={() => goto("investigate")}>‹ Back</button>
    </header>

    {#if missed}
      <p class="missed" role="status">
        {glossary.personName(missed.culprit)} did not kill
        {glossary.personName(frame.victim)} in {glossary.slotLabel(missed.slot)}.
        It is on the record. Keep going.
      </p>
    {/if}

    <h2 id="accuse-who">Who</h2>
    <!-- Buttons rather than radios, so `aria-pressed` is what says which one
         is chosen. Without it the selection is visible and nothing else:
         `class:on` is a colour, and a screen reader reads a list of names
         with no indication that one of them is the answer being given. -->
    <div class="options" role="group" aria-labelledby="accuse-who">
      {#each suspectIds(frame) as s (s)}
        {@const out = isCleared(notebook, s)}
        <button
          class="option"
          class:on={who === s}
          class:out
          aria-pressed={who === s}
          onclick={() => (who = s)}
        >
          <Token {frame} person={s} size={20} />
          <span>{glossary.personName(s)}</span>
          {#if out}<span class="note">your notes clear them</span>{/if}
        </button>
      {/each}
    </div>

    <h2 id="accuse-when">When</h2>
    <div class="options" role="group" aria-labelledby="accuse-when">
      {#each slotIndexes(frame) as t (t)}
        {@const out = isSlotRuledOut(notebook, t)}
        <button
          class="option"
          class:on={when === t}
          class:out
          aria-pressed={when === t}
          onclick={() => (when = t)}
        >
          <span>{glossary.slotLabel(t)}</span>
          {#if out}<span class="note">ruled out</span>{/if}
        </button>
      {/each}
    </div>

    {#if confirming && ready}
      <p class="confirm" role="status">
        You are naming {glossary.personName(who!)}, in
        {glossary.roomName(frame.murderRoom)}, in {glossary.slotLabel(when!)}.
        A wrong accusation goes on the record and the case stays open.
      </p>
    {/if}

    <div class="go">
      <button class="btn primary" disabled={!ready} onclick={submit}>
        {confirming ? "Yes — accuse" : "Accuse"}
      </button>
      {#if confirming}
        <button class="btn" onclick={() => (confirming = false)}>Think again</button>
      {/if}
      <span class="tally">
        {g.wrong.length === 0
          ? "No wrong accusations yet."
          : g.wrong.length === 1
            ? "One wrong accusation so far."
            : `${g.wrong.length} wrong accusations so far.`}
      </span>
    </div>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    overflow-y: auto;
  }

  .inner {
    width: min(620px, 100%);
    margin: 0 auto;
    padding: 24px 20px 40px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  h1 {
    margin: 0;
    font-size: 1.7rem;
    font-weight: 600;
  }

  h2 {
    margin: 20px 0 8px;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 700;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .option {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 13px;
    border-radius: 9px;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    font-size: 0.92rem;
    min-height: 42px;
  }

  .option:hover {
    border-color: var(--accent);
  }

  .option.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .option.out {
    opacity: 0.6;
  }

  .option.on.out {
    opacity: 1;
  }

  .note {
    font-size: 0.72rem;
    opacity: 0.8;
  }

  .missed {
    margin: 0 0 4px;
    padding: 10px 12px;
    border-left: 3px solid var(--danger);
    background: var(--panel);
    border-radius: 8px;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .confirm {
    margin: 18px 0 0;
    padding: 10px 12px;
    border-left: 3px solid var(--warn);
    background: var(--panel);
    border-radius: 8px;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .go {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 22px;
  }

  .tally {
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }
</style>
