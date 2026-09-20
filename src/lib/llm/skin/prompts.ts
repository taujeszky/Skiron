/**
 * The three prompts, and the types that decide what each one may see.
 *
 * The rules about what a model is told are not comments here; they are
 * signatures. `writerMaterial` builds the writer's input out of a case and is
 * the only thing that touches a `GeneratedCase`, so `buildWriterPrompt` — the
 * function that makes the actual string — cannot reach the truth even by
 * accident: it is never handed one. `buildParseBackPrompt` is stricter still,
 * taking prose and a glossary and nothing else at all.
 *
 * **The trap this shape exists to avoid.** The fidelity check compares a
 * parse-back against the canonical form, and the natural way to write it is to
 * build the model's input from the formal clue. Do that and the check compares
 * the clue with itself: it passes whatever the prose says, forever, and looks
 * like a working guard the whole time. Waves 1, 2 and 3 were each reviewed
 * adversarially and each turned up the same shape of defect — a property that
 * was asserted, where the assertion was the broken part — so this one is
 * closed in the type system rather than in a review.
 */

import { canonical, clueCanonical } from "../../engine/clues";
import { clueBodySchema, kindMeaning } from "../../engine/clues/schema";
import { clueSentence } from "../../engine/solver/explain";
import { CLUE_KINDS } from "../../engine/clues";
import type {
  CaseFrame,
  Clue,
  ClueId,
  Glossary,
  JsonSchema,
  PersonId,
  SlotIndex,
} from "../../engine/types";

/* ------------------------------------------------------- call A, the writer */

/** One clue as the writer sees it: what it says, and who says it. */
export interface WriterClue {
  id: ClueId;
  /** The engine's own form, so the writer knows exactly what is being claimed. */
  canonical: string;
  /** The engine's own sentence, in placeholder names. */
  plain: string;
  /** The person id speaking, or null for physical evidence and house rules. */
  speaker: PersonId | null;
}

/**
 * Everything call A is given — and, by construction, everything it can be.
 *
 * There is no field here for the culprit, the murder slot, which statements
 * are false, or which clues the proof needs. The absence is the point: a
 * writer who knew would let it show in the tone, which is why the plan keeps
 * the answer from it.
 */
export interface WriterMaterial {
  setting: string;
  language: string;
  /** Rooms as the engine laid them out, with their neighbours. */
  rooms: { id: number; x: number; y: number; w: number; h: number; outdoor: boolean; neighbours: number[] }[];
  doors: { id: number; joins: [number, number] }[];
  slots: number;
  /** How many suspects; the victim is the person after them. */
  suspects: number;
  victim: PersonId;
  /** Where the body was found. The player is told this too. */
  murderRoom: number;
  lying: boolean;
  clues: WriterClue[];
}

/**
 * Pick the public parts of a case.
 *
 * The one function in this file that sees a whole case. Everything it copies
 * is something the player is shown or can collect; nothing it copies depends
 * on who did it. `prompts.test.ts` holds that to account by rebuilding the
 * prompt from a case whose culprit and murder slot have been changed, and
 * asserting the string does not move.
 */
