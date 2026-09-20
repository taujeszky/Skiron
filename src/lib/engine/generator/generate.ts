/**
 * The generator: a case id in, a whole case out.
 *
 * The pipeline, in the order it runs, and what each step is not allowed to
 * know:
 *
 *  1. the house (`buildFloorPlan`),
 *  2. the case file (`drawCaseRules`) — **before** the evening, so that no
 *     rule can be aimed at a murder room that does not exist yet,
 *  3. the evening (`simulateTruth`), inside those rules,
 *  4. everything true and who could say it (`enumerateClues`),
 *  5. the killer's story (`inventAlibi`), when the preset allows lying,
 *  6. the puzzle (`select`) — draw, prove, and strip to the bone,
 *  7. the oracle (`answers`) — the second, independent certificate,
 *  8. the bank (`buildBank`) and the investigation (`planInvestigation`).
 *
 * **Two grades, and why the second one exists.** `tier` is the grade of the
 * proof set: the hardest reasoning a player needs *if they hold exactly the
 * cards the proof needs*. It is what the hints walk through and what the
 * summing-up recites. But a player is free to ask everybody everything, and
 * the case they then hold is a different and easier one. Measured during this
 * wave, that difference is not small: a bank that hands over every fact in a
 * room makes 16 of 16 cases solvable at tier 0 by searching rooms and never
 * asking a question — the suspects, the lies and the whole trust tier
 * reduced to scenery. So `playTier` is computed on everything the bank can
 * ever release, and **a case whose `playTier` falls below the preset floor is
 * thrown back**. It is a rejection criterion and not a statistic, because a
 * number nobody acts on would not have caught that.
 *
 * The label the player is shown is `difficultyForTier(playTier)`: the grade
 * they are guaranteed to face however thorough they are. `tier` is kept
 * beside it because that is the one the proof trace describes.
 *
 * **On failure the attempt is counted and retried, never thrown away
 * silently and never thrown differently in development.** The plan said to
 * throw in development and discard in production; that would make the case a
 * given id rebuilds depend on the build mode, which is invariant 4's problem,
 * and it hides a soundness bug behind a retry. Instead every rejection has a
 * named reason, the reasons are counted, and `onAssertionFailure` lets the
 * tests and the sim harness turn the two that mean "bug" into a throw.
 */

import { seedFor } from "../caseId";
import type { CaseId } from "../caseId";
import { buildFloorPlan } from "../map";
import { RNG } from "../rng";
import { acceptsTier, difficultyForTier, presetFor } from "../solver/difficulty";
import type { Preset } from "../solver/difficulty";
import { answerKey, answers } from "../solver/exhaustive";
import { solve } from "../solver/solve";
import type { Step } from "../solver/state";
import { simulateTruth } from "../world/simulate";
import type {
  Answer,
  CaseFrame,
  Clue,
  PresetName,
  SlotIndex,
  World,
} from "../types";
import {
  allCards,
  buildBank,
  placementLeaks,
  reachable,
  silenceLeaks,
} from "./bank";
import type { Bank } from "./bank";
import { RULE_BUDGETS, drawCaseRules } from "./caseRules";
import { enumerateClues } from "./enumerate";
import { planInvestigation } from "./investigation";
import type { Investigation } from "./investigation";
import { culpritSpeaks, inventAlibi, tellStory } from "./lies";
import type { Alibi } from "./lies";
import { PRESET_TUNING, select } from "./select";
import type { PresetTuning } from "./select";

export interface GeneratedCase {
  id: CaseId;
  frame: CaseFrame;
  world: World;
  /** The case file and the briefing, held from the start. */
  opening: Clue[];
  /** The cards the proof needs. */
  essential: Clue[];
  /** Opening plus essential, id-sorted: the set the grade is taken on. */
  clues: Clue[];
  bank: Bank;
  investigation: Investigation;
  /** The grade of the proof set. The trace and the hints describe this one. */
  tier: number;
  /** The grade of everything the bank can release. Never below the floor. */
  playTier: number;
  /** What the player is told, from `playTier`. */
  difficulty: PresetName;
  /** The proof, sliced: see `investigation.ts#sliceProof`. */
  trace: Step[];
  /** The killer's story, when there is one. */
  alibi: Alibi | null;
  answer: Answer;
  /** Which attempt produced it, counting from zero. */
  attempt: number;
}

