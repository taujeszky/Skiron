<!--
  The house, one slot at a time.

  The geometry is the engine's: `plan.rooms` are rectangles in grid units and
  `plan.doors` sit on the walls two rooms share, so the picture and the graph
  the solver reasons over are the same data seen twice. Nothing here invents a
  position, which is why the plan file insists the floor plan is drawn by the
  engine and never by an image model — a map that disagreed with the adjacency
  would make every movement deduction look wrong.

  The SVG's user units ARE grid units. That keeps every number in this file
  the same number the engine uses, and leaves the scaling to `viewBox`.

  Tokens are solid for somebody the notebook has placed and dashed for
  somebody it merely still allows. The distinction is the player's own
  certainty, not the engine's: this component never sees the world except in
  replay, where it is handed one.
-->
<script lang="ts">
  import { doorClosedAt } from "$lib/engine/axioms";
  import type { CaseFrame, Glossary, PersonId, RoomId, SlotIndex } from "$lib/engine/types";

  let {
    frame,
    glossary,
    slot,
    placed = new Map(),
    candidates = new Map(),
    highlight = [],
    searched = new Set(),
    onroom = undefined,
  }: {
    frame: CaseFrame;
    glossary: Glossary;
    slot: SlotIndex;
    placed?: Map<RoomId, PersonId[]>;
    candidates?: Map<RoomId, PersonId[]>;
    highlight?: RoomId[];
    searched?: Set<RoomId>;
    onroom?: (r: RoomId) => void;
  } = $props();

  const plan = $derived(frame.plan);
  const lit = $derived(new Set(highlight));

  /** A little air around the outline, so a wall is not flush to the edge. */
  const PAD = 0.6;

  interface Coin {
    p: PersonId;
    ghost: boolean;
    cx: number;
    cy: number;
  }

  /**
   * Lay the coins out along the bottom of the room, wrapping upwards.
   *
   * Bottom rather than centre because the label sits at the top and a room is
   * as small as three units square — a centred pile covers the name of the
   * room it is in.
   */
  function coins(room: { rect: { x: number; y: number; w: number; h: number }; id: RoomId }): Coin[] {
    const solid = placed.get(room.id) ?? [];
    const maybe = candidates.get(room.id) ?? [];
    const all: { p: PersonId; ghost: boolean }[] = [
      ...solid.map((p) => ({ p, ghost: false })),
      ...maybe.map((p) => ({ p, ghost: true })),
    ];
    if (all.length === 0) return [];

    const { x, y, w, h } = room.rect;
    const d = 0.95;
    const gap = 0.16;
    const usable = Math.max(d, w - 0.5);
    const perRow = Math.max(1, Math.floor((usable + gap) / (d + gap)));
    const rows = Math.ceil(all.length / perRow);
    const blockH = rows * d + (rows - 1) * gap;
    const top = y + h - 0.45 - blockH;

    return all.map((item, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, all.length - row * perRow);
      const rowW = inRow * d + (inRow - 1) * gap;
      const col = i % perRow;
      return {
        ...item,
        cx: x + w / 2 - rowW / 2 + col * (d + gap) + d / 2,
        cy: top + row * (d + gap) + d / 2,
      };
    });
  }

  /** The opening as a segment of the wall it hangs on. */
  function doorLine(door: (typeof plan.doors)[number]) {
    const half = 0.55;
    return door.wall === "v"
      ? { x1: door.x, y1: door.y - half, x2: door.x, y2: door.y + half }
      : { x1: door.x - half, y1: door.y, x2: door.x + half, y2: door.y };
  }

  function doorTitle(door: (typeof plan.doors)[number], closed: boolean): string {
    const between = `${glossary.roomName(door.a)} and ${glossary.roomName(door.b)}`;
    return closed
      ? `The door between ${between} is locked after ${glossary.slotLabel(slot)}`
      : `A door between ${between}`;
  }
</script>

<!--
  The role depends on whether the plan can be used.

  `role="img"` makes an element a leaf in the accessibility tree: its children
  are not exposed at all. That is right for the briefing and the summary,
  where the plan is a picture — and wrong on the investigate screen, where
  every room carries a `role="button"` that a screen reader would then never
  reach. The rooms were keyboard-focusable the whole time and announced as
  nothing. So: a picture when there is nothing to click, a group of buttons
  when there is.
-->
<svg
  class="plan"
  viewBox="{-PAD} {-PAD} {plan.width + PAD * 2} {plan.height + PAD * 2}"
  role={onroom ? "group" : "img"}
  aria-label={onroom ? "The floor plan — choose a room to search" : "The floor plan"}
