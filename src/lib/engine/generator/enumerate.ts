/**
 * Everything true that somebody could say about the evening.
 *
 * This module answers two questions and nothing else: **what is true**, and
 * **who could honestly know it**. It does not choose a puzzle — that is
 * `select.ts` — so it is free to be exhaustive, and it is.
 *
 * Three things it is responsible for, in the order they bite.
 *
 * **Truth by construction.** Every body is built from `world.loc` rather than
 * invented and filtered, so the pool cannot hold a false clue by accident.
 * The tests still check each one with `holds`, because everything downstream
 * assumes it — monotonicity is what makes a half-collected notebook safe
 * (ARCHITECTURE.md §2) — and this is the cheapest place to catch a bad
 * constructor.
 *
 * **Knowledge.** Rule 3: people in the same room in the same slot see each
 * other, and nobody sees into another room. That becomes one sentence, and
 * `couldKnow` is only ever that sentence applied per kind:
 *
 * > A suspect may state their own whereabouts freely, and anything else only
 * > from a room they were standing in at the time — never from the killer's
 * > position, which is `r*` at or after `t*`.
 *
 * Two consequences look like omissions and are not:
 *
 *  - **`Empty` can never be testimony.** To witness that a room held nobody
 *    you would have to be standing in it, which is what would make it false.
 *    A zero `Count` is the same clue and goes the same way. They are physical
 *    evidence or nothing.
 *  - **`DeathWindow` can never be testimony.** It is what the doctor says,
 *    not what a guest saw.
 *
 * **What gives the answer away.** Rule 5 decides this: from `t*` on, nobody
 * but the killer is in `r*`. So any true clue putting a living suspect there
 * names the killer, and a one-slot `DeathWindow` names the hour. Measured
 * over twelve seeds of each preset, leaving them in collapses the game — the
 * selection loop minimises to two or three cards, and 9 of 12 Easy cases and
 * 5 of 12 Expert cases grade at tier 0, because one card is the whole
 * solution. With them gone every preset lands inside its tier band. That
 * measurement is why this filter is not a nicety.
 *
 * The same argument applies to the *speaker*, which is the last clause of the
 * knowledge sentence: a suspect who could only have learned something by
 * standing in `r*` at or after `t*` confesses by knowing it.
 */

import { isLiving, presentMask } from "../axioms";
import { bitsOf } from "../bits";
import { canonical, holds } from "../clues";
import { isRuleKind } from "../types";
import type {
  CaseFrame,
  Clue,
  ClueBody,
  ClueKind,
  PersonId,
  RoomId,
  SlotIndex,
  World,
} from "../types";

/* ------------------------------------------------------------- the pool */

/**
 * The clues a case may be built from.
 *
 * `opening` is what the player holds before doing anything: the case-file
 * rules, and the death window the briefing states. They are clues like any
 * other so the notebook can show them, the fidelity check can parse them and
 * a hint can cite them — but the selection loop may never drop one, because
 * the player holds them whatever the loop decides (`select.ts` pins them).
 */
export interface Pool {
  opening: Clue[];
  pool: Clue[];
  /** The next free id number, so `lies.ts` can go on where this left off. */
  nextId: number;
}

export interface EnumerateOptions {
  /**
   * The slots the murder could have fallen in, as the generator drew it. The
   * briefing states exactly this and nothing finer — see `briefingWindow`.
   */
  murderSlotRange: [SlotIndex, SlotIndex];
}

/**
 * Ids are opaque on purpose. Wave 5 hands the fidelity checker the prose and
 * the ids and asks it to parse each sentence back into a formal clue; an id
 * carrying the canonical form would hand it the answer sheet. They are
 * assigned in enumeration order over the whole pool, so they are stable for a
 * given (frame, world) and every later stage — the selected set, the bank,
 * the saved case — shares them.
 */
export function enumerateClues(
  frame: CaseFrame,
  world: World,
  opts: EnumerateOptions,
): Pool {
  let n = 0;
  const make = (body: ClueBody, speaker?: PersonId): Clue => ({
    id: `c${n++}`,
    body,
    source:
      speaker === undefined ? { kind: "fact" } : { kind: "testimony", speaker },
  });

  // The case file first, so its ids are the lowest and a case reads in the
  // order the player meets it.
  const opening: Clue[] = ruleBodies(frame).map((body) => make(body));
  const briefing = briefingWindow(opts.murderSlotRange);
  opening.push(make(briefing));

  // The briefing's own window is true, so `trueBodies` emits it too. Offering
  // it again as a card to be earned would let the player find something they
  // were handed at the start.
  const held = canonical(briefing);

  const pool: Clue[] = [];
  for (const body of trueBodies(frame, world)) {
    if (canonical(body) === held) continue;
    if (givesAwayAnswer(frame, world, body, opts.murderSlotRange)) continue;
    if (physical(body.kind)) pool.push(make(body));
    for (let s = 0; s < frame.suspects; s++) {
      if (couldKnow(frame, world, s, body)) pool.push(make(body, s));
    }
  }
  return { opening, pool, nextId: n };
}

