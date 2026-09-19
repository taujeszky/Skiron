/**
 * The truth: one evening, walked.
 *
 * `simulateTruth` invents what actually happened — who stood where in every
 * slot, who the killer is, which slot the murder falls in — and it does so by
 * construction rather than by generate-and-filter. Every step of every walk is
 * taken inside the case-file rules, and rules 4 and 5 are enforced by shrinking
 * people's room domains *before* they move rather than by throwing worlds away
 * afterwards. `isLegal` is still consulted at the end, but only as a self
 * check: a world that fails it is a bug in this file, and one that costs an
 * attempt rather than a crash, because a generator that dies on one seed in ten
 * thousand is worse than one that quietly draws again.
 *
 * The construction, in the order the evening is built:
 *
 * 1. Pick the murder slot `t*` and the killer `c`.
 * 2. Work out which rooms `c` could possibly be standing in at `t*`.
 * 3. Walk the victim freely from slot 0 to `t*`, steered into one of those
 *    rooms. Where they end up *is* the murder room `r*`. The player is told
 *    `r*` at the start, so it wants the spread a free walk gives rather than
 *    the flatness of picking a room and dragging the victim to it.
 * 4. Walk `c`, with `r*` pinned at `t*`.
 * 5. Walk everyone else, with `r*` struck out from `t*` onwards.
 *
 * Steps 3-5 share one trick. Before anybody moves, build the set of rooms they
 * may stand in at each slot — bars, capacity, the `r*` exclusion, the pin — and
 * sweep it backwards through the movement table, dropping every room from which
 * the rest of the evening cannot be completed. A walk that only ever steps into
 * that set cannot paint itself into a corner, so each walk is one forward pass
 * with no backtracking.
 */

import {
  allowedRoomsMask,
  capacityOf,
  isLegal,
  movementMasks,
  presentMask,
} from "../axioms";
import { bit, bitsOf, has, popcount } from "../bits";
import { RNG } from "../rng";
import { MAX_PEOPLE, MAX_ROOMS, MAX_SLOTS } from "../types";
import type {
  CaseFrame,
  CaseRules,
  FloorPlan,
  PersonId,
  RoomId,
  SlotIndex,
  World,
} from "../types";

/* --------------------------------------------------------------- the API */

/** Everything the simulation needs that it cannot invent for itself. */
export interface TruthRequest {
  plan: FloorPlan;
  rules: CaseRules;
  suspects: number;
  slots: number;
  lying: boolean;
}

export interface SimOptions {
  /** chance a person stays put rather than moving, per transition.
      Default 0.45. */
  stayProb?: number;
  /** pull towards rooms that already hold someone, so paths cross. Default 2.5
      (a multiplier on the weight of an occupied destination). */
  gatherPull?: number;
  /** murder slot is drawn from [1, slots-2] by default so someone can have
      seen the victim alive and the killer has somewhere to go afterwards. */
  murderSlotRange?: [number, number];
  maxAttempts?: number; // default 200
  /** Quality floor: how many two-person co-locations the evening must hold,
      counted as unordered pairs of living people sharing a room and summed
      over the slots. Default 3 — see the constant below. */
  minMeetings?: number;
  /** Quality floor: in how many slots the victim must have company while
      alive. Default 1. A victim nobody ever saw gives the case no witness to
      an `AliveAt`, and the death window then has to be pinned from the
      killer's side alone. */
  minVictimCompany?: number;
}

export interface TruthResult {
  frame: CaseFrame;
  world: World;
  /** failed attempts before this one. Wave 3's sim table wants this number. */
  retries: number;
}

/**
 * Starting points, every one of them. Wave 3 tunes these from the sim table
 * rather than by feel (CLAUDE.md), so they are named constants here and not
 * literals buried in the walk.
 *
 * Measured over 2000 unguarded seeds of the four size presets: an evening
 * holds a median of 16 meetings, fewer than 3 in 0.0% of them and fewer than
 * 5 in 0.6%, and the victim has company in 90.6%. So `minMeetings` at 3 is
 * insurance that the presets never pay for, while `minVictimCompany` at 1
 * costs about 0.07 retries a case and is worth it: the whole death window
 * hangs off somebody having seen the victim alive. Both floors bite hard on
 * small or heavily barred maps, which is where wave 3 will want the dial.
 */
const DEFAULT_STAY_PROB = 0.45;
const DEFAULT_GATHER_PULL = 2.5;
const DEFAULT_MAX_ATTEMPTS = 200;
const DEFAULT_MIN_MEETINGS = 3;
const DEFAULT_MIN_VICTIM_COMPANY = 1;

