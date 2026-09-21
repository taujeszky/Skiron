/**
 * Build the two tutorial cases.
 *
 * Deterministic, offline, and free: no key, no model, no network. Run it
 * again and it writes the same bytes.
 *
 *     npx vite-node --config vitest.config.ts tools/build-tutorial.mjs
 *
 * **Why the tutorial is a pack rather than a fifth preset.** The plan asks
 * for a case smaller than anything the generator offers — three suspects
 * where Easy has four — and `generate` takes its shape from the preset named
 * in the id. The two ways to get there are a fifth `PresetName`, which is a
 * union threaded through thirteen non-test files and would give a tutorial a
 * row in the player's statistics, or `GenerateOptions.shape`, which wave 8
 * added beside `select`. A pack already stores the whole case rather than the
 * seed — see `llm/pack.ts` — so a case whose id does not rebuild it is
 * exactly what a pack is for. The shape override is the smaller change by a
 * wide margin.
 *
 * **Why the skin has names but no prose.** `verifyPack` requires every card
 * to have either written prose or a template sentence, and the template
 * renderer covers all seventeen clue kinds using whatever glossary it is
 * given. Hand a skin with room, hour and person names and no `prose` map, and
 * every card reads as the engine's own sentence with the tutorial's names in
 * it: "Alice Verity was in the Kitchen at ten o'clock." That is not a
 * degraded mode, it is the right one for a lesson — the sentences are uniform
 * and predictable, which is what somebody learning to read evidence needs,
 * and there is nothing a model could get wrong because no model was asked.
 *
 * The seeds below were chosen by sweeping and reading the proof traces; what
 * each one teaches is written beside it.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { newCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import {
  PACK_VERSION,
  decodePack,
  encodePack,
  entryFor,
  packFor,
  verifyPack,
} from "$lib/llm/pack";
import { assembleSkin } from "$lib/llm/skin/schema";

const OUT = "static/cases/tutorial";
const PACK_NAME = "Learning the ropes";

/** Nothing here was written by a model, so nothing here was checked. */
const NO_FIDELITY = { checked: 0, verified: 0, retried: 0, fallback: [] };

/* ------------------------------------------------------------- lesson one */

/**
 * Three suspects, four rooms, four hours, nobody lying.
 *
 * Seed `2` at this shape proves at tier 1 and stays at tier 1 however
 * thorough the player is (`playTier` 1), which matters: a case that collapses
 * to tier 0 once everything is collected would teach the loop and then not
 * reward it. Two actions release the three cards the proof needs — one room
 * examined, one question asked — so the lesson can walk through both halves
 * of the loop without the player wandering.
 *
 * The house: Taproom(0) is where the body is. Doors run Taproom-Kitchen,
 * Taproom-Yard, Kitchen-Parlour, Kitchen-Yard.
 */
const LESSON_ONE = {
  id: newCaseId("easy", "tut1"),
  shape: { suspects: 3, rooms: 4, slots: 4, lying: false, outdoor: false },
  seedFrom: newCaseId("easy", "2"),
  skin: {
    setting: "a village inn on a wet night",
    title: "A Night at the Fleece",
    place: "the Fleece, a small inn on the London road",
    era: "1908",
    styleGuide:
      "Lamplit interiors, wet slate and brick, brown and ochre, a low ceiling.",
    rooms: [
      { name: "the Taproom", code: "TAP", description: "The public room, and where the body was found." },
      { name: "the Kitchen", code: "KIT", description: "The range, the back stairs, and the door to the yard." },
      { name: "the Parlour", code: "PAR", description: "The small room kept for guests who pay for quiet." },
      { name: "the Back Yard", code: "YRD", description: "Barrels, the pump, and a gate nobody uses after dark." },
    ],
    slots: ["eight o'clock", "nine o'clock", "ten o'clock", "eleven o'clock"],
    people: [
      {
        name: "Ruth Calder",
        role: "the landlady",
        bio: "Has kept the Fleece eleven years and knows to the penny what it owes.",
        voice: "Short, level, and never the first to speak.",
        motive: "The brewery was about to take the licence off her.",
        portrait:
          "A woman of fifty with grey hair pinned back tightly, a square face, " +
          "dark eyes, a plain high-necked dress. Composed and watchful.",
      },
      {
        name: "Tom Pike",
        role: "the potman",
        bio: "Nineteen, strong, and slower to answer than he is to understand.",
        voice: "Eager, over-explains, calls everyone sir or missus.",
        motive: "She had promised him the tenancy and then not mentioned it again.",
        portrait:
          "A young man of nineteen, broad-shouldered, close-cropped fair hair, " +
          "a round open face, a collarless shirt. Earnest.",
      },
      {
        name: "Alice Verity",
        role: "a traveller stopping the night",
        bio: "Came in off the London coach and asked for the parlour.",
        voice: "Precise, a little amused, answers exactly what was asked.",
        motive: "She had come a long way to speak to the dead man.",
        portrait:
          "A woman of about thirty-five, dark hair under a travelling hat, " +
          "a narrow intelligent face, a grey coat. Calm and alert.",
      },
      {
        name: "Edward Mainwaring",
        role: "the brewery's agent",
        bio: "Came to settle an account and did not leave.",
        voice: "",
        motive: "",
        portrait:
          "A heavy man of fifty in a good dark overcoat, side-whiskers, " +
          "a florid face. Pleased with himself.",
      },
    ],
    briefing:
      "Edward Mainwaring came to the Fleece to settle an account, and he did not " +
      "leave it. He was found in the taproom when the house was shut up for the " +
      "night. The surgeon will commit himself no further than this: the man died " +
      "between nine and ten o'clock. Three people were under this roof that " +
      "evening, and one of them was alone with him when it happened.",
    scene:
      "The taproom of a small English inn at night, empty, lamps still lit, " +
      "chairs pushed back from the tables, rain against the black windows.",
    silence: [
      "I've told you what I know about that.",
      "Couldn't say, missus. I wasn't minding.",
      "I'm afraid I have nothing to offer you there.",
      "",
    ],
    summingUp:
      "Ruth Calder came in out of her own yard at ten o'clock, and she is the " +
      "only one of the three who could have been in that room at that hour. " +
      "It was never a question of who had a reason to want him gone. Every one " +
      "of them had that. It was a question of who had the hour.",
  },
};

