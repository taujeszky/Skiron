/**
 * What the model is allowed to write, and what a written case looks like once
 * it has.
 *
 * A skin is decoration over a case that is already finished, already fair and
 * already proved. It holds names, prose and prompts; it holds no facts. That
 * split is invariant 1, and the type is drawn so that breaking it takes
 * effort: there is nowhere in `CaseSkin` to put a clue, a room adjacency, a
 * time or a culprit, because every one of those is an engine id that the skin
 * only ever *labels*.
 *
 * **Two departures from the plan's field list, both recorded in the plan.**
 *
 * 1. *Slot labels.* The plan lists rooms, people, rule fiction, prose,
 *    nothing-to-say lines, briefing, scene and summing-up — and no times. But
 *    `Glossary` has had `slotLabel` since wave 1, so without them a dressed
 *    case says "Mrs Pellworth was in the orangery at slot 5". The skin
 *    supplies the hours.
 * 2. *Rule fiction is not a separate field.* A case-file rule **is** a clue
 *    (`DoorClosed`, `BarredDoor`, `BarredRoom`, `Capacity`), so its fiction is
 *    prose for a clue id like any other, and one map covers both. The prose
 *    may carry the reason — "the causeway floods at high tide, so the sea
 *    door was locked from nine until eleven" — because the fidelity check
 *    asks only whether it states the clue and adds no claim about who was
 *    where when. Tide tables are not such a claim.
 */

import type { CaseFrame, ClueId, JsonSchema } from "../../engine/types";

/**
 * The four numbers the writer's schema and its validator actually need.
 *
 * A `CaseFrame` would do, and is deliberately not used: this way the two
 * functions below cannot reach a world, a bank or a clue even in principle,
 * and the authoring path does not have to pass a case into the half of the
 * code that talks to the writer. `shapeOf` is the only bridge.
 */
export interface SkinShape {
  rooms: number;
  slots: number;
  people: number;
  victim: number;
}

export function shapeOf(frame: CaseFrame): SkinShape {
  return {
    rooms: frame.plan.rooms.length,
    slots: frame.slots,
    people: frame.people,
    victim: frame.victim,
  };
}

/** Bumped when a stored skin can no longer be read by this code. */
export const SKIN_SCHEMA_VERSION = 1;

export interface SkinRoom {
  name: string;
  /** Two or three characters for the notebook grid and the floor plan. */
  code: string;
  /** One line, used as a tooltip and as material for the scene prompt. */
  description: string;
}

export interface SkinPerson {
  name: string;
  /** "the housekeeper", "the harbour master". */
  role: string;
  bio: string;
  /** How they speak, for wave 6's interrogation as much as for the prose. */
  voice: string;
  /**
   * Why they might have done it. Every suspect gets one: a cast where only
   * the culprit has a motive is a case that gives itself away, which is the
   * same shape of leak `bank.ts#silenceLeaks` guards against in the evidence.
   * Empty for the victim.
   */
  motive: string;
  /** Wave 7. Kept now because the writer is the one who knows the face. */
  portrait: string;
}

/** One clue's prose, keyed by the engine's clue id. */
export interface SkinProse {
  id: ClueId;
  text: string;
}

/** What the fidelity check made of the writing, kept with the skin. */
export interface SkinFidelity {
  /** Clues the check looked at. */
  checked: number;
  /** Clues whose prose parsed back to exactly the clue. */
  verified: number;
  /** How many needed a second or third attempt before they did. */
  retried: number;
  /** Clues that ended on the engine's template sentence instead. */
  fallback: ClueId[];
}

export interface CaseSkin {
  schemaVersion: number;
  /** BCP-47. English first; the field is why wave 9 can add another. */
  language: string;
  /** The player's own words, kept so a pack can show what was asked for. */
  setting: string;

  title: string;
  place: string;
  era: string;
  /** Art direction for wave 7, written by the same hand that named things. */
  styleGuide: string;

  /** One per room, in room id order. */
  rooms: SkinRoom[];
  /** One per slot, in slot order: "eight o'clock", "just after nine". */
  slots: string[];
  /** One per person, in person id order. The last is the victim. */
  people: SkinPerson[];

