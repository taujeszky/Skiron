import { describe, expect, it } from "vitest";
import { clueHolds, clueMentions, holds } from "../clues";
import { newCaseId } from "../caseId";
import { answerKey, answers } from "../solver/exhaustive";
import { PRESET_NAMES, PRESETS, acceptsTier } from "../solver/difficulty";
import { solve } from "../solver/solve";
import { isRuleKind, topic } from "../types";
import type { Clue, PresetName } from "../types";
import {
  allCards,
  ask,
  examine,
  murderTopics,
  placementLeaks,
  reachable,
  silenceLeaks,
} from "./bank";
import { allTrue, couldKnow, distinct, isOpening } from "./enumerate";
import { generate, murderRange } from "./generate";
import type { GeneratedCase } from "./generate";
import { isOfferedAction } from "./investigation";
import { apply, hint, newNotebook, notebookIsSound } from "../solver/hint";
import { bitsOf, fullMask } from "../bits";
import { falseStatements } from "./lies";

/**
 * Generating a case is the most expensive thing in the suite — a few hundred
 * milliseconds on Expert — so every case is made once and shared. A test that
 * needs a fresh one says so.
 */
const SEEDS = ["a1", "b2", "c3", "d4"];
const cache = new Map<string, GeneratedCase>();

function caseFor(preset: PresetName, seed: string): GeneratedCase {
  const key = `${preset}:${seed}`;
  const found = cache.get(key);
  if (found) return found;
  const out = generate(newCaseId(preset, seed), {
    onAssertionFailure: (reason, detail) => {
      // A certificate failure is a soundness bug, not a flaky seed. Make it
      // loud here even though the generator itself only counts and retries.
      throw new Error(`${reason}: ${detail}`);
    },
  });
  expect(out.case, `no case for ${key} in ${out.rejections.length} attempts`)
    .not.toBeNull();
  cache.set(key, out.case as GeneratedCase);
  return out.case as GeneratedCase;
}

function everyCase(): GeneratedCase[] {
  return PRESET_NAMES.flatMap((p) => SEEDS.map((s) => caseFor(p, s)));
}

describe("the generator makes a case at all", () => {
  it("makes one for every preset, inside the attempt cap", () => {
    for (const preset of PRESET_NAMES) {
      const out = generate(newCaseId(preset, "start"));
      expect(out.case, `${preset} made no case`).not.toBeNull();
    }
  });

  it("is deterministic: the same id rebuilds the same case", () => {
    // Invariant 4, and the reason every draw in the pipeline happens before
    // the first solve. `golden.test.ts` guards the stronger claim — that the
    // case does not change between builds — with pinned vectors.
    for (const preset of PRESET_NAMES) {
      const id = newCaseId(preset, "twice");
      const a = generate(id).case;
      const b = generate(id).case;
      expect(a).not.toBeNull();
      expect(signature(a as GeneratedCase)).toBe(signature(b as GeneratedCase));
    }
  });
});

describe("fairness, certified by the oracle (invariant 2)", () => {
  it("the proof set has exactly the true answer", () => {
    for (const c of everyCase()) {
      const found = answers(c.frame, c.clues);
      expect(found.map(answerKey)).toEqual([answerKey(c.answer)]);
    }
  });

  it("the full bank leaves it fair too (invariant 7)", () => {
    // Bank fairness is the one that matters most, because the bank is what a
    // thorough player actually ends up holding. The argument is that adding
    // an issued clue can only shrink the answer set while the true world
    // witnesses the truth under every one of them — this asks the oracle
    // rather than trusting the argument.
    for (const c of everyCase()) {
      const held = [...c.opening, ...allCards(c.bank)];
      const found = answers(c.frame, held);
      expect(found.map(answerKey)).toEqual([answerKey(c.answer)]);
    }
  });

  it("the deduction solver finishes on what it shipped, with no contradiction", () => {
    for (const c of everyCase()) {
      const r = solve(c.frame, c.clues, { record: false });
      expect(r.finished).toBe(true);
      expect(r.contradiction).toBe(false);
      expect(r.answer).toEqual(c.answer);
      expect(r.tier).toBe(c.tier);
    }
  });
});

