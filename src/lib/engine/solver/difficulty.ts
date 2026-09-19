/**
 * What the four preset names mean: a shape to generate, and a band of solver
 * tiers the result has to land in.
 *
 * **The actual tier is authoritative**, as in Signpost. A preset is a request,
 * not a promise: asking for Expert may legitimately hand back a Hard case,
 * and what the UI shows is what the solver actually needed, never what was
 * asked for. Anything else would be the game lying to the player about how
 * clever they had just been.
 *
 * Every number here is a **starting point**, to be replaced from the `npm run
 * sim` table in wave 3 and recorded in ARCHITECTURE.md. They are written down
 * now so the generator has something to aim at, not because they are right.
 */

import { MAX_TIER } from "./solve";
import type { PresetName } from "../types";

/** The size of a case, as the generator needs it. */
export interface PresetShape {
  suspects: number;
  rooms: number;
  slots: number;
  /** Whether the culprit's testimony may be false (rule 7). */
  lying: boolean;
  /** Whether the house gets a terrace, garden or courtyard. */
  outdoor: boolean;
}

export interface Preset extends PresetShape {
  name: PresetName;
  /**
   * The tier band a generated case must land in.
   *
   * `max` is also the cap the selection loop solves with, so that a case
   * cannot be kept on the strength of reasoning the preset does not allow.
   * `min` is the floor below which the case is thrown back: a Hard case that
   * falls to tier 1 is an Easy case wearing the wrong label, and the retry is
   * cheap.
   */
  tier: { min: number; max: number };
}

/**
 * Easy 4/5/5, Normal 5/6/6, Hard 5/7/7 with lying, Expert 6/8/8 with lying —
 * the plan's starting table. The bands overlap by one tier on purpose, which
 * is what lets an Expert request settle for a Hard case rather than retrying
 * until the seed space runs dry.
 */
export const PRESETS: Readonly<Record<PresetName, Preset>> = {
  easy: {
    name: "easy",
    suspects: 4,
    rooms: 5,
    slots: 5,
    lying: false,
    outdoor: false,
    tier: { min: 0, max: 1 },
  },
  normal: {
    name: "normal",
    suspects: 5,
    rooms: 6,
    slots: 6,
    lying: false,
    outdoor: true,
    tier: { min: 1, max: 2 },
  },
  hard: {
    name: "hard",
    suspects: 5,
    rooms: 7,
    slots: 7,
    lying: true,
    outdoor: true,
    tier: { min: 2, max: 3 },
  },
  expert: {
    name: "expert",
    suspects: 6,
    rooms: 8,
    slots: 8,
    lying: true,
    outdoor: true,
    tier: { min: 3, max: 4 },
  },
};

export const PRESET_NAMES: readonly PresetName[] = [
  "easy",
  "normal",
  "hard",
  "expert",
];

export function presetFor(name: PresetName): Preset {
  return PRESETS[name];
}

/**
 * The name for a tier the solver actually reported: Easy ≤ 1, Normal 2,
 * Hard 3, Expert 4.
 *
 * Total, including the -1 a case nothing could be deduced from reports. Such
 * a case is never shipped — the generator rejects anything that does not
 * finish — but a hint panel may well ask this question mid-game, when the
 * player's collected cards say nothing yet, and it must get an answer.
 */
export function difficultyForTier(tier: number): PresetName {
  if (tier <= 1) return "easy";
  if (tier === 2) return "normal";
  if (tier === 3) return "hard";
  return "expert";
}

/** Does a solved case meet what the preset asked for? */
export function acceptsTier(preset: Preset, tier: number): boolean {
  return tier >= preset.tier.min && tier <= Math.min(preset.tier.max, MAX_TIER);
}

/** The title-case name for a heading. The only place these are spelled. */
const LABELS: Readonly<Record<PresetName, string>> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  expert: "Expert",
};

export function difficultyLabel(name: PresetName): string {
  return LABELS[name];
}