export function writerMaterial(
  frame: CaseFrame,
  clues: readonly Clue[],
  options: { setting: string; language?: string },
): WriterMaterial {
  const rooms = frame.plan.rooms.length;
  return {
    setting: options.setting,
    language: options.language ?? "en",
    rooms: frame.plan.rooms.map((room) => ({
      id: room.id,
      x: room.rect.x,
      y: room.rect.y,
      w: room.rect.w,
      h: room.rect.h,
      outdoor: room.outdoor,
      neighbours: Array.from({ length: rooms }, (_, other) => other).filter(
        (other) => other !== room.id && (frame.plan.adjacency[room.id] & (1 << other)) !== 0,
      ),
    })),
    doors: frame.plan.doors.map((door) => ({ id: door.id, joins: [door.a, door.b] })),
    slots: frame.slots,
    suspects: frame.suspects,
    victim: frame.victim,
    murderRoom: frame.murderRoom,
    lying: frame.lying,
    clues: clues.map((clue) => ({
      id: clue.id,
      canonical: clueCanonical(clue),
      // The engine's sentence in placeholder names. Handing it over is an
      // addition to the plan, which said "canonical form" alone: a writer
      // shown `say(p1)|Saw(p0,p3,t4,r2)` and nothing else has to decode the
      // language before it can write, and every decoding mistake becomes a
      // fidelity failure that costs a retry. It leaks nothing — this is the
      // exact sentence the player sees when prose is unavailable.
      plain: clueSentence(frame, clue),
      speaker: clue.source.kind === "testimony" ? clue.source.speaker : null,
    })),
  };
}

export const WRITER_SYSTEM = [
  "You dress a finished murder-mystery puzzle in a setting. The puzzle is already",
  "written and already has exactly one solution. Your job is the words, and only",
  "the words.",
  "",
  "Rules, in order of how much damage breaking them does:",
  "",
  "1. INVENT NO FACTS. Each clue below is something the puzzle asserts. Write each",
  "   one out in your own words. Do not add any other claim about where any person",
  "   was, when they moved, who they were with, or who was alone — not in the clue",
  "   prose, not in the briefing, not in anybody's biography. Atmosphere, weather,",
  "   furniture, smells, history, grudges: all yours. Positions and times: not.",
  "",
  "2. YOU ARE NOT TOLD WHO DID IT, and you must not guess. Write every suspect as",
  "   somebody who plausibly could have. Give each of them a real motive of the",
  "   same weight. Do not foreshadow, do not make anybody's manner shifty, and do",
  "   not write a line that reads as a confession.",
  "",
  "3. ONE CLUE PER PASSAGE. A clue's prose states that clue and stops. Never merge",
  "   two clues into a sentence and never split one across two entries.",
  "",
  "4. VOICE. A clue with a speaker is that person talking: first person, their own",
  "   manner, as if answering a detective's question. A clue with no speaker is",
  "   physical evidence or a house rule: an inspector's notes, third person, dry.",
  "",
  "5. CONSISTENCY. Use the names and hours you invent everywhere, exactly as you",
  "   wrote them in the lists. Never write an engine id — no p2, no r5, no t3 —",
  "   in anything a reader sees.",
  "",
  "Write in the language named in the material. Keep each clue to one or two",
  "sentences.",
].join("\n");