/** Why an attempt was thrown back. Every one of these is counted. */
export type Rejection =
  /** No legal evening: the case file was too harsh for the house. */
  | "simulation"
  /** The case file alone gives the answer away. */
  | "opening-solves"
  /** The drawn cards never proved the case, even after growing. */
  | "unsolvable"
  /** The same, but the hypothesis search ran out of budget first. */
  | "budget"
  /** It proved the case, but not at the difficulty that was asked for. */
  | "tier"
  /** A thorough player could finish it below the preset floor. */
  | "play-tier"
  /** Lying is on and the killer says nothing, so no trust rule can fire. */
  | "mute-culprit"
  /** The oracle hit its node limit. A hard clue set, not a wrong one. */
  | "oracle-limit"
  /** THE ORACLE DISAGREED. A soundness bug — see `onAssertionFailure`. */
  | "unfair"
  /** An essential card no action releases. A bug in the bank. */
  | "unreachable"
  /**
   * The killer would be the only suspect with nothing to say about the
   * murder hour, so their silence names them (rule 7, and `bank.ts`).
   */
  | "legible-silence"
  /**
   * The killer would be the only suspect whose whereabouts at the murder hour
   * no card accounts for, which is the same tell seen from the other side.
   */
  | "legible-gap";

/** The two rejections that mean a bug rather than bad luck. */
export const BUG_REJECTIONS: readonly Rejection[] = ["unfair", "unreachable"];

export interface GenerateOptions {
  /** How many attempts before giving up. */
  maxAttempts?: number;
  /**
   * Called when a certificate fails — the oracle disagreeing with the
   * deduction solver, or an essential card nothing releases. Both mean a bug,
   * and both are still counted and retried so that the case a given id
   * rebuilds does not depend on who is watching. Tests and `npm run sim` pass
   * a function that throws.
   */
  onAssertionFailure?: (reason: Rejection, detail: string) => void;
  /**
   * Override what the preset draws. Only `npm run sim` should pass this: it
   * is how a candidate row of `PRESET_TUNING` is measured before it is
   * written down, and a case generated with it is not the case its id names.
   */
  select?: Partial<PresetTuning>;
}

export interface GenerateResult {
  case: GeneratedCase | null;
  /** Every attempt's rejection reason, in order. Empty when the first won. */
  rejections: Rejection[];
  /** Truth-simulation retries, summed over attempts. */
  simRetries: number;
}

const DEFAULT_MAX_ATTEMPTS = 24;

/**
 * The slots the murder may fall in. `simulateTruth` defaults to exactly this,
 * and the briefing states exactly this — the two must agree or the briefing
 * would be a false card, so it is written once and passed to both.
 */
export function murderRange(slots: number): [SlotIndex, SlotIndex] {
  return [1, slots - 2];
}

export function generate(
  id: CaseId,
  opts: GenerateOptions = {},
): GenerateResult {
  const preset = presetFor(id.preset);
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const rejections: Rejection[] = [];
  let simRetries = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = new RNG(seedFor(id, attempt));
    const built = attemptCase(rng, id, preset, attempt, opts);
    simRetries += built.simRetries;
    if (built.ok) return { case: built.case, rejections, simRetries };
    rejections.push(built.reason);
  }
  return { case: null, rejections, simRetries };
}

type Attempt =
  | { ok: true; case: GeneratedCase; simRetries: number }
  | { ok: false; reason: Rejection; simRetries: number };