describe("the difficulty the case claims", () => {
  it("lands inside the band the preset asked for", () => {
    for (const c of everyCase()) {
      expect(acceptsTier(PRESETS[c.id.preset], c.tier)).toBe(true);
    }
  });

  it("is never beaten by collecting everything", () => {
    // The guard that stops a case being graded Hard and played as Easy. More
    // cards can only make a case easier, so playTier <= tier; the generator
    // additionally refuses anything that falls below the preset floor.
    for (const c of everyCase()) {
      expect(c.playTier).toBeLessThanOrEqual(c.tier);
      expect(c.playTier).toBeGreaterThanOrEqual(PRESETS[c.id.preset].tier.min);
    }
  });
});

describe("honesty (rule 7)", () => {
  it("every clue the case ships is true in the true world, lies aside", () => {
    for (const c of everyCase()) {
      for (const clue of [...c.opening, ...allCards(c.bank)]) {
        const isLie =
          clue.source.kind === "testimony" &&
          clue.source.speaker === c.world.culprit;
        if (!isLie) {
          expect(
            holds(clue.body, c.frame, c.world),
            `${c.id.preset}: ${clue.id} is not true`,
          ).toBe(true);
        }
        // Whether or not it is a lie, it must hold in the rule-7 sense, which
        // is what makes a half-collected notebook safe.
        expect(clueHolds(c.frame, clue, c.world)).toBe(true);
      }
    }
  });

  it("innocents never lie, in either mode", () => {
    for (const c of everyCase()) {
      const theirs = allCards(c.bank).filter(
        (k) =>
          k.source.kind === "testimony" && k.source.speaker !== c.world.culprit,
      );
      expect(falseStatements(c.frame, c.world, theirs)).toEqual([]);
    }
  });

  it("with lying off the culprit does not lie either", () => {
    for (const c of everyCase()) {
      if (c.frame.lying) continue;
      expect(c.alibi).toBeNull();
      expect(falseStatements(c.frame, c.world, allCards(c.bank))).toEqual([]);
    }
  });

  it("with lying on, a culprit who has a story tells at least one falsehood", () => {
    let told = 0;
    for (const c of everyCase()) {
      if (!c.frame.lying || !c.alibi) continue;
      told++;
      expect(falseStatements(c.frame, c.world, c.alibi.lies).length)
        .toBeGreaterThan(0);
      // And the story must not sit beside the culprit's own true statements
      // that contradict it: those are retracted, not outvoted.
      const mine = allCards(c.bank).filter(
        (k) =>
          k.source.kind === "testimony" && k.source.speaker === c.world.culprit,
      );
      for (const k of mine) {
        expect(c.alibi.retracted.has(k.id)).toBe(false);
      }
    }
    expect(told, "no lying case in the sample actually told a lie").toBeGreaterThan(0);
  });
});

describe("what the player is handed at the start", () => {
  it("is the case file and one death window, and nothing else", () => {
    for (const c of everyCase()) {
      expect(isOpening(c.opening)).toBe(true);
    }
  });

  it("never solves the case by itself", () => {
    for (const c of everyCase()) {
      expect(solve(c.frame, c.opening, { record: false }).finished).toBe(false);
    }
  });

  it("holds no essential card that is not a case-file rule", () => {
    // The plan's test, amended in the same commit: the briefing's death
    // window is an issued clue and is pinned into the opening, so it is
    // exempt. Withholding a constraint the fiction states out loud would be
    // worse than widening the test.
    for (const c of everyCase()) {
      const starting = new Set(c.opening.map((k) => k.id));
      for (const k of c.essential) {
        expect(starting.has(k.id), `${k.id} is essential and free`).toBe(false);
      }
      for (const k of c.opening) {
        const exempt = isRuleKind(k.body.kind) || k.body.kind === "DeathWindow";
        expect(exempt).toBe(true);
      }
    }
  });
});

