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
 * So the culprit has little to say about the murder hour, and being the only
 * person with nothing to say about nine o'clock would name them outright —
 * with lying off especially, where they have no false alibi to offer instead.
 * Rule 7 promises the player that silence proves nothing, and that promise
 * has to be made true rather than merely printed.
 *
 * The property is **the set of suspects silent on a murder topic is never
 * exactly the culprit**, and `coverTheKiller` reaches it the honest way round:
 * by giving the culprit something to say, not by gagging an innocent. There is
 * almost always something — a suspect may always state their own whereabouts,
 * so `NotAt(culprit, t*, somewhere)` is available even from the murder room —
 * and a voice leaks nothing, where a forced silence does. Gagging an innocent
 * is only the fallback.
 *
 * It said "at least two suspects are silent" before, and that was wrong twice
 * over. It could not always be reached, and it failed *quietly*: measured over
 * 150 seeds a preset, 1.3% of Easy and Normal cases shipped with the killer as
 * the only suspect with nothing to say about the murder hour — a case you win
 * by asking four people one question. And forcing two silences on the murder
 * hours while leaving every earlier hour alone is itself a signal: counting
 * silences per hour would have raised a lower bound on `t*`. The narrower
 * property has neither fault.
 *
 * **The same leak has a second face: not who speaks, but who is placed.** No
 * card can ever put the culprit in a room at `t*` — the only true one would
 * be `At(culprit, t*, r*)`, which names the killer and is banned — so if
 * every *other* suspect has a card placing them at the murder hour, the blank
 * row is the answer. Measured before it was fixed: **47% of Easy cases and 9%
 * of Normal**, which is not a leak but a solution. Lying presets barely feel
 * it (0.7%), and for a good reason — the killer's false alibi is itself a
 * card placing them at `t*`, which is what an alibi is.
 *
 * `hideAnInnocent` closes it by withholding a placing card from somebody who
 * did not need it. That is safe in a way that withholding cards usually is
 * not: it never touches a card the proof needs, so the bank still contains
 * `essential`, and a superset of a set that pins the answer pins the answer.
 *
 * **The checks are deliberately not the fixers.** `silenceLeaks` and
 * `placementLeaks` are asked by `generate.ts`, which throws the case back if
 * either is non-empty. The old code was a best effort that reported nothing,
 * so a failure to keep rule 7's promise was invisible to everything
 * downstream — which is exactly how 1.3% of Easy cases came to ship naming
 * their own killer.
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
  SlotIndex,
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

  coverTheKiller(rng, frame, world, bank, essential, pool, taken);
  hideAnInnocent(rng, frame, world, bank, essential);
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
 * The honest way round: give them a voice. A suspect may always state their
 * own whereabouts, so there is nearly always a card of the culprit's own —
 * `NotAt(culprit, t, somewhere)` — filed under the hour in question, and
 * handing it over leaks nothing. Only when there is no such card does this
 * fall back to gagging an innocent, and it will never gag one whose card the
 * proof needs: a silenced essential card is an unsolvable case, which is a
 * far worse failure than a legible one.
 *
 * It does its best and does not report. `silenceLeaks` is what decides
 * whether the best was good enough, and `generate.ts` is what acts on it.
 */
function coverTheKiller(
  rng: RNG,
  frame: CaseFrame,
  world: World,
  bank: Bank,
  essential: readonly Clue[],
  pool: readonly Clue[],
  taken: Set<ClueId>,
): void {
  const needed = new Set(essential.map((c) => c.id));
  for (const key of murderTopics(frame, world)) {
    if (!lonelyCulprit(frame, world, bank, key)) continue;

    // 1. Something of the killer's own to say about that hour.
    const mine = pool.filter(
      (c) =>
        c.source.kind === "testimony" &&
        c.source.speaker === world.culprit &&
        !taken.has(c.id) &&
        clueTopicKeys(frame, c).includes(key),
    );
    const voice = rng.shuffle(mine)[0];
    if (voice) {
      file(bank, frame, voice, taken);
      continue;
    }

    // 2. Failing that, somebody else with nothing to say either.
    const speakers: PersonId[] = [];
    for (let s = 0; s < frame.suspects; s++) {
      if (s !== world.culprit && ask(bank, s, key).length > 0) speakers.push(s);
    }
    for (const s of rng.shuffle(speakers)) {
      const said = bank.said.get(`${s}|${key}`) ?? [];
      if (said.some((id) => needed.has(id))) continue;
      forget(bank, `${s}|${key}`);
      break;
    }
  }
}

/** Is the culprit the only suspect with nothing to say on this topic? */
function lonelyCulprit(
  frame: CaseFrame,
  world: World,
  bank: Bank,
  key: TopicKey,
): boolean {
  const silent: PersonId[] = [];
  for (let s = 0; s < frame.suspects; s++) {
    if (ask(bank, s, key).length === 0) silent.push(s);
  }
  return silent.length === 1 && silent[0] === world.culprit;
}

