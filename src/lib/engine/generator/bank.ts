/**
 * The statement bank: everything anybody would say, and everything a room
 * would give up, filed under the question that releases it.
 *
 * **A topic maps to a list, not to a single reply.** The plan said "for every
 * suspect × topic fix the reply", and that cannot be made to work. A clue
 * carries several topic keys — `At(p,t,r)` answers a question about `p`,
 * about `r` and about `t` — and two of a speaker's statements can share one.
 * With a single slot per topic the loser of that collision would be
 * unreachable at exactly the topic `hint.ts#firstTopic` tells the player to
 * ask about. So a statement is registered under *all* of its keys, and asking
 * releases everything filed there. A suspect answering a question with two
 * sentences is also simply what people do.
 *
 * **Why the full bank is still fair** (invariant 7). Fairness is a property
 * of the answer set, and it survives adding cards. Fix a candidate `(c, t)`:
 * every clue this bank holds either binds that candidate or does not, and
 * adding one can only add a constraint, so the set of worlds witnessing
 * `(c, t)` can only shrink. Meanwhile the true answer is witnessed by the
 * true world under *every* issued clue — the innocents' statements because
 * they are true, the culprit's because `testimonyBinds` makes them vacuous
 * where the speaker is the culprit. So the full bank's answer set is a subset
 * of the proof set's, and still contains the truth: exactly the truth, which
 * is what fair means. `bank.test.ts` checks it with the oracle rather than
 * trusting the argument.
 *
 * **What the bank does not protect is the grade.** A player who asks
 * everybody everything holds far more than the proof set and will often be
 * able to finish below the tier the case is graded at. That is by design —
 * the grade says how hard the case is from the cards it actually needs — but
 * it is a number worth watching, so the sim table carries the tier of the
 * full bank beside the tier of the proof set.
 *
 * **Gaps, and the silence that would give the killer away.** A suspect may
 * only say what they could have witnessed, and the one position nobody may
 * speak from is the killer's: `r*` from `t*` on (`enumerate.ts#speakable`).
 * So the culprit is necessarily quiet about the murder hour, and with lying
 * off — where they have no false alibi to offer instead — being the only
 * person with nothing to say about nine o'clock would name them outright.
 * Rule 7 promises the player that silence proves nothing, and that promise
 * has to be made true rather than merely printed. `spreadGaps` does it: on
 * every topic touching the murder, at least two suspects are silent.
 */

import { clueTopicKeys } from "../clues";
import { RNG } from "../rng";
import { topic } from "../types";
import type {
  CaseFrame,
  Clue,
  ClueId,
  PersonId,
  RoomId,
  TopicKey,
  World,
} from "../types";

export interface Bank {
  /** Cards a suspect gives up when asked about a topic. Key: `s|topicKey`. */
  said: Map<string, ClueId[]>;
  /** Cards found by examining a room. */
  found: Map<RoomId, ClueId[]>;
  /** Every card the bank can release, by id. */
  cards: Map<ClueId, Clue>;
}

export interface BankOptions {
  /** Extra true statements per suspect, beyond the ones the proof needs. */
  fillersPerSuspect?: number;
  /** Extra physical evidence per room. */
  fillersPerRoom?: number;
}

/**
 * Starting points. Enough that the bank is not simply the answer with the
 * serial numbers filed off, few enough that asking everything is a slog
 * rather than a strategy — which is what par is for.
 */
const DEFAULT_FILLERS_PER_SUSPECT = 3;
const DEFAULT_FILLERS_PER_ROOM = 2;

export function buildBank(
  rng: RNG,
  frame: CaseFrame,
  world: World,
  essential: readonly Clue[],
  pool: readonly Clue[],
  opts: BankOptions = {},
): Bank {
  const perSuspect = opts.fillersPerSuspect ?? DEFAULT_FILLERS_PER_SUSPECT;
  const perRoom = opts.fillersPerRoom ?? DEFAULT_FILLERS_PER_ROOM;

  const bank: Bank = { said: new Map(), found: new Map(), cards: new Map() };
  const taken = new Set<ClueId>();

  // The proof first: every card the case needs must be reachable, so nothing
  // below is allowed to crowd one out.
  for (const c of essential) file(bank, frame, c, taken);

  // Then padding, spread over the speakers and the rooms rather than heaped
  // on whoever happens to come first in the pool.
  for (let s = 0; s < frame.suspects; s++) {
    const mine = pool.filter(
      (c) =>
        c.source.kind === "testimony" &&
        c.source.speaker === s &&
        !taken.has(c.id),
    );
    for (const c of rng.shuffle(mine).slice(0, perSuspect)) {
      file(bank, frame, c, taken);
    }
  }
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    const here = pool.filter(
      (c) =>
        c.source.kind === "fact" &&
        !taken.has(c.id) &&
        clueTopicKeys(frame, c).includes(topic.room(r)),
    );
    for (const c of rng.shuffle(here).slice(0, perRoom)) {
      file(bank, frame, c, taken);
    }
  }

  spreadGaps(rng, frame, world, bank, essential);
  return bank;
}

