import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every browser API has exactly one module that touches it.
 *
 * `engine/purity.test.ts` has enforced this inside `src/lib/engine/` since
 * wave 1, and it is absolute there. Outside the engine the rule is different
 * in kind — the app is *supposed* to use the browser — so what is enforced
 * here is not absence but **ownership**: the plan's stack note asks for
 * browser-only APIs to sit behind small modules so a Tauri shell can replace
 * them, and until something checks that, the modules exist and the calls
 * scatter anyway. Wave 8's audit found two that already had.
 *
 * So each API below names the file or files allowed to touch it. A new direct
 * `localStorage` call in `game/`, or a second module minting blob URLs, fails
 * this test and has to either move behind the owner or argue for itself here.
 *
 * **The list is also checked for rot**, which is the half that usually gets
 * left out: every owner named below must still contain the call it claims to
 * own. Otherwise a module that stops using an API keeps its licence to, and
 * the list slowly becomes a list of places it is fine to do anything.
 *
 * **What this does not cover.** Only `.ts` files. `.svelte` components are
 * the DOM layer and are meant to touch the DOM; `ui/App.svelte` in particular
 * holds `navigator.serviceWorker`, `location` and `window` listeners, and a
 * Tauri port rewrites it rather than configuring it. `src/service-worker.ts`
 * is outside `src/lib/` and is the one file whose whole subject is `caches`.
 */

const LIB = fileURLToPath(new URL(".", import.meta.url));

interface Owned {
  /** What to look for, as it appears in code. */
  pattern: RegExp;
  /** Paths relative to `src/lib/`, forward slashes. */
  owners: string[];
  why: string;
  /**
   * Set where an owner is a **deviation** rather than a design: the API has a
   * module and this file reaches past it. Recorded rather than fixed, because
   * fixing it is the Tauri port and nobody has asked for that; recorded
   * *here* rather than only in prose, because a list of known leaks that the
   * suite reads is a list that cannot quietly grow.
   * See `docs/plan/wave-9-beyond.md`, "Tauri shell".
   */
  leaking?: string[];
}

const OWNED: Owned[] = [
  {
    pattern: /\blocalStorage\b/,
    owners: ["game/storage.ts"],
    why: "one module picks the backing store, and every call it makes is wrapped",
  },
  {
    pattern: /\bsessionStorage\b/,
    owners: [],
    why: "nothing uses it, and the first thing that wants to should use game/storage.ts",
  },
  {
    pattern: /\bindexedDB\b/,
    owners: ["llm/idb.ts"],
    why: "skins and images share one tiny wrapper; nothing else opens a database",
  },
  {
    pattern: /\bmatchMedia\b/,
    owners: ["ui/motion.ts", "game/controller.ts"],
    leaking: ["game/controller.ts"],
    why: "ui/motion.ts is the module for platform preferences",
  },
  {
    pattern: /ObjectURL\b/,
    owners: ["llm/artStore.ts", "ui/download.ts"],
    why: "two of them, for two jobs: showing a stored image, and offering a file",
  },
  {
    pattern: /\bdocument\./,
    owners: ["ui/download.ts", "game/controller.ts"],
    leaking: ["game/controller.ts"],
    why: "the DOM belongs to the components and to ui/",
  },
  {
    pattern: /\bwindow\./,
    owners: [],
    why: "the components have it; no library module should need it",
  },
  {
    pattern: /\bnavigator\./,
    owners: [],
    why: "ui/App.svelte owns the service worker registration",
  },
  {
    pattern: /\bcaches\./,
    owners: [],
    why: "src/service-worker.ts is the only file whose subject is the cache",
  },
];

/** Source files under `src/lib/`, minus the engine and minus the tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The engine is held to the stricter, allow-list-free rule next door.
      if (entry === "engine") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** The path as the table above spells it. */
function relative(file: string): string {
  return file.slice(LIB.length).split("\\").join("/");
}

/**
 * A mention in a comment is how these rules get documented — four modules
 * explain in prose why they do *not* use `localStorage` — so comments come
 * out before anything is matched. Same two strippers as `purity.test.ts`.
 */
