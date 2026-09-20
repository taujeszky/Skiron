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
 * Gotchas, both learned the hard way in this family of projects:
 * - Chrome's CacheStorage fails when `--user-data-dir` is deeply nested, so
 *   the profile goes somewhere short. Service workers silently fail to install
 *   otherwise, which matters the day this is pointed at a built site.
 * - The dev server is on 1430, not Vite's default and not Signpost's 1420.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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

const CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];

const PRESET_LABEL = { easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const path of CHROMES) if (path && existsSync(path)) return path;
  throw new Error(`no Chrome found; looked in:\n  ${CHROMES.join("\n  ")}`);
}

/* ------------------------------------------------------------------ CDP */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.waiting = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const pending = this.waiting.get(msg.id);
      if (!pending) return;
      this.waiting.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`cannot reach ${url}`)), {
        once: true,
      });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  /** A PNG of the viewport, for looking at rather than for asserting on. */
  async shot(name) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const out = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(out.data, "base64"));
  }

  /** Evaluate in the page and hand back the JSON value. Throws page throws. */
  async eval(expression) {
    const out = await this.send("Runtime.evaluate", {
      // Async, always: half these snippets await a frame before reading the
      // DOM back, and a non-async wrapper is a syntax error rather than a
      // quiet difference.
      expression: `(async () => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (out.exceptionDetails) {
      const e = out.exceptionDetails;
      throw new Error(e.exception?.description ?? e.text);
    }
    return out.result.value;
  }
}

/* ----------------------------------------------------- the page helpers */

/**
 * Everything the script does to the page, as source injected into it.
 *
 * Kept as one blob rather than a dozen `eval` round trips because a click
 * followed by a read has to happen after Svelte has flushed, and one
 * `requestAnimationFrame` inside the page is both cheaper and more reliable
 * than a sleep out here guessing at it.
 */
const HELPERS = `
  window.__sk = {
    text(el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); },
    all(sel) { return [...document.querySelectorAll(sel)]; },
    find(sel, re) {
      return window.__sk.all(sel).find((el) => re.test(window.__sk.text(el))) || null;
    },
    async settle() {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    async click(el) {
      if (!el) return false;
      el.click();
      await window.__sk.settle();
      return true;
    },
  };
  return true;
`;

/** What screen is up, judged the way a person would: by what it says. */
const SCREEN = `
  const h1 = document.querySelector("h1");
  const t = h1 ? window.__sk.text(h1) : "";
  if (document.querySelector(".veil")) return "loading";
  if (document.querySelector("[data-pane]")) return "investigate";
  if (t === "Skiron") return "home";
  if (t === "The case") return "briefing";
  if (t === "The accusation") return "accuse";
  if (t === "Solved") return "summary";
  return t || "?";
`;

async function waitFor(cdp, want, what, ms = 20000) {
  const until = Date.now() + ms;
  let last = "";
  for (;;) {
    last = await cdp.eval(SCREEN);
    if (last === want) return;
    if (Date.now() > until) {
      throw new Error(`waited ${ms}ms for ${what}; the screen says "${last}"`);
    }
    await sleep(120);
  }
}

/* --------------------------------------------------------------- the run */

async function main() {
  const chrome = findChrome();
  // Short, per the CacheStorage gotcha in CLAUDE.md.
  const profile = `${process.env.LOCALAPPDATA ?? "C:/Temp"}/Temp/skpt${PORT}`.replace(
    /\\\\/g,
    "/",
  );
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      `--window-size=${WIDE},${TALL}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp = null;
  try {
    // The debugging port takes a moment to open.
    let target = null;
    for (let i = 0; i < 60 && target === null; i++) {
      await sleep(250);
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
        target = list.find((t) => t.type === "page") ?? null;
      } catch {
        /* not up yet */
      }
    }
    if (!target) throw new Error("Chrome never opened its debugging port");

    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    console.log(`opening ${URL_BASE}`);
    await cdp.send("Page.navigate", { url: URL_BASE });
    // Wait for the app rather than for the load event: the load event fires
    // before hydration, and every query below needs a mounted app.
    const until = Date.now() + 30000;
    for (;;) {
      try {
        await cdp.eval(HELPERS);
        const screen = await cdp.eval(SCREEN);
        if (screen === "home") break;
      } catch {
        /* the page is still coming up */
      }
      if (Date.now() > until) {
        throw new Error(
          `the app never reached the desk. Is the dev server up? (${URL_BASE})`,
        );
      }
      await sleep(250);
    }

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
    if (!KEEP) {
      try {
        await cdp?.send("Browser.close");
      } catch {
        /* it may already be gone */
      }
      browser.kill();
    } else {
      console.log(`browser left open on port ${PORT}`);
    }
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
  await waitFor(cdp, "briefing", "the briefing");
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
  await waitFor(cdp, "investigate", "the investigation");
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
  await waitFor(cdp, "accuse", "the accusation screen");
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
