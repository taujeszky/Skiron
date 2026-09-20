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
  }: {
    frame: CaseFrame;
    person: PersonId;
    ghost?: boolean;
    size?: number;
    title?: string;
  } = $props();

  const color = $derived(personColor(frame, person));
</script>

<span
  class="token"
  class:ghost
  style="--tone: {color}; --size: {size}px"
  title={title || undefined}
>
  {personGlyph(frame, person)}
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
</style>