function code(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, ""));
}

describe("platform seams", () => {
  const files = sourceFiles(LIB);

  it("finds the library sources at all", () => {
    // Guards the guard: a bad path makes every assertion below vacuous, and
    // an empty file list is the shape that passes everything.
    expect(files.length).toBeGreaterThan(20);
    const names = files.map(relative);
    expect(names).toContain("game/storage.ts");
    expect(names).toContain("llm/idb.ts");
    expect(names).toContain("ui/motion.ts");
    // And the exclusion really excludes, or the engine's stricter rule would
    // be silently re-litigated here under looser terms.
    expect(names.some((n) => n.startsWith("engine/"))).toBe(false);
  });

  it("keeps each browser API to the module that owns it", () => {
    const offences: string[] = [];
    for (const file of files) {
      const name = relative(file);
      const lines = code(readFileSync(file, "utf8"));
      for (const { pattern, owners, why } of OWNED) {
        if (owners.includes(name)) continue;
        lines.forEach((line, i) => {
          if (pattern.test(line)) {
            offences.push(
              `${name}:${i + 1} ${pattern.source} — ${why}` +
                (owners.length > 0 ? ` (owner: ${owners.join(", ")})` : ""),
            );
          }
        });
      }
    }
    expect(offences).toEqual([]);
  });

  it("holds every owner to still owning something", () => {
    // The rot check. Without it, a module that stops touching an API keeps a
    // standing licence to touch it again, and the table above drifts from a
    // set of claims into a set of exemptions nobody re-reads.
    const stale: string[] = [];
    for (const { pattern, owners } of OWNED) {
      for (const owner of owners) {
        const file = files.find((f) => relative(f) === owner);
        if (!file) {
          stale.push(`${owner} is named as an owner and does not exist`);
          continue;
        }
        if (!code(readFileSync(file, "utf8")).some((l) => pattern.test(l))) {
          stale.push(
            `${owner} no longer uses ${pattern.source} — delete it from OWNED`,
          );
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it("knows which owners are leaks rather than designs", () => {
    // The two below are the ones wave 8's audit found. This is not a target
    // to drive to zero on a whim — it is a statement of what is true, and
    // it fails if somebody adds a third without saying so, or fixes one of
    // these and leaves the note behind.
    const leaks = OWNED.flatMap(({ pattern, leaking }) =>
      (leaking ?? []).map((f) => `${f} ${pattern.source}`),
    );
    expect(leaks).toEqual([
      "game/controller.ts \\bmatchMedia\\b",
      "game/controller.ts \\bdocument\\.",
    ]);
    // Every leak must also be a declared owner, or the offence test above
    // would already be failing and this list would be describing nothing.
    for (const { owners, leaking } of OWNED) {
      for (const f of leaking ?? []) expect(owners).toContain(f);
    }
  });

  it("catches a planted violation", () => {
    // The assertions above pass trivially if the matchers are broken, so
    // prove they bite on lines that look like real code in this layer.
    const planted = [
      '  const raw = localStorage.getItem("skiron:save");',
      "  const db = indexedDB.open(NAME, 1);",
      "  const url = URL.createObjectURL(blob);",
      '  if (matchMedia("(prefers-color-scheme: dark)").matches) return;',
      "  document.body.append(link);",
      "  window.addEventListener(\"resize\", onResize);",
      "  navigator.serviceWorker.register(SW);",
      "  await caches.open(CACHE);",
      '  sessionStorage.setItem("k", "v");',
    ];
    for (const line of planted) {
      expect(OWNED.some(({ pattern }) => pattern.test(line))).toBe(true);
    }
    // And that stripping comments is what lets the prose above exist: four
    // modules discuss `localStorage` without using it.
    expect(code(" * localStorage would groan, and an image is a hundred times")).toEqual(
      [""],
    );
    expect(code("  const x = 1; // localStorage is not used here")).toEqual([
      "  const x = 1; ",
    ]);
  });
});
