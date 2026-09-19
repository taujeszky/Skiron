/**
 * The exhaustive solver: the oracle.
 *
 * It answers one question — is there a legal world in which every clue that
 * binds holds? — by brute force, with enough propagation to keep the brute
 * force cheap. Wave 2's deduction solver is checked against this file and the
 * generator makes its final fairness assertion with it, so the two are
 * deliberately independent: nothing here is imported from the deduction
 * solver, and each guards the other (ARCHITECTURE.md §4).
 *
 * The shape of the search. For each candidate answer `(c, t*)`:
 *
 * - clues that do not bind the candidate are dropped, because with lying on a
 *   testimony by `c` says nothing at all about the worlds in which `c` is the
 *   culprit (`testimonyBinds`);
 * - rules 4 and 5 become hard constraints on cells: the body lies in `r*`
 *   from `t*` on, the culprit is there at `t*`, and no other living soul is
 *   there from `t*` on;
 * - what is left is a CSP over `loc[p][t]` with one room bitmask per cell,
 *   propagated to a fixpoint and then searched one slot at a time, tightest
 *   slot first.
 *
 * The one thing to hold on to while reading: **the accept test at the bottom
 * is the ground truth.** A finished assignment becomes a world only if
 * `isLegal` and `clueHolds` both say so, asked from scratch against the same
 * definitions the rest of the engine uses. Every narrowing above it is an
 * optimisation, so a bug in one can only cost completeness — a world we fail
 * to find — and never soundness.
 */

import {
  allowedRoomsMask,
  capacityOf,
  isLegal,
  movementMasks,
  testimonyBinds,
} from "../axioms";
import { bit, popcount } from "../bits";
import { clueHolds, validBody } from "../clues";
import type {
  Answer,
  CaseFrame,
  Clue,
  ClueBody,
  DoorId,
  PersonId,
  RoomId,
  SlotIndex,
  World,
} from "../types";

export interface SearchOptions {
  /** Abort with an error rather than silently returning a wrong result. Default 5e6. */
  nodeLimit?: number;
}

/**
 * Generous enough that no honest case comes near it, small enough that a
 * runaway search fails in seconds. Exceeding it means a bug somewhere, and
 * the generator would far rather crash in development than ship an unfair
 * case.
 */
const DEFAULT_NODE_LIMIT = 5e6;

/** A stable key for an answer, so a test can compare whole answer sets. */
export function answerKey(a: Answer): string {
  return `c${a.culprit}t${a.slot}`;
}

/* ------------------------------------------------------------- the budget */

interface Budget {
  used: number;
  limit: number;
}

/**
 * One node is one step of the search: the root of a candidate's tree, or one
 * cell assignment tried. Roots count too, so a call that refutes every
 * candidate during propagation still pays something and a tiny limit really
 * does stop a run rather than quietly letting it through.
 */
function spend(budget: Budget): void {
  budget.used++;
  if (budget.used > budget.limit) {
    throw new Error(
      `exhaustive solver exceeded its node limit of ${budget.limit}; ` +
        "refusing to return a result it is not sure of",
    );
  }
}

/* -------------------------------------------------------------- the setup */

/** What every candidate with the same culprit shares, worked out once. */
interface Culprit {
  binding: Clue[];
  /** `moves[p][t][from]` — the frame's movement table, tightened by clues. */
  moves: number[][][];
  /** The tightest living-head cap on each room, from the rules and the clues. */
  cap: number[];
}

interface Prep {
  frame: CaseFrame;
  clues: readonly Clue[];
  budget: Budget;
  perCulprit: Culprit[];
}

