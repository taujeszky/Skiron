/**
 * Tier 3 — trust. Lying cases only.
 *
 * Rule 7 says innocents never lie, and read backwards that is an accusation:
 * if believing somebody leads nowhere, they were not telling the truth, and
 * only the killer lies. Both rules here are that thought, once for a single
 * suspect and once for a pair.
 *
 *  - **Self-incrimination.** Suppose `s` is innocent. Then `s`'s testimony is
 *    true and may be used alongside the facts. If that cannot be squared with
 *    the rest of the notebook, `s` is not innocent — so `s` did it.
 *  - **Conflict pair.** Suppose `s1` and `s2` are both innocent. Then both
 *    their accounts are true at once. If those two stories cannot both stand,
 *    one of the two did it, and everybody else is in the clear.
 *
 * Both rules require everybody they suppose innocent to have actually said
 * something. That is not decoration: without it the murder axioms alone can
 * refute an innocence on a notebook holding no statements at all, and the
 * case would be graded Hard for a matter of trust in which nobody spoke.
 *
 * Both are bounded scratch runs on tiers 0 to 2 (`branch` then
 * `runToFixpoint(b, 2)`), so this tier never recurses into itself or into
 * tier 4. They are a named special case of tier 4's hypothesis search, pulled
 * out and given their own tier because "his story cannot be true, so he is
 * lying, so he did it" is how a person actually reasons — and because it is
 * far cheaper than a general trial: the hypothesis is one word.
 *
 * **Why the hypothesis is just `answer[s] = 0`.** Trust is derived from the
 * candidate set (`trustedMask` in state.ts): clearing a suspect *is* trusting
 * them. So assuming `s` innocent and assuming `s`'s testimony true are the
 * same edit to the state, and there is no second structure to keep in step.
 *
 * SOUNDNESS. The branch starts from a state whose surviving pairs include
 * every answer consistent with the clues, minus the ones this hypothesis
 * excludes. Every rule it then runs is sound, so a contradiction means no
 * consistent world satisfies the hypothesis. Refuting "`s` is innocent"
 * therefore leaves "`s` is the culprit" true in every consistent world, and
 * refuting "neither did it" leaves "one of them did".
 *
 * **Lying off, and why this tier sits it out.** With lying off everyone is
 * trusted from the start, so supposing somebody innocent adds no card — it
 * only narrows the answer set, which is tier 4's job and tier 4's grade. A
 * case without lying must never be graded Hard for a trust rule it could not
 * have used, so the tier returns at once.
 */

import { bit, bitsOf } from "../../bits";
import type { PersonId } from "../../types";
import type { Deduction, Premises } from "../state";
import {
  branch,
  clearSuspects,
  culpritMask,
  didChange,
  pairCount,
} from "../state";
import { runToFixpoint } from "../solve";

export const TIER = 3;

export function tier3(d: Deduction): boolean {
  return didChange(d, () => {
    if (!d.ctx.frame.lying) return;
    const suspects = bitsOf(culpritMask(d.state));
    // With one candidate left there is nothing to learn, and no pair to form.
    if (suspects.length < 2) return;

    for (const s of suspects) {
      if (!refuted(d, [s])) continue;
      // Nobody else can have done it: s is the only one whose account fails.
      clearSuspects(d, d.ctx.allSuspects & ~bit(s), "self-incrimination", TIER, {
        clues: [],
        cells: [],
        assumedInnocent: [s],
      });
      return;
    }

    for (let i = 0; i < suspects.length; i++) {
      for (let j = i + 1; j < suspects.length; j++) {
        const two = [suspects[i], suspects[j]];
        if (!refuted(d, two)) continue;
        clearSuspects(
          d,
          d.ctx.allSuspects & ~bit(two[0]) & ~bit(two[1]),
          "conflict-pair",
          TIER,
          { clues: [], cells: [], assumedInnocent: two } satisfies Premises,
        );
        return;
      }
    }
  });
}

/**
 * Is "none of `who` is the culprit" impossible?
 *
 * Note what this does and does not establish, because a review caught the
 * difference and it is worth keeping straight. Supposing `s` innocent does
 * two things at once, since trust is derived from the candidate set: it
 * believes `s`, and it also takes `s` out of the answer. A contradiction may
 * come from either, so what is proved is exactly "`s` cannot have been
 * innocent" — not "`s` lied". The sentences in `explain.ts` say the first,
 * which is true whichever of the two did the work.
 *
 * What the tier *is* entitled to claim is that this is reasoning about
 * testimony at all, and that is what `allSpeak` insists on. Without it the
 * murder axioms alone can refute an innocence on a notebook holding no
 * statements whatever, and the case would be graded Hard for a matter of
 * trust in which nobody had spoken.
 *
 * `pairCount === 0` returns false rather than true: an assumption that empties
 * the candidate set by itself has been refuted by nothing. It only says these
 * suspects were the last ones standing, which the state already knew.
 */
function refuted(d: Deduction, who: PersonId[]): boolean {
  if (!allSpeak(d, who)) return false;
  const b = branch(d);
  for (const s of who) b.state.answer[s] = 0;
  if (pairCount(b.state) === 0) return false;
  runToFixpoint(b, TIER - 1);
  d.nodes = b.nodes;
  return b.state.contradiction;
}

/** Has every one of them put a statement in front of the player? */
function allSpeak(d: Deduction, who: readonly PersonId[]): boolean {
  return who.every((s) =>
    d.ctx.clues.some(
      (c) => c.source.kind === "testimony" && c.source.speaker === s,
    ),
  );
}
