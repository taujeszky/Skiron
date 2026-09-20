/**
 * What an image model is asked for, and — more importantly — what it is not.
 *
 * **An image cannot be fidelity-checked.** Every other piece of model output
 * in this project is verified before a player sees it: the writer's prose by a
 * second model reading it back to the canonical clue, a suspect's reply by
 * string arithmetic in `interrogate/guards.ts`. A picture has no such check
 * and never will. There is no parse-back for a face.
 *
 * That single fact shapes this whole module. Since nothing downstream can
 * catch a picture that says something false, the only defence is that the
 * picture is never asked to say anything at all. Hence `FORBIDDEN` below, and
 * hence the two structural rules that are easy to miss:
 *
 * - **A portrait holds exactly one person.** Two figures in a frame is a
 *   claim about who was with whom, which is the entire subject of the game.
 * - **The scene holds nobody.** A person shown at a place is a placement, and
 *   placements are what the notebook is for.
 *
 * **What this module may see.** `artMaterial` is the only function here that
 * touches a `CaseSkin`, in the shape `skin/prompts.ts#writerMaterial` uses for
 * the same reason: `ArtMaterial` has no field for the summing-up, so the one
 * piece of skin prose that does name the killer cannot reach an image prompt
 * even by a careless edit. The portrait prompts themselves were written by
 * call A, which has never been told who the culprit is (see `WriterMaterial`),
 * so a tone that gives the answer away is closed off upstream as well.
 */

import type { CaseSkin } from "../skin/schema";

/** A portrait is `p` plus the person id; there is one scene. */
export type ArtKey = string;

export const SCENE_KEY = "scene";

export function portraitKey(person: number): ArtKey {
  return `p${person}`;
}

export function isPortraitKey(key: ArtKey): boolean {
  return /^p\d+$/.test(key);
}