/* ------------------------------------------------------------- lesson two */

/**
 * The same size, one hour longer, and this time the killer lies.
 *
 * Seed `q` at this shape is the clearest trace the sweep turned up, and it is
 * the one that teaches what the plan asked lesson two to teach. It runs:
 * the death window narrows; Nora is cleared by opportunity at tier 0; then
 * **self-incrimination** at tier 3 — Ida's own statements cannot all be true,
 * so Ida is the killer and Walter is therefore in the clear; and then
 * Walter's card, which was worth nothing while he might have been lying,
 * pins the hour.
 *
 * That last step is the point. The plan calls it "clearing someone to trust
 * them", and it is not a rule you can point at — the solver's only two
 * tier-3 rules are `self-incrimination` and `conflict-pair`. Trust is the
 * *mechanism* underneath them (`solver/state.ts#trustedMask`): a cleared
 * suspect's testimony becomes usable, and the tier-0 rules then do the work.
 * This case shows that happening in four consecutive steps, which is the
 * nearest thing to making it visible. The wave file records the correction.
 *
 * The house: the Sea Room(3) is where the body is, and Nora may not enter it.
 */
const LESSON_TWO = {
  id: newCaseId("hard", "tut2"),
  shape: { suspects: 3, rooms: 4, slots: 5, lying: true, outdoor: false },
  seedFrom: newCaseId("hard", "q"),
  skin: {
    setting: "a boarding house on a harbour front",
    title: "The Room at the Top",
    place: "the Mereward, a boarding house on the quay",
    era: "1908",
    styleGuide:
      "Cold sea light, salt-bleached paint, green and grey, narrow stairs.",
    rooms: [
      { name: "the Front Hall", code: "HAL", description: "The street door, the desk, and the foot of the stairs." },
      { name: "the Landing", code: "LND", description: "The turn of the stairs, with doors off it." },
      { name: "the Scullery", code: "SCU", description: "Down two steps at the back, and always cold." },
      { name: "the Sea Room", code: "SEA", description: "The Captain's room at the front, and where he was found." },
    ],
    slots: [
      "seven o'clock",
      "eight o'clock",
      "nine o'clock",
      "ten o'clock",
      "eleven o'clock",
    ],
    people: [
      {
        name: "Nora Blyth",
        role: "who keeps the house",
        bio: "Has let rooms on this quay for twenty years and misses nothing.",
        voice: "Brisk, and resents being asked twice.",
        motive: "The Captain was eleven weeks behind with his rent.",
        portrait:
          "A woman of sixty, hair scraped back, a long weathered face, " +
          "a dark shawl over a plain dress. Upright and unimpressed.",
      },
      {
        name: "Walter Finch",
        role: "a lodger",
        bio: "Came for the winter and has stayed two years.",
        voice: "Careful, qualifies everything, hates to be wrong.",
        motive: "The Captain knew why he left his last position.",
        portrait:
          "A thin man of forty-five, receding sandy hair, wire spectacles, " +
          "a worn tweed jacket. Anxious.",
      },
      {
        name: "Ida Prosser",
        role: "the Captain's niece",
        bio: "Arrived on Tuesday and has not said how long she means to stay.",
        voice: "Warm, talkative, and never quite answers the question.",
        motive: "Everything he had was to come to her.",
        portrait:
          "A woman of thirty, dark curling hair loose at the temples, " +
          "a round pleasant face, a blue jacket. Smiling.",
      },
      {
        name: "Captain Rennie",
        role: "the lodger of the front room",
        bio: "Forty years at sea and eleven weeks behind with his rent.",
        voice: "",
        motive: "",
        portrait:
          "A weather-beaten man of seventy, white beard, deep-set eyes, " +
          "a heavy navy coat. Stubborn.",
      },
    ],
    briefing:
      "Captain Rennie kept the sea room at the top of the Mereward, and that is " +
      "where he was found. Three things the house will tell you before anyone " +
      "opens their mouth: the door from the landing was locked until eight, Nora " +
      "Blyth was never once let into that room, and it holds two at a push. He " +
      "died between eight and ten o'clock. And remember the seventh rule — the " +
      "innocent tell you the truth, and the guilty need not.",
    scene:
      "A cold upstairs room in a harbour boarding house, morning, the window " +
      "full of grey sea and masts, the bed stripped, nobody there.",
    silence: [
      "I've said all I mean to say about that.",
      "I — no, I couldn't swear to that. Better I say nothing.",
      "Oh, that. No, nothing at all comes to mind.",
      "",
    ],
    summingUp:
      "Ida Prosser told me she saw Walter Finch in the front hall at ten " +
      "o'clock. She could not have. At ten o'clock she was in the sea room, and " +
      "so was her uncle, and the two of them were alone there. She did not need " +
      "to be caught in the room. She only needed to be caught in the sentence. " +
      "A lie is a fact about the person who tells it.",
  },
};

