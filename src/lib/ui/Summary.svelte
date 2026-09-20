<!--
  The summing-up.

  Three things, in the order they matter: the verdict, how the case was
  actually proved, and the evening played back on the map.

  The proof is `case.trace` — the steps sliced back from the cuts into the
  answer set, so it is the chain that cornered the killer rather than every
  room the solver crossed off on the way. It is stored as `Step[]` and
  rendered here, never stored as sentences, which is what lets wave 5 re-read
  the same proof in the skin's names and wave 9 in another language.

  The replay is the only place in the game where a component is handed the
  truth, and it is handed it after the accusation has already been compared
  with it.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import type { PersonId, RoomId } from "$lib/engine/types";
  import { difficultyLabel } from "$lib/engine/solver/difficulty";
  import {
    abandon,
    explain,
    game,
    goto,
    newCase,
    rating,
    settings,
    summingUp,
    summingUpCards,
  } from "$lib/game/controller";
  import { formatDuration } from "$lib/game/rating";
  import CardView from "./CardView.svelte";
  import Plan from "./Plan.svelte";
  import Token from "./Token.svelte";

  const g = $derived($game!);
  const frame = $derived(g.case.frame);
  const world = $derived(g.case.world);
  const glossary = $derived($explain!.glossary);

  let slot = $state(0);
  let playing = $state(true);

  /**
   * One slot a second and a half.
   *
   * Slow enough to follow six people walking through a house, and it stops at
   * the end rather than looping — a loop makes the murder hour arrive twice
   * and the second time it is furniture.
   */
  const STEP_MS = 1500;
  const timer = setInterval(() => {
    if (!playing) return;
    if (slot + 1 >= frame.slots) {
      playing = false;
      return;
    }
    slot += 1;
  }, STEP_MS);
  onDestroy(() => clearInterval(timer));

  const truth = $derived.by(() => {
    const out = new Map<RoomId, PersonId[]>();
    for (let p = 0; p < frame.people; p++) {
      const r = world.loc[p][slot];
      const list = out.get(r);
      if (list) list.push(p);
      else out.set(r, [p]);
    }
    return out;
  });

  const isMurder = $derived(slot === world.murderSlot);
  const cardLabel = (id: string) => $explain!.cardLabel(id);
</script>