/** Register a card under every question that would release it. */
function file(
  bank: Bank,
  frame: CaseFrame,
  clue: Clue,
  taken: Set<ClueId>,
): void {
  if (taken.has(clue.id)) return;
  taken.add(clue.id);
  bank.cards.set(clue.id, clue);
  const keys = clueTopicKeys(frame, clue);
  if (clue.source.kind === "testimony") {
    const s = clue.source.speaker;
    for (const key of keys) push(bank.said, `${s}|${key}`, clue.id);
    return;
  }
  // Physical evidence is found by searching a room. Every fact in the pool
  // has a room key except the two about the victim, which are found where the
  // body is — the same rule `hint.ts#firstTopic` points the player at.
  const rooms = keys.filter((k) => k.startsWith("room:"));
  if (rooms.length === 0) {
    push(bank.found, frame.murderRoom, clue.id);
    return;
  }
  for (const key of rooms) push(bank.found, Number(key.slice(5)), clue.id);
}

function push<K>(map: Map<K, ClueId[]>, key: K, id: ClueId): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(id)) list.push(id);
  } else {
    map.set(key, [id]);
  }
}

/* --------------------------------------------------------------- silence */

/**
 * Make sure the killer is never the only one with nothing to say.
 *
 * The topics that matter are the ones that touch the murder: the hours from
 * `t*` on, and the room the body is in. On each of them at least two suspects
 * must be silent, so that a player counting who has no answer learns nothing.
 * An innocent's card may be taken away to achieve that, but never one the
 * proof needs — a silenced essential card is an unsolvable case, which is a
 * far worse failure than a legible one.
 */
function spreadGaps(
  rng: RNG,
  frame: CaseFrame,
  world: World,
  bank: Bank,
  essential: readonly Clue[],
): void {
  const needed = new Set(essential.map((c) => c.id));
  for (const key of murderTopics(frame, world)) {
    const silent: PersonId[] = [];
    const speakers: PersonId[] = [];
    for (let s = 0; s < frame.suspects; s++) {
      const said = bank.said.get(`${s}|${key}`);
      if (!said || said.length === 0) silent.push(s);
      else speakers.push(s);
    }
    if (silent.length >= 2) continue;
    // Silence whoever can be silenced without costing the proof a card.
    for (const s of rng.shuffle(speakers)) {
      if (silent.length >= 2) break;
      const said = bank.said.get(`${s}|${key}`) ?? [];
      if (said.some((id) => needed.has(id))) continue;
      bank.said.delete(`${s}|${key}`);
      silent.push(s);
    }
  }
}

/**
 * The questions a player would ask if they suspected somebody: the murder
 * hour and everything after it, and the room the body was found in.
 */
export function murderTopics(frame: CaseFrame, world: World): TopicKey[] {
  const keys: TopicKey[] = [topic.room(frame.murderRoom)];
  for (let t = world.murderSlot; t < frame.slots; t++) keys.push(topic.slot(t));
  return keys;
}

/* ------------------------------------------------------------ asking it */

/**
 * What a suspect says when asked about a topic.
 *
 * A suspect is never a topic for their own statements — `clueTopicKeys`
 * filters that out, because "tell me about yourself" is the motive question —
 * so asking `s` about `s` is always empty here, and the caller should treat
 * it as the motive.
 */
export function ask(
  bank: Bank,
  suspect: PersonId,
  key: TopicKey,
): ClueId[] {
  return bank.said.get(`${suspect}|${key}`) ?? [];
}

/** What examining a room turns up. */
export function examine(bank: Bank, room: RoomId): ClueId[] {
  return bank.found.get(room) ?? [];
}

/** Every card the bank can ever release, in id order. */
export function allCards(bank: Bank): Clue[] {
  return [...bank.cards.values()].sort(
    (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
  );
}

/** Is every one of these cards released by some action? */
export function reachable(bank: Bank, clues: readonly Clue[]): Clue[] {
  const released = new Set<ClueId>();
  for (const ids of bank.said.values()) for (const id of ids) released.add(id);
  for (const ids of bank.found.values()) for (const id of ids) released.add(id);
  return clues.filter((c) => !released.has(c.id));
}
