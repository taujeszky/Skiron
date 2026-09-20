/**
 * Play a real case, in a real browser, through the real buttons.
 *
 * The plan lists this under wave 4's tests and the wave-4 handoff calls it the
 * wave's main guard, and it is, for a reason worth being blunt about: **the UI
 * is untested by convention here.** Every other guard in this project stops at
 * the edge of `src/lib`, so between a green suite and a playable game there is
 * nothing but somebody having looked. This is the thing that looks.
 *
 * It drives the DOM and nothing else — no module imports, no reaching into the
 * stores. It clicks a difficulty, clicks Begin, then presses Hint and does
 * exactly what the hint says until the hints run out, reads the surviving
 * suspect and hour **off the notebook's own strikethroughs**, and names them.
 * A pass means the whole chain works: hints are wired, `followHint` takes the
 * action, the panel renders, the grid shows what the notebook holds, the
 * accusation screen accepts a name and the summing-up appears.
 *
 *   npm run dev            (in another terminal — this needs a live server)
 *   npm run playthrough
 *   npm run playthrough -- --preset hard --keep
 *
 * `--keep` leaves the browser open. `--url` points it somewhere else, such as
 * a `npm run preview` build. `--shots <dir>` drops a PNG of each screen on the
 * way past, and `--width`/`--height` set the window, which together are how
 * the phone layout gets looked at without a phone.
 *
 * The browser plumbing is in `cdp.mjs`, which `offline.mjs` shares. Note that
 * the dev server is on 1430, not Vite's default and not Signpost's 1420.
 */
import { SCREEN, launch, openApp } from "./cdp.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const URL_BASE = flag("url", "http://localhost:1430/");
const PRESET = flag("preset", "easy");
const PORT = Number(flag("port", 9333));
const KEEP = argv.includes("--keep");
const LOUD = argv.includes("--verbose");
/** Where to drop PNGs of each screen as it goes past. Off unless asked. */
const SHOTS = flag("shots", null);
const WIDE = Number(flag("width", 1400));
const TALL = Number(flag("height", 900));

