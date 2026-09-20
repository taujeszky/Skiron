import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePack, parseManifest, verifyPack } from "./pack";

/*
 * "A pack test that loads every shipped case and re-verifies it: exhaustive
 * fairness, the recorded tier, every clue has prose or a template, schema
 * valid." — wave 5's plan, and this is it.
 *
 * A pack is the one artefact the engine does not rebuild on the way in, so it
 * is the one artefact whose fairness is not true by construction. Everything
 * else in Skiron is proved twice at generation time and then thrown away; a
 * shipped case keeps the answer in a file where a tuning change, a bad merge
 * or a hand edit can put it out of step with the evidence beside it.
 *
 * **When nothing is shipped this reports that and passes.** It is written to
 * become a real test the moment a pack lands rather than to be written then:
 * the version of this file that gets added along with the first pack is the
 * version nobody checks.
 */

const ROOT = "static/cases";

function packDirs(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const DIRS = packDirs();

describe("every shipped case", () => {
  if (DIRS.length === 0) {
    it("there are none yet, and that is the state the plan expects here", () => {
      // Wave 5's task 9 generates a three-case pack, and the owner asked for
      // the call estimate before any batch is paid for. `npm run author --
      // --estimate` prints it; `--dry-run` proves the pipeline without one.
      expect(DIRS).toEqual([]);
    });
    return;
  }

  for (const dir of DIRS) {
    const base = join(ROOT, dir);
    const files = readdirSync(base).filter(
      (name) => name.endsWith(".json") && name !== "manifest.json",
    );

    describe(dir, () => {
      it("has a manifest that lists exactly the files beside it", () => {
        const manifest = parseManifest(
          JSON.parse(readFileSync(join(base, "manifest.json"), "utf8")) as unknown,
        );
        expect(manifest).not.toBeNull();
        const listed = manifest!.cases.map((entry) => `${entry.id}.json`).sort();
        expect(listed).toEqual([...files].sort());
      });

      it("lists an image count that matches the files on disk", () => {
        // The manifest's `images` is a number a browser shows without
        // checking. Derived here from the packs themselves so the two cannot
        // drift — the same argument as the case list above.
        const manifest = parseManifest(
          JSON.parse(readFileSync(join(base, "manifest.json"), "utf8")) as unknown,
        );
        for (const entry of manifest!.cases) {
          const pack = decodePack(
            JSON.parse(readFileSync(join(base, `${entry.id}.json`), "utf8")) as unknown,
          );
          expect(entry.images).toBe(pack!.images.length);
        }
      });

      for (const file of files) {
        it(`${file} decodes and proves out`, () => {
          const pack = decodePack(JSON.parse(readFileSync(join(base, file), "utf8")) as unknown);
          expect(pack).not.toBeNull();
          // The real assertion: the oracle, the tier and the prose, all
          // re-derived from the file rather than read out of it.
          expect(verifyPack(pack!)).toEqual([]);
          expect(`${pack!.id}.json`).toBe(file);
        });

        it(`${file} has every picture it claims`, () => {
          // Wave 7's half of "every referenced image exists". `verifyPack`
          // checks a key names somebody in this cast; only a filesystem can
          // say whether the file is there, and a listed portrait that 404s
          // would show a broken image where a monogram belongs.
          //
          // Neither half looks at what is *in* the picture. Nothing can —
          // see `art/prompts.ts`.
          const pack = decodePack(JSON.parse(readFileSync(join(base, file), "utf8")) as unknown);
          const dir = join(base, pack!.id);
          for (const key of pack!.images) {
            expect(existsSync(join(dir, `${key}.webp`))).toBe(true);
          }
        });

        it(`${file} claims every picture it has`, () => {
          // And the other way round, which is the direction that costs money:
          // an unlisted file was paid for and is shown to nobody.
          const pack = decodePack(JSON.parse(readFileSync(join(base, file), "utf8")) as unknown);
          const dir = join(base, pack!.id);
          const onDisk = existsSync(dir)
            ? readdirSync(dir)
                .filter((name) => name.endsWith(".webp"))
                .map((name) => name.replace(/\.webp$/, ""))
                .sort()
            : [];
          expect(onDisk).toEqual([...pack!.images].sort());
        });
      }
    });
  }
});
