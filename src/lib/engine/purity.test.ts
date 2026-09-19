import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Critical invariant 4 has a rule behind it: nothing under `engine/` may reach
 * for entropy, the clock or the DOM, because the same case ID has to rebuild
 * the same case in Node, in a Web Worker and in the authoring CLI.
 *
 * Every other determinism test in the suite compares engine output with engine
 * output from the same build, so none of them can see a new `Math.random`.
 * This one reads the source.
 *
 * There is no allow-list on purpose. A rule with a blessed exception in it is
 * a rule nobody can test — `util/entropy.ts` exists so this one can be
 * absolute.
 */

const ENGINE = fileURLToPath(new URL(".", import.meta.url));

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bMath\.random\b/, why: "breaks determinism (use engine/rng.ts)" },
  { pattern: /\bDate\.now\b/, why: "breaks determinism" },
  { pattern: /\bnew Date\b/, why: "breaks determinism" },
  { pattern: /\bperformance\.now\b/, why: "breaks determinism" },
  { pattern: /\bcrypto\./, why: "breaks determinism" },
  { pattern: /\bdocument\./, why: "the engine must run in a worker and in Node" },
  { pattern: /\bwindow\./, why: "the engine must run in a worker and in Node" },
  { pattern: /\blocalStorage\b/, why: "the engine must run in a worker and in Node" },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      // testkit is test-only scaffolding, but it is still engine code and is
      // held to the same rule, so it is deliberately NOT excluded here.
      out.push(full);
    }
  }
  return out;
}

describe("engine purity", () => {
  const files = sourceFiles(ENGINE);

  it("finds the engine sources at all", () => {
    // Guards the guard: a bad path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith("axioms.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("exhaustive.ts"))).toBe(true);
  });

  it("reaches for no entropy, no clock and no DOM", () => {
    const offences: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (const { pattern, why } of BANNED) {
        lines.forEach((line, i) => {
          // a mention in a comment is how these rules get documented
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (pattern.test(code)) {
            offences.push(
              `${file.slice(ENGINE.length)}:${i + 1} ${pattern.source} — ${why}`,
            );
          }
        });
      }
    }
    expect(offences).toEqual([]);
  });

  it("catches a planted violation", () => {
    // The assertion above passes trivially if the matcher is broken, so prove
    // the matcher bites on a line that looks like real engine code.
    const planted = "  const r = Math.random() * rooms.length;";
    const hit = BANNED.some(({ pattern }) => pattern.test(planted));
    expect(hit).toBe(true);
  });
});