describe("the investigation", () => {
  it("releases every essential card through some action", () => {
    // Asked of the bank, which is what hands cards over. The old version
    // asked the investigation plan, whose action list is built by walking
    // `essential` — so it was asking a list made from the essential cards
    // whether it held the essential cards, and returned [] for any bank at
    // all, including one that filed nothing.
    for (const c of everyCase()) {
      expect(reachable(c.bank, c.essential)).toEqual([]);
    }
  });

  it("only ever names actions the game offers", () => {
    for (const c of everyCase()) {
      for (const a of c.investigation.actions) {
        expect(isOfferedAction(a), `${JSON.stringify(a)}`).toBe(true);
      }
    }
  });

  it("finds each essential card at the action its own hint would name", () => {
    // `planInvestigation` files a card under `hint.ts#firstTopic`, which is
    // the same function branch 3 of a hint calls. If the two ever disagree a
    // hint would send the player to an action that releases nothing.
    for (const c of everyCase()) {
      for (const k of c.essential) {
        const hit =
          k.source.kind === "testimony"
            ? ask(c.bank, k.source.speaker, firstTopicOf(c, k))
            : examine(c.bank, roomOf(firstTopicOf(c, k)));
        expect(hit, `${c.id.preset} ${k.id}`).toContain(k.id);
      }
    }
  });

  it("charges par for more than the bare proof", () => {
    for (const c of everyCase()) {
      expect(c.investigation.par).toBeGreaterThanOrEqual(
        c.investigation.actions.length,
      );
    }
  });

  it("traces a proof that is a real part of the solve", () => {
    for (const c of everyCase()) {
      const all = new Set(
        solve(c.frame, c.clues).steps.map((s) => JSON.stringify(s)),
      );
      expect(c.trace.length).toBeGreaterThan(0);
      for (const s of c.trace) expect(all.has(JSON.stringify(s))).toBe(true);
      // The point of slicing is that it is shorter than reciting everything.
      expect(c.trace.length).toBeLessThanOrEqual(all.size);
    }
  });
});

describe("the bank", () => {
  it("holds every essential card", () => {
    for (const c of everyCase()) {
      for (const k of c.essential) expect(c.bank.cards.has(k.id)).toBe(true);
    }
  });

  it("never lets the killer be the only one with nothing to say", () => {
    // Rule 7 promises the player that silence proves nothing. The culprit has
    // least to say around the murder — nobody may speak from the killer's
    // position — so that promise has to be made true rather than printed.
    for (const c of everyCase()) {
      expect(silenceLeaks(c.frame, c.world, c.bank)).toEqual([]);
      // Stated again without the helper, so this is not the helper marking
      // its own homework.
      for (const key of murderTopics(c.frame, c.world)) {
        const silent: number[] = [];
        for (let s = 0; s < c.frame.suspects; s++) {
          if (ask(c.bank, s, key).length === 0) silent.push(s);
        }
        if (silent.length === 1) {
          expect(
            silent[0],
            `${c.id.preset}: only the culprit is silent on ${key}`,
          ).not.toBe(c.world.culprit);
        }
      }
    }
  });

  it("never leaves the killer the only unaccounted-for suspect at the murder hour", () => {
    // The same tell from the other side. No card can place the culprit at t*
    // — the only true one would name them — so if every other suspect has
    // one, the blank row is the answer. Measured before the fix: 47% of Easy
    // cases and 9% of Normal. Lying presets barely felt it, because the false
    // alibi is itself a card placing the killer at the murder hour.
    for (const c of everyCase()) {
      expect(placementLeaks(c.frame, c.world, c.bank)).toEqual([]);
    }
  });

  it("keeps that promise across a corpus big enough to see it break", () => {
    /**
     * The sixteen cases the other tests share cannot see a one-in-a-hundred
     * event, and that is exactly how this shipped: the property was already
     * asserted, and the bug was still there. Measured before the fix, 1.3% of
     * Easy and Normal cases named their killer by silence — so a test that
     * would have caught it has to generate enough cases to expect two.
     *
     * Easy costs about 11 ms and Normal about 33 ms, so this is a second or
     * so for a hundred and forty cases.
     */
    for (const [preset, n] of [["easy", 90] as const, ["normal", 50] as const]) {
      for (let i = 0; i < n; i++) {
        const out = generate(newCaseId(preset, `silence${i}`));
        const c = out.case;
        expect(c, `${preset}/silence${i} made no case`).not.toBeNull();
        if (!c) continue;
        expect(
          silenceLeaks(c.frame, c.world, c.bank),
          `${preset}/silence${i}: the killer is the only one keeping quiet`,
        ).toEqual([]);
        expect(
          placementLeaks(c.frame, c.world, c.bank),
          `${preset}/silence${i}: the killer is the only unplaced suspect`,
        ).toEqual([]);
      }
    }
  });

  it("holds no card that no question would release", () => {
    // `allCards` is what the bank certificate and playTier are measured on,
    // and `generate.ts` documents the label as the grade a thorough player
    // faces. A card nothing releases is not part of that.
    for (const c of everyCase()) {
      expect(reachable(c.bank, allCards(c.bank))).toEqual([]);
    }
  });

  it("gives each suspect nothing to say about themselves", () => {
    // "Tell me about yourself" is the motive question, and `clueTopicKeys`
    // filters a speaker's own person topic out for exactly that reason.
    for (const c of everyCase()) {
      for (let s = 0; s < c.frame.suspects; s++) {
        expect(ask(c.bank, s, topic.person(s))).toEqual([]);
      }
    }
  });
});