>
  {#each plan.rooms as room (room.id)}
    {@const isBody = room.id === frame.murderRoom}
    <g
      class="room"
      class:outdoor={room.outdoor}
      class:body={isBody}
      class:lit={lit.has(room.id)}
      class:clickable={onroom !== undefined}
    >
      <rect
        x={room.rect.x}
        y={room.rect.y}
        width={room.rect.w}
        height={room.rect.h}
        rx="0.15"
      />
      <text
        class="label"
        x={room.rect.x + room.rect.w / 2}
        y={room.rect.y + 1.05}
        text-anchor="middle"
      >
        {glossary.roomCode(room.id)}
      </text>
      {#if searched.has(room.id)}
        <!-- A room already searched. Searching it again costs nothing, but
             knowing you have been is what stops a player re-treading. -->
        <text
          class="searched"
          x={room.rect.x + room.rect.w - 0.45}
          y={room.rect.y + 0.95}
          text-anchor="end">✓</text
        >
      {/if}
      {#each coins(room) as coin (coin.p)}
        <circle
          class="coin"
          class:ghost={coin.ghost}
          cx={coin.cx}
          cy={coin.cy}
          r="0.45"
          fill={coin.p === frame.victim ? "var(--victim)" : `var(--p${coin.p % 8})`}
          stroke={coin.p === frame.victim ? "var(--victim)" : `var(--p${coin.p % 8})`}
        />
        <text
          class="coin-letter"
          class:ghost={coin.ghost}
          x={coin.cx}
          y={coin.cy + 0.19}
          text-anchor="middle"
          fill={coin.ghost
            ? coin.p === frame.victim
              ? "var(--victim)"
              : `var(--p${coin.p % 8})`
            : "var(--panel)"}
        >
          {coin.p === frame.victim ? "†" : "ABCDEFGH"[coin.p] ?? coin.p + 1}
        </text>
      {/each}
      {#if onroom}
        <rect
          class="hit"
          x={room.rect.x}
          y={room.rect.y}
          width={room.rect.w}
          height={room.rect.h}
          role="button"
          tabindex="0"
          aria-label="Search {glossary.roomName(room.id)}"
          onclick={() => onroom?.(room.id)}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onroom?.(room.id);
            }
          }}
        >
          <title>{glossary.roomName(room.id)}{isBody ? " — the body was found here" : ""}</title>
        </rect>
      {/if}
    </g>
  {/each}

  {#each plan.doors as door (door.id)}
    {@const closed = doorClosedAt(frame, door.id, slot)}
    {@const line = doorLine(door)}
    <line
      class="door"
      class:closed
      x1={line.x1}
      y1={line.y1}
      x2={line.x2}
      y2={line.y2}
    >
      <title>{doorTitle(door, closed)}</title>
    </line>
  {/each}
</svg>

<style>
  .plan {
    width: 100%;
    height: 100%;
    display: block;
    background: var(--plan-bg);
  }

  .room rect {
    fill: var(--room-fill);
    stroke: var(--wall);
    stroke-width: 0.12;
  }

  .room.outdoor rect {
    fill: var(--room-fill-alt);
    stroke-dasharray: 0.4 0.25;
  }

  .room.body rect {
    fill: var(--body-room);
    stroke: var(--body-room-stroke);
    stroke-width: 0.18;
  }

  .room.lit rect {
    fill: var(--room-hot);
  }

  .label {
    fill: var(--room-label);
    font-size: 0.72px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .searched {
    fill: var(--ok);
    font-size: 0.7px;
    font-weight: 700;
  }

  .coin {
    stroke-width: 0.1;
  }

  .coin.ghost {
    fill: none;
    stroke-dasharray: 0.16 0.12;
    opacity: 0.85;
  }

  .coin-letter {
    font-size: 0.56px;
    font-weight: 700;
    pointer-events: none;
  }

  .coin-letter.ghost {
    opacity: 0.85;
  }

  .door {
    stroke: var(--door);
    stroke-width: 0.3;
    stroke-linecap: round;
  }

  .door.closed {
    stroke: var(--door-closed);
    stroke-dasharray: 0.22 0.18;
  }

  .hit {
    fill: transparent;
    stroke: none;
    cursor: pointer;
  }

  .hit:hover {
    fill: var(--room-hot);
  }

  .hit:focus-visible {
    stroke: var(--focus);
    stroke-width: 0.16;
    outline: none;
  }
</style>