/**
 * A legal world for `req`, or null if `maxAttempts` attempts all failed.
 *
 * Null means bad luck, not a bad request: a malformed request throws instead,
 * so a caller's mistake cannot hide as an unlucky seed. At the sizes the
 * presets use, null essentially never happens — `simulate.test.ts` pins that.
 *
 * As in `buildFloorPlan`, it draws exactly one number from the caller's stream
 * however many attempts it needs, and runs each attempt on an RNG derived from
 * it. A retry here therefore cannot shift the rest of the generator's draws,
 * which would change what an old case id rebuilds for no reason at all.
 */
export function simulateTruth(
  rng: RNG,
  req: TruthRequest,
  opts: SimOptions = {},
): TruthResult | null {
  const spec = resolveOptions(req, opts);
  const draft = draftFrame(req);
  // Neither table reads `murderRoom`, so both are safe to build once, before
  // the victim's walk has decided what it is.
  const moves = movementMasks(draft);
  const caps = draft.plan.rooms.map((room) => capacityOf(draft, room.id));

  const base = rng.next();
  for (let attempt = 0; attempt < spec.maxAttempts; attempt++) {
    const built = attemptTruth(
      new RNG(`skiron-truth:${base}:${attempt}`),
      draft,
      moves,
      caps,
      spec,
    );
    if (built) {
      return { frame: built.frame, world: built.world, retries: attempt };
    }
  }
  return null;
}

/* ----------------------------------------------------------- one attempt */

interface Spec {
  stayProb: number;
  gatherPull: number;
  murderSlotLo: SlotIndex;
  murderSlotHi: SlotIndex;
  maxAttempts: number;
  minMeetings: number;
  minVictimCompany: number;
}

function attemptTruth(
  rng: RNG,
  draft: CaseFrame,
  moves: number[][][],
  caps: readonly number[],
  spec: Spec,
): { frame: CaseFrame; world: World } | null {
  const T = draft.slots;
  const n = draft.plan.rooms.length;
  const V = draft.victim;

  const tStar =
    spec.murderSlotLo + rng.int(spec.murderSlotHi - spec.murderSlotLo + 1);
  const culprit = rng.int(draft.suspects);

  // Living people already placed, per slot and room. Every placement is
  // checked against this, so the last person through a door sees everyone who
  // came before and no room capacity can be overrun.
  const occ: number[][] = Array.from({ length: T }, () =>
    new Array<number>(n).fill(0),
  );
  const loc = new Array<RoomId[]>(draft.people);

  // Where could the killer be standing at t*? The victim is then steered into
  // one of those rooms, so "the killer could have got there" holds by
  // construction instead of by rejection. Nobody has walked yet, so this sees
  // an empty house; the killer's real feasibility is recomputed below with the
  // victim in place, and the attempt is spent in the rare case it has shrunk
  // to nothing since.
  const killerRooms = arrivalRooms(
    moves,
    culprit,
    roomAllowance(draft, caps, occ, culprit, T),
    tStar,
    T,
  );
  if (killerRooms === 0) return null;

  // The victim, freely, up to the slot they die in. From then on the body does
  // not move (rule 5), so the walk simply stops and the room repeats.
  const victimAllow = roomAllowance(draft, caps, occ, V, tStar);
  victimAllow[tStar] &= killerRooms;
  const victimRow = walk(
    rng,
    moves,
    V,
    backwardMasks(moves, V, victimAllow, tStar),
    occ,
    spec,
  );
  if (!victimRow) return null;
  const murderRoom = victimRow[tStar];
  for (let t = tStar + 1; t < T; t++) victimRow.push(murderRoom);
  loc[V] = victimRow;
  for (let t = 0; t < tStar; t++) occ[t][victimRow[t]]++;

  const frame: CaseFrame = { ...draft, murderRoom };

  // The killer, pinned to the body's room in the murder slot. Free before and
  // after: rule 5 lets them stay with the body or walk away from it.
  const killerAllow = roomAllowance(frame, caps, occ, culprit, T);
  killerAllow[tStar] &= bit(murderRoom);
  const killerRow = walk(
    rng,
    moves,
    culprit,
    backwardMasks(moves, culprit, killerAllow, T - 1),
    occ,
    spec,
  );
  if (!killerRow) return null;
  loc[culprit] = killerRow;
  for (let t = 0; t < T; t++) occ[t][killerRow[t]]++;

  // Everyone else, with the murder room struck out from t* onwards. That is
  // rule 5; together with the dead victim not counting as a presence it is
  // also the "alone with the killer" half of rule 4.
  const others: PersonId[] = [];
  for (let p = 0; p < draft.suspects; p++) if (p !== culprit) others.push(p);
  for (const p of rng.shuffle(others)) {
    const allow = roomAllowance(frame, caps, occ, p, T);
    for (let t = tStar; t < T; t++) allow[t] &= ~bit(murderRoom);
    const row = walk(
      rng,
      moves,
      p,
      backwardMasks(moves, p, allow, T - 1),
      occ,
      spec,
    );
    if (!row) return null;
    loc[p] = row;
    for (let t = 0; t < T; t++) occ[t][row[t]]++;
  }

  const world: World = { loc, culprit, murderSlot: tStar };

  // The quality floor. An evening in which nobody meets anybody yields no
  // sightings, and a clue set without sightings is a crossword, not a case.
  if (countMeetings(frame, world) < spec.minMeetings) return null;
  if (countVictimCompany(frame, world) < spec.minVictimCompany) return null;

  // The self check. Failing here is a bug above rather than bad luck, but an
  // attempt spent is cheaper for the player than a thrown generator.
  if (!isLegal(frame, world)) return null;
  return { frame, world };
}

