/**
 * The deduction solver's state, and the only way rules are allowed to change
 * it.
 *
 * Every mutation goes through `restrict`, `killPairs` or `contradict`, which
 * do three things a rule must never do by hand: notice whether anything
 * actually changed, notice when a domain has emptied, and record the step.
 * A rule that pokes `state.dom` directly is a rule whose deduction the hint
 * system cannot explain, so there is no reason to allow it.
 *
 * SOUNDNESS is the whole contract: a rule may remove a candidate only when no
 * legal world consistent with the clues contains it. `solver.test.ts` guards
 * that against wave 1's exhaustive solver, and a new rule joins that guard.
 */

import { bit, bitsOf, fullMask, onlyBit, popcount } from "../bits";
import { allowedRoomsMask, movementMasks } from "../axioms";
import type {
  Answer,
  CaseFrame,
  Clue,
  ClueId,
  PersonId,
  RoomId,
  SlotIndex,
} from "../types";

/* ----------------------------------------------------------------- state */

export interface SolverState {
  /** dom[person][slot] = bitmask of rooms that person may occupy then. */
  dom: number[][];
  /**
   * answer[suspect] = bitmask of slots still possible as t*, IF that suspect
   * is the culprit. Zero means the suspect is cleared.
   *
   * Pairs rather than two flat sets, because that is how a person reasons:
   * "if it was the Colonel it must have been at nine, and he was in the hall
   * at nine, so it was not the Colonel". Two independent sets cannot express
   * that and would have to keep both alive. Fairness is defined on pairs
   * (ARCHITECTURE.md §4), so this is also exactly the right granularity.
   */
  answer: number[];
  contradiction: boolean;
}

/**
 * The work cap on the bounded hypothesis search in tier 4, in state changes
 * plus one fee per trial. It is **part of the grade** (critical invariant 10):
 * raising it turns cases that could not be finished into Expert cases, so it
 * is a constant of the game and not a tuning knob. Measured in tier4.ts.
 *
 * It lives here rather than in `solve.ts` only so that `SolverContext` can
 * carry it without the two files importing each other; `solve.ts` re-exports
 * it, which is where callers should read it from.
 */
export const TRIAL_BUDGET = 20000;

/** Everything a rule needs that never changes during a run. */
export interface SolverContext {
  frame: CaseFrame;
  clues: readonly Clue[];
  /** moves[p][t][from] = rooms p may occupy at t+1. From `axioms`. */
  moves: number[][][];
  /** All suspects, as a person bitmask. */
  allSuspects: number;
  /** All slots, as a slot bitmask. */
  allSlots: number;
  /** All rooms, as a room bitmask. */
  allRooms: number;
  /** Tier 4's work cap. See `TRIAL_BUDGET`. */
  trialBudget: number;
}

export function makeContext(
  frame: CaseFrame,
  clues: readonly Clue[],
  trialBudget: number = TRIAL_BUDGET,
): SolverContext {
  return {
    frame,
    clues,
    moves: movementMasks(frame),
    allSuspects: fullMask(frame.suspects),
    allSlots: fullMask(frame.slots),
    allRooms: fullMask(frame.plan.rooms.length),
    trialBudget,
  };
}

export function initialState(ctx: SolverContext): SolverState {
  const { frame } = ctx;
  const dom: number[][] = [];
  for (let p = 0; p < frame.people; p++) {
    const allowed = allowedRoomsMask(frame, p) & ctx.allRooms;
    dom.push(new Array<number>(frame.slots).fill(allowed));
  }
  return {
    dom,
    answer: new Array<number>(frame.suspects).fill(ctx.allSlots),
    contradiction: false,
  };
}

export function cloneState(s: SolverState): SolverState {
  return {
    dom: s.dom.map((row) => [...row]),
    answer: [...s.answer],
    contradiction: s.contradiction,
  };
}

/* ---------------------------------------------------------- derived views */

/** Suspects still possible as the culprit. */
export function culpritMask(s: SolverState): number {
  let m = 0;
  for (let p = 0; p < s.answer.length; p++) if (s.answer[p] !== 0) m |= bit(p);
  return m;
}

/** Slots still possible as t*, over every surviving culprit. */
export function slotMask(s: SolverState): number {
  let m = 0;
  for (const a of s.answer) m |= a;
  return m;
}

