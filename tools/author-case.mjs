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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { newCaseId, formatCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import { PRESET_NAMES } from "$lib/engine/solver/difficulty";
import { geminiProvider } from "$lib/llm/gemini";
import {
  WRITER_MODEL,
  PARSER_MODEL,
  PRICES,
  IMAGE_QUALITIES,
  imageGrade,
} from "$lib/llm/models";
import { artMaterial } from "$lib/llm/art/prompts";
import { estimateArt, generateArt } from "$lib/llm/art/art";
import { decodePack, encodePack, entryFor, packFor, verifyPack, PACK_VERSION } from "$lib/llm/pack";
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

/* ------------------------------------------------------------ wave 7: art */

const ART = argv.includes("--art");
const QUALITY = flag("quality", "fast");
/**
 * 512 px, as the plan asks.
 *
 * catalog-art puts its card art at 560 px q64 and lands at about 7 KB an
 * image, which is the measurement worth carrying over: a portrait shown at
 * 34 px in the cast strip and maybe 120 px on a briefing has nothing to gain
 * from more. The scene is wider, so it gets its own number.
 */
const PORTRAIT_PX = Number(flag("portrait-px", 512));
const SCENE_PX = Number(flag("scene-px", 1024));
const WEBP_QUALITY = Number(flag("webp-quality", 68));
/** Leave the victim out — one of the levers on what a pack costs. */
const SUSPECTS_ONLY = argv.includes("--suspects-only");
const NO_SCENE = argv.includes("--no-scene");
/**
 * Draw pictures for packs that already exist, without rewriting their prose.
 *
 * Two jobs, both of which came up the moment there was a real pack. Cases
 * written before wave 7 need art added, and paying the writer again to get it
 * would also replace a skin somebody has already read and approved. And when
 * one portrait out of eighty-four comes back unusable, this is how it is
 * redrawn — `--only` names the subject, and everything already on disk is
 * skipped unless `--redraw` says otherwise.
 */
const ART_ONLY = argv.includes("--art-only");
const ONLY = all("only");
const REDRAW = argv.includes("--redraw");

if (ART && !IMAGE_QUALITIES.includes(QUALITY)) {
  console.error(`--quality must be one of ${IMAGE_QUALITIES.join(", ")}`);
  process.exit(1);
}

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

/**
 * Where to start counting, so a second run does not land on the first's cases.
 *
 * `seedOf(0)` is "0", which is the seed of the three cases wave 5 shipped, so
 * adding to that pack without this would rewrite one of them and quietly
 * replace a skin somebody has already read.
 */
const SEED_FROM = Number(flag("seed-from", 0));

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
    const id = newCaseId(PRESET, SEED ?? seedOf(SEED_FROM + i));
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

/**
 * Write a manifest describing every pack file in a directory.
 *
 * Reads each one back through the decoder rather than trusting this run's own
 * results, so a file that will not decode is left out of the manifest instead
 * of being advertised and then failing to open.
 */
function writeManifest(dir, name) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const cases = [];
  for (const f of files.sort()) {
    const pack = decodePack(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!pack) {
      console.error(`    ! ${f} does not decode; leaving it out of the manifest`);
      continue;
    }
    cases.push(entryFor(pack));
  }
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ packVersion: PACK_VERSION, name, cases }, null, 2),
  );
  return cases.length;
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

  if (ART) {
    // Kept apart from the sum above on purpose: an image is billed per
    // picture, so running it through a per-million-tokens calculation gives a
    // number that is wrong by orders of magnitude and looks plausible.
    let images = 0;
    let art = 0;
    for (const entry of cases) {
      const frame = entry.case.frame;
      // The skin does not exist yet at estimate time, so the subjects are
      // counted from the cast rather than from portrait prompts. That is the
      // right way round for a quote: it is the number of pictures the writer
      // will be asked for, and it cannot be under.
      const material = fakeMaterial(frame);
      const out = estimateArt(material, QUALITY);
      images += out.calls;
      art += out.cost;
    }
    const grade = imageGrade(QUALITY);
    console.log("");
    console.log(`  images  ${grade.model} at ${grade.size}`);
    console.log(`    pictures                     ${images}`);
    console.log(`    cost at $${grade.price.toFixed(3)} each     $${art.toFixed(2)}`);
    console.log("");
    console.log(`  EVERYTHING                     $${(cost + art).toFixed(2)}`);
    console.log("");
    console.log("  The per-image price is the least certain number here: the pricing page");
    console.log("  gives a range without saying which resolution costs which. Re-read it");
    console.log("  before a large batch and treat this as an upper bound.");
  }

  console.log("");
  console.log("Input token counts are measured from the real prompts. Output counts are");
  console.log("estimated at ~45 tokens a card and are the least certain number here.");
}

