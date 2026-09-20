/**
 * A player, scripted.
 *
 * Two of them, and the difference between them is the point.
 *
 * The **oracle player** does exactly what `hint()` says, which means it is
 * handed the case's `essential` list and never wastes a move. Wave 3 already
 * has that one, in `generator.test.ts`, and it answers "is this case
 * playable at all".
 *
 * The **blind player** here is the interesting one. It never looks at
 * `essential`, at `investigation.actions`, or at the truth. It reasons from
 * the cards it holds, sees which cells are still open, and asks the question
 * that bears on the most of them — a heuristic a person could actually
 * follow, applied without knowing which questions the proof needs. That it
 * reaches the answer at all is a guard on the *bank* rather than on the
 * hints: a case can be perfectly fair and still be one where the only route
 * through is the one the generator had in mind, and no test before this one
 * could tell the difference.
 *
 * It is also what **par** is fitted to (`investigation.ts` calls par a
 * starting point twice over, and this is the second half of that debt paid).
 * The count of essential actions is the shortest route; par should be what an
 * undirected but sensible player spends, and that is a number nobody could
 * write down before a player loop existed.
 *
 * Deterministic throughout: ties break on the action key, so the same case
 * plays the same way every time and a regression in the bank shows up as a
 * changed number rather than as flakiness.
 */

import { bitsOf, fullMask, onlyBit } from "$lib/engine/bits";
import { clueMentions } from "$lib/engine/clues";
import { ask, examine } from "$lib/engine/generator/bank";
import type { GeneratedCase } from "$lib/engine/generator/generate";
import { newNotebook } from "$lib/engine/solver/hint";
import { solve } from "$lib/engine/solver/solve";
import { topic } from "$lib/engine/types";
import type {
  Answer,
  CaseFrame,
  Clue,
  ClueId,
  PersonId,
  RoomId,
  TopicKey,
} from "$lib/engine/types";
import { notebookAnswer } from "./errors";
import { applyConclusion, cloneNotebook } from "./notebook";
import type { Notebook } from "./notebook";
import { askKey, examineKey } from "./types";

export interface PlayRecord {
  /** Distinct actions taken, in order. */
  actions: string[];
  /** How many of them released a card the player did not already hold. */
  productive: number;
  cards: Clue[];
  notebook: Notebook;
  /** The pair the notebook settled on, if it settled. */
  answer: Answer | null;
  /** The notebook settled, and on the truth. */
  solved: boolean;
  /** It ran out of actions to take without settling. */
  stuck: boolean;
}

export interface PlayOptions {
  /**
   * The hardest reasoning the player is allowed. Defaults to the case's
   * `playTier`, which is the grade the player is shown and therefore the one
   * they have signed up for.
   */
  maxTier?: number;
  /** Safety stop. The action space is finite, so this only catches bugs. */
  maxActions?: number;
  /**
   * How hard to follow up what the held cards mention — the plan's "deduce,
   * then aim the next question". See `DEFAULT_LEAD_WEIGHT`.
   */
  leadWeight?: number;
  /**
   * How the next question is chosen. `"open-cells"` is the heuristic this
   * file is about; `"sweep"` simply walks the menu in order.
   *
   * The sweep is the baseline, and it is here because a mutation pass found
   * that gutting the heuristic left every test green — a player who asks
   * everything in order also solves every case, just slowly. Par is anchored
   * on this player, so "the heuristic is worth having" has to be a number
   * somebody can check rather than a thing the file asserts about itself.
   */
  strategy?: "open-cells" | "sweep";
}

