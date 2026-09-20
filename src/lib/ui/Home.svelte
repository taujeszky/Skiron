<!--
  The desk: pick up where you left off, take a new case, or type in a number
  somebody sent you.

  The case number is the share link, the bug report and the regression
  fixture, all in a dozen characters, because a case is a pure function of its
  id (invariant 4). That is worth a box on the front screen rather than
  burying it in settings.
-->
<script lang="ts">
  import { PRESET_NAMES, PRESETS, difficultyLabel } from "$lib/engine/solver/difficulty";
  import type { PresetName } from "$lib/engine/types";
  import {
    canDress,
    goto,
    loading,
    newCase,
    openCaseText,
    openPackCase,
    panel,
    resume,
    savedCaseId,
    setting,
    stats,
  } from "$lib/game/controller";
  import { totalSolved } from "$lib/game/stats";
  import { loadManifest } from "$lib/llm/packLoader";
  import type { PackEntry } from "$lib/llm/pack";

  let typed = $state("");
  let saved = $state<string | null>(null);
  /** Only offered when there is a key to use; otherwise it would only annoy. */
  let dressable = $state(false);
  /**
   * The shipped cases, if any are shipped.
   *
   * Empty until the manifest answers, and the whole section stays hidden if
   * it never does — an empty shelf with a heading over it is worse than no
   * shelf. These need no key and no network beyond the file itself.
   */
  let shelf = $state<PackEntry[]>([]);
  let shelfName = $state("");

  // Read once on mount rather than in a derived: the save changes only when
  // this screen is not on, so re-reading it on every keystroke would be work
  // for nothing.
  $effect(() => {
    saved = savedCaseId();
    dressable = canDress();
  });

  $effect(() => {
    void loadManifest().then((manifest) => {
      if (manifest) {
        shelf = manifest.cases;
        shelfName = manifest.name;
      }
    });
  });

  const busy = $derived($loading !== null);

  async function open() {
    const text = typed.trim();
    if (text.length === 0) return;
    if (await openCaseText(text)) typed = "";
  }

  function shape(preset: PresetName): string {
    const p = PRESETS[preset];
    return `${p.suspects} suspects · ${p.rooms} rooms · ${p.slots} hours${p.lying ? " · the killer lies" : ""}`;
  }
</script>

<div class="screen">
  <div class="inner">
    <header>
      <h1>Skiron</h1>
      <p class="tag">Murder mysteries that are provably fair.</p>
    </header>

    {#if saved}
      <button class="resume" disabled={busy} onclick={() => resume()}>
        <span class="big">Carry on</span>
        <span class="small">{saved}</span>
      </button>
    {/if}

    <h2>A new case</h2>
    {#if dressable}
      <label class="setting">
        <span>Set it somewhere</span>
        <input
          type="text"
          bind:value={$setting}
          disabled={busy}
          placeholder="a lighthouse in a storm, 1923"
          aria-label="The setting for the next case"
          maxlength="200"
        />
        <small>
          The model names the place and the people and writes every clue. The
          puzzle underneath is the same either way, and every sentence is
          checked against the evidence before you see it. Leave it blank for
          the engine's own words.
        </small>
      </label>
    {/if}
    <div class="presets">
      {#each PRESET_NAMES as name (name)}
        <button class="preset" disabled={busy} onclick={() => newCase(name)}>
          <span class="big">{difficultyLabel(name)}</span>
          <span class="small">{shape(name)}</span>
          <span class="tiny">
            {$stats[name].solved} solved{#if $stats[name].bestStreak > 1}
              · best run {$stats[name].bestStreak}{/if}
          </span>
        </button>
      {/each}
    </div>

    {#if shelf.length > 0}
      <h2>Cases we wrote</h2>
      <div class="shelf">
        {#each shelf as entry (entry.id)}
          <button class="case" disabled={busy} onclick={() => openPackCase(entry.id)}>
            <span class="big">{entry.title}</span>
            <span class="small">{entry.setting}</span>
            <span class="tiny">{entry.preset} · {entry.id}</span>
          </button>
        {/each}
      </div>
    {/if}

    <h2>A case by number</h2>
    <form
      class="bynumber"
      onsubmit={(e) => {
        e.preventDefault();
        void open();
      }}
    >
      <input
        type="text"
        bind:value={typed}
        placeholder="SK1-N-3f9k2a"
        aria-label="Case number"
        spellcheck="false"
        autocapitalize="characters"
      />
      <button class="btn" type="submit" disabled={busy || typed.trim() === ""}>Open</button>
    </form>
    {#if $panel.kind === "error"}
      <p class="oops">{$panel.text}</p>
    {/if}

    <nav class="links">
      <button class="btn" onclick={() => goto("howto")}>How to play</button>
      <button class="btn" onclick={() => goto("stats")}>
        Record{#if totalSolved($stats) > 0}
          <span class="dim">({totalSolved($stats)})</span>{/if}
      </button>
      <button class="btn" onclick={() => goto("settings")}>Settings</button>
    </nav>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    overflow-y: auto;
    display: flex;
    justify-content: center;
  }

  .inner {
    width: min(620px, 100%);
    padding: 32px 20px 48px;
  }

  header {
    text-align: center;
    margin-bottom: 26px;
  }

  h1 {
    margin: 0;
    font-size: 2.6rem;
    letter-spacing: 0.06em;
    font-weight: 600;
  }

  .tag {
    margin: 6px 0 0;
    color: var(--text-dim);
  }

  h2 {
    margin: 22px 0 8px;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 700;
  }

  .resume,
  .preset {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    background: var(--panel);
    transition: border-color 0.15s;
  }

  .resume:hover:not(:disabled),
  .preset:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .resume:disabled,
  .preset:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .resume {
    border-color: var(--accent);
    background: var(--room-hot);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 8px;
  }

  .big {
    font-size: 1.05rem;
    font-weight: 600;
  }

  .small {
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .tiny {
    font-size: 0.72rem;
    color: var(--text-dim);
    opacity: 0.85;
  }

  .shelf {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
    margin-bottom: 18px;
  }

  .case {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    background: var(--panel);
    cursor: pointer;
  }

  .case:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .setting {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }

  .setting > span {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .setting small {
    color: var(--text-dim);
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .bynumber {
    display: flex;
    gap: 8px;
  }

  .bynumber input {
    flex: 1;
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }

  .oops {
    margin: 8px 0 0;
    color: var(--danger);
    font-size: 0.85rem;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 26px;
    justify-content: center;
  }

  .dim {
    color: var(--text-dim);
    margin-left: 4px;
  }
</style>
