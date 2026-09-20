<!--
  What the player is handed before they touch anything: the house, the cast,
  the room the body was found in, and the case file.

  The case file is rendered from `case.opening` — the same clues the solver
  starts with, put through the same sentence writer as every other card — so
  there is no second description of a rule that could drift from the one the
  engine enforces. A closed door on this screen is the closed door in
  `canMove`.
-->
<script lang="ts">
  import { difficultyLabel } from "$lib/engine/solver/difficulty";
  import { isRuleKind } from "$lib/engine/types";
  import { artUrls, explain, game, goto } from "$lib/game/controller";
  import { portraitKey, SCENE_KEY } from "$lib/llm/art/prompts";
  import Plan from "./Plan.svelte";
  import Token from "./Token.svelte";
  import { suspectIds } from "./look";

  const g = $derived($game!);
  const frame = $derived(g.case.frame);
  const glossary = $derived($explain!.glossary);

  const skin = $derived(g.skin);
  const rules = $derived(g.case.opening.filter((c) => isRuleKind(c.body.kind)));
  const window = $derived(g.case.opening.filter((c) => !isRuleKind(c.body.kind)));

  // Wave 7. Absent is the normal state — no key, art off, or simply not back
  // yet — and every branch below renders without it.
  const scene = $derived($artUrls[SCENE_KEY] ?? null);
</script>

<div class="screen" data-screen="briefing">
  <div class="inner">
    <header>
      <div>
        <h1>{skin ? skin.title : "The case"}</h1>
        <p class="sub">
          <!-- One expression, not a chain of blocks: a `{/if}` on its own line
               eats the space before it, which put "1923 ·Easy" on screen. -->
          {skin && skin.place ? `${skin.place}${skin.era ? `, ${skin.era}` : ""} · ` : ""}{difficultyLabel(
            g.case.difficulty,
          )} · <span class="id">{g.text}</span>
        </p>
      </div>
      <button class="btn small" onclick={() => goto("home")}>‹ Desk</button>
    </header>

    {#if scene}
      <!-- Decoration, and deliberately nowhere near the evidence pane: an
           image cannot be fidelity-checked, so it must never be somewhere a
           player would read it as saying something. See `art/prompts.ts`. -->
      <div class="scene" data-art="scene">
        <img src={scene} alt="" draggable="false" />
      </div>
    {/if}

    {#if skin && skin.briefing}
      <p class="briefing">{skin.briefing}</p>
    {/if}

    <div class="cols">
      <section class="map">
        <div class="plan-box">
          <Plan {frame} {glossary} slot={frame.slots - 1} />
        </div>
        <p class="caption">
          The body was found in <strong>{glossary.roomName(frame.murderRoom)}</strong>
          at the end of the evening.
        </p>
      </section>

      <section class="facts">
        <h2>The evening</h2>
        <ul class="plain">
          {#each window as clue (clue.id)}
            <li>{$explain!.clue(clue)}</li>
          {/each}
          <li>
            The evening runs from {glossary.slotLabel(0)} to
            {glossary.slotLabel(frame.slots - 1)}.
          </li>
          <li>
            {frame.lying
              ? "The killer may lie. Everybody else tells the truth."
              : "Nobody lies — but nobody tells you everything either."}
          </li>
        </ul>

        <h2>The case file</h2>
        {#if rules.length === 0}
          <p class="none">No standing rules. The house was open all evening.</p>
        {:else}
          <ul class="plain">
            {#each rules as clue (clue.id)}
              <li>{$explain!.clue(clue)}</li>
            {/each}
          </ul>
        {/if}

        <h2>The cast</h2>
        <div class="cast">
          {#each suspectIds(frame) as s (s)}
            <span class="who">
              <Token {frame} person={s} size={34} art={$artUrls[portraitKey(s)] ?? null} />
              {glossary.personName(s)}
            </span>
          {/each}
          <span class="who victim">
            <Token
              {frame}
              person={frame.victim}
              size={34}
              art={$artUrls[portraitKey(frame.victim)] ?? null}
            />
            {glossary.personName(frame.victim)}
          </span>
        </div>
      </section>
    </div>

    <div class="go">
      <button class="btn primary" onclick={() => goto("investigate")}>Begin</button>
      <button class="btn" onclick={() => goto("howto")}>The rules</button>
    </div>
  </div>
</div>

<style>
  .scene {
    /* A fixed ratio so the layout does not jump when the image arrives
       several seconds after the text. */
    aspect-ratio: 16 / 5;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid var(--panel-border);
    margin-bottom: 16px;
  }

  .scene img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .briefing {
    margin: 0 0 18px;
    font-size: 1.02rem;
    line-height: 1.6;
    color: var(--text);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
  }

  .screen {
    height: 100%;
    overflow-y: auto;
  }

  .inner {
    width: min(920px, 100%);
    margin: 0 auto;
    padding: 24px 20px 40px;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  h1 {
    margin: 0;
    font-size: 1.8rem;
    font-weight: 600;
  }

  .sub {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  .id {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }

  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    align-items: start;
  }

  .plan-box {
    aspect-ratio: 4 / 3;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    overflow: hidden;
  }

  .caption {
    margin: 8px 0 0;
    font-size: 0.85rem;
    color: var(--text-dim);
    line-height: 1.5;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 700;
  }

  .facts h2:not(:first-child) {
    margin-top: 18px;
  }

  ul.plain {
    margin: 0;
    padding-left: 18px;
  }

  ul.plain li {
    margin-bottom: 5px;
    line-height: 1.45;
    font-size: 0.92rem;
  }

  .none {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .cast {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 3px 12px 3px 3px;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    font-size: 0.85rem;
  }

  .who.victim {
    opacity: 0.75;
  }

  .go {
    display: flex;
    gap: 8px;
    margin-top: 24px;
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }

  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