function prepare(
  frame: CaseFrame,
  clues: readonly Clue[],
  opts: SearchOptions | undefined,
): Prep {
  // A body that is not even a sentence about this case would index outside a
  // domain array and quietly poison the answer, so it is an error rather than
  // a clue that happens to be false.
  for (const clue of clues) {
    if (!validBody(clue.body, frame)) {
      throw new Error(`clue ${clue.id} is not well formed for this case`);
    }
  }

  const base = movementMasks(frame);
  const perCulprit: Culprit[] = [];
  for (let c = 0; c < frame.suspects; c++) {
    const binding = clues.filter((cl) => testimonyBinds(frame, cl, c));
    perCulprit.push({
      binding,
      moves: restrictMoves(frame, base, binding),
      cap: capsFor(frame, binding),
    });
  }

  return {
    frame,
    clues,
    budget: { used: 0, limit: opts?.nodeLimit ?? DEFAULT_NODE_LIMIT },
    perCulprit,
  };
}

/**
 * `frame.rules` is what `isLegal` reads, but a clue set may carry a closure or
 * a bar the frame does not — the rule clues are ordinary formulas, and a test
 * or a fidelity check may hand us one on its own. Folding them into the
 * movement table prunes; the accept test is what makes them binding.
 */
function restrictMoves(
  frame: CaseFrame,
  base: number[][][],
  binding: readonly Clue[],
): number[][][] {
  const doorClues = binding.filter(
    (c) => c.body.kind === "DoorClosed" || c.body.kind === "BarredDoor",
  );
  if (doorClues.length === 0) return base;

  const moves = base.map((perSlot) => perSlot.map((perRoom) => [...perRoom]));
  const shut = (p: PersonId, t: SlotIndex, e: DoorId): void => {
    const door = frame.plan.doors[e];
    if (!door) return;
    moves[p][t][door.a] &= ~bit(door.b);
    moves[p][t][door.b] &= ~bit(door.a);
  };

  for (const clue of doorClues) {
    const b = clue.body;
    if (b.kind === "DoorClosed") {
      // The same clamp `DoorClosed.holds` uses: it blocks the transitions
      // `from <= t < to`, and the last transition of the evening is
      // `slots - 2`. `holds` clamps the same way, so the two cannot disagree.
      const lo = Math.max(0, Math.min(b.from, b.to));
      const hi = Math.min(Math.max(b.from, b.to), frame.slots - 1);
      for (let t = lo; t < hi; t++) {
        for (let p = 0; p < frame.people; p++) shut(p, t, b.door);
      }
    } else if (b.kind === "BarredDoor") {
      for (let t = 0; t + 1 < frame.slots; t++) shut(b.p, t, b.door);
    }
  }
  return moves;
}

function capsFor(frame: CaseFrame, binding: readonly Clue[]): number[] {
  const cap: number[] = [];
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    cap.push(capacityOf(frame, r));
  }
  for (const clue of binding) {
    const b = clue.body;
    if (b.kind === "Capacity" && b.k < cap[b.r]) cap[b.r] = b.k;
  }
  return cap;
}

/* ----------------------------------------------------------- a candidate */

interface Candidate {
  frame: CaseFrame;
  /** Every clue, for the accept test: `clueHolds` drops the lies itself. */
  clues: readonly Clue[];
  binding: readonly Clue[];
  moves: number[][][];
  cap: number[];
  budget: Budget;
  c: PersonId;
  tStar: SlotIndex;
  V: PersonId;
  P: number;
  T: number;
  R: number;
  /** `dom[p * T + t]` — the rooms `p` may still occupy in slot `t`. */
  dom: Int32Array;
  dirty: boolean;
}

/** An extra demand on one cell, which is how `cellPossible` asks. */
export interface Pin {
  p: PersonId;
  t: SlotIndex;
  r: RoomId;
}