export function buildWriterPrompt(material: WriterMaterial): string {
  const lines: string[] = [];
  const person = (p: PersonId) => (p === material.victim ? `p${p} (the victim)` : `p${p}`);

  lines.push(`THE SETTING ASKED FOR: ${material.setting}`);
  lines.push(`LANGUAGE: ${material.language}`);
  lines.push("");

  lines.push("THE HOUSE");
  lines.push(
    "Rooms are rectangles on a grid; x,y is the top-left corner. Name them so the " +
      "shape and the joins make sense — a room everything opens onto is a hall, a " +
      "room outdoors is a garden or a terrace.",
  );
  for (const room of material.rooms) {
    const where = `at ${room.x},${room.y} ${room.w}x${room.h}`;
    const joins = room.neighbours.length > 0 ? room.neighbours.map((n) => `r${n}`).join(", ") : "nothing";
    lines.push(
      `  r${room.id}${room.outdoor ? " (outdoors)" : ""} ${where}, opens onto ${joins}` +
        (room.id === material.murderRoom ? "  << the body was found here" : ""),
    );
  }
  lines.push("");
  lines.push("DOORS");
  for (const door of material.doors) {
    lines.push(`  d${door.id} joins r${door.joins[0]} and r${door.joins[1]}`);
  }
  lines.push("");

  lines.push("THE EVENING");
  lines.push(
    `  ${material.slots} hours, t0 to t${material.slots - 1}. Name each one the way a ` +
      "person in this setting would say it.",
  );
  lines.push(
    `  ${material.suspects} suspects, p0 to p${material.suspects - 1}, and the victim, ` +
      `p${material.victim}.`,
  );
  lines.push(
    material.lying
      ? "  The killer may lie. Everybody else tells the truth. You do not know which is which."
      : "  Nobody lies, but nobody volunteers everything either.",
  );
  lines.push("");

  lines.push("THE CLUES");
  lines.push(
    "Each line is: the clue's id, who is speaking, the engine's own form, and the " +
      "engine's own plain sentence. Write every one of them. Say exactly what the " +
      "plain sentence says, in your words and your names.",
  );
  for (const clue of material.clues) {
    const who = clue.speaker === null ? "no speaker (evidence or house rule)" : `${person(clue.speaker)} speaking`;
    lines.push(`  ${clue.id} | ${who} | ${clue.canonical} | ${clue.plain}`);
  }
  lines.push("");

  lines.push("WHAT TO RETURN");
  lines.push("  rooms   — one per room, in id order r0, r1, …");
  lines.push("  slots   — one per hour, in order t0, t1, …");
  lines.push(`  people  — one per person, in order p0 … p${material.victim}, the victim last`);
  lines.push("  prose   — one entry per clue id above, all of them, ids exactly as written");
  lines.push("  silence — one line per person: what they say when they have nothing to give");
  lines.push("  briefing — the paragraph the detective reads before starting");
  return lines.join("\n");
}

/* ------------------------------------------- call A again, the rewrite */

/** One clue to write again, and why the last attempt was not accepted. */
export interface RewriteRequest {
  id: ClueId;
  canonical: string;
  plain: string;
  speaker: PersonId | null;
  previous: string;
  complaint: string;
}

/**
 * Ask for new prose for the clues that failed.
 *
 * The complaint goes in verbatim. A retry that just says "try again" is worth
 * very little — the interesting failures are a sentence that says slightly
 * more than its clue, or that reads as the neighbouring clue, and both are
 * fixable in one attempt by somebody told exactly which it was.
 */
export function buildRewritePrompt(
  requests: readonly RewriteRequest[],
  material: WriterMaterial,
): string {
  const lines: string[] = [];
  lines.push(`THE SETTING: ${material.setting}`);
  lines.push(`LANGUAGE: ${material.language}`);
  lines.push("");
  lines.push(
    "These passages did not survive the check. An independent reader was shown each " +
      "one, without being told what it was meant to say, and reported what it " +
      "actually claims. Write each one again: say the one thing, say all of it, and " +
      "say nothing else about who was where, when, or with whom.",
  );
  lines.push("");
  for (const request of requests) {
    lines.push(`  ${request.id}`);
    lines.push(`    must say: ${request.plain}`);
    lines.push(`    engine form: ${request.canonical}`);
    lines.push(
      `    voice: ${request.speaker === null ? "an inspector's notes, third person" : `p${request.speaker} speaking, first person`}`,
    );
    lines.push(`    you wrote: ${request.previous}`);
    lines.push(`    the reader said: ${request.complaint}`);
    lines.push("");
  }
  lines.push("Keep the names, rooms and hours you already invented. Return one entry per id.");
  return lines.join("\n");
}

export function rewriteSchema(ids: readonly ClueId[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["prose"],
    properties: {
      prose: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text"],
          propertyOrdering: ["id", "text"],
          properties: {
            id: { type: "string", description: "The clue id", enum: [...ids] },
            text: { type: "string", description: "The clue, written again" },
          },
        },
      },
    },
  };
}

/* --------------------------------------------------- call C, the parse-back */

/**
 * A sentence to be read back, with nothing attached that could give the answer
 * away.
 *
 * `speaker` is a *name*, not an id, and is here only because a first-person
 * sentence cannot be resolved without knowing who is speaking. It is not
 * checked: the engine owns `clue.source`, the writer never chooses it, and
 * pretending to verify something the model was just told would be the same
 * self-confirming check this module is arranged to prevent.
 */