const PRESET_LABEL = { easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert" };

async function main() {
  const { cdp, close } = await launch({
    port: PORT,
    width: WIDE,
    height: TALL,
    shots: SHOTS,
  });
  try {
    console.log(`opening ${URL_BASE}`);
    await openApp(cdp, URL_BASE);

    const report = await play(cdp);
    console.log("");
    for (const line of report.log) console.log("  " + line);
    console.log("");
    if (!report.ok) throw new Error(report.why);
    console.log(
      `PASS — ${PRESET_LABEL[PRESET]} case ${report.id} solved in ` +
        `${report.hints} hints and ${report.moves} moves.`,
    );
  } finally {
    if (KEEP) console.log(`browser left open on port ${PORT}`);
    else await close();
  }
}

async function play(cdp) {
  const log = [];
  const say = (line) => {
    log.push(line);
    if (LOUD) console.log("  " + line);
  };

  // 1. Take a case.
  await cdp.eval(`
    const want = ${JSON.stringify(PRESET_LABEL[PRESET])};
    const btn = window.__sk.all(".preset").find((b) =>
      window.__sk.text(b).startsWith(want));
    if (!btn) throw new Error("no " + want + " button on the desk");
    btn.click();
    return true;
  `);
  await cdp.shot("1-desk");
  await cdp.waitForScreen("briefing", "the briefing");
  await cdp.shot("2-briefing");
  const id = await cdp.eval(`
    const el = document.querySelector(".sub .id");
    return el ? window.__sk.text(el) : "?";
  `);
  say(`took a ${PRESET_LABEL[PRESET]} case: ${id}`);

  // 2. Begin.
  await cdp.eval(`
    const btn = window.__sk.find("button", /^Begin$/);
    if (!btn) throw new Error("no Begin button on the briefing");
    btn.click();
    return true;
  `);
  await cdp.waitForScreen("investigate", "the investigation");
  await cdp.shot("3-investigate-fresh");

  // 3. Do exactly what the hints say, and nothing else.
  let hints = 0;
  let lastText = "";
  let repeats = 0;
  for (let step = 0; step < 600; step++) {
    const out = await cdp.eval(`
      const hint = window.__sk.find("footer button", /^Hint$/);
      if (!hint) throw new Error("no Hint button");
      hint.click();
      await window.__sk.settle();
      const panel = document.querySelector(".panel.hint .lead");
      if (!panel) throw new Error("pressing Hint produced no hint panel");
      const text = window.__sk.text(panel);
      const act = window.__sk.find(".panel.hint button.primary", /./);
      if (act) {
        act.click();
        await window.__sk.settle();
      }
      return { text, acted: Boolean(act) };
    `);
    hints++;

    if (out.text === lastText) {
      repeats++;
      if (repeats > 3) {
        return {
          ok: false,
          why: `the hints stopped getting anywhere: "${out.text}" four times running`,
          log,
        };
      }
    } else {
      repeats = 0;
      say(`hint ${hints}: ${out.text}`);
    }
    lastText = out.text;

    // The accuse branch is the only one with nothing to click.
    if (!out.acted) {
      if (/[Nn]ame the killer/.test(out.text)) break;
      return {
        ok: false,
        why: `a hint with nothing to do and no instruction to accuse: "${out.text}"`,
        log,
      };
    }
    if (step === 599) {
      return { ok: false, why: "600 hints and still going", log };
    }
  }

  // 4. Read the answer off the notebook's own strikethroughs, not off the
  //    engine. If the grid is not showing what the notebook holds, this is
  //    where it shows up.
  const left = await cdp.eval(`
    const heads = window.__sk.all(".head.person");
    const people = heads
      .map((el, i) => ({ i, name: window.__sk.text(el), struck: el.classList.contains("struck"), victim: el.classList.contains("victim") }))
      .filter((p) => !p.victim && !p.struck);
    const slots = window.__sk.all(".head.slot")
      .map((el, i) => ({ i, name: window.__sk.text(el), struck: el.classList.contains("struck") }))
      .filter((s) => !s.struck);
    return { people, slots };
  `);
  await cdp.shot("4-investigate-solved");
  if (left.people.length !== 1 || left.slots.length !== 1) {
    return {
      ok: false,
      why:
        `following every hint left ${left.people.length} suspects and ` +
        `${left.slots.length} hours standing; it should be one of each`,
      log,
    };
  }
  say(`the notebook says ${left.people[0].name}, ${left.slots[0].name}`);

  const moves = await cdp.eval(`
    const el = document.querySelector(".meter");
    return el ? window.__sk.text(el) : "?";
  `);

  // 5. Name them.
  await cdp.eval(`
    const btn = window.__sk.find("footer button", /^Accuse$/);
    btn.click();
    return true;
  `);
  await cdp.waitForScreen("accuse", "the accusation screen");
  await cdp.shot("5-accuse");
  await cdp.eval(`
    const who = ${JSON.stringify(left.people[0].name)};
    const when = ${JSON.stringify(left.slots[0].name)};
    const groups = window.__sk.all(".options");
    // The suspect buttons carry a token letter before the name, so the text
    // reads "B Suspect B" — match on inclusion, not on the start.
    const pick = (group, label) => {
      const b = [...group.querySelectorAll("button")].find((x) =>
        window.__sk.text(x).includes(label));
      if (!b) {
        const had = [...group.querySelectorAll("button")]
          .map((x) => window.__sk.text(x)).join(" | ");
        throw new Error("no option for " + label + "; the buttons say: " + had);
      }
      b.click();
    };
    pick(groups[0], who);
    pick(groups[1], when);
    await window.__sk.settle();
    // Confirmation is on by default, so Accuse is pressed twice.
    for (let i = 0; i < 2; i++) {
      // Case-insensitive: the confirm step relabels the button "Yes — accuse".
      const go = window.__sk.find(".go button.primary", /accuse/i);
      if (!go || go.disabled) break;
      go.click();
      await window.__sk.settle();
    }
    return true;
  `);

  const ended = await cdp.eval(SCREEN);
  if (ended !== "summary") {
    const missed = await cdp.eval(`
      const el = document.querySelector(".missed");
      return el ? window.__sk.text(el) : "(no message)";
    `);
    return {
      ok: false,
      why: `the accusation the hints led to was wrong: ${missed}`,
      log,
    };
  }

  await cdp.shot("6-summary");
  const verdict = await cdp.eval(`
    const sub = document.querySelector(".sub");
    const marks = window.__sk.all(".mark.on").length;
    const trace = window.__sk.all(".trace li").length;
    return { sub: window.__sk.text(sub), marks, trace };
  `);
  say(`solved: ${verdict.sub}`);
  say(`${verdict.marks} of 3 marks, ${verdict.trace} steps in the summing-up`);

  if (verdict.trace === 0) {
    return { ok: false, why: "the summing-up recited nothing", log };
  }

  return { ok: true, id, hints, moves, log };
}

main().catch((err) => {
  console.error(`\nFAIL — ${err.message}`);
  process.exit(1);
});