function setup(
  prep: Prep,
  c: PersonId,
  tStar: SlotIndex,
  pin: Pin | undefined,
): Candidate | null {
  const frame = prep.frame;
  const shared = prep.perCulprit[c];
  const P = frame.people;
  const T = frame.slots;
  const rStar = frame.murderRoom;

  const dom = new Int32Array(P * T);
  for (let p = 0; p < P; p++) {
    const allowed = allowedRoomsMask(frame, p);
    for (let t = 0; t < T; t++) dom[p * T + t] = allowed;
  }

  const cand: Candidate = {
    frame,
    clues: prep.clues,
    binding: shared.binding,
    moves: shared.moves,
    cap: shared.cap,
    budget: prep.budget,
    c,
    tStar,
    V: frame.victim,
    P,
    T,
    R: frame.plan.rooms.length,
    dom,
    dirty: false,
  };

  // Rules 4 and 5 — everything the candidate itself asserts. The victim is
  // not a living presence at `t*` or after, which is why the body may share
  // `r*` with the killer while nobody else may.
  if (!set(cand, c, tStar, bit(rStar))) return null;
  for (let t = tStar; t < T; t++) {
    if (!set(cand, cand.V, t, bit(rStar))) return null;
    for (let p = 0; p < P; p++) {
      if (p === c || p === cand.V) continue;
      if (!set(cand, p, t, ~bit(rStar))) return null;
    }
  }

  if (pin && !set(cand, pin.p, pin.t, bit(pin.r))) return null;
  if (!propagate(cand)) return null;
  return cand;
}

/* ----------------------------------------------------------- the domains */

/** Narrow a cell. False means it is now empty, so the candidate is dead. */
function set(
  cand: Candidate,
  p: PersonId,
  t: SlotIndex,
  mask: number,
): boolean {
  const i = p * cand.T + t;
  const next = cand.dom[i] & mask;
  if (next !== cand.dom[i]) {
    cand.dom[i] = next;
    cand.dirty = true;
  }
  return next !== 0;
}

function domOf(cand: Candidate, p: PersonId, t: SlotIndex): number {
  return cand.dom[p * cand.T + t];
}

/** Rule 4 seen from the domains: the body is not somebody. */
function living(cand: Candidate, p: PersonId, t: SlotIndex): boolean {
  return p !== cand.V || t < cand.tStar;
}

function anyEmpty(cand: Candidate): boolean {
  for (let i = 0; i < cand.dom.length; i++) {
    if (cand.dom[i] === 0) return true;
  }
  return false;
}

/** At least `k` living heads in `r` at `t`; forces them all when that is tight. */
function atLeast(
  cand: Candidate,
  r: RoomId,
  t: SlotIndex,
  k: number,
): boolean {
  if (k <= 0) return true;
  let possible = 0;
  let who = 0;
  for (let p = 0; p < cand.P; p++) {
    if (!living(cand, p, t)) continue;
    if ((domOf(cand, p, t) & bit(r)) !== 0) {
      possible++;
      who |= bit(p);
    }
  }
  if (possible < k) return false;
  if (possible === k) {
    for (let p = 0; p < cand.P; p++) {
      if ((who & bit(p)) === 0) continue;
      if (!set(cand, p, t, bit(r))) return false;
    }
  }
  return true;
}

/** At most `k` living heads in `r` at `t`; shuts the room once `k` are certain. */
function atMost(
  cand: Candidate,
  r: RoomId,
  t: SlotIndex,
  k: number,
): boolean {
  if (!Number.isFinite(k)) return true;
  let forced = 0;
  let loose = 0;
  for (let p = 0; p < cand.P; p++) {
    if (!living(cand, p, t)) continue;
    const d = domOf(cand, p, t);
    if ((d & bit(r)) === 0) continue;
    if (d === bit(r)) forced++;
    else loose |= bit(p);
  }
  if (forced > k) return false;
  if (forced === k) {
    for (let p = 0; p < cand.P; p++) {
      if ((loose & bit(p)) === 0) continue;
      if (!set(cand, p, t, ~bit(r))) return false;
    }
  }
  return true;
}

/**
 * What each binding clue forces on the domains. Only forced consequences
 * belong here: a clue that narrows the space of worlds without settling any
 * cell is left to the accept test, which loses nothing but time.
 */