/**
 * Which kinds may be offered as physical evidence.
 *
 * Only `Together` is refused, and for an action rather than a fiction: it
 * names no room (`company.ts#mentions`), so it has no `room:` topic key, and
 * `hint.ts#firstTopic` would fall back to the murder room — sending the
 * player to search the body's room for a fact that has nothing to do with it.
 * The two clues about the victim name no room either, but for them that
 * fallback is right: the place to learn when somebody died is where they died.
 */
function physical(kind: ClueKind): boolean {
  return kind !== "Together";
}

/* ---------------------------------------------------------- what is true */

/**
 * Every true clue body, built from the world rather than filtered out of a
 * guess. **The order is fixed and is part of the determinism contract**
 * (invariant 4): it decides the ids, and the ids decide the case.
 */
export function trueBodies(frame: CaseFrame, world: World): ClueBody[] {
  const out: ClueBody[] = [];
  const R = frame.plan.rooms.length;
  const T = frame.slots;
  const P = frame.people;
  const at = (p: PersonId, t: SlotIndex) => world.loc[p][t];

  // Where everybody was, and where they were not.
  for (let p = 0; p < P; p++) {
    for (let t = 0; t < T; t++) {
      out.push({ kind: "At", p, t, r: at(p, t) });
      for (let r = 0; r < R; r++) {
        if (r !== at(p, t)) out.push({ kind: "NotAt", p, t, r });
      }
    }
  }

  // Spans. A one-slot span is an `At`, and `Stayed.valid` refuses it, so the
  // inner loop starts one slot along and stops the moment they move.
  for (let p = 0; p < P; p++) {
    for (let t1 = 0; t1 < T; t1++) {
      const r = at(p, t1);
      for (let t2 = t1 + 1; t2 < T && at(p, t2) === r; t2++) {
        out.push({ kind: "Stayed", p, r, t1, t2 });
      }
    }
  }

  // Company, counted among the living: `presentMask` is the definition.
  for (let t = 0; t < T; t++) {
    for (let r = 0; r < R; r++) {
      const here = bitsOf(presentMask(frame, world, r, t));
      for (let i = 0; i < here.length; i++) {
        for (let j = i + 1; j < here.length; j++) {
          out.push({ kind: "Saw", p: here[i], q: here[j], t, r });
          out.push({ kind: "Together", p: here[i], q: here[j], t });
        }
      }
      if (here.length === 1) out.push({ kind: "AloneIn", p: here[0], t, r });
      if (here.length > 0) out.push({ kind: "Occupied", r, t });
      else out.push({ kind: "Empty", r, t });
      out.push({ kind: "Count", r, t, k: here.length });
    }
  }

  // Over the whole evening.
  for (let p = 0; p < P; p++) {
    const seen = new Set<RoomId>();
    for (let t = 0; t < T; t++) seen.add(at(p, t));
    for (let r = 0; r < R; r++) {
      out.push(
        seen.has(r) ? { kind: "Visited", p, r } : { kind: "NeverVisited", p, r },
      );
    }
  }

  // The victim. Every window containing t* is true; the briefing takes the
  // widest of them and the narrower ones stay as cards to be earned.
  for (let t = 0; t < world.murderSlot; t++) out.push({ kind: "AliveAt", t });
  for (let a = 0; a <= world.murderSlot; a++) {
    for (let b = world.murderSlot; b < T; b++) {
      out.push({ kind: "DeathWindow", a, b });
    }
  }

  return out;
}

/* ------------------------------------------------ what gives it all away */

/**
 * Would this card, on its own, tell the player the answer?
 *
 * Rule 5 is the whole of it: from `t*` on the only living soul in `r*` is the
 * killer. So a true clue placing a living suspect there names them, and a
 * one-slot death window names the hour. The victim is exempt — that the body
 * lies in `r*` is what the player is told at the start.
 */