/**
 * Take a reply out of the bank, and take the card with it if that was the
 * last question which would have released it.
 *
 * The second half is not tidiness. `generate.ts` measures both the bank's
 * fairness certificate and `playTier` — the grade the player is shown — on
 * `allCards`, and a card no action can produce is not part of what a player
 * can hold. Leaving orphans there would grade the case on evidence nobody
 * could ever find.
 */
function forget(bank: Bank, key: string): void {
  const dropped = bank.said.get(key) ?? [];
  bank.said.delete(key);
  for (const id of dropped) {
    let still = false;
    for (const ids of bank.said.values()) if (ids.includes(id)) still = true;
    for (const ids of bank.found.values()) if (ids.includes(id)) still = true;
    if (!still) bank.cards.delete(id);
  }
}

/* ------------------------------------------------------------- placement */

/** Does this card put `p` in a named room at slot `t`? */
function places(body: Clue["body"], p: PersonId, t: SlotIndex): boolean {
  switch (body.kind) {
    case "At":
    case "AloneIn":
      return body.p === p && body.t === t;
    case "Saw":
      return (body.p === p || body.q === p) && body.t === t;
    case "Stayed":
      return body.p === p && body.t1 <= t && t <= body.t2;

    // Spelled out rather than left to a `default`, so that an 18th kind has
    // to be classified here instead of defaulting to "places nobody" and
    // quietly widening the leak this guard exists to close. `Together` is the
    // one that looks like it belongs above: it does put two people in the
    // same room at `t`, but it never names the room, so it cannot account
    // for anybody's whereabouts.
    case "NotAt":
    case "Together":
    case "Occupied":
    case "Empty":
    case "Count":
    case "Visited":
    case "NeverVisited":
    case "AliveAt":
    case "DeathWindow":
    case "DoorClosed":
    case "BarredDoor":
    case "BarredRoom":
    case "Capacity":
      return false;

    default: {
      const unreachable: never = body;
      throw new Error(`places: unknown kind ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Suspects no card in the bank places at the murder hour. */
function unplaced(frame: CaseFrame, world: World, bank: Bank): PersonId[] {
  const cards = [...bank.cards.values()];
  const out: PersonId[] = [];
  for (let s = 0; s < frame.suspects; s++) {
    if (!cards.some((k) => places(k.body, s, world.murderSlot))) out.push(s);
  }
  return out;
}

/**
 * Leave somebody else's whereabouts at the murder hour unaccounted for.
 *
 * The culprit's are unaccounted for whatever happens, so the only way the
 * blank row stops being an accusation is for it not to be the only one. This
 * withholds every card that places one innocent at `t*`, choosing an innocent
 * none of whose placing cards the proof needs.
 */
function hideAnInnocent(
  rng: RNG,
  frame: CaseFrame,
  world: World,
  bank: Bank,
  essential: readonly Clue[],
): void {
  if (unplaced(frame, world, bank).length !== 1) return;
  if (unplaced(frame, world, bank)[0] !== world.culprit) return;
  const needed = new Set(essential.map((c) => c.id));
  const t = world.murderSlot;

  const candidates: PersonId[] = [];
  for (let s = 0; s < frame.suspects; s++) {
    if (s === world.culprit) continue;
    const placing = [...bank.cards.values()].filter((k) => places(k.body, s, t));
    if (placing.length > 0 && placing.every((k) => !needed.has(k.id))) {
      candidates.push(s);
    }
  }
  for (const s of rng.shuffle(candidates)) {
    for (const k of [...bank.cards.values()]) {
      if (places(k.body, s, t)) withdraw(bank, k.id);
    }
    if (unplaced(frame, world, bank).length > 1) return;
  }
}

/** Take a card out of the bank entirely, wherever it was filed. */
function withdraw(bank: Bank, id: ClueId): void {
  for (const [key, ids] of [...bank.said.entries()]) {
    const left = ids.filter((x) => x !== id);
    if (left.length === 0) bank.said.delete(key);
    else if (left.length !== ids.length) bank.said.set(key, left);
  }
  for (const [key, ids] of [...bank.found.entries()]) {
    const left = ids.filter((x) => x !== id);
    if (left.length === 0) bank.found.delete(key);
    else if (left.length !== ids.length) bank.found.set(key, left);
  }
  bank.cards.delete(id);
}

/**
 * Is the killer the only suspect whose whereabouts at the murder hour no card
 * accounts for? Empty is the only acceptable answer.
 */
export function placementLeaks(
  frame: CaseFrame,
  world: World,
  bank: Bank,
): PersonId[] {
  const blank = unplaced(frame, world, bank);
  return blank.length === 1 && blank[0] === world.culprit ? blank : [];
}

/**
 * The topics on which the killer's silence would name them.
 *
 * Empty is the only acceptable answer, and `generate.ts` throws the case back
 * otherwise. The check is separate from `coverTheKiller` on purpose: the old
 * code tried and reported nothing, so a failure to keep rule 7's promise was
 * invisible to everything downstream — which is exactly how 1.3% of Easy
 * cases came to ship naming their own killer.
 */
export function silenceLeaks(
  frame: CaseFrame,
  world: World,
  bank: Bank,
): TopicKey[] {
  return murderTopics(frame, world).filter((key) =>
    lonelyCulprit(frame, world, bank, key),
  );
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