/** How many (culprit, slot) pairs survive. */
export function pairCount(s: SolverState): number {
  let n = 0;
  for (const a of s.answer) n += popcount(a);
  return n;
}

export function pairs(s: SolverState): Answer[] {
  const out: Answer[] = [];
  for (let p = 0; p < s.answer.length; p++) {
    for (const t of bitsOf(s.answer[p])) out.push({ culprit: p, slot: t });
  }
  return out;
}

/** One culprit and one slot: the solver has finished. */
export function finished(s: SolverState): boolean {
  return !s.contradiction && pairCount(s) === 1;
}

export function soleAnswer(s: SolverState): Answer | null {
  return finished(s) ? pairs(s)[0] : null;
}

/**
 * Whose testimony may be believed. Derived, never stored: clearing a suspect
 * *is* trusting them, so there is nothing to keep in step. With lying off
 * everyone is trusted from the start (rule 7).
 */
export function trustedMask(ctx: SolverContext, s: SolverState): number {
  if (!ctx.frame.lying) return ctx.allSuspects;
  return ctx.allSuspects & ~culpritMask(s);
}

/** Is this clue something the player may currently reason from? */
export function isActive(
  ctx: SolverContext,
  s: SolverState,
  clue: Clue,
  trusted = trustedMask(ctx, s),
): boolean {
  if (clue.source.kind === "fact") return true;
  return (trusted & bit(clue.source.speaker)) !== 0;
}

/** The clues that may currently be reasoned from. */
export function activeClues(
  ctx: SolverContext,
  s: SolverState,
): readonly Clue[] {
  const trusted = trustedMask(ctx, s);
  return ctx.clues.filter((c) => isActive(ctx, s, c, trusted));
}

/**
 * Could `p` be a living person in room `r` at `t`, as far as the state knows?
 * The victim is living only while the murder is still to come, so this is
 * true of the victim only when some surviving pair puts `t*` after `t`.
 *
 * Counting rules must go through this. Using the victim's raw domain instead
 * is the likeliest way to make a counting rule unsound.
 */
export function mayBeLivingIn(
  ctx: SolverContext,
  s: SolverState,
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
): boolean {
  if ((s.dom[p][t] & bit(r)) === 0) return false;
  if (p !== ctx.frame.victim) return true;
  return (slotMask(s) & ~fullMask(t + 1)) !== 0; // some t* > t survives
}

/** Is `p` certainly a living presence in `r` at `t`? */
export function mustBeLivingIn(
  ctx: SolverContext,
  s: SolverState,
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
): boolean {
  if (s.dom[p][t] !== bit(r)) return false;
  if (p !== ctx.frame.victim) return true;
  // the victim is certainly alive at t only when every surviving t* is later
  const later = ~fullMask(t + 1);
  const live = slotMask(s);
  return live !== 0 && (live & ~later) === 0;
}

/* ------------------------------------------------------------------ steps */

/**
 * The rules, named. The union is the single source of truth: `explain.ts`
 * must render every member, and a test proves it. Adding a rule therefore
 * forces you to give it a sentence, which is the point.
 */
export type RuleId =
  // tier 0 — placement
  | "clue-at"
  | "clue-not-at"
  | "clue-stayed"
  | "clue-saw"
  | "clue-alone"
  | "clue-empty"
  | "clue-never-visited"
  | "clue-alive-at"
  | "clue-death-window"
  | "victim-seen-alive"
  | "body-at-end"
  | "opportunity"
  | "witness-in-room"
  | "sealed-after"
  | "sealed-back"
  | "victim-not-yet-dead"
  // tier 1 — movement
  | "reach-forward"
  | "reach-backward"
  // tier 2 — counting
  | "occupied-last-one"
  | "count-exact"
  | "count-capacity"
  | "visited-last-slot"
  | "together-same-room"
  // tier 3 — trust
  | "self-incrimination"
  | "conflict-pair"
  // tier 4 — hypothesis
  | "trial-culprit"
  | "trial-slot"
  | "trial-pair";

/**
 * Every rule id, as a value. The object is keyed by `RuleId`, so a rule that
 * joins the union and not this list is a compile error — which is what lets
 * `explain.test.ts` claim it has rendered *every* rule rather than every rule
 * somebody remembered to add.
 */