export function givesAwayAnswer(
  frame: CaseFrame,
  world: World,
  body: ClueBody,
  range: [SlotIndex, SlotIndex],
): boolean {
  const V = frame.victim;
  const confesses = (p: PersonId, t: SlotIndex, r: RoomId) =>
    p !== V && r === frame.murderRoom && t >= world.murderSlot;

  switch (body.kind) {
    case "At":
    case "AloneIn":
      return confesses(body.p, body.t, body.r);
    case "Saw":
      return (
        confesses(body.p, body.t, body.r) || confesses(body.q, body.t, body.r)
      );
    case "Stayed":
      for (let t = body.t1; t <= body.t2; t++) {
        if (confesses(body.p, t, body.r)) return true;
      }
      return false;
    case "Together": {
      // It names no room, but the room is still where the two of them were.
      const r = world.loc[body.p][body.t];
      return confesses(body.p, body.t, r) || confesses(body.q, body.t, r);
    }
    case "Visited":
      // Only the killer sets foot in r* after the murder, so "they were in
      // the study at some point" names them — unless they had also been there
      // earlier in the evening, when anybody could have been.
      return (
        body.r === frame.murderRoom &&
        body.p !== V &&
        !wasThereBefore(world, body.p, body.r, world.murderSlot)
      );
    case "DeathWindow":
      // NOT `a === b`. The player holds the briefing window from the first
      // second, so what matters is what a card leaves once it is read
      // *against* that — and `DeathWindow(0, 1)` against a briefing of
      // `[1, T-2]` names the hour exactly as loudly as `DeathWindow(1, 1)`
      // does. Measured before this was fixed: 19 of 60 Easy banks held a card
      // that pinned `t*` on its own.
      return Math.max(body.a, range[0]) === Math.min(body.b, range[1]);
    case "AliveAt":
      // Same argument from the other end: "still alive at T-3" plus a
      // briefing that caps `t*` at T-2 leaves one hour standing.
      return body.t + 1 === range[1];
    default:
      return false;
  }
}

function wasThereBefore(
  world: World,
  p: PersonId,
  r: RoomId,
  before: SlotIndex,
): boolean {
  for (let t = 0; t < before; t++) if (world.loc[p][t] === r) return true;
  return false;
}

/* ------------------------------------------------------- who knows what */

/**
 * Could suspect `s` honestly assert this body?
 *
 * The sentence at the top of the file, applied per kind. `own` is their own
 * whereabouts, which they need no vantage point for; everything else goes
 * through `sharedRoom`, which is rule 3 and the refusal of the killer's
 * position at once.
 */
export function couldKnow(
  frame: CaseFrame,
  world: World,
  s: PersonId,
  body: ClueBody,
): boolean {
  const V = frame.victim;
  const at = (p: PersonId, t: SlotIndex) => world.loc[p][t];
  /** Was `s` standing next to `p` at `t`, somewhere they may speak of? */
  const saw = (p: PersonId, t: SlotIndex) =>
    p !== s && at(s, t) === at(p, t) && speakable(frame, world, s, t);
  /** Was `s` in this room at this slot, and may they say so? */
  const inRoom = (r: RoomId, t: SlotIndex) =>
    at(s, t) === r && speakable(frame, world, s, t);

  switch (body.kind) {
    case "At":
      return body.p === s || saw(body.p, body.t);
    case "NotAt":
      // Two ways to know it: you were in that room and they were not in it
      // with you, or you were standing beside them somewhere else.
      return body.p === s || inRoom(body.r, body.t) || saw(body.p, body.t);
    case "Stayed":
      for (let t = body.t1; t <= body.t2; t++) {
        if (body.p === s) continue;
        if (!saw(body.p, t) || !inRoom(body.r, t)) return false;
      }
      return true;
    case "Saw":
      // Either of the two, or a third person standing there with both.
      return (
        inRoom(body.r, body.t) &&
        (body.p === s || body.q === s || (saw(body.p, body.t) && saw(body.q, body.t)))
      );
    case "Together":
      return (
        (body.p === s && saw(body.q, body.t)) ||
        (body.q === s && saw(body.p, body.t)) ||
        (saw(body.p, body.t) && saw(body.q, body.t))
      );
    case "AloneIn":
      // Nobody else was there to see it, so only they can vouch for it.
      return body.p === s && speakable(frame, world, s, body.t);
    case "Occupied":
      return inRoom(body.r, body.t);
    case "Count":
      // Standing in the room is how you count the heads in it. `Empty` and a
      // zero count are unwitnessable for the same reason: you would be one.
      return body.k !== 0 && inRoom(body.r, body.t);
    case "Visited":
      if (body.p === s) return true;
      for (let t = 0; t < frame.slots; t++) {
        if (inRoom(body.r, t) && saw(body.p, t)) return true;
      }
      return false;
    case "NeverVisited":
      // Of themselves, freely. Of somebody else only by having watched the
      // room the whole evening, which is a long vigil and rarely true.
      if (body.p === s) return true;
      for (let t = 0; t < frame.slots; t++) {
        if (!inRoom(body.r, t)) return false;
      }
      return true;
    case "AliveAt":
      return saw(V, body.t) && isLiving(frame, world, V, body.t);
    default:
      // `Empty` and `DeathWindow` are nobody's to witness, and the case-file
      // rules are the house's rather than anybody's.
      return false;
  }
}