  /**
   * Verified prose, by clue id. A clue absent from this map is shown with the
   * engine's template sentence — which is the fallback invariant 6 demands,
   * and the reason this map is "verified prose" rather than "the model's
   * prose".
   */
  prose: Record<ClueId, string>;
  /** What a suspect says when they have nothing, one line per person. */
  silence: string[];
  /** The opening paragraph, shown on the briefing screen. */
  briefing: string;
  /** Wave 7's scene image prompt. */
  scene: string;
  /** Call B, written after the case is solved. Null until then. */
  summingUp: string | null;

  fidelity: SkinFidelity;
}

/* ------------------------------------------------------- the writer's shape */

/**
 * What call A is asked for: a skin minus everything the engine fills in.
 *
 * Separated from `CaseSkin` so that the model cannot be asked for, and cannot
 * supply, the fidelity record or the summing-up — one is a measurement of its
 * own work and the other needs the truth.
 */
export interface WriterOutput {
  title: string;
  place: string;
  era: string;
  styleGuide: string;
  rooms: SkinRoom[];
  slots: string[];
  people: SkinPerson[];
  prose: SkinProse[];
  silence: string[];
  briefing: string;
  scene: string;
}

/**
 * A string field.
 *
 * The length limit is named in the description rather than as `maxLength`,
 * because `responseJsonSchema` documents the keywords it honours and the
 * length ones are not among them — a `maxLength` here would look like a
 * constraint and be nothing of the kind. `validateWriterOutput` enforces it
 * where enforcement actually happens.
 */
const line = (description: string, max = 400): JsonSchema => ({
  type: "string",
  description: `${description}. At most ${max} characters.`,
});

/**
 * The schema call A is constrained to, built for one case.
 *
 * Counts are exact — `minItems` and `maxItems` both equal the number of rooms
 * — because "one per room, in order" is the whole contract between an array
 * and a set of engine ids, and a model that returns six names for seven rooms
 * has silently renumbered the house.
 */
export function writerSchema(shape: SkinShape, clueIds: readonly ClueId[]): JsonSchema {
  const rooms = shape.rooms;
  const exactly = (count: number, items: JsonSchema): JsonSchema => ({
    type: "array",
    items,
    minItems: count,
    maxItems: count,
  });
  const unbounded = (items: JsonSchema): JsonSchema => ({ type: "array", items });

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "place",
      "era",
      "styleGuide",
      "rooms",
      "slots",
      "people",
      "prose",
      "silence",
      "briefing",
      "scene",
    ],
    propertyOrdering: [
      // Setting first, prose last: the model writes the world before it
      // writes the sentences that live in it.
      "title",
      "place",
      "era",
      "styleGuide",
      "rooms",
      "slots",
      "people",
      "silence",
      "briefing",
      "scene",
      "prose",
    ],
    properties: {
      title: line("The case's title, a few words", 80),
      place: line("Where it happens, a phrase", 120),
      era: line("When it happens, a phrase", 80),
      styleGuide: line("How pictures of this world should look, one sentence"),
      rooms: exactly(rooms, {
        type: "object",
        additionalProperties: false,
        required: ["name", "code", "description"],
        propertyOrdering: ["name", "code", "description"],
        properties: {
          name: line("The room's name, as it would be spoken: 'the orangery'", 60),
          code: {
            type: "string",
            description: "Exactly two or three letters for a grid column, uppercase",
          },
          description: line("One line about the room"),
        },
      }),
      slots: exactly(shape.slots, line("The hour, as a person would say it", 40)),
      people: exactly(shape.people, {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "bio", "voice", "motive", "portrait"],
        propertyOrdering: ["name", "role", "bio", "voice", "motive", "portrait"],
        properties: {
          name: line("Their name", 60),
          role: line("Their place in the house: 'the housekeeper'", 60),
          bio: line("Two sentences about them"),
          voice: line("How they speak, one sentence"),
          motive: line(
            "Why this person might have wanted the victim dead. Every suspect " +
              "needs a real one. Empty string for the victim.",
          ),
          portrait: line("A prompt for a portrait of them"),
        },
      }),
      /*
       * Unbounded, unlike every other array here, and measured rather than
       * chosen.
       *
       * With `minItems`/`maxItems` this request is a 400 `INVALID_ARGUMENT`
       * once the case has more than about fifty cards — accepted at 50,
       * refused at 54, on gemini-3.7-flash on 2026-09-20. It is the same
       * limit the parse-back hit: a bounded array multiplies its item schema,
       * and this item carries an `enum` of every clue id, so the cost grows
       * with the square of the case. Expert cases reach 54 cards, so one in
       * six of them failed outright.
       *
       * The other arrays keep their bounds: rooms, hours and people are at
       * most nine, and "exactly one per room, in order" is the whole contract
       * between an array and a set of engine ids.
       *
       * Nothing is lost. `validateWriterOutput` already checks coverage and
       * names what is missing — "prose is missing: c14, c23" — which is a
       * better complaint to hand a retry than a schema refusal, because it
       * says which ones.
       */
      prose: unbounded({
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        propertyOrdering: ["id", "text"],
        properties: {
          id: {
            type: "string",
            description: "The clue's id, exactly as given",
            enum: [...clueIds],
          },
          text: line("The clue, written out. One or two sentences.", 500),
        },
      }),
      silence: exactly(
        shape.people,
        line("What this person says when they have nothing to offer", 200),
      ),
      briefing: line("The opening paragraph the detective is given", 1200),
      scene: line("A prompt for one picture of the place"),
    },
  };
}

