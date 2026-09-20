<!--
  Settings, and one button that throws things away.

  Everything here is a preference rather than a difficulty knob. The one that
  comes closest is auto-notes, and it stops at the solver's tier 0 — the
  direct consequences of a card, which is bookkeeping — so a player with it on
  and a player with it off are solving the same puzzle.
-->
<script lang="ts">
  import { goto, settings, stats, updateSettings } from "$lib/game/controller";
  import { emptyStats } from "$lib/game/types";
  import { clearSave, saveStats, storageIsDurable } from "$lib/game/storage";
  import { KEY_NOTICE, forgetKey, storedKey, storeKey } from "$lib/llm/key";
  import { skins } from "$lib/llm/skinStore";
  import type { ThemeChoice } from "$lib/game/types";

  let wiping = $state(false);

  /*
   * The key is never bound to an input's value.
   *
   * `typedKey` holds what is being pasted right now and is cleared the moment
   * it is stored; `keySet` is the only thing rendered afterwards. So the key
   * is never in the DOM after the paste, which keeps it out of a screenshot,
   * out of a saved form and out of anything a browser extension reads off the
   * page (invariant 9).
   */
  let typedKey = $state("");
  let keySet = $state(false);
  let keyOops = $state(false);

  $effect(() => {
    keySet = storedKey() !== null;
  });

  function saveKey() {
    if (storeKey(typedKey)) {
      typedKey = "";
      keyOops = false;
      keySet = true;
    } else {
      keyOops = true;
    }
  }

  function dropKey() {
    forgetKey();
    keySet = false;
    typedKey = "";
    keyOops = false;
  }

  const themes: { value: ThemeChoice; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "auto", label: "Match the machine" },
  ];

  function wipe(): void {
    const blank = emptyStats();
    stats.set(blank);
    saveStats(blank);
    clearSave();
    // The written cases go too. They are the bulkiest thing stored and the
    // warning says so; the key is deliberately left, because clearing the
    // record is not the same as signing out.
    void skins().clear();
    wiping = false;
  }
</script>

<div class="screen">
  <div class="inner">
    <header>
      <h1>Settings</h1>
      <button class="btn small" onclick={() => goto("home")}>‹ Desk</button>
    </header>

    <h2>Look</h2>
    <div class="choice" role="group" aria-label="Theme">
      {#each themes as t (t.value)}
        <button
          class:on={$settings.theme === t.value}
          onclick={() => updateSettings({ theme: t.value })}
        >
          {t.label}
        </button>
      {/each}
    </div>

    <h2>Play</h2>
    <label class="row">
      <span>
        Auto-notes
        <small>Write a card's direct consequences into the grid as it arrives.</small>
      </span>
      <input
        type="checkbox"
        checked={$settings.autoNotes}
        onchange={(e) => updateSettings({ autoNotes: e.currentTarget.checked })}
      />
    </label>
    <label class="row">
      <span>
        Show the canonical form
        <small>The engine's own wording under each card. Only the card is canon.</small>
      </span>
      <input
        type="checkbox"
        checked={$settings.showCanonical}
        onchange={(e) => updateSettings({ showCanonical: e.currentTarget.checked })}
      />
    </label>
    <label class="row">
      <span>
        Confirm an accusation
        <small>Ask before a name goes on the record.</small>
      </span>
      <input
        type="checkbox"
        checked={$settings.confirmAccusation}
        onchange={(e) => updateSettings({ confirmAccusation: e.currentTarget.checked })}
      />
    </label>
    <label class="row">
      <span>
        Map follows the notebook
        <small>Moving around the grid scrubs the map to the same hour.</small>
      </span>
      <input
        type="checkbox"
        checked={$settings.linkScrubber}
        onchange={(e) => updateSettings({ linkScrubber: e.currentTarget.checked })}
      />
    </label>

    <h2>Writing the cases</h2>
    <div class="row keyrow">
      <span>
        Google API key
        <small>{KEY_NOTICE}</small>
        <small>
          Without one, cases are played in the engine's own words — which is
          the whole game, just plainer.
        </small>
      </span>
    </div>
    {#if keySet}
      <div class="pair">
        <span class="pill">A key is set</span>
        <button class="btn" onclick={dropKey}>Forget it</button>
      </div>
    {:else}
      <div class="pair">
        <input
          class="keyin"
          type="password"
          bind:value={typedKey}
          placeholder="AIza…"
          aria-label="Google API key"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="btn" disabled={typedKey.trim() === ""} onclick={saveKey}>Save</button>
      </div>
      {#if keyOops}
        <p class="warn">That does not look like a Google API key.</p>
      {/if}
    {/if}

    <h2>Everything on this machine</h2>
    {#if !storageIsDurable()}
      <p class="warn">
        This browser is not keeping anything between visits — private mode, or
        site data turned off. The game plays perfectly well; it simply forgets.
      </p>
    {/if}
    {#if wiping}
      <p class="warn">
        This clears the record, any case in progress and every case the model
        has written for you. Your key is kept. It cannot be undone.
      </p>
      <div class="pair">
        <button class="btn danger" onclick={wipe}>Yes, clear it</button>
        <button class="btn" onclick={() => (wiping = false)}>Keep it</button>
      </div>
    {:else}
      <button class="btn" onclick={() => (wiping = true)}>Clear the record</button>
    {/if}

    <h2>About</h2>
    <p class="about">
      Every case is generated and proved fair twice over: a tier-capped
      deduction solver finishes it, and an independent exhaustive solver
      confirms that exactly one culprit and one hour fit the evidence. A case
      is a pure function of its number, so the same number always rebuilds the
      same case.
    </p>
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
    padding: 24px 20px 48px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
  }

  h1 {
    margin: 0;
    font-size: 1.7rem;
    font-weight: 600;
  }

  h2 {
    margin: 26px 0 8px;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 700;
  }

  .choice {
    display: inline-flex;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .choice button {
    padding: 8px 14px;
    font-size: 0.85rem;
    background: var(--panel);
  }

  .choice button.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .row {
    border-bottom: 1px solid var(--panel-border);
    align-items: flex-start;
  }

  .row span {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.93rem;
  }

  .row small {
    color: var(--text-dim);
    font-size: 0.79rem;
    line-height: 1.4;
  }

  .row input {
    margin-top: 3px;
    flex: none;
  }

  .keyrow {
    border-bottom: none;
    padding-bottom: 4px;
  }

  .keyin {
    flex: 1;
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }

  .pill {
    align-self: center;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .warn {
    padding: 10px 12px;
    border-left: 3px solid var(--warn);
    background: var(--panel);
    border-radius: 8px;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .pair {
    display: flex;
    gap: 8px;
  }

  .btn.danger {
    border-color: var(--danger);
    color: var(--danger);
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }

  .about {
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--text-dim);
  }
</style>