function clueProp(cand: Candidate): boolean {
  for (const clue of cand.binding) {
    const b: ClueBody = clue.body;
    switch (b.kind) {
      case "At":
        if (!set(cand, b.p, b.t, bit(b.r))) return false;
        break;

      case "NotAt":
        if (!set(cand, b.p, b.t, ~bit(b.r))) return false;
        break;

      case "Stayed": {
        const lo = Math.min(b.t1, b.t2);
        const hi = Math.max(b.t1, b.t2);
        for (let t = lo; t <= hi; t++) {
          if (!set(cand, b.p, t, bit(b.r))) return false;
        }
        break;
      }

      case "Saw":
        // Nobody sees a corpse, so a sighting of the victim at or after the
        // murder slot refutes the candidate outright instead of placing him.
        if (b.p === b.q) return false;
        if (!living(cand, b.p, b.t) || !living(cand, b.q, b.t)) return false;
        if (!set(cand, b.p, b.t, bit(b.r))) return false;
        if (!set(cand, b.q, b.t, bit(b.r))) return false;
        break;

      case "Together": {
        if (b.p === b.q) return false;
        if (!living(cand, b.p, b.t) || !living(cand, b.q, b.t)) return false;
        const both = domOf(cand, b.p, b.t) & domOf(cand, b.q, b.t);
        if (!set(cand, b.p, b.t, both)) return false;
        if (!set(cand, b.q, b.t, both)) return false;
        break;
      }

      case "AloneIn":
        if (!living(cand, b.p, b.t)) return false;
        if (!set(cand, b.p, b.t, bit(b.r))) return false;
        for (let q = 0; q < cand.P; q++) {
          if (q === b.p || !living(cand, q, b.t)) continue;
          if (!set(cand, q, b.t, ~bit(b.r))) return false;
        }
        break;

      case "Occupied":
        if (!atLeast(cand, b.r, b.t, 1)) return false;
        break;

      case "Empty":
        if (!atMost(cand, b.r, b.t, 0)) return false;
        break;

      case "Count":
        if (!atLeast(cand, b.r, b.t, b.k)) return false;
        if (!atMost(cand, b.r, b.t, b.k)) return false;
        break;

      case "Visited": {
        // A disjunction over slots, so it forces only when one slot is left.
        let only = -1;
        let n = 0;
        for (let t = 0; t < cand.T; t++) {
          if ((domOf(cand, b.p, t) & bit(b.r)) !== 0) {
            n++;
            only = t;
          }
        }
        if (n === 0) return false;
        if (n === 1 && !set(cand, b.p, only, bit(b.r))) return false;
        break;
      }

      case "NeverVisited":
        for (let t = 0; t < cand.T; t++) {
          if (!set(cand, b.p, t, ~bit(b.r))) return false;
        }
        break;

      case "AliveAt":
        // Purely about the candidate: `AliveAt(t)` is `t < t*`.
        if (b.t >= cand.tStar) return false;
        break;

      case "DeathWindow":
        if (cand.tStar < Math.min(b.a, b.b)) return false;
        if (cand.tStar > Math.max(b.a, b.b)) return false;
        break;

      case "DoorClosed":
      case "BarredDoor":
        // Already folded into this candidate's movement table.
        break;

      case "BarredRoom":
        for (let t = 0; t < cand.T; t++) {
          if (!set(cand, b.p, t, ~bit(b.r))) return false;
        }
        break;

      case "Capacity":
        // Folded into `cand.cap`, which the sweep below applies every slot.
        break;

      default: {
        // A new clue kind must say what it forces, even if that is nothing.
        const unreachable: never = b;
        throw new Error(`no propagator for ${JSON.stringify(unreachable)}`);
      }
    }
  }

  for (let r = 0; r < cand.R; r++) {
    if (!Number.isFinite(cand.cap[r])) continue;
    for (let t = 0; t < cand.T; t++) {
      if (!atMost(cand, r, t, cand.cap[r])) return false;
    }
  }
  return true;
}

/**
 * Rule 2 along each person's timeline, forwards and then backwards. Forwards:
 * a room in slot `t + 1` survives only if some room still open in slot `t`
 * reaches it. Backwards: a room in slot `t` survives only if it reaches
 * something still open in slot `t + 1`.
 */