<div class="screen">
  <div class="inner">
    <header>
      <div>
        <h1>Solved</h1>
        <p class="sub">
          {glossary.personName(world.culprit)} killed
          {glossary.personName(frame.victim)} in
          {glossary.roomName(frame.murderRoom)}, in
          {glossary.slotLabel(world.murderSlot)}.
        </p>
      </div>
      <span class="marks" title={$rating?.title}>
        {#each [0, 1, 2] as i (i)}
          <span class="mark" class:on={($rating?.marks ?? 0) > i}>★</span>
        {/each}
      </span>
    </header>

    <section class="score">
      <div class="verdict">
        <strong>{$rating?.title}</strong>
        {#if ($rating?.notes.length ?? 0) > 0}
          <ul>
            {#each $rating!.notes as note (note)}
              <li>{note}</li>
            {/each}
          </ul>
        {:else}
          <p class="clean">At or under par, unaided, and right the first time.</p>
        {/if}
      </div>
      <dl class="numbers">
        <div><dt>Difficulty</dt><dd>{difficultyLabel(g.case.difficulty)}</dd></div>
        <div><dt>Moves</dt><dd>{g.spent.length} / {g.case.investigation.par}</dd></div>
        <div><dt>Time</dt><dd>{formatDuration(g.ms)}</dd></div>
        <div><dt>Hints</dt><dd>{g.hints}</dd></div>
        <div><dt>Wrong names</dt><dd>{g.wrong.length}</dd></div>
        <div><dt>Case</dt><dd class="id">{g.text}</dd></div>
      </dl>
    </section>

    <div class="cols">
      <section>
        <h2>How it was proved</h2>
        <ol class="trace">
          {#each $summingUp as line, i (i)}
            <li>{line}</li>
          {/each}
        </ol>
        {#if $summingUp.length === 0}
          <p class="none">
            The case file settled it on its own — there was nothing left to
            argue.
          </p>
        {/if}
      </section>

      <section>
        <h2>The evening</h2>
        <div class="plan-box" class:murder={isMurder}>
          <Plan {frame} {glossary} {slot} placed={truth} />
        </div>
        <div class="scrub">
          <button
            class="btn small"
            onclick={() => {
              if (slot + 1 >= frame.slots) slot = 0;
              playing = !playing;
            }}
          >
            {playing ? "Pause" : slot + 1 >= frame.slots ? "Again" : "Play"}
          </button>
          <span class="when" class:hot={isMurder}>
            {glossary.slotLabel(slot)}{isMurder ? " — the murder" : ""}
          </span>
          <input
            type="range"
            min="0"
            max={frame.slots - 1}
            value={slot}
            aria-label="Which hour the replay shows"
            oninput={(e) => {
              playing = false;
              slot = Number(e.currentTarget.value);
            }}
          />
        </div>
        <p class="legend">
          <Token {frame} person={world.culprit} size={18} />
          <span>{glossary.personName(world.culprit)} — the killer</span>
        </p>
      </section>
    </div>

    <details class="proofcards">
      <summary>The cards the proof rests on ({$summingUpCards.length})</summary>
      <div class="cards">
        {#each $summingUpCards as clue (clue.id)}
          <CardView
            {frame}
            {glossary}
            {clue}
            label={cardLabel(clue.id)}
            sentence={$explain!.clue(clue)}
            canonical={$settings.showCanonical}
          />
        {/each}
      </div>
    </details>

    <div class="go">
      <button class="btn primary" onclick={() => newCase(g.id.preset)}>
        Another {difficultyLabel(g.id.preset)} case
      </button>
      <button class="btn" onclick={abandon}>Back to the desk</button>
      <button class="btn" onclick={() => goto("stats")}>The record</button>
    </div>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    overflow-y: auto;
  }

  .inner {
    width: min(960px, 100%);
    margin: 0 auto;
    padding: 24px 20px 48px;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 600;
  }

  .sub {
    margin: 4px 0 0;
    font-size: 1rem;
    line-height: 1.5;
  }

  .marks {
    font-size: 1.5rem;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }

  .mark {
    color: var(--panel-border);
  }

  .mark.on {
    color: var(--warn);
  }

  .score {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 20px 0 8px;
    padding: 14px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    background: var(--panel);
  }

  .verdict strong {
    font-size: 1.05rem;
  }

  .verdict ul {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .clean {
    margin: 6px 0 0;
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .numbers {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 14px;
    font-size: 0.85rem;
  }

  .numbers div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px dotted var(--panel-border);
    padding-bottom: 2px;
  }

  .numbers dt {
    color: var(--text-dim);
  }

  .numbers dd {
    margin: 0;
    font-weight: 600;
  }

  .id {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 0.78rem;
  }

  .cols {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 22px;
    margin-top: 20px;
    align-items: start;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 700;
  }

  .trace {
    margin: 0;
    padding-left: 20px;
  }

  .trace li {
    margin-bottom: 8px;
    line-height: 1.5;
    font-size: 0.92rem;
  }

  .none {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .plan-box {
    aspect-ratio: 4 / 3;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    overflow: hidden;
    transition: box-shadow 0.3s;
  }

  .plan-box.murder {
    box-shadow: 0 0 0 2px var(--danger);
  }

  .scrub {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .when {
    font-size: 0.8rem;
    white-space: nowrap;
    color: var(--text-dim);
  }

  .when.hot {
    color: var(--danger);
    font-weight: 600;
  }

  .scrub input {
    flex: 1;
    accent-color: var(--accent);
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0 0;
    font-size: 0.82rem;
    color: var(--text-dim);
  }

  .proofcards {
    margin-top: 24px;
  }

  .proofcards summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-dim);
    padding: 6px 0;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 6px;
    margin-top: 8px;
  }

  .go {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 26px;
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }

  @media (max-width: 820px) {
    .score,
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