/** The person a portrait key names, or null. */
export function keyPerson(key: ArtKey): number | null {
  const match = /^p(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

export interface ArtSubject {
  key: ArtKey;
  /** The writer's own prompt for this subject, verbatim. */
  prompt: string;
  /** Square for a face, wide for a place. */
  aspect: string;
  /** For the CLI's progress line and for an `alt` attribute. */
  label: string;
}

/**
 * Everything an image prompt may be built from.
 *
 * Deliberately not `CaseSkin`. See the note at the top: the skin carries
 * `summingUp`, which names the killer and the hour, and a type that cannot
 * reach it is worth more than a comment saying not to.
 */
export interface ArtMaterial {
  styleGuide: string;
  place: string;
  era: string;
  subjects: ArtSubject[];
}

export interface ArtMaterialOptions {
  /** Leave the victim out. One of the levers on the size of a paid batch. */
  suspectsOnly?: boolean;
  /** Leave the scene out, for a pack that shares one image per setting. */
  noScene?: boolean;
  /** Who the victim is, so `suspectsOnly` can drop the right person. */
  victim?: number;
}

/**
 * The bridge from a case's skin to the art layer, and the only one.
 *
 * A person with no portrait prompt is skipped rather than given a made-up
 * one: an empty prompt would produce a picture of nothing in particular and
 * cost the same as a good one. The monogram is a better answer than a bad
 * portrait, and it is free.
 */
export function artMaterial(skin: CaseSkin, options: ArtMaterialOptions = {}): ArtMaterial {
  const subjects: ArtSubject[] = [];

  skin.people.forEach((person, p) => {
    if (options.suspectsOnly && p === options.victim) return;
    const prompt = person.portrait?.trim() ?? "";
    if (prompt === "") return;
    subjects.push({
      key: portraitKey(p),
      prompt,
      aspect: "1:1",
      label: person.name,
    });
  });

  const scene = skin.scene?.trim() ?? "";
  if (!options.noScene && scene !== "") {
    subjects.push({
      key: SCENE_KEY,
      prompt: scene,
      aspect: "16:9",
      label: skin.place || skin.title,
    });
  }

  return {
    styleGuide: skin.styleGuide?.trim() ?? "",
    place: skin.place?.trim() ?? "",
    era: skin.era?.trim() ?? "",
    subjects,
  };
}

/* ------------------------------------------------------------- the prompt */

/**
 * The house treatment, identical for every case.
 *
 * Task 1 asks that cases "look like one game", and the style guide alone
 * cannot do that — it is a sentence written afresh per case by a model told
 * to be evocative, so left to itself it wanders between photography, oil
 * paint and pen sketch from one case to the next. This fixes the medium and
 * the framing; the style guide colours it in.
 */
export const HOUSE_STYLE = [
  "Painted editorial illustration for a detective game.",
  "Muted, slightly desaturated palette. Soft directional light, deep shadow.",
  "Visible brushwork; not photographic, not cartoon, not 3D render.",
  // One of seventeen came back as a painting of a framed painting, complete
  // with a white mount, which looked nothing like the sixteen beside it. The
  // point of a house style is that cases look like one game.
  "The image fills the frame edge to edge: no border, no mount, no vignette,",
  "and never a picture of a picture.",
].join(" ");

export const PORTRAIT_FRAMING = [
  "Head and shoulders, three-quarter view, eyes toward the viewer.",
  "Exactly one person in the frame, alone, against a plain dim background.",
  // The blunt one, and it is here rather than in `FORBIDDEN` because it has
  // to contradict the subject clause rather than merely add to it. Wave 5's
  // writer was asked for "a prompt for a portrait of them" with no
  // constraints, and produced "with an ink-stained ledger under her arm" and
  // "a heavy ring of iron keys"; the model obeyed those over the
  // prohibitions, because the subject comes first and is weighted most. The
  // schema is fixed for cases written from now on, but the prompts already
  // on disk cannot be, so this has to override them.
  "Their hands are empty and they hold, carry or wear no object of any kind:",
  "no book, paper, bag, tool, lamp, key, weapon or watch, whatever the",
  "description above says. Ignore any object it mentions and show the person",
  "without it.",
].join(" ");

export const SCENE_FRAMING = [
  "An establishing shot of the place from outside, or an empty interior.",
  "No people anywhere in the frame.",
].join(" ");

/**
 * The list that stands in for a fidelity check.
 *
 * Each line is a way a picture could assert something the engine never did.
 * Text is the obvious one; the other four are the ones worth spelling out,
 * because a model asked for "a detective game portrait" will reach for them
 * unprompted — a bloodied glove reads as evidence, a clock reads as an hour,
 * and both are answers to questions the player is meant to have to earn.
 */
export const FORBIDDEN = [
  "No text of any kind: no words, letters, numerals, signage, labels, captions or watermarks.",
  "No clocks, watches, sundials, calendars or anything else showing a time or date.",
  "No readable documents: no letters, newspapers, telegrams, ledgers, maps or floor plans.",
  "No weapons, blood, wounds, keys, or anything that reads as evidence of a crime.",
  "Nothing that suggests guilt, suspicion or fear. A calm, neutral, unremarkable likeness.",
];

/**
 * One image prompt.
 *
 * Order matters a little: the subject first, because the leading clause is
 * what a diffusion model weights most heavily, then the framing and style,
 * then the prohibitions last where they read as constraints rather than as
 * subject matter. ("No blood" early enough in a prompt is a good way to get
 * blood.)
 */
export function buildImagePrompt(material: ArtMaterial, subject: ArtSubject): string {
  const portrait = isPortraitKey(subject.key);
  const lines: string[] = [];

  lines.push(subject.prompt);

  const where = [material.place, material.era].filter((s) => s !== "").join(", ");
  if (where !== "") lines.push(`Setting: ${where}.`);

  lines.push(portrait ? PORTRAIT_FRAMING : SCENE_FRAMING);
  lines.push(HOUSE_STYLE);
  if (material.styleGuide !== "") lines.push(`Art direction: ${material.styleGuide}`);

  lines.push(...FORBIDDEN);
  return lines.join("\n");
}

/** Every prompt this material implies, in the order they should be generated. */
export function artPrompts(material: ArtMaterial): { subject: ArtSubject; prompt: string }[] {
  return material.subjects.map((subject) => ({
    subject,
    prompt: buildImagePrompt(material, subject),
  }));
}
