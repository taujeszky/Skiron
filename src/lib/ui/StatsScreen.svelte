<!--
  The record, by difficulty.

  By the difficulty the case turned out to be, not the one that was asked for.
  A preset is a request and the tier the solver actually needed is the answer
  (`difficulty.ts`), so asking for Expert and being handed a Hard case counts
  as a Hard case solved — otherwise the Expert column would be inflatable by
  asking for Expert and playing whatever turned up.
-->
<script lang="ts">
  import { PRESET_NAMES, difficultyLabel } from "$lib/engine/solver/difficulty";
  import { goto, stats } from "$lib/game/controller";
  import { formatDuration } from "$lib/game/rating";
  import { totalSolved, totalTime } from "$lib/game/stats";
  import { storageIsDurable } from "$lib/game/storage";

  const anything = $derived(totalSolved($stats) > 0);
</script>

<div class="screen" data-screen="stats">
  <div class="inner">
    <header>
      <h1>The record</h1>
      <button class="btn small" onclick={() => goto("home")}>‹ Desk</button>
    </header>

    {#if !anything}
      <p class="none">Nothing solved yet. That is where everybody starts.</p>
    {/if}

    <table>
      <thead>
        <tr>
          <th scope="col">Difficulty</th>
          <th scope="col">Solved</th>
          <th scope="col">At par</th>
          <th scope="col">Best time</th>
          <th scope="col">Fewest moves</th>
          <th scope="col">Hints</th>
          <th scope="col">Wrong</th>
          <th scope="col">Run</th>
        </tr>
      </thead>
      <tbody>
        {#each PRESET_NAMES as name (name)}
          {@const row = $stats[name]}
          <tr>
            <th scope="row">{difficultyLabel(name)}</th>
            <td>{row.solved}<span class="of">/{row.started}</span></td>
            <td>{row.atPar}</td>
            <td>{row.bestMs === null ? "—" : formatDuration(row.bestMs)}</td>
            <td>{row.bestActions ?? "—"}</td>
            <td>{row.hints}</td>
            <td>{row.wrong}</td>
            <td>
              {row.streak}{#if row.bestStreak > row.streak}
                <span class="of">best {row.bestStreak}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <p class="total">
      {totalSolved($stats)} solved in all, over {formatDuration(totalTime($stats))}.
    </p>

    {#if !storageIsDurable()}
      <p class="warn">
        This browser will not keep anything between visits, so the record and
        any case in progress live only as long as the tab does.
      </p>
    {/if}
  </div>
</div>

<style>
  .screen {
    height: 100%;
    overflow-y: auto;
  }

  .inner {
    width: min(780px, 100%);
    margin: 0 auto;
    padding: 24px 20px 40px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: 1.7rem;
    font-weight: 600;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  th,
  td {
    text-align: right;
    padding: 7px 8px;
    border-bottom: 1px solid var(--panel-border);
  }

  thead th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    font-weight: 700;
    white-space: nowrap;
  }

  th[scope="row"],
  thead th:first-child {
    text-align: left;
  }

  .of {
    color: var(--text-dim);
    font-size: 0.78rem;
    margin-left: 3px;
  }

  .none,
  .total {
    color: var(--text-dim);
    font-size: 0.88rem;
  }

  .total {
    margin-top: 14px;
  }

  .warn {
    margin-top: 14px;
    padding: 10px 12px;
    border-left: 3px solid var(--warn);
    background: var(--panel);
    border-radius: 8px;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }

  @media (max-width: 620px) {
    table {
      font-size: 0.8rem;
    }
    th,
    td {
      padding: 6px 4px;
    }
  }
</style>
