<!--
  The tutorial's coach strip.

  Renders nothing at all unless the case on screen is one of the two lessons,
  so it can sit unconditionally in `Investigate` and `Briefing` without either
  of them knowing what a lesson is. See `game/tutorial.ts` for why this is a
  strip of text rather than a spotlight over a button.

  It is `aria-live="polite"`: the text changes when the player does something,
  and a screen reader should hear the new instruction without being
  interrupted mid-sentence.
-->
<script lang="ts">
  import { coach, lesson } from "$lib/game/controller";
  import { coachProgress, coachStep } from "$lib/game/tutorial";

  const step = $derived($lesson && $coach ? coachStep($lesson, $coach) : null);
  const at = $derived($lesson && $coach ? coachProgress($lesson, $coach) : null);
</script>

{#if $lesson && step && at}
  <aside class="coach" aria-live="polite" data-coach-step={step.id}>
    <span class="tag">
      {$lesson.name}
      <span class="count">{at.at} of {at.of}</span>
    </span>
    <p>{step.text}</p>
  </aside>
{/if}

<style>
  .coach {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--accent);
    /* A tint of the accent rather than the accent itself: the strip is on
       screen for the whole lesson, and a saturated band that never goes away
       reads as an error after the first minute. */
    background: color-mix(in srgb, var(--accent) 12%, var(--panel));
    border-radius: 0.5rem;
    margin: 0 0 0.6rem;
  }

  .tag {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--accent);
  }

  .count {
    font-weight: 400;
    color: var(--text-dim);
  }

  p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--text);
  }
</style>