/**
 * May `s` speak of what they saw in slot `t`?
 *
 * Only if they were not standing where the killer stands. `r*` from `t*` on
 * is the killer's position and nobody else's (rule 5), so a statement resting
 * on it would name its own speaker.
 */
function speakable(
  frame: CaseFrame,
  world: World,
  s: PersonId,
  t: SlotIndex,
): boolean {
  return !(world.loc[s][t] === frame.murderRoom && t >= world.murderSlot);
}

/* ---------------------------------------------------------- the case file */

/**
 * The case-file rules as clues, mirroring `frame.rules` exactly.
 *
 * Exactly, and never more: the frame is what `isLegal` and `movementMasks`
 * read, so a rule clue the frame does not carry would assert something the
 * solvers do not enforce — true of this world by luck rather than by
 * construction, and false of the next one.
 */
export function ruleBodies(frame: CaseFrame): ClueBody[] {
  const out: ClueBody[] = [];
  for (const c of frame.rules.closures) {
    out.push({ kind: "DoorClosed", door: c.door, from: c.from, to: c.to });
  }
  for (const b of frame.rules.doorBars) {
    out.push({ kind: "BarredDoor", p: b.person, door: b.door });
  }
  for (const b of frame.rules.roomBars) {
    out.push({ kind: "BarredRoom", p: b.person, r: b.room });
  }
  for (const c of frame.rules.capacities) {
    out.push({ kind: "Capacity", r: c.room, k: c.max });
  }
  return out;
}

/**
 * The death window the briefing states.
 *
 * It is **the range the murder slot was drawn from**, not a window fitted
 * round the slot that came up. That distinction is the whole point. A window
 * chosen to hug `t*` would be a function of the answer, and a player who knew
 * how the generator worked could read the answer back out of the briefing;
 * the drawn range is the same for every case of the shape and leaks nothing
 * but the rules of the game — the victim was alive when the evening began,
 * and the body was found at the end.
 *
 * It is true of the world because `simulateTruth` drew `t*` from exactly this
 * range; `generate.ts` passes the two the same numbers, and a test pins that.
 */
export function briefingWindow(range: [SlotIndex, SlotIndex]): ClueBody {
  return { kind: "DeathWindow", a: range[0], b: range[1] };
}

/* -------------------------------------------------------------- checking */

/**
 * Every clue is true in the true world, which is the property the whole
 * engine downstream leans on (ARCHITECTURE.md §2). Exported so the tests, the
 * generator's own assertion and the sim harness all ask the same question.
 *
 * Note it asks `holds`, not `clueHolds`: a culprit's lie passes `clueHolds`
 * vacuously, and here we want to know whether the statement is *true*. The
 * bank uses this to keep every innocent honest.
 */
export function allTrue(
  frame: CaseFrame,
  world: World,
  clues: readonly Clue[],
): boolean {
  return clues.every((c) => holds(c.body, frame, world));
}

/** Distinct clues, by source and canonical body. */
export function distinct(clues: readonly Clue[]): boolean {
  const seen = new Set<string>();
  for (const c of clues) {
    const src = c.source.kind === "fact" ? "f" : `s${c.source.speaker}`;
    const key = `${src}|${canonical(c.body)}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Is this the opening the player is handed at the start — case-file rules,
 * plus the one death window the briefing states, and nothing else?
 */
export function isOpening(clues: readonly Clue[]): boolean {
  let windows = 0;
  for (const c of clues) {
    if (isRuleKind(c.body.kind)) continue;
    if (c.body.kind === "DeathWindow" && c.source.kind === "fact") {
      windows++;
      continue;
    }
    return false;
  }
  return windows === 1;
}
