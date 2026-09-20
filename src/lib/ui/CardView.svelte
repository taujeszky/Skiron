<!--
  One evidence card.

  The sentence is what a player reads; the canonical form underneath is what
  the engine actually holds. Wave 5 puts LLM prose on top of the sentence and
  the canonical form stays exactly where it is, because **only the card is
  canon** — if the prose and the formal clue ever disagree, the line the
  player can act on is the one in the monospace type.

  The source badge is doing real work too. Rule 7 says innocents tell the
  truth and the killer may not, so "a fact" and "Suspect C says" are not the
  same kind of claim, and a card that did not say which was which would make
  the trust tier unplayable.
-->
<script lang="ts">
  import { clueCanonical } from "$lib/engine/clues";
  import { isRuleKind } from "$lib/engine/types";
  import type { CaseFrame, Clue, Glossary } from "$lib/engine/types";
  import { personColor } from "./look";

  let {
    frame,
    glossary,
    clue,
    label,
    sentence,
    canonical = true,
    selected = false,
    fresh = false,
    onselect = undefined,
  }: {
    frame: CaseFrame;
    glossary: Glossary;
    clue: Clue;
    label: string;
    sentence: string;
    canonical?: boolean;
    selected?: boolean;
    fresh?: boolean;
    onselect?: () => void;
  } = $props();

  const rule = $derived(isRuleKind(clue.body.kind));
  const speaker = $derived(
    clue.source.kind === "testimony" ? clue.source.speaker : null,
  );
  const kind = $derived(rule ? "rule" : speaker !== null ? "testimony" : "fact");
  const badge = $derived(
    rule
      ? "Case file"
      : speaker !== null
        ? glossary.personName(speaker)
        : "Evidence",
  );
</script>

<div
  class="card {kind}"
  class:selected
  class:fresh
  style={speaker !== null ? `--who: ${personColor(frame, speaker)}` : ""}
>
  <button class="body" onclick={() => onselect?.()} disabled={!onselect}>
    <div class="top">
      <span class="label">{label}</span>
      <span class="badge">{badge}</span>
    </div>
    <p class="sentence">{sentence}</p>
    {#if canonical}
      <p class="canon">{clueCanonical(clue)}</p>
    {/if}
  </button>
</div>

<style>
  .card {
    /* A card is its own height. Without this the evidence pane's flex column
       shrinks twenty-six of them into twenty-six empty strips. */
    flex: none;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--card-fact);
    border-radius: 8px;
    overflow: hidden;
  }

  .card.testimony {
    border-left-color: var(--who, var(--card-testimony));
  }

  .card.rule {
    border-left-color: var(--card-rule);
  }

  .card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .card.fresh {
    animation: arrive 0.5s ease-out;
  }

  @keyframes arrive {
    from {
      background: var(--cell-hint);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card.fresh {
      animation: none;
    }
  }

  .body {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
  }

  .body:disabled {
    cursor: default;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 3px;
  }

  .label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .badge {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-dim);
  }

  .card.testimony .badge {
    color: var(--who, var(--card-testimony));
  }

  .card.rule .badge {
    color: var(--card-rule);
  }

  .sentence {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.4;
  }

  .canon {
    margin: 5px 0 0;
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 0.72rem;
    color: var(--canon);
    word-break: break-all;
  }
</style>
