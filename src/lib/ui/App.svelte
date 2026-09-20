<!--
  The shell: which screen is up, what the keys do, and the two bits of
  lifecycle nothing else can own.

  One route and a `screen` store rather than real routing. The app is a static
  SPA whose fallback is `404.html`, and a deep link into a case would be a
  link to a case id the browser would have to rebuild anyway — the case number
  box on the desk does that job with a URL that survives being read aloud.

  The clock is paused when the tab goes away and the save is flushed with it.
  A player who closes a laptop mid-case should not come back to an hour of
  thinking time they did not spend, and a browser that kills the tab without
  warning should not cost them the notebook.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import {
    askForHint,
    cancelLoad,
    checkNotebook,
    closePanel,
    game,
    goto,
    loading,
    markMode,
    pauseClock,
    redoMark,
    resumeClock,
    screen,
    start,
    undoMark,
  } from "$lib/game/controller";
  import Accuse from "./Accuse.svelte";
  import Briefing from "./Briefing.svelte";
  import Home from "./Home.svelte";
  import HowTo from "./HowTo.svelte";
  import Investigate from "./Investigate.svelte";
  import SettingsScreen from "./SettingsScreen.svelte";
  import StatsScreen from "./StatsScreen.svelte";
  import Summary from "./Summary.svelte";

  start();

  /** Screens that make no sense without a case open. */
  const NEEDS_CASE = new Set(["briefing", "investigate", "accuse", "summary"]);
  const showing = $derived(
    NEEDS_CASE.has($screen) && $game === null ? "home" : $screen,
  );

  onMount(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pauseClock();
      else resumeClock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // `pagehide` rather than `unload`: mobile Safari never fires `unload`, and
    // a save that is written on desktop and not on a phone is worse than one
    // written on neither, because only one of the two gets noticed.
    window.addEventListener("pagehide", pauseClock);
    registerWorker();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pauseClock);
    };
  });

  /**
   * The service worker, registered by hand.
   *
   * `svelte.config.js` turns the automatic registration off so that it never
   * happens during prerender. It is deliberately not awaited and its failure
   * is deliberately swallowed: a browser with service workers switched off
   * plays the game perfectly well, and an unhandled rejection in the console
   * on every load would be the only difference.
   */
  function registerWorker(): void {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    void navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }

  /**
   * Keys, globally, but only where they cannot be somebody else's.
   *
   * The notebook grid owns the digits — they pick a room — so anything typed
   * inside it, or inside a text box, is left alone. That is why this handler
   * checks the target rather than the key first: the alternative is a player
   * pressing 3 to cross out R3 and being taken to the evidence tab.
   */
  function onkeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (target?.isContentEditable) return;

    // While a case is building, the only key that means anything is the one
    // that stops it — and Escape must reach it before it reaches the panel.
    if ($loading) {
      if (e.key === "Escape") cancelLoad();
      return;
    }
    if (e.key === "Escape") {
      closePanel();
      return;
    }
    if (showing !== "investigate") return;

    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undoMark();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redoMark();
      }
      return;
    }
    if (e.altKey) return;

    switch (e.key.toLowerCase()) {
      case "h":
        e.preventDefault();
        askForHint();
        break;
      case "c":
        e.preventDefault();
        checkNotebook();
        break;
      case "a":
        e.preventDefault();
        goto("accuse");
        break;
      case "x":
        e.preventDefault();
        markMode.update((m) => (m === "cross" ? "place" : "cross"));
        break;
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  {#if showing === "home"}
    <Home />
  {:else if showing === "briefing"}
    <Briefing />
  {:else if showing === "investigate"}
    <Investigate />
  {:else if showing === "accuse"}
    <Accuse />
  {:else if showing === "summary"}
    <Summary />
  {:else if showing === "stats"}
    <StatsScreen />
  {:else if showing === "howto"}
    <HowTo back={$game ? "investigate" : "home"} />
  {:else if showing === "settings"}
    <SettingsScreen />
  {/if}

  {#if $loading}
    <div class="veil" role="status" aria-live="polite">
      <div class="box">
        <span class="spinner" aria-hidden="true"></span>
        <p class="what">{$loading.label}</p>
        <p class="why">
          Every case is generated and then proved fair twice before you see it.
        </p>
        <button class="btn" onclick={cancelLoad}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    height: 100%;
    position: relative;
  }

  .veil {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(2px);
    z-index: 10;
  }

  .box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 28px;
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow);
    text-align: center;
    max-width: 320px;
  }

  .spinner {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 3px solid var(--panel-border);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2.4s;
    }
  }

  .what {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .why {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
    line-height: 1.45;
  }
</style>
