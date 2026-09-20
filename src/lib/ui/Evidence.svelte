<!--
  The evidence pane, which is also the way to get more of it.

  Two states in one column. Normally it is the card list, filterable by who,
  when and where. Pick somebody out of the cast strip and it becomes the
  interrogation: every question the game offers that person, grouped, with the
  ones already put marked as put.

  **"Nothing to say" is an answer.** Rule 7 — silence proves nothing — is what
  makes an empty reply legitimate rather than a dead end, so a question that
  turns nothing up is still shown as asked and still costs a move. A version
  that hid the fruitless questions would be quietly telling the player which
  ones were fruitful.
-->
<script lang="ts">
  import { clueMentions } from "$lib/engine/clues";
  import type { Clue, PersonId, RoomId, SlotIndex } from "$lib/engine/types";
  import {
    alreadyAsked,
    answering,
    askAbout,
    canConverse,
    cards,
    chat,
    evidenceFilter,
    explain,
    game,
    putQuestion,
    questioning,
    selectedCard,
    settings,
    topicsFor,
  } from "$lib/game/controller";
  import { askKey } from "$lib/game/types";
  import CardView from "./CardView.svelte";
  import Token from "./Token.svelte";
  import { peopleIds, roomIds, slotIndexes, suspectIds } from "./look";

  const frame = $derived($game!.case.frame);
  const glossary = $derived($explain!.glossary);

  /**
   * Newest first.
   *
   * The card that has just arrived is the one being read, and a list that
   * grows downwards puts it off the bottom of a phone. The numbering is
   * unchanged — `Card 7` stays `Card 7` wherever it sits — because the hints
   * count against the collection order and not the display order.
   */
  const shown = $derived(
    $cards
      .map((clue, i) => ({ clue, label: $explain!.cardLabel(clue.id), index: i }))
      .filter(({ clue }) => matches(clue))
      .reverse(),
  );

  function matches(clue: Clue): boolean {
    const f = $evidenceFilter;
    if (f.person < 0 && f.slot < 0 && f.room < 0) return true;
    const m = clueMentions(clue.body, frame);
    const speaker = clue.source.kind === "testimony" ? clue.source.speaker : -1;
    if (f.person >= 0 && !m.people.includes(f.person) && speaker !== f.person) {
      return false;
    }
    if (f.slot >= 0 && !m.slots.includes(f.slot)) return false;
    if (f.room >= 0 && !m.rooms.includes(f.room)) return false;
    return true;
  }

  const filtered = $derived(
    $evidenceFilter.person >= 0 ||
      $evidenceFilter.slot >= 0 ||
      $evidenceFilter.room >= 0,
  );

  function setFilter(patch: Partial<{ person: PersonId; slot: SlotIndex; room: RoomId }>) {
    evidenceFilter.update((f) => ({ ...f, ...patch }));
  }

  function clearFilter() {
    evidenceFilter.set({ person: -1, slot: -1, room: -1 });
  }

  const asking = $derived($questioning);
  const topics = $derived(asking === null ? [] : topicsFor(frame, asking, glossary));
  const groups = [
    { key: "slot", title: "About an hour" },
    { key: "person", title: "About somebody" },
    { key: "room", title: "About a room" },
    { key: "motive", title: "About themselves" },
  ] as const;

  /*
   * The free-text layer (wave 6), which is a layer and never a replacement.
   *
   * `$game` is read here so the expression re-runs when the case changes;
   * `canConverse` is the controller's own gate, so the box and the action
   * cannot disagree about whether it is on offer. Without a key, or without a
   * skin to have a voice, the picker below is the whole interrogation — and
   * that is exactly what wave 4 shipped as.
   */
  const chatOn = $derived($game !== null && canConverse());
  const talk = $derived(asking === null ? [] : $chat.filter((t) => t.who === asking));
  const waiting = $derived(asking !== null && $answering === asking);

  let typed = $state("");
  let log = $state<HTMLDivElement | null>(null);

  // Follow the conversation down. Reading `talk.length` is what subscribes
  // this to a new turn arriving.
  $effect(() => {
    void talk.length;
    if (log) log.scrollTop = log.scrollHeight;
  });

  function send(): void {
    if (asking === null || waiting) return;
    const text = typed.trim();
    if (text === "") return;
    typed = "";
    void putQuestion(asking, text);
  }
</script>

