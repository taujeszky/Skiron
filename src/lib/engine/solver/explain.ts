/**
 * Turning the engine's data into English: a clue as a sentence, and a
 * deduction as a sentence.
 *
 * Two jobs, and neither is decoration. `clueSentence` is the text a card
 * carries whenever no LLM prose exists for it — a case with no skin, a case
 * whose skin failed its fidelity check, a hint quoting a card — so it has to
 * read like something a person wrote. `stepSentence` is the hint system's
 * whole output, and a hint that a player cannot follow is worse than none.
 *
 * **Conclusions are data, not prose** (`Conclusion` in `state.ts`), and this
 * is the file that proves why that was worth the trouble: the same step comes
 * out as "Suspect B" with no skin and "Mrs Hale" with one, and in Hungarian
 * in wave 9, without a rule ever holding a string.
 *
 * **Everything the player sees is numbered from one.** Rooms, slots and
 * suspects are zero-based inside the engine and one-based in every sentence
 * here. A notebook that showed "slot 0" next to an hour labelled "one" would
 * make a player doubt the grid, and doubting the grid is fatal in a game
 * whose whole promise is that the grid is fair.
 *
 * The order of a sentence is conclusion first, reason second — "Mrs Hale must
 * have been in the library at nine, because Card 3 puts somebody there and
 * everyone else is accounted for elsewhere." Reason-first reads better in the
 * one example the plan gives, but it needs a pronoun before the name it
 * refers to, and across twenty-seven rules that produces sentences nobody can
 * parse. This way every rule gets the same shape and the name always comes
 * first.
 */

import { bitsOf } from "../bits";
import { template } from "../clues";
import type {
  Answer,
  CaseFrame,
  Clue,
  ClueId,
  Glossary,
  PersonId,
  SlotIndex,
} from "../types";
import type { Conclusion, Premises, Step } from "./state";

/* ---------------------------------------------------------- the glossary */

const LETTERS = "ABCDEFGH";

/**
 * Names for a case with no skin on it. Good enough to play with, and what
 * every test reads, so it is also the thing that keeps the sentences honest
 * when nobody is around to write nice ones.
 */
export function defaultGlossary(frame: CaseFrame): Glossary {
  return {
    personName: (p) =>
      p === frame.victim ? "the victim" : `Suspect ${LETTERS[p] ?? p + 1}`,
    roomName: (r) => `Room ${r + 1}`,
    roomCode: (r) => `R${r + 1}`,
    slotLabel: (t) => `slot ${t + 1}`,
  };
}

/* ------------------------------------------------------------- the clues */

/**
 * A card as a sentence. A fact states itself; a testimony is attributed, and
 * the statement inside it is in the first person, so that a suspect talking
 * about themselves is not named twice in their own words.
 */
export function clueSentence(
  frame: CaseFrame,
  clue: Clue,
  glossary: Glossary = defaultGlossary(frame),
): string {
  const speaker =
    clue.source.kind === "testimony" ? clue.source.speaker : undefined;
  const said = finish(template(clue.body, frame, glossary, speaker));
  if (speaker === undefined) return said;
  return `${glossary.personName(speaker)} says: ${said}`;
}

/* ------------------------------------------------------------- the steps */

/** Everything a step needs in order to name the things it rests on. */
export interface Explainer {
  glossary: Glossary;
  /** "Card 3" — the notebook's own numbering, which is the card list's order. */
  cardLabel(id: ClueId): string;
  clue(clue: Clue): string;
  step(step: Step): string;
}

export function explainer(
  frame: CaseFrame,
  clues: readonly Clue[],
  glossary: Glossary = defaultGlossary(frame),
): Explainer {
  const labels = new Map<ClueId, string>();
  clues.forEach((c, i) => labels.set(c.id, `Card ${i + 1}`));
  const cardLabel = (id: ClueId) => labels.get(id) ?? "a card";
  return {
    glossary,
    cardLabel,
    clue: (clue) => clueSentence(frame, clue, glossary),
    step: (step) => render(frame, step, glossary, cardLabel),
  };
}

