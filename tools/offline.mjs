/**
 * Cut the network and check the game still works.
 *
 * Wave 4's exit criterion is "a full case at each difficulty is playable
 * offline from the installed PWA", and the word doing the work is
 * **generated**: Skiron ships no case pack, so offline play means the
 * generator has to run in a Web Worker with nothing to fetch. That is exactly
 * the thing a service worker gets wrong quietly — Vite emits the worker as
 * its own chunk and SvelteKit's `$service-worker` manifest does not list it,
 * so a precache-the-manifest worker gives you an app that opens offline,
 * shows the desk, and hangs forever on "Building a case".
 *
 * So the run is: open the built site, let the service worker install, take
 * one case online (which is what fetches the worker chunk into the cache),
 * then **pull the plug, reload from cache, and take a fresh case of every
 * difficulty**. The reload matters — without it the page is still the one
 * that was served over the network and proves nothing.
 *
 *   npm run build && npm run preview     (in another terminal)
 *   npm run offline
 *
 * It needs the built site, not the dev server: `vite dev` does not serve a
 * service worker or content-hashed chunks, so pointing this at :1430 tests
 * nothing.
 */
import { launch, openApp, sleep } from "./cdp.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const URL_BASE = flag("url", "http://localhost:4173/");
const PORT = Number(flag("port", 9361));
const SHOTS = flag("shots", null);
const PRESETS = flag("presets", "easy,normal,hard,expert").split(",");

const LABEL = { easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert" };

/** Take a case and get as far as the investigation. Returns the case number. */
async function takeCase(cdp, preset) {
  await cdp.eval(`
    const want = ${JSON.stringify(LABEL[preset])};
    const btn = window.__sk.all(".preset").find((b) =>
      window.__sk.text(b).startsWith(want));
    if (!btn) throw new Error("no " + want + " button on the desk");
    btn.click();
    return true;
  `);
  await cdp.waitForScreen("briefing", `the ${preset} briefing`, 40000);
  const id = await cdp.eval(`
    const el = document.querySelector(".sub .id");
    return el ? window.__sk.text(el) : "?";
  `);
  await cdp.eval(`
    const btn = window.__sk.find("button", /^Begin$/);
    if (!btn) throw new Error("no Begin button");
    btn.click();
    return true;
  `);
  await cdp.waitForScreen("investigate", "the investigation");
  // A case with no cards and no grid would satisfy "the screen changed".
  const real = await cdp.eval(`
    const rows = window.__sk.all(".head.person").length;
    const cols = window.__sk.all(".head.slot").length;
    const cards = window.__sk.all(".cards .card").length;
    return { rows, cols, cards };
  `);
  if (real.rows < 4 || real.cols < 4) {
    throw new Error(
      `the ${preset} case came up with a ${real.rows} by ${real.cols} grid`,
    );
  }
  return { id, ...real };
}

async function backToDesk(cdp) {
  await cdp.eval(`
    const btn = window.__sk.find("header button", /Desk/);
    if (btn) btn.click();
    await window.__sk.settle();
    return true;
  `);
  await cdp.waitForScreen("home", "the desk");
}

async function main() {
  const { cdp, close } = await launch({ port: PORT, shots: SHOTS });
  try {
    console.log(`opening ${URL_BASE}`);
    await openApp(cdp, URL_BASE);

    // 1. Let the service worker install and take control.
    const ready = await cdp.eval(`
      if (!("serviceWorker" in navigator)) return "no service worker support";
      const reg = await navigator.serviceWorker.ready;
      // Registration is not control: the first load is served by the network
      // and \`clients.claim()\` is what hands it over.
      for (let i = 0; i < 80 && !navigator.serviceWorker.controller; i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
      return navigator.serviceWorker.controller ? "controlling" : "registered, not controlling";
    `);
    console.log(`service worker: ${ready}`);
    if (ready !== "controlling") {
      throw new Error(
        `the service worker is ${ready}. Is this the built site? ` +
          `(\`npm run build && npm run preview\`, not \`npm run dev\`)`,
      );
    }

    // 2. One case online, which is what pulls the generator's worker chunk
    //    into the cache. Nothing else fetches it.
    const warm = await takeCase(cdp, "easy");
    console.log(`online: took ${warm.id}`);
    await backToDesk(cdp);

    const cached = await cdp.eval(`
      const names = await caches.keys();
      let workers = 0;
      let total = 0;
      for (const name of names) {
        const keys = await (await caches.open(name)).keys();
        total += keys.length;
        workers += keys.filter((r) => r.url.includes("/immutable/workers/")).length;
      }
      return { names, total, workers };
    `);
    console.log(
      `cache "${cached.names.join(", ")}": ${cached.total} entries, ` +
        `${cached.workers} of them generator worker chunks`,
    );
    if (cached.workers === 0) {
      throw new Error(
        "the generator's worker chunk was never cached — offline generation " +
          "would hang. See the note in src/service-worker.ts.",
      );
    }

    // 3. Pull the plug and reload. The reload is the point: without it the
    //    page under test is still the one the network served.
    await cdp.network(false);
    console.log("network: offline");
    await sleep(300);
    await openApp(cdp, URL_BASE);
    await cdp.shot("offline-desk");
    console.log("the desk came back from cache");

    // 4. Prove the plug really is out, before trusting anything below it.
    //
    //    NOT a same-origin fetch. The first version of this check asked for
    //    the app's own URL and was satisfied when the request resolved — but
    //    the service worker answers same-origin requests from the cache,
    //    which is its entire job, so the check passed on a live network and
    //    failed on a dead one. A cross-origin request is the honest probe:
    //    `service-worker.ts` returns early for those, so it reaches the
    //    network or it does not happen at all.
    const probe = await cdp.eval(`
      try {
        await fetch("https://example.com/", { mode: "no-cors", cache: "no-store" });
        return "a cross-origin request got through";
      } catch {
        return "blocked";
      }
    `);
    if (probe !== "blocked") throw new Error(`the network was not cut: ${probe}`);
    console.log("cross-origin requests are failing, so the plug really is out");

    // 5. A fresh case of every difficulty, with nothing to fetch.
    for (const preset of PRESETS) {
      const made = await takeCase(cdp, preset);
      console.log(
        `offline: ${LABEL[preset]} ${made.id} — a ${made.rows} by ${made.cols} grid`,
      );
      await cdp.shot(`offline-${preset}`);
      await backToDesk(cdp);
    }

    console.log(`\nPASS — ${PRESETS.length} difficulties generated and played offline.`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`\nFAIL — ${err.message}`);
  process.exit(1);
});