<div class="pane">
  <div class="cast">
    {#each suspectIds(frame) as s (s)}
      <button
        class="who"
        class:on={asking === s}
        onclick={() => questioning.set(asking === s ? null : s)}
        title="Question {glossary.personName(s)}"
      >
        <Token {frame} person={s} size={20} />
        <span>{glossary.personName(s)}</span>
      </button>
    {/each}
  </div>

  {#if asking !== null}
    <div class="head">
      <strong>Questioning {glossary.personName(asking)}</strong>
      <button class="btn small" onclick={() => questioning.set(null)}>Back to the file</button>
    </div>

    {#if chatOn}
      <div class="chat" data-chat="on">
        <div class="log" bind:this={log}>
          {#if talk.length === 0}
            <p class="aside">
              Put it in your own words. What they say is dressing; the cards they
              hand over are the evidence.
            </p>
          {/if}
          {#each talk as turn, i (i)}
            <div class="turn {turn.from}">
              <p>{turn.text}</p>
              {#if turn.cards && turn.cards.length > 0}
                <div class="chips">
                  {#each turn.cards as id (id)}
                    <button
                      class="chip"
                      class:on={$selectedCard === id}
                      onclick={() => selectedCard.set($selectedCard === id ? null : id)}
                    >
                      {$explain!.cardLabel(id)}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          {#if waiting}
            <div class="turn suspect thinking"><p>…</p></div>
          {/if}
        </div>
        <form
          class="say"
          onsubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            type="text"
            bind:value={typed}
            disabled={waiting}
            maxlength="300"
            placeholder="Where were you at nine?"
            aria-label="Ask {glossary.personName(asking)} something"
          />
          <button class="btn small" type="submit" disabled={waiting || typed.trim() === ""}>
            Ask
          </button>
        </form>
      </div>
    {/if}

    <div class="scroll">
      {#each groups as group (group.key)}
        {@const list = topics.filter((t) => t.group === group.key)}
        {#if list.length > 0}
          <h4>{group.title}</h4>
          <div class="topics">
            {#each list as t (t.key)}
              {@const done = alreadyAsked(askKey(asking, t.key))}
              <button
                class="topic"
                class:done
                onclick={() => askAbout(asking, t.key)}
                title={done ? "Already asked — the answer stands" : "Ask"}
              >
                {t.label}{#if done}<span class="tick">✓</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      {/each}
      <p class="aside">
        Silence proves nothing. A question that turns up nothing has still been
        asked, and the answer will not change.
      </p>
    </div>
  {:else}
    <div class="head">
      <strong>The case file</strong>
      <span class="count">{shown.length} of {$cards.length}</span>
    </div>
    <div class="filters">
      <select
        aria-label="Filter by person"
        value={$evidenceFilter.person}
        onchange={(e) => setFilter({ person: Number(e.currentTarget.value) })}
      >
        <option value={-1}>Anyone</option>
        {#each peopleIds(frame) as p (p)}
          <option value={p}>{glossary.personName(p)}</option>
        {/each}
      </select>
      <select
        aria-label="Filter by hour"
        value={$evidenceFilter.slot}
        onchange={(e) => setFilter({ slot: Number(e.currentTarget.value) })}
      >
        <option value={-1}>Any hour</option>
        {#each slotIndexes(frame) as t (t)}
          <option value={t}>{glossary.slotLabel(t)}</option>
        {/each}
      </select>
      <select
        aria-label="Filter by room"
        value={$evidenceFilter.room}
        onchange={(e) => setFilter({ room: Number(e.currentTarget.value) })}
      >
        <option value={-1}>Any room</option>
        {#each roomIds(frame) as r (r)}
          <option value={r}>{glossary.roomName(r)}</option>
        {/each}
      </select>
      {#if filtered}
        <button class="btn small" onclick={clearFilter}>Clear</button>
      {/if}
    </div>
    <div class="scroll cards">
      {#each shown as item (item.clue.id)}
        <CardView
          {frame}
          {glossary}
          clue={item.clue}
          label={item.label}
          sentence={$explain!.clue(item.clue)}
          canonical={$settings.showCanonical}
          selected={$selectedCard === item.clue.id}
          onselect={() =>
            selectedCard.set($selectedCard === item.clue.id ? null : item.clue.id)}
        />
      {/each}
      {#if shown.length === 0}
        <p class="aside">
          {filtered
            ? "No card in the file says anything about that."
            : "Nothing yet. Search a room, or put a question to somebody."}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .cast {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 8px;
    border-bottom: 1px solid var(--panel-border);
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px 4px 4px;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    font-size: 0.82rem;
    background: var(--panel-2);
  }

  .who:hover {
    border-color: var(--accent);
  }

  .who.on {
    border-color: var(--accent);
    background: var(--room-hot);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px 4px;
    font-size: 0.88rem;
  }

  /*
   * The conversation sits above the picker rather than replacing it: the
   * picker is the whole interrogation for anybody without a key, and it is
   * the thing a typed question is routed to. Both on screen at once is also
   * the only way a player can see that they are the same questions.
   */
  .chat {
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 46%;
    border-bottom: 1px solid var(--panel-border);
  }

  .log {
    flex: 1;
    overflow-y: auto;
    padding: 4px 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }

  .turn p {
    margin: 0;
    padding: 6px 9px;
    border-radius: 10px;
    font-size: 0.84rem;
    line-height: 1.45;
    max-width: 92%;
  }

  .turn.player {
    align-items: flex-end;
    display: flex;
    flex-direction: column;
  }

  .turn.player p {
    background: var(--accent);
    color: var(--accent-text);
    border-bottom-right-radius: 3px;
  }

  .turn.suspect p {
    background: var(--panel-2);
    border: 1px solid var(--panel-border);
    border-bottom-left-radius: 3px;
  }

  .turn.note p {
    background: transparent;
    color: var(--warn);
    font-size: 0.78rem;
    padding-left: 0;
  }

  .turn.thinking p {
    color: var(--text-dim);
    letter-spacing: 0.2em;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .chip {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    color: var(--text-dim);
  }

  .chip.on,
  .chip:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .say {
    display: flex;
    gap: 5px;
    padding: 0 10px 8px;
  }

  .say input {
    flex: 1;
    min-width: 0;
    font-size: 0.82rem;
    padding: 5px 8px;
  }

  .count {
    color: var(--text-dim);
    font-size: 0.78rem;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 4px 10px 8px;
  }

  .filters select {
    font-size: 0.78rem;
    padding: 4px 6px;
    flex: 1 1 auto;
    min-width: 88px;
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 12px;
    min-height: 0;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h4 {
    margin: 12px 0 5px;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    font-weight: 700;
  }

  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .topic {
    padding: 6px 10px;
    border-radius: 7px;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    font-size: 0.82rem;
    min-height: 34px;
  }

  .topic:hover {
    border-color: var(--accent);
  }

  .topic.done {
    color: var(--text-dim);
    background: var(--panel-2);
  }

  .tick {
    margin-left: 5px;
    color: var(--ok);
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }

  .aside {
    color: var(--text-dim);
    font-size: 0.8rem;
    line-height: 1.5;
    margin: 14px 0 0;
  }
</style>