/**
 * One deduction as a sentence. The card list is what "Card 3" is counted
 * against; pass the notebook's cards in the order it shows them.
 */
export function stepSentence(
  frame: CaseFrame,
  step: Step,
  clues: readonly Clue[] = [],
  glossary: Glossary = defaultGlossary(frame),
): string {
  return explainer(frame, clues, glossary).step(step);
}

type Label = (id: ClueId) => string;

function render(
  frame: CaseFrame,
  step: Step,
  g: Glossary,
  label: Label,
): string {
  const because = reason(frame, step, g, label);
  return finish(`${conclusion(step.conclusion, g)}, because ${because}`);
}

/* ------------------------------------------------------- the conclusions */

function conclusion(c: Conclusion, g: Glossary): string {
  switch (c.kind) {
    case "room-set":
      return `${g.personName(c.p)} must have been in ${g.roomName(c.r)} at ${g.slotLabel(c.t)}`;

    case "rooms-out":
      return `${g.personName(c.p)} was not in ${rooms(c.rooms, g)} at ${g.slotLabel(c.t)}`;

    case "cleared":
      return `${people(c.suspects, g)} ${c.suspects.length === 1 ? "is" : "are"} in the clear`;

    case "slots-out":
      return `the murder was not at ${slots(c.slots, g)}`;

    case "pairs-out":
      return pairs(c.pairs, g);

    case "contradiction":
      return "the cards cannot all be true";
  }
}

/**
 * A sweep of eliminated pairs. Grouped where it can be, because "it was not
 * Mrs Hale, at nine or at ten" is one thought and a list of pairs is not.
 */
function pairs(list: readonly Answer[], g: Glossary): string {
  if (list.length === 0) return "nothing more is ruled out";
  const culprits = [...new Set(list.map((a) => a.culprit))];
  const when = [...new Set(list.map((a) => a.slot))];
  if (culprits.length === 1) {
    return `it was not ${g.personName(culprits[0])} at ${slots(when, g)}`;
  }
  if (when.length === 1) {
    const names = [...culprits].sort((a, b) => a - b).map((p) => g.personName(p));
    return `at ${g.slotLabel(when[0])} it was none of ${orList(names)}`;
  }
  return `that rules out ${andList(
    list.map((a) => `${g.personName(a.culprit)} at ${g.slotLabel(a.slot)}`),
  )}`;
}

/* ----------------------------------------------------------- the reasons */

function reason(
  frame: CaseFrame,
  step: Step,
  g: Glossary,
  label: Label,
): string {
  const cards = cited(step.premises, label);
  const who = named(step.premises, g);
  const scene = g.roomName(frame.murderRoom);

  switch (step.rule) {
    /* tier 0 — placement */
    case "clue-at":
      return `${cards} places them there`;
    case "clue-not-at":
      return `${cards} rules that room out`;
    case "clue-stayed":
      return `${cards} has them staying put across those hours`;
    case "clue-saw":
      return `${cards} puts them both in that room`;
    case "clue-alone":
      return `${cards} gives that room to one person`;
    case "clue-empty":
      return `${cards} leaves that room empty`;
    case "clue-never-visited":
      return `${cards} keeps them out of that room altogether`;
    case "clue-alive-at":
      return `${cards} has the victim still alive then`;
    case "clue-death-window":
      return `${cards} narrows down when the murder happened`;
    case "victim-seen-alive":
      return `${cards} puts the victim in company, and so still alive`;
    case "body-at-end":
      return `the body lay in ${scene}, and was still lying there at the end of the evening`;
    case "opportunity":
      return `the killer and the victim were both in ${scene} when it happened`;
    case "witness-in-room":
      return `${who} can only have been in ${scene} then, and the one living soul in that room was the killer`;
    case "sealed-after":
      return `${who} was in ${scene}, and after the murder nobody but the killer was`;
    case "sealed-back":
      return `the murder had certainly happened by then, and from then on ${scene} held nobody but the body and the killer`;
    case "victim-not-yet-dead":
      return `the victim was not yet in ${scene}`;

    /* tier 1 — movement */
    case "reach-forward":
      return "there is no way through the house from where they were the hour before";
    case "reach-backward":
      return "no door leads from there to where they were the hour after";

    /* tier 2 — counting */
    case "occupied-last-one":
      return `${cards} puts somebody in that room, and everyone else is accounted for elsewhere`;
    case "count-exact":
      return `${cards} fixes how many were in that room, and the count only works one way`;
    case "count-capacity":
      return "the room was already holding as many as it can";
    case "visited-last-slot":
      return `${cards} has them in that room at some point, and only one hour is left for it`;
    case "together-same-room":
      return `${cards} has them together, and two people together are in one room`;

    /* tier 3 — trust */
    case "self-incrimination":
      return `${supposed(step.premises, g)} cannot be telling the truth, and only the killer lies`;
    case "conflict-pair":
      return `${supposed(step.premises, g)} cannot both be telling the truth, and only the killer lies`;

    /* tier 4 — hypothesis */
    case "trial-culprit":
    case "trial-slot":
    case "trial-pair":
      return `supposing ${hypothesis(step, g)} leaves nothing that fits`;

    default: {
      // The closed `RuleId` union makes this a compile error the moment a
      // rule arrives without a sentence, which is the point of closing it.
      const missing: never = step.rule;
      throw new Error(`no sentence written for rule ${String(missing)}`);
    }
  }
}

