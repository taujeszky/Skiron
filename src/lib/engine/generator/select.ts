/**
 * Choosing the puzzle: draw a handful of cards from everything that is true,
 * check they prove the case, and then take away every one that was not
 * needed.
 *
 * **Why it is a sample and not the whole pool.** The plan said "start from
 * every clue, shuffle, and drop each clue if the solver still finishes
 * without it". Measured over 20 seeds a preset with the pool this engine
 * actually builds, that is **625 clues on Easy and 2,089 on Expert** once
 * every speaker who could say a thing is counted — four times the count of
 * distinct *bodies*, which is the number it is easy to quote by mistake — and
 * a pass costs one `solve` per clue: 76 ms on Easy, 1,503 ms on Expert, most
 * of it spent proving over and over that the four hundredth `NotAt` was not
 * load-bearing. Drawing a weighted sample first and growing it only when the
 * draw fails to prove the case reaches the same shipped set for a quarter to
 * a seventh of that — 11 ms and 402 ms at the finished generator's p50.
 *
 * **The expensive solves are the failures, not the successes.** A solve on a
 * set that still proves the case is fast — 0.25 ms on 400 clues, because the
 * propagation settles at once. A solve on a set that no longer proves it is
 * slow, because tier 4 burns its whole hypothesis budget before admitting
 * defeat. So the cost of this loop is roughly "how many drops were refused",
 * which is why a smaller working set is so much cheaper: it has fewer
 * droppable cards *and* it reaches the irreducible core sooner.
 *
 * **What is never dropped.** The case-file rules and the briefing's death
 * window. The player holds them from the start whatever this loop decides, so
 * a case graded without them would ship easier than it grades. They cost
 * nothing to pin: the frame already carries the rules, so the deduction
 * solver reads them whether or not a card says so.
 *
 * **Determinism.** Every random draw happens before the first `solve`. If the
 * drop order were drawn lazily, the case a given id rebuilds would depend on
 * how the solver behaved, and a solver change would silently rewrite every
 * shared case (invariant 4).
 */

import { RNG } from "../rng";
import { solve } from "../solver/solve";
import type { Step } from "../solver/state";
import type { CaseFrame, Clue, ClueKind, PresetName } from "../types";

/* ------------------------------------------------------------ the sample */

/**
 * How many cards of each kind to draw, per slot of the evening.
 *
 * Scaled by the evening's length so that a bigger case gets a bigger sample
 * without a second dial. Every number is a **starting point** for task 10 —
 * this table is where the clue-type mix actually gets tuned, and the sim
 * table's "clue-type mix" column is what tunes it.
 *
 * `NotAt` is held down hard on purpose. It is half the pool by count
 * (`P * T * (R - 1)`, which is 392 of Expert's 772 bodies) and the weakest
 * card in the game: it crosses one room off one cell. Drawn in proportion it
 * would crowd out everything that makes a case read like a case.
 */
export type KindWeights = Partial<Record<ClueKind, number>>;

export const DEFAULT_WEIGHTS: KindWeights = {
  At: 1.2,
  NotAt: 0.8,
  Stayed: 0.6,
  Saw: 1.5,
  Together: 0.8,
  AloneIn: 0.6,
  Occupied: 0.8,
  Empty: 0.8,
  Count: 1.0,
  Visited: 0.5,
  NeverVisited: 0.5,
  AliveAt: 0.4,
  DeathWindow: 0.3,
};

/**
 * What each preset draws. Filled in from the `npm run sim` table (task 10),
 * and the reason the table exists.
 *
 * The first measured run had **Expert collapsed into Hard**: 69 of 80 Expert
 * cases graded tier 3, exactly like Hard's 80 of 80, so the two hardest
 * presets were the same puzzle with different labels. The plan's risk list
 * predicted this shape of failure and named the mix of clue types as the
 * lever, which is what these rows are.
 *
 * The fix is to starve the top presets of the cards that *place* somebody —
 * `At`, `AloneIn`, `Saw`, `Stayed` pin a cell outright, and a case made of
 * them is a case tier 0 can walk. Counting and company clues constrain
 * without placing, so the cheap tiers saturate with more than one pair alive
 * and the hypothesis tier has to finish the job. See ARCHITECTURE.md §9 for
 * the before and after.
 */