/**
 * The subjects a case will have, before anybody has written a prompt for them.
 *
 * `artMaterial` skips a person with no portrait prompt, which is right at
 * generation time and wrong for an estimate — so this hands it a placeholder
 * per person and lets the real `suspectsOnly`/`noScene` levers apply.
 */
function fakeMaterial(frame) {
  const people = Array.from({ length: frame.people }, () => ({
    name: "",
    role: "",
    bio: "",
    voice: "",
    motive: "",
    portrait: "a face",
  }));
  return artMaterial(
    { styleGuide: "", place: "", era: "", title: "", scene: "a place", people },
    { suspectsOnly: SUSPECTS_ONLY, noScene: NO_SCENE, victim: frame.victim },
  );
}

/* ------------------------------------------------------------ the writing */

/**
 * A real PNG, made locally, so `--dry-run --art` exercises the whole path.
 *
 * A stub that returned three arbitrary bytes would walk straight into sharp
 * and fail there, which would test nothing and look like a bug in the art
 * pipeline. This is a picture; sharp resizes and re-encodes it exactly as it
 * will the model's.
 */
async function dryImage() {
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 60, g: 70, b: 80 } },
  })
    .png()
    .toBuffer();
  return { mime: "image/png", bytes: new Uint8Array(bytes) };
}

