import { describe, expect, it } from "vitest";
import { frameOf, gridPlan } from "../testkit";
import type { CaseFrame, ClueBody, ClueKind, JsonSchema } from "../types";
import { CLUE_KINDS, canonical, clueCanonical, moduleFor } from "./index";
import { clueBodySchema, domainBounds, kindSchema, parseClueBody } from "./schema";

/*
 *   0 1 2     Six rooms, a door on every shared wall, the body in room 4.
 *   3 4 5     Three suspects (p0..p2) and the victim (p3); four slots.
 */
const PLAN = gridPlan(3, 2);
const FRAME: CaseFrame = frameOf({ plan: PLAN, suspects: 3, slots: 4, murderRoom: 4 });
/** A door that exists in this plan — between rooms 1 and 4. */
const DOOR = PLAN.doorBetween[1 * PLAN.rooms.length + 4];

/** One well-formed body per kind, in registry order. */
const SAMPLES: readonly ClueBody[] = [
  { kind: "At", p: 0, t: 0, r: 1 },
  { kind: "NotAt", p: 1, t: 2, r: 4 },
  { kind: "Stayed", p: 2, r: 5, t1: 0, t2: 1 },
  { kind: "Saw", p: 0, q: 1, t: 0, r: 1 },
  { kind: "Together", p: 0, q: 1, t: 0 },
  { kind: "AloneIn", p: 1, t: 2, r: 0 },
  { kind: "Occupied", r: 4, t: 2 },
  { kind: "Empty", r: 4, t: 3 },
  { kind: "Count", r: 1, t: 0, k: 2 },
  { kind: "Visited", p: 0, r: 4 },
  { kind: "NeverVisited", p: 1, r: 4 },
  { kind: "AliveAt", t: 1 },
  { kind: "DeathWindow", a: 1, b: 3 },
  { kind: "DoorClosed", door: DOOR, from: 1, to: 2 },
  { kind: "BarredDoor", p: 1, door: DOOR },
  { kind: "BarredRoom", p: 1, r: 4 },
  { kind: "Capacity", r: 1, k: 2 },
];

/** A body as the model would send it: a plain JSON object. */
const asJson = (body: ClueBody): unknown => JSON.parse(JSON.stringify(body)) as unknown;

describe("the registry declares every kind's fields", () => {
  it("covers all seventeen, in order", () => {
    expect(SAMPLES.map((b) => b.kind)).toEqual([...CLUE_KINDS]);
  });

  it("names exactly the payload's own fields, with nothing left out", () => {
    // The mapped type already makes this a compile error. The test is here
    // for the other half: that the declared names match the *sample*, i.e.
    // the shape the generator really produces.
    for (const body of SAMPLES) {
      const fields = moduleFor(body.kind).fields as Record<string, string>;
      const declared = Object.keys(fields).sort();
      const actual = Object.keys(body)
        .filter((k) => k !== "kind")
        .sort();
      expect([body.kind, declared]).toEqual([body.kind, actual]);
    }
  });
});

describe("the schema", () => {
  it("bounds each domain by this frame", () => {
    expect(domainBounds("person", FRAME)).toMatchObject({ min: 0, max: 3 });
    expect(domainBounds("room", FRAME)).toMatchObject({ min: 0, max: 5 });
    expect(domainBounds("slot", FRAME)).toMatchObject({ min: 0, max: 3 });
    expect(domainBounds("door", FRAME)).toMatchObject({ min: 0, max: PLAN.doors.length - 1 });
    // A count may equal the whole cast; a room can hold everybody.
    expect(domainBounds("count", FRAME)).toMatchObject({ min: 0, max: 4 });
  });

  it("pins a kind to itself and forbids invented fields", () => {
    const schema = kindSchema("At", FRAME);
    expect(schema.properties?.kind.enum).toEqual(["At"]);
    expect(schema.required).toEqual(["kind", "p", "t", "r"]);
    // Without this a model can answer with a field nobody reads, and the
    // claim it carries never reaches `extraClaims`.
    expect(schema.additionalProperties).toBe(false);
  });

  it("gives every field real bounds rather than any integer", () => {
    for (const kind of CLUE_KINDS) {
      const schema = kindSchema(kind, FRAME);
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        if (name === "kind") continue;
        expect([kind, name, property.type]).toEqual([kind, name, "integer"]);
        expect(typeof property.minimum).toBe("number");
        expect(typeof property.maximum).toBe("number");
      }
    }
  });

  it("offers the whole language as one union", () => {
    const schema = clueBodySchema(FRAME);
    expect(schema.anyOf).toHaveLength(CLUE_KINDS.length);
    const kinds = (schema.anyOf ?? []).map((s: JsonSchema) => s.properties?.kind.enum?.[0]);
    expect(kinds).toEqual([...CLUE_KINDS]);
  });
});

