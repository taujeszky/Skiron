/**
 * Dressing a case: call A, the check, call B.
 *
 * Three model calls per case, and the count is fixed rather than incidental —
 * the owner is owed an estimate before any of this is paid for, and an
 * estimate is only worth having if the number is a property of the code. The
 * retries are the variable part, and they are bounded: `WRITER_ATTEMPTS` for
 * an answer that does not fit the schema, `fidelityAttempts` for prose that
 * does not survive the check.
 *
 * The order matters. The writer goes first and is told nothing; the check is
 * a second model reading the first one's work with no idea what it was for;
 * the summing-up goes last and is the only call that knows who did it. A
 * summing-up written before the check would put the answer in the same
 * context as the prose being verified.
 */

import { allCards } from "../../engine/generator/bank";
import type { GeneratedCase } from "../../engine/generator/generate";
import { explainer } from "../../engine/solver/explain";
import type { Clue, ClueId, Glossary } from "../../engine/types";
import { LlmError } from "../errors";
import { WRITER_MODEL } from "../models";
import type { Provider } from "../provider";
import { checkFidelity, type FidelityResult, type Mismatch } from "./fidelity";
import { skinGlossary } from "./glossary";
import {
  type RewriteRequest,
  type WriterMaterial,
  SUMMING_UP_SCHEMA,
  SUMMING_UP_SYSTEM,
  WRITER_SYSTEM,
  buildRewritePrompt,
  buildSummingUpPrompt,
  buildWriterPrompt,
  rewriteSchema,
  summingUpMaterial,
  summingUpNames,
  writerMaterial,
} from "./prompts";
import {
  type CaseSkin,
  type SkinShape,
  type WriterOutput,
  assembleSkin,
  validateWriterOutput,
  writerSchema,
} from "./schema";

/** Tries at getting an answer that fits the schema. */
export const WRITER_ATTEMPTS = 3;

export type AuthorStage =
  | { kind: "writing"; attempt: number }
  | { kind: "checking"; pass: number; verified: number; of: number }
  | { kind: "rewriting"; count: number }
  | { kind: "summing-up" };

export interface AuthorOptions {
  setting: string;
  language?: string;
  signal?: AbortSignal;
  /** Honest progress: the loading screen says which of the three is running. */
  onStage?(stage: AuthorStage): void;
  writerAttempts?: number;
  fidelityAttempts?: number;
  model?: string;
  parserModel?: string;
  /** Skip call B. The authoring CLI's `--no-speech`, and the tests'. */
  summingUp?: boolean;
  temperature?: number;
}

export interface Authored {
  skin: CaseSkin;
  fidelity: FidelityResult;
  /** Model calls actually made, for the cost report. */
  calls: number;
}

/**
 * Every card the player can ever hold.
 *
 * Not `case.clues`, which is the opening plus the proof set: prose is needed
 * for anything the bank can release, or a suspect answers a question with a
 * dressed sentence one moment and a numbered one the next.
 */
export function cluesToDress(kase: GeneratedCase): Clue[] {
  return [...kase.opening, ...allCards(kase.bank)];
}

export async function authorSkin(
  provider: Provider,
  kase: GeneratedCase,
  options: AuthorOptions,
): Promise<Authored> {
  const frame = kase.frame;
  const language = options.language ?? "en";
  const clues = cluesToDress(kase);
  const material = writerMaterial(frame, clues, { setting: options.setting, language });
  let calls = 0;

  /* ------------------------------------------------ call A, and its retries */

  const written = await write(provider, material, clues, options, () => calls++);

  /* ------------------------------------------------------ the fidelity check */

  const draft: Record<ClueId, string> = {};
  for (const entry of written.prose) draft[entry.id] = entry.text;

  // The check needs the skin's names, because it is reading the skin's
  // sentences: a reader given "Suspect C" and a sentence about Mrs Pellworth
  // has no way to connect them.
  const glossary = skinGlossary(asSkin(written, options.setting, language), frame);

  const fidelity = await checkFidelity(provider, frame, glossary, clues, draft, {
    attempts: options.fidelityAttempts,
    signal: options.signal,
    model: options.parserModel,
    onPass: (pass, of, verified) => {
      calls++;
      options.onStage?.({ kind: "checking", pass, verified, of });
    },
    rewrite: async (mismatches) => {
      options.onStage?.({ kind: "rewriting", count: mismatches.length });
      calls++;
      return rewrite(provider, material, draft, mismatches, options);
    },
  });

  /* ------------------------------------------------- call B, the summing-up */

  let speech: string | null = null;
  if (options.summingUp !== false) {
    options.onStage?.({ kind: "summing-up" });
    calls++;
    speech = await summarise(provider, kase, glossary, written, options);
  }

  return {
    skin: assembleSkin(written, {
      setting: options.setting,
      language,
      prose: fidelity.prose,
      fidelity: fidelity.fidelity,
      summingUp: speech,
    }),
    fidelity,
    calls,
  };
}