/* ------------------------------------------------------------------ build */

function buildLesson(lesson) {
  // The id in the file is the label; the id the case is *generated* from is
  // `seedFrom`, because the seed is what picked this particular evening out
  // of the space and "tut1" is not it. A pack stores the case, so the two are
  // allowed to differ — and this is the one place in Skiron where they do.
  const out = generate(lesson.seedFrom, {
    shape: lesson.shape,
    onAssertionFailure: (reason, detail) => {
      throw new Error(`${reason}: ${detail}`);
    },
  });
  if (!out.case) {
    throw new Error(
      `no case for ${lesson.id.seed} after ${out.rejections.length} attempts: ` +
        out.rejections.join(", "),
    );
  }
  const kase = out.case;
  const frame = kase.frame;
  const s = lesson.skin;

  if (s.rooms.length !== frame.plan.rooms.length) {
    throw new Error(`${lesson.id.seed}: ${s.rooms.length} room names, ${frame.plan.rooms.length} rooms`);
  }
  if (s.people.length !== frame.people) {
    throw new Error(`${lesson.id.seed}: ${s.people.length} names, ${frame.people} people`);
  }
  if (s.slots.length !== frame.slots) {
    throw new Error(`${lesson.id.seed}: ${s.slots.length} hours, ${frame.slots} slots`);
  }

  const skin = assembleSkin(
    {
      title: s.title,
      place: s.place,
      era: s.era,
      styleGuide: s.styleGuide,
      rooms: s.rooms,
      slots: s.slots,
      people: s.people,
      prose: [],
      silence: s.silence,
      briefing: s.briefing,
      scene: s.scene,
    },
    {
      setting: s.setting,
      language: "en",
      // Deliberately empty: every card falls back to the engine's own
      // sentence, rendered through this skin's names. See the file header.
      prose: {},
      fidelity: NO_FIDELITY,
      summingUp: s.summingUp,
    },
  );

  // The id the file is *named* by. `packFor` writes `formatCaseId(id)` into
  // the pack, and the app uses it as the save key and the heading.
  const pack = packFor(lesson.id, kase, skin, []);
  const problems = verifyPack(pack);
  if (problems.length > 0) {
    throw new Error(`${lesson.id.seed} does not verify:\n  - ${problems.join("\n  - ")}`);
  }
  return pack;
}

function writeManifest(dir, name) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const cases = [];
  // Sorted by filename, which puts tut1 before tut2 — the order the lessons
  // are meant to be taken in. `TUTORIAL_ORDER` in `game/tutorial.ts` is what
  // the app actually goes by; this only keeps the file tidy.
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

mkdirSync(OUT, { recursive: true });
for (const lesson of [LESSON_ONE, LESSON_TWO]) {
  const pack = buildLesson(lesson);
  const file = join(OUT, `${pack.id}.json`);
  writeFileSync(file, JSON.stringify(encodePack(pack)));
  const k = pack.case;
  console.log(
    `${pack.id}  ${k.frame.suspects} suspects, ${k.frame.plan.rooms.length} rooms, ` +
      `${k.frame.slots} hours  tier ${k.tier}/play ${k.playTier} (${k.difficulty})  ` +
      `par ${k.investigation.par}  "${pack.skin.title}"`,
  );
}
console.log(`manifest: ${writeManifest(OUT, PACK_NAME)} cases in ${OUT}`);
