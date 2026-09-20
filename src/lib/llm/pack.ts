/**
 * A shipped case: the whole thing, on disk, rather than a seed.
 *
 * **This is the one place a case is not its id**, and it is worth being
 * precise about why, because invariant 4 says the opposite everywhere else.
 * A case id is a seed plus a generator, so it rebuilds the same case only for
 * as long as the generator is unchanged. That is exactly the right trade for
 * a shared link — the puzzle travels in twelve characters — and exactly the
 * wrong one for a case somebody paid a model to write: a tuning change to the
 * clue selector, which the plan expects several more of, would quietly
 * re-point every shipped case at a different puzzle with the old prose still
 * attached to it. So a pack stores the case.
 *
 * Which means a codec, because `GeneratedCase` does not survive
 * `JSON.stringify`. The worker boundary gets away without one — structured
 * clone carries `Map` and `Set` — and `worker/protocol.ts` says so. Disk does
 * not. There are exactly four containers to handle and they are listed in
 * `encodeCase`; a fifth added later and forgotten would produce a case with
 * an empty bank and no visible symptom until somebody asked a question, which
 * is why `pack.test.ts` round-trips a real case and compares the whole object
 * rather than spot-checking fields.
 */

import { CASE_ID_VERSION, formatCaseId, parseCaseId } from "../engine/caseId";
import type { CaseId } from "../engine/caseId";
import { clueSentence } from "../engine/solver/explain";
import { answers } from "../engine/solver/exhaustive";
import { solve } from "../engine/solver/solve";
import type { Bank } from "../engine/generator/bank";
import type { GeneratedCase } from "../engine/generator/generate";
import type { Alibi } from "../engine/generator/lies";
import type { Clue, ClueId, RoomId } from "../engine/types";
import { skinGlossary } from "./skin/glossary";
import type { CaseSkin } from "./skin/schema";
import { parseSkin } from "./skinStore";

/** Bumped when a pack written by an older Skiron can no longer be read. */
export const PACK_VERSION = 1;

export interface CasePack {
  packVersion: number;
  /** The formatted id. Kept for display and for the save key. */
  id: string;
  /**
   * The generator version the case was built by.
   *
   * Recorded rather than enforced: the point of storing the whole case is
   * that it outlives a generator change. This is here so that a pack can say
   * how old it is, and so a future migration has something to switch on.
   */
  caseIdVersion: number;
  case: GeneratedCase;
  skin: CaseSkin | null;
  /**
   * The subject keys this case ships pictures for — wave 7.
   *
   * Keys, not paths and not bytes. A pack file is already the largest thing
   * the site serves and inlining 84 images as base64 would multiply it by
   * thirty; the pictures are ordinary files beside the JSON, at
   * `<pack>/<case id>/<key>.webp`, so the browser caches and decodes them the
   * way it is good at. This list is what says which exist, so nothing has to
   * probe for a 404 to find out.
   */
  images: string[];
}

/* ------------------------------------------------------------- encoding */

interface EncodedBank {
  said: [string, ClueId[]][];
  found: [number, ClueId[]][];
  cards: [ClueId, Clue][];
}

interface EncodedAlibi {
  room: RoomId;
  lies: Clue[];
  retracted: ClueId[];
  framed: number | null;
}

/**
 * The case as plain JSON.
 *
 * The four containers `JSON.stringify` would drop: `bank.said`, `bank.found`,
 * `bank.cards` and `alibi.retracted`. Everything else in a `GeneratedCase` is
 * numbers, strings, booleans, null and nested arrays.
 */
export function encodeCase(kase: GeneratedCase): unknown {
  const bank: EncodedBank = {
    said: [...kase.bank.said.entries()],
    found: [...kase.bank.found.entries()],
    cards: [...kase.bank.cards.entries()],
  };
  const alibi: EncodedAlibi | null = kase.alibi
    ? {
        room: kase.alibi.room,
        lies: kase.alibi.lies,
        retracted: [...kase.alibi.retracted],
        framed: kase.alibi.framed,
      }
    : null;
  return { ...kase, bank, alibi };
}

