/**
 * Write cases: generate a puzzle, have the model dress it, check every
 * sentence, and save the whole thing as a pack.
 *
 * Run through vite-node so it can import the engine with the `$lib` alias:
 *
 *   npm run author -- --estimate --cases 3          what it would cost, no calls
 *   npm run author -- --dry-run --cases 3           the whole pipeline, stubbed
 *   npm run author -- --cases 3 --setting "a lighthouse in a storm, 1923"
 *
 * **`--estimate` makes no calls and is the mode to run first.** CLAUDE.md says
 * to tell the owner the expected number of API calls before any paid batch,
 * and a guess is not worth telling: this generates the real cases, builds the
 * real prompts and measures them, so the number it prints is what the run will
 * actually send.
 *
 * **`--dry-run` makes no calls either.** It drives the entire pipeline through
 * the stub provider — write, check, rewrite, fall back, encode, verify — so
 * the thing being paid for has already been proved to work end to end.
 *
 * The key is read at call time and never written anywhere: `--key=...`, then
 * `$GEMINI_API_KEY`, then `%USERPROFILE%\Desktop\gkey.txt`, which is the order
 * `../catalog-art/api.mjs` uses and the one thing on this machine that is
 * known to work (invariant 9).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { newCaseId, formatCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import { PRESET_NAMES } from "$lib/engine/solver/difficulty";
import { geminiProvider } from "$lib/llm/gemini";
import { WRITER_MODEL, PARSER_MODEL, PRICES } from "$lib/llm/models";
import { encodePack, entryFor, packFor, verifyPack, PACK_VERSION } from "$lib/llm/pack";
import { authorSkin, cluesToDress, WRITER_ATTEMPTS } from "$lib/llm/skin/author";
import { DEFAULT_ATTEMPTS as FIDELITY_ATTEMPTS } from "$lib/llm/skin/fidelity";
import { fallbackRate } from "$lib/llm/skin/fidelity";
import {
  WRITER_SYSTEM,
  PARSE_BACK_SYSTEM,
  buildParseBackPrompt,
  buildWriterPrompt,
  writerMaterial,
} from "$lib/llm/skin/prompts";
import { defaultGlossary } from "$lib/engine/solver/explain";
import { stubProvider } from "$lib/llm/stub";

/* ------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const all = (name) => {
  const out = [];
  for (let i = 0; i < argv.length - 1; i++) if (argv[i] === `--${name}`) out.push(argv[i + 1]);
  return out;
};

const PRESET = flag("preset", "normal");
const COUNT = Number(flag("cases", 3));
const SEED = flag("seed", null);
const LANGUAGE = flag("language", "en");
const OUT = flag("out", "static/cases/starter");
const NAME = flag("name", "starter");
const ESTIMATE = argv.includes("--estimate");
const DRY = argv.includes("--dry-run");
const NO_SPEECH = argv.includes("--no-speech");
const SETTINGS = all("setting");

const DEFAULT_SETTINGS = [
  "a lighthouse on a sandbar in a winter storm, 1923",
  "a Danube river steamer between two ports, 1908",
  "a mountain observatory snowed in for the season, 1957",
];

if (!PRESET_NAMES.includes(PRESET)) {
  console.error(`--preset must be one of ${PRESET_NAMES.join(", ")}`);
  process.exit(1);
}

/** base36, so consecutive seeds do not share a prefix. Same as sim.mjs. */
const seedOf = (i) => ((i * 2654435761) >>> 0).toString(36);

/* ------------------------------------------------------------------ keys */

/**
 * The key, read at the moment it is needed.
 *
 * Copied from `../catalog-art/api.mjs#loadKey`, including the shape check,
 * which turns a mistyped key into a sentence instead of a 400 from the far
 * end. Nothing here logs it, writes it or puts it in a URL.
 */
function loadKey() {
  const passed = argv.find((a) => a.startsWith("--key="));
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const fallback = join(home, "Desktop", "gkey.txt");
  const key = (
    (passed && passed.slice("--key=".length)) ||
    process.env.GEMINI_API_KEY ||
    (existsSync(fallback) ? readFileSync(fallback, "utf8") : "")
  ).trim();

  if (!key) {
    throw new Error(`no API key: pass --key=..., set GEMINI_API_KEY, or create ${fallback}`);
  }
  if (!/^AIza[\w-]{30,}$/.test(key)) throw new Error("that does not look like a Google API key");
  return key;
}

/* --------------------------------------------------------------- the run */