/**
 * Zero, and that is a measurement rather than an omission.
 *
 * The plan describes the intended loop as "deduce, then aim the next
 * question", with "somebody was in the library at nine" telling you what to
 * ask about. Taken literally — score a question up for every held card that
 * mentions its room, slot or person — it makes the player **worse**, and
 * monotonically so. Over 40 cases a preset, mean actions spent:
 *
 * ```
 * lead weight   easy  normal  hard  expert
 *           0   19.2    31.1  38.1    57.0
 *           1   21.5    33.7  42.7    60.9
 *           3   33.8    49.0  46.9    63.9
 *           8   46.5    63.8  70.6    83.6
 * ```
 *
 * The reason is plain once seen: a card mentions ground you have already
 * covered. Chasing it walks you back over what you know, while the open-cell
 * score walks you towards what you do not. The useful reading of "aim the
 * next question" is aim at what is still open — and a card helps with that
 * only through what it closes, which the reasoning step has already done by
 * the time the question is chosen.
 *
 * The option stays so the claim stays checkable. Wave 6's free-text
 * interrogation is where it is worth revisiting, because a person following
 * up a lead is also following up a *sentence*, and this player cannot read.
 */
export const DEFAULT_LEAD_WEIGHT = 0;

/** Every action the interface offers, in a stable order. */
export function everyAction(frame: CaseFrame): { key: string; topic: TopicKey; ask: PersonId | null }[] {
  const out: { key: string; topic: TopicKey; ask: PersonId | null }[] = [];
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    out.push({ key: examineKey(r), topic: topic.room(r), ask: null });
  }
  for (let s = 0; s < frame.suspects; s++) {
    for (let t = 0; t < frame.slots; t++) {
      out.push({ key: askKey(s, topic.slot(t)), topic: topic.slot(t), ask: s });
    }
    for (let p = 0; p < frame.people; p++) {
      if (p === s) continue;
      out.push({ key: askKey(s, topic.person(p)), topic: topic.person(p), ask: s });
    }
    for (let r = 0; r < frame.plan.rooms.length; r++) {
      out.push({ key: askKey(s, topic.room(r)), topic: topic.room(r), ask: s });
    }
    out.push({ key: askKey(s, topic.motive), topic: topic.motive, ask: s });
  }
  return out;
}

export function blindPlay(c: GeneratedCase, opts: PlayOptions = {}): PlayRecord {
  const frame = c.frame;
  const maxTier = opts.maxTier ?? c.playTier;
  const menu = everyAction(frame);
  const limit = opts.maxActions ?? menu.length;
  const lead = opts.leadWeight ?? DEFAULT_LEAD_WEIGHT;

  let notebook = newNotebook(frame);
  const cards: Clue[] = [...c.opening];
  const held = new Set<ClueId>(cards.map((k) => k.id));
  const taken = new Set<string>();
  const actions: string[] = [];
  let productive = 0;

  for (;;) {
    notebook = reason(frame, cards, notebook, maxTier);
    const answer = notebookAnswer(frame, notebook);
    if (answer !== null) {
      return {
        actions,
        productive,
        cards,
        notebook,
        answer,
        solved:
          answer.culprit === c.world.culprit && answer.slot === c.world.murderSlot,
        stuck: false,
      };
    }
    if (actions.length >= limit) break;

    const next = bestAction(
      frame,
      notebook,
      menu,
      taken,
      leads(frame, cards),
      lead,
      opts.strategy ?? "open-cells",
    );
    if (next === null) break;
    taken.add(next.key);
    actions.push(next.key);

    const got =
      next.ask === null
        ? examine(c.bank, roomOf(next.topic))
        : ask(c.bank, next.ask, next.topic);
    let gained = false;
    for (const id of got) {
      if (held.has(id)) continue;
      const card = c.bank.cards.get(id);
      if (!card) continue;
      held.add(id);
      cards.push(card);
      gained = true;
    }
    if (gained) productive++;
  }

  return {
    actions,
    productive,
    cards,
    notebook,
    answer: notebookAnswer(frame, notebook),
    solved: false,
    stuck: true,
  };
}

/* ----------------------------------------------------------- the reasoning */

/**
 * Write down everything the held cards support, up to the tier cap.
 *
 * Every step, not the cheapest one: this is a player at a table with all
 * their cards in front of them, not a hint panel doling out one deduction at
 * a time.
 */
