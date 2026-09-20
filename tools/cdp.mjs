/**
 * Just enough Chrome DevTools Protocol to drive the real app.
 *
 * No test framework and no dependency: Node 22 has a global `WebSocket`, and
 * `Runtime.evaluate` plus `Page.navigate` is the whole surface anything here
 * needs. `playthrough.mjs` plays a case through the buttons; `offline.mjs`
 * cuts the network and checks the game still works. Both want the same eighty
 * lines, so the eighty lines live here.
 *
 * Two gotchas worth carrying, both already in CLAUDE.md:
 * - Chrome's CacheStorage fails when `--user-data-dir` sits under a deeply
 *   nested path, and **service workers then silently fail to install**. The
 *   profile goes somewhere short.
 * - Every evaluated snippet is wrapped in an `async` function, because half of
 *   them wait a frame for Svelte to flush before reading the DOM back.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const CHROMES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  for (const path of CHROMES) if (path && existsSync(path)) return path;
  throw new Error(`no Chrome found; looked in:\n  ${CHROMES.join("\n  ")}`);
}

/** Everything the scripts inject into the page before touching it. */
export const HELPERS = `
  window.__sk = {
    text(el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); },
    all(sel) { return [...document.querySelectorAll(sel)]; },
    find(sel, re) {
      return window.__sk.all(sel).find((el) => re.test(window.__sk.text(el))) || null;
    },
    async settle() {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  };
  return true;
`;

/** What screen is up, judged the way a person would: by what it says. */
export const SCREEN = `
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

export class Cdp {
  constructor(ws, opts) {
    this.ws = ws;
    this.shots = opts?.shots ?? null;
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

  send(method, params = {}) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} timed out`));
      }, 45000);
    });
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

  /** A PNG of the viewport, for looking at rather than for asserting on. */
  async shot(name) {
    if (!this.shots) return;
    mkdirSync(this.shots, { recursive: true });
    const out = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${this.shots}/${name}.png`, Buffer.from(out.data, "base64"));
  }

  /** Pull the plug, or put it back. */
  async network(online) {
    await this.send("Network.enable");
    await this.send("Network.emulateNetworkConditions", {
      offline: !online,
      latency: 0,
      downloadThroughput: online ? -1 : 0,
      uploadThroughput: online ? -1 : 0,
    });
  }

  async waitForScreen(want, what, ms = 25000) {
    const until = Date.now() + ms;
    for (;;) {
      const now = await this.eval(SCREEN);
      if (now === want) return;
      if (Date.now() > until) {
        throw new Error(`waited ${ms}ms for ${what}; the screen says "${now}"`);
      }
      await sleep(120);
    }
  }
}

/**
 * Launch headless Chrome, connect, and hand back the client plus a way to
 * stop it.
 */
export async function launch({ port = 9333, width = 1400, height = 900, shots = null } = {}) {
  const profile = `${process.env.LOCALAPPDATA ?? "C:/Temp"}/Temp/skpt${port}`;
  const browser = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let target = null;
  for (let i = 0; i < 60 && target === null; i++) {
    await sleep(250);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === "page") ?? null;
    } catch {
      /* the port is not open yet */
    }
  }
  if (!target) {
    browser.kill();
    throw new Error("Chrome never opened its debugging port");
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cannot reach Chrome")), {
      once: true,
    });
  });

  const cdp = new Cdp(ws, { shots });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return {
    cdp,
    async close() {
      try {
        await cdp.send("Browser.close");
      } catch {
        /* it may already be gone */
      }
      browser.kill();
    },
  };
}

/**
 * Navigate, and wait for the app to be mounted rather than merely loaded.
 *
 * The load event fires before hydration, and every query the scripts make
 * needs a mounted app.
 */
export async function openApp(cdp, url, ms = 40000) {
  await cdp.send("Page.navigate", { url });
  const until = Date.now() + ms;
  for (;;) {
    try {
      await cdp.eval(HELPERS);
      if ((await cdp.eval(SCREEN)) === "home") return;
    } catch {
      /* still coming up */
    }
    if (Date.now() > until) {
      throw new Error(`the app never reached the desk at ${url}`);
    }
    await sleep(250);
  }
}