export function decodeCase(value: unknown): GeneratedCase | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const bag = value as Record<string, unknown>;

  const rawBank = bag.bank as EncodedBank | undefined;
  if (
    !rawBank ||
    !Array.isArray(rawBank.said) ||
    !Array.isArray(rawBank.found) ||
    !Array.isArray(rawBank.cards)
  ) {
    return null;
  }
  const bank: Bank = {
    said: new Map(rawBank.said),
    // The key is a `RoomId`, a number. JSON would have made it a string had
    // this been an object rather than a list of pairs; as pairs it survives,
    // and `Number()` is belt and braces for a pack hand-edited into strings.
    found: new Map(rawBank.found.map(([room, ids]) => [Number(room), ids])),
    cards: new Map(rawBank.cards),
  };

  const rawAlibi = bag.alibi as EncodedAlibi | null | undefined;
  const alibi: Alibi | null =
    rawAlibi && typeof rawAlibi === "object"
      ? {
          room: rawAlibi.room,
          lies: rawAlibi.lies ?? [],
          retracted: new Set(rawAlibi.retracted ?? []),
          framed: rawAlibi.framed ?? null,
        }
      : null;

  const out = { ...bag, bank, alibi } as unknown as GeneratedCase;
  // The shallow shape has to be there before anything reads it; the real
  // check is `verifyPack`, which re-proves the case from scratch.
  if (!out.frame || !out.world || !Array.isArray(out.clues)) return null;
  return out;
}

export function encodePack(pack: CasePack): unknown {
  return {
    packVersion: PACK_VERSION,
    id: pack.id,
    caseIdVersion: pack.caseIdVersion,
    case: encodeCase(pack.case),
    skin: pack.skin,
    images: pack.images,
  };
}

export function decodePack(value: unknown): CasePack | null {
  if (typeof value !== "object" || value === null) return null;
  const bag = value as Record<string, unknown>;
  if (bag.packVersion !== PACK_VERSION) return null;
  if (typeof bag.id !== "string" || parseCaseId(bag.id) === null) return null;

  const kase = decodeCase(bag.case);
  if (!kase) return null;

  return {
    packVersion: PACK_VERSION,
    id: bag.id,
    caseIdVersion: typeof bag.caseIdVersion === "number" ? bag.caseIdVersion : 0,
    case: kase,
    // A skin that will not parse costs the prose, not the case.
    skin: bag.skin === null || bag.skin === undefined ? null : parseSkin(bag.skin),
    images: imageKeys(bag.images),
  };
}

/**
 * The subject keys off a file, filtered to the ones this code understands.
 *
 * A key becomes a URL, so it is validated rather than trusted: `p` and digits
 * or the word `scene`, nothing else. A pack hand-edited to say `../../secret`
 * would otherwise be a path traversal dressed as a portrait.
 */
function imageKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (key): key is string => typeof key === "string" && /^(p\d{1,2}|scene)$/.test(key),
  );
}

export function packFor(
  id: CaseId,
  kase: GeneratedCase,
  skin: CaseSkin | null,
  images: string[] = [],
): CasePack {
  return {
    packVersion: PACK_VERSION,
    id: formatCaseId(id),
    caseIdVersion: CASE_ID_VERSION,
    case: kase,
    skin,
    images,
  };
}

/* ---------------------------------------------------------- verification */

/**
 * Prove a shipped case again, from the file.
 *
 * A pack is the one artefact that is not rebuilt by the engine on the way in,
 * so it is the one artefact whose fairness is not automatically true. This
 * re-runs both certificates on the decoded case — the exhaustive oracle and
 * the deduction solver — rather than trusting the numbers stored beside it.
 * Checking the stored tier against a stored tier would be the wave's own
 * warning played straight.
 *
 * Returns a list of complaints; empty means the case is sound.
 */