export interface PresetTuning {
  scale: number;
  weights: KindWeights;
}

export interface SelectOptions {
  /**
   * The tier the loop solves at. A drop that would push the case past this is
   * refused, so the shipped set never rests on reasoning the preset does not
   * allow. The grade may still come out lower — see `Selection.tier`.
   */
  cap: number;
  /** Multiplier on `DEFAULT_WEIGHTS`. Measured: 5 is the knee of the curve. */
  scale?: number;
  weights?: KindWeights;
  /** How many more cards to add when the sample does not prove the case. */
  growStep?: number;
  /** How many times to grow before giving up on this attempt. */
  grows?: number;
  /**
   * Cards the working set always starts with, on top of the weighted draw.
   *
   * The killer's story goes here. It is one `At` card in a pool of two
   * thousand, so the quota draw picked it about four times in a hundred, and
   * measured over 60 Hard cases the lie reached the shipped set exactly once.
   * A preset whose whole identity is "the culprit lies" cannot ship cases in
   * which the culprit says nothing false. Being in the working set is not a
   * promise of surviving it — the greedy pass may still find the story
   * redundant — but it is the difference between being considered and not.
   */
  include?: readonly Clue[];
}

/** Measured over 24 seeds of each preset: see the table in ARCHITECTURE.md. */
const DEFAULT_SCALE = 5;
const DEFAULT_GROW_STEP = 40;
const DEFAULT_GROWS = 3;

/** Cards that place somebody in a room outright: the tier-0 kinds. */
const PLACING: KindWeights = {
  At: 0.35,
  AloneIn: 0.25,
  Saw: 0.7,
  Stayed: 0.3,
};

/** Cards that constrain without placing: what the harder tiers feed on. */
const INDIRECT: KindWeights = {
  NotAt: 1.0,
  Together: 1.2,
  Occupied: 1.2,
  Empty: 1.2,
  Count: 1.4,
  Visited: 0.8,
  NeverVisited: 0.8,
};

export const PRESET_TUNING: Readonly<Record<PresetName, PresetTuning>> = {
  easy: { scale: 5, weights: DEFAULT_WEIGHTS },
  normal: { scale: 5, weights: DEFAULT_WEIGHTS },
  hard: { scale: 5, weights: { ...DEFAULT_WEIGHTS, ...PLACING, ...INDIRECT } },
  expert: {
    scale: 5,
    weights: {
      ...DEFAULT_WEIGHTS,
      ...PLACING,
      ...INDIRECT,
      AliveAt: 0.1,
      DeathWindow: 0.1,
    },
  },
};

export type SelectFailure = "unsolvable" | "budget";

export interface Selection {
  /** Everything the case ships: the opening plus the proof set, id-sorted. */
  clues: Clue[];
  /** The cards the player has to earn. The opening is not among them. */
  essential: Clue[];
  /** The grade: the cheapest cap at which this set still finishes. */
  tier: number;
  /** The proof, as the solver found it. Wave 5's summing-up reads this. */
  steps: Step[];
  /** How many `solve` calls it took. For the sim table. */
  solves: number;
  /** How many cards were drawn before minimising. */
  drawn: number;
}

/**
 * Draw a working set, prove the case with it, and strip it to the bone.
 *
 * Returns the failure reason rather than throwing: a pool that cannot prove
 * its own case is bad luck with this sample, not a bug, and the attempt loop
 * in `generate.ts` simply draws again. The one thing that *is* a bug is a
 * contradiction, and that is the caller's assertion to make — every clue here
 * is true in the true world, so the set is satisfiable by construction.
 */