/* --------------------------------------------------------- room domains */

/**
 * The rooms `p` may stand in, slot by slot: the ones they are not barred from,
 * less the ones already full. `livingUntil` is the first slot in which `p`
 * stops counting as a presence — `slots` for everybody but the victim, `t*`
 * for them, because a body neither fills a room nor can be kept out of one.
 */
function roomAllowance(
  frame: CaseFrame,
  caps: readonly number[],
  occ: readonly number[][],
  p: PersonId,
  livingUntil: number,
): number[] {
  const allowed = allowedRoomsMask(frame, p);
  const out: number[] = [];
  for (let t = 0; t < frame.slots; t++) {
    let mask = allowed;
    if (t < livingUntil) {
      for (let r = 0; r < caps.length; r++) {
        if (occ[t][r] >= caps[r]) mask &= ~bit(r);
      }
    }
    out.push(mask);
  }
  return out;
}

/**
 * Sweep an allowance backwards: `out[t]` keeps only the rooms from which `p`
 * can still walk on to slot `last`. This is what lets `walk` be a single
 * forward pass — standing inside `out[t]` guarantees somewhere to go next.
 */
function backwardMasks(
  moves: number[][][],
  p: PersonId,
  allow: readonly number[],
  last: SlotIndex,
): number[] {
  const out = new Array<number>(last + 1);
  out[last] = allow[last];
  for (let t = last - 1; t >= 0; t--) {
    let mask = 0;
    for (const r of bitsOf(allow[t])) {
      if ((moves[p][t][r] & out[t + 1]) !== 0) mask |= bit(r);
    }
    out[t] = mask;
  }
  return out;
}

/**
 * The rooms `p` could occupy in slot `at`: reachable forwards from some legal
 * start, and not a dead end for the rest of the evening.
 */
function arrivalRooms(
  moves: number[][][],
  p: PersonId,
  allow: readonly number[],
  at: SlotIndex,
  slots: number,
): number {
  const back = backwardMasks(moves, p, allow, slots - 1);
  let fwd = allow[0];
  for (let t = 0; t < at; t++) {
    let next = 0;
    for (const r of bitsOf(fwd)) next |= moves[p][t][r];
    fwd = next & allow[t + 1];
  }
  return fwd & back[at];
}

/* --------------------------------------------------------------- walking */

/** One row of the notebook grid, or null if `p` had nowhere to start. */
function walk(
  rng: RNG,
  moves: number[][][],
  p: PersonId,
  feas: readonly number[],
  occ: readonly number[][],
  spec: Spec,
): RoomId[] | null {
  const last = feas.length - 1;
  const start = pickRoom(rng, feas[0], occ[0], spec, -1);
  if (start < 0) return null;
  const row: RoomId[] = [start];
  for (let t = 0; t < last; t++) {
    const cands = moves[p][t][row[t]] & feas[t + 1];
    // Unreachable while `feas` comes from `backwardMasks`. Bailing out rather
    // than trusting it keeps a mistake there a retry and not a bad world.
    if (cands === 0) return null;
    row.push(pickRoom(rng, cands, occ[t + 1], spec, row[t]));
  }
  return row;
}

/**
 * One room out of `mask`, or -1 if it is empty. `stay` is where the person
 * already is, or -1 when they are choosing where to begin the evening.
 *
 * Staying wins with probability `stayProb`; otherwise the choice is pulled
 * towards rooms that already hold somebody, which is what makes paths cross
 * often enough for there to be anything to testify about. The pull reads the
 * *destination* slot, so it is "go where the party is" rather than "follow
 * whoever was standing here".
 */