describe("the pool it all comes from", () => {
  it("offers nothing false and nothing twice", () => {
    for (const c of everyCase()) {
      const honest = allCards(c.bank).filter(
        (k) =>
          !(k.source.kind === "testimony" && k.source.speaker === c.world.culprit),
      );
      expect(allTrue(c.frame, c.world, honest)).toBe(true);
      expect(distinct([...c.opening, ...allCards(c.bank)])).toBe(true);
    }
  });

  it("offers no card that settles the answer on its own", () => {
    // Asked of the SOLVER, not of the filter. The previous version asserted
    // `givesAwayAnswer(...) === false` over cards that `givesAwayAnswer` had
    // just filtered, so any weakening of the ban satisfied its own test.
    // This holds whatever the ban does or does not catch.
    for (const c of everyCase()) {
      for (const k of allCards(c.bank)) {
        const r = solve(c.frame, [...c.opening, k], { record: false });
        expect(
          r.finished,
          `${c.id.preset}: ${k.id} (${k.body.kind}) settles the answer alone`,
        ).toBe(false);
      }
    }
  });

  it("never lets a suspect speak from a vantage point only the killer has", () => {
    // Stated without calling `couldKnow`: rule 5 says nobody but the killer
    // is in r* from t* on, so no innocent's card may name a slot at which
    // its own speaker was standing there.
    for (const c of everyCase()) {
      for (const k of allCards(c.bank)) {
        if (k.source.kind !== "testimony") continue;
        const s = k.source.speaker;
        if (s === c.world.culprit) continue; // a story is not knowledge
        for (const t of clueMentions(k.body, c.frame).slots) {
          const stood = c.world.loc[s][t] === c.frame.murderRoom;
          expect(
            stood && t >= c.world.murderSlot,
            `${c.id.preset}: ${k.id} rests on suspect ${s} being in r* at ${t}`,
          ).toBe(false);
        }
      }
    }
  });

  it("refuses the killer the one thing only they could have seen", () => {
    // A unit test of the guard rather than a sweep over data it filtered:
    // standing over the body, the culprit is the only person who could count
    // the heads in that room, and saying so would name them.
    for (const c of everyCase()) {
      const { culprit, murderSlot } = c.world;
      for (let t = murderSlot; t < c.frame.slots; t++) {
        if (c.world.loc[culprit][t] !== c.frame.murderRoom) continue;
        const r = c.frame.murderRoom;
        for (const body of [
          { kind: "Occupied", r, t } as const,
          { kind: "Count", r, t, k: 1 } as const,
        ]) {
          expect(
            couldKnow(c.frame, c.world, culprit, body),
            `${c.id.preset}: the killer may say ${body.kind} about r* at ${t}`,
          ).toBe(false);
        }
      }
    }
  });

  it("offers no card that pins the murder hour against the briefing", () => {
    // The briefing's window is in the player's hand from the first second,
    // so a card is a giveaway when what it leaves *after* that window is one
    // slot — not merely when it names one slot by itself.
    for (const c of everyCase()) {
      const [lo, hi] = murderRange(c.frame.slots);
      for (const k of allCards(c.bank)) {
        if (k.body.kind === "DeathWindow") {
          expect(
            Math.max(k.body.a, lo) === Math.min(k.body.b, hi),
            `${c.id.preset}: ${k.id} leaves one hour standing`,
          ).toBe(false);
        }
        if (k.body.kind === "AliveAt") {
          expect(k.body.t + 1, `${c.id.preset}: ${k.id}`).not.toBe(hi);
        }
      }
    }
  });
});