/* ------------------------------------------------------------------ call A */

async function write(
  provider: Provider,
  material: WriterMaterial,
  clues: readonly Clue[],
  options: AuthorOptions,
  count: () => void,
): Promise<WriterOutput> {
  const attempts = options.writerAttempts ?? WRITER_ATTEMPTS;
  const ids = clues.map((clue) => clue.id);
  // Four numbers, read off the material rather than off the case: this
  // function has no route to a world, and should not acquire one.
  const shape: SkinShape = {
    rooms: material.rooms.length,
    slots: material.slots,
    people: material.victim + 1,
    victim: material.victim,
  };
  const schema = writerSchema(shape, ids);

  let complaints: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    options.onStage?.({ kind: "writing", attempt });
    count();
    const answer = await provider.generateJSON({
      system: WRITER_SYSTEM,
      user:
        complaints.length === 0
          ? buildWriterPrompt(material)
          : `${buildWriterPrompt(material)}\n\nYOUR LAST ANSWER WAS REJECTED:\n${complaints
              .map((problem) => `  - ${problem}`)
              .join("\n")}`,
      schema,
      model: options.model ?? WRITER_MODEL,
      temperature: options.temperature,
      signal: options.signal,
    });

    const { output, problems } = validateWriterOutput(answer, shape, ids);
    if (output) return output;
    complaints = problems;
  }
  throw new LlmError("malformed", `the writer's answer never fit: ${complaints.join("; ")}`);
}

/* --------------------------------------------------------------- rewriting */

async function rewrite(
  provider: Provider,
  material: WriterMaterial,
  draft: Record<ClueId, string>,
  mismatches: readonly Mismatch[],
  options: AuthorOptions,
): Promise<Record<ClueId, string>> {
  const byId = new Map(material.clues.map((clue) => [clue.id, clue]));
  const requests: RewriteRequest[] = [];
  for (const mismatch of mismatches) {
    const clue = byId.get(mismatch.id);
    if (!clue) continue;
    requests.push({
      id: clue.id,
      canonical: clue.canonical,
      plain: clue.plain,
      speaker: clue.speaker,
      previous: draft[mismatch.id] ?? "",
      complaint: mismatch.complaint,
    });
  }
  if (requests.length === 0) return {};

  const ids = requests.map((request) => request.id);
  const answer = await provider.generateJSON({
    system: WRITER_SYSTEM,
    user: buildRewritePrompt(requests, material),
    schema: rewriteSchema(ids),
    model: options.model ?? WRITER_MODEL,
    temperature: options.temperature,
    signal: options.signal,
  });

  const out: Record<ClueId, string> = {};
  const list = (answer as { prose?: unknown }).prose;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const item = raw as Record<string, unknown>;
      if (typeof item.id === "string" && typeof item.text === "string" && ids.includes(item.id)) {
        out[item.id] = item.text.trim();
      }
    }
  }
  // Whatever the model left out simply is not rewritten, and falls back.
  for (const id of ids) if (out[id] === "") delete out[id];
  return out;
}

/* ------------------------------------------------------------------ call B */

async function summarise(
  provider: Provider,
  kase: GeneratedCase,
  glossary: Glossary,
  written: WriterOutput,
  options: AuthorOptions,
): Promise<string | null> {
  const proof = explainer(kase.frame, kase.clues, glossary);
  const material = summingUpMaterial(
    kase.frame,
    glossary,
    { culprit: kase.world.culprit, slot: kase.world.murderSlot },
    kase.trace.map((step) => proof.step(step)),
    {
      motive: written.people[kase.world.culprit]?.motive ?? "",
      styleGuide: written.styleGuide,
      language: options.language ?? "en",
    },
  );

  let answer: unknown;
  try {
    answer = await provider.generateJSON({
      system: SUMMING_UP_SYSTEM,
      user: buildSummingUpPrompt(material),
      schema: SUMMING_UP_SCHEMA,
      model: options.model ?? WRITER_MODEL,
      temperature: options.temperature,
      signal: options.signal,
    });
  } catch (cause) {
    // Everything else about the case is finished and good. The engine's own
    // summing-up is always available, so a failed speech is a missing
    // flourish rather than a failed case.
    if (LlmError.from(cause).kind === "cancelled") throw cause;
    return null;
  }

  const speech = (answer as { speech?: unknown }).speech;
  if (typeof speech !== "string" || speech.trim() === "") return null;
  // The lint: if it does not name the killer and the hour, it is not the
  // speech, whatever else it is.
  return summingUpNames(speech, material.culprit, material.slot) ? speech.trim() : null;
}

/* ------------------------------------------------------------------ shared */

/** A skin with only the naming fields filled in, for the glossary. */
function asSkin(written: WriterOutput, setting: string, language: string): CaseSkin {
  return assembleSkin(written, {
    setting,
    language,
    prose: {},
    fidelity: { checked: 0, verified: 0, retried: 0, fallback: [] },
  });
}