const ALL_RULES: Readonly<Record<RuleId, true>> = {
  "clue-at": true,
  "clue-not-at": true,
  "clue-stayed": true,
  "clue-saw": true,
  "clue-alone": true,
  "clue-empty": true,
  "clue-never-visited": true,
  "clue-alive-at": true,
  "clue-death-window": true,
  "victim-seen-alive": true,
  "body-at-end": true,
  opportunity: true,
  "witness-in-room": true,
  "sealed-after": true,
  "sealed-back": true,
  "victim-not-yet-dead": true,
  "reach-forward": true,
  "reach-backward": true,
  "occupied-last-one": true,
  "count-exact": true,
  "count-capacity": true,
  "visited-last-slot": true,
  "together-same-room": true,
  "self-incrimination": true,
  "conflict-pair": true,
  "trial-culprit": true,
  "trial-slot": true,
  "trial-pair": true,
};

export const RULE_IDS = Object.keys(ALL_RULES) as RuleId[];

export interface Cell {
  p: PersonId;
  t: SlotIndex;
}

/** What a step rests on: the cards, and the notebook cells it read. */
export interface Premises {
  clues: ClueId[];
  cells: Cell[];
  /** Suspects the step leaned on having been cleared (tier 3 and 4). */
  cleared?: PersonId[];
  /**
   * A trial's hypothesis, so that the step can be read back as "suppose ...".
   * Tier 3 supposes people innocent (and so truthful); tier 4 supposes the
   * answer was one of a set of pairs. Both are refuted by a contradiction,
   * which is what the step then records.
   */
  assumedInnocent?: PersonId[];
  assumedAnswer?: Answer[];
}

export type Conclusion =
  | { kind: "rooms-out"; p: PersonId; t: SlotIndex; rooms: number }
  | { kind: "room-set"; p: PersonId; t: SlotIndex; r: RoomId }
  | { kind: "pairs-out"; pairs: Answer[] }
  | { kind: "cleared"; suspects: PersonId[] }
  | { kind: "slots-out"; slots: SlotIndex[] }
  | { kind: "contradiction" };

export interface Step {
  rule: RuleId;
  tier: number;
  premises: Premises;
  conclusion: Conclusion;
}

/* ------------------------------------------------------------ the mutator */

/**
 * One run of the solver. `steps` is null for the scratch runs that tiers 3
 * and 4 spawn — they throw their work away, and recording it would drown the
 * hint system in hypotheticals.
 */
export interface Deduction {
  ctx: SolverContext;
  state: SolverState;
  steps: Step[] | null;
  /** Set by any mutation that actually changed something. */
  changed: boolean;
  /** Work done: every state change, everywhere, including inside trials. */
  nodes: number;
  /**
   * Work charged to tier 4's budget. Separate from `nodes` because the budget
   * must not be eaten by the ordinary propagation a case needs before any
   * hypothesis is tried.
   */
  trialNodes: number;
  /**
   * How many suppositions deep this run is: 0 for the real case, 1 inside a
   * trial, 2 inside a trial that tier 3 opened inside a trial.
   *
   * Tier 4 refuses to run above 0, which is what makes "depth 1" a rule of
   * the game rather than an accident of the tier cap. It matters because
   * depth is difficulty: a case only solvable by supposing two things at once
   * is not one a person can be asked to solve, and if such cases could be
   * certified fair the generator would ship them.
   */
  depth: number;
}

export function newDeduction(
  ctx: SolverContext,
  state: SolverState,
  record: boolean,
): Deduction {
  return {
    ctx,
    state,
    steps: record ? [] : null,
    changed: false,
    nodes: 0,
    trialNodes: 0,
    depth: 0,
  };
}

/** A scratch copy for a hypothesis, sharing the context but not the state. */
export function branch(d: Deduction): Deduction {
  const b = newDeduction(d.ctx, cloneState(d.state), false);
  b.nodes = d.nodes;
  b.trialNodes = d.trialNodes;
  b.depth = d.depth + 1;
  return b;
}

function record(d: Deduction, step: Step): void {
  if (d.steps) d.steps.push(step);
}

