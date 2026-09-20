/**
 * The clue language as a JSON schema, and the way back from JSON to a clue.
 *
 * Wave 5's fidelity check hands a model some prose and a schema and asks what
 * clue the prose states. Both halves of that — the schema it is constrained
 * to, and the reader that turns its answer into something comparable — are
 * derived here from the `fields` each module declares, so that they cannot
 * disagree with each other or with `valid`.
 *
 * **Why the schema is built per frame.** A case has seven rooms, six people
 * and eight slots, and saying so in the schema (`minimum: 0, maximum: 6`) is
 * both a tighter constraint on the model and the exact bound the parser needs.
 * A frame-independent schema would have to allow any integer and then check
 * the bounds somewhere else, which is the drift this file exists to prevent.
 *
 * Nothing here knows about prose, glossaries, providers or prompts: it is the
 * engine's description of its own language, and `llm/skin/` is the only
 * caller.
 */

import type {
  BodyFields,
  CaseFrame,
  ClueBody,
  ClueKind,
  FieldDomain,
  JsonSchema,
} from "../types";
import { CLUE_KINDS, moduleFor, normalise, validBody } from "./index";

/** What a field of each domain may be, for this case. */
export function domainBounds(
  domain: FieldDomain,
  frame: CaseFrame,
): { min: number; max: number; what: string } {
  switch (domain) {
    case "person":
      return { min: 0, max: frame.people - 1, what: "a person, as p0, p1, …" };
    case "room":
      return { min: 0, max: frame.plan.rooms.length - 1, what: "a room, as r0, r1, …" };
    case "slot":
      return { min: 0, max: frame.slots - 1, what: "a time, as t0, t1, …" };
    case "door":
      return { min: 0, max: frame.plan.doors.length - 1, what: "a door, as d0, d1, …" };
    case "count":
      return { min: 0, max: frame.people, what: "how many people" };
  }
}

/** One kind's payload as a schema object. */
export function kindSchema(kind: ClueKind, frame: CaseFrame): JsonSchema {
  const fields = moduleFor(kind).fields;
  if (!fields) {
    // Unreachable through `KindModule`, which requires `fields`. Present
    // because `ClueModule` leaves it optional for the sake of anything
    // outside this directory that implements the contract.
    throw new Error(`clue kind ${kind} has no declared fields`);
  }

  const properties: Record<string, JsonSchema> = {
    kind: { type: "string", enum: [kind] },
  };
  const order = ["kind"];
  for (const [name, domain] of Object.entries(fields as Record<string, FieldDomain>)) {
    const bound = domainBounds(domain, frame);
    properties[name] = {
      type: "integer",
      description: bound.what,
      minimum: bound.min,
      maximum: bound.max,
    };
    order.push(name);
  }

  return {
    type: "object",
    description: KIND_MEANING[kind],
    properties,
    required: order,
    // The model must not invent a field. A claim that does not fit the
    // language belongs in `extraClaims`, where the check can see it, not in
    // a property nobody reads.
    additionalProperties: false,
    propertyOrdering: order,
  };
}

/** The whole clue language: any one of the seventeen payloads. */
export function clueBodySchema(frame: CaseFrame): JsonSchema {
  return { anyOf: CLUE_KINDS.map((kind) => kindSchema(kind, frame)) } as JsonSchema;
}

/**
 * Read a model's answer back into a clue body, or refuse.
 *
 * Refusing is the common case and must stay cheap: an unreadable answer is a
 * fidelity failure like any other, and the caller falls back to the template
 * sentence. Nothing here repairs, guesses a missing field or picks the
 * nearest kind.
 *
 * The body is normalised before `valid` runs, because the engine's own notion
 * of clue equality already normalises — `Stayed(p,r,t3,t1)` and
 * `Stayed(p,r,t1,t3)` are one clue — and rejecting the second spelling would
 * be the check reporting a difference the engine does not believe in.
 */
export function parseClueBody(value: unknown, frame: CaseFrame): ClueBody | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const bag = value as Record<string, unknown>;

  const kind = bag.kind;
  if (typeof kind !== "string") return null;
  if (!(CLUE_KINDS as readonly string[]).includes(kind)) return null;

  const fields = moduleFor(kind as ClueKind).fields as
    | Record<string, FieldDomain>
    | undefined;
  if (!fields) return null;

  const body: Record<string, unknown> = { kind };
  for (const [name, domain] of Object.entries(fields)) {
    const raw = bag[name];
    if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
    const bound = domainBounds(domain, frame);
    if (raw < bound.min || raw > bound.max) return null;
    body[name] = raw;
  }

  const candidate = normalise(body as unknown as ClueBody);
  return validBody(candidate, frame) ? candidate : null;
}

/**
 * What each kind means, in the words the model is given.
 *
 * Kept beside the schema rather than in a prompt file: it is part of the
 * description of the language, and a prompt that restated it would be a
 * second copy to drift. The wording leans on the distinctions the check has
 * to be able to make — `Saw` against `Together`, `Count 0` against `Empty`,
 * `Stayed` against `At` — because those are where a reader goes wrong.
 */
const KIND_MEANING: Record<ClueKind, string> = {
  At: "the person was in that room at that time",
  NotAt: "the person was NOT in that room at that time",
  Stayed:
    "the person was in that room for every time from t1 to t2, a span of at least two; " +
    "for a single time use At",
  Saw:
    "both people were in that room at that time, and the room is stated; " +
    "if the text does not say which room, use Together",
  Together:
    "both people were in the same room at that time, and the text does NOT say which room; " +
    "if it names the room, use Saw",
  AloneIn: "the person was in that room at that time with nobody else there",
  Occupied: "somebody was in that room at that time, without saying who",
  Empty: "nobody was in that room at that time",
  Count:
    "exactly k people were in that room at that time; use Empty rather than Count with k=0",
  Visited: "the person was in that room at some point during the evening",
  NeverVisited: "the person was never in that room at any time",
  AliveAt: "the victim was still alive at that time",
  DeathWindow: "the victim died at some time from a to b inclusive",
  DoorClosed: "that door could not be used between those two times",
  BarredDoor: "that person was not permitted to use that door",
  BarredRoom: "that person was not permitted to enter that room",
  Capacity: "that room held at most k people at any one time",
};

/** The meanings, for a prompt that wants to list the language. */
export function kindMeaning(kind: ClueKind): string {
  return KIND_MEANING[kind];
}

/** Type-only assertion that every kind declares its fields. Used by tests. */
export function declaredFields(kind: ClueKind): BodyFields<ClueKind> | undefined {
  return moduleFor(kind).fields as BodyFields<ClueKind> | undefined;
}