function pickRoom(
  rng: RNG,
  mask: number,
  occAt: readonly number[],
  spec: Spec,
  stay: RoomId,
): RoomId {
  if (mask === 0) return -1;
  const options = bitsOf(mask);
  const staying = stay >= 0 && has(mask, stay);
  if (staying && (options.length === 1 || rng.chance(spec.stayProb))) {
    return stay;
  }
  const moveTo = staying ? options.filter((r) => r !== stay) : options;
  if (moveTo.length === 0) return stay;
  const weights = moveTo.map((r) => (occAt[r] > 0 ? spec.gatherPull : 1));
  return moveTo[rng.weighted(weights)];
}

/* ------------------------------------------------------ quality measures */

/**
 * Unordered pairs of living people sharing a room, summed over every slot.
 * The murder itself is not a meeting: the victim stops counting at `t*`.
 */
export function countMeetings(frame: CaseFrame, world: World): number {
  let total = 0;
  for (let t = 0; t < frame.slots; t++) {
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      const k = popcount(presentMask(frame, world, r, t));
      total += (k * (k - 1)) / 2;
    }
  }
  return total;
}

/** In how many slots the victim had company while they were still alive. */
export function countVictimCompany(frame: CaseFrame, world: World): number {
  let slots = 0;
  for (let t = 0; t < world.murderSlot; t++) {
    const room = world.loc[frame.victim][t];
    if (popcount(presentMask(frame, world, room, t)) > 1) slots++;
  }
  return slots;
}

/* ----------------------------------------------------------- the request */

function draftFrame(req: TruthRequest): CaseFrame {
  return {
    plan: req.plan,
    rules: req.rules,
    suspects: req.suspects,
    slots: req.slots,
    people: req.suspects + 1,
    victim: req.suspects,
    // A placeholder until the victim's walk decides it. Nothing reads it
    // before then, and every frame this module returns carries the real room.
    murderRoom: 0,
    lying: req.lying,
  };
}

function resolveOptions(req: TruthRequest, opts: SimOptions): Spec {
  const whole = (n: number) => Number.isInteger(n);
  if (!whole(req.suspects) || req.suspects < 1) {
    throw new Error(
      "TruthRequest.suspects must be a whole number of at least 1",
    );
  }
  if (req.suspects + 1 > MAX_PEOPLE) {
    throw new Error(
      `a case holds at most ${MAX_PEOPLE} people, the victim included`,
    );
  }
  if (!whole(req.slots) || req.slots < 2 || req.slots > MAX_SLOTS) {
    throw new Error(
      `TruthRequest.slots must be a whole number in 2..${MAX_SLOTS}`,
    );
  }
  const rooms = req.plan.rooms.length;
  if (rooms < 1 || rooms > MAX_ROOMS) {
    throw new Error(`a floor plan must hold 1..${MAX_ROOMS} rooms`);
  }

  const [lo, hi] = opts.murderSlotRange ?? [1, req.slots - 2];
  if (!whole(lo) || !whole(hi) || lo < 0 || hi >= req.slots || lo > hi) {
    throw new Error(
      `no murder slot in [${lo}, ${hi}] for an evening of ${req.slots} slots`,
    );
  }
  const stayProb = opts.stayProb ?? DEFAULT_STAY_PROB;
  if (!(stayProb >= 0 && stayProb <= 1)) {
    throw new Error("SimOptions.stayProb must be between 0 and 1");
  }
  const gatherPull = opts.gatherPull ?? DEFAULT_GATHER_PULL;
  if (!(gatherPull > 0)) {
    throw new Error("SimOptions.gatherPull must be positive");
  }
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!whole(maxAttempts) || maxAttempts < 1) {
    throw new Error(
      "SimOptions.maxAttempts must be a whole number of at least 1",
    );
  }
  const minMeetings = opts.minMeetings ?? DEFAULT_MIN_MEETINGS;
  if (!whole(minMeetings) || minMeetings < 0) {
    throw new Error("SimOptions.minMeetings must be a whole number >= 0");
  }
  const minVictimCompany = opts.minVictimCompany ?? DEFAULT_MIN_VICTIM_COMPANY;
  if (!whole(minVictimCompany) || minVictimCompany < 0) {
    throw new Error("SimOptions.minVictimCompany must be a whole number >= 0");
  }

  return {
    stayProb,
    gatherPull,
    murderSlotLo: lo,
    murderSlotHi: hi,
    maxAttempts,
    minMeetings,
    minVictimCompany,
  };
}