function movementAC(cand: Candidate): boolean {
  const T = cand.T;
  for (let p = 0; p < cand.P; p++) {
    for (let t = 0; t + 1 < T; t++) {
      const table = cand.moves[p][t];
      let m = domOf(cand, p, t);
      let reach = 0;
      while (m !== 0) {
        const low = m & -m;
        m ^= low;
        reach |= table[31 - Math.clz32(low)];
      }
      if (!set(cand, p, t + 1, reach)) return false;
    }
    for (let t = T - 2; t >= 0; t--) {
      const table = cand.moves[p][t];
      const next = domOf(cand, p, t + 1);
      let m = domOf(cand, p, t);
      let keep = 0;
      while (m !== 0) {
        const low = m & -m;
        m ^= low;
        if ((table[31 - Math.clz32(low)] & next) !== 0) keep |= low;
      }
      if (!set(cand, p, t, keep)) return false;
    }
  }
  return true;
}

function propagate(cand: Candidate): boolean {
  for (;;) {
    if (anyEmpty(cand)) return false;
    cand.dirty = false;
    if (!clueProp(cand)) return false;
    if (!movementAC(cand)) return false;
    // Domains only ever shrink, so the fixpoint is reached in finitely many
    // rounds whatever the propagators do.
    if (!cand.dirty) return !anyEmpty(cand);
  }
}

/* ------------------------------------------------------------ the search */

/**
 * THE ACCEPT TEST, and the reason everything above it is allowed to be
 * clever. A complete assignment becomes a world only when `isLegal` and
 * `clueHolds` — the very functions the axioms and the clue registry hand to
 * everybody else — both accept it. All the narrowing above is pruning, and a
 * bug in pruning can only lose a world that exists; it can never invent one.
 */
function accept(cand: Candidate): World | null {
  const loc: RoomId[][] = [];
  for (let p = 0; p < cand.P; p++) {
    const row: RoomId[] = [];
    for (let t = 0; t < cand.T; t++) {
      const d = domOf(cand, p, t);
      if (d === 0 || (d & (d - 1)) !== 0) return null;
      row.push(31 - Math.clz32(d));
    }
    loc.push(row);
  }
  const world: World = { loc, culprit: cand.c, murderSlot: cand.tStar };
  if (!isLegal(cand.frame, world)) return null;
  for (const clue of cand.clues) {
    if (!clueHolds(cand.frame, clue, world)) return null;
  }
  return world;
}

/**
 * Slot by slot, person by person, smallest domain first; `t < 0` means "pick
 * the next slot". Settling a whole slot before starting the next is what
 * makes the counting constraints bite as early as they can — `atLeast` and
 * `atMost` read partial domains, so a room that can no longer reach its
 * `Count` is refuted mid-slot.
 *
 * Which slot goes next is chosen rather than counted off, and that choice is
 * worth more than anything else in this file. Measured on a 6-suspect,
 * 8-slot, 9-room case with forty clue sets per size: walking the evening in
 * order costs seconds on a thin set (12s on one, 27s on another) because the
 * contradiction sits in the last hour it reaches, while taking the tightest
 * slot first holds forty sets of thirty clues under 19ms each.
 */
function solve(cand: Candidate, t: SlotIndex): World | null {
  spend(cand.budget);

  if (t < 0) {
    // The unsettled slot with the least room left in it.
    let bestT = -1;
    let bestSlack = Number.MAX_SAFE_INTEGER;
    for (let s = 0; s < cand.T; s++) {
      let slack = 0;
      let open = false;
      for (let p = 0; p < cand.P; p++) {
        const size = popcount(domOf(cand, p, s));
        if (size === 0) return null;
        if (size > 1) {
          open = true;
          slack += size - 1;
        }
      }
      if (open && slack < bestSlack) {
        bestSlack = slack;
        bestT = s;
      }
    }
    if (bestT < 0) return accept(cand);
    return solve(cand, bestT);
  }

  let best = -1;
  let bestSize = Number.MAX_SAFE_INTEGER;
  for (let p = 0; p < cand.P; p++) {
    const size = popcount(domOf(cand, p, t));
    if (size === 0) return null;
    if (size > 1 && size < bestSize) {
      best = p;
      bestSize = size;
    }
  }
  if (best < 0) return solve(cand, -1);

  // Undo by copy. The whole domain table is P * T ints — under sixty on any
  // case the presets can produce — so a trail would buy nothing but bugs.
  const saved = cand.dom.slice();
  let m = domOf(cand, best, t);
  while (m !== 0) {
    const low = m & -m;
    m ^= low;
    cand.dom[best * cand.T + t] = low;
    cand.dirty = true;
    if (propagate(cand)) {
      const world = solve(cand, t);
      if (world !== null) return world;
    }
    cand.dom.set(saved);
  }
  return null;
}

