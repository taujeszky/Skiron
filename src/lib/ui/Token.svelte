<!--
  One person, as a coin.

  Solid when the notebook has placed them in that room; a dashed outline when
  they are merely still possible there. The letter is the point — the ring
  colour is a convenience and never the only thing distinguishing two people.
-->
<script lang="ts">
  import type { CaseFrame, PersonId } from "$lib/engine/types";
  import { personColor, personGlyph } from "./look";

  let {
    frame,
    person,
    ghost = false,
    size = 22,
    title = "",
    art = null,
  }: {
    frame: CaseFrame;
    person: PersonId;
    ghost?: boolean;
    size?: number;
    title?: string;
    /**
     * Wave 7: a portrait to show inside the coin instead of the letter.
     *
     * A prop on this component rather than a second avatar component, because
     * a person's appearance has to agree across the map, the notebook, the
     * cast strip and the chat, and two components is two things to keep in
     * step. Null is the normal state — no key, art off, or the first ten
     * seconds of a case — and the letter is what wave 4 shipped with.
     *
     * A ghost token never takes one: a dashed outline means "could still have
     * been here", and a photograph reads as a fact.
     */
    art?: string | null;
  } = $props();

  const color = $derived(personColor(frame, person));
  const shown = $derived(ghost ? null : art);
</script>

<span
  class="token"
  class:ghost
  class:art={shown !== null}
  style="--tone: {color}; --size: {size}px"
  title={title || undefined}
>
  {#if shown}
    <!-- `alt` is empty on purpose: the title beside it already names the
         person, and a screen reader announcing them twice is worse than a
         picture going unmentioned. -->
    <img src={shown} alt="" draggable="false" />
  {:else}
    {personGlyph(frame, person)}
  {/if}
</span>

<style>
  .token {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--tone);
    color: var(--panel);
    border: 1.5px solid var(--tone);
    font-size: calc(var(--size) * 0.58);
    font-weight: 700;
    line-height: 1;
    flex: none;
  }

  .token.ghost {
    background: transparent;
    color: var(--tone);
    border-style: dashed;
    opacity: 0.8;
  }

  .token.art {
    /* The ring stays: it is the colour that ties this face to the same
       person's token on the map and their row in the notebook. */
    overflow: hidden;
    background: var(--panel-2, var(--panel));
  }

  .token.art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
