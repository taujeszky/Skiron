/**
 * Tier 1 — movement.
 *
 * Arc consistency along each person's timeline, in both directions, over the
 * movement table the axioms derive (`movementMasks`, which already folds in
 * door closures, door bars and room bars).
 *
 * There is deliberately no separate rule for multi-slot consequences. "She
 * could not have reached the cellar and been back by ten" is what repeating
 * these two passes to a fixpoint says; writing a bespoke rule for it would be
 * a second, weaker implementation of the same thing.
 *
 * SOUNDNESS is the easiest in the solver to see: a room survives the forward
 * pass only if some room in the previous slot's domain can reach it, and the
 * backward pass only if it can reach some room in the next slot's domain.
 * A world that used a removed room would have to have used a move the
 * movement table forbids, and the table is `canMove` (see axioms.ts).
 */

import { bitsOf } from "../../bits";
import type { Deduction } from "../state";
import { didChange, restrict } from "../state";

export const TIER = 1;

export function tier1(d: Deduction): boolean {
  return didChange(d, () => {
    const { frame, moves } = d.ctx;
    const T = frame.slots;

    for (let p = 0; p < frame.people; p++) {
      // forward: where could p be at t+1, given where p could be at t
      for (let t = 0; t + 1 < T; t++) {
        let reach = 0;
        for (const r of bitsOf(d.state.dom[p][t])) reach |= moves[p][t][r];
        if (
          restrict(d, p, t + 1, reach, "reach-forward", TIER, {
            clues: [],
            cells: [{ p, t }],
          })
        ) {
          if (d.state.contradiction) return;
        }
      }
      // backward: a room at t is only possible if it leads somewhere at t+1
      for (let t = T - 2; t >= 0; t--) {
        let keep = 0;
        const next = d.state.dom[p][t + 1];
        for (const r of bitsOf(d.state.dom[p][t])) {
          if ((moves[p][t][r] & next) !== 0) keep |= 1 << r;
        }
        if (
          restrict(d, p, t, keep, "reach-backward", TIER, {
            clues: [],
            cells: [{ p, t: t + 1 }],
          })
        ) {
          if (d.state.contradiction) return;
        }
      }
    }
  });
}