function attemptCase(
  rng: RNG,
  id: CaseId,
  preset: Preset,
  attempt: number,
  opts: GenerateOptions,
): Attempt {
  const fail = (reason: Rejection, simRetries = 0): Attempt => ({
    ok: false,
    reason,
    simRetries,
  });

  const plan = buildFloorPlan(rng, {
    rooms: preset.rooms,
    outdoor: preset.outdoor,
  });
  const rules = drawCaseRules(
    rng,
    plan,
    preset.suspects,
    preset.slots,
    RULE_BUDGETS[preset.name],
  );
  const range = murderRange(preset.slots);
  const truth = simulateTruth(
    rng,
    {
      plan,
      rules,
      suspects: preset.suspects,
      slots: preset.slots,
      lying: preset.lying,
    },
    { murderSlotRange: range },
  );
  if (!truth) return fail("simulation");
  const { frame, world } = truth;
  const simRetries = truth.retries;

  const { opening, pool, nextId } = enumerateClues(frame, world, {
    murderSlotRange: range,
  });

  // The case file must not answer the case. It is drawn blind, before the
  // murder room exists, so a room bar can land on `r*` and clear everybody
  // who could not have been there — which would hand over the culprit before
  // the player had done anything at all.
  if (solve(frame, opening, { record: false }).finished) {
    return fail("opening-solves", simRetries);
  }

  const alibi = preset.lying
    ? inventAlibi(rng, frame, world, opening, pool, nextId, {
        frameInnocent: true,
      })
    : null;
  const told = tellStory(pool, alibi);

  const tuning = PRESET_TUNING[preset.name];
  const chosen = select(rng, frame, opening, told, {
    cap: preset.tier.max,
    scale: opts.select?.scale ?? tuning.scale,
    weights: opts.select?.weights ?? tuning.weights,
    include: alibi?.lies,
  });
  if (typeof chosen === "string") return fail(chosen, simRetries);
  if (!acceptsTier(preset, chosen.tier)) return fail("tier", simRetries);

  // Tier 3 asks whether everybody it supposes innocent has spoken at all
  // (`tier3.ts#allSpeak`). A lying case whose killer says nothing can never
  // reach the trust tier, whatever the preset asked for.
  if (preset.lying && !culpritSpeaks(chosen.essential, world.culprit)) {
    return fail("mute-culprit", simRetries);
  }

  // The second certificate, from the independent solver (invariant 2).
  const truthAnswer: Answer = { culprit: world.culprit, slot: world.murderSlot };
  const proofCheck = certify(frame, chosen.clues, truthAnswer);
  if (proofCheck !== null) {
    if (proofCheck === "unfair") {
      opts.onAssertionFailure?.(
        "unfair",
        `the proof set of ${id.seed}:${attempt} does not have the truth as its only answer`,
      );
    }
    return fail(proofCheck, simRetries);
  }

  const bank = buildBank(rng, frame, world, chosen.essential, told);
  const held = [...opening, ...allCards(bank)];

  // Invariant 7, checked rather than argued: the full bank must leave the
  // case fair. It costs one oracle call, and the bank is what the player
  // actually holds, so this is the fairness check that matters most.
  const bankCheck = certify(frame, held, truthAnswer);
  if (bankCheck !== null) {
    if (bankCheck === "unfair") {
      opts.onAssertionFailure?.(
        "unfair",
        `the full bank of ${id.seed}:${attempt} does not have the truth as its only answer`,
      );
    }
    return fail(bankCheck, simRetries);
  }

  const playTier = solve(frame, held, { record: false }).tier;
  if (playTier < preset.tier.min) return fail("play-tier", simRetries);

  // Rule 7's promise, checked rather than attempted. `buildBank` does its
  // best to give the killer a voice; this asks whether it managed, because a
  // best effort that reports nothing is a best effort nothing can act on.
  const legible = silenceLeaks(frame, world, bank);
  if (legible.length > 0) return fail("legible-silence", simRetries);
  // The same leak's other face: no card can place the killer at the murder
  // hour, so if every other suspect has one, the blank row is the answer.
  if (placementLeaks(frame, world, bank).length > 0) {
    return fail("legible-gap", simRetries);
  }

  const investigation = planInvestigation(frame, chosen.essential, chosen.steps);
  // Asked of the BANK, which is what actually hands cards over. Asking the
  // investigation plan would be asking a list built from `essential` whether
  // it contains `essential`, which it always does — the guard was a tautology
  // and could not have fired whatever the bank did.
  const missing = reachable(bank, chosen.essential);
  if (missing.length > 0) {
    opts.onAssertionFailure?.(
      "unreachable",
      `${missing.length} essential card(s) of ${id.seed}:${attempt} are released by no action`,
    );
    return fail("unreachable", simRetries);
  }

  return {
    ok: true,
    simRetries,
    case: {
      id,
      frame,
      world,
      opening,
      essential: chosen.essential,
      clues: chosen.clues,
      bank,
      investigation,
      tier: chosen.tier,
      playTier,
      difficulty: difficultyForTier(playTier),
      trace: investigation.trace,
      alibi,
      answer: truthAnswer,
      attempt,
    },
  };
}

/**
 * Ask the oracle whether this clue set has exactly the true answer.
 *
 * Returns null when it does. `answers` throws when it exhausts its node
 * limit, and that is **not** a fairness failure: `exhaustive.ts` says so
 * itself — a clue set whose unsatisfiability is a counting argument has to be
 * enumerated. Such a set is too hard to certify rather than wrong, so it is
 * reported separately and the attempt is simply thrown back.
 */
function certify(
  frame: CaseFrame,
  clues: readonly Clue[],
  truth: Answer,
): "unfair" | "oracle-limit" | null {
  let found;
  try {
    found = answers(frame, clues);
  } catch {
    return "oracle-limit";
  }
  if (found.length !== 1) return "unfair";
  return answerKey(found[0]) === answerKey(truth) ? null : "unfair";
}