/* ------------------------------------------------------------- validation */

/**
 * Check the model's answer, listing everything wrong with it.
 *
 * Every complaint is a sentence that can be handed straight back to the model
 * on the retry, which is why they name the field and say what was expected.
 * Nothing is repaired: a half-accepted skin is a case that is dressed in
 * places and numbered in others.
 */
export function validateWriterOutput(
  value: unknown,
  shape: SkinShape,
  clueIds: readonly ClueId[],
): { output: WriterOutput | null; problems: string[] } {
  const problems: string[] = [];
  const fail = (text: string): { output: null; problems: string[] } => {
    problems.push(text);
    return { output: null, problems };
  };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("the answer was not a JSON object");
  }
  const bag = value as Record<string, unknown>;

  const text = (key: string, max: number): string => {
    const raw = bag[key];
    if (typeof raw !== "string" || raw.trim() === "") {
      problems.push(`"${key}" must be a non-empty string`);
      return "";
    }
    if (raw.length > max) problems.push(`"${key}" must be at most ${max} characters`);
    return raw.trim();
  };

  const title = text("title", 80);
  const place = text("place", 120);
  const era = text("era", 80);
  const styleGuide = text("styleGuide", 400);
  const briefing = text("briefing", 1200);
  const scene = text("scene", 400);

  const rooms: SkinRoom[] = [];
  const roomCount = shape.rooms;
  const rawRooms = bag.rooms;
  if (!Array.isArray(rawRooms) || rawRooms.length !== roomCount) {
    problems.push(`"rooms" must be an array of exactly ${roomCount}, one per room in order`);
  } else {
    for (let r = 0; r < roomCount; r++) {
      const item = rawRooms[r] as Record<string, unknown> | undefined;
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const code = typeof item?.code === "string" ? item.code.trim() : "";
      const description = typeof item?.description === "string" ? item.description.trim() : "";
      if (name === "") problems.push(`rooms[${r}].name is missing`);
      if (!/^[\p{L}\p{N}]{2,3}$/u.test(code)) {
        problems.push(`rooms[${r}].code must be two or three letters or digits`);
      }
      rooms.push({ name, code: code.toUpperCase(), description });
    }
    const codes = new Set(rooms.map((room) => room.code));
    if (codes.size !== rooms.length) {
      // The codes are the notebook's column headings. Two rooms sharing one
      // makes the grid unreadable in a way nothing else would catch.
      problems.push("every room code must be different from every other");
    }
    const names = new Set(rooms.map((room) => room.name.toLowerCase()));
    if (names.size !== rooms.length) problems.push("every room name must be different");
  }

  const slots: string[] = [];
  const rawSlots = bag.slots;
  if (!Array.isArray(rawSlots) || rawSlots.length !== shape.slots) {
    problems.push(`"slots" must be an array of exactly ${shape.slots}, one per hour in order`);
  } else {
    for (let t = 0; t < shape.slots; t++) {
      const label = typeof rawSlots[t] === "string" ? (rawSlots[t] as string).trim() : "";
      if (label === "") problems.push(`slots[${t}] is missing`);
      slots.push(label);
    }
    if (new Set(slots.map((s) => s.toLowerCase())).size !== slots.length) {
      problems.push("every hour must be named differently from every other");
    }
  }

  const people: SkinPerson[] = [];
  const rawPeople = bag.people;
  if (!Array.isArray(rawPeople) || rawPeople.length !== shape.people) {
    problems.push(
      `"people" must be an array of exactly ${shape.people}, in order, the victim last`,
    );
  } else {
    for (let p = 0; p < shape.people; p++) {
      const item = rawPeople[p] as Record<string, unknown> | undefined;
      const get = (field: string): string =>
        typeof item?.[field] === "string" ? (item[field] as string).trim() : "";
      const name = get("name");
      if (name === "") problems.push(`people[${p}].name is missing`);
      const motive = get("motive");
      // The victim has no motive; every suspect must have one, or the cast
      // itself tells the player who to look at.
      if (p !== shape.victim && motive === "") {
        problems.push(`people[${p}].motive is missing — every suspect needs one`);
      }
      people.push({
        name,
        role: get("role"),
        bio: get("bio"),
        voice: get("voice"),
        motive,
        portrait: get("portrait"),
      });
    }
    if (new Set(people.map((person) => person.name.toLowerCase())).size !== people.length) {
      problems.push("every person must be named differently from every other");
    }
  }

  const silence: string[] = [];
  const rawSilence = bag.silence;
  if (!Array.isArray(rawSilence) || rawSilence.length !== shape.people) {
    problems.push(`"silence" must be an array of exactly ${shape.people}, one per person`);
  } else {
    for (let p = 0; p < shape.people; p++) {
      const said = typeof rawSilence[p] === "string" ? (rawSilence[p] as string).trim() : "";
      if (said === "") problems.push(`silence[${p}] is missing`);
      silence.push(said);
    }
  }

  const prose: SkinProse[] = [];
  const rawProse = bag.prose;
  if (!Array.isArray(rawProse)) {
    problems.push(`"prose" must be an array of {id, text}, one per clue`);
  } else {
    const wanted = new Set(clueIds);
    const seen = new Set<string>();
    for (const item of rawProse as Record<string, unknown>[]) {
      const id = typeof item?.id === "string" ? item.id : "";
      const body = typeof item?.text === "string" ? item.text.trim() : "";
      if (!wanted.has(id)) {
        problems.push(`prose has an entry for "${id}", which is not one of the clues`);
        continue;
      }
      if (seen.has(id)) {
        problems.push(`prose has two entries for "${id}"`);
        continue;
      }
      seen.add(id);
      if (body === "") {
        problems.push(`prose for "${id}" is empty`);
        continue;
      }
      prose.push({ id, text: body });
    }
    const missing = clueIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      problems.push(`prose is missing: ${missing.join(", ")}`);
    }
  }

  if (problems.length > 0) return { output: null, problems };
  return {
    output: {
      title,
      place,
      era,
      styleGuide,
      rooms,
      slots,
      people,
      prose,
      silence,
      briefing,
      scene,
    },
    problems,
  };
}

/** The finished skin, once the prose has been checked. */
export function assembleSkin(
  written: WriterOutput,
  options: {
    setting: string;
    language: string;
    prose: Record<ClueId, string>;
    fidelity: SkinFidelity;
    summingUp?: string | null;
  },
): CaseSkin {
  return {
    schemaVersion: SKIN_SCHEMA_VERSION,
    language: options.language,
    setting: options.setting,
    title: written.title,
    place: written.place,
    era: written.era,
    styleGuide: written.styleGuide,
    rooms: written.rooms,
    slots: written.slots,
    people: written.people,
    prose: options.prose,
    silence: written.silence,
    briefing: written.briefing,
    scene: written.scene,
    summingUp: options.summingUp ?? null,
    fidelity: options.fidelity,
  };
}