function reason(
  frame: CaseFrame,
  cards: readonly Clue[],
  n: Notebook,
  maxTier: number,
): Notebook {
  let out = cloneNotebook(n);
  const result = solve(frame, cards, { maxTier });
  for (const step of result.steps) out = applyConclusion(frame, out, step.conclusion);
  return out;
}

/* ------------------------------------------------------------ the choosing */

/**
 * The untaken action that bears on the most open cells.
 *
 * "Bears on" is read off the topic, which is all the player can see before
 * asking: a question about an hour is about that column, a question about a
 * person is about their row, and a room — asked about or searched — is about
 * every cell that still allows it. The motive scores nothing structural and
 * so falls to the bottom, which is where a player would leave it too.
 *
 * A settled cell counts for nothing, so the score falls as the grid fills and
 * the player drifts towards whatever is still vague. Ties go to the earlier
 * key, which makes the whole run reproducible.
 */
function bestAction(
  frame: CaseFrame,
  n: Notebook,
  menu: readonly { key: string; topic: TopicKey; ask: PersonId | null }[],
  taken: ReadonlySet<string>,
  mentioned: ReadonlyMap<TopicKey, number>,
  leadWeight: number,
  strategy: "open-cells" | "sweep",
): { key: string; topic: TopicKey; ask: PersonId | null } | null {
  if (strategy === "sweep") return menu.find((a) => !taken.has(a.key)) ?? null;

  const all = fullMask(frame.plan.rooms.length);
  const open: number[][] = [];
  for (let p = 0; p < frame.people; p++) {
    open.push([]);
    for (let t = 0; t < frame.slots; t++) {
      const mask = all & ~n.ruledOut[p][t];
      open[p].push(onlyBit(mask) >= 0 ? 0 : mask);
    }
  }

  let best: { key: string; topic: TopicKey; ask: PersonId | null } | null = null;
  let bestScore = -1;
  for (const action of menu) {
    if (taken.has(action.key)) continue;
    const score =
      topicScore(frame, open, action.topic) +
      leadWeight * (mentioned.get(action.topic) ?? 0);
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return best;
}

/**
 * What the cards in hand point at, counted per topic.
 *
 * This is the "aim the next question" half of the loop, and it is the only
 * part of the blind player that reads a card's *content* rather than the
 * shape of the grid. A card is a lead about the rooms, slots and people it
 * names, whatever it says about them.
 */
function leads(frame: CaseFrame, cards: readonly Clue[]): Map<TopicKey, number> {
  const out = new Map<TopicKey, number>();
  const bump = (k: TopicKey) => out.set(k, (out.get(k) ?? 0) + 1);
  for (const card of cards) {
    const m = clueMentions(card.body, frame);
    for (const r of m.rooms) bump(topic.room(r));
    for (const t of m.slots) bump(topic.slot(t));
    for (const p of m.people) bump(topic.person(p));
  }
  return out;
}

function topicScore(frame: CaseFrame, open: number[][], key: TopicKey): number {
  if (key === topic.motive) return 0;
  const n = Number(key.slice(key.indexOf(":") + 1));
  let score = 0;
  if (key.startsWith("slot:")) {
    for (let p = 0; p < frame.people; p++) if (open[p][n] !== 0) score++;
    return score;
  }
  if (key.startsWith("person:")) {
    for (let t = 0; t < frame.slots; t++) if (open[n][t] !== 0) score++;
    return score;
  }
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t < frame.slots; t++) {
      if ((open[p][t] & (1 << n)) !== 0) score++;
    }
  }
  return score;
}

function roomOf(key: TopicKey): RoomId {
  return Number(key.slice(5));
}

/** For a caller that wants the open cells without a notebook of its own. */
export function openCells(frame: CaseFrame, n: Notebook): { p: PersonId; t: number }[] {
  const all = fullMask(frame.plan.rooms.length);
  const out: { p: PersonId; t: number }[] = [];
  for (let p = 0; p < frame.people; p++) {
    for (let t = 0; t < frame.slots; t++) {
      if (bitsOf(all & ~n.ruledOut[p][t]).length > 1) out.push({ p, t });
    }
  }
  return out;
}