const settingFor = (i) =>
  SETTINGS.length > 0
    ? SETTINGS[i % SETTINGS.length]
    : DEFAULT_SETTINGS[i % DEFAULT_SETTINGS.length];

function buildCases() {
  const cases = [];
  for (let i = 0; i < COUNT; i++) {
    const id = newCaseId(PRESET, SEED ?? seedOf(i));
    const out = generate(id);
    if (!out.case) {
      console.error(`  ! ${formatCaseId(id)} did not generate`);
      continue;
    }
    cases.push({ id, case: out.case, setting: settingFor(i) });
    if (SEED) break;
  }
  return cases;
}

/* ------------------------------------------------------------- estimate */

/** Tokens, roughly. Four characters to the token is the usual rule of thumb. */
const tokens = (text) => Math.ceil(text.length / 4);

function estimate(cases) {
  console.log(`skiron author — estimate for ${cases.length} ${PRESET} case(s)\n`);
  console.log("No API call is made by this mode.\n");

  let writeIn = 0;
  let checkIn = 0;
  let cards = 0;

  for (const entry of cases) {
    const clues = cluesToDress(entry.case);
    cards += clues.length;
    const material = writerMaterial(entry.case.frame, clues, {
      setting: entry.setting,
      language: LANGUAGE,
    });
    writeIn += tokens(WRITER_SYSTEM) + tokens(buildWriterPrompt(material));

    // The parse-back carries the prose rather than the templates, and prose
    // is longer. Measured against the engine's own sentences and scaled: the
    // schema asks for one or two sentences where the template is one clause.
    const glossary = defaultGlossary(entry.case.frame);
    const items = clues.map((clue, i) => ({
      id: `s${i}`,
      text: "A sentence of prose about this clue, as the model would write it, in two clauses.",
      speaker: clue.source.kind === "testimony" ? glossary.personName(clue.source.speaker) : null,
    }));
    checkIn +=
      tokens(PARSE_BACK_SYSTEM) + tokens(buildParseBackPrompt(items, entry.case.frame, glossary));
  }

  // Output is dominated by the prose itself: one or two sentences per card,
  // plus the cast, rooms and briefing.
  const writeOut = Math.ceil(cards * 45 + cases.length * 700);
  // The reading is a small JSON object per card.
  const checkOut = Math.ceil(cards * 30);
  const speechIn = cases.length * 400;
  const speechOut = NO_SPEECH ? 0 : cases.length * 450;

  const perCase = NO_SPEECH ? 2 : 3;
  const best = cases.length * perCase;
  const worst = cases.length * (WRITER_ATTEMPTS + FIDELITY_ATTEMPTS + (FIDELITY_ATTEMPTS - 1) + (NO_SPEECH ? 0 : 1));

  const writer = PRICES[WRITER_MODEL];
  const parser = PRICES[PARSER_MODEL];
  const cost =
    ((writeIn + speechIn) / 1e6) * writer.in +
    ((writeOut + speechOut) / 1e6) * writer.out +
    (checkIn / 1e6) * parser.in +
    (checkOut / 1e6) * parser.out;

  console.log(`  cards to write        ${cards} across ${cases.length} case(s)`);
  console.log(`  calls, if nothing is retried   ${best}  (${perCase} per case)`);
  console.log(`  calls, worst case              ${worst}  (every retry taken)`);
  console.log("");
  console.log(`  writer  ${WRITER_MODEL}`);
  console.log(`    in  ~${writeIn + speechIn} tokens    out ~${writeOut + speechOut} tokens`);
  console.log(`  checker ${PARSER_MODEL}`);
  console.log(`    in  ~${checkIn} tokens    out ~${checkOut} tokens`);
  console.log("");
  console.log(`  cost, if nothing is retried    $${cost.toFixed(4)}`);
  console.log(`  cost, worst case               $${(cost * (worst / best)).toFixed(4)}`);
  console.log("");
  console.log("Input token counts are measured from the real prompts. Output counts are");
  console.log("estimated at ~45 tokens a card and are the least certain number here.");
}

/* ------------------------------------------------------------ the writing */