export interface ProseItem {
  /** An opaque id. Never the clue's own id, and never in the clue's order. */
  id: string;
  text: string;
  speaker: string | null;
}

export const PARSE_BACK_SYSTEM = [
  "You read one sentence at a time and say, in a fixed vocabulary, exactly what",
  "it claims about where people were and when. You are a translator, not a",
  "detective: do not infer, do not combine two sentences, do not use anything",
  "you concluded from another entry.",
  "",
  "For each entry, return:",
  "  - the single claim the sentence makes, as one clue in the schema;",
  "  - extraClaims: any FURTHER claim the same sentence makes about who was",
  "    where, when, with whom, or alone. Atmosphere, feelings, furniture,",
  "    weather, history and motive are not claims of that sort — leave those",
  "    out. If the sentence makes exactly one such claim, return an empty list.",
  "  - attributedTo: if the sentence says somebody OTHER than the speaker made",
  "    the observation, that person's id; otherwise -1.",
  "",
  "If a sentence does not state a claim you can express in the schema, or states",
  "more than one and you cannot tell which is meant, say so by returning the",
  "clue you think closest and listing the rest in extraClaims. Never guess a",
  "room, a person or an hour that the sentence does not name.",
].join("\n");

/**
 * The parse-back prompt.
 *
 * Takes prose, names and a schema. It is not given, and cannot be given, the
 * clues the prose was written from — see the note at the top of this file.
 */
export function buildParseBackPrompt(
  items: readonly ProseItem[],
  frame: CaseFrame,
  glossary: Glossary,
): string {
  const lines: string[] = [];

  lines.push("WHO AND WHERE AND WHEN");
  lines.push("People:");
  for (let p = 0; p < frame.people; p++) {
    lines.push(`  p${p} = ${glossary.personName(p)}${p === frame.victim ? " (the victim)" : ""}`);
  }
  lines.push("Rooms:");
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    lines.push(`  r${r} = ${glossary.roomName(r)}`);
  }
  lines.push("Hours, in order:");
  for (let t = 0; t < frame.slots; t++) {
    lines.push(`  t${t} = ${glossary.slotLabel(t)}`);
  }
  lines.push("Doors:");
  for (const door of frame.plan.doors) {
    lines.push(`  d${door.id} = between ${glossary.roomName(door.a)} and ${glossary.roomName(door.b)}`);
  }
  lines.push("");

  lines.push("THE VOCABULARY");
  for (const kind of CLUE_KINDS) {
    lines.push(`  ${kind}: ${kindMeaning(kind)}`);
  }
  lines.push("");

  lines.push("THE SENTENCES");
  for (const item of items) {
    const who = item.speaker === null ? "written in an inspector's notes" : `spoken by ${item.speaker}`;
    lines.push(`  [${item.id}] (${who}) ${item.text}`);
  }
  return lines.join("\n");
}

/** The shape the parse-back must answer in. */
export function parseBackSchema(frame: CaseFrame, ids: readonly string[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["readings"],
    properties: {
      readings: {
        type: "array",
        /*
         * No `minItems`/`maxItems`, and that is a measurement rather than an
         * oversight.
         *
         * With them, this request is a 400 `INVALID_ARGUMENT` as soon as the
         * count passes about thirteen — measured on gemini-3.8-flash on
         * 2026-09-20, passing at 12 and failing at 14, with the schema itself
         * growing by 48 bytes across that step. The cause is not size but
         * expansion: each item is a seventeen-branch `anyOf`, and a bounded
         * array appears to be compiled into that many copies of it. The
         * writer's arrays keep their bounds because their items are small.
         *
         * Nothing is lost. The `id` enum still confines each reading to an
         * entry that was actually sent, the prompt asks for one per entry,
         * and a reading that does not come back is reported as `missing` and
         * falls back to the template — which is the same treatment as a
         * reading that comes back wrong.
         */
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "clue", "extraClaims", "attributedTo"],
          propertyOrdering: ["id", "clue", "extraClaims", "attributedTo"],
          properties: {
            id: { type: "string", description: "The entry's id", enum: [...ids] },
            clue: clueBodySchema(frame),
            extraClaims: {
              type: "array",
              description: "Further claims about who was where, when or with whom",
              items: { type: "string" },
            },
            attributedTo: {
              type: "integer",
              description:
                "The person the sentence credits with the observation, if not the speaker; " +
                "otherwise -1",
              minimum: -1,
              maximum: frame.people - 1,
            },
          },
        },
      },
    },
  };
}

