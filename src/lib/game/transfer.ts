/**
 * A case as a file: writing one out, and reading one back.
 *
 * The format is the pack format, unchanged — `llm/pack.ts` already encodes a
 * whole case with its skin, handles the four containers `JSON.stringify`
 * would drop, and round-trips in its own tests. Inventing a second format for
 * the same job would be a second thing to keep in step with `GeneratedCase`,
 * and the first time they drifted the symptom would be an imported case with
 * an empty bank.
 *
 * Three decisions worth stating, because each one is a thing this could have
 * done and deliberately does not.
 *
 * **The key is not in it, and there is nothing to strip.** Invariant 9 is
 * kept by where the key lives rather than by filtering here: it is not in
 * `Settings`, not in a skin and not in a case, so a pack cannot carry one.
 * `transfer.test.ts` asserts that against the real exported bytes anyway,
 * because "cannot happen by construction" is exactly the class of claim that
 * stops being true quietly.
 *
 * **The pictures are dropped, and the file says so.** `CasePack.images` lists
 * subject keys, not bytes — the pictures are ordinary WebP files beside the
 * JSON — so an exported file cannot carry them without inlining 84 images as
 * base64 and multiplying the file by thirty. The recipient sees monograms,
 * which is what every undrawn case in Skiron already looks like, and `note`
 * tells them why rather than leaving them to wonder.
 *
 * **The player's progress is not in it either.** This shares a *case*, not a
 * save: the notebook, the cards collected and the transcript are the
 * recipient's to make. Exporting a half-solved case would hand over the
 * answer in the shape of the marks.
 */

import { PACK_VERSION, decodePack, encodePack, verifyPack } from "$lib/llm/pack";
import type { CasePack } from "$lib/llm/pack";
import type { GeneratedCase } from "$lib/engine/generator/generate";
import type { CaseSkin } from "$lib/llm/skin/schema";
import type { CaseId } from "$lib/engine/caseId";
import { packFor } from "$lib/llm/pack";

/** What a Skiron case file is called, and what it is. */
export const FILE_EXTENSION = ".skiron.json";
export const FILE_MIME = "application/json";

/**
 * The envelope around a pack, so a file can say what it is to a person who
 * opens it in a text editor and to a future version that has to migrate it.
 */
export interface CaseFile {
  skiron: "case";
  packVersion: number;
  /** Plain English, for whoever opens the file rather than the app. */
  note: string;
  pack: unknown;
}

const NOTE =
  "A Skiron case: the whole puzzle and its prose, with no pictures — the " +
  "recipient's copy will draw monograms instead. Open it at the bottom of " +
  "the Skiron home screen. It contains no API key and no saved progress.";

/** A filename that sorts sensibly and survives every filesystem. */
export function fileNameFor(pack: CasePack): string {
  const title = pack.skin?.title ?? "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${pack.id}-${slug}${FILE_EXTENSION}` : `${pack.id}${FILE_EXTENSION}`;
}

/**
 * The bytes to hand the browser, for a case that is on screen.
 *
 * Takes the pieces rather than a `Game` so that nothing in `llm/` or `game/`
 * has to import the controller, and so a tool can call it.
 */
export function exportCase(
  id: CaseId,
  kase: GeneratedCase,
  skin: CaseSkin | null,
): { name: string; text: string } {
  // No images: see the header. `packFor`'s default is already the empty list,
  // and it is passed explicitly here so that a future caller copying this
  // does not quietly start shipping keys to files that do not exist.
  const pack = packFor(id, kase, skin, []);
  const file: CaseFile = {
    skiron: "case",
    packVersion: PACK_VERSION,
    note: NOTE,
    pack: encodePack(pack),
  };
  return { name: fileNameFor(pack), text: JSON.stringify(file) };
}

export type ImportResult =
  | { ok: true; pack: CasePack }
  /** Always safe to put on screen: it never quotes the file. */
  | { ok: false; why: string };

/**
 * Read a case file, and **prove it again before it is played.**
 *
 * This is the one place in Skiron where a case arrives from outside with
 * nobody having certified it: a shipped pack was proved by the authoring tool
 * and is re-proved by `shipped.test.ts` on every `npm test`, and a generated
 * case is proved twice as it is made. A file from a stranger has neither, and
 * an unfair case — one the evidence does not pin down, or pins to somebody
 * else — would be a puzzle that cannot be solved and a Check that lies.
 *
 * So `verifyPack` runs on the way in. It re-runs the exhaustive oracle and
 * the deduction solver, which is around a second on the largest case; that is
 * a long time in a render loop and a perfectly ordinary time for opening a
 * file, and it is the only moment where the cost can be paid at all.
 */
export function importCase(text: string): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, why: "That file is not a Skiron case: it is not JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, why: "That file is not a Skiron case." };
  }
  const bag = value as Record<string, unknown>;

  // Tolerant of a bare pack as well as the envelope: the envelope is for
  // people reading the file, and refusing a valid pack because it lacked a
  // courtesy note would be pedantry.
  const inner = bag.skiron === "case" ? bag.pack : value;

  const pack = decodePack(inner);
  if (!pack) {
    return {
      ok: false,
      why: "That file is a Skiron case, but this version cannot read it.",
    };
  }

  const problems = verifyPack(pack);
  if (problems.length > 0) {
    // The complaint is not quoted: `verifyPack`'s strings are for a developer
    // and one of them can name a card id. The player needs to know the file
    // is not trustworthy, not which clue it was.
    return {
      ok: false,
      why:
        "That case does not check out — the evidence in it does not prove " +
        "the answer it claims. It has been refused rather than opened.",
    };
  }
  return { ok: true, pack };
}