/** A stub that plays all three parts, for `--dry-run`. */
function dryProvider(kase, image) {
  const clues = cluesToDress(kase);
  const bodies = new Map(clues.map((clue) => [clue.id, clue.body]));
  return stubProvider({
    image,
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

/* ------------------------------------------------------ wave 7: the images */

/**
 * Generate this case's pictures and write them beside its JSON.
 *
 * Returns the subject keys that actually landed, which is what goes into the
 * pack — so a portrait the model refused is simply not listed, and the game
 * shows a monogram for that person without ever asking for a file that is not
 * there.
 *
 * The bytes are converted to WebP on the way to disk. The model returns PNG,
 * and a 1K PNG portrait is a few hundred kilobytes against a few for WebP;
 * with eighty-odd pictures in a pack that is the difference between a site
 * somebody waits for and one they do not.
 */
async function paintCase(provider, entry, skin, text = formatCaseId(entry.id)) {
  const frame = entry.case.frame;
  const material = artMaterial(skin, {
    suspectsOnly: SUSPECTS_ONLY,
    noScene: NO_SCENE,
    victim: frame.victim,
  });
  if (material.subjects.length === 0) return [];

  const sharp = (await import("sharp")).default;
  const dir = join(OUT, text);
  mkdirSync(dir, { recursive: true });

  // Anything already drawn is kept unless `--redraw` says otherwise. A
  // re-run after a failure should cost the failures and nothing else.
  const already = new Set(
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".webp"))
          .map((f) => f.replace(/\.webp$/, ""))
      : [],
  );
  // `--only` gates what is DRAWN, never what is listed. Letting it filter the
  // list too made a redraw of two subjects rewrite the pack to claim only
  // those two, orphaning the other five files — which `shipped.test.ts`
  // catches, but only after the pack has been written.
  const wanted = (key) => (ONLY.length === 0 ? true : ONLY.includes(key));
  const written = [...already].map((key) => ({ key, bytes: 0 }));

  const run = await generateArt(provider, material, {
    quality: QUALITY,
    have: (key) => !wanted(key) || (already.has(key) && !REDRAW),
    onProgress: (done, of) => process.stdout.write(`    picture ${done}/${of}\r`),
    onImage: async (key, image) => {
      const width = key === "scene" ? SCENE_PX : PORTRAIT_PX;
      const webp = await sharp(Buffer.from(image.bytes))
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      writeFileSync(join(dir, `${key}.webp`), webp);
      written.push({ key, bytes: webp.length });
    },
  });

  // A redraw pushes a key that was already in the kept list, so the result is
  // deduped before it becomes `pack.images` — a key listed twice is a
  // complaint from `verifyPack` and would stop the pack being written.
  const keys = [...new Set(written.map((w) => w.key))];
  const drawn = written.reduce((sum, w) => sum + w.bytes, 0) / 1024;
  process.stdout.write(
    `    pictures  ${keys.length}/${material.subjects.length}` +
      (drawn > 0 ? `, ${drawn.toFixed(0)} KB new` : ", nothing new") +
      `, ${run.calls} call(s)\n`,
  );
  for (const bad of run.failed) console.error(`    ! no picture for ${bad.key}: ${bad.reason}`);
  return keys;
}

/**
 * Draw pictures for packs that are already on disk, leaving their prose alone.
 *
 * Reads each pack back through the decoder, paints what is missing from the
 * skin it already carries, and writes it out again with its `images` list
 * brought up to date. The case, the skin and the fidelity record are untouched
 * — this only ever adds a field that was empty.
 */
async function paintExisting(provider) {
  const files = readdirSync(OUT).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  if (files.length === 0) {
    console.error(`no packs in ${OUT}`);
    return;
  }
  for (const file of files.sort()) {
    const raw = JSON.parse(readFileSync(join(OUT, file), "utf8"));
    const pack = decodePack(raw);
    if (!pack) {
      console.error(`  ! ${file} does not decode; left alone`);
      continue;
    }
    if (!pack.skin) {
      console.error(`  ! ${file} has no skin, so there are no prompts to draw from`);
      continue;
    }
    console.log(`  ${pack.id}  ${pack.skin.title}`);
    const images = await paintCase(provider, { id: null, case: pack.case }, pack.skin, pack.id);

    const next = { ...pack, images };
    const problems = verifyPack(next);
    if (problems.length > 0) {
      console.error(`    ! not written: ${problems.join("; ")}`);
      continue;
    }
    // Re-encoded from the decoded pack, so the case's Maps and Sets go back
    // through the same codec they came out of rather than being copied raw.
    writeFileSync(join(OUT, file), JSON.stringify(encodePack(next)));
  }
  writeManifest(OUT, NAME);
}

/** Filled in by `--dry-run --art`, so the stub has a picture to hand back. */
let stubImage;

async function main() {
  if (ART_ONLY) {
    // No case is generated and no prose is written: everything comes off
    // disk. Kept in front of `buildCases` so nothing is built needlessly.
    console.log(`skiron author — pictures only, for the packs in ${OUT}`);
    const key = loadKey();
    const grade = imageGrade(QUALITY);
    console.log(`drawing with ${grade.model} at ${grade.size}\n`);
    await paintExisting(geminiProvider({ key: () => key }));
    return;
  }

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
    console.log(`writing with ${WRITER_MODEL}, checking with ${PARSER_MODEL}`);
    if (ART) console.log(`drawing with ${imageGrade(QUALITY).model} at ${imageGrade(QUALITY).size}`);
    console.log("");
  } else {
    console.log("dry run: no key, no calls, stubbed answers\n");
    // Built once, here rather than per case: sharp starts a thread pool and
    // there is no reason to do it four times.
    if (ART) stubImage = await dryImage();
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
      const painter = provider ?? dryProvider(entry.case, stubImage);
      const out = await authorSkin(painter, entry.case, {
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

      const images = ART ? await paintCase(painter, entry, out.skin) : [];

      const pack = packFor(entry.id, entry.case, out.skin, images);
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

  // The manifest is rebuilt from whatever is in the directory, not from what
  // this run wrote. Two reasons. A starter pack wants a mix of difficulties
  // and the tool does one preset per run, so runs have to compose rather than
  // clobber. And `shipped.test.ts` asserts the manifest lists exactly the
  // files beside it — deriving it from those files is the only way that
  // cannot drift.
  writeManifest(OUT, NAME);

  console.log("");
  console.log(`  written   ${entries.length}/${cases.length} into ${OUT}`);
  console.log(`  calls     ${calls}`);
  if (checked > 0) {
    console.log(`  fallback  ${fellBack}/${checked} = ${((fellBack / checked) * 100).toFixed(1)}%`);
  }
}

await main();
