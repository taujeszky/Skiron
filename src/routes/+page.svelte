<script lang="ts">
  // Wave 0 placeholder. Wave 4 replaces this with the whole app shell.
  import { RNG } from "$lib/engine/rng";

  const demo = new RNG("skiron").int(1000);
</script>

<main>
  <h1>Skiron</h1>
  <p class="tag">Murder mysteries that are provably fair.</p>
  <p class="note">
    Scaffold only — the engine lands in wave 1. Seeded RNG says {demo}.
  </p>
</main>

<style>
  main {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
    padding: 24px;
  }
  h1 {
    margin: 0;
    font-size: 2.6rem;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .tag {
    margin: 0;
    color: var(--text-dim);
  }
  .note {
    margin-top: 16px;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
</style>
