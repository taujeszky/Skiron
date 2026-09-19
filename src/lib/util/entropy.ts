/**
 * The only place in the app that asks for randomness the engine did not
 * produce.
 *
 * It sits outside `engine/` deliberately. The engine's determinism guarantee
 * — same case ID, byte-identical case — is only as good as the rule that
 * nothing under `engine/` reaches for entropy, and a rule with one blessed
 * exception in it is a rule nobody can test. `engine.purity.test.ts` asserts
 * the absolute version instead, and this module is where the exception lives.
 */

import { CASE_ID_VERSION, type CaseId } from "$lib/engine/caseId";
import type { PresetName } from "$lib/engine/types";

/** A short random seed string (base36), at most 10 characters. */
export function randomSeed(): string {
  const n =
    Math.floor(Math.random() * 0x100000000) * 0x10000 +
    Math.floor(Math.random() * 0x10000);
  return n.toString(36);
}

/** A fresh case ID for "new case" in the UI and for the authoring CLI. */
export function randomCaseId(preset: PresetName): CaseId {
  return { version: CASE_ID_VERSION, preset, seed: randomSeed() };
}