describe("reading a model's answer back", () => {
  it("round-trips every kind to the same canonical form", () => {
    for (const body of SAMPLES) {
      const parsed = parseClueBody(asJson(body), FRAME);
      expect([body.kind, parsed && canonical(parsed)]).toEqual([
        body.kind,
        canonical(body),
      ]);
    }
  });

  it("accepts a span written backwards, because the engine calls it one clue", () => {
    const forwards = parseClueBody({ kind: "Stayed", p: 2, r: 5, t1: 0, t2: 2 }, FRAME);
    const backwards = parseClueBody({ kind: "Stayed", p: 2, r: 5, t1: 2, t2: 0 }, FRAME);
    expect(backwards).not.toBeNull();
    expect(canonical(backwards!)).toBe(canonical(forwards!));
  });

  it("refuses an answer that is not a clue at all", () => {
    for (const value of [null, undefined, 3, "At", [], {}, { kind: "Nonsense" }]) {
      expect(parseClueBody(value, FRAME)).toBeNull();
    }
  });

  it("refuses a field that is missing, fractional or out of range", () => {
    expect(parseClueBody({ kind: "At", p: 0, t: 0 }, FRAME)).toBeNull();
    expect(parseClueBody({ kind: "At", p: 0, t: 0, r: 1.5 }, FRAME)).toBeNull();
    expect(parseClueBody({ kind: "At", p: 0, t: 0, r: 9 }, FRAME)).toBeNull();
    expect(parseClueBody({ kind: "At", p: -1, t: 0, r: 1 }, FRAME)).toBeNull();
    expect(parseClueBody({ kind: "At", p: 0, t: 0, r: "1" }, FRAME)).toBeNull();
  });

  it("refuses a body the kind's own rules reject", () => {
    // `Saw` needs two different people, and a `Stayed` of one slot is an `At`.
    expect(parseClueBody({ kind: "Saw", p: 1, q: 1, t: 0, r: 1 }, FRAME)).toBeNull();
    expect(parseClueBody({ kind: "Stayed", p: 0, r: 1, t1: 2, t2: 2 }, FRAME)).toBeNull();
  });
});

/*
 * The near-misses. The plan asks for these by name, and they are the reason
 * to trust a fallback rate of zero: if the comparison cannot reject, a run
 * where nothing falls back says nothing at all.
 */
describe("near-misses do not compare equal", () => {
  const differs = (a: ClueBody, b: ClueBody) => expect(canonical(a)).not.toBe(canonical(b));

  it("wrong slot", () => {
    differs({ kind: "At", p: 0, t: 0, r: 1 }, { kind: "At", p: 0, t: 1, r: 1 });
  });

  it("wrong room", () => {
    differs({ kind: "At", p: 0, t: 0, r: 1 }, { kind: "At", p: 0, t: 0, r: 2 });
  });

  it("wrong person", () => {
    differs({ kind: "At", p: 0, t: 0, r: 1 }, { kind: "At", p: 1, t: 0, r: 1 });
  });

  it("Saw read as Together — the room quietly dropped", () => {
    differs({ kind: "Saw", p: 0, q: 1, t: 0, r: 1 }, { kind: "Together", p: 0, q: 1, t: 0 });
  });

  it("Empty read as Count 0, and the other way round", () => {
    differs({ kind: "Empty", r: 4, t: 3 }, { kind: "Count", r: 4, t: 3, k: 0 });
  });

  it("At read as a one-slot Stayed", () => {
    // Not a legal `Stayed` at all, which is a stronger rejection: the parser
    // never produces it.
    expect(parseClueBody({ kind: "Stayed", p: 0, r: 1, t1: 0, t2: 0 }, FRAME)).toBeNull();
  });

  it("a swapped speaker, which the source carries and the body does not", () => {
    const body: ClueBody = { kind: "Saw", p: 0, q: 1, t: 0, r: 1 };
    const said = (speaker: number) =>
      clueCanonical({ id: "c1", body, source: { kind: "testimony", speaker } });
    expect(said(0)).not.toBe(said(2));
    expect(said(0)).not.toBe(clueCanonical({ id: "c1", body, source: { kind: "fact" } }));
  });
});

describe("what is NOT a near-miss", () => {
  it("the two people inside a Saw, which normalises on purpose", () => {
    // Worth a test of its own because it is the trap: `Saw` is symmetric as a
    // formula and who is speaking lives in `source`, so a check built on
    // "swap p and q" would be asserting the engine is broken.
    expect(canonical({ kind: "Saw", p: 0, q: 1, t: 0, r: 1 })).toBe(
      canonical({ kind: "Saw", p: 1, q: 0, t: 0, r: 1 }),
    );
    expect(canonical({ kind: "Together", p: 2, q: 0, t: 3 })).toBe(
      canonical({ kind: "Together", p: 0, q: 2, t: 3 }),
    );
  });

  it("a death window written backwards", () => {
    expect(canonical({ kind: "DeathWindow", a: 3, b: 1 })).toBe(
      canonical({ kind: "DeathWindow", a: 1, b: 3 }),
    );
  });

  it("and the parser agrees with the engine on both", () => {
    const one = parseClueBody({ kind: "Saw", p: 1, q: 0, t: 0, r: 1 }, FRAME);
    const two = parseClueBody({ kind: "Saw", p: 0, q: 1, t: 0, r: 1 }, FRAME);
    expect(canonical(one!)).toBe(canonical(two!));
  });
});

describe("every kind's canonical form is its own", () => {
  it("no two samples collide", () => {
    // If two kinds shared a canonical form the check could not tell their
    // sentences apart, and `Count 0` / `Empty` is the pair that nearly does.
    const seen = new Set(SAMPLES.map(canonical));
    expect(seen.size).toBe(SAMPLES.length);
  });
});