/* -------------------------------------------------- call B, the summing-up */

/** What call B is given. This one does know the answer — it is the confession. */
export interface SummingUpMaterial {
  culprit: string;
  victim: string;
  room: string;
  slot: string;
  motive: string;
  /** The proof, already in the skin's names, one template sentence per step. */
  proof: string[];
  styleGuide: string;
  language: string;
}

export const SUMMING_UP_SYSTEM = [
  "You are the detective, in the room, explaining how you know. Write the closing",
  "speech: a few short paragraphs, spoken aloud, in the voice of somebody who has",
  "just finished thinking.",
  "",
  "Name the killer. Name the hour. Walk the reasoning in the order it is given to",
  "you — each step is a real deduction from the evidence and none of them may be",
  "skipped or reordered. Do not invent a step, a witness or a piece of evidence.",
  "Do not have anyone confess, break down or be arrested; end on the reasoning.",
].join("\n");

export function buildSummingUpPrompt(material: SummingUpMaterial): string {
  const lines: string[] = [];
  lines.push(`LANGUAGE: ${material.language}`);
  lines.push(`STYLE: ${material.styleGuide}`);
  lines.push("");
  lines.push(`THE KILLER: ${material.culprit}`);
  lines.push(`THE VICTIM: ${material.victim}`);
  lines.push(`WHERE: ${material.room}`);
  lines.push(`WHEN: ${material.slot}`);
  lines.push(`WHY: ${material.motive}`);
  lines.push("");
  lines.push("THE PROOF, step by step:");
  material.proof.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
  return lines.join("\n");
}

export const SUMMING_UP_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["speech"],
  properties: {
    speech: {
      type: "string",
      description: "The detective's closing speech. A few paragraphs, separated by blank lines.",
    },
  },
};

/**
 * Does the speech actually name the killer and the hour?
 *
 * The plan calls this a lint, and it is: a cheap check that the one thing the
 * speech exists to say is in it. It cannot tell whether the reasoning is
 * right — nothing can, at this layer — so a failure means "use the engine's
 * own summing-up instead", which is always available and always correct.
 */
export function summingUpNames(speech: string, culprit: string, slot: string): boolean {
  const text = speech.toLowerCase();
  return text.includes(culprit.toLowerCase()) && text.includes(slot.toLowerCase());
}

/** For the lint, and for the tests that check the material is complete. */
export function summingUpMaterial(
  frame: CaseFrame,
  glossary: Glossary,
  answer: { culprit: PersonId; slot: SlotIndex },
  proof: string[],
  options: { motive: string; styleGuide: string; language?: string },
): SummingUpMaterial {
  return {
    culprit: glossary.personName(answer.culprit),
    victim: glossary.personName(frame.victim),
    room: glossary.roomName(frame.murderRoom),
    slot: glossary.slotLabel(answer.slot),
    motive: options.motive,
    proof,
    styleGuide: options.styleGuide,
    language: options.language ?? "en",
  };
}

/** Exported for the tests that assert on what a prompt does not contain. */
export function canonicalOf(clue: Clue): string {
  return canonical(clue.body);
}