export function verifyPack(pack: CasePack): string[] {
  const problems: string[] = [];
  const kase = pack.case;
  const frame = kase.frame;

  if (parseCaseId(pack.id) === null) problems.push(`"${pack.id}" is not a case number`);

  // 1. Fair: exactly one answer, and it is the recorded one.
  const found = answers(frame, kase.clues);
  if (found.length !== 1) {
    problems.push(`the evidence admits ${found.length} answers, not one`);
  } else if (
    found[0].culprit !== kase.world.culprit ||
    found[0].slot !== kase.world.murderSlot
  ) {
    problems.push(
      `the evidence proves (${found[0].culprit}, ${found[0].slot}) but the case records ` +
        `(${kase.world.culprit}, ${kase.world.murderSlot})`,
    );
  }

  // 2. Graded: the deduction solver finishes, at the tier recorded.
  const run = solve(frame, kase.clues, { maxTier: kase.tier });
  if (!run.finished) problems.push(`the deduction solver does not finish at tier ${kase.tier}`);
  if (run.tier !== kase.tier) {
    problems.push(`the case records tier ${kase.tier}, the solver needed ${run.tier}`);
  }

  // 3. Every card the player can hold has something written on it.
  const glossary = pack.skin ? skinGlossary(pack.skin, frame) : undefined;
  const everything: Clue[] = [...kase.opening, ...kase.bank.cards.values()];
  for (const clue of everything) {
    const written = pack.skin?.prose[clue.id];
    if (typeof written === "string" && written.trim() !== "") continue;
    const template = clueSentence(frame, clue, glossary);
    if (template.trim() === "") problems.push(`${clue.id} has neither prose nor a sentence`);
  }

  // 4. A skin that is there must fit the case it is on.
  if (pack.skin) {
    if (pack.skin.rooms.length !== frame.plan.rooms.length) {
      problems.push(
        `the skin names ${pack.skin.rooms.length} rooms and the house has ` +
          `${frame.plan.rooms.length}`,
      );
    }
    if (pack.skin.people.length !== frame.people) {
      problems.push(
        `the skin names ${pack.skin.people.length} people and the cast is ${frame.people}`,
      );
    }
    if (pack.skin.slots.length !== frame.slots) {
      problems.push(
        `the skin names ${pack.skin.slots.length} hours and the evening has ${frame.slots}`,
      );
    }
    for (const id of Object.keys(pack.skin.prose)) {
      if (!everything.some((clue) => clue.id === id)) {
        problems.push(`the skin has prose for ${id}, which is not a card in this case`);
      }
    }
  }

  // 5. Every picture is of somebody in this cast, or of the place.
  //
  // What this can and cannot do: it checks that a key names a real subject,
  // not that a file exists, because this function is pure and runs in the
  // browser. `shipped.test.ts` does the filesystem half — the two together
  // are the plan's "every referenced image exists".
  //
  // And neither of them looks at what is *in* the picture. Nothing can. See
  // `art/prompts.ts`: an image cannot be fidelity-checked, which is why the
  // defence is in the prompt rather than here.
  const seen = new Set<string>();
  for (const key of pack.images) {
    if (seen.has(key)) problems.push(`${key} is listed twice`);
    seen.add(key);
    if (key === "scene") continue;
    const person = Number(key.slice(1));
    if (!Number.isInteger(person) || person < 0 || person >= frame.people) {
      problems.push(`there is a picture for ${key}, and the cast is ${frame.people} people`);
    }
  }

  return problems;
}

/* ---------------------------------------------------------- the manifest */

/** One line per case in a pack directory, for the home screen's browser. */
export interface PackEntry {
  id: string;
  title: string;
  setting: string;
  preset: string;
  /** How much of the prose survived the check. Shown to nobody; kept honest. */
  fallbacks: number;
  /** How many pictures this case ships, so the browser can say "illustrated". */
  images: number;
}

export interface PackManifest {
  packVersion: number;
  name: string;
  cases: PackEntry[];
}

export function entryFor(pack: CasePack): PackEntry {
  return {
    id: pack.id,
    title: pack.skin?.title ?? pack.id,
    setting: pack.skin?.setting ?? "",
    preset: pack.case.difficulty,
    fallbacks: pack.skin?.fidelity.fallback.length ?? 0,
    images: pack.images.length,
  };
}

export function parseManifest(value: unknown): PackManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const bag = value as Record<string, unknown>;
  if (bag.packVersion !== PACK_VERSION) return null;
  if (!Array.isArray(bag.cases)) return null;
  const cases: PackEntry[] = [];
  for (const raw of bag.cases) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || parseCaseId(item.id) === null) continue;
    cases.push({
      id: item.id,
      title: typeof item.title === "string" ? item.title : item.id,
      setting: typeof item.setting === "string" ? item.setting : "",
      preset: typeof item.preset === "string" ? item.preset : "",
      fallbacks: typeof item.fallbacks === "number" ? item.fallbacks : 0,
      // The trap this line exists to avoid: `parseManifest` builds its result
      // field by field, so a `PackEntry` that grows one and is not taught
      // here loses it silently on the way in, with no error anywhere. The
      // same trap as `Save.chat` in wave 6 and `parseSettings` before that —
      // whenever a stored shape grows a field, find its parser in the same
      // commit.
      images: typeof item.images === "number" ? item.images : 0,
    });
  }
  return {
    packVersion: PACK_VERSION,
    name: typeof bag.name === "string" ? bag.name : "cases",
    cases,
  };
}
