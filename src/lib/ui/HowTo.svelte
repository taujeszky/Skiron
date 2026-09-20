<!--
  The rules, all eight of them.

  This screen is not a tutorial. It is the axiom list — the same eight the
  solvers are allowed to use and nothing else — because the promise the whole
  game rests on is that a case can be reasoned out, and a player cannot reason
  from rules they have not been told. The plan requires all eight to be on
  this screen, and the wording here follows the plan's wording closely enough
  that the two can be read against each other.

  The presence semantics in rule 3 are the one place this has to be fussier
  than the plan's sentence, because `types.ts` draws a line that costs a
  player a case if they get it wrong: clues about *where a body was* count the
  corpse, clues about *company* count only the living.
-->
<script lang="ts">
  import { goto, game } from "$lib/game/controller";

  let { back = "home" as "home" | "briefing" | "investigate" } = $props();
</script>

<div class="screen" data-screen="howto">
  <div class="inner">
    <header>
      <h1>How to play</h1>
      <button class="btn small" onclick={() => goto($game ? back : "home")}>
        ‹ Back
      </button>
    </header>

    <p class="lead">
      Somebody was killed during the evening. You know the house, the cast and
      the room the body was found in. Work out <strong>who</strong> and
      <strong>in which hour</strong>.
    </p>

    <h2>The rules</h2>
    <ol class="rules">
      <li>
        The evening is divided into hours. In each hour every person is in
        exactly one room.
      </li>
      <li>
        Between one hour and the next, a person stays put or passes through one
        open door. The case file may close a door for part of the evening, bar
        somebody from a door or a room, or cap how many people a room holds.
      </li>
      <li>
        People in the same room in the same hour see each other. Nobody sees
        into another room.
      </li>
      <li>
        The victim was killed in the room where the body was found, in a single
        hour, alone with the killer.
      </li>
      <li>
        From the murder until the body was found at the end of the evening,
        nobody except the killer was in that room. The killer may stay or
        leave. The body does not move.
      </li>
      <li>Physical evidence and case-file rules are always true.</li>
      <li>
        Innocent people always tell the truth, but they do not tell everything:
        <strong>silence proves nothing</strong>. In a case marked "the killer
        lies", the killer's statements may be false. Otherwise the killer also
        tells the truth and merely leaves things out.
      </li>
      <li>An accusation names the killer and the hour.</li>
    </ol>

    <h2>The one piece of small print</h2>
    <p>
      Clues about <em>where a body was</em> — "was in", "was not in", "stayed
      in", "visited", "never visited" — hold of the victim's body as well as of
      the living. Clues about <em>company</em> — "saw", "was with", "was alone
      in", "was empty", "how many were in" — count the living only: the victim
      counts while alive and the body does not count at all. So "nobody was in
      the study at eleven" can be true of the room the body is lying in.
    </p>

    <h2>What you can do</h2>
    <ul>
      <li>
        <strong>Search a room.</strong> Click it on the map. Physical evidence
        is always true.
      </li>
      <li>
        <strong>Question somebody.</strong> Pick them out of the cast and ask
        about an hour, a person, a room, or themselves.
      </li>
      <li>
        <strong>Keep the notebook.</strong> Cross rooms out of a cell, place
        somebody when you are sure, strike a name off or rule an hour out.
      </li>
    </ul>
    <p class="aside">
      There is no limit and no way to lose. Every move is counted against par,
      and hints and wrong accusations go on the record — that is all.
    </p>

    <h2>Hint and Check</h2>
    <p>
      <strong>Hint</strong> reasons only from the cards you have actually
      collected. It will tell you if something in your notebook is wrong, or
      give you the easiest deduction you have missed, or — when your cards have
      nothing left to give — tell you what to go and ask.
    </p>
    <p>
      <strong>Check</strong> answers one thing: is everything you have crossed
      out really false? It never says which cell, because which cell is the
      answer, one square at a time.
    </p>

    <h2>Keys</h2>
    <dl class="keys">
      <div><dt>Arrows</dt><dd>move around the notebook</dd></div>
      <div><dt>1 – 9</dt><dd>cross that room out of the cell</dd></div>
      <div><dt>Shift + 1 – 9</dt><dd>place that room instead</dd></div>
      <div><dt>Backspace</dt><dd>rub the cell out</dd></div>
      <div><dt>X</dt><dd>switch between crossing out and placing</dd></div>
      <div><dt>H / C / A</dt><dd>hint, check, accuse</dd></div>
      <div><dt>Ctrl + Z / Y</dt><dd>undo, redo</dd></div>
      <div><dt>Escape</dt><dd>put the panel away</dd></div>
    </dl>
  </div>
</div>

<style>
  .screen {
    height: 100%;
    overflow-y: auto;
  }

  .inner {
    width: min(680px, 100%);
    margin: 0 auto;
    padding: 24px 20px 48px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
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

  .lead {
    font-size: 1rem;
    line-height: 1.55;
    margin: 0;
  }

  p,
  li {
    line-height: 1.55;
    font-size: 0.93rem;
  }

  ol.rules {
    padding-left: 20px;
  }

  ol.rules li {
    margin-bottom: 9px;
  }

  ul {
    padding-left: 20px;
  }

  ul li {
    margin-bottom: 6px;
  }

  .aside {
    color: var(--text-dim);
    font-size: 0.87rem;
  }

  .keys {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 3px 18px;
    font-size: 0.87rem;
  }

  .keys div {
    display: flex;
    gap: 10px;
    border-bottom: 1px dotted var(--panel-border);
    padding: 3px 0;
  }

  .keys dt {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 0.8rem;
    min-width: 108px;
    color: var(--text-dim);
  }

  .keys dd {
    margin: 0;
  }

  .btn.small {
    padding: 4px 9px;
    font-size: 0.78rem;
  }
</style>
