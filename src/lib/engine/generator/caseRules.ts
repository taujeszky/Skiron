/**
 * The case file: the locked doors, the barred guests and the small rooms.
 *
 * **These are drawn before the evening is simulated, not after it.** The plan
 * put them in `enumerate.ts`, alongside everything else that is true of the
 * world, and that would have worked — one can always pick a door nobody
 * happened to use and declare it locked. It would also have leaked the
 * answer. A rule chosen to fit the truth is a *function* of the truth, and a
 * player who knew how the generator worked could read it backwards: a
 * capacity of two means some room really did hold two, a closure means that
 * door really was unused. Drawn first, a rule is independent of the evening
 * and says exactly what it says. `simulateTruth` already takes `rules` on its
 * request and walks everybody inside them (`roomAllowance`, `movementMasks`),
 * so the cost of doing it in this order is only that a harsh draw makes the
 * simulation retry, which the sim table counts.
 *
 * Every number below is a **starting point** to be replaced from the `npm run
 * sim` table, as CLAUDE.md requires. They are deliberately timid: a case file
 * that strangles the house makes the truth simulation fail, and a failed
 * simulation costs a whole attempt.
 */

import { bit } from "../bits";
import { RNG } from "../rng";
import { noRules } from "../types";
import type {
  CaseRules,
  DoorId,
  FloorPlan,
  PersonId,
  PresetName,
  RoomId,
} from "../types";

export interface RuleBudget {
  closures: number;
  doorBars: number;
  roomBars: number;
  capacities: number;
}

/**
 * What each preset's case file holds, as a starting point.
 *
 * Easy gets none at all: a first case should be about where people were, not
 * about the house's own rules. The others get a little more as they go up,
 * and never enough to strand anybody. These are the numbers task 10 tunes.
 */
export const RULE_BUDGETS: Readonly<Record<PresetName, RuleBudget>> = {
  easy: { closures: 0, doorBars: 0, roomBars: 0, capacities: 0 },
  normal: { closures: 1, doorBars: 0, roomBars: 0, capacities: 1 },
  hard: { closures: 1, doorBars: 1, roomBars: 1, capacities: 1 },
  expert: { closures: 2, doorBars: 1, roomBars: 1, capacities: 2 },
};

/**
 * Draw a case file for a house.
 *
 * It is given the plan and the cast size and nothing else — no world, because
 * there is not one yet. That is the point of the module.
 */
export function drawCaseRules(
  rng: RNG,
  plan: FloorPlan,
  suspects: number,
  slots: number,
  budget: RuleBudget,
): CaseRules {
  const rules = noRules();
  const n = plan.rooms.length;

  // A door locked for part of the evening. Never for all of it: a door shut
  // from the first transition to the last is not a rule of the evening, it is
  // a wall, and the floor plan should have said so. Leaving one transition
  // open also keeps the house connected in the eyes of anybody reading the
  // map, which matters because the map is drawn from the same data.
  const transitions = slots - 1;
  const maxSpan = Math.max(1, Math.floor(transitions / 2));
  const doorsLeft = rng.shuffle(plan.doors.map((d) => d.id));
  for (let i = 0; i < budget.closures && doorsLeft.length > 0; i++) {
    const door = doorsLeft.pop() as DoorId;
    const span = 1 + rng.int(maxSpan);
    const from = rng.int(transitions - span + 1);
    rules.closures.push({ door, from, to: from + span });
  }

  // A guest who never uses a door. Only suspects: the victim's walk is the
  // most constrained in the house — it has to end somewhere the killer can
  // reach — and barring them is the quickest way to make every attempt fail.
  const barred = new Set<string>();
  for (let i = 0; i < budget.doorBars; i++) {
    const person = rng.int(suspects);
    const door = rng.pick(plan.doors).id;
    // A person barred from every door out of the room they start in is a
    // person who cannot move at all, which is a dull alibi and a hard walk.
    if (strandsSomebody(plan, rules, person, door)) continue;
    const key = `d${person}:${door}`;
    if (barred.has(key)) continue;
    barred.add(key);
    rules.doorBars.push({ person, door });
  }

  // A guest who never enters a room. Only suspects again, and never the same
  // guest twice: two closed rooms is most of a small house.
  const roomBarred = new Set<PersonId>();
  for (let i = 0; i < budget.roomBars; i++) {
    const person = rng.int(suspects);
    if (roomBarred.has(person)) continue;
    const room = rng.int(n);
    roomBarred.add(person);
    rules.roomBars.push({ person, room });
  }

  // A room that holds only so many. At least two, because a cap of one is
  // `BarredRoom` for everybody in turn and would make the murder room — which
  // the generator has not chosen yet — unusable.
  const people = suspects + 1;
  const capped = new Set<RoomId>();
  for (let i = 0; i < budget.capacities; i++) {
    const room = rng.int(n);
    if (capped.has(room)) continue;
    capped.add(room);
    const max = 2 + rng.int(Math.max(1, people - 3));
    rules.capacities.push({ room, max });
  }

  return rules;
}

/**
 * Would barring `person` from `door` leave some room with no way out for
 * them at all?
 *
 * A guest who cannot leave the room they woke up in has no timeline worth
 * deducing, and the truth simulation has to find them a walk regardless. This
 * is a cheap structural check rather than a reachability proof: it asks only
 * that every room keep at least one door this person may still use, which is
 * enough to stop the obvious disaster in a house whose plan is connected.
 */
function strandsSomebody(
  plan: FloorPlan,
  rules: CaseRules,
  person: PersonId,
  door: DoorId,
): boolean {
  const blocked = new Set<DoorId>([door]);
  for (const b of rules.doorBars) {
    if (b.person === person) blocked.add(b.door);
  }
  for (let r = 0; r < plan.rooms.length; r++) {
    const open = plan.doorsFrom[r].filter((e) => !blocked.has(e));
    if (open.length === 0) return true;
  }
  return false;
}

/**
 * Do these rules leave every room reachable from every other, with all the
 * doors that are ever open?
 *
 * Only a sanity check on the draw: `planConnected` already holds of the plan
 * itself, and a closure is temporary, so this can only fail on a draw that
 * bars so many doors that the house falls in two.
 */
export function rulesKeepHouseWhole(
  plan: FloorPlan,
  rules: CaseRules,
  person: PersonId,
): boolean {
  const n = plan.rooms.length;
  const blocked = new Set<DoorId>();
  for (const b of rules.doorBars) if (b.person === person) blocked.add(b.door);
  const off = new Set<RoomId>();
  for (const b of rules.roomBars) if (b.person === person) off.add(b.room);

  let reach = 0;
  let start = -1;
  for (let r = 0; r < n; r++) {
    if (!off.has(r)) {
      start = r;
      break;
    }
  }
  if (start < 0) return false;
  const stack: RoomId[] = [start];
  let seen = bit(start);
  while (stack.length > 0) {
    const r = stack.pop() as RoomId;
    reach++;
    for (const e of plan.doorsFrom[r]) {
      if (blocked.has(e)) continue;
      const d = plan.doors[e];
      const to = d.a === r ? d.b : d.a;
      if (off.has(to) || (seen & bit(to)) !== 0) continue;
      seen |= bit(to);
      stack.push(to);
    }
  }
  return reach === n - off.size;
}

/** How many rules a case file holds, for the sim table. */
export function ruleCount(rules: CaseRules): number {
  return (
    rules.closures.length +
    rules.doorBars.length +
    rules.roomBars.length +
    rules.capacities.length
  );
}