describe("the proof set is not padded", () => {
  it("needs every card it kept, or says how many it did not", () => {
    // The greedy pass leaves a set minimal for the order it used, which is
    // not quite irredundance: tier 3 reads the whole clue list when it asks
    // whether everybody it supposes innocent has spoken, so an earlier drop
    // can change what a later one is allowed to do. Measured over these
    // sixteen cases a second pass finds nothing, and that is the honest way
    // to put it — a claim about these cases, not a theorem.
    for (const c of everyCase()) {
      const cap = PRESETS[c.id.preset].tier.max;
      for (const k of c.essential) {
        const without = c.clues.filter((x) => x.id !== k.id);
        expect(
          solve(c.frame, without, { maxTier: cap, record: false }).finished,
          `${c.id.preset}: ${k.id} was not needed`,
        ).toBe(false);
      }
    }
  });
});


describe("playing the case through", () => {
  /**
   * The test wave 2's review earned.
   *
   * Its hint tests asked whether a hint was true and whether the sequence
   * stopped, and both were — while following every hint left the player
   * unable to accuse, because the step record could not say which suspect an
   * elimination had cleared. So the question to ask is not "is the advice
   * sound" but "does taking it get you anywhere".
   *
   * This is that question one level up, for a generated case: start with the
   * opening, do exactly what the hint says, and see whether the notebook ends
   * up naming the killer and the hour.
   */
  it("following the hints, from the opening, ends in an accusation", () => {
    for (const c of everyCase()) {
      const notebook = newNotebook(c.frame);
      const cards: Clue[] = [...c.opening];
      const spent: string[] = [];
      let steps = 0;

      for (;;) {
        expect(steps++, `${c.id.preset}: the hints never finished`).toBeLessThan(400);
        const h = hint({
          frame: c.frame,
          cards,
          notebook,
          world: c.world,
          essential: c.essential,
        });
        // The player never guesses, so a mistake would have to be the hint
        // system inventing one. Thrown rather than asserted so that the union
        // narrows and the rest of the loop knows it holds an action.
        if (h.kind === "mistake") {
          throw new Error(`${c.id.preset}: the hints claimed a mistake — ${h.text}`);
        }
        if (h.kind === "accuse") break;
        if (h.kind === "deduction") {
          apply(c.frame, notebook, h.step.conclusion);
          continue;
        }
        // An action: take it, and put whatever it turns up in the notebook.
        spent.push(`${h.ask ?? "room"}:${h.topic}`);
        const got =
          h.ask !== null
            ? ask(c.bank, h.ask, h.topic)
            : examine(c.bank, Number(h.topic.slice(5)));
        const before = cards.length;
        for (const id of got) {
          const card = c.bank.cards.get(id);
          if (card && !cards.some((k) => k.id === card.id)) cards.push(card);
        }
        expect(
          cards.length,
          `${c.id.preset}: the hint named ${h.topic} and it released nothing new`,
        ).toBeGreaterThan(before);
      }

      // Everything crossed out is really false...
      expect(notebookIsSound(c.frame, notebook, c.world)).toBe(true);
      // ...and what is left standing is the answer, which is the whole point.
      const suspects = bitsOf(
        fullMask(c.frame.suspects) & ~notebook.clearedSuspects,
      );
      const slots = bitsOf(fullMask(c.frame.slots) & ~notebook.ruledOutSlots);
      expect(suspects, `${c.id.preset}: culprit not settled`).toEqual([
        c.world.culprit,
      ]);
      expect(slots, `${c.id.preset}: hour not settled`).toEqual([
        c.world.murderSlot,
      ]);
      // And par is a number in the same world as what it actually took.
      expect(spent.length).toBeGreaterThan(0);
      expect(new Set(spent).size).toBeLessThanOrEqual(c.investigation.par * 3);
    }
  });
});

/* ------------------------------------------------------------- helpers */

function signature(c: GeneratedCase): string {
  return [
    c.frame.murderRoom,
    c.world.culprit,
    c.world.murderSlot,
    c.tier,
    c.playTier,
    c.attempt,
    c.world.loc.map((row) => row.join("")).join("/"),
    c.clues.map((k) => `${k.id}:${k.source.kind}`).join(","),
    allCards(c.bank).map((k) => k.id).join(","),
    c.investigation.actions.map((a) => `${a.kind}:${a.topic}`).join(","),
  ].join("|");
}

function firstTopicOf(c: GeneratedCase, clue: Clue): string {
  const action = c.investigation.actions.find((a) =>
    a.releases.includes(clue.id),
  );
  expect(action, `no action releases ${clue.id}`).toBeDefined();
  return (action as { topic: string }).topic;
}

function roomOf(key: string): number {
  return Number(key.slice(5));
}