function solveCandidate(
  prep: Prep,
  c: PersonId,
  tStar: SlotIndex,
  pin?: Pin,
): World | null {
  const frame = prep.frame;
  if (!Number.isInteger(c) || c < 0 || c >= frame.suspects) return null;
  if (!Number.isInteger(tStar) || tStar < 0 || tStar >= frame.slots) {
    return null;
  }
  spend(prep.budget);
  const cand = setup(prep, c, tStar, pin);
  if (cand === null) return null;
  return solve(cand, -1);
}

function pinValid(frame: CaseFrame, pin: Pin): boolean {
  return (
    Number.isInteger(pin.p) &&
    pin.p >= 0 &&
    pin.p < frame.people &&
    Number.isInteger(pin.t) &&
    pin.t >= 0 &&
    pin.t < frame.slots &&
    Number.isInteger(pin.r) &&
    pin.r >= 0 &&
    pin.r < frame.plan.rooms.length
  );
}

/* --------------------------------------------------------------- the API */

/**
 * Every `(culprit, slot)` for which some legal world satisfies every binding
 * clue, sorted by culprit and then by slot. A case is fair exactly when this
 * returns the true answer and nothing else.
 */
export function answers(
  frame: CaseFrame,
  clues: readonly Clue[],
  opts?: SearchOptions,
): Answer[] {
  const prep = prepare(frame, clues, opts);
  const out: Answer[] = [];
  for (let c = 0; c < frame.suspects; c++) {
    for (let t = 0; t < frame.slots; t++) {
      // One witness settles a candidate; there is nothing to learn from a
      // second, so the search stops at the first.
      if (solveCandidate(prep, c, t) !== null) {
        out.push({ culprit: c, slot: t });
      }
    }
  }
  return out;
}

/** Is this one answer possible? */
export function answerPossible(
  frame: CaseFrame,
  clues: readonly Clue[],
  answer: Answer,
  opts?: SearchOptions,
): boolean {
  return findWorld(frame, clues, answer, undefined, opts) !== null;
}

/**
 * A witness world for an answer, or null. `pin` additionally demands that `p`
 * be in room `r` in slot `t`.
 */
export function findWorld(
  frame: CaseFrame,
  clues: readonly Clue[],
  answer: Answer,
  pin?: Pin,
  opts?: SearchOptions,
): World | null {
  if (pin && !pinValid(frame, pin)) return null;
  const prep = prepare(frame, clues, opts);
  return solveCandidate(prep, answer.culprit, answer.slot, pin);
}

/**
 * Could `p` have been in `r` in slot `t`, in any world the clues allow? The
 * answer is not settled here, so every candidate has to be tried.
 */
export function cellPossible(
  frame: CaseFrame,
  clues: readonly Clue[],
  p: PersonId,
  t: SlotIndex,
  r: RoomId,
  opts?: SearchOptions,
): boolean {
  const pin: Pin = { p, t, r };
  if (!pinValid(frame, pin)) return false;
  const prep = prepare(frame, clues, opts);
  for (let c = 0; c < frame.suspects; c++) {
    for (let tStar = 0; tStar < frame.slots; tStar++) {
      if (solveCandidate(prep, c, tStar, pin) !== null) return true;
    }
  }
  return false;
}