/** A stub that plays all three parts, for `--dry-run`. */
function dryProvider(kase) {
  const clues = cluesToDress(kase);
  const bodies = new Map(clues.map((clue) => [clue.id, clue.body]));
  return stubProvider({
    answer: (call) => {
      if (call.user.startsWith("THE SETTING ASKED FOR:")) {
        const frame = kase.frame;
        return {
          title: "A Dry Run",
          place: "nowhere in particular",
          era: "some year",
          styleGuide: "flat grey",
          rooms: frame.plan.rooms.map((_, r) => ({
            name: `the ${["hall", "library", "study", "kitchen", "orangery", "cellar", "landing", "garden", "shed"][r] ?? `room ${r}`}`,
            code: `D${r}`,
            description: "a room",
          })),
          slots: Array.from({ length: frame.slots }, (_, t) => `${t + 7} o'clock`),
          people: Array.from({ length: frame.people }, (_, p) => ({
            name: `Person ${String.fromCharCode(65 + p)}`,
            role: "somebody",
            bio: "A person. With a past.",
            voice: "flat",
            motive: p === frame.victim ? "" : "an old debt",
            portrait: "a face",
          })),
          prose: clues.map((clue) => ({ id: clue.id, text: `STUB(${clue.id}) it was so.` })),
          silence: Array.from({ length: frame.people }, () => "Nothing to add."),
          briefing: "A case was generated and nobody was paid to describe it.",
          scene: "a grey room",
        };
      }
      if (call.user.startsWith("WHO AND WHERE AND WHEN")) {
        const readings = [];
        for (const line of call.user.split("\n")) {
          const match = /^ {2}\[(s\d+)\] \([^)]*\) .*STUB\((c\d+)\)/.exec(line);
          if (match) {
            readings.push({
              id: match[1],
              clue: bodies.get(match[2]),
              extraClaims: [],
              attributedTo: -1,
            });
          }
        }
        return { readings };
      }
      if (call.user.includes("did not survive the check")) return { prose: [] };
      return {
        speech: `It was Person ${String.fromCharCode(65 + kase.world.culprit)}, at ${kase.world.murderSlot + 7} o'clock.`,
      };
    },
  });
}

async function main() {
  console.log(`skiron author — ${COUNT} ${PRESET} case(s)`);
  const cases = buildCases();
  if (cases.length === 0) {
    console.error("nothing generated");
    process.exit(1);
  }

  if (ESTIMATE) {
    estimate(cases);
    return;
  }

  let provider = null;
  if (!DRY) {
    // Read once here so a missing key fails before any case is generated —
    // but the source itself is a function, called per request.
    const key = loadKey();
    provider = geminiProvider({ key: () => key });
    console.log(`writing with ${WRITER_MODEL}, checking with ${PARSER_MODEL}\n`);
  } else {
    console.log("dry run: no key, no calls, stubbed answers\n");
  }

  mkdirSync(OUT, { recursive: true });
  const entries = [];
  let calls = 0;
  let checked = 0;
  let fellBack = 0;

  for (const entry of cases) {
    const text = formatCaseId(entry.id);
    process.stdout.write(`  ${text}  ${entry.setting}\n`);
    try {
      const out = await authorSkin(provider ?? dryProvider(entry.case), entry.case, {
        setting: entry.setting,
        language: LANGUAGE,
        summingUp: !NO_SPEECH,
        onStage: (stage) => {
          if (stage.kind === "checking") {
            process.stdout.write(`    checked ${stage.verified}/${stage.of}\n`);
          } else if (stage.kind === "rewriting") {
            process.stdout.write(`    rewriting ${stage.count}\n`);
          }
        },
      });
      calls += out.calls;
      checked += out.skin.fidelity.checked;
      fellBack += out.skin.fidelity.fallback.length;

      const pack = packFor(entry.id, entry.case, out.skin);
      const problems = verifyPack(pack);
      if (problems.length > 0) {
        // A pack that does not verify is not written. It would be a case that
        // looks shipped and is not provably fair.
        console.error(`    ! not written: ${problems.join("; ")}`);
        continue;
      }
      writeFileSync(join(OUT, `${text}.json`), JSON.stringify(encodePack(pack)));
      entries.push(entryFor(pack));
      const rate = fallbackRate(out.skin.fidelity);
      console.log(
        `    ok  ${out.skin.title} — ${out.skin.fidelity.verified}/${out.skin.fidelity.checked} verified` +
          `, fallback ${(rate * 100).toFixed(1)}%`,
      );
    } catch (err) {
      console.error(`    ! ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (entries.length > 0) {
    writeFileSync(
      join(OUT, "manifest.json"),
      JSON.stringify({ packVersion: PACK_VERSION, name: NAME, cases: entries }, null, 2),
    );
  }

  console.log("");
  console.log(`  written   ${entries.length}/${cases.length} into ${OUT}`);
  console.log(`  calls     ${calls}`);
  if (checked > 0) {
    console.log(`  fallback  ${fellBack}/${checked} = ${((fellBack / checked) * 100).toFixed(1)}%`);
  }
}

await main();