export function select(
  rng: RNG,
  frame: CaseFrame,
  opening: readonly Clue[],
  pool: readonly Clue[],
  opts: SelectOptions,
): Selection | SelectFailure {
  const scale = opts.scale ?? DEFAULT_SCALE;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const growStep = opts.growStep ?? DEFAULT_GROW_STEP;
  const grows = opts.grows ?? DEFAULT_GROWS;

  // Everything random happens here, before the first solve.
  const sampled = drawSample(rng, frame, pool, weights, scale);
  const forced = (opts.include ?? []).filter(
    (c) => !sampled.some((k) => k.id === c.id),
  );
  const drawn = [...forced, ...sampled];
  const taken = new Set(drawn.map((c) => c.id));
  const spare = rng.shuffle(pool.filter((c) => !taken.has(c.id)));
  const order = rng.shuffle([...drawn]);

  let working = [...drawn];
  let solves = 0;

  // Grow until the cards prove the case, or give up on this sample.
  for (let i = 0; ; i++) {
    solves++;
    const r = solve(frame, [...opening, ...working], {
      maxTier: opts.cap,
      record: false,
    });
    if (r.finished) break;
    if (i >= grows || spare.length === 0) {
      return r.budgetSpent ? "budget" : "unsolvable";
    }
    const more = spare.splice(0, growStep);
    working = [...working, ...more];
    order.push(...more);
  }

  // Take away every card the proof can do without.
  let kept = working;
  for (const c of order) {
    const without = kept.filter((k) => k.id !== c.id);
    if (without.length === kept.length) continue;
    solves++;
    if (solve(frame, [...opening, ...without], { maxTier: opts.cap, record: false })
      .finished) {
      kept = without;
    }
  }

  // The shipped array, in one fixed order, graded once. Clue order changes
  // what a tier pass does inside a single sweep and how tier 4 spends its
  // budget, so grading a shuffled array and shipping a sorted one could
  // disagree about the tier. Sort first, then grade what ships.
  const essential = [...kept].sort(byId);
  const clues = [...opening, ...essential].sort(byId);
  solves++;
  const graded = solve(frame, clues, { record: true });
  return {
    clues,
    essential,
    tier: graded.tier,
    steps: graded.steps,
    solves,
    drawn: drawn.length,
  };
}

function byId(a: Clue, b: Clue): number {
  // Ids are "c" plus an ascending integer, so compare the numbers: a string
  // sort would put c10 before c9 and shuffle the case for no reason.
  return Number(a.id.slice(1)) - Number(b.id.slice(1));
}

/**
 * A working set, drawn by kind so that the mix is a decision rather than a
 * consequence of how many of each kind happen to be true.
 */
function drawSample(
  rng: RNG,
  frame: CaseFrame,
  pool: readonly Clue[],
  weights: KindWeights,
  scale: number,
): Clue[] {
  const byKind = new Map<ClueKind, Clue[]>();
  for (const c of pool) {
    const list = byKind.get(c.body.kind);
    if (list) list.push(c);
    else byKind.set(c.body.kind, [c]);
  }
  const out: Clue[] = [];
  // Walk the kinds in a fixed order — a Map iterates in insertion order, and
  // insertion order here is pool order, which is fixed by `trueBodies`.
  for (const [kind, list] of byKind) {
    const want = Math.max(1, Math.round((weights[kind] ?? 0.5) * frame.slots * scale));
    out.push(...rng.shuffle([...list]).slice(0, want));
  }
  return out;
}

/* ------------------------------------------------------------- the check */

/**
 * Is every card in the set load-bearing?
 *
 * The greedy pass leaves a set that is minimal *for the order it used*, which
 * is not quite the same as irredundant: tier 3 reads the whole clue list
 * rather than the active one when it asks whether everybody it supposes
 * innocent has spoken (`tier3.ts#allSpeak`), so dropping a suspect's last
 * statement can change what a later drop is allowed to do. A second pass can
 * therefore still find something, and the sim table counts how often — which
 * is the honest way to report it, rather than claiming a minimality the loop
 * does not prove.
 */
export function redundantCount(
  frame: CaseFrame,
  opening: readonly Clue[],
  essential: readonly Clue[],
  cap: number,
): number {
  let n = 0;
  for (const c of essential) {
    const without = essential.filter((k) => k.id !== c.id);
    if (solve(frame, [...opening, ...without], { maxTier: cap, record: false })
      .finished) {
      n++;
    }
  }
  return n;
}