/**
 * Narrow `dom[p][t]` to `mask`. Returns true when that removed something.
 * An empty domain is a contradiction, not an error.
 */
export function restrict(
  d: Deduction,
  p: PersonId,
  t: SlotIndex,
  mask: number,
  rule: RuleId,
  tier: number,
  premises: Premises,
): boolean {
  const before = d.state.dom[p][t];
  const after = before & mask;
  if (after === before) return false;
  d.state.dom[p][t] = after;
  d.changed = true;
  d.nodes++;
  const only = onlyBit(after);
  record(d, {
    rule,
    tier,
    premises,
    conclusion:
      only >= 0
        ? { kind: "room-set", p, t, r: only }
        : { kind: "rooms-out", p, t, rooms: before & ~after },
  });
  if (after === 0) contradict(d, rule, tier, premises);
  return true;
}

/** Remove rooms from `dom[p][t]`. */
export function removeRooms(
  d: Deduction,
  p: PersonId,
  t: SlotIndex,
  rooms: number,
  rule: RuleId,
  tier: number,
  premises: Premises,
): boolean {
  return restrict(d, p, t, ~rooms, rule, tier, premises);
}

/**
 * Remove every (culprit, slot) pair for which `kill` returns true. One
 * step is recorded for the whole sweep, because "so it cannot have been any
 * of them" is one thought.
 */
export function killPairs(
  d: Deduction,
  kill: (culprit: PersonId, slot: SlotIndex) => boolean,
  rule: RuleId,
  tier: number,
  premises: Premises,
): boolean {
  const { answer } = d.state;
  const removed: Answer[] = [];
  const clearedNow: PersonId[] = [];
  for (let s = 0; s < answer.length; s++) {
    if (answer[s] === 0) continue;
    let next = answer[s];
    for (const t of bitsOf(answer[s])) {
      if (kill(s, t)) {
        next &= ~bit(t);
        removed.push({ culprit: s, slot: t });
      }
    }
    if (next !== answer[s]) {
      answer[s] = next;
      if (next === 0) clearedNow.push(s);
    }
  }
  if (removed.length === 0) return false;
  d.changed = true;
  d.nodes += removed.length;
  // "so it was none of them" reads better than a list of pairs, but only when
  // every pair that went really did belong to a suspect who is now cleared.
  const cleared = new Set(clearedNow);
  const wholeSuspects =
    clearedNow.length > 0 && removed.every((r) => cleared.has(r.culprit));
  record(d, {
    rule,
    tier,
    premises,
    conclusion: wholeSuspects
      ? { kind: "cleared", suspects: clearedNow }
      : { kind: "pairs-out", pairs: removed },
  });
  if (pairCount(d.state) === 0) contradict(d, rule, tier, premises);
  return true;
}

/** Rule out a slot for every suspect at once. */
export function killSlots(
  d: Deduction,
  slots: number,
  rule: RuleId,
  tier: number,
  premises: Premises,
): boolean {
  return killPairs(d, (_, t) => (slots & bit(t)) !== 0, rule, tier, premises);
}

/** Clear suspects outright. */
export function clearSuspects(
  d: Deduction,
  suspects: number,
  rule: RuleId,
  tier: number,
  premises: Premises,
): boolean {
  return killPairs(d, (s) => (suspects & bit(s)) !== 0, rule, tier, premises);
}

export function contradict(
  d: Deduction,
  rule: RuleId,
  tier: number,
  premises: Premises,
): void {
  if (d.state.contradiction) return;
  d.state.contradiction = true;
  d.changed = true;
  record(d, { rule, tier, premises, conclusion: { kind: "contradiction" } });
}

/**
 * Run `fn` and report whether it changed anything, without losing a change an
 * earlier rule in the same pass had already made. Tiers are driven by "did
 * this do anything", so every tier entry point goes through it.
 */
export function didChange(d: Deduction, fn: () => void): boolean {
  const prev = d.changed;
  d.changed = false;
  fn();
  const did = d.changed;
  d.changed = prev || did;
  return did;
}

/** No premises — for rules that rest only on the axioms. */
export const AXIOMS_ONLY: Premises = { clues: [], cells: [] };

export function fromClue(clue: Clue, cells: Cell[] = []): Premises {
  return { clues: [clue.id], cells };
}