/** "Card 3", "Cards 3 and 5", or the case file when a rule rests on no card. */
function cited(premises: Premises, label: Label): string {
  const ids = premises.clues;
  if (ids.length === 0) return "the case file";
  const names = ids.map(label);
  // Every label starts with the same word, so say it once — "Cards 3 and 5",
  // not "Card 3 and Card 5". Only when they all do: a card the notebook does
  // not hold falls back to a label with no number in it, and "Card a card"
  // is exactly the sort of sentence this file exists to prevent.
  const numbers = names.map((n) => /^Card (.+)$/.exec(n)?.[1]);
  if (numbers.every((n) => n !== undefined)) {
    return `${names.length === 1 ? "Card" : "Cards"} ${andList(numbers as string[])}`;
  }
  return andList(names);
}

/** The people whose cells a step read. */
function named(premises: Premises, g: Glossary): string {
  const ps = [...new Set(premises.cells.map((c) => c.p))];
  if (ps.length === 0) return "somebody";
  return people(ps, g);
}

/** Whom a tier-3 rule supposed innocent. */
function supposed(premises: Premises, g: Glossary): string {
  const ps = premises.assumedInnocent ?? [];
  if (ps.length === 0) return "that account";
  return people(ps, g);
}

/** What a tier-4 trial supposed, in the shape the rule supposed it. */
function hypothesis(step: Step, g: Glossary): string {
  const assumed = step.premises.assumedAnswer ?? [];
  const first = assumed[0];
  if (!first) return "it";
  switch (step.rule) {
    case "trial-slot":
      return `the murder happened at ${g.slotLabel(first.slot)}`;
    case "trial-pair":
      return `it was ${g.personName(first.culprit)} at ${g.slotLabel(first.slot)}`;
    default:
      return `it was ${g.personName(first.culprit)}`;
  }
}

/* ------------------------------------------------------------- the words */

function people(ps: readonly PersonId[], g: Glossary): string {
  return andList([...ps].sort((a, b) => a - b).map((p) => g.personName(p)));
}

function slots(ts: readonly SlotIndex[], g: Glossary): string {
  return orList([...ts].sort((a, b) => a - b).map((t) => g.slotLabel(t)));
}

function rooms(mask: number, g: Glossary): string {
  return orList(bitsOf(mask).map((r) => g.roomName(r)));
}

function andList(items: readonly string[]): string {
  return joined(items, "and");
}

function orList(items: readonly string[]): string {
  return joined(items, "or");
}

function joined(items: readonly string[], word: string): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

/**
 * A capital at the front and a stop at the end. Templates supply neither, so
 * that they can be attributed ("Mrs Hale says: ...") or embedded without a
 * caller having to unpick punctuation it did not ask for.
 */
function finish(text: string): string {
  const t = text.trim();
  if (t.length === 0) return t;
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}
